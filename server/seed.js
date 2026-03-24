// ============================================================
//  Ensono DataGrid — SLM Workspace Seed
//  8 SLM modules with realistic Ensono India data
//  Built by Sandesh Tilekar — Ensono India Operations
// ============================================================
'use strict';

const { nanoid } = require('nanoid');
const db = require('./db');
const makeId = () => nanoid(12);

async function f(tableId, name, type, order, options, isPrimary) {
  const id = makeId();
  await db.execute(
    'INSERT INTO fields (id, table_id, name, type, options, order_index, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, tableId, name, type, options ? JSON.stringify(options) : null, order, isPrimary || 0]
  );
  return id;
}
async function tbl(baseId, name, order) {
  const id = makeId();
  await db.execute('INSERT INTO `tables` (id, base_id, name, order_index) VALUES (?, ?, ?, ?)', [id, baseId, name, order]);
  return id;
}
async function rec(tableId, userId, order) {
  const id = makeId();
  await db.execute('INSERT INTO records (id, table_id, order_index, created_by) VALUES (?, ?, ?, ?)', [id, tableId, order, userId]);
  return id;
}
async function cel(recordId, fieldId, type, value) {
  if (value === null || value === undefined || value === '') return;
  let vt = null, vn = null, vb = null, vj = null;
  if (type === 'checkbox') vb = value ? 1 : 0;
  else if (type === 'number' || type === 'rating') vn = Number(value);
  else if (type === 'multiSelect') vj = JSON.stringify(value);
  else vt = String(value);
  await db.execute(
    `INSERT INTO cell_values (record_id, field_id, value_text, value_num, value_bool, value_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_text=VALUES(value_text), value_num=VALUES(value_num),
     value_bool=VALUES(value_bool), value_json=VALUES(value_json)`,
    [recordId, fieldId, vt, vn, vb, vj]
  );
}

async function seedPMWorkspace(wsId, baseId, userId) {
  console.log('Seeding SLM workspace...');
  await db.execute('DELETE FROM `tables` WHERE base_id = ?', [baseId]);

  // 1. SOFTWARE ASSET REGISTER
  const saId = await tbl(baseId, '💻 Software Asset Register', 0);
  const sa = {
    name:   await f(saId,'Software Name','text',0,null,1),
    vendor: await f(saId,'Vendor','text',1),
    ver:    await f(saId,'Version','text',2),
    env:    await f(saId,'Environment','singleSelect',3,{options:['Production','Staging','DR','Dev','Test']}),
    status: await f(saId,'Status','singleSelect',4,{options:['Active','Deprecated','EOL','Planned','Decommissioned']}),
    owner:  await f(saId,'Asset Owner','text',5),
    eol:    await f(saId,'EOL Date','date',6),
    type:   await f(saId,'Type','singleSelect',7,{options:['COTS','Open Source','Custom Built','SaaS','PaaS','IaaS']}),
    tier:   await f(saId,'Business Tier','singleSelect',8,{options:['Tier 1 - Critical','Tier 2 - Important','Tier 3 - Standard']}),
    users:  await f(saId,'User Count','number',9),
    cost:   await f(saId,'Annual Cost USD','number',10),
    notes:  await f(saId,'Notes','text',11),
  };
  const saData = [
    ['ServiceNow ITSM','ServiceNow','Vancouver','Production','Active','Priya Sharma','2027-06-30','SaaS','Tier 1 - Critical',450,185000,'Core ITSM. CAB, incident, change management.'],
    ['Snowflake','Snowflake Inc.','7.40','Production','Active','Vikram Singh','2026-12-31','SaaS','Tier 1 - Critical',120,95000,'Enterprise analytics. BI and reporting platform.'],
    ['GitHub Enterprise','GitHub (MS)','3.11','Production','Active','Arjun Mehta','2027-01-31','SaaS','Tier 1 - Critical',383,42000,'Source control for all India engineering teams.'],
    ['Ensono DataGrid','Ensono Internal','1.1.1','Production','Active','Sandesh Tilekar',null,'Custom Built','Tier 2 - Important',85,1440,'Internal SLM platform. Railway hosted.'],
    ['Jira Software Cloud','Atlassian','Cloud','Production','Active','Neha Patel','2026-08-31','SaaS','Tier 2 - Important',200,28000,'Project tracking. DataGrid migration evaluation.'],
    ['Splunk Enterprise','Splunk (Cisco)','9.1','Production','Active','Ravi Kumar','2026-09-30','COTS','Tier 1 - Critical',25,68000,'SIEM and log management. Renewal negotiation in progress.'],
    ['Microsoft 365','Microsoft','E3','Production','Active','Ananya Iyer','2027-03-31','SaaS','Tier 1 - Critical',500,96000,'Productivity suite for all Ensono India staff.'],
    ['SolarWinds NPM','SolarWinds','2023.4','Production','Active','Ravi Kumar','2026-11-30','COTS','Tier 1 - Critical',15,32000,'Network performance monitoring. On-prem.'],
    ['Dynatrace','Dynatrace','SaaS','Production','Active','Vikram Singh','2027-02-28','SaaS','Tier 1 - Critical',30,52000,'APM and infrastructure monitoring. AIOps.'],
    ['Red Hat Enterprise Linux','Red Hat (IBM)','8.9','Production','Active','Ravi Kumar','2029-05-31','COTS','Tier 1 - Critical',38,48000,'Primary OS for production app servers.'],
    ['Windows Server 2016','Microsoft','2016','Production','Deprecated','Ravi Kumar','2026-12-31','COTS','Tier 2 - Important',12,0,'EOL Jan 2027. Upgrade plan required Q3 2026.'],
    ['Oracle JDK','Oracle','17 LTS','Production','Active','Arjun Mehta','2026-09-30','COTS','Tier 2 - Important',45,8500,'Java runtime. Audit risk. Migrate to OpenJDK.'],
    ['Puppet Enterprise','Perforce','8.5','Production','Active','Ravi Kumar','2026-07-31','COTS','Tier 2 - Important',8,15000,'Config management. Terraform migration planned.'],
    ['Mimecast','Mimecast','4.2','Production','Active','Kavya Reddy','2026-10-31','SaaS','Tier 2 - Important',500,22000,'Email security and archiving.'],
    ['Confluence Cloud','Atlassian','Cloud','Production','Active','Neha Patel','2026-08-31','SaaS','Tier 2 - Important',200,18000,'Knowledge management. Renewal under review.'],
  ];
  for (let i=0;i<saData.length;i++) {
    const [name,vendor,ver,env,status,owner,eol,type,tier,users,cost,notes]=saData[i];
    const rid=await rec(saId,userId,i);
    await cel(rid,sa.name,'text',name); await cel(rid,sa.vendor,'text',vendor);
    await cel(rid,sa.ver,'text',ver); await cel(rid,sa.env,'singleSelect',env);
    await cel(rid,sa.status,'singleSelect',status); await cel(rid,sa.owner,'text',owner);
    if(eol) await cel(rid,sa.eol,'date',eol); await cel(rid,sa.type,'singleSelect',type);
    await cel(rid,sa.tier,'singleSelect',tier); await cel(rid,sa.users,'number',users);
    await cel(rid,sa.cost,'number',cost); await cel(rid,sa.notes,'text',notes);
  }
  console.log('  Software Asset Register: 15 assets');

  // 2. LICENCE MANAGER
  const lmId = await tbl(baseId,'🔑 Licence Manager',1);
  const lm = {
    sw:      await f(lmId,'Software','text',0,null,1),
    type:    await f(lmId,'Licence Type','singleSelect',1,{options:['Per User','Per Device','Enterprise','Subscription','Open Source','Perpetual']}),
    owned:   await f(lmId,'Licences Owned','number',2),
    used:    await f(lmId,'Licences Used','number',3),
    avail:   await f(lmId,'Available','number',4),
    status:  await f(lmId,'Compliance','singleSelect',5,{options:['Compliant','Over-licensed','Under-licensed','Review Required','Expired']}),
    cost:    await f(lmId,'Annual Cost USD','number',6),
    renewal: await f(lmId,'Renewal Date','date',7),
    owner:   await f(lmId,'Licence Owner','text',8),
    notes:   await f(lmId,'Notes','text',9),
  };
  const lmData = [
    ['ServiceNow ITSM','Enterprise',500,450,50,'Compliant',185000,'2027-06-30','Priya Sharma','50 spare licences for growth headroom.'],
    ['Snowflake','Enterprise',150,121,29,'Compliant',95000,'2026-12-31','Vikram Singh','Compute credits tracked separately in AWS.'],
    ['GitHub Enterprise','Per User',400,383,17,'Compliant',42000,'2027-01-31','Arjun Mehta','17 spare. New joiners auto-provisioned via SSO.'],
    ['Microsoft 365 E3','Per User',500,498,2,'Review Required',96000,'2027-03-31','Ananya Iyer','Only 2 spares. Headcount growth imminent.'],
    ['Jira Software','Per User',200,194,6,'Compliant',28000,'2026-08-31','Neha Patel','Renewal review — DataGrid may replace.'],
    ['Confluence','Per User',200,187,13,'Over-licensed',18000,'2026-08-31','Neha Patel','13 unused. Reduce at renewal.'],
    ['Splunk Enterprise','Enterprise',50,48,2,'Compliant',68000,'2026-09-30','Ravi Kumar','Ingest-based. 50GB/day. Threshold: 55GB.'],
    ['SolarWinds NPM','Per Device',20,18,2,'Compliant',32000,'2026-11-30','Ravi Kumar','2 device licences spare.'],
    ['Dynatrace','Subscription',40,38,2,'Compliant',52000,'2027-02-28','Vikram Singh','Host units model. 2 units spare.'],
    ['Oracle JDK','Per User',50,44,6,'Review Required',8500,'2026-09-30','Arjun Mehta','Audit risk. Migrate to OpenJDK urgently.'],
    ['Red Hat Enterprise Linux','Subscription',40,38,2,'Compliant',48000,'2029-05-31','Ravi Kumar','3-year subscription. Value contract.'],
    ['Puppet Enterprise','Per Node',10,8,2,'Compliant',15000,'2026-07-31','Ravi Kumar','May not renew — Terraform migration.'],
    ['Windows Server 2016','Perpetual',15,12,3,'Review Required',0,'2026-12-31','Ravi Kumar','EOL Jan 2027. Upgrade budget in Q3 plan.'],
    ['Mimecast','Per User',500,498,2,'Review Required',22000,'2026-10-31','Kavya Reddy','Near capacity. Increase at next renewal.'],
  ];
  for (let i=0;i<lmData.length;i++) {
    const [sw,type,owned,used,avail,status,cost,renewal,owner,notes]=lmData[i];
    const rid=await rec(lmId,userId,i);
    await cel(rid,lm.sw,'text',sw); await cel(rid,lm.type,'singleSelect',type);
    await cel(rid,lm.owned,'number',owned); await cel(rid,lm.used,'number',used);
    await cel(rid,lm.avail,'number',avail); await cel(rid,lm.status,'singleSelect',status);
    await cel(rid,lm.cost,'number',cost); await cel(rid,lm.renewal,'date',renewal);
    await cel(rid,lm.owner,'text',owner); await cel(rid,lm.notes,'text',notes);
  }
  console.log('  Licence Manager: 14 licences');

  // 3. CONTRACT REGISTER
  const crId = await tbl(baseId,'📄 Contract Register',2);
  const cr = {
    title:   await f(crId,'Contract Title','text',0,null,1),
    vendor:  await f(crId,'Vendor','text',1),
    type:    await f(crId,'Type','singleSelect',2,{options:['SaaS Subscription','Support & Maintenance','Professional Services','Managed Service','NDA','MSA','SOW']}),
    value:   await f(crId,'Annual Value USD','number',3),
    start:   await f(crId,'Start Date','date',4),
    end:     await f(crId,'End Date','date',5),
    status:  await f(crId,'Status','singleSelect',6,{options:['Active','Expiring Soon','Expired','Under Review','Negotiating','Terminated']}),
    owner:   await f(crId,'Contract Owner','text',7),
    sla:     await f(crId,'SLA Uptime','text',8),
    renew:   await f(crId,'Auto-Renew','checkbox',9),
    notice:  await f(crId,'Notice Period','text',10),
    notes:   await f(crId,'Notes','text',11),
  };
  const crData = [
    ['ServiceNow Enterprise Agreement 2025-27','ServiceNow','SaaS Subscription',185000,'2025-07-01','2027-06-30','Active','Priya Sharma','99.8%',true,'90 days','Multi-year. ITSM + CSM + ITOM. Price locked to 2027.'],
    ['Snowflake Data Cloud Enterprise','Snowflake Inc.','SaaS Subscription',95000,'2025-01-01','2026-12-31','Expiring Soon','Vikram Singh','99.9%',false,'60 days','Usage growing 20% QoQ. Budget uplift needed at renewal.'],
    ['GitHub Enterprise Annual','GitHub (MS)','SaaS Subscription',42000,'2026-02-01','2027-01-31','Active','Arjun Mehta','99.9%',true,'30 days','Auto-renew. Price locked at current rate.'],
    ['Microsoft 365 E3 India','Microsoft','SaaS Subscription',96000,'2026-04-01','2027-03-31','Active','Ananya Iyer','99.9%',true,'60 days','EA through Microsoft India partner. E5 upgrade being evaluated.'],
    ['Splunk Enterprise Licence + Support','Splunk (Cisco)','Support & Maintenance',68000,'2025-10-01','2026-09-30','Expiring Soon','Ravi Kumar','99.5%',false,'90 days','Cisco acquisition may affect pricing. Evaluate alternatives.'],
    ['Dynatrace Platform Subscription','Dynatrace','SaaS Subscription',52000,'2026-03-01','2027-02-28','Active','Vikram Singh','99.95%',true,'30 days','Annual. Auto-renews. FSI discount applied.'],
    ['Red Hat Enterprise Linux 3yr','Red Hat (IBM)','Support & Maintenance',48000,'2026-06-01','2029-05-31','Active','Ravi Kumar','99.9%',false,'90 days','3-year deal. 15% volume discount. Best value contract.'],
    ['SolarWinds NPM Annual Maintenance','SolarWinds','Support & Maintenance',32000,'2025-12-01','2026-11-30','Expiring Soon','Ravi Kumar','N/A',false,'45 days','Evaluating alternatives at renewal.'],
    ['Jira + Confluence Cloud Annual','Atlassian','SaaS Subscription',46000,'2025-09-01','2026-08-31','Expiring Soon','Neha Patel','99.9%',false,'30 days','DataGrid migration may reduce renewal scope.'],
    ['Infosys Managed Infra Support','Infosys','Managed Service',240000,'2024-04-01','2027-03-31','Active','Sandesh Tilekar','99.5%',false,'180 days','Primary MSP. SLA review Q2 2026.'],
    ['Puppet Enterprise Annual','Perforce','SaaS Subscription',15000,'2025-08-01','2026-07-31','Expiring Soon','Ravi Kumar','N/A',false,'30 days','Unlikely to renew. Terraform migration in progress.'],
    ['Mimecast Cloud Archive','Mimecast','SaaS Subscription',22000,'2025-11-01','2026-10-31','Expiring Soon','Kavya Reddy','99.9%',false,'60 days','Evaluate M365 native archiving at renewal.'],
  ];
  for (let i=0;i<crData.length;i++) {
    const [title,vendor,type,value,start,end,status,owner,sla,renew,notice,notes]=crData[i];
    const rid=await rec(crId,userId,i);
    await cel(rid,cr.title,'text',title); await cel(rid,cr.vendor,'text',vendor);
    await cel(rid,cr.type,'singleSelect',type); await cel(rid,cr.value,'number',value);
    await cel(rid,cr.start,'date',start); await cel(rid,cr.end,'date',end);
    await cel(rid,cr.status,'singleSelect',status); await cel(rid,cr.owner,'text',owner);
    await cel(rid,cr.sla,'text',sla); await cel(rid,cr.renew,'checkbox',renew);
    await cel(rid,cr.notice,'text',notice); await cel(rid,cr.notes,'text',notes);
  }
  console.log('  Contract Register: 12 contracts');

  // 4. CHANGE REGISTER
  const chId = await tbl(baseId,'🔄 Change Register',3);
  const ch = {
    cid:      await f(chId,'Change ID','text',0,null,1),
    title:    await f(chId,'Title','text',1),
    type:     await f(chId,'Type','singleSelect',2,{options:['Standard','Normal','Emergency','Major']}),
    risk:     await f(chId,'Risk Level','singleSelect',3,{options:['Critical','High','Medium','Low']}),
    status:   await f(chId,'Status','singleSelect',4,{options:['Draft','Submitted','CAB Review','Approved','Scheduled','Implementing','Completed','Failed','Rolled Back','Cancelled']}),
    requester:await f(chId,'Requester','text',5),
    assignee: await f(chId,'Assigned To','text',6),
    planned:  await f(chId,'Planned Date','date',7),
    cab:      await f(chId,'CAB Approved By','text',8),
    impact:   await f(chId,'Impact','text',9),
    rollback: await f(chId,'Rollback Plan','text',10),
    notes:    await f(chId,'Notes','text',11),
  };
  const chData = [
    ['CHG-2026-001','ServiceNow upgrade to Vancouver patch 3','Normal','Medium','Completed','Priya Sharma','Priya Sharma','2026-02-15','Sandesh Tilekar','All SNOW users during maintenance window','Rollback via snapshot','Completed successfully. Duration: 2h15m.'],
    ['CHG-2026-002','Snowflake warehouse size increase XL','Standard','Low','Completed','Vikram Singh','Vikram Singh','2026-02-20','Sandesh Tilekar','2 min performance impact during resize','Revert via ALTER WAREHOUSE','Auto-approved standard change. Zero downtime.'],
    ['CHG-2026-003','RHEL servers OS patch CVE-2026-0847','Normal','High','Completed','Ravi Kumar','Ravi Kumar','2026-03-01','Sandesh Tilekar','38 servers — 30min rolling restart','Rollback via yum downgrade','All 38 patched. One server manual intervention.'],
    ['CHG-2026-004','DataGrid production deployment v1.1.1','Normal','Medium','Completed','Sandesh Tilekar','Sandesh Tilekar','2026-03-24','Sandesh Tilekar','Brief reconnect during PM2 reload','Git revert + pm2 reload','Zero downtime via Railway. All SLM modules live.'],
    ['CHG-2026-005','GitHub Enterprise enable SAML SSO','Normal','Medium','Completed','Arjun Mehta','Arjun Mehta','2026-03-05','Sandesh Tilekar','All 383 users re-authenticate post-change','Disable SAML; revert to password auth','SSO enabled. 3 users needed manual support.'],
    ['CHG-2026-006','Windows Server 2016 decommission','Normal','High','Approved','Ravi Kumar','Ravi Kumar','2026-04-15','Sandesh Tilekar','Legacy WS2016 — app migrated to RHEL8','Restore VM from snapshot','Pre-change: app migration complete.'],
    ['CHG-2026-007','Dynatrace agent rollout 8 microservices','Standard','Low','Scheduled','Vikram Singh','Vikram Singh','2026-04-10','Auto-approved','Monitoring gap until agents deployed','Remove agents; no data loss','Standard pre-approved. Ansible deployment.'],
    ['CHG-2026-008','Puppet Enterprise decommission','Major','High','CAB Review','Ravi Kumar','Sandesh Tilekar','2026-05-01','Pending CAB','8 nodes must migrate before decommission','Retain Puppet; pause Terraform','CAB 1 Apr 2026. Architecture review done.'],
    ['CHG-2026-009','Oracle JDK compliance remediation','Emergency','Critical','Implementing','Arjun Mehta','Arjun Mehta','2026-03-28','Sandesh Tilekar','44 app instances — brief restart','Revert JDK; restore from backup','Emergency post Oracle audit. ETA 48hrs.'],
    ['CHG-2026-010','Splunk retention policy 90 to 180 days','Normal','Low','Completed','Ravi Kumar','Ravi Kumar','2026-03-10','Sandesh Tilekar','Storage +2TB. No user impact.','Revert retention config','Successful. Licence compliance maintained.'],
  ];
  for (let i=0;i<chData.length;i++) {
    const [cid,title,type,risk,status,requester,assignee,planned,cab,impact,rollback,notes]=chData[i];
    const rid=await rec(chId,userId,i);
    await cel(rid,ch.cid,'text',cid); await cel(rid,ch.title,'text',title);
    await cel(rid,ch.type,'singleSelect',type); await cel(rid,ch.risk,'singleSelect',risk);
    await cel(rid,ch.status,'singleSelect',status); await cel(rid,ch.requester,'text',requester);
    await cel(rid,ch.assignee,'text',assignee); await cel(rid,ch.planned,'date',planned);
    await cel(rid,ch.cab,'text',cab); await cel(rid,ch.impact,'text',impact);
    await cel(rid,ch.rollback,'text',rollback); await cel(rid,ch.notes,'text',notes);
  }
  console.log('  Change Register: 10 changes');

  // 5. RELEASE TRACKER
  const rtId = await tbl(baseId,'🚀 Release Tracker',4);
  const rt = {
    name:    await f(rtId,'Release Name','text',0,null,1),
    sw:      await f(rtId,'Software','text',1),
    ver:     await f(rtId,'Version','text',2),
    type:    await f(rtId,'Type','singleSelect',3,{options:['Major','Minor','Patch','Hotfix','Security']}),
    env:     await f(rtId,'Target Env','singleSelect',4,{options:['Development','Testing','Staging','Production']}),
    status:  await f(rtId,'Status','singleSelect',5,{options:['Planning','Development','Testing','UAT','Go/No-Go','Deploying','Live','Failed','Rolled Back']}),
    owner:   await f(rtId,'Release Manager','text',6),
    planned: await f(rtId,'Planned Date','date',7),
    actual:  await f(rtId,'Actual Date','date',8),
    gng:     await f(rtId,'Go/No-Go','singleSelect',9,{options:['Go','No-Go','Conditional Go','Pending']}),
    notes:   await f(rtId,'Notes','text',10),
  };
  const rtData = [
    ['DataGrid v1.0.0 Initial','Ensono DataGrid','1.0.0','Major','Production','Live','Sandesh Tilekar','2026-03-20','2026-03-23','Go','Full stack: auth, workspaces, tables, real-time collab.'],
    ['DataGrid v1.0.1 Security','Ensono DataGrid','1.0.1','Security','Production','Live','Sandesh Tilekar','2026-03-22','2026-03-23','Go','13 vulnerabilities remediated. IDOR, XSS, lockout.'],
    ['DataGrid v1.1.0 Integrations','Ensono DataGrid','1.1.0','Minor','Production','Live','Sandesh Tilekar','2026-03-23','2026-03-23','Go','ServiceNow + Snowflake APIs. Architecture HLD v2.'],
    ['DataGrid v1.1.1 SLM Module','Ensono DataGrid','1.1.1','Minor','Production','Live','Sandesh Tilekar','2026-03-24','2026-03-24','Go','8 SLM modules. 101 records. trust proxy fix.'],
    ['DataGrid v1.2.0 SSO','Ensono DataGrid','1.2.0','Minor','Production','Planning','Sandesh Tilekar','2026-05-15',null,'Pending','Azure AD SAML SSO. Phase 2 roadmap.'],
    ['ServiceNow Vancouver Patch 3','ServiceNow','VP3','Patch','Production','Live','Priya Sharma','2026-02-15','2026-02-15','Go','Security patch. Maintenance window. No issues.'],
    ['ServiceNow Washington Release','ServiceNow','WA','Major','Staging','Testing','Priya Sharma','2026-06-30',null,'Pending','Major upgrade. 3 custom scripts need rewrite.'],
    ['Splunk 9.2 Upgrade','Splunk','9.2','Minor','Production','UAT','Ravi Kumar','2026-04-20',null,'Conditional Go','1 dashboard regression open. Fix before go-live.'],
    ['RHEL 8.10 Upgrade Batch 1','RHEL','8.10','Minor','Production','Planning','Ravi Kumar','2026-04-25',null,'Pending','13 servers. Rolling upgrade with pre-checks.'],
    ['Dynatrace Agent 1.281','Dynatrace','1.281','Patch','Production','Live','Vikram Singh','2026-03-18','2026-03-18','Go','Auto-update. Deployed to all monitored hosts.'],
  ];
  for (let i=0;i<rtData.length;i++) {
    const [name,sw,ver,type,env,status,owner,planned,actual,gng,notes]=rtData[i];
    const rid=await rec(rtId,userId,i);
    await cel(rid,rt.name,'text',name); await cel(rid,rt.sw,'text',sw);
    await cel(rid,rt.ver,'text',ver); await cel(rid,rt.type,'singleSelect',type);
    await cel(rid,rt.env,'singleSelect',env); await cel(rid,rt.status,'singleSelect',status);
    await cel(rid,rt.owner,'text',owner); await cel(rid,rt.planned,'date',planned);
    if(actual) await cel(rid,rt.actual,'date',actual);
    await cel(rid,rt.gng,'singleSelect',gng); await cel(rid,rt.notes,'text',notes);
  }
  console.log('  Release Tracker: 10 releases');

  // 6. INCIDENT LOG
  const ilId = await tbl(baseId,'🚨 Incident Log',5);
  const il = {
    iid:      await f(ilId,'Incident ID','text',0,null,1),
    title:    await f(ilId,'Title','text',1),
    sev:      await f(ilId,'Severity','singleSelect',2,{options:['P1 - Critical','P2 - High','P3 - Medium','P4 - Low']}),
    status:   await f(ilId,'Status','singleSelect',3,{options:['Open','In Progress','Escalated','Resolved','Closed','Post-Mortem']}),
    system:   await f(ilId,'Affected System','text',4),
    owner:    await f(ilId,'Incident Owner','text',5),
    reported: await f(ilId,'Reported Date','date',6),
    resolved: await f(ilId,'Resolved Date','date',7),
    hrs:      await f(ilId,'Duration (hrs)','number',8),
    rca:      await f(ilId,'Root Cause','text',9),
    fix:      await f(ilId,'Fix Applied','text',10),
    snow:     await f(ilId,'SNOW Ticket','text',11),
  };
  const ilData = [
    ['INC-2026-001','ServiceNow portal unavailable India region','P1 - Critical','Closed','ServiceNow ITSM','Priya Sharma','2026-01-14','2026-01-14',3.5,'US-East datacenter network partition. Failover delayed.','Traffic rerouted to EU-West. DNS TTL reduced to 60s.','INC0012847'],
    ['INC-2026-002','Snowflake query timeout — BI dashboard failure','P2 - High','Closed','Snowflake','Vikram Singh','2026-01-28','2026-01-28',1.5,'Runaway query consuming 80% warehouse capacity.','Query terminated. Timeout policy set to 300s.','INC0013105'],
    ['INC-2026-003','RHEL servers unreachable — Puppet agent conflict','P2 - High','Closed','Red Hat Linux','Ravi Kumar','2026-02-03','2026-02-03',2.0,'Puppet 8.4 conflict with RHEL 8.9 systemd.','Agent rolled back to 8.3. Puppet version pinned.','INC0013289'],
    ['INC-2026-004','Splunk indexing lag — 4hr security log gap','P2 - High','Post-Mortem','Splunk Enterprise','Ravi Kumar','2026-02-19','2026-02-19',4.5,'Indexer disk 92% full. Ingest pipeline paused.','Emergency disk expansion +1TB. Log rotation tightened.','INC0013587'],
    ['INC-2026-005','GitHub Actions CI/CD pipelines failing','P3 - Medium','Closed','GitHub Enterprise','Arjun Mehta','2026-02-25','2026-02-25',0.75,'GitHub US-West partial outage. India runners affected.','GitHub self-resolved. EU fallback runners added.','INC0013714'],
    ['INC-2026-006','Dynatrace alerting storm after deployment','P3 - Medium','Closed','Dynatrace','Vikram Singh','2026-03-05','2026-03-05',0.5,'New deployment missing baseline. 47 false alerts.','Baseline reset. Suppression window added to runbook.','INC0013901'],
    ['INC-2026-007','Oracle JDK audit — licence violation risk','P1 - Critical','In Progress','Oracle JDK','Arjun Mehta','2026-03-20',null,null,'Oracle audit. 44 JDK instances may violate licence.','Emergency CHG-2026-009 raised. Legal involved.','INC0014102'],
    ['INC-2026-008','Microsoft 365 MFA outage India users','P2 - High','Closed','Microsoft 365','Ananya Iyer','2026-03-12','2026-03-12',1.0,'Entra ID MFA service degradation. India region.','Microsoft resolved. Backup auth codes enabled.','INC0014008'],
  ];
  for (let i=0;i<ilData.length;i++) {
    const [iid,title,sev,status,system,owner,reported,resolved,hrs,rca,fix,snow]=ilData[i];
    const rid=await rec(ilId,userId,i);
    await cel(rid,il.iid,'text',iid); await cel(rid,il.title,'text',title);
    await cel(rid,il.sev,'singleSelect',sev); await cel(rid,il.status,'singleSelect',status);
    await cel(rid,il.system,'text',system); await cel(rid,il.owner,'text',owner);
    await cel(rid,il.reported,'date',reported);
    if(resolved) await cel(rid,il.resolved,'date',resolved);
    if(hrs) await cel(rid,il.hrs,'number',hrs);
    await cel(rid,il.rca,'text',rca); await cel(rid,il.fix,'text',fix);
    await cel(rid,il.snow,'text',snow);
  }
  console.log('  Incident Log: 8 incidents');

  // 7. SERVICE CATALOGUE
  const scId = await tbl(baseId,'📋 Service Catalogue',6);
  const sc = {
    name:    await f(scId,'Service Name','text',0,null,1),
    owner:   await f(scId,'Service Owner','text',1),
    cat:     await f(scId,'Category','singleSelect',2,{options:['Infrastructure','Application','Data & Analytics','Security','End User Computing','Managed Service','Integration']}),
    status:  await f(scId,'Status','singleSelect',3,{options:['Live','Maintenance','Degraded','Decommissioning','Planned']}),
    sla:     await f(scId,'SLA Target','text',4),
    uptime:  await f(scId,'Actual Uptime %','number',5),
    tier:    await f(scId,'Service Tier','singleSelect',6,{options:['Tier 1 - Critical','Tier 2 - Important','Tier 3 - Standard']}),
    rto:     await f(scId,'RTO','text',7),
    rpo:     await f(scId,'RPO','text',8),
    users:   await f(scId,'User Count','number',9),
    cost:    await f(scId,'Monthly Cost USD','number',10),
  };
  const scData = [
    ['ITSM Platform','Priya Sharma','Application','Live','99.8%',99.91,'Tier 1 - Critical','4 hours','1 hour',450,15417],
    ['Data Analytics Platform','Vikram Singh','Data & Analytics','Live','99.9%',99.94,'Tier 1 - Critical','2 hours','4 hours',120,7917],
    ['Source Code Management','Arjun Mehta','Application','Live','99.9%',99.98,'Tier 1 - Critical','4 hours','1 hour',383,3500],
    ['Project Management','Sandesh Tilekar','Application','Live','99.5%',99.87,'Tier 2 - Important','8 hours','24 hours',85,120],
    ['Network Monitoring','Ravi Kumar','Infrastructure','Live','99.9%',99.95,'Tier 1 - Critical','2 hours','N/A',15,2667],
    ['SIEM & Log Management','Ravi Kumar','Security','Live','99.5%',99.71,'Tier 1 - Critical','4 hours','1 hour',25,5667],
    ['APM & Observability','Vikram Singh','Infrastructure','Live','99.95%',100.0,'Tier 2 - Important','4 hours','N/A',30,4333],
    ['Email & Collaboration','Ananya Iyer','End User Computing','Live','99.9%',99.95,'Tier 1 - Critical','4 hours','1 hour',500,8000],
    ['Endpoint Security','Kavya Reddy','Security','Live','99.9%',99.99,'Tier 1 - Critical','4 hours','N/A',500,1833],
    ['Managed Infrastructure','Sandesh Tilekar','Managed Service','Live','99.5%',99.62,'Tier 1 - Critical','4 hours','1 hour',500,20000],
    ['Config Management','Ravi Kumar','Infrastructure','Maintenance','99.0%',98.5,'Tier 2 - Important','8 hours','4 hours',8,1250],
    ['ServiceNow-Snowflake Integration','Priya Sharma','Integration','Live','99.5%',99.78,'Tier 2 - Important','4 hours','2 hours',45,2500],
  ];
  for (let i=0;i<scData.length;i++) {
    const [name,owner,cat,status,sla,uptime,tier,rto,rpo,users,cost]=scData[i];
    const rid=await rec(scId,userId,i);
    await cel(rid,sc.name,'text',name); await cel(rid,sc.owner,'text',owner);
    await cel(rid,sc.cat,'singleSelect',cat); await cel(rid,sc.status,'singleSelect',status);
    await cel(rid,sc.sla,'text',sla); await cel(rid,sc.uptime,'number',uptime);
    await cel(rid,sc.tier,'singleSelect',tier); await cel(rid,sc.rto,'text',rto);
    await cel(rid,sc.rpo,'text',rpo); await cel(rid,sc.users,'number',users);
    await cel(rid,sc.cost,'number',cost);
  }
  console.log('  Service Catalogue: 12 services');

  // 8. VENDOR REGISTER
  const vrId = await tbl(baseId,'🤝 Vendor Register',7);
  const vr = {
    name:    await f(vrId,'Vendor Name','text',0,null,1),
    cat:     await f(vrId,'Category','singleSelect',1,{options:['Software','Infrastructure','Cloud','Professional Services','MSP','Security','Hardware']}),
    status:  await f(vrId,'Status','singleSelect',2,{options:['Strategic','Preferred','Approved','Under Review','Blacklisted','Exiting']}),
    contact: await f(vrId,'Account Manager','text',3),
    email:   await f(vrId,'Contact Email','email',4),
    spend:   await f(vrId,'Annual Spend USD','number',5),
    rating:  await f(vrId,'Performance','rating',6),
    risk:    await f(vrId,'Vendor Risk','singleSelect',7,{options:['Critical','High','Medium','Low']}),
    renewal: await f(vrId,'Next Renewal','date',8),
    owner:   await f(vrId,'Ensono Owner','text',9),
    notes:   await f(vrId,'Notes','text',10),
  };
  const vrData = [
    ['ServiceNow','Software','Strategic','Rajiv Nair','rnair@servicenow.com',185000,5,'High','2027-06-30','Priya Sharma','Primary ITSM vendor. Excellent account management.'],
    ['Microsoft','Software','Strategic','Aisha Mehrotra','amehrotra@microsoft.com',138000,4,'High','2027-03-31','Ananya Iyer','M365 + Azure + GitHub. EA negotiation due 2027.'],
    ['Snowflake Inc.','Cloud','Strategic','Suresh Patel','spatel@snowflake.com',95000,5,'Medium','2026-12-31','Vikram Singh','Data platform. Strong partnership. Usage growing.'],
    ['Infosys','MSP','Strategic','Deepak Sharma','dsharma@infosys.com',240000,3,'Critical','2027-03-31','Sandesh Tilekar','Primary MSP. SLA met 94%. Performance review Q2.'],
    ['Red Hat (IBM)','Software','Preferred','Meena Krishnan','mkrishnan@redhat.com',48000,5,'Medium','2029-05-31','Ravi Kumar','Excellent support. 3-year deal locked.'],
    ['Dynatrace','Software','Preferred','Kiran Joshi','kjoshi@dynatrace.com',52000,5,'Medium','2027-02-28','Vikram Singh','Best-in-class APM. Strong ROI. Expanding usage.'],
    ['Splunk (Cisco)','Software','Preferred','Rahul Verma','rverma@splunk.com',68000,4,'High','2026-09-30','Ravi Kumar','Post-Cisco pricing unclear. Evaluate alternatives.'],
    ['Atlassian','Software','Under Review','Pooja Agarwal','pagarwal@atlassian.com',46000,3,'Low','2026-08-31','Neha Patel','Jira + Confluence. DataGrid migration evaluation.'],
    ['SolarWinds','Software','Approved','Vijay Iyer','viyer@solarwinds.com',32000,3,'Medium','2026-11-30','Ravi Kumar','Post-breach trust issues. Evaluating alternatives.'],
    ['Mimecast','Security','Approved','Sunita Rao','srao@mimecast.com',22000,4,'Low','2026-10-31','Kavya Reddy','Good email security. M365 native alternative eval.'],
    ['Perforce (Puppet)','Software','Exiting','Amit Gupta','agupta@perforce.com',15000,3,'Low','2026-07-31','Ravi Kumar','Unlikely to renew. Terraform migration in progress.'],
    ['Oracle','Software','Under Review','Natasha Singh','nsingh@oracle.com',8500,2,'Critical','2026-09-30','Arjun Mehta','Audit risk. Aggressive licensing. Migrate to OpenJDK.'],
  ];
  for (let i=0;i<vrData.length;i++) {
    const [name,cat,status,contact,email,spend,rating,risk,renewal,owner,notes]=vrData[i];
    const rid=await rec(vrId,userId,i);
    await cel(rid,vr.name,'text',name); await cel(rid,vr.cat,'singleSelect',cat);
    await cel(rid,vr.status,'singleSelect',status); await cel(rid,vr.contact,'text',contact);
    await cel(rid,vr.email,'email',email); await cel(rid,vr.spend,'number',spend);
    await cel(rid,vr.rating,'rating',rating); await cel(rid,vr.risk,'singleSelect',risk);
    await cel(rid,vr.renewal,'date',renewal); await cel(rid,vr.owner,'text',owner);
    await cel(rid,vr.notes,'text',notes);
  }
  console.log('  Vendor Register: 12 vendors');
  console.log('SLM seed complete: 8 modules, 103 records');
}

module.exports = { seedPMWorkspace };
