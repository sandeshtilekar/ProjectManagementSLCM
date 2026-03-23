// ============================================================
//  Ensono DataGrid — Integration Routes
//  Manages ServiceNow + Snowflake configuration, sync triggering,
//  webhook ingestion, and link management.
//
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const router = require('express').Router();
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const db     = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const { ownsResource }      = require('../middleware/ownership');
const snow   = require('../integrations/servicenow');
const sf     = require('../integrations/snowflake');

const makeId = () => nanoid(12);

// ── Middleware: verify integration belongs to caller's workspace ──
const ownIntegration = async (req, res, next) => {
  const { integrationId } = req.params;
  if (!integrationId) return res.status(400).json({ error: 'Integration ID required' });
  const [[row]] = await db.execute(
    `SELECT i.id, i.workspace_id FROM integrations i
     JOIN workspace_members wm ON wm.workspace_id = i.workspace_id
     WHERE i.id = ? AND wm.user_id = ?`,
    [integrationId, req.user.id]
  );
  if (!row) return res.status(403).json({ error: 'Integration not found or access denied' });
  req.integrationWorkspaceId = row.workspace_id;
  next();
};

// ═══════════════════════════════════════════════════════════════
//  INTEGRATION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// List integrations for a workspace
router.get('/workspaces/:workspaceId/integrations', auth, requireRole(), async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, type, name, is_active, created_at, updated_at
     FROM integrations WHERE workspace_id = ? ORDER BY created_at`,
    [req.params.workspaceId]
  );
  res.json(rows);
});

// Register ServiceNow integration
router.post('/workspaces/:workspaceId/integrations/servicenow',
  auth, requireRole('owner', 'admin'),
  async (req, res) => {
    const { name, instance, client_id, client_secret, webhook_secret } = req.body;
    if (!instance || !client_id || !client_secret)
      return res.status(400).json({ error: 'instance, client_id, and client_secret are required' });

    const config = { instance: instance.replace(/\.service-now\.com$/, ''),
      client_id, client_secret, webhook_secret: webhook_secret || '' };

    try {
      const id = await snow.registerIntegration(req.params.workspaceId, name || 'ServiceNow', config, req.user.id);
      res.status(201).json({ id, type: 'servicenow', name: name || 'ServiceNow' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Register Snowflake integration
router.post('/workspaces/:workspaceId/integrations/snowflake',
  auth, requireRole('owner', 'admin'),
  async (req, res) => {
    const { name, account, username, private_key_pem, warehouse, database, schema } = req.body;
    if (!account || !username || !private_key_pem)
      return res.status(400).json({ error: 'account, username, and private_key_pem are required' });

    const config = { account, username, private_key_pem, warehouse, database, schema };
    try {
      const id = await sf.registerIntegration(req.params.workspaceId, name || 'Snowflake', config, req.user.id);
      res.status(201).json({ id, type: 'snowflake', name: name || 'Snowflake' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Test connection
router.get('/integrations/:integrationId/test', auth, ownIntegration, async (req, res) => {
  const [[row]] = await db.execute('SELECT type FROM integrations WHERE id = ?', [req.params.integrationId]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const result = row.type === 'servicenow'
    ? await snow.testConnection(req.params.integrationId)
    : await sf.testConnection(req.params.integrationId);

  res.json(result);
});

// Delete integration
router.delete('/integrations/:integrationId', auth, ownIntegration, async (req, res) => {
  await db.execute('DELETE FROM integrations WHERE id = ?', [req.params.integrationId]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  FIELD MAPPINGS
// ═══════════════════════════════════════════════════════════════

router.get('/integrations/:integrationId/mappings', auth, ownIntegration, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT ifm.*, f.name AS field_name, f.type AS field_type
     FROM integration_field_maps ifm
     JOIN fields f ON f.id = ifm.datagrid_field_id
     WHERE ifm.integration_id = ?`,
    [req.params.integrationId]
  );
  res.json(rows);
});

router.post('/integrations/:integrationId/mappings', auth, ownIntegration, async (req, res) => {
  const { table_id, datagrid_field_id, external_field, direction, transform } = req.body;
  if (!table_id || !datagrid_field_id || !external_field)
    return res.status(400).json({ error: 'table_id, datagrid_field_id, external_field required' });

  const id = makeId();
  await db.execute(
    'INSERT INTO integration_field_maps (id, integration_id, table_id, datagrid_field_id, external_field, direction, transform) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.params.integrationId, table_id, datagrid_field_id, external_field, direction || 'both', transform || null]
  );
  res.status(201).json({ id });
});

router.delete('/integrations/:integrationId/mappings/:mappingId', auth, ownIntegration, async (req, res) => {
  await db.execute('DELETE FROM integration_field_maps WHERE id = ? AND integration_id = ?',
    [req.params.mappingId, req.params.integrationId]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  SERVICENOW — OUTBOUND
// ═══════════════════════════════════════════════════════════════

// Create SNOW Incident from a record
router.post('/integrations/:integrationId/snow/create-incident',
  auth, ownIntegration,
  async (req, res) => {
    const { recordId, fieldMap, priorityFieldId } = req.body;
    if (!recordId) return res.status(400).json({ error: 'recordId required' });

    try {
      // Load record cells
      const [[rec]] = await db.execute('SELECT id FROM records WHERE id = ?', [recordId]);
      if (!rec) return res.status(404).json({ error: 'Record not found' });

      const [cells] = await db.execute(
        'SELECT field_id, value_text, value_num, value_bool FROM cell_values WHERE record_id = ?', [recordId]
      );
      const record = { id: recordId };
      cells.forEach(c => {
        record[c.field_id] = c.value_text ?? c.value_num ?? (c.value_bool !== null ? !!c.value_bool : null);
      });

      const result = await snow.createIncident(req.params.integrationId, record, fieldMap || {}, { priorityFieldId });
      res.status(201).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Create Change Request
router.post('/integrations/:integrationId/snow/create-change',
  auth, ownIntegration,
  async (req, res) => {
    const { recordId, fieldMap, changeType } = req.body;
    try {
      const [cells] = await db.execute(
        'SELECT field_id, value_text, value_num, value_bool FROM cell_values WHERE record_id = ?', [recordId]
      );
      const record = { id: recordId };
      cells.forEach(c => { record[c.field_id] = c.value_text ?? c.value_num ?? (c.value_bool !== null ? !!c.value_bool : null); });
      const result = await snow.createChangeRequest(req.params.integrationId, record, fieldMap || {}, { changeType });
      res.status(201).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Add work note
router.post('/integrations/:integrationId/snow/work-note',
  auth, ownIntegration,
  async (req, res) => {
    const { recordId, note } = req.body;
    try {
      await snow.addWorkNote(req.params.integrationId, recordId, note);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Resolve ticket
router.post('/integrations/:integrationId/snow/resolve',
  auth, ownIntegration,
  async (req, res) => {
    const { recordId, note } = req.body;
    try {
      await snow.resolveTicket(req.params.integrationId, recordId, note);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Pull CMDB into a DataGrid table
router.post('/integrations/:integrationId/snow/pull-cmdb',
  auth, ownIntegration,
  async (req, res) => {
    const { ciClass, limit } = req.body;
    try {
      const items = await snow.fetchCMDBItems(req.params.integrationId, ciClass, limit || 500);
      res.json({ count: items.length, items });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// Pull open incidents
router.post('/integrations/:integrationId/snow/pull-incidents',
  auth, ownIntegration,
  async (req, res) => {
    const { assignmentGroup, limit } = req.body;
    try {
      const incidents = await snow.fetchOpenIncidents(req.params.integrationId, assignmentGroup, limit);
      res.json({ count: incidents.length, incidents });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// ═══════════════════════════════════════════════════════════════
//  SERVICENOW — INBOUND WEBHOOK
//  POST /api/integrations/snow/webhook
//  Called by ServiceNow Business Rule (no auth header — HMAC instead)
// ═══════════════════════════════════════════════════════════════
router.post('/integrations/snow/webhook', async (req, res) => {
  const signature = req.headers['x-servicenow-hmac'] || '';
  const rawBody   = JSON.stringify(req.body);
  const payload   = req.body;

  // Store raw event first (always — for replay capability)
  const eventId = makeId();
  await db.execute(
    'INSERT INTO webhook_events (id, integration_id, source, event_type, payload, hmac_valid) VALUES (?, ?, ?, ?, ?, ?)',
    [eventId, payload.integration_id || null, 'servicenow', payload.event_type || null, rawBody, null]
  );

  // Validate HMAC if integration has a webhook_secret
  if (payload.integration_id) {
    try {
      const [[row]] = await db.execute(
        'SELECT config_encrypted FROM integrations WHERE id = ? AND type = ?',
        [payload.integration_id, 'servicenow']
      );
      if (row) {
        const cfg   = snow.decryptConfig ? snow.decryptConfig(row.config_encrypted) : JSON.parse(row.config_encrypted);
        const valid = snow.validateSnowWebhook(rawBody, signature, cfg.webhook_secret);
        await db.execute('UPDATE webhook_events SET hmac_valid = ? WHERE id = ?', [valid ? 1 : 0, eventId]);
        if (!valid && cfg.webhook_secret) {
          return res.status(401).json({ error: 'Invalid HMAC signature' });
        }
      }
    } catch (e) { /* log but don't block */ }
  }

  // Process asynchronously — respond 202 immediately
  res.status(202).json({ received: true, eventId });

  // Process in background
  setImmediate(async () => {
    try {
      await snow.processWebhookEvent(eventId, payload);
    } catch (e) {
      await db.execute(
        'UPDATE webhook_events SET process_error = ? WHERE id = ?',
        [e.message, eventId]
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  SNOWFLAKE — EXPORT
// ═══════════════════════════════════════════════════════════════

// Trigger export of a DataGrid table to Snowflake
router.post('/integrations/:integrationId/snowflake/export',
  auth, ownIntegration,
  async (req, res) => {
    const { tableId, targetTable, incremental } = req.body;
    if (!tableId) return res.status(400).json({ error: 'tableId required' });

    // Create sync job record
    const jobId = makeId();
    let watermark = null;
    if (incremental) {
      const [[lastJob]] = await db.execute(
        `SELECT watermark FROM sync_jobs WHERE integration_id = ? AND table_id = ?
         AND direction = 'push' AND status = 'done' ORDER BY finished_at DESC LIMIT 1`,
        [req.params.integrationId, tableId]
      );
      watermark = lastJob?.watermark || null;
    }

    await db.execute(
      'INSERT INTO sync_jobs (id, integration_id, table_id, direction, status, triggered_by, watermark) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [jobId, req.params.integrationId, tableId, 'push', 'running', 'manual', watermark]
    );
    await db.execute('UPDATE sync_jobs SET started_at = NOW() WHERE id = ?', [jobId]);

    // Run export asynchronously
    setImmediate(async () => {
      try {
        const result = await sf.exportTableToSnowflake(
          req.params.integrationId, tableId, jobId,
          { incremental, watermark, targetTable }
        );
      } catch (e) {
        await db.execute(
          'UPDATE sync_jobs SET status = ?, error_summary = ?, finished_at = NOW() WHERE id = ?',
          ['failed', e.message, jobId]
        );
      }
    });

    res.status(202).json({ jobId, status: 'running', message: 'Export started — poll /sync-jobs/:id for status' });
  }
);

// ── Snowflake import (query → DataGrid table) ────────────────
router.post('/integrations/:integrationId/snowflake/import',
  auth, ownIntegration,
  async (req, res) => {
    const { sql, baseId, targetTableName } = req.body;
    if (!sql || !baseId || !targetTableName)
      return res.status(400).json({ error: 'sql, baseId, targetTableName required' });

    try {
      const result = await sf.importFromSnowflake(
        req.params.integrationId,
        req.integrationWorkspaceId,
        baseId, sql, targetTableName, req.user.id
      );
      res.status(201).json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// ── Inspect Snowflake table schema ───────────────────────────
router.get('/integrations/:integrationId/snowflake/inspect',
  auth, ownIntegration,
  async (req, res) => {
    const { table } = req.query;
    if (!table) return res.status(400).json({ error: 'table query param required' });
    try {
      const schema = await sf.inspectSnowflakeTable(req.params.integrationId, table);
      res.json(schema);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

// ═══════════════════════════════════════════════════════════════
//  SYNC JOBS — Status & History
// ═══════════════════════════════════════════════════════════════

router.get('/integrations/:integrationId/sync-jobs', auth, ownIntegration, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT id, direction, status, triggered_by, records_processed, records_failed,
            watermark, error_summary, started_at, finished_at, created_at
     FROM sync_jobs WHERE integration_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.params.integrationId]
  );
  res.json(rows);
});

router.get('/sync-jobs/:jobId', auth, async (req, res) => {
  const [[job]] = await db.execute(
    'SELECT * FROM sync_jobs WHERE id = ?', [req.params.jobId]
  );
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ═══════════════════════════════════════════════════════════════
//  RECORD LINKS
// ═══════════════════════════════════════════════════════════════

// Get SNOW/Snowflake links for a record
router.get('/records/:recordId/integration-links', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT ril.id, ril.integration_id, i.type, i.name,
            ril.external_id, ril.external_type, ril.external_url,
            ril.last_synced_at, ril.sync_status, ril.sync_error
     FROM record_integration_links ril
     JOIN integrations i ON i.id = ril.integration_id
     WHERE ril.record_id = ?`,
    [req.params.recordId]
  );
  res.json(rows);
});

module.exports = router;
