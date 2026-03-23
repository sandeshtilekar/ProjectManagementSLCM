// ============================================================
//  Ensono DataGrid — PM2 Ecosystem Config
//  File: /opt/ensono-datagrid/server/ecosystem.config.js
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================

module.exports = {
  apps: [
    {
      name:         'ensono-datagrid',
      script:       './index.js',
      cwd:          '/opt/ensono-datagrid/server',

      // ── Clustering ──────────────────────────────────────
      // 'max' = one worker per CPU core — maximises throughput
      instances:    'max',
      exec_mode:    'cluster',

      // ── Environment ─────────────────────────────────────
      env_production: {
        NODE_ENV:    'production',
        PORT:        4000,
      },

      // ── Memory & Restarts ────────────────────────────────
      max_memory_restart: '512M',   // restart a worker if it leaks
      min_uptime:         '10s',    // don't count crashes in first 10s
      max_restarts:       10,       // give up after 10 rapid crashes
      restart_delay:      4000,     // wait 4s between restarts

      // ── Graceful shutdown ────────────────────────────────
      // Allows in-flight requests to finish before stopping
      kill_timeout:       8000,
      wait_ready:         true,
      listen_timeout:     10000,

      // ── Logging ─────────────────────────────────────────
      log_file:       '/opt/ensono-datagrid/logs/app-combined.log',
      out_file:       '/opt/ensono-datagrid/logs/app-out.log',
      error_file:     '/opt/ensono-datagrid/logs/app-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs:     true,

      // ── Watch (disabled in prod) ─────────────────────────
      watch:          false,

      // ── Startup behaviour ────────────────────────────────
      autorestart:    true,
      node_args:      '--max-old-space-size=460',
    },
  ],

  // ── Deploy config (optional — if using pm2 deploy) ─────────
  deploy: {
    production: {
      user:         'ensono',
      host:         'datagrid.ensono.com',
      ref:          'origin/main',
      repo:         'git@github.com:ensono-india/datagrid.git',
      path:         '/opt/ensono-datagrid',
      'pre-deploy-local': '',
      'post-deploy':
        'cd server && npm install --production && ' +
        'cd ../client && npm ci && npm run build && ' +
        'cd ../server && pm2 reload ecosystem.config.js --env production',
      'pre-setup':  '',
      env: {
        NODE_ENV: 'production',
      },
    },
  },
};
