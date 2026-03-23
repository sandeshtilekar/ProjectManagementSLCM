// ============================================================
//  Ensono DataGrid — Socket.io (Security-Hardened)
//  Fixes: [CRIT-2] Table access verified before join
//         [HIGH-3] Cell updates persisted to DB
//         [MED-2]  Per-socket event rate limiting
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const jwt = require('jsonwebtoken');
const db  = require('../db');
const { resolveWorkspace } = require('../middleware/ownership');
const { _saveCells } = require('../routes/data');

// [MED-2] Simple token-bucket rate limiter per socket
class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity  = capacity;
    this.tokens    = capacity;
    this.refill    = refillPerSecond;
    this.lastCheck = Date.now();
  }
  consume() {
    const now      = Date.now();
    const elapsed  = (now - this.lastCheck) / 1000;
    this.tokens    = Math.min(this.capacity, this.tokens + elapsed * this.refill);
    this.lastCheck = now;
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

module.exports = function setupSocket(io) {
  // ── JWT auth middleware ─────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) throw new Error('No token');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    // Load user once on connect
    let user = null;
    try {
      const [rows] = await db.execute(
        'SELECT id, full_name, avatar_url FROM users WHERE id = ?', [socket.userId]
      );
      user = rows[0] || null;
    } catch {}

    if (!user) { socket.disconnect(true); return; }
    socket.user = user;

    // [MED-2] Rate limiter: 20 cell updates/second per socket
    const cellBucket = new TokenBucket(20, 20);

    // ── join:table ─────────────────────────────────────────────
    socket.on('join:table', async ({ tableId }) => {
      if (!tableId || typeof tableId !== 'string') return;

      try {
        // [CRIT-2] Verify the user belongs to the workspace owning this table
        const workspaceId = await resolveWorkspace('table', tableId);
        if (!workspaceId) return socket.emit('error', { message: 'Table not found' });

        const [rows] = await db.execute(
          'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
          [workspaceId, user.id]
        );
        if (!rows.length) return socket.emit('error', { message: 'Access denied' });

        const room = `table:${tableId}`;
        socket.join(room);

        socket.to(room).emit('presence:join', {
          userId:    user.id,
          userName:  user.full_name,
          avatarUrl: user.avatar_url,
          tableId,
        });

        const clients       = await io.in(room).fetchSockets();
        const collaborators = clients
          .filter(s => s.id !== socket.id && s.user)
          .map(s => ({ userId: s.user.id, userName: s.user.full_name, avatarUrl: s.user.avatar_url }));
        socket.emit('presence:current', collaborators);
      } catch(e) {
        socket.emit('error', { message: 'Failed to join table' });
      }
    });

    // ── leave:table ────────────────────────────────────────────
    socket.on('leave:table', ({ tableId }) => {
      if (!tableId || typeof tableId !== 'string') return;
      const room = `table:${tableId}`;
      socket.leave(room);
      socket.to(room).emit('presence:leave', { userId: user.id, tableId });
    });

    // ── cell:update ────────────────────────────────────────────
    socket.on('cell:update', async ({ recordId, fieldId, value, tableId }) => {
      if (!recordId || !fieldId || !tableId) return;
      if (typeof recordId !== 'string' || typeof fieldId !== 'string') return;

      // [MED-2] Rate limit check
      if (!cellBucket.consume()) {
        return socket.emit('error', { message: 'Too many updates. Slow down.' });
      }

      try {
        // [CRIT-2] Verify user can write to this table before persisting or broadcasting
        const workspaceId = await resolveWorkspace('table', tableId);
        if (!workspaceId) return;
        const [rows] = await db.execute(
          'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
          [workspaceId, user.id]
        );
        if (!rows.length) return;
        if (!['owner','admin','editor'].includes(rows[0].role)) return;

        // [HIGH-3] Persist the cell update to the database
        await _saveCells(recordId, { [fieldId]: value });
        await db.execute('UPDATE records SET updated_at = NOW() WHERE id = ?', [recordId]);

        // Broadcast to everyone in the room (including sender for confirmation)
        io.to(`table:${tableId}`).emit('cell:updated', {
          recordId, fieldId, value,
          userId:   user.id,
          userName: user.full_name,
        });
      } catch(e) {
        socket.emit('error', { message: 'Update failed' });
      }
    });

    // ── disconnect ─────────────────────────────────────────────
    socket.on('disconnect', () => {
      socket.rooms.forEach(room => {
        if (room.startsWith('table:')) {
          const tableId = room.replace('table:', '');
          socket.to(room).emit('presence:leave', { userId: user.id, tableId });
        }
      });
    });
  });
};
