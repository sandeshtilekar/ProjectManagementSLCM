// ============================================================
//  Ensono DataGrid — Ownership & Access Middleware
//  Prevents IDOR: verifies every resource belongs to a
//  workspace the caller is a member of before any mutation.
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const db = require('../db');

/**
 * Resolves which workspaceId owns a given resource.
 * Returns null if not found (caller should 404).
 */
async function resolveWorkspace(entityType, entityId) {
  let sql;
  switch (entityType) {
    case 'workspace':
      return entityId;

    case 'base':
      sql = 'SELECT workspace_id FROM bases WHERE id = ?';
      break;

    case 'table':
      sql = `SELECT b.workspace_id FROM \`tables\` t
             JOIN bases b ON b.id = t.base_id WHERE t.id = ?`;
      break;

    case 'field':
      sql = `SELECT b.workspace_id FROM fields f
             JOIN \`tables\` t ON t.id = f.table_id
             JOIN bases b ON b.id = t.base_id WHERE f.id = ?`;
      break;

    case 'record':
      sql = `SELECT b.workspace_id FROM records r
             JOIN \`tables\` t ON t.id = r.table_id
             JOIN bases b ON b.id = t.base_id WHERE r.id = ?`;
      break;

    case 'attachment':
      sql = `SELECT b.workspace_id FROM attachments a
             JOIN records r ON r.id = a.record_id
             JOIN \`tables\` t ON t.id = r.table_id
             JOIN bases b ON b.id = t.base_id WHERE a.id = ?`;
      break;

    default:
      return null;
  }

  try {
    const [[row]] = await db.execute(sql, [entityId]);
    return row?.workspace_id || null;
  } catch {
    return null;
  }
}

/**
 * Middleware factory — verifies caller is a member (with optional
 * minimum role) of the workspace that owns the target resource.
 *
 * Usage:
 *   router.delete('/records/:recordId',
 *     auth,
 *     ownsResource('record', 'recordId'),
 *     handler
 *   );
 */
const ownsResource = (entityType, paramName, minRoles = []) =>
  async (req, res, next) => {
    const entityId = req.params[paramName];
    if (!entityId)
      return res.status(400).json({ error: 'Resource ID required' });

    const workspaceId = await resolveWorkspace(entityType, entityId);
    if (!workspaceId)
      return res.status(404).json({ error: 'Resource not found' });

    // Check caller membership
    const [rows] = await db.execute(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
      [workspaceId, req.user.id]
    );

    if (!rows.length)
      return res.status(403).json({ error: 'Access denied' });

    if (minRoles.length && !minRoles.includes(rows[0].role))
      return res.status(403).json({ error: `Requires role: ${minRoles.join(' or ')}` });

    req.resolvedWorkspaceId = workspaceId;
    req.memberRole = rows[0].role;
    next();
  };

/**
 * Verify a tableId belongs to a workspace the caller can access.
 * Used before reading/creating records and fields.
 */
const canAccessTable = async (req, res, next) => {
  const tableId = req.params.tableId;
  if (!tableId) return next();

  const workspaceId = await resolveWorkspace('table', tableId);
  if (!workspaceId)
    return res.status(404).json({ error: 'Table not found' });

  const [rows] = await db.execute(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, req.user.id]
  );

  if (!rows.length)
    return res.status(403).json({ error: 'Access denied' });

  req.resolvedWorkspaceId = workspaceId;
  req.memberRole = rows[0].role;
  next();
};

/**
 * Resolves workspace for a base param — used on table creation.
 */
const canAccessBase = async (req, res, next) => {
  const baseId = req.params.baseId;
  if (!baseId) return next();

  const workspaceId = await resolveWorkspace('base', baseId);
  if (!workspaceId)
    return res.status(404).json({ error: 'Base not found' });

  const [rows] = await db.execute(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, req.user.id]
  );

  if (!rows.length)
    return res.status(403).json({ error: 'Access denied' });

  req.resolvedWorkspaceId = workspaceId;
  req.memberRole = rows[0].role;
  next();
};

module.exports = { ownsResource, canAccessTable, canAccessBase, resolveWorkspace };
