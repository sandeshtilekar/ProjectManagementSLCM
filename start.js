// ============================================================
//  Ensono DataGrid — Railway entry point v4
//  Does migration then requires server directly (no spawn)
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

// ── Map Railway MySQL variables ───────────────────────────────
process.env.DB_HOST = process.env.MYSQLHOST     || process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.MYSQLPORT     || process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.MYSQLUSER     || process.env.DB_USER || 'root';
process.env.DB_PASS = process.env.MYSQLPASSWORD || process.env.DB_PASS || '';
process.env.DB_NAME = process.env.MYSQLDATABASE || process.env.DB_NAME || 'railway';

// ── Other defaults ────────────────────────────────────────────
process.env.NODE_ENV   = process.env.NODE_ENV   || 'production';
process.env.PORT       = process.env.PORT       || '4000';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';

if (!process.env.CLIENT_URL && process.env.RAILWAY_PUBLIC_DOMAIN)
  process.env.CLIENT_URL = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
if (!process.env.CLIENT_URL)
  process.env.CLIENT_URL = `http://localhost:${process.env.PORT}`;

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
  console.warn('⚠  JWT_SECRET not set — add it in Railway Variables');
}

fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' Ensono DataGrid — starting up');
console.log(`→ DB:  ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
console.log(`→ URL: ${process.env.CLIENT_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const cfg = {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT),
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectTimeout: 8000,
};

async function waitForMySQL(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      const c = await mysql.createConnection({ ...cfg, database: undefined });
      await c.end();
      console.log('✓ MySQL is ready');
      return;
    } catch (e) {
      console.log(`  MySQL attempt ${i}/${retries}: ${e.code || e.message}`);
      if (i === retries) throw new Error('MySQL unavailable after ' + retries + ' attempts');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function migrate() {
  const f = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(f)) { console.log('⚠  schema.sql not found'); return; }
  let conn;
  try {
    conn = await mysql.createConnection({ ...cfg, multipleStatements: true });
    let sql = fs.readFileSync(f, 'utf8')
      .replace(/CREATE DATABASE[^;]+;/gi, '')
      .replace(/USE [^;]+;/gi, '');
    await conn.query(sql);
    console.log('✓ Schema migration complete');
  } catch (e) {
    console.log('✓ Schema note:', e.code === 'ER_TABLE_EXISTS_ERROR' ? 'tables already exist' : e.message);
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

(async () => {
  try {
    await waitForMySQL();
    await migrate();
    console.log('→ Loading server...');
    // Require server directly — this process becomes the server
    // Railway keeps it alive because the HTTP server holds the event loop open
    require('./server/index.js');
  } catch (e) {
    console.error('✗ Startup failed:', e.message);
    process.exit(1);
  }
})();
