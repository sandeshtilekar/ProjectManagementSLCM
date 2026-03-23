// ============================================================
//  Ensono DataGrid — Railway migration + connection wait
//  Run from /app/server: node migrate.js
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const config = {
  host:     process.env.MYSQLHOST     || process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  user:     process.env.MYSQLUSER     || process.env.DB_USER     || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASS     || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME     || 'railway',
  multipleStatements: true,
  connectTimeout: 10000,
};

console.log(`→ Connecting to ${config.user}@${config.host}:${config.port}/${config.database}`);

async function waitForMySQL(retries = 30, delay = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await mysql.createConnection({
        host: config.host, port: config.port,
        user: config.user, password: config.password,
        connectTimeout: 5000,
      });
      await conn.end();
      console.log('✓ MySQL is ready');
      return true;
    } catch (e) {
      console.log(`  Attempt ${i}/${retries}... (${e.code || e.message})`);
      if (i === retries) throw new Error('MySQL never became ready');
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function runMigration() {
  const schemaPath = path.join(__dirname, '..', 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    console.log('⚠ schema.sql not found — skipping migration');
    return;
  }

  const conn = await mysql.createConnection(config);
  try {
    let sql = fs.readFileSync(schemaPath, 'utf8')
      .replace(/CREATE DATABASE[^;]+;/gi, '')
      .replace(/USE [^;]+;/gi, '');
    await conn.query(sql);
    console.log('✓ Schema migration complete');
  } catch (e) {
    // IF NOT EXISTS means re-runs are safe — log but don't crash
    if (e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('✓ Schema already exists — skipping');
    } else {
      console.error('Migration warning:', e.message);
    }
  } finally {
    await conn.end();
  }
}

(async () => {
  try {
    await waitForMySQL();
    await runMigration();
    console.log('✓ Database ready');
    process.exit(0);
  } catch (e) {
    console.error('✗ Database setup failed:', e.message);
    process.exit(1);
  }
})();
