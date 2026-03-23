#!/usr/bin/env bash
# ============================================================
#  Ensono DataGrid — Health Monitor
#  Runs every 5 minutes via cron
#  Auto-restarts PM2 if API is down; sends Teams/Slack alerts
#  Built by Sandesh Tilekar — Ensono India Operations
# ============================================================

set -uo pipefail

APP_NAME="ensono-datagrid"
HEALTH_URL="http://127.0.0.1:4000/health"
LOG_FILE="/opt/ensono-datagrid/logs/health.log"
ALERT_WEBHOOK="${TEAMS_WEBHOOK_URL:-}"   # paste your Teams/Slack webhook URL
MAX_RESTARTS=3
STATE_FILE="/tmp/ensono-health-state"

log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
alert() {
  local msg="$1"
  log "ALERT: $msg"
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -s -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"🚨 *Ensono DataGrid Alert*: $msg\"}" \
      >/dev/null 2>&1 || true
  fi
}

# ── 1. API health check ──────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 --connect-timeout 5 "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  log "OK — API responding (HTTP $HTTP_CODE)"
  echo "0" > "$STATE_FILE"
  exit 0
fi

# ── 2. API is down — check restart count ─────────────────────
RESTART_COUNT=$(cat "$STATE_FILE" 2>/dev/null || echo "0")
log "WARN — API not responding (HTTP $HTTP_CODE) — restart attempt $((RESTART_COUNT+1))"

if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS" ]; then
  alert "API has been down for $MAX_RESTARTS consecutive checks. Manual intervention required on $(hostname)."
  exit 1
fi

# ── 3. Attempt PM2 restart ───────────────────────────────────
log "Restarting PM2 app: $APP_NAME"
pm2 restart "$APP_NAME" --update-env >> "$LOG_FILE" 2>&1
sleep 8

# ── 4. Verify restart worked ─────────────────────────────────
HTTP_CODE_AFTER=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 --connect-timeout 5 "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE_AFTER" = "200" ]; then
  log "Restart successful — API is back up"
  echo "0" > "$STATE_FILE"
  alert "✅ Ensono DataGrid auto-recovered after restart on $(hostname)."
else
  RESTART_COUNT=$((RESTART_COUNT+1))
  echo "$RESTART_COUNT" > "$STATE_FILE"
  alert "Restart #${RESTART_COUNT} failed — API still not responding on $(hostname). HTTP: $HTTP_CODE_AFTER"
fi

# ── 5. Disk space check ──────────────────────────────────────
DISK_PCT=$(df /opt/ensono-datagrid | awk 'NR==2{gsub("%",""); print $5}')
if [ "$DISK_PCT" -ge 85 ]; then
  alert "Disk usage at ${DISK_PCT}% on $(hostname). Clean up /opt/ensono-datagrid/uploads or expand disk."
fi

# ── 6. MySQL check ───────────────────────────────────────────
if ! mysqladmin ping --silent 2>/dev/null; then
  alert "MySQL is not responding on $(hostname). Check: systemctl status mysql"
fi
