// ============================================================
//  Ensono DataGrid — Single-file Railway starter
//  Place at repo ROOT. Set Railway start command to: node start.js
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const log = msg => console.log(`[start] ${msg}`);
const err = msg => console.error(`[start] ${msg}`);

// ── Step 1: Install server deps ──────────────────────────────
log('Installing server dependencies...');
try {
  execSync('npm install', {
    cwd: path.join(__dirname, 'server'),
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });
  log('Server deps installed');
} catch (e) {
  err('npm install failed: ' + e.message);
  process.exit(1);
}

// ── Step 2: Build frontend if needed ────────────────────────
const distPath = path.join(__dirname, 'server', 'client', 'dist');
if (!fs.existsSync(distPath)) {
  log('Building frontend...');
  try {
    execSync('npm install', { cwd: path.join(__dirname, 'client'), stdio: 'inherit' });
    execSync('npm run build', { cwd: path.join(__dirname, 'client'), stdio: 'inherit' });
    log('Frontend built');
  } catch (e) {
    err('Frontend build failed: ' + e.message);
    process.exit(1);
  }
}

// ── Step 3: Load mysql2 (now installed) ──────────────────────
const mysql = require(path.join(__dirname, 'server', 'node_modules', 'mysql2', 'promise'));

// ── Resolve DB config from Railway MySQL plugin vars ─────────
const DB = {
  host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS     || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'railway',
};

// Also try MYSQL_URL if individual vars not present
if (process.env.MYSQL_URL && !process.env.MYSQLHOST) {
  try {
    const u = new URL(process.env.MYSQL_URL);
    DB.host     = u.hostname;
    DB.port     = Number(u.port) || 3306;
    DB.user     = u.username;
    DB.password = decodeURIComponent(u.password);
    DB.database = u.pathname.slice(1);
  } catch {}
}

log(`DB: ${DB.user}@${DB.host}:${DB.port}/${DB.database}`);

// ── Step 4: Wait for MySQL ───────────────────────────────────
async function waitForMySQL(attempts = 30) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const conn = await mysql.createConnection({
        host: DB.host, port: DB.port,
        user: DB.user, password: DB.password,
        connectTimeout: 5000,
      });
      await conn.end();
      log('MySQL is ready ✓');
      return;
    } catch (e) {
      log(`  Attempt ${i}/${attempts}: ${e.code || e.message}`);
      if (i === attempts) throw new Error('MySQL never became ready');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ── Step 5: Run schema migration ─────────────────────────────
async function migrate() {
  const schemaFile = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaFile)) { log('No schema.sql found — skipping'); return; }

  const conn = await mysql.createConnection({ ...DB, multipleStatements: true });
  try {
    let sql = fs.readFileSync(schemaFile, 'utf8')
      .replace(/CREATE DATABASE[^;]+;/gi, '')
      .replace(/USE [^;]+;/gi, '');
    await conn.query(sql);
    log('Schema migration complete ✓');
  } catch (e) {
    log('Migration note: ' + e.message); // non-fatal
  } finally {
    await conn.end();
  }
}

// ── Step 6: Set env defaults then start server ───────────────
async function main() {
  await waitForMySQL();
  await migrate();

  process.env.NODE_ENV   = process.env.NODE_ENV   || 'production';
  process.env.PORT       = process.env.PORT        || '4000';
  process.env.UPLOAD_DIR = process.env.UPLOAD_DIR  || '/tmp/uploads';
  process.env.DB_HOST    = DB.host;
  process.env.DB_PORT    = String(DB.port);
  process.env.DB_USER    = DB.user;
  process.env.DB_PASS    = DB.password;
  process.env.DB_NAME    = DB.database;

  if (!process.env.CLIENT_URL && process.env.RAILWAY_PUBLIC_DOMAIN)
    process.env.CLIENT_URL = 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN;

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
    log('⚠ JWT_SECRET auto-generated — set it in Railway Variables');
  }

  if (!fs.existsSync(process.env.UPLOAD_DIR))
    fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

  log(`Starting server on port ${process.env.PORT}`);

  // Require server directly in this process
  require('./server/index.js');
}

main().catch(e => { err(e.message); process.exit(1); });
