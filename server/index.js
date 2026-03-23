// ============================================================
//  Ensono DataGrid — Server Entry Point (Railway-hardened)
//  Fixes: trust proxy, optional integrations, correct dist path
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
require('dotenv').config();

if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_URL) {
  console.error('FATAL: CLIENT_URL is required in production.');
  process.exit(1);
}

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const authRoutes = require('./routes/auth');
const { router: dataRoutes } = require('./routes/data');
const fileRoutes = require('./routes/files');

let setupSocket;
try { setupSocket = require('./socket'); } catch(e) { setupSocket = (io) => {}; }

const app    = express();
const server = http.createServer(app);

const ALLOWED_ORIGIN = process.env.CLIENT_URL;
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || origin === ALLOWED_ORIGIN) cb(null, true);
    else cb(new Error(`CORS: origin "${origin}" not allowed`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, credentials: true },
});
setupSocket(io);

// ── Middleware ───────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Static uploads
const uploadDir = path.resolve(process.env.UPLOAD_DIR || '/tmp/uploads');
const fs = require('fs');
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

// Rate limiting
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api',      dataRoutes);
app.use('/api/upload', fileRoutes);

// Integration routes (optional)
try {
  const integrationRoutes = require('./routes/integrations');
  app.use('/api', integrationRoutes);
  console.log('✅ Integration routes loaded');
} catch (e) {
  console.warn('⚠  Integration routes skipped:', e.message);
}

// Sync worker (disabled by default — enable via ENABLE_SYNC_WORKER=true)
if (process.env.ENABLE_SYNC_WORKER === 'true') {
  try {
    const { startSyncWorker } = require('./workers/syncWorker');
    startSyncWorker();
  } catch (e) {
    console.warn('⚠  Sync worker skipped:', e.message);
  }
}

// Health check

// ── SEED ENDPOINT — seeds PM tables for existing user ────────
app.get('/run-seed', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('Add ?email=your@email.com');
  try {
    const db = require('./db');
    const [[user]] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.send('User not found');
    const [[workspace]] = await db.execute(
      'SELECT w.id FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = ? LIMIT 1',
      [user.id]
    );
    if (!workspace) return res.send('No workspace found');
    const [[base]] = await db.execute(
      'SELECT id FROM bases WHERE workspace_id = ? LIMIT 1', [workspace.id]
    );
    if (!base) return res.send('No base found');
    const { seedPMWorkspace } = require('./seed');
    await seedPMWorkspace(workspace.id, base.id, user.id);
    res.send('<h2>✅ Seeded! <a href="/">Open the app</a> and refresh.</h2>');
  } catch(e) {
    res.send('<pre>Error: ' + e.stack + '</pre>');
  }
});


// ── SEED ENDPOINT — triggers PM workspace setup directly ─────
app.get('/run-seed', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('<h2>Add ?email=your@email.com to the URL</h2>');
  
  const logs = [];
  const log = (msg) => { logs.push(msg); console.log('[seed]', msg); };

  try {
    const db = require('./db');
    const { nanoid } = require('nanoid');
    const makeId = () => nanoid(12);

    // Find user
    const [[user]] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.send('<h2>User not found. Register first at <a href="/">home</a></h2>');
    log('Found user: ' + user.id);

    // Find their workspace + base
    const [[ws]] = await db.execute('SELECT id FROM workspaces WHERE owner_id = ?', [user.id]);
    if (!ws) return res.send('<h2>No workspace found for this user</h2>');
    log('Found workspace: ' + ws.id);

    const [[base]] = await db.execute('SELECT id FROM bases WHERE workspace_id = ?', [ws.id]);
    if (!base) return res.send('<h2>No base found</h2>');
    log('Found base: ' + base.id);

    // Delete ALL existing tables for clean start
    await db.execute('DELETE FROM `tables` WHERE base_id = ?', [base.id]);
    log('Cleared existing tables');

    // Helper functions
    async function makeTable(name, order) {
      const id = makeId();
      await db.execute('INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)', [id, base.id, name, order]);
      return id;
    }
    async function makeField(tableId, name, type, order, options, isPrimary) {
      const id = makeId();
      await db.execute('INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, tableId, name, type, options ? JSON.stringify(options) : null, order, isPrimary || 0]);
      return id;
    }
    async function makeRecord(tableId, order) {
      const id = makeId();
      await db.execute('INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)', [id, tableId, order, user.id]);
      return id;
    }
    async function cell(recId, fieldId, type, val) {
      if (val === null || val === undefined || val === '') return;
      let vt=null,vn=null,vb=null,vj=null;
      if (type==='number'||type==='rating') vn=Number(val);
      else if (type==='checkbox') vb=val?1:0;
      else if (type==='multiSelect') vj=JSON.stringify(val);
      else vt=String(val);
      await db.execute(
        'INSERT INTO cell_values (record_id,field_id,value_text,value_num,value_bool,value_json) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text),value_num=VALUES(value_num),value_bool=VALUES(value_bool),value_json=VALUES(value_json)',
        [recId,fieldId,vt,vn,vb,vj]);
    }

    // ── PROJECT TRACKER ──
    const ptId = await makeTable('📋 Project Tracker', 0);
    const pf = {
      name: await makeField(ptId,'Project Name','text',0,null,1),
      status: await makeField(ptId,'Status','singleSelect',1,{options:['Planning','In Progress','On Hold','Completed','Cancelled']}),
      priority: await makeField(ptId,'Priority','singleSelect',2,{options:['Critical','High','Medium','Low']}),
      owner: await makeField(ptId,'Owner','text',3),
      due: await makeField(ptId,'Due Date','date',4),
      progress: await makeField(ptId,'Progress %','number',5),
      category: await makeField(ptId,'Category','singleSelect',6,{options:['Infrastructure','Migration','Transformation','AI','Compliance','BAU']}),
    };
    const projects = [
      ['Ensono India Platform Modernisation','In Progress','High','Sandesh Tilekar','2026-06-30',65,'Transformation'],
      ['SLM Tooling Consolidation','In Progress','High','Priya Sharma','2026-04-15',40,'Infrastructure'],
      ['AI/ML Ops Foundation','Planning','Medium','Arjun Mehta','2026-07-31',15,'AI'],
      ['ITSM Process Harmonisation','In Progress','High','Neha Patel','2026-05-31',55,'Compliance'],
      ['Cloud Cost Optimisation Q2','Planning','Medium','Vikram Singh','2026-06-15',10,'Infrastructure'],
      ['ServiceNow Upgrade v8','On Hold','Low','Ravi Kumar','2026-08-31',5,'BAU'],
      ['DataGrid Internal Platform','In Progress','High','Sandesh Tilekar','2026-04-30',80,'Transformation'],
      ['Ensono Academy India Cohort','Planning','Medium','Ananya Iyer','2026-05-01',20,'Compliance'],
    ];
    for(let i=0;i<projects.length;i++){
      const [name,status,priority,owner,due,progress,category]=projects[i];
      const r=await makeRecord(ptId,i);
      await cell(r,pf.name,'text',name); await cell(r,pf.status,'singleSelect',status);
      await cell(r,pf.priority,'singleSelect',priority); await cell(r,pf.owner,'text',owner);
      await cell(r,pf.due,'date',due); await cell(r,pf.progress,'number',progress);
      await cell(r,pf.category,'singleSelect',category);
    }
    log('Project Tracker: 8 rows');

    // ── SPRINT BOARD ──
    const sbId = await makeTable('🏃 Sprint Board', 1);
    const sf = {
      task: await makeField(sbId,'Task','text',0,null,1),
      status: await makeField(sbId,'Status','singleSelect',1,{options:['Backlog','Todo','In Progress','In Review','Done','Blocked']}),
      assign: await makeField(sbId,'Assignee','text',2),
      points: await makeField(sbId,'Story Points','number',3),
      sprint: await makeField(sbId,'Sprint','singleSelect',4,{options:['Sprint 1','Sprint 2','Sprint 3','Sprint 4','Backlog']}),
      epic: await makeField(sbId,'Epic','singleSelect',5,{options:['Platform','Integrations','Security','UX','Infrastructure']}),
    };
    const tasks=[
      ['Set up Railway production','Done','Sandesh Tilekar',5,'Sprint 1','Platform'],
      ['MySQL schema migration','Done','Sandesh Tilekar',3,'Sprint 1','Platform'],
      ['JWT authentication flow','Done','Arjun Mehta',8,'Sprint 1','Security'],
      ['ServiceNow integration','In Progress','Priya Sharma',13,'Sprint 2','Integrations'],
      ['Snowflake export pipeline','In Progress','Vikram Singh',13,'Sprint 2','Integrations'],
      ['Kanban board polish','Todo','Neha Patel',5,'Sprint 2','UX'],
      ['Role-based permissions UI','Todo','Ravi Kumar',8,'Sprint 2','Security'],
      ['CSV bulk import','Backlog','Ananya Iyer',8,'Sprint 3','Platform'],
      ['Teams notification hook','Backlog','Arjun Mehta',5,'Sprint 3','Integrations'],
      ['Mobile responsive fixes','Blocked','Neha Patel',3,'Sprint 2','UX'],
      ['Azure AD SSO','Backlog','Sandesh Tilekar',13,'Sprint 4','Security'],
      ['Performance dashboard','Todo','Vikram Singh',5,'Sprint 3','Infrastructure'],
    ];
    for(let i=0;i<tasks.length;i++){
      const [task,status,assign,points,sprint,epic]=tasks[i];
      const r=await makeRecord(sbId,i);
      await cell(r,sf.task,'text',task); await cell(r,sf.status,'singleSelect',status);
      await cell(r,sf.assign,'text',assign); await cell(r,sf.points,'number',points);
      await cell(r,sf.sprint,'singleSelect',sprint); await cell(r,sf.epic,'singleSelect',epic);
    }
    log('Sprint Board: 12 rows');

    // ── RISK REGISTER ──
    const rrId = await makeTable('⚠️ Risk Register', 2);
    const rf = {
      risk: await makeField(rrId,'Risk','text',0,null,1),
      cat: await makeField(rrId,'Category','singleSelect',1,{options:['Technical','Resource','Commercial','Compliance','Security']}),
      prob: await makeField(rrId,'Probability','singleSelect',2,{options:['High','Medium','Low']}),
      impact: await makeField(rrId,'Impact','singleSelect',3,{options:['Critical','High','Medium','Low']}),
      rating: await makeField(rrId,'Rating','singleSelect',4,{options:['Critical','High','Medium','Low']}),
      status: await makeField(rrId,'Status','singleSelect',5,{options:['Open','Mitigated','Accepted','Closed']}),
      owner: await makeField(rrId,'Owner','text',6),
    };
    const risks=[
      ['Key resource dependency on single engineer','Resource','High','High','High','Open','Sandesh Tilekar'],
      ['Railway free tier credit exhaustion','Commercial','Medium','Medium','Medium','Open','Sandesh Tilekar'],
      ['ServiceNow API rate limiting','Technical','Medium','High','High','Mitigated','Priya Sharma'],
      ['Snowflake warehouse costs exceed budget','Commercial','Low','Medium','Low','Open','Vikram Singh'],
      ['MySQL data loss on ephemeral storage','Technical','Low','Critical','High','Mitigated','Sandesh Tilekar'],
      ['GDPR compliance gap for EU data','Compliance','Medium','High','High','Open','Neha Patel'],
      ['Team adoption vs Excel workflow','Resource','Medium','Medium','Medium','Open','Sandesh Tilekar'],
      ['JWT_SECRET rotation disruption','Technical','Low','Medium','Low','Accepted','Arjun Mehta'],
    ];
    for(let i=0;i<risks.length;i++){
      const [risk,cat,prob,impact,rating,status,owner]=risks[i];
      const r=await makeRecord(rrId,i);
      await cell(r,rf.risk,'text',risk); await cell(r,rf.cat,'singleSelect',cat);
      await cell(r,rf.prob,'singleSelect',prob); await cell(r,rf.impact,'singleSelect',impact);
      await cell(r,rf.rating,'singleSelect',rating); await cell(r,rf.status,'singleSelect',status);
      await cell(r,rf.owner,'text',owner);
    }
    log('Risk Register: 8 rows');

    // ── RAID LOG ──
    const rlId = await makeTable('📌 RAID Log', 3);
    const lf = {
      item: await makeField(rlId,'Item','text',0,null,1),
      type: await makeField(rlId,'Type','singleSelect',1,{options:['Risk','Assumption','Issue','Dependency']}),
      status: await makeField(rlId,'Status','singleSelect',2,{options:['Open','In Progress','Resolved','Closed']}),
      priority: await makeField(rlId,'Priority','singleSelect',3,{options:['High','Medium','Low']}),
      owner: await makeField(rlId,'Owner','text',4),
      due: await makeField(rlId,'Target Date','date',5),
    };
    const raids=[
      ['Assuming Railway supports Node 20 through Q3','Assumption','Open','Medium','Sandesh Tilekar','2026-06-30'],
      ['VPS must be provisioned before June go-live','Dependency','In Progress','High','Vikram Singh','2026-05-15'],
      ['SNOW integration requires ITSM admin approval','Dependency','Open','High','Priya Sharma','2026-04-20'],
      ['Training session not yet scheduled','Issue','Open','Medium','Sandesh Tilekar','2026-04-10'],
      ['Snowflake account identifier unclear','Issue','In Progress','High','Vikram Singh','2026-04-05'],
      ['File uploads on Railway tmp — data loss risk','Risk','Open','High','Sandesh Tilekar','2026-04-08'],
      ['All staff have corporate email for registration','Assumption','Open','Low','Neha Patel','2026-04-01'],
      ['Browser compatibility testing incomplete','Issue','Open','Low','Ananya Iyer','2026-04-15'],
    ];
    for(let i=0;i<raids.length;i++){
      const [item,type,status,priority,owner,due]=raids[i];
      const r=await makeRecord(rlId,i);
      await cell(r,lf.item,'text',item); await cell(r,lf.type,'singleSelect',type);
      await cell(r,lf.status,'singleSelect',status); await cell(r,lf.priority,'singleSelect',priority);
      await cell(r,lf.owner,'text',owner); await cell(r,lf.due,'date',due);
    }
    log('RAID Log: 8 rows');

    // ── TEAM DIRECTORY ──
    const tdId = await makeTable('👥 Team Directory', 4);
    const tf = {
      name: await makeField(tdId,'Name','text',0,null,1),
      role: await makeField(tdId,'Role','text',1),
      team: await makeField(tdId,'Team','singleSelect',2,{options:['SLM','Delivery','Infrastructure','Data Platform','Security','People Ops']}),
      email: await makeField(tdId,'Email','email',3),
      avail: await makeField(tdId,'Availability','singleSelect',4,{options:['Available','Busy','OOO','Part-time']}),
      location: await makeField(tdId,'Location','singleSelect',5,{options:['Pune','Mumbai','Bangalore','Hyderabad','Remote']}),
    };
    const team=[
      ['Sandesh Tilekar','SLM Lead','SLM','sandesh.tilekar@ensono.com','Available','Pune'],
      ['Priya Sharma','Integration Specialist','SLM','priya.sharma@ensono.com','Available','Pune'],
      ['Arjun Mehta','Senior Software Engineer','SLM','arjun.mehta@ensono.com','Busy','Bangalore'],
      ['Neha Patel','UX + Frontend Engineer','Delivery','neha.patel@ensono.com','Available','Pune'],
      ['Vikram Singh','Data Platform Engineer','Data Platform','vikram.singh@ensono.com','Available','Mumbai'],
      ['Ravi Kumar','Cloud Infrastructure Engineer','Infrastructure','ravi.kumar@ensono.com','Busy','Hyderabad'],
      ['Ananya Iyer','People Ops Coordinator','People Ops','ananya.iyer@ensono.com','Available','Pune'],
      ['Kavya Reddy','Security Analyst','Security','kavya.reddy@ensono.com','Part-time','Bangalore'],
    ];
    for(let i=0;i<team.length;i++){
      const [name,role,t,email,avail,location]=team[i];
      const r=await makeRecord(tdId,i);
      await cell(r,tf.name,'text',name); await cell(r,tf.role,'text',role);
      await cell(r,tf.team,'singleSelect',t); await cell(r,tf.email,'email',email);
      await cell(r,tf.avail,'singleSelect',avail); await cell(r,tf.location,'singleSelect',location);
    }
    log('Team Directory: 8 rows');

    res.send('<h2>✅ Done! ' + logs.join('<br>') + '</h2><p><a href="/">Open the app</a> and refresh.</p>');
  } catch(e) {
    res.send('<h2>❌ Error</h2><pre>' + e.stack + '</pre><p>Logs so far:<br>' + logs.join('<br>') + '</p>');
  }
});


// ── RUN MIGRATION ENDPOINT ───────────────────────────────────
app.get('/run-migration', async (req, res) => {
  const db = require('./db');
  const tables = [
    [`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(12) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(120) NOT NULL,
      avatar_url VARCHAR(500) DEFAULT NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      failed_attempts SMALLINT NOT NULL DEFAULT 0,
      locked_until DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_email (email)
    ) ENGINE=InnoDB`, 'users'],
    [`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id VARCHAR(12) NOT NULL,
      user_id VARCHAR(12) NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_token (token_hash)
    ) ENGINE=InnoDB`, 'refresh_tokens'],
    [`CREATE TABLE IF NOT EXISTS workspaces (
      id VARCHAR(12) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(130) NOT NULL,
      owner_id VARCHAR(12) DEFAULT NULL,
      plan ENUM('free','pro','enterprise') NOT NULL DEFAULT 'free',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY uq_slug (slug)
    ) ENGINE=InnoDB`, 'workspaces'],
    [`CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id VARCHAR(12) NOT NULL,
      user_id VARCHAR(12) NOT NULL,
      role ENUM('owner','admin','editor','viewer') NOT NULL DEFAULT 'editor',
      invited_by VARCHAR(12) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, user_id)
    ) ENGINE=InnoDB`, 'workspace_members'],
    [`CREATE TABLE IF NOT EXISTS bases (
      id VARCHAR(12) NOT NULL,
      workspace_id VARCHAR(12) NOT NULL,
      name VARCHAR(120) NOT NULL,
      color VARCHAR(20) DEFAULT '#E8481C',
      icon VARCHAR(10) DEFAULT 'E',
      created_by VARCHAR(12) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'bases'],
    [`CREATE TABLE IF NOT EXISTS \`tables\` (
      id VARCHAR(12) NOT NULL,
      base_id VARCHAR(12) NOT NULL,
      name VARCHAR(120) NOT NULL,
      order_index INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'tables'],
    [`CREATE TABLE IF NOT EXISTS fields (
      id VARCHAR(12) NOT NULL,
      table_id VARCHAR(12) NOT NULL,
      name VARCHAR(120) NOT NULL,
      type ENUM('text','number','singleSelect','multiSelect','date','checkbox','email','url','phone','rating','attachment') NOT NULL DEFAULT 'text',
      options JSON DEFAULT NULL,
      width INT DEFAULT 150,
      order_index INT NOT NULL DEFAULT 0,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'fields'],
    [`CREATE TABLE IF NOT EXISTS records (
      id VARCHAR(12) NOT NULL,
      table_id VARCHAR(12) NOT NULL,
      order_index INT NOT NULL DEFAULT 0,
      created_by VARCHAR(12) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'records'],
    [`CREATE TABLE IF NOT EXISTS cell_values (
      record_id VARCHAR(12) NOT NULL,
      field_id VARCHAR(12) NOT NULL,
      value_text TEXT DEFAULT NULL,
      value_num DOUBLE DEFAULT NULL,
      value_bool TINYINT(1) DEFAULT NULL,
      value_json JSON DEFAULT NULL,
      PRIMARY KEY (record_id, field_id)
    ) ENGINE=InnoDB`, 'cell_values'],
    [`CREATE TABLE IF NOT EXISTS attachments (
      id VARCHAR(12) NOT NULL,
      record_id VARCHAR(12) NOT NULL,
      field_id VARCHAR(12) NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size_bytes INT NOT NULL DEFAULT 0,
      url VARCHAR(500) NOT NULL,
      uploaded_by VARCHAR(12) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'attachments'],
    [`CREATE TABLE IF NOT EXISTS views (
      id VARCHAR(12) NOT NULL,
      table_id VARCHAR(12) NOT NULL,
      name VARCHAR(120) NOT NULL,
      type ENUM('grid','kanban','gallery') NOT NULL DEFAULT 'grid',
      config JSON DEFAULT NULL,
      order_index INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'views'],
    [`CREATE TABLE IF NOT EXISTS activity_log (
      id VARCHAR(12) NOT NULL,
      workspace_id VARCHAR(12) NOT NULL,
      user_id VARCHAR(12) DEFAULT NULL,
      action VARCHAR(80) NOT NULL,
      entity_type VARCHAR(40) DEFAULT NULL,
      entity_id VARCHAR(12) DEFAULT NULL,
      meta JSON DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`, 'activity_log'],
  ];
  const results = [];
  for (const [sql, name] of tables) {
    try {
      await db.execute(sql);
      results.push('✓ ' + name);
    } catch(e) {
      results.push('✗ ' + name + ': ' + e.message);
    }
  }
  res.send('<h2>Migration complete</h2><pre>' + results.join('\n') + '</pre><p><a href="/run-seed?email=' + (req.query.email||'') + '">Now run seed →</a></p>');
});

app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// ONE-TIME RESET ENDPOINT — remove after use
app.get('/reset-my-account', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('Add ?email=your@email.com to the URL');
  try {
    const db = require('./db');
    const [[user]] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (!user) return res.send('User not found — <a href="/">register here</a>');
    await db.execute('SET FOREIGN_KEY_CHECKS = 0');
    await db.execute('DELETE FROM users WHERE email = ?', [email]);
    await db.execute('SET FOREIGN_KEY_CHECKS = 1');
    res.send(`<h2>✅ Account deleted for ${email}</h2><p><a href="/">Click here to register again</a> — you will get all 5 PM tables with sample data.</p>`);
  } catch(e) {
    res.send('Error: ' + e.message);
  }
});

// Serve React build
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, 'client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ error: `File too large. Max ${process.env.MAX_FILE_SIZE_MB || 25}MB.` });
  if (err.message?.startsWith('CORS'))
    return res.status(403).json({ error: 'Cross-origin request blocked' });
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Ensono DataGrid running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
