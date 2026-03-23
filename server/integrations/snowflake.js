// ============================================================
//  Ensono DataGrid — Snowflake Integration Client
//  Uses Snowflake SQL REST API v2 with Key Pair Authentication
//  Covers: Export (DataGrid→Snowflake), Import (Snowflake→DataGrid),
//          Schema inference, Incremental sync, Streaming MERGE
//
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const https  = require('https');
const crypto = require('crypto');
const db     = require('../db');
const { nanoid } = require('nanoid');
const { encryptConfig, decryptConfig } = require('./servicenow');

const makeId = () => nanoid(12);

// ── JWT generation for Snowflake key-pair auth ───────────────
function buildSnowflakeJWT(account, username, privateKeyPem) {
  const privateKey   = crypto.createPrivateKey(privateKeyPem);
  const publicKey    = crypto.createPublicKey(privateKey);
  const pubKeyDer    = publicKey.export({ type: 'spki', format: 'der' });
  const pubKeyFP     = 'SHA256:' + crypto.createHash('sha256').update(pubKeyDer).digest('base64');

  const qualUser     = `${account.toUpperCase()}.${username.toUpperCase()}`;
  const now          = Math.floor(Date.now() / 1000);
  const header       = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload      = Buffer.from(JSON.stringify({
    iss: `${qualUser}.${pubKeyFP}`,
    sub: qualUser,
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), {
    key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING,
  }).toString('base64url');

  return `${header}.${payload}.${sig}`;
}

// ── Low-level SQL REST API call ──────────────────────────────
function snowflakeSQL(account, jwt, sql, bindings = [], warehouse = null, database = null, schema = null) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify({
      statement: sql,
      bindings:  bindings.length ? bindings.reduce((a, v, i) => { a[String(i+1)] = { type: 'TEXT', value: String(v ?? '') }; return a; }, {}) : undefined,
      warehouse, database, schema,
      timeout: 60,
    });
    const host   = `${account}.snowflakecomputing.com`;
    const opts   = {
      hostname: host,
      path:     '/api/v2/statements',
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 65000,
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400)
            return reject(Object.assign(new Error(`Snowflake ${res.statusCode}: ${parsed.message || ''}`),
              { statusCode: res.statusCode, sfCode: parsed.code, body: parsed }));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Snowflake request timeout')));
    req.write(body);
    req.end();
  });
}

// ── Get integration config ───────────────────────────────────
async function getSnowflakeConfig(integrationId) {
  const [[row]] = await db.execute(
    'SELECT config_encrypted FROM integrations WHERE id = ? AND type = ?',
    [integrationId, 'snowflake']
  );
  if (!row) throw new Error('Snowflake integration not found');
  return decryptConfig(row.config_encrypted);
}

// ── DataGrid field type → Snowflake SQL type ─────────────────
function dgTypeToSnowflake(dgType) {
  const map = {
    text:          'VARCHAR(65535)',
    email:         'VARCHAR(255)',
    url:           'VARCHAR(500)',
    phone:         'VARCHAR(50)',
    number:        'FLOAT',
    rating:        'NUMBER(1)',
    checkbox:      'BOOLEAN',
    date:          'DATE',
    singleSelect:  'VARCHAR(255)',
    multiSelect:   'VARIANT',       // JSON array
    attachment:    'VARIANT',       // JSON array of file metadata
  };
  return map[dgType] || 'VARIANT';
}

// ── Escape Snowflake identifier ──────────────────────────────
const sfId = s => `"${s.toUpperCase().replace(/"/g, '""')}"`;

// ═══════════════════════════════════════════════════════════════
//  EXPORT — DataGrid → Snowflake
// ═══════════════════════════════════════════════════════════════

/**
 * Export a DataGrid table to a Snowflake table.
 * Creates the table if it does not exist.
 * Uses MERGE for upserts (idempotent, safe to re-run).
 *
 * options.incremental: true = only sync records updated since last watermark
 * options.targetTable: Snowflake table name (defaults to DataGrid table name)
 */
async function exportTableToSnowflake(integrationId, tableId, jobId, options = {}) {
  const cfg = await getSnowflakeConfig(integrationId);
  const jwt = buildSnowflakeJWT(cfg.account, cfg.username, cfg.private_key_pem);
  const sf  = (sql, binds) => snowflakeSQL(cfg.account, jwt, sql, binds || [],
    cfg.warehouse, cfg.database, cfg.schema);

  // Load DataGrid table metadata
  const [[tbl]] = await db.execute('SELECT name FROM `tables` WHERE id = ?', [tableId]);
  if (!tbl) throw new Error('Table not found: ' + tableId);

  const [fields]  = await db.execute(
    'SELECT id, name, type FROM fields WHERE table_id = ? ORDER BY order_index', [tableId]
  );
  const targetTable = sfId(options.targetTable || tbl.name.replace(/\s+/g, '_'));

  // 1. Ensure the Snowflake table exists with correct columns
  const colDefs = [
    `"DATAGRID_RECORD_ID"  VARCHAR(12)  NOT NULL`,
    `"DATAGRID_SYNCED_AT"  TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()`,
    ...fields.map(f => `${sfId(f.name)} ${dgTypeToSnowflake(f.type)}`),
  ].join(',\n  ');

  await sf(`CREATE TABLE IF NOT EXISTS ${targetTable} (\n  ${colDefs},\n  PRIMARY KEY ("DATAGRID_RECORD_ID")\n)`);

  // Add any new columns that exist in DataGrid but not yet in Snowflake
  for (const f of fields) {
    try {
      await sf(`ALTER TABLE ${targetTable} ADD COLUMN IF NOT EXISTS ${sfId(f.name)} ${dgTypeToSnowflake(f.type)}`);
    } catch { /* column already exists */ }
  }

  // 2. Load records
  let recordQuery = `SELECT r.id, r.updated_at FROM records r WHERE r.table_id = ?`;
  const queryParams = [tableId];

  if (options.incremental && options.watermark) {
    recordQuery += ` AND r.updated_at > ?`;
    queryParams.push(options.watermark);
  }
  recordQuery += ' ORDER BY r.updated_at';

  const [records] = await db.execute(recordQuery, queryParams);
  if (!records.length) return { pushed: 0, watermark: options.watermark };

  const recIds = records.map(r => r.id);
  const [cells] = await db.execute(
    `SELECT record_id, field_id, value_text, value_num, value_bool, value_json
     FROM cell_values WHERE record_id IN (${recIds.map(() => '?').join(',')})`,
    recIds
  );

  // Build cell map
  const ftype = {};
  fields.forEach(f => { ftype[f.id] = { type: f.type, name: f.name }; });
  const cellMap = {};
  cells.forEach(c => {
    if (!cellMap[c.record_id]) cellMap[c.record_id] = {};
    const f = ftype[c.field_id];
    if (!f) return;
    if (f.type === 'checkbox')                      cellMap[c.record_id][f.name] = !!c.value_bool;
    else if (f.type === 'number' || f.type === 'rating') cellMap[c.record_id][f.name] = c.value_num;
    else if (f.type === 'multiSelect' || f.type === 'attachment')
      cellMap[c.record_id][f.name] = c.value_json || '[]';
    else cellMap[c.record_id][f.name] = c.value_text || '';
  });

  // 3. MERGE rows in batches of 500
  const BATCH = 500;
  let pushed = 0;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const valueRows = batch.map(rec => {
      const cell = cellMap[rec.id] || {};
      const vals = [
        `'${rec.id}'`,
        `CURRENT_TIMESTAMP()`,
        ...fields.map(f => {
          const v = cell[f.name];
          if (v === null || v === undefined) return 'NULL';
          if (f.type === 'checkbox') return v ? 'TRUE' : 'FALSE';
          if (f.type === 'number' || f.type === 'rating') return isNaN(v) ? 'NULL' : String(v);
          if (f.type === 'date') return v ? `'${v}'::DATE` : 'NULL';
          if (f.type === 'multiSelect' || f.type === 'attachment') return `PARSE_JSON('${String(v).replace(/'/g, "''")}')`;
          return `'${String(v).replace(/'/g, "''")}'`;
        }),
      ];
      return `(${vals.join(', ')})`;
    }).join(',\n');

    const srcCols = ['"DATAGRID_RECORD_ID"', '"DATAGRID_SYNCED_AT"', ...fields.map(f => sfId(f.name))].join(', ');
    const updCols = ['"DATAGRID_SYNCED_AT" = src."DATAGRID_SYNCED_AT"',
      ...fields.map(f => `${sfId(f.name)} = src.${sfId(f.name)}`)].join(', ');

    const mergeSql = `
      MERGE INTO ${targetTable} tgt
      USING (SELECT * FROM VALUES ${valueRows} AS v(${srcCols})) src
      ON tgt."DATAGRID_RECORD_ID" = src."DATAGRID_RECORD_ID"
      WHEN MATCHED THEN UPDATE SET ${updCols}
      WHEN NOT MATCHED THEN INSERT (${srcCols}) VALUES (${['"DATAGRID_RECORD_ID"','"DATAGRID_SYNCED_AT"',...fields.map(f=>sfId(f.name))].map(c=>`src.${c}`).join(', ')})
    `;
    await sf(mergeSql);
    pushed += batch.length;

    // Update job progress
    await db.execute(
      'UPDATE sync_jobs SET records_processed = ? WHERE id = ?', [i + batch.length, jobId]
    );
  }

  const watermark = records[records.length - 1].updated_at;
  await db.execute(
    'UPDATE sync_jobs SET status = ?, watermark = ?, finished_at = NOW() WHERE id = ?',
    ['done', watermark, jobId]
  );

  return { pushed, watermark };
}

// ═══════════════════════════════════════════════════════════════
//  IMPORT — Snowflake → DataGrid
// ═══════════════════════════════════════════════════════════════

/**
 * Run a Snowflake SQL query and create/update a DataGrid table with results.
 * Infers field types from Snowflake result column metadata.
 */
async function importFromSnowflake(integrationId, workspaceId, baseId, sql, targetTableName, createdBy) {
  const cfg  = await getSnowflakeConfig(integrationId);
  const jwt  = buildSnowflakeJWT(cfg.account, cfg.username, cfg.private_key_pem);
  const sfn  = (s, b) => snowflakeSQL(cfg.account, jwt, s, b || [], cfg.warehouse, cfg.database, cfg.schema);

  const result = await sfn(sql);
  const meta   = result.resultSetMetaData?.rowType || [];
  const rows   = result.data || [];

  // Map Snowflake types to DataGrid field types
  const sfTypeToDG = t => {
    const u = (t || '').toUpperCase();
    if (u.includes('BOOLEAN'))            return 'checkbox';
    if (u.includes('FLOAT') || u.includes('NUMBER') || u.includes('INT')) return 'number';
    if (u.includes('DATE') || u.includes('TIME')) return 'date';
    if (u.includes('VARIANT') || u.includes('ARRAY') || u.includes('OBJECT')) return 'text';
    return 'text';
  };

  // Create DataGrid table if not exists
  const { nanoid: nano } = require('nanoid');
  const newTableId = nano(12);
  await db.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [newTableId, baseId, targetTableName, 0]
  );

  // Create fields from Snowflake column metadata
  const fieldIdMap = {};
  for (let i = 0; i < meta.length; i++) {
    const col  = meta[i];
    const fid  = nano(12);
    const dgType = sfTypeToDG(col.type);
    await db.execute(
      'INSERT INTO fields (id, table_id, name, type, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?)',
      [fid, newTableId, col.name, dgType, i, i === 0 ? 1 : 0]
    );
    fieldIdMap[col.name] = { id: fid, type: dgType };
  }

  // Insert rows as DataGrid records
  const { _saveCells } = require('../routes/data');
  let imported = 0;
  for (const row of rows) {
    const recId = nano(12);
    await db.execute(
      'INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)',
      [recId, newTableId, imported, createdBy]
    );
    const cells = {};
    meta.forEach((col, idx) => {
      const f = fieldIdMap[col.name];
      if (f) cells[f.id] = row[idx];
    });
    await _saveCells(recId, cells);
    imported++;
  }

  return { tableId: newTableId, tableName: targetTableName, rowsImported: imported, columns: meta.length };
}

/**
 * Infer and return the schema of a Snowflake table as DataGrid field definitions.
 */
async function inspectSnowflakeTable(integrationId, snowflakeTable) {
  const cfg    = await getSnowflakeConfig(integrationId);
  const jwt    = buildSnowflakeJWT(cfg.account, cfg.username, cfg.private_key_pem);
  const result = await snowflakeSQL(cfg.account, jwt,
    `DESCRIBE TABLE ${snowflakeTable}`, [], cfg.warehouse, cfg.database, cfg.schema
  );
  return (result.data || []).map(row => ({
    name:   row[0],
    sfType: row[1],
    nullable: row[3] === 'Y',
  }));
}

// ── Admin helpers ────────────────────────────────────────────
async function registerIntegration(workspaceId, name, config, createdBy) {
  const id = makeId();
  await db.execute(
    'INSERT INTO integrations (id, workspace_id, type, name, config_encrypted, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [id, workspaceId, 'snowflake', name, encryptConfig(config), createdBy]
  );
  return id;
}

async function testConnection(integrationId) {
  try {
    const cfg    = await getSnowflakeConfig(integrationId);
    const jwt    = buildSnowflakeJWT(cfg.account, cfg.username, cfg.private_key_pem);
    const result = await snowflakeSQL(cfg.account, jwt, 'SELECT CURRENT_USER(), CURRENT_WAREHOUSE()',
      [], cfg.warehouse, cfg.database, cfg.schema);
    return { ok: true, account: cfg.account, user: result.data?.[0]?.[0], warehouse: result.data?.[0]?.[1] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  buildSnowflakeJWT,
  exportTableToSnowflake,
  importFromSnowflake,
  inspectSnowflakeTable,
  registerIntegration,
  testConnection,
  getSnowflakeConfig,
};
