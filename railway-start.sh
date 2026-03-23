#!/usr/bin/env bash
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Ensono DataGrid — Railway startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Install server deps
echo "→ Installing server dependencies..."
cd /app/server
npm install --omit=dev
echo "✓ Server deps installed"

# Step 2: Build frontend if needed
if [ ! -d "/app/server/client/dist" ]; then
  echo "→ Building frontend..."
  cd /app/client && npm install && npm run build
  echo "✓ Frontend built"
fi

# Step 3: Run migration via Node (no shell interpolation issues)
echo "→ Running database setup..."
cd /app/server
node migrate.js

# Step 4: Runtime config
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
  echo "⚠ JWT_SECRET not set in Variables — sessions will reset on redeploy"
fi

echo "→ Port: $PORT | URL: $CLIENT_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 5: Start server
exec node index.js
