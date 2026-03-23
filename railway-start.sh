#!/usr/bin/env bash
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Ensono DataGrid — Railway startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Map Railway MySQL plugin variables ──
export DB_HOST="${MYSQLHOST:-${DB_HOST:-localhost}}"
export DB_PORT="${MYSQLPORT:-${DB_PORT:-3306}}"
export DB_USER="${MYSQLUSER:-${DB_USER:-root}}"
export DB_PASS="${MYSQLPASSWORD:-${DB_PASS:-}}"
export DB_NAME="${MYSQLDATABASE:-${DB_NAME:-railway}}"

echo "→ DB: $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

# ── Install server deps if missing ──────
cd server && npm install --production && cd ..

# ── Build frontend if dist missing ──────
if [ ! -d "server/client/dist" ]; then
  echo "→ Building frontend..."
  cd client && npm install && npm run build && cd ..
  echo "✓ Frontend built"
fi

# ── Wait for MySQL ──────────────────────
echo "→ Waiting for MySQL..."
for i in $(seq 1 30); do
  if node -e "
    const mysql = require('mysql2');
    const c = mysql.createConnection({
      host:'$DB_HOST',port:$DB_PORT,
      user:'$DB_USER',password:'$DB_PASS'
    });
    c.connect(e=>{process.exit(e?1:0)});
  " 2>/dev/null; then
    echo "✓ MySQL ready"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 2
done

# ── Run schema migration ────────────────
echo "→ Running schema migration..."
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
async function run() {
  const conn = await mysql.createConnection({
    host:'$DB_HOST', port:$DB_PORT,
    user:'$DB_USER', password:'$DB_PASS',
    database:'$DB_NAME', multipleStatements:true
  });
  const sql = fs.readFileSync('schema.sql','utf8')
    .replace(/CREATE DATABASE[^;]+;/gi,'')
    .replace(/USE [^;]+;/gi,'');
  await conn.query(sql);
  await conn.end();
  console.log('✓ Schema migration complete');
}
run().catch(e=>{ console.error('Migration error:', e.message); });
"

# ── Set defaults ────────────────────────
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-4000}"
export UPLOAD_DIR="${UPLOAD_DIR:-/tmp/uploads}"
mkdir -p "$UPLOAD_DIR"

if [ -z "$CLIENT_URL" ] && [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  export CLIENT_URL="https://$RAILWAY_PUBLIC_DOMAIN"
fi
export CLIENT_URL="${CLIENT_URL:-http://localhost:$PORT}"

if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "⚠ JWT_SECRET auto-generated — set it in Railway Variables for stable auth"
fi

echo "→ Starting on port $PORT | URL: $CLIENT_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd server && exec node index.js
