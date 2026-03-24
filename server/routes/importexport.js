// ============================================================
//  Ensono DataGrid — Import / Export Routes
//  CSV import: upload CSV → auto-create fields → bulk insert
//  CSV export: download any table as CSV
//  Excel paste: accept tab-separated clipboard data
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const router  = require('express').Router();
const multer  = require('multer');
const { nanoid } = require('nanoid');
const db      = require('../db');
const { auth } = require('../middleware/auth');
const { canAccessTable, ownsResource } = require('../middleware/ownership');

const makeId = () => nanoid(12);
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── CSV parser (no external deps) ───────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let inQuote = false, cell = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i+1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        row.push(cell.trim()); cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell.trim());
    result.push(row);
  }
  return result;
}

// Tab-separated (Excel paste)
function parseTSV(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n').filter(l => l.trim())
    .map(l => l.split('\t').map(c => c.trim()));
}

// Infer field type from sample values
function inferType(values) {
  const sample = values.filter(Boolean).slice(0, 20);
  if (!sample.length) return 'text';
  const dateRx = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$/;
  const numRx  = /^-?\d+(\.\d+)?$/;
  if (sample.every(v => numRx.test(v))) return 'number';
  if (sample.every(v => dateRx.test(v))) return 'date';
  if (sample.every(v => ['true','false','yes','no','0','1'].includes(v.toLowerCase()))) return 'checkbox';
  // If fewer than 10 distinct values and more than 1 row, singleSelect
  const distinct = [...new Set(sample)];
  if (distinct.length <= 10 && sample.length >= 3) return 'singleSelect';
  return 'text';
}

function normaliseDate(v) {
  if (!v) return null;
  // DD/MM/YYYY → YYYY-MM-DD
  const dmyMatch = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  return v;
}

// ── POST /api/tables/:tableId/import ────────────────────────
// Accepts: multipart/form-data with file field (CSV)
// OR JSON body { rows: [[...]], headers: [...] } for paste
router.post('/tables/:tableId/import', auth, canAccessTable, upload.single('file'), async (req, res) => {
  if (!['owner','admin','editor'].includes(req.memberRole))
    return res.status(403).json({ error: 'Insufficient permissions' });

  const { tableId } = req.params;
  let headers, rows;

  try {
    if (req.file) {
      // CSV file upload
      const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM
      const parsed = parseCSV(text);
      if (parsed.length < 2) return res.status(400).json({ error: 'CSV must have at least a header row and one data row' });
      headers = parsed[0];
      rows    = parsed.slice(1);
    } else if (req.body.rows) {
      // Paste from Excel (TSV or pre-parsed)
      headers = req.body.headers;
      rows    = req.body.rows;
    } else {
      return res.status(400).json({ error: 'No file or paste data provided' });
    }

    if (!headers || !headers.length) return res.status(400).json({ error: 'No headers found' });

    // Get existing fields for this table
    const [existingFields] = await db.execute(
      'SELECT id, name, type FROM fields WHERE table_id = ? ORDER BY order_index', [tableId]
    );
    const fieldMap = {}; // header name → { id, type }
    existingFields.forEach(f => { fieldMap[f.name.toLowerCase()] = { id: f.id, type: f.type }; });

    // Create missing fields
    let orderStart = existingFields.length;
    const columnFieldMap = []; // index → { id, type }

    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].trim();
      if (!h) { columnFieldMap.push(null); continue; }

      const key = h.toLowerCase();
      if (fieldMap[key]) {
        columnFieldMap.push(fieldMap[key]);
      } else {
        // Infer type from column values
        const colVals = rows.map(r => r[i] || '');
        const type = inferType(colVals);
        const options = type === 'singleSelect'
          ? { options: [...new Set(colVals.filter(Boolean))].slice(0, 30) }
          : null;

        const fid = makeId();
        const isPrimary = existingFields.length === 0 && i === 0 ? 1 : 0;
        await db.execute(
          'INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [fid, tableId, h, type, options ? JSON.stringify(options) : null, orderStart++, isPrimary]
        );
        const newField = { id: fid, type };
        columnFieldMap.push(newField);
        fieldMap[key] = newField;
      }
    }

    // Get current record count for order_index
    const [[{ cnt }]] = await db.execute('SELECT COUNT(*) AS cnt FROM records WHERE table_id = ?', [tableId]);
    let orderIdx = Number(cnt);

    // Insert records in batches of 100
    let imported = 0, skipped = 0;
    for (const row of rows) {
      if (row.every(c => !c)) { skipped++; continue; } // skip empty rows

      const recId = makeId();
      await db.execute(
        'INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)',
        [recId, tableId, orderIdx++, req.user.id]
      );

      for (let i = 0; i < columnFieldMap.length; i++) {
        const f   = columnFieldMap[i];
        const val = (row[i] || '').trim();
        if (!f || !val) continue;

        let vt = null, vn = null, vb = null;
        if (f.type === 'number' || f.type === 'rating') {
          const n = parseFloat(val.replace(/,/g, ''));
          if (!isNaN(n)) vn = n;
        } else if (f.type === 'checkbox') {
          vb = ['true','yes','1'].includes(val.toLowerCase()) ? 1 : 0;
        } else if (f.type === 'date') {
          vt = normaliseDate(val);
        } else {
          vt = val.substring(0, 65535);
        }

        if (vt !== null || vn !== null || vb !== null) {
          await db.execute(
            'INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json) VALUES (?, ?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num), value_bool=VALUES(value_bool)',
            [recId, f.id, vt, vn, vb]
          );
        }
      }
      imported++;
    }

    res.json({ ok: true, imported, skipped, fieldsCreated: orderStart - existingFields.length });
  } catch (e) {
    console.error('[import]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/tables/:tableId/export.csv ─────────────────────
router.get('/tables/:tableId/export.csv', auth, canAccessTable, async (req, res) => {
  const { tableId } = req.params;

  const [fields]  = await db.execute(
    'SELECT id, name, type FROM fields WHERE table_id = ? ORDER BY order_index', [tableId]
  );
  const [records] = await db.execute(
    'SELECT id FROM records WHERE table_id = ? ORDER BY order_index', [tableId]
  );

  if (!records.length) {
    // Return header-only CSV
    const header = fields.map(f => `"${f.name.replace(/"/g,'""')}"`).join(',');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="table-export.csv"`);
    return res.send(header + '\n');
  }

  const recIds = records.map(r => r.id);
  const [cells] = await db.execute(
    `SELECT record_id, field_id, value_text, value_num, value_bool, value_json
     FROM cell_values WHERE record_id IN (${recIds.map(() => '?').join(',')})`,
    recIds
  );

  // Build cell map
  const ftype = {};
  fields.forEach(f => { ftype[f.id] = f.type; });
  const cellMap = {};
  cells.forEach(c => {
    if (!cellMap[c.record_id]) cellMap[c.record_id] = {};
    const t = ftype[c.field_id];
    if (t === 'checkbox') cellMap[c.record_id][c.field_id] = c.value_bool ? 'Yes' : 'No';
    else if (t === 'number' || t === 'rating') cellMap[c.record_id][c.field_id] = c.value_num ?? '';
    else if (t === 'multiSelect') {
      try { cellMap[c.record_id][c.field_id] = JSON.parse(c.value_json || '[]').join('; '); }
      catch { cellMap[c.record_id][c.field_id] = c.value_json || ''; }
    }
    else cellMap[c.record_id][c.field_id] = c.value_text ?? '';
  });

  // Build CSV
  const escape = v => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = fields.map(f => escape(f.name)).join(',');
  const dataRows = records.map(r => {
    const cm = cellMap[r.id] || {};
    return fields.map(f => escape(cm[f.id] ?? '')).join(',');
  });

  // Get table name for filename
  const [[tbl]] = await db.execute('SELECT name FROM `tables` WHERE id = ?', [tableId]);
  const filename = (tbl?.name || 'export').replace(/[^a-z0-9]/gi, '-').toLowerCase();

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('\uFEFF' + [header, ...dataRows].join('\n')); // BOM for Excel UTF-8
});

// ── POST /api/tables/:tableId/parse-paste ───────────────────
// Accepts TSV text (from Excel paste), returns preview before import
router.post('/tables/:tableId/parse-paste', auth, canAccessTable, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const parsed = parseTSV(text);
  if (!parsed.length) return res.status(400).json({ error: 'No data found' });

  const headers = parsed[0];
  const rows    = parsed.slice(1).filter(r => r.some(Boolean));

  res.json({ headers, rows, rowCount: rows.length });
});

module.exports = router;
