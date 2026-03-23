const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:            process.env.DB_HOST || 'localhost',
  port:            Number(process.env.DB_PORT) || 3306,
  user:            process.env.DB_USER,
  password:        process.env.DB_PASS,
  database:        process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit:      0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone:        'Z',
  charset:         'utf8mb4',
});

// Verify on startup
pool.getConnection()
  .then(conn => { console.log('✅ MySQL connected'); conn.release(); })
  .catch(err => { console.error('❌ MySQL connection failed:', err.message); process.exit(1); });

module.exports = pool;
