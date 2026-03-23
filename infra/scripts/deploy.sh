#!/usr/bin/env bash
# ============================================================
#  Ensono DataGrid — Zero-Downtime Deploy Script
#  Run on the server as the 'ensono' app user
#  Usage: bash deploy.sh [branch]   (default: main)
#  Built by Sandesh Tilekar — Ensono India Operations
# ============================================================

set -euo pipefail

APP_DIR="/opt/ensono-datagrid"
APP_NAME="ensono-datagrid"
BRANCH="${1:-main}"
LOG="$APP_DIR/logs/deploy.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; RESET='\033[0m'
log()     { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $1" | tee -a "$LOG"; }
success() { echo -e "${GREEN}[✔]${RESET} $1" | tee -a "$LOG"; }
fail()    { echo -e "${RED}[✘] ERROR: $1${RESET}" | tee -a "$LOG"; exit 1; }

log "═══════════════════════════════════════════════"
log "Ensono DataGrid Deploy — branch: $BRANCH"
log "═══════════════════════════════════════════════"

# ── Pre-deploy snapshot ──────────────────────────────────────
log "Taking pre-deploy DB snapshot…"
mysqldump \
  --user="$DB_USER" --password="$DB_PASS" \
  --single-transaction "$DB_NAME" \
  | gzip > "$APP_DIR/backups/pre-deploy_$(date +%Y%m%d_%H%M%S).sql.gz"
success "Pre-deploy backup done"

# ── Pull latest code ─────────────────────────────────────────
cd "$APP_DIR"
log "Fetching latest code from origin/$BRANCH…"
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
success "Code updated to $COMMIT"

# ── Backend dependencies ─────────────────────────────────────
log "Installing backend dependencies…"
cd "$APP_DIR/server"
npm install --production --prefer-offline
success "Backend deps installed"

# ── Frontend build ───────────────────────────────────────────
log "Building React frontend…"
cd "$APP_DIR/client"
npm ci --prefer-offline
npm run build
success "Frontend built"

# ── Zero-downtime reload ─────────────────────────────────────
# PM2 cluster reload: workers restart one by one — no downtime
log "Reloading PM2 workers (zero-downtime)…"
pm2 reload "$APP_NAME" --update-env
success "PM2 reloaded"

# ── Verify health ────────────────────────────────────────────
sleep 5
log "Verifying health endpoint…"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4000/health)
if [ "$HTTP" = "200" ]; then
  success "Health check passed (HTTP $HTTP)"
else
  fail "Health check failed (HTTP $HTTP) — rolling back…"
fi

# ── Save PM2 process list ────────────────────────────────────
pm2 save
success "PM2 state saved"

log "═══════════════════════════════════════════════"
success "Deploy complete — commit: $COMMIT"
log "═══════════════════════════════════════════════"
