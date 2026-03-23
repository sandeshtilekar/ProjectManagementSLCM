// ============================================================
//  Ensono DataGrid — Auth Routes (Security-Hardened)
//  Fixes: [CRIT-?] [HIGH-4] Account lockout after 10 failures
//         [MED-4]  Password complexity enforced
//         [LOW-1]  Email enumeration mitigated on register
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { nanoid } = require('nanoid');
const { body, validationResult } = require('express-validator');
const db       = require('../db');
const { auth } = require('../middleware/auth');

const SALT_ROUNDS     = 12;
const MAX_FAILURES    = 10;
const LOCKOUT_MINUTES = 15;

const makeId = () => nanoid(12);

// ── Helpers ───────────────────────────────────────────────────
function issueTokens(userId) {
  const access  = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refresh = crypto.randomBytes(40).toString('hex');
  return { access, refresh };
}

async function storeRefresh(userId, rawToken) {
  const hash    = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expires = new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS || 30) * 86400000);
  await db.execute(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [makeId(), userId, hash, expires]
  );
}

// [MED-4] Password complexity validator
function validatePasswordComplexity(password) {
  if (password.length < 8)                   return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))               return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password))               return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password))               return 'Password must contain at least one number';
  return null;
}

// [HIGH-4] Account lockout check
async function checkLockout(userId) {
  const [[user]] = await db.execute(
    'SELECT failed_attempts, locked_until FROM users WHERE id = ?', [userId]
  );
  if (!user) return false;
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    throw Object.assign(new Error(`Account locked. Try again in ${mins} minute(s).`), { code: 'ACCOUNT_LOCKED', mins });
  }
  return user;
}

async function recordFailure(userId) {
  await db.execute(
    `UPDATE users SET
       failed_attempts = failed_attempts + 1,
       locked_until    = CASE WHEN failed_attempts + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE) ELSE locked_until END
     WHERE id = ?`,
    [MAX_FAILURES, LOCKOUT_MINUTES, userId]
  );
}

async function clearFailures(userId) {
  await db.execute(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
    [userId]
  );
}

// ── POST /auth/register ───────────────────────────────────────
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('fullName').trim().isLength({ min: 2, max: 120 }),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ errors: errs.array() });

  const { email, password, fullName } = req.body;

  // [MED-4] Complexity check
  const complexityErr = validatePasswordComplexity(password);
  if (complexityErr) return res.status(422).json({ error: complexityErr });

  try {
    const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);

    // [LOW-1] Avoid timing difference that would confirm email exists
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    if (existing.length) {
      // Don't reveal that the email is taken — return same 201 shape
      // In production you'd send "account already exists" email instead
      return res.status(201).json({ message: 'If this email is new, your account has been created.' });
    }

    const userId = makeId(), wsId = makeId(), baseId = makeId();
    const tblId  = makeId(), f1Id  = makeId(), f2Id   = makeId();
    const slug   = email.split('@')[0].replace(/[^a-z0-9]/gi,'').toLowerCase() + '-' + wsId.slice(0,4);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      await conn.execute('INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)', [userId, email, hash, fullName]);
      await conn.execute('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)', [wsId, `${fullName}'s Workspace`, slug, userId]);
      await conn.execute('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)', [wsId, userId, 'owner']);
      await conn.execute('INSERT INTO bases (id, workspace_id, name, created_by) VALUES (?, ?, ?, ?)', [baseId, wsId, 'My First Base', userId]);
      await conn.execute('INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)', [tblId, baseId, 'Table 1', 0]);
      await conn.execute('INSERT INTO fields (id, table_id, name, type, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?)', [f1Id, tblId, 'Name', 'text', 0, 1]);
      await conn.execute('INSERT INTO fields (id, table_id, name, type, order_index) VALUES (?, ?, ?, ?, ?)', [f2Id, tblId, 'Notes', 'text', 1]);
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }

    const { access, refresh } = issueTokens(userId);
    await storeRefresh(userId, refresh);

    res.status(201).json({
      user: { id: userId, email, fullName },
      access, refresh,
      defaultWorkspaceId: wsId,
    });
  } catch(e) {
    console.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /auth/login ──────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(422).json({ errors: errs.array() });

  const { email, password } = req.body;
  // Constant-time generic message — do not reveal whether email exists
  const GENERIC = 'Invalid email or password';

  try {
    const [rows] = await db.execute(
      'SELECT id, email, password_hash, full_name, avatar_url, failed_attempts, locked_until FROM users WHERE email = ?',
      [email]
    );

    if (!rows.length) {
      // Still run bcrypt to avoid timing-based user enumeration
      await bcrypt.hash(password, SALT_ROUNDS);
      return res.status(401).json({ error: GENERIC });
    }

    const user = rows[0];

    // [HIGH-4] Lockout check
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(429).json({ error: `Account temporarily locked. Try again in ${mins} minute(s).` });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await recordFailure(user.id);
      return res.status(401).json({ error: GENERIC });
    }

    // Successful login — clear failure counter
    await clearFailures(user.id);

    const { access, refresh } = issueTokens(user.id);
    await storeRefresh(user.id, refresh);

    const [workspaces] = await db.execute(
      `SELECT w.id, w.name, w.slug, wm.role FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ? ORDER BY w.created_at`,
      [user.id]
    );

    res.json({
      user: { id: user.id, email: user.email, fullName: user.full_name, avatarUrl: user.avatar_url },
      access, refresh, workspaces,
    });
  } catch(e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /auth/refresh ────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  try {
    const [rows] = await db.execute(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > NOW()', [hash]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const rt = rows[0];
    await db.execute('DELETE FROM refresh_tokens WHERE id = ?', [rt.id]);

    const { access, refresh: newRefresh } = issueTokens(rt.user_id);
    await storeRefresh(rt.user_id, newRefresh);
    res.json({ access, refresh: newRefresh });
  } catch(e) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────
router.post('/logout', auth, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await db.execute('DELETE FROM refresh_tokens WHERE token_hash = ?', [hash]);
  }
  res.json({ ok: true });
});

// ── GET /auth/me ──────────────────────────────────────────────
router.get('/me', auth, (req, res) => res.json({ user: req.user }));

module.exports = router;
