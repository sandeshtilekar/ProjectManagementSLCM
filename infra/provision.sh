#!/usr/bin/env bash
# ============================================================
#  Ensono DataGrid — Master VPS Provisioner
#  Run once on a fresh Ubuntu 22.04 LTS VPS as root
#
#  Usage:
#    wget -O provision.sh https://your-repo/infra/provision.sh
#    chmod +x provision.sh
#    bash provision.sh
#
#  Built by Sandesh Tilekar — Ensono India Operations
# ============================================================

set -euo pipefail
IFS=$'\n\t'

# ── CONFIGURATION — edit before running ─────────────────────
APP_USER="ensono"
APP_DIR="/opt/ensono-datagrid"
DOMAIN="datagrid.ensono.com"         # Your actual domain
DB_NAME="gridbase"
DB_USER="gridbase_user"
DB_PASS=""                            # Set a strong password here
NODE_VERSION="20"
SWAP_SIZE="2G"
TZ="Asia/Kolkata"

# ── COLOURS ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${GREEN}[✔]${RESET} $1"; }
info() { echo -e "${CYAN}[→]${RESET} $1"; }
warn() { echo -e "${YELLOW}[!]${RESET} $1"; }
fail() { echo -e "${RED}[✘]${RESET} $1"; exit 1; }

# ── PRE-FLIGHT ───────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || fail "Run as root"
[ -n "$DB_PASS" ]    || fail "Set DB_PASS before running"
[ -n "$DOMAIN" ]     || fail "Set DOMAIN before running"

echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Ensono DataGrid — VPS Provisioner"
echo -e "  Domain  : $DOMAIN"
echo -e "  App dir : $APP_DIR"
echo -e "  Node.js : v$NODE_VERSION LTS"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

# ── 1. SYSTEM BASELINE ───────────────────────────────────────
info "Setting timezone and updating system packages…"
timedatectl set-timezone "$TZ"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip build-essential \
  ufw fail2ban logrotate rsync \
  ca-certificates gnupg lsb-release \
  htop iotop ncdu tree jq \
  software-properties-common apt-transport-https
log "System packages installed"

# ── 2. SWAP ──────────────────────────────────────────────────
if [ ! -f /swapfile ]; then
  info "Creating ${SWAP_SIZE} swap…"
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap  /swapfile
  swapon  /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Tune swappiness for a server
  echo 'vm.swappiness=10'          >> /etc/sysctl.conf
  echo 'vm.vfs_cache_pressure=50'  >> /etc/sysctl.conf
  sysctl -p
  log "Swap created"
fi

# ── 3. APP USER ──────────────────────────────────────────────
info "Creating app user: $APP_USER"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi
# Allow app user to reload nginx without root password
echo "$APP_USER ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx, /bin/systemctl restart nginx" \
  > /etc/sudoers.d/ensono-nginx
log "App user ready"

# ── 4. NODE.JS ───────────────────────────────────────────────
info "Installing Node.js $NODE_VERSION LTS…"
if ! command -v node &>/dev/null || [[ $(node -v) != v${NODE_VERSION}* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2 --quiet
log "Node.js $(node -v) and PM2 $(pm2 -v) installed"

# ── 5. MYSQL 8.0 ─────────────────────────────────────────────
info "Installing MySQL 8.0…"
if ! command -v mysql &>/dev/null; then
  apt-get install -y mysql-server
  systemctl enable mysql
  systemctl start  mysql
fi

info "Creating database and user…"
mysql --user=root <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME}
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost'
  IDENTIFIED WITH mysql_native_password BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# Copy our hardened my.cnf
cp /opt/ensono-datagrid/infra/mysql/ensono.cnf \
   /etc/mysql/mysql.conf.d/ensono.cnf 2>/dev/null || true
systemctl restart mysql
log "MySQL 8.0 ready"

# ── 6. NGINX ─────────────────────────────────────────────────
info "Installing Nginx…"
apt-get install -y nginx
systemctl enable nginx

# Copy site config
cp "$APP_DIR/infra/nginx/ensono-datagrid.conf" \
   /etc/nginx/sites-available/ensono-datagrid
ln -sf /etc/nginx/sites-available/ensono-datagrid \
        /etc/nginx/sites-enabled/ensono-datagrid
rm -f  /etc/nginx/sites-enabled/default

# Tune nginx worker processes
sed -i "s/worker_processes auto/worker_processes $(nproc)/" \
  /etc/nginx/nginx.conf

nginx -t && systemctl reload nginx
log "Nginx installed"

# ── 7. SSL (Let's Encrypt) ───────────────────────────────────
info "Installing Certbot…"
apt-get install -y certbot python3-certbot-nginx

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  warn "SSL: run manually after DNS propagates:"
  warn "  certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@ensono.com"
else
  certbot --nginx -d "$DOMAIN" --non-interactive \
    --agree-tos -m "admin@ensono.com" --redirect
  log "SSL certificate issued"
fi

# ── 8. FIREWALL ──────────────────────────────────────────────
info "Configuring UFW firewall…"
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
log "Firewall active"

# ── 9. FAIL2BAN ──────────────────────────────────────────────
info "Configuring Fail2ban…"
cp "$APP_DIR/infra/security/fail2ban-jail.local" \
   /etc/fail2ban/jail.local 2>/dev/null || cat > /etc/fail2ban/jail.local <<'F2B'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled = true
filter  = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 10
F2B
systemctl enable fail2ban
systemctl restart fail2ban
log "Fail2ban active"

# ── 10. DIRECTORIES & PERMISSIONS ───────────────────────────
info "Setting up application directories…"
mkdir -p "$APP_DIR"/{uploads,logs,backups}
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"/uploads
chmod 750 "$APP_DIR"/backups
log "Directories ready"

# ── 11. LOG ROTATION ─────────────────────────────────────────
cat > /etc/logrotate.d/ensono-datagrid <<LOGROTATE
$APP_DIR/logs/*.log {
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  sharedscripts
  postrotate
    pm2 reloadLogs 2>/dev/null || true
  endscript
}
LOGROTATE
log "Log rotation configured"

# ── 12. BACKUP CRON ──────────────────────────────────────────
cp "$APP_DIR/infra/scripts/backup.sh" /usr/local/bin/ensono-backup
chmod +x /usr/local/bin/ensono-backup

cat > /etc/cron.d/ensono-datagrid <<CRON
# Ensono DataGrid — daily backup at 02:00 IST
0 20 * * * root /usr/local/bin/ensono-backup >> $APP_DIR/logs/backup.log 2>&1
# Health check every 5 minutes
*/5 * * * * root $APP_DIR/infra/scripts/health-check.sh >> $APP_DIR/logs/health.log 2>&1
CRON
log "Backup cron installed"

# ── 13. PM2 STARTUP ──────────────────────────────────────────
info "Configuring PM2 startup…"
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" \
  --hp "/home/$APP_USER" | tail -1 | bash || true
log "PM2 startup configured"

# ── 14. KERNEL TUNING ────────────────────────────────────────
info "Applying kernel network tuning…"
cat >> /etc/sysctl.conf <<SYSCTL
# Ensono DataGrid — network tuning
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_keepalive_intvl = 15
fs.file-max = 500000
SYSCTL
sysctl -p
log "Kernel tuning applied"

# ── 15. SYSTEM LIMITS ────────────────────────────────────────
cat >> /etc/security/limits.conf <<LIMITS
$APP_USER soft nofile 65535
$APP_USER hard nofile 65535
root      soft nofile 65535
root      hard nofile 65535
LIMITS
log "File descriptor limits set"

# ── SUMMARY ──────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Provisioning complete!"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${CYAN}Next steps:${RESET}"
echo -e "  1. Copy your code:   rsync -avz ./server $APP_USER@$DOMAIN:$APP_DIR/"
echo -e "  2. Copy .env:        scp .env $APP_USER@$DOMAIN:$APP_DIR/server/"
echo -e "  3. Run migration:    mysql -u $DB_USER -p $DB_NAME < schema.sql"
echo -e "  4. Start app:        su - $APP_USER -c 'cd $APP_DIR/server && pm2 start ecosystem.config.js'"
echo -e "  5. Issue SSL:        certbot --nginx -d $DOMAIN"
echo -e "  6. Save PM2:         su - $APP_USER -c 'pm2 save'"
echo ""
echo -e "  ${GREEN}Health check:${RESET} curl https://$DOMAIN/health"
echo ""
