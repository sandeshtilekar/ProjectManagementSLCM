const jwt = require('jsonwebtoken');
const db  = require('../db');

// Verify JWT and attach req.user
const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });

    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Light DB check — only verify user still exists
    const [rows] = await db.execute(
      'SELECT id, email, full_name, avatar_url FROM users WHERE id = ?',
      [payload.sub]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'User not found' });

    req.user = rows[0];
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Check workspace membership + role
const requireRole = (...roles) => async (req, res, next) => {
  const wsId = req.params.workspaceId || req.body.workspaceId;
  if (!wsId) return res.status(400).json({ error: 'Workspace ID required' });

  const [rows] = await db.execute(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [wsId, req.user.id]
  );
  if (!rows.length)
    return res.status(403).json({ error: 'Not a workspace member' });

  if (roles.length && !roles.includes(rows[0].role))
    return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });

  req.memberRole = rows[0].role;
  next();
};

module.exports = { auth, requireRole };
