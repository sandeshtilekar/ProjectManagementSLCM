// ============================================================
//  Ensono DataGrid — Project Management Workspace Seed
//  Auto-creates 5 PM tables with fields + sample data
//  Called after user registration
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const { nanoid } = require('nanoid');
const makeId = () => nanoid(12);

// ── Helpers ───────────────────────────────────────────────────
async function createField(conn, tableId, name, type, order, options = null, isPrimary = 0) {
  const id = makeId();
  await conn.execute(
    'INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, tableId, name, type, options ? JSON.stringify(options) : null, order, isPrimary]
  );
  return id;
}

async function createRecord(conn, tableId, userId, order) {
  const id = makeId();
  await conn.execute(
    'INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)',
    [id, tableId, order, userId]
  );
  return id;
}

async function setCell(conn, recordId, fieldId, type, value) {
  if (value === null || value === undefined) return;
  let vt = null, vn = null, vb = null, vj = null;
  if (type === 'checkbox')                       vb = value ? 1 : 0;
  else if (type === 'number' || type === 'rating') vn = Number(value);
  else if (type === 'multiSelect')               vj = JSON.stringify(value);
  else                                           vt = String(value);

  await conn.execute(
    `INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num),
       value_bool=VALUES(value_bool), value_json=VALUES(value_json)`,
    [recordId, fieldId, vt, vn, vb, vj]
  );
}

// ── Main seed function ────────────────────────────────────────
async function seedPMWorkspace(conn, workspaceId, baseId, userId) {
  console.log('→ Seeding PM workspace templates...');

  // ── 1. PROJECT TRACKER ──────────────────────────────────────
  const ptId = makeId();
  await conn.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [ptId, baseId, '📋 Project Tracker', 0]
  );
  const pt = {
    name:     await createField(conn, ptId, 'Project Name',  'text',         0, null, 1),
    status:   await createField(conn, ptId, 'Status',        'singleSelect', 1, { options: ['Planning','In Progress','On Hold','Completed','Cancelled'] }),
    priority: await createField(conn, ptId, 'Priority',      'singleSelect', 2, { options: ['Critical','High','Medium','Low'] }),
    owner:    await createField(conn, ptId, 'Owner',         'text',         3),
    dueDate:  await createField(conn, ptId, 'Due Date',      'date',         4),
    progress: await createField(conn, ptId, 'Progress %',    'number',       5),
    category: await createField(conn, ptId, 'Category',      'singleSelect', 6, { options: ['Infrastructure','Migration','Transformation','AI','Compliance','BAU'] }),
    notes:    await createField(conn, ptId, 'Notes',         'text',         7),
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
    const rid = await createRecord(conn, ptId, userId, i);
    await setCell(conn, rid, pt.name,     'text',         name);
    await setCell(conn, rid, pt.status,   'singleSelect', status);
    await setCell(conn, rid, pt.priority, 'singleSelect', priority);
    await setCell(conn, rid, pt.owner,    'text',         owner);
    await setCell(conn, rid, pt.dueDate,  'date',         dueDate);
    await setCell(conn, rid, pt.progress, 'number',       progress);
    await setCell(conn, rid, pt.category, 'singleSelect', category);
  }
  console.log('  ✓ Project Tracker — 8 projects seeded');

  // ── 2. SPRINT BOARD ─────────────────────────────────────────
  const sbId = makeId();
  await conn.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [sbId, baseId, '🏃 Sprint Board', 1]
  );
  const sb = {
    task:    await createField(conn, sbId, 'Task',         'text',         0, null, 1),
    status:  await createField(conn, sbId, 'Status',       'singleSelect', 1, { options: ['Backlog','Todo','In Progress','In Review','Done','Blocked'] }),
    assign:  await createField(conn, sbId, 'Assignee',     'text',         2),
    points:  await createField(conn, sbId, 'Story Points', 'number',       3),
    sprint:  await createField(conn, sbId, 'Sprint',       'singleSelect', 4, { options: ['Sprint 1','Sprint 2','Sprint 3','Sprint 4','Backlog'] }),
    epic:    await createField(conn, sbId, 'Epic',         'singleSelect', 5, { options: ['Platform','Integrations','Security','UX','Infrastructure'] }),
    due:     await createField(conn, sbId, 'Due Date',     'date',         6),
    blocked: await createField(conn, sbId, 'Blocked By',   'text',         7),
  };
  const sbRows = [
    ['Set up Railway production environment',   'Done',        'Sandesh Tilekar', 5,  'Sprint 1', 'Platform',       '2026-03-20', null],
    ['Configure MySQL schema migration',        'Done',        'Sandesh Tilekar', 3,  'Sprint 1', 'Platform',       '2026-03-21', null],
    ['JWT authentication flow',                'Done',        'Arjun Mehta',     8,  'Sprint 1', 'Security',       '2026-03-22', null],
    ['ServiceNow incident integration',        'In Progress', 'Priya Sharma',    13, 'Sprint 2', 'Integrations',   '2026-04-05', null],
    ['Snowflake export pipeline',              'In Progress', 'Vikram Singh',    13, 'Sprint 2', 'Integrations',   '2026-04-08', null],
    ['Kanban board view polish',               'Todo',        'Neha Patel',      5,  'Sprint 2', 'UX',             '2026-04-10', null],
    ['Role-based permissions UI',             'Todo',        'Ravi Kumar',      8,  'Sprint 2', 'Security',       '2026-04-12', null],
    ['Bulk record import from CSV',           'Backlog',     'Ananya Iyer',     8,  'Sprint 3', 'Platform',       '2026-04-25', null],
    ['Microsoft Teams notification hook',     'Backlog',     'Arjun Mehta',     5,  'Sprint 3', 'Integrations',   '2026-04-28', null],
    ['Mobile responsive layout fixes',       'Blocked',     'Neha Patel',      3,  'Sprint 2', 'UX',             '2026-04-15', 'Waiting for design sign-off'],
    ['Azure AD SSO integration',             'Backlog',     'Sandesh Tilekar', 13, 'Sprint 4', 'Security',       '2026-05-10', null],
    ['Performance dashboard — P95 metrics', 'Todo',        'Vikram Singh',    5,  'Sprint 3', 'Infrastructure', '2026-04-20', null],
  ];
  for (let i = 0; i < sbRows.length; i++) {
    const [task, status, assign, points, sprint, epic, due, blockedBy] = sbRows[i];
    const rid = await createRecord(conn, sbId, userId, i);
    await setCell(conn, rid, sb.task,    'text',         task);
    await setCell(conn, rid, sb.status,  'singleSelect', status);
    await setCell(conn, rid, sb.assign,  'text',         assign);
    await setCell(conn, rid, sb.points,  'number',       points);
    await setCell(conn, rid, sb.sprint,  'singleSelect', sprint);
    await setCell(conn, rid, sb.epic,    'singleSelect', epic);
    await setCell(conn, rid, sb.due,     'date',         due);
    if (blockedBy) await setCell(conn, rid, sb.blocked, 'text', blockedBy);
  }
  console.log('  ✓ Sprint Board — 12 tasks seeded');

  // ── 3. RISK REGISTER ────────────────────────────────────────
  const rrId = makeId();
  await conn.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [rrId, baseId, '⚠️ Risk Register', 2]
  );
  const rr = {
    risk:        await createField(conn, rrId, 'Risk Description', 'text',         0, null, 1),
    category:    await createField(conn, rrId, 'Category',         'singleSelect', 1, { options: ['Technical','Resource','Schedule','Commercial','Security','Compliance','External'] }),
    probability: await createField(conn, rrId, 'Probability',      'singleSelect', 2, { options: ['Very High','High','Medium','Low','Very Low'] }),
    impact:      await createField(conn, rrId, 'Impact',           'singleSelect', 3, { options: ['Critical','High','Medium','Low','Negligible'] }),
    rating:      await createField(conn, rrId, 'Risk Rating',      'singleSelect', 4, { options: ['Critical','High','Medium','Low'] }),
    status:      await createField(conn, rrId, 'Status',           'singleSelect', 5, { options: ['Open','Mitigated','Accepted','Closed','Escalated'] }),
    mitigation:  await createField(conn, rrId, 'Mitigation Plan',  'text',         6),
    owner:       await createField(conn, rrId, 'Risk Owner',       'text',         7),
    reviewDate:  await createField(conn, rrId, 'Review Date',      'date',         8),
  };
  const rrRows = [
    ['Key resource dependency on single engineer for platform architecture', 'Resource',   'High',   'High',     'High',     'Open',      'Cross-train 2 engineers; document architecture thoroughly', 'Sandesh Tilekar', '2026-04-15'],
    ['Railway.app free tier credit exhaustion before VPS migration',        'Commercial', 'Medium', 'Medium',   'Medium',   'Open',      'Monitor spend weekly; provision VPS by end of Sprint 2',   'Sandesh Tilekar', '2026-04-01'],
    ['ServiceNow API rate limiting during high-volume incident periods',    'Technical',  'Medium', 'High',     'High',     'Mitigated', 'Implement exponential backoff and job queuing in syncWorker','Priya Sharma',    '2026-04-20'],
    ['Snowflake warehouse costs exceed budget during bulk exports',         'Commercial', 'Low',    'Medium',   'Low',      'Open',      'Schedule exports during off-peak; use incremental sync',    'Vikram Singh',    '2026-05-01'],
    ['MySQL data loss on Railway ephemeral storage',                       'Technical',  'Low',    'Critical', 'High',     'Mitigated', 'Daily mysqldump backup with 7d/4w/12m retention configured', 'Sandesh Tilekar', '2026-04-10'],
    ['GDPR compliance gap for EU team member data',                        'Compliance', 'Medium', 'High',     'High',     'Open',      'Data residency review; consider EU region deployment',      'Neha Patel',      '2026-04-30'],
    ['JWT_SECRET rotation causing session disruption for all users',       'Technical',  'Low',    'Medium',   'Low',      'Accepted',  'Schedule rotation during 2am–4am window with prior notice',  'Arjun Mehta',     '2026-06-01'],
    ['Team adoption resistance — preference for existing Excel workflow',  'Resource',   'Medium', 'Medium',   'Medium',   'Open',      'Deliver training session; show migration from Excel tool',  'Sandesh Tilekar', '2026-04-05'],
  ];
  for (let i = 0; i < rrRows.length; i++) {
    const [risk, category, prob, impact, rating, status, mitigation, owner, reviewDate] = rrRows[i];
    const rid = await createRecord(conn, rrId, userId, i);
    await setCell(conn, rid, rr.risk,        'text',         risk);
    await setCell(conn, rid, rr.category,    'singleSelect', category);
    await setCell(conn, rid, rr.probability, 'singleSelect', prob);
    await setCell(conn, rid, rr.impact,      'singleSelect', impact);
    await setCell(conn, rid, rr.rating,      'singleSelect', rating);
    await setCell(conn, rid, rr.status,      'singleSelect', status);
    await setCell(conn, rid, rr.mitigation,  'text',         mitigation);
    await setCell(conn, rid, rr.owner,       'text',         owner);
    await setCell(conn, rid, rr.reviewDate,  'date',         reviewDate);
  }
  console.log('  ✓ Risk Register — 8 risks seeded');

  // ── 4. RAID LOG ─────────────────────────────────────────────
  const rlId = makeId();
  await conn.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [rlId, baseId, '📌 RAID Log', 3]
  );
  const rl = {
    item:    await createField(conn, rlId, 'Item',        'text',         0, null, 1),
    type:    await createField(conn, rlId, 'Type',        'singleSelect', 1, { options: ['Risk','Assumption','Issue','Dependency'] }),
    status:  await createField(conn, rlId, 'Status',      'singleSelect', 2, { options: ['Open','In Progress','Resolved','Closed','Escalated'] }),
    priority:await createField(conn, rlId, 'Priority',    'singleSelect', 3, { options: ['High','Medium','Low'] }),
    owner:   await createField(conn, rlId, 'Owner',       'text',         4),
    due:     await createField(conn, rlId, 'Target Date', 'date',         5),
    impact:  await createField(conn, rlId, 'Impact',      'text',         6),
    notes:   await createField(conn, rlId, 'Notes',       'text',         7),
  };
  const rlRows = [
    ['Assuming Railway will support Node 20 through Q3 2026',                  'Assumption', 'Open',        'Medium', 'Sandesh Tilekar', '2026-06-30', 'Platform stability', 'Verify quarterly; have Dockerfile fallback ready'],
    ['VPS infrastructure must be provisioned before June go-live',             'Dependency', 'In Progress', 'High',   'Vikram Singh',    '2026-05-15', 'Production readiness', 'Hetzner VPS shortlisted — CX31 4vCPU 8GB'],
    ['Integration with SNOW requires ITSM admin approval',                    'Dependency', 'Open',        'High',   'Priya Sharma',    '2026-04-20', 'Integration timeline', 'Raised with ITSM team lead 20 Mar 2026'],
    ['Training session not yet scheduled for pilot user group',               'Issue',      'Open',        'Medium', 'Sandesh Tilekar', '2026-04-10', 'User adoption', 'Need to book 1hr slot with HR + Delivery leads'],
    ['Snowflake warehouse account identifier unclear — prod vs non-prod',     'Issue',      'In Progress', 'High',   'Vikram Singh',    '2026-04-05', 'Integration setup', 'Checking with Data Platform team'],
    ['File upload persistence on Railway ephemeral /tmp — data loss on restart','Risk',    'Open',        'High',   'Sandesh Tilekar', '2026-04-08', 'Data integrity', 'Migrate uploads to S3/R2 in Phase 2'],
    ['Assuming all team members have corporate email for registration',        'Assumption', 'Open',        'Low',    'Neha Patel',      '2026-04-01', 'Onboarding', 'Confirmed with HR — all India staff have @ensono.com'],
    ['Browser compatibility testing not completed for all target browsers',   'Issue',      'Open',        'Low',    'Ananya Iyer',     '2026-04-15', 'User experience', 'Chrome + Edge confirmed. Safari + Firefox TBD'],
  ];
  for (let i = 0; i < rlRows.length; i++) {
    const [item, type, status, priority, owner, due, impact, notes] = rlRows[i];
    const rid = await createRecord(conn, rlId, userId, i);
    await setCell(conn, rid, rl.item,     'text',         item);
    await setCell(conn, rid, rl.type,     'singleSelect', type);
    await setCell(conn, rid, rl.status,   'singleSelect', status);
    await setCell(conn, rid, rl.priority, 'singleSelect', priority);
    await setCell(conn, rid, rl.owner,    'text',         owner);
    await setCell(conn, rid, rl.due,      'date',         due);
    await setCell(conn, rid, rl.impact,   'text',         impact);
    await setCell(conn, rid, rl.notes,    'text',         notes);
  }
  console.log('  ✓ RAID Log — 8 items seeded');

  // ── 5. TEAM DIRECTORY ───────────────────────────────────────
  const tdId = makeId();
  await conn.execute(
    'INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)',
    [tdId, baseId, '👥 Team Directory', 4]
  );
  const td = {
    name:      await createField(conn, tdId, 'Name',         'text',         0, null, 1),
    role:      await createField(conn, tdId, 'Role',         'text',         1),
    team:      await createField(conn, tdId, 'Team',         'singleSelect', 2, { options: ['SLM','Delivery','Infrastructure','Data Platform','Security','People Ops'] }),
    email:     await createField(conn, tdId, 'Email',        'email',        3),
    avail:     await createField(conn, tdId, 'Availability', 'singleSelect', 4, { options: ['Available','Busy','OOO','Part-time'] }),
    skills:    await createField(conn, tdId, 'Skills',       'text',         5),
    location:  await createField(conn, tdId, 'Location',     'singleSelect', 6, { options: ['Pune','Mumbai','Bangalore','Hyderabad','Remote'] }),
    joined:    await createField(conn, tdId, 'Joined',       'date',         7),
  };
  const tdRows = [
    ['Sandesh Tilekar', 'SLM Lead — India Operations',   'SLM',             'sandesh.tilekar@ensono.com',  'Available',  'Project Management, Node.js, MySQL, Architecture', 'Pune',      '2022-01-10'],
    ['Priya Sharma',    'Integration Specialist',         'SLM',             'priya.sharma@ensono.com',     'Available',  'ServiceNow, ITSM, REST APIs, Integration Design',  'Pune',      '2022-06-15'],
    ['Arjun Mehta',     'Senior Software Engineer',       'SLM',             'arjun.mehta@ensono.com',      'Busy',       'Node.js, React, JWT, Security, AWS',               'Bangalore', '2021-09-01'],
    ['Neha Patel',      'UX + Frontend Engineer',         'Delivery',        'neha.patel@ensono.com',       'Available',  'React, Tailwind, Figma, Accessibility',             'Pune',      '2023-03-20'],
    ['Vikram Singh',    'Data Platform Engineer',         'Data Platform',   'vikram.singh@ensono.com',     'Available',  'Snowflake, DBT, Python, ETL, SQL',                 'Mumbai',    '2021-11-12'],
    ['Ravi Kumar',      'Cloud Infrastructure Engineer',  'Infrastructure',  'ravi.kumar@ensono.com',       'Busy',       'AWS, Terraform, Nginx, Linux, Docker',             'Hyderabad', '2022-08-05'],
    ['Ananya Iyer',     'People Ops Coordinator',         'People Ops',      'ananya.iyer@ensono.com',      'Available',  'Onboarding, HR Systems, Compliance, Training',     'Pune',      '2023-07-18'],
    ['Kavya Reddy',     'Security & Compliance Analyst',  'Security',        'kavya.reddy@ensono.com',      'Part-time',  'ISO 27001, GDPR, Pen Testing, SIEM',               'Bangalore', '2023-01-09'],
  ];
  for (let i = 0; i < tdRows.length; i++) {
    const [name, role, team, email, avail, skills, location, joined] = tdRows[i];
    const rid = await createRecord(conn, tdId, userId, i);
    await setCell(conn, rid, td.name,     'text',         name);
    await setCell(conn, rid, td.role,     'text',         role);
    await setCell(conn, rid, td.team,     'singleSelect', team);
    await setCell(conn, rid, td.email,    'email',        email);
    await setCell(conn, rid, td.avail,    'singleSelect', avail);
    await setCell(conn, rid, td.skills,   'text',         skills);
    await setCell(conn, rid, td.location, 'singleSelect', location);
    await setCell(conn, rid, td.joined,   'date',         joined);
  }
  console.log('  ✓ Team Directory — 8 members seeded');

  // Delete the default Table 1 that was created on registration
  await conn.execute('DELETE FROM `tables` WHERE base_id = ? AND name = ?', [baseId, 'Table 1']);
  await conn.execute('DELETE FROM `tables` WHERE base_id = ? AND name = ?', [baseId, 'My First Base']);

  console.log('✅ PM workspace seed complete — 5 tables, 44 records');
}

module.exports = { seedPMWorkspace };
