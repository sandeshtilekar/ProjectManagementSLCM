# Ensono DataGrid

> Internal SaaS data management platform — built and maintained by Sandesh Tilekar, Ensono India Operations.

Ensono DataGrid is a self-hosted, multi-user database management platform providing Airtable-equivalent capability — Grid, Kanban and Gallery views, real-time collaboration, file attachments, and role-based workspaces — running entirely on Ensono infrastructure.

---

## Repository Structure

```
ensono-datagrid/
├── server/                   # Node.js backend (Express + Socket.io)
│   ├── index.js              # Application entry point
│   ├── db.js                 # MySQL connection pool
│   ├── ecosystem.config.js   # PM2 cluster configuration
│   ├── schema.sql            # Full MySQL schema
│   ├── .env.example          # Environment variable template
│   ├── middleware/
│   │   └── auth.js           # JWT verification + role guard
│   ├── routes/
│   │   ├── auth.js           # Register, login, refresh, logout
│   │   ├── data.js           # Workspaces, bases, tables, fields, records
│   │   └── files.js          # File upload, list, delete
│   └── socket/
│       └── index.js          # Real-time collaboration (Socket.io)
├── client/                   # React 18 frontend (Vite)
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx           # Router + auth guard
│       ├── api/client.js     # Axios + JWT auto-refresh
│       ├── context/store.js  # Zustand global state
│       ├── hooks/useRealtime.js
│       └── pages/
│           ├── LoginPage.jsx
│           ├── RegisterPage.jsx
│           └── AppLayout.jsx
├── infra/                    # All infrastructure config and scripts
│   ├── provision.sh          # One-shot VPS provisioner (run as root)
│   ├── nginx/
│   │   └── ensono-datagrid.conf
│   ├── mysql/
│   │   └── ensono.cnf        # MySQL 8.0 tuned config
│   ├── pm2/
│   │   └── ecosystem.config.js
│   └── scripts/
│       ├── deploy.sh         # Zero-downtime deploy
│       ├── backup.sh         # 3-tier backup with retention
│       └── health-check.sh   # Auto-restart + Teams alerts
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions CI/CD
├── docs/
│   ├── Ensono-DataGrid-BRD-CIO.docx
│   └── Ensono-DataGrid-Deployment-Guide-v2.docx
└── .gitignore
```

---

## Local Development Setup

### Prerequisites
- Node.js v20 LTS
- MySQL 5.7+ or 8.0
- npm 9+

### 1. Clone the repository
```bash
git clone https://github.com/ensono-india/datagrid.git
cd ensono-datagrid
```

### 2. Database
```bash
mysql -u root -p -e "CREATE DATABASE gridbase CHARACTER SET utf8mb4;"
mysql -u root -p gridbase < server/schema.sql
```

### 3. Backend
```bash
cd server
cp .env.example .env
# Edit .env — set DB_PASS, JWT_SECRET (openssl rand -hex 32), etc.
npm install
node index.js
# API running at http://localhost:4000
```

### 4. Frontend
```bash
cd client
npm install
npm run dev
# UI running at http://localhost:3000 (proxied to API)
```

---

## Production Deployment

See `docs/Ensono-DataGrid-Deployment-Guide-v2.docx` for the full guide.

**Quick path on a fresh Ubuntu 22.04 VPS:**

```bash
# 1. Edit config at top of provision.sh (DOMAIN, DB_PASS)
git clone https://github.com/ensono-india/datagrid.git /opt/ensono-datagrid
bash /opt/ensono-datagrid/infra/provision.sh

# 2. Configure environment
cp /opt/ensono-datagrid/server/.env.example /opt/ensono-datagrid/server/.env
nano /opt/ensono-datagrid/server/.env

# 3. Run schema migration
mysql -u gridbase_user -p gridbase < /opt/ensono-datagrid/server/schema.sql

# 4. Build and start
cd /opt/ensono-datagrid/client && npm ci && npm run build
cd /opt/ensono-datagrid/server
su - ensono -c "pm2 start ecosystem.config.js --env production && pm2 save"

# 5. Issue SSL
certbot --nginx -d datagrid.ensono.com
```

---

## Environment Variables

Copy `server/.env.example` to `server/.env` and fill in all values.

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` or `development` |
| `PORT` | API port (default 4000) |
| `CLIENT_URL` | Exact frontend origin for CORS |
| `DB_HOST / DB_USER / DB_PASS / DB_NAME` | MySQL credentials |
| `JWT_SECRET` | Min 64 chars — generate: `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | Access token TTL (default `15m`) |
| `UPLOAD_DIR` | Absolute path for file attachments |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams webhook for health alerts |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Zustand, Axios, Socket.io-client |
| Backend | Node.js 20, Express 4, Socket.io 4 |
| Database | MySQL 8.0 (InnoDB, utf8mb4) |
| Auth | JWT + bcrypt + rotating refresh tokens |
| Process manager | PM2 cluster mode |
| Reverse proxy | Nginx 1.24+ |
| SSL | Let's Encrypt (Certbot) |
| CI/CD | GitHub Actions |

---

## Built By

**Sandesh Tilekar** — Ensono India Operations  
Software Lifecycle Management Team

---

*Confidential — Internal use only. Do not distribute outside Ensono.*
