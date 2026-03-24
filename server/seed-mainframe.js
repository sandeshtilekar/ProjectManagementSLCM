// ============================================================
//  Ensono DataGrid — Mainframe SLM Seed
//  5 mainframe-specific modules with realistic IBM z/OS data
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const { nanoid } = require('nanoid');
const db = require('./db');
const makeId = () => nanoid(12);

async function cf(tableId, name, type, order, options, isPrimary) {
  const id = makeId();
  await db.execute(
    'INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, tableId, name, type, options ? JSON.stringify(options) : null, order, isPrimary || 0]
  );
  return id;
}

async function cr(tableId, userId, order) {
  const id = makeId();
  await db.execute(
    'INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)',
    [id, tableId, order, userId]
  );
  return id;
}

async function sc(recordId, fieldId, type, value) {
  if (value === null || value === undefined || value === '') return;
  let vt = null, vn = null, vb = null, vj = null;
  if (type === 'checkbox')                         vb = value ? 1 : 0;
  else if (type === 'number' || type === 'rating') vn = Number(value);
  else if (type === 'multiSelect')                 vj = JSON.stringify(value);
  else                                             vt = String(value);
  await db.execute(
    'INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num), value_bool=VALUES(value_bool), value_json=VALUES(value_json)',
    [recordId, fieldId, vt, vn, vb, vj]
  );
}

async function ct(baseId, name, order) {
  const id = makeId();
  await db.execute('INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)', [id, baseId, name, order]);
  return id;
}

async function seedMainframe(wsId, baseId, userId) {
  console.log('Seeding Mainframe SLM module...');

  // Get current max order_index so we append after existing tables
  const [[maxRow]] = await db.execute(
    'SELECT COALESCE(MAX(order_index), -1) AS mx FROM `tables` WHERE base_id = ?', [baseId]
  );
  let ord = (maxRow.mx || 0) + 1;

  // ── 1. LPAR & SYSPLEX REGISTER ─────────────────────────────
  const lpId = await ct(baseId, '🖥️ LPAR & Sysplex Register', ord++);
  const lp = {
    lpar:     await cf(lpId, 'LPAR Name',         'text',         0, null, 1),
    sysplex:  await cf(lpId, 'Sysplex',           'text',         1),
    machine:  await cf(lpId, 'Machine Model',     'text',         2),
    serial:   await cf(lpId, 'Serial Number',     'text',         3),
    site:     await cf(lpId, 'Data Centre Site',  'singleSelect', 4, { options: ['Mumbai DC1','Mumbai DC2','Chennai DR','Pune Colo','Client On-Prem'] }),
    role:     await cf(lpId, 'LPAR Role',         'singleSelect', 5, { options: ['Production','DR','Development','Test','UAT','Batch','LPAR Pool'] }),
    zos:      await cf(lpId, 'z/OS Version',      'text',         6),
    msuDef:   await cf(lpId, 'MSU Defined',       'number',       7),
    msuCap:   await cf(lpId, 'MSU Cap',           'number',       8),
    status:   await cf(lpId, 'Status',            'singleSelect', 9, { options: ['Active','Standby','Maintenance','Decommissioning','Retired'] }),
    owner:    await cf(lpId, 'LPAR Owner',        'text',         10),
    client:   await cf(lpId, 'Client / Account',  'text',         11),
    notes:    await cf(lpId, 'Notes',             'text',         12),
  };
  const lpD = [
    ['PROD1A', 'ENSPLEX1', 'IBM z16 A01', 'SN-INM-0421', 'Mumbai DC1',   'Production',   'z/OS 2.5', 2200, 2000, 'Active',      'Vikram Singh',    'Ensono Internal',      'Primary production LPAR — CICS, IMS, Db2 all active'],
    ['PROD1B', 'ENSPLEX1', 'IBM z16 A01', 'SN-INM-0421', 'Mumbai DC1',   'Production',   'z/OS 2.5', 1800, 1600, 'Active',      'Vikram Singh',    'Ensono Internal',      'Secondary prod LPAR — batch workloads, overnight processing'],
    ['DRPLEX', 'ENSDRSYS', 'IBM z15 B02', 'SN-INC-0388', 'Chennai DR',   'DR',           'z/OS 2.5', 1200, 1200, 'Standby',     'Ravi Kumar',      'Ensono Internal',      'DR LPAR — warm standby, tested quarterly, RTO 4hrs'],
    ['DEV01',  'ENSDEVPX', 'IBM z14 C03', 'SN-INP-0291', 'Pune Colo',    'Development',  'z/OS 2.4', 400,  400,  'Active',      'Arjun Mehta',     'Ensono Internal',      'Developer LPAR — shared by 12 developers, SYSGEN refreshed monthly'],
    ['UAT01',  'ENSDEVPX', 'IBM z14 C03', 'SN-INP-0291', 'Pune Colo',    'UAT',          'z/OS 2.4', 300,  300,  'Active',      'Arjun Mehta',     'Ensono Internal',      'UAT — refreshed from prod every sprint cycle'],
    ['CLPROD1','CLNTPLEX', 'IBM z16 A02', 'SN-INM-0512', 'Client On-Prem','Production',  'z/OS 2.5', 3500, 3200, 'Active',      'Priya Sharma',    'Client A — BFSI',      'Client managed production — Ensono provides SLM advisory'],
    ['CLPROD2','CLNTPLEX', 'IBM z16 A02', 'SN-INM-0512', 'Client On-Prem','Batch',       'z/OS 2.5', 2800, 2500, 'Active',      'Priya Sharma',    'Client A — BFSI',      'Client batch LPAR — EOD processing, 22:00-06:00 window'],
    ['CLDEV1', 'CLNTDEV',  'IBM z14 D01', 'SN-INM-0298', 'Mumbai DC2',   'Development',  'z/OS 2.4', 500,  500,  'Active',      'Priya Sharma',    'Client A — BFSI',      'Client dev LPAR — hosted in Ensono Mumbai DC2'],
    ['CLPROD3','CLNT2PLX', 'IBM z15 B03', 'SN-INC-0401', 'Client On-Prem','Production',  'z/OS 2.5', 1800, 1600, 'Active',      'Neha Patel',      'Client B — Insurance', 'Client B production — core policy admin system'],
    ['CLDR3',  'CLNT2PLX', 'IBM z15 B03', 'SN-INC-0401', 'Chennai DR',   'DR',           'z/OS 2.5', 900,  900,  'Standby',     'Neha Patel',      'Client B — Insurance', 'Client B DR — cold standby, monthly test schedule'],
  ];
  for (let i = 0; i < lpD.length; i++) {
    const [lpar,sysplex,machine,serial,site,role,zos,msuDef,msuCap,status,owner,client,notes] = lpD[i];
    const rid = await cr(lpId, userId, i);
    await sc(rid,lp.lpar,'text',lpar); await sc(rid,lp.sysplex,'text',sysplex);
    await sc(rid,lp.machine,'text',machine); await sc(rid,lp.serial,'text',serial);
    await sc(rid,lp.site,'singleSelect',site); await sc(rid,lp.role,'singleSelect',role);
    await sc(rid,lp.zos,'text',zos); await sc(rid,lp.msuDef,'number',msuDef);
    await sc(rid,lp.msuCap,'number',msuCap); await sc(rid,lp.status,'singleSelect',status);
    await sc(rid,lp.owner,'text',owner); await sc(rid,lp.client,'text',client);
    await sc(rid,lp.notes,'text',notes);
  }
  console.log('  LPAR & Sysplex Register done — 10 LPARs');

  // ── 2. MAINFRAME SOFTWARE REGISTER ─────────────────────────
  const mfId = await ct(baseId, '⚙️ Mainframe Software Register', ord++);
  const mf = {
    product:  await cf(mfId, 'Product Name',       'text',         0, null, 1),
    vendor:   await cf(mfId, 'Vendor',             'text',         1),
    pid:      await cf(mfId, 'Product ID (PID)',   'text',         2),
    fmid:     await cf(mfId, 'FMID',               'text',         3),
    version:  await cf(mfId, 'Version / Release',  'text',         4),
    category: await cf(mfId, 'Category',           'singleSelect', 5, { options: ['OS','Database','Transaction Monitor','Security','Storage','Compiler','Monitoring','Middleware','Utility','Automation'] }),
    lpar:     await cf(mfId, 'LPAR(s)',            'text',         6),
    licType:  await cf(mfId, 'Licence Type',       'singleSelect', 7, { options: ['MLC - Monthly Licence Charge','IPLA - One-time','Sub-capacity','Enterprise Licence','Perpetual','Open Source'] }),
    paNum:    await cf(mfId, 'PA Entitlement No.', 'text',         8),
    smpZone:  await cf(mfId, 'SMP/E Zone',         'text',         9),
    eosDate:  await cf(mfId, 'End of Support',     'date',         10),
    status:   await cf(mfId, 'Status',             'singleSelect', 11, { options: ['Active','EOL Warning','End of Support','Upgrading','Retired','Evaluation'] }),
    owner:    await cf(mfId, 'Owner',              'text',         12),
    notes:    await cf(mfId, 'Notes',              'text',         13),
  };
  const mfD = [
    ['z/OS',                      'IBM', '5655-ZOS', 'JDUM380', '2.5',    'OS',               'PROD1A PROD1B DRPLEX CLPROD1 CLPROD2 CLPROD3', 'MLC - Monthly Licence Charge', 'PA-IBM-00142', 'GLOBAL',   '2027-09-30', 'Active',      'Vikram Singh',    'z/OS 2.5 GA Sep 2021 — z/OS 3.1 available, upgrade planning Q4 2026'],
    ['CICS Transaction Server',   'IBM', '5655-Y04', 'HCIW100', '6.2',    'Transaction Monitor','PROD1A CLPROD1',                              'MLC - Monthly Licence Charge', 'PA-IBM-00143', 'CICSPROD', '2027-09-30', 'Active',      'Priya Sharma',    'Primary OLTP monitor — 4,200 active transactions, 98.5% availability'],
    ['IMS',                       'IBM', '5635-A04', 'HDBD110', '15.4',   'Database',         'PROD1A PROD1B CLPROD1 CLPROD2',               'MLC - Monthly Licence Charge', 'PA-IBM-00144', 'IMSPROD',  '2027-09-30', 'Active',      'Vikram Singh',    'Hierarchical DB — 28TB data, 1.2B transactions/month'],
    ['Db2 for z/OS',              'IBM', '5650-DB2', 'ADBA200', '13.1',   'Database',         'PROD1A PROD1B DEV01 CLPROD1 CLPROD3',         'MLC - Monthly Licence Charge', 'PA-IBM-00145', 'DB2PROD',  '2027-09-30', 'Active',      'Vikram Singh',    'Relational DB — 180TB data across all LPARs'],
    ['RACF',                      'IBM', '5650-ZOS', 'HSKR100', '2.5',    'Security',         'PROD1A PROD1B DRPLEX DEV01 UAT01',            'MLC - Monthly Licence Charge', 'PA-IBM-00146', 'RACFPROD', '2027-09-30', 'Active',      'Kavya Reddy',     'Security subsystem — 1,800 user IDs, 12,400 data set profiles'],
    ['IBM MQ for z/OS',           'IBM', '5655-MQ9', 'HMQV900', '9.3',    'Middleware',       'PROD1A CLPROD1 CLPROD3',                      'MLC - Monthly Licence Charge', 'PA-IBM-00147', 'MQPROD',   '2027-09-30', 'Active',      'Arjun Mehta',     'Message queuing — 240 queues, 18M msgs/day, connected to distributed MQ'],
    ['COBOL for z/OS',            'IBM', '5655-EC6', 'HECL430', '6.4',    'Compiler',         'PROD1A PROD1B DEV01 UAT01',                   'IPLA - One-time',             'PA-IBM-00148', 'COBPROD',  '2028-09-30', 'Active',      'Arjun Mehta',     '4,200 COBOL programs in production — annual recompile during upgrades'],
    ['IBM Tivoli Workload Scheduler','IBM','5698-WKB','HDSP730','9.5',    'Automation',       'PROD1B CLPROD2',                              'MLC - Monthly Licence Charge', 'PA-IBM-00149', 'TWSPROD',  '2026-09-30', 'EOL Warning', 'Vikram Singh',    'Batch scheduler — 3,400 jobs/day. Migration to z/OS WLM being evaluated'],
    ['DFSMS',                     'IBM', '5694-A01', 'HDAS220', '2.5',    'Storage',          'PROD1A PROD1B DRPLEX',                        'MLC - Monthly Licence Charge', 'PA-IBM-00150', 'SMSPROD',  '2027-09-30', 'Active',      'Ravi Kumar',      'Storage management — 280TB DASD managed, HSM active'],
    ['BMC AMI for Db2',           'BMC', 'BMC-AMID2','N/A',     '21.01',  'Monitoring',       'PROD1A PROD1B',                               'Sub-capacity',                'PA-BMC-00089', 'BMCD2PRD', '2026-12-31', 'Active',      'Vikram Singh',    'Db2 performance monitor — SQL tuning, buffer pool analysis'],
    ['CA7 Workload Automation',   'Broadcom','CA7-MF','N/A',    '12.1',   'Automation',       'PROD1B CLPROD2',                              'MLC - Monthly Licence Charge', 'PA-BCA-00201', 'CA7PROD',  '2027-06-30', 'Active',      'Vikram Singh',    'Alternative batch scheduler on client estate — 1,800 jobs/day'],
    ['IBM Health Checker',        'IBM', '5655-ZOS', 'HCHK110', '2.5',    'Monitoring',       'PROD1A PROD1B DRPLEX DEV01',                  'MLC - Monthly Licence Charge', 'PA-IBM-00151', 'HCPROD',   '2027-09-30', 'Active',      'Ravi Kumar',      'System health — 240 checks active, alerts via NetView'],
    ['PL/I for z/OS',             'IBM', '5655-PL2', 'HPLI530', '5.3',    'Compiler',         'PROD1A DEV01',                                'IPLA - One-time',             'PA-IBM-00152', 'PLIPROD',  '2028-09-30', 'Active',      'Arjun Mehta',     '380 PL/I programs in production — legacy financial calc modules'],
    ['z/OSMF',                    'IBM', '5655-ZOS', 'HZOM120', '2.5',    'Utility',          'PROD1A PROD1B DEV01',                         'MLC - Monthly Licence Charge', 'PA-IBM-00153', 'ZOSMFPRD', '2027-09-30', 'Active',      'Sandesh Tilekar', 'z/OS Management Facility — workflows, software deployment, REST APIs'],
    ['IBM ACF2',                  'Broadcom','5655-L53','N/A',   '16.0',   'Security',         'CLPROD1 CLPROD2 CLPROD3',                     'MLC - Monthly Licence Charge', 'PA-BCA-00202', 'ACF2PROD', '2026-09-30', 'EOL Warning', 'Kavya Reddy',     'Client estate uses ACF2 not RACF — EOL warning, migration to RACF being evaluated'],
  ];
  for (let i = 0; i < mfD.length; i++) {
    const [product,vendor,pid,fmid,version,category,lpar,licType,paNum,smpZone,eosDate,status,owner,notes] = mfD[i];
    const rid = await cr(mfId, userId, i);
    await sc(rid,mf.product,'text',product); await sc(rid,mf.vendor,'text',vendor);
    await sc(rid,mf.pid,'text',pid); await sc(rid,mf.fmid,'text',fmid);
    await sc(rid,mf.version,'text',version); await sc(rid,mf.category,'singleSelect',category);
    await sc(rid,mf.lpar,'text',lpar); await sc(rid,mf.licType,'singleSelect',licType);
    await sc(rid,mf.paNum,'text',paNum); await sc(rid,mf.smpZone,'text',smpZone);
    await sc(rid,mf.eosDate,'date',eosDate); await sc(rid,mf.status,'singleSelect',status);
    await sc(rid,mf.owner,'text',owner); await sc(rid,mf.notes,'text',notes);
  }
  console.log('  Mainframe Software Register done — 15 products');

  // ── 3. MSU CONSUMPTION TRACKER ─────────────────────────────
  const msId = await ct(baseId, '📊 MSU Consumption Tracker', ord++);
  const ms = {
    lpar:      await cf(msId, 'LPAR',                  'text',         0, null, 1),
    product:   await cf(msId, 'Product',               'text',         1),
    month:     await cf(msId, 'Month',                 'text',         2),
    peak4hr:   await cf(msId, 'Peak 4hr Rolling (MSU)','number',       3),
    avgDaily:  await cf(msId, 'Avg Daily (MSU)',        'number',       4),
    contracted:await cf(msId, 'Contracted MSU',        'number',       5),
    threshold: await cf(msId, 'Sub-cap Threshold',     'number',       6),
    overage:   await cf(msId, 'Overage MSU',           'number',       7),
    status:    await cf(msId, 'Status',                'singleSelect', 8, { options: ['Within threshold','Near threshold (>80%)','Overage — billing risk','Significantly under','Data pending'] }),
    cost:      await cf(msId, 'Est. MLC Cost (INR)',   'number',       9),
    trend:     await cf(msId, 'Trend',                 'singleSelect', 10, { options: ['Increasing','Stable','Decreasing','Spike — investigating','Seasonal'] }),
    notes:     await cf(msId, 'Notes',                 'text',         11),
  };
  const msD = [
    ['PROD1A', 'z/OS',                   'Feb 2026', 1840, 1620, 2000, 1800, 0,  'Within threshold',       3200000, 'Stable',    'Normal load — batch window stays within cap'],
    ['PROD1A', 'CICS Transaction Server','Feb 2026', 920,  780,  1000, 900,  0,  'Within threshold',       1800000, 'Stable',    'OLTP load stable — no incidents this month'],
    ['PROD1A', 'Db2 for z/OS',           'Feb 2026', 680,  540,  800,  720,  0,  'Within threshold',       1200000, 'Stable',    'Buffer pool hit rate 96% — good performance'],
    ['PROD1B', 'z/OS',                   'Feb 2026', 1620, 980,  1800, 1620, 0,  'Within threshold',       2800000, 'Stable',    'Batch heavy — peaks at 23:00 EOD run'],
    ['PROD1B', 'IMS',                    'Feb 2026', 1180, 860,  1200, 1080, 0,  'Near threshold (>80%)',  2100000, 'Increasing','Month-on-month +8% — review April capacity plan'],
    ['CLPROD1','z/OS',                   'Feb 2026', 3050, 2640, 3200, 2880, 0,  'Near threshold (>80%)',  5200000, 'Increasing','Client growth — Q2 capacity review flagged'],
    ['CLPROD1','CICS Transaction Server','Feb 2026', 2240, 1890, 2400, 2160, 80, 'Overage — billing risk', 4200000, 'Increasing','OVERAGE: 80 MSU above sub-cap — client notified 25 Feb'],
    ['CLPROD1','Db2 for z/OS',           'Feb 2026', 1820, 1540, 1800, 1620, 200,'Overage — billing risk', 3100000, 'Spike — investigating','OVERAGE: new batch job added without capacity review'],
    ['CLPROD2','z/OS',                   'Feb 2026', 2380, 1200, 2500, 2250, 0,  'Within threshold',       4100000, 'Seasonal',  'EOD batch spikes Feb — tax season normalises Apr'],
    ['CLPROD3','z/OS',                   'Feb 2026', 1520, 1180, 1600, 1440, 0,  'Within threshold',       2600000, 'Stable',    'Policy admin system — stable load'],
    ['PROD1A', 'z/OS',                   'Mar 2026', 1880, 1650, 2000, 1800, 0,  'Within threshold',       3200000, 'Stable',    'March on track — 3 days remaining'],
    ['CLPROD1','CICS Transaction Server','Mar 2026', 2180, 1920, 2400, 2160, 0,  'Near threshold (>80%)',  4200000, 'Stable',    'Improvement after job rescheduling — monitoring'],
    ['CLPROD1','Db2 for z/OS',           'Mar 2026', 1640, 1490, 1800, 1620, 0,  'Within threshold',       3100000, 'Decreasing','Batch job moved to CLPROD2 — resolved overage'],
  ];
  for (let i = 0; i < msD.length; i++) {
    const [lpar,product,month,peak4hr,avgDaily,contracted,threshold,overage,status,cost,trend,notes] = msD[i];
    const rid = await cr(msId, userId, i);
    await sc(rid,ms.lpar,'text',lpar); await sc(rid,ms.product,'text',product);
    await sc(rid,ms.month,'text',month); await sc(rid,ms.peak4hr,'number',peak4hr);
    await sc(rid,ms.avgDaily,'number',avgDaily); await sc(rid,ms.contracted,'number',contracted);
    await sc(rid,ms.threshold,'number',threshold); await sc(rid,ms.overage,'number',overage);
    await sc(rid,ms.status,'singleSelect',status); await sc(rid,ms.cost,'number',cost);
    await sc(rid,ms.trend,'singleSelect',trend); await sc(rid,ms.notes,'text',notes);
  }
  console.log('  MSU Consumption Tracker done — 13 records');

  // ── 4. PTF / MAINTENANCE LOG ────────────────────────────────
  const ptId = await ct(baseId, '🔧 PTF / Maintenance Log', ord++);
  const pt = {
    ptfNum:   await cf(ptId, 'PTF / APAR Number',  'text',         0, null, 1),
    product:  await cf(ptId, 'Product',            'text',         1),
    type:     await cf(ptId, 'Type',               'singleSelect', 2, { options: ['PTF','APAR','RSU','HIPER','PE PTF','USERMOD','CST','Fix Pack'] }),
    category: await cf(ptId, 'Category',           'singleSelect', 3, { options: ['Security','Functional','Performance','Mandatory','Recommended','Optional'] }),
    severity: await cf(ptId, 'Severity',           'singleSelect', 4, { options: ['HIPER - High Impact','PE - Product Error','Critical','Recommended','Informational'] }),
    status:   await cf(ptId, 'Status',             'singleSelect', 5, { options: ['Pending assessment','Approved — awaiting apply','Applied — non-prod','Applied — prod','Rejected','Deferred','Superseded'] }),
    lpar:     await cf(ptId, 'Target LPAR(s)',     'text',         6),
    applied:  await cf(ptId, 'Applied Date',       'date',         7),
    appliedBy:await cf(ptId, 'Applied By',         'text',         8),
    rfc:      await cf(ptId, 'RFC Reference',      'text',         9),
    preReqs:  await cf(ptId, 'Pre-requisites',     'text',         10),
    notes:    await cf(ptId, 'Notes',              'text',         11),
  };
  const ptD = [
    ['UI72664', 'z/OS 2.5',               'PTF',    'Security',     'HIPER - High Impact', 'Applied — prod',         'PROD1A PROD1B DRPLEX',     '2026-01-18', 'Vikram Singh',    'RFC-2026-0071', 'UI70012 UI71234',       'HIPER fix for JES2 spool corruption — emergency apply'],
    ['UI73891', 'CICS TS 6.2',            'PTF',    'Functional',   'Recommended',         'Applied — prod',         'PROD1A CLPROD1',            '2026-01-25', 'Priya Sharma',    'RFC-2026-0074', 'UI72100',               'CICS storage violation fix — applied with Jan RSU'],
    ['UI74102', 'Db2 13.1',               'PTF',    'Performance',  'Recommended',         'Applied — prod',         'PROD1A PROD1B',             '2026-02-08', 'Vikram Singh',    'RFC-2026-0082', 'UI73500',               'Buffer pool manager improvement — 6% CPU reduction observed'],
    ['UI74899', 'z/OS 2.5',               'RSU',    'Mandatory',    'Recommended',         'Applied — prod',         'PROD1A PROD1B DRPLEX',     '2026-02-15', 'Vikram Singh',    'RFC-2026-0089', 'Multiple — see RSU doc', 'Jan 2026 RSU — 147 PTFs. Applied during ServiceNow upgrade window'],
    ['UI75234', 'IMS 15.4',               'PTF',    'Security',     'HIPER - High Impact', 'Applied — non-prod',     'DEV01 UAT01',               '2026-03-05', 'Arjun Mehta',     'RFC-2026-0098', 'UI74800',               'IMS security HIPER — non-prod applied, prod scheduled 29 Mar'],
    ['UI75234', 'IMS 15.4',               'PTF',    'Security',     'HIPER - High Impact', 'Approved — awaiting apply','PROD1A PROD1B CLPROD1 CLPROD2','2026-03-29','Vikram Singh', 'RFC-2026-0115', 'UI74800',               'Production apply scheduled this weekend — ESM sign-off obtained'],
    ['UI75678', 'RACF 2.5',               'PTF',    'Security',     'Critical',            'Applied — prod',         'PROD1A PROD1B DRPLEX',     '2026-03-10', 'Kavya Reddy',     'RFC-2026-0099', 'UI74900',               'Privilege escalation vulnerability — emergency change applied'],
    ['UI76001', 'Db2 13.1',               'APAR',   'Functional',   'Recommended',         'Pending assessment',     'PROD1A PROD1B',             null,          'TBD',             'TBD',           'UI75100',               'APAR for SQL performance regression in nested subquery — under evaluation'],
    ['PQ99812', 'IBM MQ 9.3',             'PTF',    'Functional',   'Recommended',         'Applied — prod',         'PROD1A CLPROD1 CLPROD3',   '2026-02-20', 'Arjun Mehta',     'RFC-2026-0086', 'PQ99100',               'MQ dead letter queue handling fix — applied with no issues'],
    ['UI75901', 'z/OS 2.5',               'RSU',    'Mandatory',    'Recommended',         'Approved — awaiting apply','All LPARs',               null,          'Vikram Singh',    'RFC-2026-0118', 'Multiple — see RSU doc', 'Apr 2026 RSU — 203 PTFs. Scheduled for Apr maintenance window'],
    ['UI75100', 'COBOL 6.4',              'PTF',    'Functional',   'Informational',       'Applied — non-prod',     'DEV01',                     '2026-03-15', 'Arjun Mehta',     'RFC-2026-0105', 'None',                  'Compiler fix for COMPUTE statement edge case — testing in dev'],
    ['UI74050', 'TWS 9.5',                'PTF',    'Security',     'HIPER - High Impact', 'Deferred',               'PROD1B CLPROD2',            null,          'Vikram Singh',    'Deferred',      'UI73800',               'HIPER fix but TWS EOL warning in effect — deferring to after migration decision'],
    ['PE98765', 'z/OS 2.5',               'PE PTF', 'Functional',   'PE - Product Error',  'Rejected',               'N/A',                       null,          'N/A',             'N/A',           'N/A',                   'PE PTF — must not apply. Causes dataset allocation failure. Superseded by UI74899'],
  ];
  for (let i = 0; i < ptD.length; i++) {
    const [ptfNum,product,type,category,severity,status,lpar,applied,appliedBy,rfc,preReqs,notes] = ptD[i];
    const rid = await cr(ptId, userId, i);
    await sc(rid,pt.ptfNum,'text',ptfNum); await sc(rid,pt.product,'text',product);
    await sc(rid,pt.type,'singleSelect',type); await sc(rid,pt.category,'singleSelect',category);
    await sc(rid,pt.severity,'singleSelect',severity); await sc(rid,pt.status,'singleSelect',status);
    await sc(rid,pt.lpar,'text',lpar);
    if (applied) await sc(rid,pt.applied,'date',applied);
    await sc(rid,pt.appliedBy,'text',appliedBy); await sc(rid,pt.rfc,'text',rfc);
    await sc(rid,pt.preReqs,'text',preReqs); await sc(rid,pt.notes,'text',notes);
  }
  console.log('  PTF / Maintenance Log done — 13 entries');

  // ── 5. IBM CONTRACT & WALLET REGISTER ──────────────────────
  const iwId = await ct(baseId, '📋 IBM Contract & Wallet Register', ord++);
  const iw = {
    entitle:  await cf(iwId, 'PA Entitlement No.',  'text',         0, null, 1),
    product:  await cf(iwId, 'Product',             'text',         1),
    pid:      await cf(iwId, 'Product ID (PID)',    'text',         2),
    licType:  await cf(iwId, 'Licence Type',        'singleSelect', 3, { options: ['MLC','IPLA','Sub-capacity MLC','Enterprise Licence Agreement','SaaS','Support & Subscription'] }),
    contractNo:await cf(iwId,'IBM Contract No.',    'text',         4),
    msuTier:  await cf(iwId, 'MSU Tier / Quantity', 'text',         5),
    annualCost:await cf(iwId,'Annual Cost (INR)',   'number',       6),
    subCapElect:await cf(iwId,'Sub-cap Elected',   'singleSelect', 7, { options: ['Yes — SCRT reporting active','No — full capacity billing','N/A — IPLA','Pending election'] }),
    scrtContact:await cf(iwId,'SCRT Report Contact','text',         8),
    renewal:  await cf(iwId, 'Renewal Date',       'date',         9),
    swma:     await cf(iwId, 'SWMA Expiry',        'date',         10),
    status:   await cf(iwId, 'Status',             'singleSelect', 11, { options: ['Active','Expiring Soon','Under Negotiation','Expired','Terminated'] }),
    ibmCse:   await cf(iwId, 'IBM CSE / Account',  'text',         12),
    notes:    await cf(iwId, 'Notes',              'text',         13),
  };
  const iwD = [
    ['PA-IBM-00142', 'z/OS 2.5',                  '5655-ZOS', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Tier 3 — 5000 MSU',      28000000, 'Yes — SCRT reporting active', 'Vikram Singh', '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'SCRT submitted monthly — Dec overage resulted in tier review'],
    ['PA-IBM-00143', 'CICS Transaction Server 6.2','5655-Y04', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Tier 2 — 3000 MSU',      18000000, 'Yes — SCRT reporting active', 'Priya Sharma', '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'Feb overage 80 MSU — IBM notified, corrective action taken'],
    ['PA-IBM-00144', 'IMS 15.4',                  '5635-A04', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Tier 3 — 5000 MSU',      22000000, 'Yes — SCRT reporting active', 'Vikram Singh', '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'IMS usage trend +8% MoM — tier review flagged for Q2'],
    ['PA-IBM-00145', 'Db2 for z/OS 13.1',         '5650-DB2', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Tier 3 — 5000 MSU',      24000000, 'Yes — SCRT reporting active', 'Vikram Singh', '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'Feb overage 200 MSU resolved in March by job movement'],
    ['PA-IBM-00146', 'RACF 2.5',                  '5650-ZOS', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Included in z/OS',       0,        'Yes — SCRT reporting active', 'Kavya Reddy',  '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'RACF licenced as part of z/OS — no separate charge'],
    ['PA-IBM-00147', 'IBM MQ for z/OS 9.3',       '5655-MQ9', 'Sub-capacity MLC',         'IBM-CTR-MUM-4422', 'Tier 2 — 2000 MSU',      8500000,  'Yes — SCRT reporting active', 'Arjun Mehta',  '2026-09-30', '2026-09-30', 'Expiring Soon',  'Priya Das (IBM) priya.das@ibm.com',           'Renewal negotiation starting April — usage growing 12% YoY'],
    ['PA-IBM-00148', 'COBOL for z/OS 6.4',        '5655-EC6', 'IPLA - One-time',          'IBM-CTR-MUM-4423', 'Unlimited installs',      1800000,  'N/A — IPLA',                  'Arjun Mehta',  '2027-06-30', '2027-06-30', 'Active',         'Priya Das (IBM) priya.das@ibm.com',           'IPLA perpetual — SWMA renewal covers support + new releases'],
    ['PA-IBM-00149', 'Tivoli Workload Scheduler',  '5698-WKB', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Tier 1 — 500 MSU',       2200000,  'Yes — SCRT reporting active', 'Vikram Singh', '2026-09-30', '2026-09-30', 'Expiring Soon',  'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'EOL warning — not renewing, migrating to z/OS WLM'],
    ['PA-IBM-00150', 'DFSMS 2.5',                 '5694-A01', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Included in z/OS',       0,        'Yes — SCRT reporting active', 'Ravi Kumar',   '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'DFSMS licenced as part of z/OS base — no separate charge'],
    ['PA-IBM-00151', 'IBM Health Checker',         '5655-ZOS', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Included in z/OS',       0,        'N/A — IPLA',                  'Ravi Kumar',   '2026-12-31', '2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'Health Checker included in z/OS licence — no additional cost'],
    ['PA-IBM-00152', 'PL/I for z/OS 5.3',         '5655-PL2', 'IPLA - One-time',          'IBM-CTR-MUM-4423', 'Unlimited installs',      950000,   'N/A — IPLA',                  'Arjun Mehta',  '2027-06-30', '2027-06-30', 'Active',         'Priya Das (IBM) priya.das@ibm.com',           'Legacy PL/I — evaluating retirement as COBOL rewrite completes'],
    ['PA-IBM-00153', 'z/OSMF 2.5',                '5655-ZOS', 'Sub-capacity MLC',         'IBM-CTR-MUM-4421', 'Included in z/OS',       0,        'Yes — SCRT reporting active', 'Sandesh Tilekar','2026-12-31','2026-12-31', 'Active',         'Rajesh Nair (IBM) rajesh.nair@ibm.com',       'z/OSMF included in z/OS — REST API usage growing significantly'],
    ['PA-BCA-00201', 'CA7 Workload Automation',    'CA7-MF',   'Enterprise Licence Agreement','BCA-CTR-2024-881','Client A estate',       6800000,  'N/A — IPLA',                  'Vikram Singh', '2027-03-31', '2027-03-31', 'Active',         'Anand Iyer (Broadcom) anand.iyer@broadcom.com','Broadcom acquisition — price increase 18% at last renewal'],
    ['PA-BCA-00202', 'ACF2 16.0',                 '5655-L53', 'Sub-capacity MLC',         'BCA-CTR-2024-882', 'Client estate',           4200000,  'Yes — SCRT reporting active', 'Kavya Reddy',  '2026-09-30', '2026-09-30', 'Expiring Soon',  'Anand Iyer (Broadcom) anand.iyer@broadcom.com','Client evaluating migration to RACF — not renewing if decision made'],
  ];
  for (let i = 0; i < iwD.length; i++) {
    const [entitle,product,pid,licType,contractNo,msuTier,annualCost,subCapElect,scrtContact,renewal,swma,status,ibmCse,notes] = iwD[i];
    const rid = await cr(iwId, userId, i);
    await sc(rid,iw.entitle,'text',entitle); await sc(rid,iw.product,'text',product);
    await sc(rid,iw.pid,'text',pid); await sc(rid,iw.licType,'singleSelect',licType);
    await sc(rid,iw.contractNo,'text',contractNo); await sc(rid,iw.msuTier,'text',msuTier);
    await sc(rid,iw.annualCost,'number',annualCost); await sc(rid,iw.subCapElect,'singleSelect',subCapElect);
    await sc(rid,iw.scrtContact,'text',scrtContact); await sc(rid,iw.renewal,'date',renewal);
    await sc(rid,iw.swma,'date',swma); await sc(rid,iw.status,'singleSelect',status);
    await sc(rid,iw.ibmCse,'text',ibmCse); await sc(rid,iw.notes,'text',notes);
  }
  console.log('  IBM Contract & Wallet Register done — 14 entitlements');
  console.log('Mainframe SLM seed complete — 5 tables, 65 records');
}

module.exports = { seedMainframe };
