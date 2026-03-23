// ============================================================
//  Ensono DataGrid — Server Entry Point (Security-Hardened)
//  Fixes: [HIGH-2] CORS never falls back to wildcard (*)
//         [LOW-2]  CSP owned by Helmet only (not dual-set)
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

require('dotenv').config();

// [HIGH-2] Fail-safe: refuse to start in production without CLIENT_URL
if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
  console.error('FATAL: CLIENT_URL environment variable is required in production.');
  console.error('Set CLIENT_URL=https://yourdomain.com in your .env file.');
  process.exit(1);
}

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes = require('./routes/auth');
const { router: dataRoutes } = require('./routes/data');
const fileRoutes = require('./routes/files');
const setupSocket = require('./socket');

const app    = express();
const server = http.createServer(app);

// [HIGH-2] CORS — strict, no wildcard fallback
const ALLOWED_ORIGIN = process.env.CLIENT_URL;
const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server (no origin) and the exact CLIENT_URL
    if (!origin || origin === ALLOWED_ORIGIN) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  credentials: true,
};

// ── Socket.io ────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,    // [HIGH-2] No fallback to *
    credentials: true,
  },
});
setupSocket(io);

// ── Middleware ───────────────────────────────────────────────
// [LOW-2] Helmet owns all security headers including CSP — Nginx config has CSP removed
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:   ["'self'"],
      scriptSrc:    ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      styleSrc:     ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'fonts.gstatic.com'],
      fontSrc:      ["'self'", 'fonts.gstatic.com', 'data:'],
      imgSrc:       ["'self'", 'data:', 'blob:'],
      connectSrc:   ["'self'", `wss://${(ALLOWED_ORIGIN||'').replace(/^https?:\/\//,'')}`,
                               `ws://${(ALLOWED_ORIGIN||'').replace(/^https?:\/\//,'')}`],
      objectSrc:    ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
}));

app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Serve uploaded files — same-site only, no inline execution
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
app.use('/uploads', (req, res, next) => {
  // Force download for potentially dangerous file types
  const ext = path.extname(req.path).toLowerCase();
  const forceDownload = ['.pdf', '.zip', '.csv', '.txt', '.xlsx', '.docx'];
  if (forceDownload.includes(ext)) {
    res.setHeader('Content-Disposition', 'attachment');
  }
  next();
}, express.static(uploadDir, { index: false, dotfiles: 'deny' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth',   authRoutes);
app.use('/api',        dataRoutes);
app.use('/api/upload', fileRoutes);


// ── ONE-TIME RESET ENDPOINT (remove after use) ───────────────
app.get('/reset-my-account', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('Add ?email=your@email.com to the URL');
  try {
    const db = require('./db');
    const [[user]] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.send('User not found — register at the home page');
    await db.execute('DELETE FROM users WHERE email = ?', [email]);
    res.send(`
      <h2>✅ Account deleted for ${email}</h2>
      <p>Now <a href="/">click here to register again</a> — you will get the full PM workspace with 5 tables and sample data.</p>
    `);
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// ── Integration routes (ServiceNow + Snowflake) ──────────────
try {
  const integrationRoutes = require('./routes/integrations');
  app.use('/api', integrationRoutes);
  console.log('✅ Integration routes loaded');
} catch (e) {
  console.warn('⚠  Integration routes skipped:', e.message);
}

// ── Sync worker disabled — enable after integration tables exist
// Set ENABLE_SYNC_WORKER=true in Railway Variables to activate
if (process.env.ENABLE_SYNC_WORKER === 'true') {
  try {
    const { startSyncWorker } = require('./workers/syncWorker');
    startSyncWorker();
  } catch (e) {
    console.warn('⚠  Sync worker skipped:', e.message);
  }
}

// Serve React in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, 'client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: `File too large. Max ${process.env.MAX_FILE_SIZE_MB || 25}MB.` });
  if (err.code === 'CELL_TOO_LONG')
    return res.status(422).json({ error: 'Cell value exceeds maximum length' });
  if (err.message?.startsWith('CORS'))
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  console.error('[server error]', err.message);
  // [PROD] Never leak stack traces in production
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Ensono DataGrid running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
