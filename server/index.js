// ============================================================
//  Ensono DataGrid — Server Entry Point (Railway-hardened)
//  Fixes: trust proxy, optional integrations, correct dist path
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
  console.error('FATAL: CLIENT_URL is required in production.');
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

let setupSocket;
try { setupSocket = require('./socket'); } catch(e) { setupSocket = (io) => {}; }

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGIN = process.env.CLIENT_URL;
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || origin === ALLOWED_ORIGIN) cb(null, true);
    else cb(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, credentials: true },
});
setupSocket(io);

// ── Middleware ───────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Static uploads
const uploadDir = path.resolve(process.env.UPLOAD_DIR || '/tmp/uploads');
const fs = require('fs');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

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
app.use('/api/auth', authRoutes);
app.use('/api',      dataRoutes);
app.use('/api/upload', fileRoutes);

// Integration routes (optional)
try {
  const integrationRoutes = require('./routes/integrations');
  app.use('/api', integrationRoutes);
  console.log('✅ Integration routes loaded');
} catch (e) {
  console.warn('⚠  Integration routes skipped:', e.message);
}

// Sync worker (disabled by default — enable via ENABLE_SYNC_WORKER=true)
if (process.env.ENABLE_SYNC_WORKER === 'true') {
  try {
    const { startSyncWorker } = require('./workers/syncWorker');
    startSyncWorker();
  } catch (e) {
    console.warn('⚠  Sync worker skipped:', e.message);
  }
}

// Health check
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// ONE-TIME RESET ENDPOINT — remove after use
app.get('/reset-my-account', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('Add ?email=your@email.com to the URL');
  try {
    const db = require('./db');
    const [[user]] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.send('User not found — <a href="/">register here</a>');
    await db.execute('SET FOREIGN_KEY_CHECKS = 0');
    await db.execute('DELETE FROM users WHERE email = ?', [email]);
    await db.execute('SET FOREIGN_KEY_CHECKS = 1');
    res.send(`<h2>✅ Account deleted for ${email}</h2><p><a href="/">Click here to register again</a> — you will get all 5 PM tables with sample data.</p>`);
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

// Serve React build
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, 'client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: `File too large. Max ${process.env.MAX_FILE_SIZE_MB || 25}MB.` });
  if (err.message?.startsWith('CORS'))
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Ensono DataGrid running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
