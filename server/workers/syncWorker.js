// ============================================================
//  Ensono DataGrid — Integration Sync Worker
//  Runs scheduled sync jobs:
//    • Auto-create SNOW incidents when record status → Critical/Blocked
//    • Auto-resolve SNOW tickets when record status → Done
//    • Scheduled Snowflake exports (hourly/daily)
//    • Process pending webhook events
//
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const db   = require('../db');
const snow = require('../integrations/servicenow');
const sf   = require('../integrations/snowflake');
const { nanoid } = require('nanoid');

const makeId = () => nanoid(12);

// ── Status values that trigger automatic SNOW incident creation
const AUTO_INCIDENT_STATUSES = new Set(['Blocked', 'Critical']);
const AUTO_RESOLVE_STATUSES  = new Set(['Done']);

let isRunning = false;

// ═══════════════════════════════════════════════════════════════
//  JOB: Process pending webhook events (every 30 seconds)
// ═══════════════════════════════════════════════════════════════
async function processPendingWebhooks() {
  const [events] = await db.execute(
    `SELECT id, integration_id, source, payload FROM webhook_events
     WHERE processed = 0 AND (hmac_valid = 1 OR hmac_valid IS NULL)
     ORDER BY received_at LIMIT 50`
  );

  for (const evt of events) {
    try {
      const payload = JSON.parse(evt.payload);
      if (evt.source === 'servicenow') {
        await snow.processWebhookEvent(evt.id, payload);
      }
      await db.execute(
        'UPDATE webhook_events SET processed = 1, processed_at = NOW() WHERE id = ?', [evt.id]
      );
    } catch (e) {
      await db.execute(
        'UPDATE webhook_events SET process_error = ? WHERE id = ?', [e.message, evt.id]
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  JOB: Auto-incident from status field changes (every 2 minutes)
// ═══════════════════════════════════════════════════════════════
async function autoIncidentOnStatusChange() {
  // Find integrations with auto-incident enabled
  // Look for records updated in last 3 minutes with Critical/Blocked status
  // where no SNOW link exists yet
  const [configs] = await db.execute(
    `SELECT i.id AS integration_id, i.workspace_id,
            ifm.datagrid_field_id AS status_field_id,
            ifm.table_id
     FROM integrations i
     JOIN integration_field_maps ifm ON ifm.integration_id = i.id
     WHERE i.type = 'servicenow' AND i.is_active = 1
       AND ifm.external_field = 'state'`
  );

  for (const cfg of configs) {
    // Find recently updated records with trigger status, no existing SNOW link
    const [candidates] = await db.execute(
      `SELECT r.id AS record_id, cv.value_text AS status_value
       FROM records r
       JOIN cell_values cv ON cv.record_id = r.id AND cv.field_id = ?
       LEFT JOIN record_integration_links ril
         ON ril.record_id = r.id AND ril.integration_id = ?
       WHERE r.table_id = ?
         AND r.updated_at >= DATE_SUB(NOW(), INTERVAL 3 MINUTE)
         AND ril.id IS NULL`,
      [cfg.status_field_id, cfg.integration_id, cfg.table_id]
    );

    for (const c of candidates) {
      if (AUTO_INCIDENT_STATUSES.has(c.status_value)) {
        try {
          // Load full record
          const [cells] = await db.execute(
            'SELECT field_id, value_text, value_num, value_bool FROM cell_values WHERE record_id = ?',
            [c.record_id]
          );
          const record = { id: c.record_id };
          cells.forEach(cv => {
            record[cv.field_id] = cv.value_text ?? cv.value_num ?? (cv.value_bool !== null ? !!cv.value_bool : null);
          });
          // Build minimal field map: short_description from primary field
          const [[pf]] = await db.execute(
            'SELECT id FROM fields WHERE table_id = ? AND is_primary = 1', [cfg.table_id]
          );
          const fieldMap = pf ? { short_description: pf.id } : {};
          await snow.createIncident(cfg.integration_id, record, fieldMap, {
            priorityFieldId: cfg.status_field_id,
          });
          console.log(`[syncWorker] Auto-incident created for record ${c.record_id}`);
        } catch (e) {
          console.error(`[syncWorker] Auto-incident failed for ${c.record_id}:`, e.message);
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  JOB: Auto-resolve SNOW ticket on Done status (every 2 minutes)
// ═══════════════════════════════════════════════════════════════
async function autoResolveOnDone() {
  const [links] = await db.execute(
    `SELECT ril.record_id, ril.integration_id, cv.value_text AS status
     FROM record_integration_links ril
     JOIN integrations i ON i.id = ril.integration_id AND i.type = 'servicenow' AND i.is_active = 1
     JOIN integration_field_maps ifm ON ifm.integration_id = ril.integration_id AND ifm.external_field = 'state'
     JOIN cell_values cv ON cv.record_id = ril.record_id AND cv.field_id = ifm.datagrid_field_id
     JOIN records r ON r.id = ril.record_id AND r.updated_at >= DATE_SUB(NOW(), INTERVAL 3 MINUTE)
     WHERE ril.sync_status != 'resolved'`
  );

  for (const link of links) {
    if (AUTO_RESOLVE_STATUSES.has(link.status)) {
      try {
        await snow.resolveTicket(link.integration_id, link.record_id, 'Resolved — status set to Done in Ensono DataGrid');
        await db.execute(
          'UPDATE record_integration_links SET sync_status = ? WHERE record_id = ? AND integration_id = ?',
          ['resolved', link.record_id, link.integration_id]
        );
        console.log(`[syncWorker] Auto-resolved SNOW ticket for record ${link.record_id}`);
      } catch (e) {
        await db.execute(
          'UPDATE record_integration_links SET sync_status = ?, sync_error = ? WHERE record_id = ? AND integration_id = ?',
          ['error', e.message, link.record_id, link.integration_id]
        );
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  JOB: Scheduled Snowflake exports (every hour)
// ═══════════════════════════════════════════════════════════════
async function scheduledSnowflakeExports() {
  // Find Snowflake integrations — export all mapped tables incrementally
  const [integrations] = await db.execute(
    `SELECT DISTINCT i.id AS integration_id, ifm.table_id
     FROM integrations i
     JOIN integration_field_maps ifm ON ifm.integration_id = i.id
     WHERE i.type = 'snowflake' AND i.is_active = 1`
  );

  for (const intg of integrations) {
    // Skip if a job is already running for this integration+table
    const [[running]] = await db.execute(
      `SELECT 1 FROM sync_jobs WHERE integration_id = ? AND table_id = ? AND status IN ('queued','running')`,
      [intg.integration_id, intg.table_id]
    );
    if (running) continue;

    const jobId = makeId();
    const [[lastJob]] = await db.execute(
      `SELECT watermark FROM sync_jobs WHERE integration_id = ? AND table_id = ?
       AND direction = 'push' AND status = 'done' ORDER BY finished_at DESC LIMIT 1`,
      [intg.integration_id, intg.table_id]
    );

    await db.execute(
      'INSERT INTO sync_jobs (id, integration_id, table_id, direction, status, triggered_by, watermark) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [jobId, intg.integration_id, intg.table_id, 'push', 'running', 'schedule', lastJob?.watermark || null]
    );
    await db.execute('UPDATE sync_jobs SET started_at = NOW() WHERE id = ?', [jobId]);

    try {
      await sf.exportTableToSnowflake(
        intg.integration_id, intg.table_id, jobId,
        { incremental: true, watermark: lastJob?.watermark || null }
      );
      console.log(`[syncWorker] Scheduled Snowflake export complete for table ${intg.table_id}`);
    } catch (e) {
      await db.execute(
        'UPDATE sync_jobs SET status = ?, error_summary = ?, finished_at = NOW() WHERE id = ?',
        ['failed', e.message, jobId]
      );
      console.error(`[syncWorker] Snowflake export failed for ${intg.table_id}:`, e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  WORKER STARTUP
// ═══════════════════════════════════════════════════════════════
function startSyncWorker() {
  if (isRunning) return;
  isRunning = true;
  console.log('[syncWorker] Started — ServiceNow + Snowflake background sync active');

  // Webhook processing: every 30 seconds
  setInterval(async () => {
    try { await processPendingWebhooks(); } catch (e) {
      console.error('[syncWorker/webhooks]', e.message);
    }
  }, 30 * 1000);

  // Auto-incident / auto-resolve: every 2 minutes
  setInterval(async () => {
    try {
      await autoIncidentOnStatusChange();
      await autoResolveOnDone();
    } catch (e) {
      console.error('[syncWorker/autoIncident]', e.message);
    }
  }, 2 * 60 * 1000);

  // Scheduled Snowflake export: every hour
  setInterval(async () => {
    try { await scheduledSnowflakeExports(); } catch (e) {
      console.error('[syncWorker/snowflake]', e.message);
    }
  }, 60 * 60 * 1000);

  // Run immediately on start (with 10s delay to allow DB pool to stabilise)
  setTimeout(async () => {
    try { await processPendingWebhooks(); } catch {}
    try { await scheduledSnowflakeExports(); } catch {}
  }, 10000);
}

module.exports = { startSyncWorker };
