// ============================================================
//  Ensono DataGrid — PM Workspace Seed v2
//  Uses db pool directly — no connection passing issues
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const { nanoid } = require('nanoid');
const db = require('./db');
const makeId = () => nanoid(12);

async function createField(tableId, name, type, order, options, isPrimary) {
  const id = makeId();
  await db.execute(
    'INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, tableId, name, type, options ? JSON.stringify(options) : null, order, isPrimary || 0]
  );
  return id;
}

async function createRecord(tableId, userId, order) {
  const id = makeId();
  await db.execute(
    'INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)',
    [id, tableId, order, userId]
  );
  return id;
}

async function setCell(recordId, fieldId, type, value) {
  if (value === null || value === undefined || value === '') return;
  let vt = null, vn = null, vb = null, vj = null;
  if (type === 'checkbox')                         vb = value ? 1 : 0;
  else if (type === 'number' || type === 'rating') vn = Number(value);
  else if (type === 'multiSelect')                 vj = JSON.stringify(value);
  else                                             vt = String(value);
  await db.execute(
    `INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num),
       value_bool=VALUES(value_bool), value_json=VALUES(value_json)`,
    [recordId, fieldId, vt, vn, vb, vj]
  );
}

async function createTable(baseId, name, order) {
  const id = makeId();
  await db.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [id, baseId, name, order]
  );
  return id;
}

async function seedPMWorkspace(wsId, baseId, userId) {
  console.log('→ Seeding PM workspace...');

  // Delete default empty tables
  await db.execute('DELETE FROM `tables` WHERE base_id = ?', [baseId]);

  // ── 1. PROJECT TRACKER ──────────────────────────────────────
  const ptId = await createTable(baseId, '📋 Project Tracker', 0);
  const ptF = {
    name:     await createField(ptId, 'Project Name',  'text',         0, null, 1),
    status:   await createField(ptId, 'Status',        'singleSelect', 1, { options: ['Planning','In Progress','On Hold','Completed','Cancelled'] }),
    priority: await createField(ptId, 'Priority',      'singleSelect', 2, { options: ['Critical','High','Medium','Low'] }),
    owner:    await createField(ptId, 'Owner',         'text',         3),
    dueDate:  await createField(ptId, 'Due Date',      'date',         4),
    progress: await createField(ptId, 'Progress %',    'number',       5),
    category: await createField(ptId, 'Category',      'singleSelect', 6, { options: ['Infrastructure','Migration','Transformation','AI','Compliance','BAU'] }),
  };
  const ptRows = [
    ['Ensono India Platform Modernisation', 'In Progress', 'High',   'Sandesh Tilekar', '2026-06-30', 65, 'Transformation'],
    ['SLM Tooling Consolidation',           'In Progress', 'High',   'Priya Sharma',    '2026-04-15', 40, 'Infrastructure'],
    ['AI/ML Ops Foundation',               'Planning',    'Medium', 'Arjun Mehta',     '2026-07-31', 15, 'AI'],
    ['ITSM Process Harmonisation',         'In Progress', 'High',   'Neha Patel',      '2026-05-31', 55, 'Compliance'],
    ['Cloud Cost Optimisation Q2',         'Planning',    'Medium', 'Vikram Singh',    '2026-06-15', 10, 'Infrastructure'],
    ['ServiceNow Upgrade v8',              'On Hold',     'Low',    'Ravi Kumar',      '2026-08-31', 5,  'BAU'],
    ['DataGrid Internal Platform',         'In Progress', 'High',   'Sandesh Tilekar', '2026-04-30', 80, 'Transformation'],
    ['Ensono Academy — India Cohort',      'Planning',    'Medium', 'Ananya Iyer',     '2026-05-01', 20, 'Compliance'],
  ];
  for (let i = 0; i < ptRows.length; i++) {
    const [name, status, priority, owner, dueDate, progress, category] = ptRows[i];
    const rid = await createRecord(ptId, userId, i);
    await setCell(rid, ptF.name,     'text',         name);
    await setCell(rid, ptF.status,   'singleSelect', status);
    await setCell(rid, ptF.priority, 'singleSelect', priority);
    await setCell(rid, ptF.owner,    'text',         owner);
    await setCell(rid, ptF.dueDate,  'date',         dueDate);
    await setCell(rid, ptF.progress, 'number',       progress);
    await setCell(rid, ptF.category, 'singleSelect', category);
  }
  console.log('  ✓ Project Tracker seeded');

  // ── 2. SPRINT BOARD ─────────────────────────────────────────
  const sbId = await createTable(baseId, '🏃 Sprint Board', 1);
  const sbF = {
    task:   await createField(sbId, 'Task',         'text',         0, null, 1),
    status: await createField(sbId, 'Status',       'singleSelect', 1, { options: ['Backlog','Todo','In Progress','In Review','Done','Blocked'] }),
    assign: await createField(sbId, 'Assignee',     'text',         2),
    points: await createField(sbId, 'Story Points', 'number',       3),
    sprint: await createField(sbId, 'Sprint',       'singleSelect', 4, { options: ['Sprint 1','Sprint 2','Sprint 3','Sprint 4','Backlog'] }),
    epic:   await createField(sbId, 'Epic',         'singleSelect', 5, { options: ['Platform','Integrations','Security','UX','Infrastructure'] }),
    due:    await createField(sbId, 'Due Date',     'date',         6),
  };
  const sbRows = [
    ['Set up Railway production environment',  'Done',        'Sandesh Tilekar', 5,  'Sprint 1', 'Platform',     '2026-03-20'],
    ['Configure MySQL schema migration',       'Done',        'Sandesh Tilekar', 3,  'Sprint 1', 'Platform',     '2026-03-21'],
    ['JWT authentication flow',               'Done',        'Arjun Mehta',     8,  'Sprint 1', 'Security',     '2026-03-22'],
    ['ServiceNow incident integration',       'In Progress', 'Priya Sharma',    13, 'Sprint 2', 'Integrations', '2026-04-05'],
    ['Snowflake export pipeline',             'In Progress', 'Vikram Singh',    13, 'Sprint 2', 'Integrations', '2026-04-08'],
    ['Kanban board view polish',              'Todo',        'Neha Patel',      5,  'Sprint 2', 'UX',           '2026-04-10'],
    ['Role-based permissions UI',            'Todo',        'Ravi Kumar',      8,  'Sprint 2', 'Security',     '2026-04-12'],
    ['Bulk record import from CSV',          'Backlog',     'Ananya Iyer',     8,  'Sprint 3', 'Platform',     '2026-04-25'],
    ['Microsoft Teams notification hook',    'Backlog',     'Arjun Mehta',     5,  'Sprint 3', 'Integrations', '2026-04-28'],
    ['Mobile responsive layout fixes',      'Blocked',     'Neha Patel',      3,  'Sprint 2', 'UX',           '2026-04-15'],
    ['Azure AD SSO integration',            'Backlog',     'Sandesh Tilekar', 13, 'Sprint 4', 'Security',     '2026-05-10'],
    ['Performance dashboard — P95 metrics','Todo',        'Vikram Singh',    5,  'Sprint 3', 'Infrastructure','2026-04-20'],
  ];
  for (let i = 0; i < sbRows.length; i++) {
    const [task, status, assign, points, sprint, epic, due] = sbRows[i];
    const rid = await createRecord(sbId, userId, i);
    await setCell(rid, sbF.task,   'text',         task);
    await setCell(rid, sbF.status, 'singleSelect', status);
    await setCell(rid, sbF.assign, 'text',         assign);
    await setCell(rid, sbF.points, 'number',       points);
    await setCell(rid, sbF.sprint, 'singleSelect', sprint);
    await setCell(rid, sbF.epic,   'singleSelect', epic);
    await setCell(rid, sbF.due,    'date',         due);
  }
  console.log('  ✓ Sprint Board seeded');

  // ── 3. RISK REGISTER ────────────────────────────────────────
  const rrId = await createTable(baseId, '⚠️ Risk Register', 2);
  const rrF = {
    risk:    await createField(rrId, 'Risk',          'text',         0, null, 1),
    cat:     await createField(rrId, 'Category',      'singleSelect', 1, { options: ['Technical','Resource','Schedule','Commercial','Security','Compliance'] }),
    prob:    await createField(rrId, 'Probability',   'singleSelect', 2, { options: ['High','Medium','Low'] }),
    impact:  await createField(rrId, 'Impact',        'singleSelect', 3, { options: ['Critical','High','Medium','Low'] }),
    rating:  await createField(rrId, 'Rating',        'singleSelect', 4, { options: ['Critical','High','Medium','Low'] }),
    status:  await createField(rrId, 'Status',        'singleSelect', 5, { options: ['Open','Mitigated','Accepted','Closed'] }),
    mit:     await createField(rrId, 'Mitigation',    'text',         6),
    owner:   await createField(rrId, 'Owner',         'text',         7),
  };
  const rrRows = [
    ['Key resource dependency on single engineer',         'Resource',   'High',   'High',     'High',   'Open',      'Cross-train 2 engineers; document architecture',    'Sandesh Tilekar'],
    ['Railway free tier credit exhaustion',               'Commercial', 'Medium', 'Medium',   'Medium', 'Open',      'Monitor spend weekly; provision VPS by Sprint 2',   'Sandesh Tilekar'],
    ['ServiceNow API rate limiting during incidents',     'Technical',  'Medium', 'High',     'High',   'Mitigated', 'Implement exponential backoff in syncWorker',        'Priya Sharma'],
    ['Snowflake warehouse costs exceed budget',           'Commercial', 'Low',    'Medium',   'Low',    'Open',      'Use incremental sync; schedule off-peak exports',   'Vikram Singh'],
    ['MySQL data loss on Railway ephemeral storage',      'Technical',  'Low',    'Critical', 'High',   'Mitigated', 'Daily mysqldump backup configured with 7d retention', 'Sandesh Tilekar'],
    ['GDPR compliance gap for EU team member data',       'Compliance', 'Medium', 'High',     'High',   'Open',      'Data residency review; consider EU region deploy',  'Neha Patel'],
    ['Team adoption resistance vs Excel workflow',        'Resource',   'Medium', 'Medium',   'Medium', 'Open',      'Training session; demo migration from Excel tool',  'Sandesh Tilekar'],
    ['JWT_SECRET rotation causing session disruption',    'Technical',  'Low',    'Medium',   'Low',    'Accepted',  'Schedule rotation during 2am window with notice',   'Arjun Mehta'],
  ];
  for (let i = 0; i < rrRows.length; i++) {
    const [risk, cat, prob, impact, rating, status, mit, owner] = rrRows[i];
    const rid = await createRecord(rrId, userId, i);
    await setCell(rid, rrF.risk,   'text',         risk);
    await setCell(rid, rrF.cat,    'singleSelect', cat);
    await setCell(rid, rrF.prob,   'singleSelect', prob);
    await setCell(rid, rrF.impact, 'singleSelect', impact);
    await setCell(rid, rrF.rating, 'singleSelect', rating);
    await setCell(rid, rrF.status, 'singleSelect', status);
    await setCell(rid, rrF.mit,    'text',         mit);
    await setCell(rid, rrF.owner,  'text',         owner);
  }
  console.log('  ✓ Risk Register seeded');

  // ── 4. RAID LOG ─────────────────────────────────────────────
  const rlId = await createTable(baseId, '📌 RAID Log', 3);
  const rlF = {
    item:    await createField(rlId, 'Item',        'text',         0, null, 1),
    type:    await createField(rlId, 'Type',        'singleSelect', 1, { options: ['Risk','Assumption','Issue','Dependency'] }),
    status:  await createField(rlId, 'Status',      'singleSelect', 2, { options: ['Open','In Progress','Resolved','Closed'] }),
    priority:await createField(rlId, 'Priority',    'singleSelect', 3, { options: ['High','Medium','Low'] }),
    owner:   await createField(rlId, 'Owner',       'text',         4),
    due:     await createField(rlId, 'Target Date', 'date',         5),
    notes:   await createField(rlId, 'Notes',       'text',         6),
  };
  const rlRows = [
    ['Assuming Railway supports Node 20 through Q3 2026',         'Assumption', 'Open',        'Medium', 'Sandesh Tilekar', '2026-06-30', 'Verify quarterly; Dockerfile fallback ready'],
    ['VPS must be provisioned before June go-live',               'Dependency', 'In Progress', 'High',   'Vikram Singh',    '2026-05-15', 'Hetzner CX31 shortlisted — 4vCPU 8GB'],
    ['SNOW integration requires ITSM admin approval',             'Dependency', 'Open',        'High',   'Priya Sharma',    '2026-04-20', 'Raised with ITSM team lead 20 Mar 2026'],
    ['Training session not yet scheduled for pilot group',        'Issue',      'Open',        'Medium', 'Sandesh Tilekar', '2026-04-10', 'Need 1hr slot with HR + Delivery leads'],
    ['Snowflake account identifier unclear — prod vs non-prod',   'Issue',      'In Progress', 'High',   'Vikram Singh',    '2026-04-05', 'Checking with Data Platform team'],
    ['File uploads on Railway /tmp — data loss on restart',       'Risk',       'Open',        'High',   'Sandesh Tilekar', '2026-04-08', 'Migrate uploads to S3/R2 in Phase 2'],
    ['All team members have corporate email for registration',    'Assumption', 'Open',        'Low',    'Neha Patel',      '2026-04-01', 'Confirmed with HR — all India staff @ensono.com'],
    ['Browser compatibility testing not fully complete',          'Issue',      'Open',        'Low',    'Ananya Iyer',     '2026-04-15', 'Chrome + Edge confirmed. Safari + Firefox TBD'],
  ];
  for (let i = 0; i < rlRows.length; i++) {
    const [item, type, status, priority, owner, due, notes] = rlRows[i];
    const rid = await createRecord(rlId, userId, i);
    await setCell(rid, rlF.item,     'text',         item);
    await setCell(rid, rlF.type,     'singleSelect', type);
    await setCell(rid, rlF.status,   'singleSelect', status);
    await setCell(rid, rlF.priority, 'singleSelect', priority);
    await setCell(rid, rlF.owner,    'text',         owner);
    await setCell(rid, rlF.due,      'date',         due);
    await setCell(rid, rlF.notes,    'text',         notes);
  }
  console.log('  ✓ RAID Log seeded');

  // ── 5. TEAM DIRECTORY ───────────────────────────────────────
  const tdId = await createTable(baseId, '👥 Team Directory', 4);
  const tdF = {
    name:     await createField(tdId, 'Name',         'text',         0, null, 1),
    role:     await createField(tdId, 'Role',         'text',         1),
    team:     await createField(tdId, 'Team',         'singleSelect', 2, { options: ['SLM','Delivery','Infrastructure','Data Platform','Security','People Ops'] }),
    email:    await createField(tdId, 'Email',        'email',        3),
    avail:    await createField(tdId, 'Availability', 'singleSelect', 4, { options: ['Available','Busy','OOO','Part-time'] }),
    location: await createField(tdId, 'Location',     'singleSelect', 5, { options: ['Pune','Mumbai','Bangalore','Hyderabad','Remote'] }),
  };
  const tdRows = [
    ['Sandesh Tilekar', 'SLM Lead — India Operations',  'SLM',           'sandesh.tilekar@ensono.com', 'Available',  'Pune'],
    ['Priya Sharma',    'Integration Specialist',        'SLM',           'priya.sharma@ensono.com',    'Available',  'Pune'],
    ['Arjun Mehta',     'Senior Software Engineer',      'SLM',           'arjun.mehta@ensono.com',     'Busy',       'Bangalore'],
    ['Neha Patel',      'UX + Frontend Engineer',        'Delivery',      'neha.patel@ensono.com',      'Available',  'Pune'],
    ['Vikram Singh',    'Data Platform Engineer',        'Data Platform', 'vikram.singh@ensono.com',    'Available',  'Mumbai'],
    ['Ravi Kumar',      'Cloud Infrastructure Engineer', 'Infrastructure','ravi.kumar@ensono.com',      'Busy',       'Hyderabad'],
    ['Ananya Iyer',     'People Ops Coordinator',        'People Ops',    'ananya.iyer@ensono.com',     'Available',  'Pune'],
    ['Kavya Reddy',     'Security & Compliance Analyst', 'Security',      'kavya.reddy@ensono.com',     'Part-time',  'Bangalore'],
  ];
  for (let i = 0; i < tdRows.length; i++) {
    const [name, role, team, email, avail, location] = tdRows[i];
    const rid = await createRecord(tdId, userId, i);
    await setCell(rid, tdF.name,     'text',         name);
    await setCell(rid, tdF.role,     'text',         role);
    await setCell(rid, tdF.team,     'singleSelect', team);
    await setCell(rid, tdF.email,    'email',        email);
    await setCell(rid, tdF.avail,    'singleSelect', avail);
    await setCell(rid, tdF.location, 'singleSelect', location);
  }
  console.log('  ✓ Team Directory seeded');
  console.log('✅ PM workspace seed complete');
}

module.exports = { seedPMWorkspace };
