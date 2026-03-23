// ============================================================
//  Ensono DataGrid — ServiceNow Integration Client
//  Supports: OAuth 2.0 Client Credentials flow
//  Covers:   Incidents, Change Requests, CMDB CIs,
//            Users, Work Notes, Webhook inbound processing
//
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const https   = require('https');
const crypto  = require('crypto');
const db      = require('../db');
const { nanoid } = require('nanoid');

const makeId = () => nanoid(12);

// ── Config encryption (AES-256-GCM) ─────────────────────────
const ENC_KEY = Buffer.from(
  process.env.INTEGRATION_ENCRYPTION_KEY || '0'.repeat(64), 'hex'
);

function encryptConfig(obj) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return JSON.stringify({
    iv:  iv.toString('hex'),
    tag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

function decryptConfig(blob) {
  const { iv, tag, data } = JSON.parse(blob);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

// ── HTTP helper (no axios dependency) ───────────────────────
function snowRequest(cfg, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url  = new URL(`https://${cfg.instance}.service-now.com${path}`);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${cfg.oauth_token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : {};
          if (res.statusCode >= 400)
            return reject(Object.assign(new Error(`ServiceNow ${res.statusCode}`),
              { statusCode: res.statusCode, body: parsed }));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('ServiceNow request timeout')));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── OAuth token management ───────────────────────────────────
async function ensureToken(integrationId) {
  const [[row]] = await db.execute(
    'SELECT config_encrypted FROM integrations WHERE id = ? AND type = ?',
    [integrationId, 'servicenow']
  );
  if (!row) throw new Error('ServiceNow integration not found');

  const cfg = decryptConfig(row.config_encrypted);

  // Refresh if token expires within 5 minutes
  if (cfg.token_expiry && new Date(cfg.token_expiry) > new Date(Date.now() + 5 * 60000)) {
    return cfg;
  }

  // OAuth 2.0 Client Credentials grant
  const tokenData = await new Promise((resolve, reject) => {
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(cfg.client_id)}&client_secret=${encodeURIComponent(cfg.client_secret)}`;
    const opts = {
      hostname: `${cfg.instance}.service-now.com`,
      path:     '/oauth_token.do',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout:  10000,
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!tokenData.access_token) throw new Error('ServiceNow OAuth failed: ' + JSON.stringify(tokenData));

  cfg.oauth_token   = tokenData.access_token;
  cfg.token_expiry  = new Date(Date.now() + (tokenData.expires_in - 60) * 1000).toISOString();

  // Persist updated token
  await db.execute(
    'UPDATE integrations SET config_encrypted = ?, updated_at = NOW() WHERE id = ?',
    [encryptConfig(cfg), integrationId]
  );
  return cfg;
}

// ═══════════════════════════════════════════════════════════════
//  OUTBOUND — DataGrid → ServiceNow
// ═══════════════════════════════════════════════════════════════

/**
 * Create a ServiceNow Incident from a DataGrid record.
 * fieldMap: { short_description: 'fieldId', description: 'fieldId', urgency: 'fieldId', ... }
 * Returns: { sys_id, number, url }
 */
async function createIncident(integrationId, record, fieldMap, options = {}) {
  const cfg = await ensureToken(integrationId);

  // Build SNOW payload from record values using fieldMap
  const payload = { caller_id: options.callerSysId || 'dataGrid' };
  for (const [snowField, datagridFieldId] of Object.entries(fieldMap)) {
    if (record[datagridFieldId] !== undefined && record[datagridFieldId] !== null) {
      payload[snowField] = String(record[datagridFieldId]);
    }
  }

  // Urgency / priority mapping from DataGrid priority field
  if (options.priorityFieldId) {
    const priorityMap = { Critical: 1, High: 2, Medium: 3, Low: 4 };
    payload.urgency  = String(priorityMap[record[options.priorityFieldId]] || 3);
    payload.impact   = payload.urgency;
  }

  const result = await snowRequest(cfg, 'POST', '/api/now/table/incident', payload);
  const sysId  = result.result?.sys_id;
  const number = result.result?.number;
  const url    = `https://${cfg.instance}.service-now.com/incident.do?sys_id=${sysId}`;

  // Persist link
  await db.execute(
    `INSERT INTO record_integration_links
     (id, record_id, integration_id, external_id, external_type, external_url, last_synced_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 'ok')
     ON DUPLICATE KEY UPDATE external_id=VALUES(external_id), external_url=VALUES(external_url),
       last_synced_at=NOW(), sync_status='ok', sync_error=NULL`,
    [makeId(), record.id, integrationId, sysId, 'incident', url]
  );

  return { sysId, number, url };
}

/**
 * Create a Change Request linked to a DataGrid record.
 */
async function createChangeRequest(integrationId, record, fieldMap, options = {}) {
  const cfg     = await ensureToken(integrationId);
  const payload = { type: options.changeType || 'normal' };
  for (const [snowField, dgFieldId] of Object.entries(fieldMap)) {
    if (record[dgFieldId] !== undefined) payload[snowField] = String(record[dgFieldId]);
  }
  const result = await snowRequest(cfg, 'POST', '/api/now/table/change_request', payload);
  const sysId  = result.result?.sys_id;
  const url    = `https://${cfg.instance}.service-now.com/change_request.do?sys_id=${sysId}`;
  await db.execute(
    `INSERT INTO record_integration_links (id, record_id, integration_id, external_id, external_type, external_url, last_synced_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), 'ok')
     ON DUPLICATE KEY UPDATE external_id=VALUES(external_id), external_url=VALUES(external_url), last_synced_at=NOW(), sync_status='ok'`,
    [makeId(), record.id, integrationId, sysId, 'change_request', url]
  );
  return { sysId, number: result.result?.number, url };
}

/**
 * Add a work note to an existing SNOW ticket linked to a record.
 */
async function addWorkNote(integrationId, recordId, noteText) {
  const [[link]] = await db.execute(
    'SELECT external_id, external_type FROM record_integration_links WHERE record_id = ? AND integration_id = ?',
    [recordId, integrationId]
  );
  if (!link) throw new Error('No SNOW link found for this record');

  const cfg = await ensureToken(integrationId);
  const tableMap = { incident: 'incident', change_request: 'change_request', problem: 'problem' };
  const table    = tableMap[link.external_type] || 'incident';

  await snowRequest(cfg, 'PATCH', `/api/now/table/${table}/${link.external_id}`, {
    work_notes: noteText,
  });
  await db.execute(
    'UPDATE record_integration_links SET last_synced_at = NOW() WHERE record_id = ? AND integration_id = ?',
    [recordId, integrationId]
  );
}

/**
 * Push a field update to the linked SNOW ticket.
 */
async function updateTicketField(integrationId, recordId, snowField, value) {
  const [[link]] = await db.execute(
    'SELECT external_id, external_type FROM record_integration_links WHERE record_id = ? AND integration_id = ?',
    [recordId, integrationId]
  );
  if (!link) return; // Not linked — silently skip
  const cfg   = await ensureToken(integrationId);
  const table = link.external_type || 'incident';
  await snowRequest(cfg, 'PATCH', `/api/now/table/${table}/${link.external_id}`, {
    [snowField]: String(value),
  });
}

/**
 * Resolve/close a SNOW ticket when record status → Done.
 */
async function resolveTicket(integrationId, recordId, resolveNote = 'Resolved via Ensono DataGrid') {
  const [[link]] = await db.execute(
    'SELECT external_id, external_type FROM record_integration_links WHERE record_id = ? AND integration_id = ?',
    [recordId, integrationId]
  );
  if (!link) return;
  const cfg = await ensureToken(integrationId);
  // Incident: state=6 (Resolved), close_code, close_notes
  const body = link.external_type === 'incident'
    ? { state: '6', close_code: 'Solved (Permanently)', close_notes: resolveNote }
    : { state: '3', close_notes: resolveNote }; // change: state=3 (Closed)
  await snowRequest(cfg, 'PATCH', `/api/now/table/${link.external_type}/${link.external_id}`, body);
}

// ═══════════════════════════════════════════════════════════════
//  PULL — ServiceNow → DataGrid
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch CMDB Configuration Items and return as rows for a DataGrid table.
 * ciClass: e.g. 'cmdb_ci_server', 'cmdb_ci_application'
 */
async function fetchCMDBItems(integrationId, ciClass = 'cmdb_ci', limit = 500) {
  const cfg = await ensureToken(integrationId);
  const fields = 'name,sys_id,operational_status,environment,u_tier,assigned_to,ip_address,short_description,sys_updated_on';
  const result = await snowRequest(cfg, 'GET',
    `/api/now/table/${ciClass}?sysparm_fields=${fields}&sysparm_limit=${limit}&sysparm_query=operational_status=1`
  );
  return (result.result || []).map(ci => ({
    name:        ci.name,
    snow_sys_id: ci.sys_id,
    status:      ci.operational_status === '1' ? 'Operational' : 'Non-operational',
    environment: ci.environment,
    tier:        ci.u_tier,
    assigned_to: ci.assigned_to?.display_value || ci.assigned_to || '',
    ip_address:  ci.ip_address,
    description: ci.short_description,
    updated:     ci.sys_updated_on,
  }));
}

/**
 * Fetch open incidents for a given assignment group.
 */
async function fetchOpenIncidents(integrationId, assignmentGroup = '', limit = 200) {
  const cfg   = await ensureToken(integrationId);
  const query = assignmentGroup
    ? `active=true^assignment_group.name=${assignmentGroup}`
    : 'active=true';
  const fields = 'number,sys_id,short_description,state,priority,assigned_to,opened_at,category';
  const result = await snowRequest(cfg, 'GET',
    `/api/now/table/incident?sysparm_fields=${fields}&sysparm_limit=${limit}&sysparm_query=${encodeURIComponent(query)}`
  );
  const stateMap = { 1:'New',2:'In Progress',3:'On Hold',4:'Resolved',5:'Closed',6:'Canceled' };
  return (result.result || []).map(inc => ({
    number:      inc.number,
    sys_id:      inc.sys_id,
    description: inc.short_description,
    state:       stateMap[inc.state] || inc.state,
    priority:    inc.priority,
    assigned_to: inc.assigned_to?.display_value || '',
    opened_at:   inc.opened_at,
    category:    inc.category,
  }));
}

// ═══════════════════════════════════════════════════════════════
//  INBOUND WEBHOOK — ServiceNow → DataGrid
// ═══════════════════════════════════════════════════════════════

/**
 * Validate SNOW webhook HMAC signature.
 * SNOW Business Rule sets X-ServiceNow-HMAC header.
 */
function validateSnowWebhook(payload, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Process an inbound SNOW webhook event.
 * Updates the linked DataGrid record's fields based on integration_field_maps.
 *
 * Expected payload shape from SNOW Business Rule:
 * {
 *   integration_id: "...",
 *   event_type: "incident.updated",
 *   sys_id: "...",
 *   fields: { state: "2", assigned_to: "john.doe", ... }
 * }
 */
async function processWebhookEvent(eventId, payload) {
  const { integration_id, event_type, sys_id, fields: snowFields } = payload;

  // Find the DataGrid record linked to this sys_id
  const [[link]] = await db.execute(
    'SELECT record_id FROM record_integration_links WHERE external_id = ? AND integration_id = ?',
    [sys_id, integration_id]
  );
  if (!link) return { skipped: true, reason: 'No linked record found' };

  // Get field mappings for this integration (pull direction)
  const [maps] = await db.execute(
    `SELECT ifm.datagrid_field_id, ifm.external_field, ifm.transform, f.type
     FROM integration_field_maps ifm
     JOIN fields f ON f.id = ifm.datagrid_field_id
     WHERE ifm.integration_id = ? AND ifm.direction IN ('pull','both')`,
    [integration_id]
  );

  const cells = {};
  for (const map of maps) {
    const rawVal = snowFields[map.external_field];
    if (rawVal === undefined) continue;

    // ServiceNow state → DataGrid select option mapping
    let val = rawVal;
    if (map.external_field === 'state') {
      const stateToStatus = { '1':'Todo','2':'In Progress','3':'Blocked','4':'Done','5':'Done','6':'Blocked' };
      val = stateToStatus[rawVal] || rawVal;
    }

    // Apply optional transform (safe eval-lite: only simple mappings)
    if (map.transform) {
      try {
        const fn = new Function('v', `"use strict"; return (${map.transform})(v);`);
        val = fn(val);
      } catch { /* use raw val if transform fails */ }
    }

    cells[map.datagrid_field_id] = val;
  }

  if (Object.keys(cells).length > 0) {
    const { _saveCells } = require('../routes/data');
    await _saveCells(link.record_id, cells);
    await db.execute('UPDATE records SET updated_at = NOW() WHERE id = ?', [link.record_id]);
  }

  // Mark webhook processed
  await db.execute(
    'UPDATE webhook_events SET processed = 1, processed_at = NOW() WHERE id = ?',
    [eventId]
  );
  await db.execute(
    'UPDATE record_integration_links SET last_synced_at = NOW(), sync_status = ? WHERE record_id = ? AND integration_id = ?',
    ['ok', link.record_id, integration_id]
  );

  return { processed: true, recordId: link.record_id, cellsUpdated: Object.keys(cells).length };
}

// ── Admin helpers ────────────────────────────────────────────
async function registerIntegration(workspaceId, name, config, createdBy) {
  const id = makeId();
  await db.execute(
    'INSERT INTO integrations (id, workspace_id, type, name, config_encrypted, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, workspaceId, 'servicenow', name, encryptConfig(config), createdBy]
  );
  return id;
}

async function testConnection(integrationId) {
  try {
    const cfg    = await ensureToken(integrationId);
    const result = await snowRequest(cfg, 'GET', '/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id');
    return { ok: true, instance: cfg.instance };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  encryptConfig, decryptConfig,
  ensureToken,
  createIncident, createChangeRequest,
  addWorkNote, updateTicketField, resolveTicket,
  fetchCMDBItems, fetchOpenIncidents,
  validateSnowWebhook, processWebhookEvent,
  registerIntegration, testConnection,
};
