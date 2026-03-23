// ============================================================
//  Ensono DataGrid — Data Routes (Security-Hardened)
//  Fixes: [CRIT-1] IDOR ownership checks on all mutations
//         [MED-3]  Cell value size cap
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const router  = require('express').Router();
const { nanoid } = require('nanoid');
const db      = require('../db');
const { auth, requireRole }   = require('../middleware/auth');
const { ownsResource, canAccessTable, canAccessBase } = require('../middleware/ownership');

const makeId = () => nanoid(12);
const MAX_CELL_TEXT_LEN = 65535;

// ── WORKSPACES ────────────────────────────────────────────────
router.get('/workspaces', auth, async (req, res) => {
  const [rows] = await db.execute(
    `SELECT w.id, w.name, w.slug, w.plan, wm.role, w.created_at
     FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = ? ORDER BY w.created_at`, [req.user.id]);
  res.json(rows);
});

router.post('/workspaces', auth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const id   = makeId();
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') + '-' + id.slice(0,4);
  await db.execute('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)', [id, name.trim(), slug, req.user.id]);
  await db.execute('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)', [id, req.user.id, 'owner']);
  res.status(201).json({ id, name: name.trim(), slug, role: 'owner' });
});

router.post('/workspaces/:workspaceId/members', auth, requireRole('owner','admin'), async (req, res) => {
  const { email, role = 'editor' } = req.body;
  const VALID_ROLES = ['admin','editor','viewer'];
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const [users] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (!users.length) return res.status(404).json({ error: 'User not found' });
  const [exists] = await db.execute('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?', [req.params.workspaceId, users[0].id]);
  if (exists.length) return res.status(409).json({ error: 'Already a member' });
  await db.execute('INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)', [req.params.workspaceId, users[0].id, role, req.user.id]);
  res.json({ ok: true });
});

// ── BASES ─────────────────────────────────────────────────────
router.get('/workspaces/:workspaceId/bases', auth, requireRole(), async (req, res) => {
  const [rows] = await db.execute('SELECT id, name, color, icon, created_at FROM bases WHERE workspace_id = ? ORDER BY created_at', [req.params.workspaceId]);
  res.json(rows);
});

router.post('/workspaces/:workspaceId/bases', auth, requireRole('owner','admin','editor'), async (req, res) => {
  const { name, color, icon } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const id = makeId();
  await db.execute('INSERT INTO bases (id, workspace_id, name, color, icon, created_by) VALUES (?, ?, ?, ?, ?, ?)', [id, req.params.workspaceId, name.trim(), color||'#E8481C', icon||'E', req.user.id]);
  res.status(201).json({ id, name: name.trim() });
});

// [CRIT-1] ownsResource prevents cross-workspace base deletion
router.delete('/bases/:baseId', auth, ownsResource('base','baseId',['owner','admin']), async (req, res) => {
  await db.execute('DELETE FROM bases WHERE id = ?', [req.params.baseId]);
  res.json({ ok: true });
});

// ── TABLES ────────────────────────────────────────────────────
// [CRIT-1] canAccessBase verifies membership before read/write
router.get('/bases/:baseId/tables', auth, canAccessBase, async (req, res) => {
  const [tables] = await db.execute('SELECT id, name, order_index FROM `tables` WHERE base_id = ? ORDER BY order_index', [req.params.baseId]);
  res.json(tables);
});

router.post('/bases/:baseId/tables', auth, canAccessBase, async (req, res) => {
  if (!['owner','admin','editor'].includes(req.memberRole)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { name } = req.body;
  const id=makeId(), f1=makeId(), f2=makeId();
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const [[{cnt}]] = await conn.execute('SELECT COUNT(*) AS cnt FROM `tables` WHERE base_id = ?', [req.params.baseId]);
    await conn.execute('INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)', [id, req.params.baseId, name||'New Table', cnt]);
    await conn.execute('INSERT INTO fields (id, table_id, name, type, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?)', [f1, id, 'Name', 'text', 0, 1]);
    await conn.execute('INSERT INTO fields (id, table_id, name, type, order_index) VALUES (?, ?, ?, ?, ?)', [f2, id, 'Notes', 'text', 1]);
    await conn.commit();
    res.status(201).json({ id, name: name||'New Table' });
  } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
});

router.patch('/tables/:tableId', auth, ownsResource('table','tableId',['owner','admin','editor']), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  await db.execute('UPDATE `tables` SET name = ? WHERE id = ?', [name.trim(), req.params.tableId]);
  res.json({ ok: true });
});

router.delete('/tables/:tableId', auth, ownsResource('table','tableId',['owner','admin']), async (req, res) => {
  await db.execute('DELETE FROM `tables` WHERE id = ?', [req.params.tableId]);
  res.json({ ok: true });
});

// ── FIELDS ────────────────────────────────────────────────────
const VALID_FIELD_TYPES = ['text','number','singleSelect','multiSelect','date','checkbox','email','url','phone','rating','attachment'];

// [CRIT-1] canAccessTable on all field operations
router.get('/tables/:tableId/fields', auth, canAccessTable, async (req, res) => {
  const [rows] = await db.execute('SELECT id, name, type, options, width, order_index, is_primary FROM fields WHERE table_id = ? ORDER BY order_index', [req.params.tableId]);
  res.json(rows.map(f => ({ ...f, options: f.options ? JSON.parse(f.options) : null })));
});

router.post('/tables/:tableId/fields', auth, canAccessTable, async (req, res) => {
  if (!['owner','admin','editor'].includes(req.memberRole)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { name, type, options, width } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  if (type && !VALID_FIELD_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid field type' });
  const id = makeId();
  const [[{cnt}]] = await db.execute('SELECT COUNT(*) AS cnt FROM fields WHERE table_id = ?', [req.params.tableId]);
  await db.execute('INSERT INTO fields (id, table_id, name, type, options, width, order_index) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, req.params.tableId, name.trim(), type||'text', options?JSON.stringify(options):null, width||150, cnt]);
  res.status(201).json({ id, name: name.trim(), type, options, width });
});

router.patch('/fields/:fieldId', auth, ownsResource('field','fieldId',['owner','admin','editor']), async (req, res) => {
  const { name, options, width } = req.body;
  await db.execute('UPDATE fields SET name = COALESCE(?, name), options = COALESCE(?, options), width = COALESCE(?, width) WHERE id = ?', [name?.trim()||null, options?JSON.stringify(options):null, width||null, req.params.fieldId]);
  res.json({ ok: true });
});

router.delete('/fields/:fieldId', auth, ownsResource('field','fieldId',['owner','admin']), async (req, res) => {
  const [[f]] = await db.execute('SELECT is_primary FROM fields WHERE id = ?', [req.params.fieldId]);
  if (f?.is_primary) return res.status(400).json({ error: 'Cannot delete primary field' });
  await db.execute('DELETE FROM fields WHERE id = ?', [req.params.fieldId]);
  res.json({ ok: true });
});

// ── RECORDS ───────────────────────────────────────────────────
// [CRIT-1] canAccessTable on all record operations
router.get('/tables/:tableId/records', auth, canAccessTable, async (req, res) => {
  const { tableId } = req.params;
  const [fields]  = await db.execute('SELECT id, type FROM fields WHERE table_id = ? ORDER BY order_index', [tableId]);
  const [records] = await db.execute('SELECT id, order_index, created_at FROM records WHERE table_id = ? ORDER BY order_index', [tableId]);
  if (!records.length) return res.json([]);

  const recIds = records.map(r => r.id);
  const [cells] = await db.execute(
    `SELECT record_id, field_id, value_text, value_num, value_bool, value_json FROM cell_values WHERE record_id IN (${recIds.map(()=>'?').join(',')})`, recIds);

  const ftype = {}; fields.forEach(f => { ftype[f.id] = f.type; });
  const cellMap = {};
  cells.forEach(c => {
    if (!cellMap[c.record_id]) cellMap[c.record_id] = {};
    const t = ftype[c.field_id];
    if (t==='checkbox')             cellMap[c.record_id][c.field_id] = !!c.value_bool;
    else if (t==='number'||t==='rating') cellMap[c.record_id][c.field_id] = c.value_num;
    else if (t==='multiSelect')     cellMap[c.record_id][c.field_id] = c.value_json?JSON.parse(c.value_json):[];
    else                            cellMap[c.record_id][c.field_id] = c.value_text;
  });
  res.json(records.map(r => ({ id: r.id, ...(cellMap[r.id]||{}) })));
});

router.post('/tables/:tableId/records', auth, canAccessTable, async (req, res) => {
  if (!['owner','admin','editor'].includes(req.memberRole)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { cells = {} } = req.body;
  const id = makeId();
  const [[{cnt}]] = await db.execute('SELECT COUNT(*) AS cnt FROM records WHERE table_id = ?', [req.params.tableId]);
  await db.execute('INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)', [id, req.params.tableId, cnt, req.user.id]);
  if (Object.keys(cells).length) await _saveCells(id, cells);
  res.status(201).json({ id, ...cells });
});

router.patch('/records/:recordId', auth, ownsResource('record','recordId',['owner','admin','editor']), async (req, res) => {
  const { cells } = req.body;
  if (!cells||typeof cells!=='object') return res.status(400).json({ error: 'cells object required' });
  try {
    await _saveCells(req.params.recordId, cells);
    await db.execute('UPDATE records SET updated_at = NOW() WHERE id = ?', [req.params.recordId]);
    res.json({ ok: true });
  } catch(e) {
    if (e.code==='CELL_TOO_LONG') return res.status(422).json({ error: `Cell value exceeds ${MAX_CELL_TEXT_LEN} characters` });
    throw e;
  }
});

router.delete('/records/:recordId', auth, ownsResource('record','recordId',['owner','admin','editor']), async (req, res) => {
  await db.execute('DELETE FROM records WHERE id = ?', [req.params.recordId]);
  res.json({ ok: true });
});

// ── Cell helper ───────────────────────────────────────────────
async function _saveCells(recordId, cells) {
  const fieldIds = Object.keys(cells);
  if (!fieldIds.length) return;
  const [fields] = await db.execute(`SELECT id, type FROM fields WHERE id IN (${fieldIds.map(()=>'?').join(',')})`, fieldIds);
  const ftype = {}; fields.forEach(f => { ftype[f.id] = f.type; });

  for (const [fieldId, rawVal] of Object.entries(cells)) {
    const t = ftype[fieldId]||'text';
    let vt=null, vn=null, vb=null, vj=null;
    if (t==='checkbox') vb = rawVal?1:0;
    else if (t==='number'||t==='rating') vn = rawVal!==null&&rawVal!==''?Number(rawVal):null;
    else if (t==='multiSelect') vj = JSON.stringify(rawVal||[]);
    else {
      const str = rawVal!==null&&rawVal!==undefined?String(rawVal):null;
      if (str && str.length > MAX_CELL_TEXT_LEN)
        throw Object.assign(new Error('Cell value too long'), { code: 'CELL_TOO_LONG' });
      vt = str;
    }
    await db.execute(
      `INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num), value_bool=VALUES(value_bool), value_json=VALUES(value_json)`,
      [recordId, fieldId, vt, vn, vb, vj]);
  }
}

module.exports = { router, _saveCells };
