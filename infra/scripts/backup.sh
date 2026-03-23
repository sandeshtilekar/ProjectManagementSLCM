#!/usr/bin/env bash
# ============================================================
#  Ensono DataGrid — Automated Backup Script
#  Runs via cron at 02:00 IST (20:30 UTC) daily
#  Retains: 7 daily, 4 weekly, 12 monthly backups
#  Built by Sandesh Tilekar — Ensono India Operations
# ============================================================

set -euo pipefail

# ── Config ───────────────────────────────────────────────────
APP_DIR="/opt/ensono-datagrid"
BACKUP_DIR="$APP_DIR/backups"
LOG_FILE="$APP_DIR/logs/backup.log"
DB_NAME="gridbase"
DB_USER="gridbase_user"
DB_PASS="${GRIDBASE_DB_PASS:-}"        # set in environment or .env
UPLOADS_DIR="$APP_DIR/uploads"
RETAIN_DAILY=7
RETAIN_WEEKLY=4
RETAIN_MONTHLY=12
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DOW=$(date +%u)    # 1=Mon … 7=Sun
DOM=$(date +%d)    # day of month

# Optional: rsync to remote backup server
REMOTE_BACKUP_HOST="${BACKUP_RSYNC_HOST:-}"   # e.g. backup@backup-server.ensono.com
REMOTE_BACKUP_PATH="${BACKUP_RSYNC_PATH:-/backups/ensono-datagrid}"

# ── Helpers ──────────────────────────────────────────────────
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
fail() { log "ERROR: $1"; exit 1; }

mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly}

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Starting Ensono DataGrid backup — $TIMESTAMP"

# ── 1. Database dump ─────────────────────────────────────────
DB_FILE="$BACKUP_DIR/daily/db_${TIMESTAMP}.sql.gz"
log "Dumping database '$DB_NAME'…"

mysqldump \
  --user="$DB_USER" \
  --password="$DB_PASS" \
  --single-transaction \
  --quick \
  --lock-tables=false \
  --routines \
  --events \
  --triggers \
  "$DB_NAME" \
  | gzip -9 > "$DB_FILE"

DB_SIZE=$(du -sh "$DB_FILE" | cut -f1)
log "Database dump complete: $DB_FILE ($DB_SIZE)"

# Verify dump is readable
gunzip -t "$DB_FILE" || fail "Database dump verification failed!"
log "Database dump verified"

# ── 2. Uploads backup ────────────────────────────────────────
UPLOADS_FILE="$BACKUP_DIR/daily/uploads_${TIMESTAMP}.tar.gz"
if [ -d "$UPLOADS_DIR" ] && [ "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  log "Archiving uploads directory…"
  tar -czf "$UPLOADS_FILE" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  UP_SIZE=$(du -sh "$UPLOADS_FILE" | cut -f1)
  log "Uploads archive complete: $UPLOADS_FILE ($UP_SIZE)"
else
  log "Uploads directory empty — skipping archive"
fi

# ── 3. Weekly copy (every Sunday) ────────────────────────────
if [ "$DOW" -eq 7 ]; then
  log "Creating weekly backup copy…"
  cp "$DB_FILE" "$BACKUP_DIR/weekly/db_weekly_${TIMESTAMP}.sql.gz"
  [ -f "$UPLOADS_FILE" ] && \
    cp "$UPLOADS_FILE" "$BACKUP_DIR/weekly/uploads_weekly_${TIMESTAMP}.tar.gz"
  log "Weekly backup created"
fi

# ── 4. Monthly copy (1st of month) ───────────────────────────
if [ "$DOM" -eq "01" ]; then
  log "Creating monthly backup copy…"
  cp "$DB_FILE" "$BACKUP_DIR/monthly/db_monthly_${TIMESTAMP}.sql.gz"
  [ -f "$UPLOADS_FILE" ] && \
    cp "$UPLOADS_FILE" "$BACKUP_DIR/monthly/uploads_monthly_${TIMESTAMP}.tar.gz"
  log "Monthly backup created"
fi

# ── 5. Retention cleanup ─────────────────────────────────────
log "Pruning old backups…"
find "$BACKUP_DIR/daily"   -name "*.gz" -mtime +"$RETAIN_DAILY"   -delete
find "$BACKUP_DIR/weekly"  -name "*.gz" -mtime +$(( RETAIN_WEEKLY  * 7 )) -delete
find "$BACKUP_DIR/monthly" -name "*.gz" -mtime +$(( RETAIN_MONTHLY * 31)) -delete
log "Retention pruning complete"

# ── 6. Remote rsync (if configured) ─────────────────────────
if [ -n "$REMOTE_BACKUP_HOST" ]; then
  log "Syncing to remote backup server: $REMOTE_BACKUP_HOST"
  rsync -avz --delete \
    -e "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10" \
    "$BACKUP_DIR/" \
    "${REMOTE_BACKUP_HOST}:${REMOTE_BACKUP_PATH}/" \
    >> "$LOG_FILE" 2>&1 && log "Remote sync complete" \
    || log "WARNING: Remote sync failed (local backup still intact)"
fi

# ── 7. Disk usage summary ────────────────────────────────────
DISK_USED=$(du -sh "$BACKUP_DIR" | cut -f1)
DISK_FREE=$(df -h "$BACKUP_DIR" | awk 'NR==2{print $4}')
log "Backup directory total: $DISK_USED  |  Free on disk: $DISK_FREE"
log "Backup complete ✓"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
