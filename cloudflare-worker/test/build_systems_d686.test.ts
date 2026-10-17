/** D686 #1593: independent Workspace and mapping contracts. No provider requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import build from '../src/routes/cycle_build.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'x'.repeat(64); // synthetic test fixture
const migration = readFileSync('cloudflare-worker/sql/migrations/441_build_cycle_stores.sql', 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT, founder_id INTEGER, spinout_lab_active INTEGER DEFAULT 0, name TEXT, is_active INTEGER DEFAULT 1, jwt_min_iat INTEGER DEFAULT 0);
    CREATE TABLE super_admins(user_id INTEGER PRIMARY KEY);
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state(user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
    CREATE TABLE user_company_links(user_id INTEGER, company_id INTEGER);
    CREATE TABLE projects(id INTEGER PRIMARY KEY, founder_id INTEGER, company_id INTEGER, entity_id INTEGER, incorporation_meta TEXT, cofounder_decision_meta TEXT, deleted_at TEXT);
    CREATE TABLE mvp_features(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT, added_value TEXT DEFAULT 'High', effort TEXT DEFAULT 'M', delivery_status TEXT DEFAULT 'Backlog', sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pain_groups(id INTEGER PRIMARY KEY, project_id INTEGER, title TEXT);
    CREATE TABLE hypotheses(id INTEGER PRIMARY KEY, project_id INTEGER, claim TEXT);
    CREATE TABLE roadmap_okrs(id INTEGER PRIMARY KEY, project_id INTEGER, objective TEXT, kanban_status TEXT, sort_order INTEGER DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE okr_column_moves(id INTEGER PRIMARY KEY, project_id INTEGER, okr_id INTEGER, to_status TEXT, moved_at TEXT);
    CREATE TABLE cap_table_holders(id INTEGER PRIMARY KEY, user_id INTEGER, project_id INTEGER, name TEXT, shares REAL, ownership_pct REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE cap_table_vesting(id INTEGER PRIMARY KEY, user_id INTEGER, holder_id INTEGER, start_date TEXT, cliff_months INTEGER, total_months INTEGER, vested_shares REAL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, template_name TEXT, created_at TEXT);
    CREATE TABLE cofounder_agreement_parties(id INTEGER PRIMARY KEY, document_id INTEGER, user_id INTEGER);
    CREATE TABLE entity_obligations(id INTEGER PRIMARY KEY, entity_id INTEGER, title TEXT, due_date TEXT, status TEXT, kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE entities(id INTEGER PRIMARY KEY, jurisdiction TEXT);
    CREATE TABLE incorporations(id INTEGER PRIMARY KEY, project_id INTEGER, status TEXT, paid_at TEXT, packet_ready_at TEXT, filed_on TEXT, jurisdiction_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE integrations(id INTEGER PRIMARY KEY, uid TEXT, user_id INTEGER, provider_key TEXT, display_name TEXT, status TEXT, last_synced_at TEXT, last_error_at TEXT);
    CREATE TABLE integration_companies(integration_id INTEGER, company_id INTEGER, enabled INTEGER);
    CREATE TABLE ritual_runs(id INTEGER PRIMARY KEY, project_id INTEGER, run_date TEXT, state TEXT);
    CREATE TABLE spinout_applications(id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, answers_json TEXT);
    CREATE TABLE activity_logs(id INTEGER PRIMARY KEY, project_id INTEGER, user_id INTEGER, action TEXT, details TEXT, actor TEXT);
    INSERT INTO users(id, role, founder_id, name) VALUES (1, 'founder', 11, 'One'), (2, 'founder', 22, 'Two'), (3, 'admin', NULL, 'Admin'), (4, 'partner', NULL, 'Partner');
    INSERT INTO projects(id, founder_id, company_id, entity_id) VALUES (101, 11, 10, 501), (202, 22, 20, 502);
    INSERT INTO user_company_links VALUES (1, 10), (2, 20);
    INSERT INTO entities VALUES (501, 'DE'), (502, 'NY');
  `);
  db.exec(migration);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/455_core_systems_workspace.sql', 'utf8'));
  db.exec('CREATE TABLE google_oauth_tokens(user_id INTEGER PRIMARY KEY); CREATE TABLE microsoft_oauth_tokens(user_id INTEGER PRIMARY KEY)');
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' } as any;
  return { db, env };
}


function appFor(route=build){const app=new Hono<any>();app.route('/api/cycles/build',route);app.onError((e,c)=>c.json({error:e.message},500));return app;}
async function request(route:any,env:any,path:string,id=1,method='GET',body?:unknown){
 const token=await new SignJWT({user_id:id,role:id===3?'admin':id===4?'partner':'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
 const r=await appFor(route).request('/api/cycles/build'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
 return {status:r.status,body:await r.json() as any};
}
function connectors(db:any){
 db.exec("INSERT INTO integrations(id,uid,user_id,provider_key,display_name,status,last_error_at) VALUES(11,'own-crm',1,'hubspot','Private own account','active',NULL),(12,'foreign-crm',2,'salesforce','Private teammate account','error','2026-10-09 08:15:00'),(13,'disabled-crm',1,'hubspot','Disabled','active',NULL),(14,'own-payments',1,'stripe','Private payments','active',NULL); INSERT INTO user_company_links VALUES(2,10); INSERT INTO integration_companies VALUES(11,10,1),(12,10,1),(13,10,0),(14,10,1)");
}
const snap=(got:unknown,want:unknown)=>assert.deepEqual(got,want);
type MutationCheck = { name: string; before: string; after: string; run: (route: any) => Promise<void>; secondBefore?: string; secondAfter?: string; thirdBefore?: string; thirdAfter?: string };
const checks: MutationCheck[]=[
 {name:'Tools history includes only enabled current members, with canonical fields and private owner names',before:"viewerMember ? tool.owner_name ?? null : null",after:"tool.owner_name ?? null",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);
 const member=await request(route,env,'/modules/operating-systems?project=101'),admin=await request(route,env,'/modules/operating-systems?project=101',3),partner=await request(route,env,'/modules/operating-systems?project=101',4);
 const by=(r:any,id:string)=>r.body.parts.tools.rows.find((row:any)=>row.id===id);
 const owned=by(member,'tool-0'),team=by(member,'tool-1'),outside=by(admin,'tool-1'),partnerRow=by(partner,'tool-1');
 const before=member.body.parts.tools.total;db.exec('DELETE FROM user_company_links WHERE user_id=2 AND company_id=10');
 const departed=await request(route,env,'/modules/operating-systems?project=101');
 snap([member.status,before,owned?.cells.tool,owned?.cells.owner,team?.cells.tool,team?.cells.owner,outside?.cells.owner,partner.status,partnerRow?.cells.owner,JSON.stringify(admin.body).includes('Private teammate account'),JSON.stringify(partner.body).includes('Private teammate account'),member.body.parts.tools.rows.some((r:any)=>r.cells.tool==='HubSpot' && r.cells.owner!=='You'),departed.body.parts.tools.rows.some((r:any)=>r.cells.tool==='Salesforce')],
 [200,3,'HubSpot','You','Salesforce','Two',null,200,null,false,false,false,false]);db.close();}},
 {name:'Tools counts and failing action include an unmapped failing provider',before:"const failingTool = tools.find(tool => tool.status === 'error' && getDescriptor(tool.provider_key));",after:"const failingTool = undefined;",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);const r=await request(route,env,'/modules/operating-systems?project=101');
 const action=r.body.parts.tools.rows.find((row:any)=>row.id==='tool-1').cells.action;
 snap([r.body.facts.tools_connected,r.body.facts.tools_failing,r.body.facts.tools_total,r.body.card.next?.text ?? null,r.body.card.next?.href ?? null,action,r.body.parts.tools.rows.find((row:any)=>row.id==='tool-0').cells.feeds],
 [2,1,3,'Reconnect Salesforce · failing since 9 Oct','/build/connect?tool=salesforce&project_id=101',{text:'Open',href:'/build/connect?tool=salesforce&project_id=101'},'Capital relationships · Network']);db.close();}},

 {name:'The five tiles and rows name Workspace',before:"workspace: 'Workspace'",after:"workspace: 'Analytics'",run:async(route:any)=>{
 const {db,env}=fixture();db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,updated_by) VALUES(101,'crm',NULL,1)");const r=await request(route,env,'/modules/operating-systems?project=101');
 snap([r.status,r.body.records.rows.map((r:any)=>r.cells.system),r.body.card.series[0].items.map((r:any)=>r.label)],
 [200,['Bank','Accounting','Payroll','CRM','Workspace'],['Bank','Accounting','Payroll','CRM','Workspace']]);db.close();}},
 {name:'Workspace requires both its mapper token and company membership',before:"SELECT 1 FROM google_oauth_tokens WHERE user_id = ?",after:"SELECT 1 WHERE ? > 0",run:async(route:any)=>{
 const {db,env}=fixture();db.exec("INSERT INTO project_core_systems(project_id,kind,provider_key,updated_by) VALUES(101,'workspace','google_calendar',1)");
 const read=async()=>{const r=await request(route,env,'/modules/operating-systems?project=101');return [r.body.records.rows.find((r:any)=>r.id==='workspace').cells.state,r.body.facts.connected,r.body.facts.total];};
 const before=await read();db.exec('INSERT INTO google_oauth_tokens VALUES(1)');const connected=await read();db.exec('DELETE FROM user_company_links WHERE user_id=1');const left=await read();
 snap([before,connected,left],[['Not connected',0,5],['Connected',1,5],['Not connected',0,5]]);db.close();}},
 {name:'An owned uid writes; a foreign uid is refused; null unmaps',before:"AND i.user_id = ? AND ic.company_id = ? AND ic.enabled = 1",after:"AND ? > 0 AND ic.company_id = ? AND ic.enabled = 1",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);const put=(body:any)=>request(route,env,'/systems/crm?project=101',1,'PUT',body);
 const own=await put({integration_uid:'own-crm',used_by:'Sales'}),foreign=await put({integration_uid:'foreign-crm'});
 const row:any=db.prepare("SELECT integration_id,updated_by,used_by FROM project_core_systems WHERE kind='crm'").get();
 const unmap=await put({integration_uid:null});const cleared:any=db.prepare("SELECT integration_id FROM project_core_systems WHERE kind='crm'").get();
 snap([own.status,foreign.status,row.integration_id,row.updated_by,row.used_by,unmap.status,cleared.integration_id],[200,403,11,1,'Sales',200,null]);db.close();}},
 {name:'Category mismatch is refused; unknown kinds have invalid_kind',before:"kind === 'crm' && CONNECTOR_METADATA[providerKey]?.category === 'CRM'",after:"kind === 'crm'",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);const wrong=await request(route,env,'/systems/crm?project=101',1,'PUT',{integration_uid:'own-payments'});
 const unknown=await request(route,env,'/systems/product_analytics?project=101',1,'PUT',{integration_uid:null});
 snap([wrong.status,wrong.body.error,unknown.status,unknown.body.error],[400,'kind_mismatch',400,'invalid_kind']);db.close();}},
 {name:'Choices include only owned enabled category matches and personal Workspace tokens',before:"WHERE i.user_id = ? ORDER BY i.id",after:"WHERE ? > 0 ORDER BY i.id",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec('INSERT INTO microsoft_oauth_tokens VALUES(1)');
 const r=await request(route,env,'/systems/choices?project=101'),other=await request(route,env,'/systems/choices?project=101',3);
 snap([r.status,r.body.kinds.map((k:any)=>[k.kind,k.label,k.choices]),other.status,other.body.error],
 [200,[['bank','Bank',[]],['accounting','Accounting',[]],['payroll','Payroll',[]],['crm','CRM',[{uid:'own-crm',provider_key:'hubspot',display_name:'HubSpot',category:'CRM'}]],['workspace','Workspace',[{uid:null,provider_key:'microsoft_365',display_name:'Microsoft 365',category:'Calendar and workspace'}]]],403,'not_in_company']);db.close();}},
 {name:'Workspace PUT verifies a token, persists its mapper and deletes on unmap',before:"if (!await workspaceConnected(c.env, ctx.user.id, providerKey))",after:"if (false)",run:async(route:any)=>{
 const {db,env}=fixture();const put=(body:any)=>request(route,env,'/systems/workspace?project=101',1,'PUT',body);
 const absent=await put({provider_key:'google_calendar'});db.exec('INSERT INTO google_oauth_tokens VALUES(1)');
 const connected=await put({provider_key:'google_calendar',used_by:'Meetings'});const row:any=db.prepare("SELECT provider_key,integration_id,updated_by FROM project_core_systems WHERE kind='workspace'").get();
 const cleared=await put({provider_key:null});const n:any=db.prepare("SELECT COUNT(*) n FROM project_core_systems WHERE kind='workspace'").get();
 snap([absent.status,absent.body.error,connected.status,row.provider_key,row.integration_id,row.updated_by,cleared.status,n.n],[403,'workspace_not_connected',200,'google_calendar',null,1,200,0]);db.close();}},
 {name:'Another member’s private connector name is absent from core rows',before:"c.user_id === viewer.id",after:"true",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,updated_by) VALUES(101,'crm',12,2)");
 const owner=await request(route,env,'/modules/operating-systems?project=101',2),member=await request(route,env,'/modules/operating-systems?project=101',1),admin=await request(route,env,'/modules/operating-systems?project=101',3);
 snap([owner.status,member.body.records.rows.find((r:any)=>r.id==='crm').cells.provider,admin.body.records.rows.find((r:any)=>r.id==='crm').cells.provider,JSON.stringify(admin.body).includes('Private teammate account')],
 [403,'Salesforce','Salesforce',false]);db.close();}},
 {name:'A failing system links its provider rather than its kind',before:"reconnect(failedSystem.provider_key, failedSystem.last_error_at, p.id, SYSTEM_LABEL[failing!])",after:"reconnect(failing, failedSystem.last_error_at, p.id, SYSTEM_LABEL[failing!])",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,updated_by) VALUES(101,'crm',12,2)");
 const r=await request(route,env,'/modules/operating-systems?project=101');snap([r.body.card.next.text,r.body.card.next.href],['Reconnect Salesforce · failing since 9 Oct','/build/connect?tool=salesforce&project_id=101']);db.close();}},
 {name:'Failed at is recorded per tool while a healthy tool has no failure time',before:"i.last_error_at, u.name AS owner_name",after:"NULL AS last_error_at, u.name AS owner_name",secondBefore:"failed_at: tool.last_error_at ?? null",secondAfter:"failed_at: null",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);const r=await request(route,env,'/modules/operating-systems?project=101');
 const columns=r.body.parts.tools.cols.map((c:any)=>[c.key,c.label]);
 snap([r.status,columns.filter((c:any)=>c[0]==='failed_at').length,columns.find((c:any)=>c[0]==='failed_at'),r.body.parts.tools.rows.find((row:any)=>row.id==='tool-0').cells.failed_at,r.body.parts.tools.rows.find((row:any)=>row.id==='tool-1').cells.failed_at,Object.hasOwn(r.body.parts.tools,'failure_time_reason')],
 [200,1,['failed_at','Failed at'],null,'2026-10-09 08:15:00',false]);db.close();}},
 {name:'Every system mapping write refuses a non-member admin before changing data',before:"if (!member) return c.json({ error: 'not_in_company', detail: 'You are not in this project’s company.' }, 403);\n  const body = await jsonBody(c)",after:"if (false) return c.json({ error: 'not_in_company', detail: 'You are not in this project’s company.' }, 403);\n  const body = await jsonBody(c)",secondBefore:".bind(ctx.user.id, ctx.project.company_id).first();\n  if (!member)",secondAfter:".bind(1, ctx.project.company_id).first();\n  if (!member)",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,updated_by) VALUES(101,'crm',11,1)");
 const responses=[];for(const kind of ['bank','accounting','payroll','crm','workspace'])responses.push(await request(route,env,`/systems/${kind}?project=101`,3,'PUT',kind==='workspace'?{provider_key:null}:{integration_uid:null}));
 const row=db.prepare("SELECT integration_id FROM project_core_systems WHERE project_id=101 AND kind='crm'").get() as any;
 snap([responses.map(r=>[r.status,r.body.error]),row.integration_id,db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='build_system_mapping_changed'").get()?.n],[[[403,'not_in_company'],[403,'not_in_company'],[403,'not_in_company'],[403,'not_in_company'],[403,'not_in_company']],11,0]);db.close();}},
 {name:'Choices say which kinds already name a connector, with their Used by, and nothing of another project',before:"mapped: current.get(kind)?.integration_id != null || current.get(kind)?.provider_key != null,",after:"mapped: false,",secondBefore:"used_by: current.get(kind)?.used_by ?? null,",secondAfter:"used_by: null,",thirdBefore:"FROM project_core_systems WHERE project_id = ?',\n  ).bind(project.id)",thirdAfter:"FROM project_core_systems WHERE project_id <> ?',\n  ).bind(project.id)",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,used_by,updated_by) VALUES(101,'crm',11,'Sales',1),(101,'bank',NULL,'Finance',1),(202,'payroll',NULL,'Ops',2),(202,'accounting',NULL,NULL,2)");
 db.exec("UPDATE project_core_systems SET integration_id=12 WHERE project_id=202 AND kind='accounting'");
 const r=await request(route,env,'/systems/choices?project=101');
 snap([r.status,r.body.kinds.map((k:any)=>[k.kind,k.mapped,k.used_by])],[200,[['bank',false,'Finance'],['accounting',false,null],['payroll',false,null],['crm',true,'Sales'],['workspace',false,null]]]);db.close();}},
 {name:'Links into Connect a tool keep the venture',before:"&project_id=${encodeURIComponent(String(projectId))}",after:"",run:async(route:any)=>{
 const {db,env}=fixture();connectors(db);db.exec("INSERT INTO project_core_systems(project_id,kind,integration_id,updated_by) VALUES(101,'crm',12,2)");
 const r=await request(route,env,'/modules/operating-systems?project=101');
 snap([r.body.card.next.href,r.body.parts.tools.rows.map((row:any)=>row.cells.action?.href)],['/build/connect?tool=salesforce&project_id=101',['/build/connect?tool=hubspot&project_id=101','/build/connect?tool=salesforce&project_id=101','/build/connect?tool=stripe&project_id=101']]);db.close();}},
];
const secondMutations: Array<[string,string]> = [
 ["AND ic.enabled = 1\n       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id\n       LEFT JOIN users", "AND ic.enabled = 0\n       JOIN user_company_links ucl ON ucl.company_id = ic.company_id AND ucl.user_id = i.user_id\n       LEFT JOIN users"],
 ["tools.filter(tool => tool.status === 'active').length", "tools.length"],
 ["'workspace'] as const", "'crm'] as const"],
 ["if (workspace && await workspaceConnected", "if (false && await workspaceConnected"],
 ["integrationId = enabled.id", "integrationId = null"],
 ["error: 'invalid_kind', detail: 'Unknown system kind'", "error: 'kind_mismatch', detail: 'Unknown system kind'"],
 ["kind === 'workspace' ? workspace.map", "kind === 'workspace' ? [].map"],
 ["kind === 'workspace' && providerKey == null", "false"],
 ["getDescriptor(c.provider_key)?.display_name", "c.display_name"],
 ["getDescriptor(providerKey)?.display_name ?? fallbackName", "fallbackName"],
];
for(const [index, pair] of secondMutations.entries()){checks[index].secondBefore=pair[0];checks[index].secondAfter=pair[1];}
for(const index of [1,9]){checks[index].thirdBefore='const since = failureDate(failedAt);';checks[index].thirdAfter='const since = null;';}
for(const c of checks)test(c.name,()=>c.run(build));
let serial=0;
async function mutated(c:any){
 const file=new URL('../src/routes/cycle_build.ts',import.meta.url);let src=readFileSync(file,'utf8');
 if(!src.includes(c.before))throw new Error('mutation_target_missing: '+c.name);
 src=stripTypeScriptTypes(src.replace(c.before,c.after),{mode:'strip'});
 src=src.replace(/(from\s*['"])([^'"]+)(['"])/g,(_a,b,path,end)=>b+(path.startsWith('.')?new URL(/\.(?:ts|mjs|js)$/.test(path)?path:path+'.ts',file).href:import.meta.resolve(path))+end);
 return (await import('data:text/javascript;base64,'+Buffer.from(src+'\n// mutant '+serial++).toString('base64'))).default;
}
for(const c of checks)test('Mutation and restoration: '+c.name,async()=>{
 await c.run(build);
 await assert.rejects(c.run(await mutated(c)),assert.AssertionError);
 await c.run(build);
 if(c.secondBefore){await assert.rejects(c.run(await mutated({...c,before:c.secondBefore,after:c.secondAfter})),assert.AssertionError);await c.run(build);}
 if(c.thirdBefore){await assert.rejects(c.run(await mutated({...c,before:c.thirdBefore,after:c.thirdAfter})),assert.AssertionError);await c.run(build);}
});

const rebuild=readFileSync('cloudflare-worker/sql/migrations/455_core_systems_workspace.sql','utf8');
const oldTable=readFileSync('cloudflare-worker/sql/migrations/441_build_cycle_stores.sql','utf8').split('CREATE TABLE IF NOT EXISTS project_core_systems')[1];
const setup="CREATE TABLE projects(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE integrations(id INTEGER PRIMARY KEY); INSERT INTO projects VALUES(101); INSERT INTO users VALUES(1); INSERT INTO integrations VALUES(11);\nCREATE TABLE IF NOT EXISTS project_core_systems"+oldTable+
 "\nINSERT INTO project_core_systems(project_id,kind,integration_id,used_by,updated_by,updated_at) VALUES(101,'crm',11,'Sales',1,'2026-10-01'),(101,'product_analytics',11,NULL,1,'2026-10-01');"+
 "\nCREATE TABLE system_ref(project_id INTEGER,kind TEXT,FOREIGN KEY(project_id,kind) REFERENCES project_core_systems(project_id,kind)); INSERT INTO system_ref VALUES(101,'crm');";
function sqliteRebuild(sql:string){
 const db=new DatabaseSync(':memory:');db.exec(setup);db.exec('BEGIN');try{db.exec(sql);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');db.close();throw e;}
 const kept=db.prepare('SELECT kind,integration_id,used_by,updated_by,updated_at FROM project_core_systems').all();
 let missing=false,mixed=false;try{db.exec("INSERT INTO project_core_systems(project_id,kind,updated_by) VALUES(101,'workspace',1)");}catch{missing=true;}
 try{db.exec("INSERT INTO project_core_systems(project_id,kind,provider_key,integration_id,updated_by) VALUES(101,'workspace','google_calendar',11,1)");}catch{mixed=true;}
 const fk=db.prepare('PRAGMA foreign_key_check').all();db.close();
 snap([kept.map((r:any)=>[r.kind,r.integration_id,r.used_by,r.updated_by,r.updated_at]),missing,mixed,fk],[ [['crm',11,'Sales',1,'2026-10-01']],true,true,[] ]);
}
test('Migration preserves mappings and inbound foreign keys, drops analytics and enforces Workspace keys',()=>sqliteRebuild(rebuild));
for(const [before,after] of [["WHERE kind <> 'product_analytics'","WHERE 1"],["CHECK ((kind = 'workspace') = (provider_key IS NOT NULL))","CHECK (1)"],["CHECK (provider_key IS NULL OR integration_id IS NULL)","CHECK (1)"]]){
 test('Migration mutation and restoration: '+before,()=>{sqliteRebuild(rebuild);assert.throws(()=>sqliteRebuild(rebuild.replace(before,after)));sqliteRebuild(rebuild);});
}
function localRebuild(sql:string){
 const scratch=mkdtempSync(join(tmpdir(),'studioos-d686-d1-'));
 const file=join(scratch,'rebuild.sql');writeFileSync(file,setup+'\n'+sql+"\nSELECT kind,integration_id,used_by,updated_by,updated_at FROM project_core_systems; PRAGMA foreign_key_check;");
 const run=(sqlFile:string)=>spawnSync(resolve('cloudflare-worker/node_modules/.bin/wrangler'),['d1','execute','studioos-db','--config','../wrangler.toml','--local','--persist-to',scratch,'--file',sqlFile,'--json'],{cwd:resolve('cloudflare-worker'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024});
 try{
 const result=run(file);assert.equal(result.status,0,'local D1 rebuild failed: '+result.stderr.slice(-800));
 const output=JSON.parse(result.stdout),all=output.flatMap((item:any)=>item.results??[]);
 snap(all.filter((r:any)=>r.kind).map((r:any)=>[r.kind,r.integration_id,r.used_by,r.updated_by,r.updated_at]),[['crm',11,'Sales',1,'2026-10-01']]);
 snap(all.filter((r:any)=>r.table),[]);
 const invalid=join(scratch,'invalid.sql');writeFileSync(invalid,"INSERT INTO project_core_systems(project_id,kind,updated_by) VALUES(101,'workspace',1);");
 assert.notEqual(run(invalid).status,0,'local D1 accepted Workspace without a provider');
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
test('Migration and mutation/restoration reproduce against local Wrangler D1',()=>{
 localRebuild(rebuild);
 assert.throws(()=>localRebuild(rebuild.replace("CHECK ((kind = 'workspace') = (provider_key IS NOT NULL))","CHECK (1)")),assert.AssertionError);
 localRebuild(rebuild);
});
