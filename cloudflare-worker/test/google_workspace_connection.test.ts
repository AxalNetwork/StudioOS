import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import workspaceRoutes from '../src/routes/google_workspace.ts';
import calendarRoutes from '../src/routes/calendar.ts';
import { DRIVE_FILE_SCOPE, GOOGLE_WORKSPACE_READS, clearWorkspaceConnection, ensureWorkspaceIntegration, workspaceRead } from '../src/services/google/workspace.ts';
import { ensureIntegrationsSchema } from '../src/integrations/registry.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { googleWorkspaceFake } from './_google_workspace_fake.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
const SECRET = 'synthetic-workspace-test-secret-0123456789';
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = new Hono<any>(); app.route('/api/connectors/google-workspace',workspaceRoutes); app.route('/api/calendar',calendarRoutes);
app.onError((err,c) => c.json({ error: 'authentication_failed' }, AUTH_ERROR_STATUSES[err.message] ?? 500));
async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const baseline = read('../sql/schema_baseline.sql');
  for (const t of ['users','founders','projects','user_company_links','roadmap_okrs']) db.exec(tableFromBaseline(baseline,t));
  for (const t of ['companies']) db.exec(tableFromBaseline(read('../sql/migrations/034_unmounted_routes.sql'),t));
  db.exec(read('../sql/migrations/445_connector_fed_items.sql')); db.exec(read('../sql/migrations/588_google_workspace_files.sql'));
  db.exec('CREATE TABLE google_oauth_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER UNIQUE,refresh_token TEXT,scope TEXT,google_sub TEXT,google_email TEXT,updated_at TEXT)');
  db.exec("INSERT INTO users(id,email,name,role,is_active,founder_id) VALUES (1,'founder@example.test','Synthetic founder','founder',1,1),(2,'other@example.test','Other','founder',1,2)");
  db.exec("INSERT INTO companies(id,company_name) VALUES (1,'Synthetic venture'),(2,'Other venture')");
  db.exec("INSERT INTO projects(id,name,founder_id,company_id) VALUES (1,'Synthetic project',1,1),(2,'Other project',2,2)");
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES ('link1',1,1),('link2',2,2)");
  db.prepare('INSERT INTO google_oauth_tokens(user_id,refresh_token,scope,google_sub,google_email,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)').run(1,'server-refresh-only',DRIVE_FILE_SCOPE,'google-member','founder@example.test');
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', GOOGLE_CAL_CLIENT_ID: 'public-client', GOOGLE_CAL_CLIENT_SECRET: 'synthetic-secret', GOOGLE_PICKER_API_KEY: 'public-picker-key', GOOGLE_PICKER_APP_ID: '1234', PUBLIC_BASE_URL: 'https://axal.vc' };
  await ensureIntegrationsSchema(env);
  db.exec('CREATE TABLE IF NOT EXISTS integration_companies(integration_id INTEGER,company_id INTEGER,enabled INTEGER,PRIMARY KEY(integration_id,company_id))');
  const integration = await ensureWorkspaceIntegration(env,1);
  db.prepare('INSERT INTO integration_companies VALUES (?,?,1)').run(integration.id,1);
  return { db, env, integration };
}
async function call(env: any, path: string, method = 'GET', body?: unknown, as: number | null = 1, support = false) {
  const headers: any = { 'Content-Type':'application/json' };
  if (as !== null) headers.Authorization = 'Bearer ' + await new SignJWT({user_id:as,role:'founder',...(support ? {impersonated_by:9}: {})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  return app.request(path,{method,headers,...(body === undefined || method === 'GET'?{}:{body:JSON.stringify(body)})},env);
}
const base = '/api/connectors/google-workspace';
const files = { sheet: {name:'Synthetic metrics', mimeType:'application/vnd.google-apps.spreadsheet'}, doc: {name:'Synthetic notes',mimeType:'application/vnd.google-apps.document'}, folder: {name:'Folder',mimeType:'application/vnd.google-apps.folder'} };
test('file registration confirms provider metadata, scopes every operation, previews five rows without writing and stops without deleting facts', async () => {
  const {db,env,integration}=await fixture();const fake=googleWorkspaceFake(files);const old=globalThis.fetch;globalThis.fetch=fake.fetcher;
  try {
    const add=await call(env,base+'/files','POST',{project:1,module:'revenue_traction',ids:['sheet']});assert.equal(add.status,201);
    const list=await (await call(env,base+'/files?project=1')).json() as any;assert.equal(list.items[0].name,'Synthetic metrics');const uid=list.items[0].uid;
    assert.doesNotMatch(JSON.stringify(list),/server-refresh-only|browser-must-never-see-server-access/);
    assert.equal((await call(env,base+'/files?project=1','GET',undefined,2)).status,403);
    assert.equal((await call(env,base+`/files/${uid}/mapping`,'PUT',{mapping:{date:'A',new_users:'B'}},2)).status,404);
    assert.equal((await call(env,base+`/files/${uid}/mapping`,'PUT',{mapping:{date:'A',new_users:'B'}})).status,200);
    const before=db.prepare('SELECT * FROM google_workspace_files').all();
    const preview=await (await call(env,base+`/files/${uid}/preview`,'POST',{})).json() as any;
    assert.equal(preview.rows.length,5);assert.equal(preview.stored,false);assert.deepEqual(db.prepare('SELECT * FROM google_workspace_files').all(),before);
    db.prepare('INSERT INTO connector_fed_items(integration_id,project_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?,?)').run(integration.id,1,'revenue_traction','metric','sheet:row1','project_metrics',99);
    const stop=await call(env,base+`/files/${uid}`,'DELETE');assert.equal(stop.status,200);
    assert.equal((db.prepare('SELECT local_id FROM connector_fed_items').get() as any).local_id,null);
    assert.equal((await (await call(env,base+'/files?project=1')).json() as any).items.length,0);
    assert.equal((await call(env,base+`/files/${uid}/preview`,'POST',{})).status,404);
    assert.ok(fake.calls.filter(x=>x.host!=='oauth2.googleapis.com').every(x=>['www.googleapis.com','docs.googleapis.com','sheets.googleapis.com','slides.googleapis.com','forms.googleapis.com'].includes(x.host)&&x.method==='GET'));
  } finally {globalThis.fetch=old;db.close();}
});
test('unshared files, unsupported kinds, invalid IDs and disabled companies never create a source; support sessions cannot read or connect', async()=>{
 const {db,env}=await fixture();const old=globalThis.fetch;globalThis.fetch=googleWorkspaceFake(files).fetcher;
 try {
  for(const [ids,module,code] of [[['missing'],'data_room','file_not_shared'],[['folder'],'data_room','wrong_file_kind'],[['doc'],'revenue_traction','wrong_file_kind'],[['../../secret'],'data_room','invalid_files']] as const){
   const res=await call(env,base+'/files','POST',{project:1,module,ids});assert.equal((await res.json() as any).error,code);
  }
  assert.equal((db.prepare('SELECT COUNT(*) n FROM google_workspace_files').get() as any).n,0);
  assert.equal((await call(env,base+'/picker-config?project=1','GET',undefined,null)).status,401);
  for(const [path,method] of [[base+'/picker-config?project=1','GET'],[base+'/files?project=1','GET'],['/api/calendar/google/workspace-files/connect','POST']] as const) assert.equal((await call(env,path,method,{project:1},1,true)).status,403);
  db.exec('UPDATE integration_companies SET enabled=0');
  assert.equal((await call(env,base+'/files?project=1')).status,409);
 } finally {globalThis.fetch=old;db.close();}
});
test('picker config reports both not-yet states without a server token; callback refuses a scope-less file grant before storing it', async()=>{
 const {db,env}=await fixture();const old=globalThis.fetch;
 try {
  let config=await (await call(env,base+'/picker-config?project=1')).json() as any;assert.equal(config.state,'ready');assert.equal(config.scope,DRIVE_FILE_SCOPE);
  assert.doesNotMatch(JSON.stringify(config),/server-refresh-only|browser-must-never-see-server-access|access_token|refresh_token/);
  db.prepare('UPDATE google_oauth_tokens SET scope=?').run('openid');
  config=await (await call(env,base+'/picker-config?project=1')).json();assert.equal(config.state,'workspace_not_allowed');
  const start=await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:1});assert.equal(start.status,200);
  const url=new URL((await start.json() as any).redirect_url);assert.ok(url.searchParams.get('scope')?.includes(DRIVE_FILE_SCOPE));assert.equal(url.searchParams.get('include_granted_scopes'),'false');
  globalThis.fetch=googleWorkspaceFake({...files,oauthScope:'openid'}).fetcher;
  const callback=await call(env,'/api/calendar/google/callback?code=synthetic&state='+encodeURIComponent(url.searchParams.get('state')!),'GET',undefined,null);
  assert.equal(callback.status,302);assert.match(callback.headers.get('location')!,/workspace_scope_missing/);
  assert.equal((db.prepare('SELECT scope FROM google_oauth_tokens').get() as any).scope,'openid');
  db.exec('DELETE FROM google_oauth_tokens');config=await (await call(env,base+'/picker-config?project=1')).json();assert.equal(config.state,'google_not_connected');
 }finally{globalThis.fetch=old;db.close();}
});
test('allowlist is frozen, provider writes are refused by the fake, and disconnect unlinks rather than deletes accepted facts',async()=>{
 assert.ok(Object.isFrozen(GOOGLE_WORKSPACE_READS));assert.equal(Object.keys(GOOGLE_WORKSPACE_READS).length,8);assert.ok(Object.values(GOOGLE_WORKSPACE_READS).every(Object.isFrozen));
 await assert.rejects(()=>googleWorkspaceFake().fetcher('https://docs.googleapis.com/v1/documents/id',{method:'PATCH'}),/provider_write_refused/);
 const {db,env,integration}=await fixture();
 try{
  await assert.rejects(()=>workspaceRead(env,1,'files.delete' as any,'id'),/invalid_workspace_read/);
  db.prepare('INSERT INTO connector_fed_items(integration_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?)').run(integration.id,'product_roadmap','issue','doc','roadmap_okrs',77);
  db.prepare('INSERT INTO roadmap_okrs(id,project_id,objective) VALUES (?,?,?)').run(77,1,'Synthetic accepted fact');
  await clearWorkspaceConnection(env,1);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM integrations').get() as any).n,0);
  assert.equal((db.prepare('SELECT local_id FROM connector_fed_items').get() as any).local_id,null);
  assert.equal((db.prepare('SELECT objective FROM roadmap_okrs WHERE id=77').get() as any).objective,'Synthetic accepted fact');
 }finally{db.close();}
});

test('a valid file consent activates the same ledger row, is single-use, and a wrong Google account is refused',async()=>{
 const {db,env,integration}=await fixture();const old=globalThis.fetch;
 try{
  const begin=async()=>{
   const res=await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:1});
   assert.equal(res.status,200);const u=new URL((await res.json() as any).redirect_url);return u.searchParams.get('state')!;
  };
  globalThis.fetch=googleWorkspaceFake({...files,oauthScope:DRIVE_FILE_SCOPE}).fetcher;
  const ordinary=await call(env,'/api/calendar/google/connect','POST',{});
  assert.ok(new URL((await ordinary.json() as any).redirect_url).searchParams.get('scope')?.includes(DRIVE_FILE_SCOPE));
  let state=await begin();
  const callback='/api/calendar/google/callback?code=synthetic&state='+encodeURIComponent(state);
  const good=await call(env,callback,'GET',undefined,null);
  assert.equal(good.status,302);assert.match(good.headers.get('location')!,/workspace=granted/);
  assert.equal((db.prepare("SELECT id FROM integrations WHERE provider_key='google_workspace'").get() as any).id,integration.id);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM google_oauth_tokens').get() as any).n,1);
  assert.match((await call(env,callback,'GET',undefined,null)).headers.get('location')!,/invalid_state/);
  state=await begin();
  const fake=googleWorkspaceFake({...files,oauthScope:DRIVE_FILE_SCOPE});
  globalThis.fetch=async(input,init)=>String(input).includes('/userinfo') ? Response.json({id:'different-google',email:'other@example.test',verified_email:true}) : fake.fetcher(input,init);
  const wrong=await call(env,'/api/calendar/google/callback?code=synthetic&state='+encodeURIComponent(state),'GET',undefined,null);
  assert.match(wrong.headers.get('location')!,/workspace_account_changed/);
  assert.equal((db.prepare('SELECT google_sub FROM google_oauth_tokens').get() as any).google_sub,'google-member');
 }finally{globalThis.fetch=old;db.close();}
});
test('reader uses fixed GET endpoints, codes-only failures, the byte limit and explicit company enablement',async()=>{
 const {db,env}=await fixture();const old=globalThis.fetch;const fake=googleWorkspaceFake(files);globalThis.fetch=fake.fetcher;
 try{
  for(const key of Object.keys(GOOGLE_WORKSPACE_READS)) await workspaceRead(env,1,key as any,'sheet',key==='files.export'?{mimeType:'application/pdf'}:{});
  await assert.rejects(()=>workspaceRead(env,1,'files.get','missing'),(error:any)=>error.code==='file_not_shared'&&!error.message.includes('raw-private-provider-body'));
  await assert.rejects(()=>workspaceRead(env,1,'files.get','sheet',{},async()=>new Response('x'.repeat(2*1024*1024+1))),(error:any)=>error.code==='google_file_too_large');
  await assert.rejects(()=>workspaceRead(env,1,'files.get','sheet',{},async()=>new Response('private error',{status:429})),(error:any)=>error.code==='google_rate_limited');
  db.exec('UPDATE integration_companies SET enabled=0');
  assert.equal((await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:1})).status,409);
  assert.equal((await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:1,enable_company:true})).status,200);
  assert.equal((await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:2,enable_company:true})).status,403);
 }finally{globalThis.fetch=old;db.close();}
});

test('Workspace source has a single GET-only transport and no provider write endpoint',()=>{
 const source=read('../src/services/google/workspace.ts');
 assert.match(source,/method: 'GET', redirect: 'error'/);
 assert.doesNotMatch(source,/method:\s*['"](?:POST|PATCH|PUT|DELETE)['"]/);
 assert.equal((source.match(/fetcher\(url\.toString\(\)/g)||[]).length,1);
 assert.match(source,/AbortSignal\.timeout\(10000\)/);
 assert.match(source,/size > 2 \* 1024 \* 1024/);
});

test('every Workspace route refuses support and admin access; venture scope is required even for Picker configuration',async()=>{
 const {db,env}=await fixture();const old=globalThis.fetch;globalThis.fetch=googleWorkspaceFake(files).fetcher;
 try{
  await call(env,base+'/files','POST',{project:1,module:'revenue_traction',ids:['sheet']});
  const uid=(db.prepare('SELECT uid FROM google_workspace_files').get() as any).uid;
  const routes=[['/picker-config?project=1','GET',undefined],['/files?project=1','GET',undefined],['/files','POST',{project:1,module:'revenue_traction',ids:['sheet']}],[`/files/${uid}/mapping`,'PUT',{mapping:{date:'A'}}],[`/files/${uid}/preview`,'POST',{}],[`/files/${uid}`,'DELETE',undefined]] as const;
  for(const [path,method,body] of routes) assert.equal((await call(env,base+path,method,body,1,true)).status,403,path);
  assert.equal((await call(env,base+'/picker-config?project=2')).status,403);
  assert.equal((await call(env,base+'/picker-config')).status,400);
  db.exec("UPDATE users SET role='admin' WHERE id=1");
  for(const [path,method,body] of routes) assert.equal((await call(env,base+path,method,body)).status,403,path);
  assert.equal((await call(env,'/api/calendar/google/workspace-files/connect','POST',{project:1})).status,403);
  assert.equal((db.prepare('SELECT status FROM google_workspace_files').get() as any).status,'active');
 }finally{globalThis.fetch=old;db.close();}
});
test('failed multi-file confirmation is atomic, repeated registration is idempotent, and Stop using affects only its file and module',async()=>{
 const {db,env,integration}=await fixture();const old=globalThis.fetch;globalThis.fetch=googleWorkspaceFake(files).fetcher;
 try{
  assert.equal((await call(env,base+'/files','POST',{project:1,module:'data_room',ids:['sheet','missing']})).status,403);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM google_workspace_files').get() as any).n,0);
  for(let i=0;i<2;i++) assert.equal((await call(env,base+'/files','POST',{project:1,module:'data_room',ids:['sheet','sheet']})).status,201);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM google_workspace_files').get() as any).n,1);
  const uid=(db.prepare('SELECT uid FROM google_workspace_files').get() as any).uid;
  for(const [module,id] of [['data_room','sheet:row'],['data_room','sheet-other:row'],['product_roadmap','sheet:other-row']]) db.prepare('INSERT INTO connector_fed_items(integration_id,project_id,module,kind,external_id,local_table,local_id) VALUES (?,?,?,?,?,?,?)').run(integration.id,1,module,'metric',id,'roadmap_okrs',42);
  assert.equal((await call(env,base+`/files/${uid}`,'DELETE')).status,200);
  assert.deepEqual(db.prepare('SELECT local_id FROM connector_fed_items ORDER BY id').all().map((r:any)=>r.local_id),[null,42,42]);
  assert.equal((await call(env,base+'/files','POST',{project:1,module:'data_room',ids:['sheet']})).status,201);
  assert.equal((db.prepare('SELECT status FROM google_workspace_files').get() as any).status,'active');
 }finally{globalThis.fetch=old;db.close();}
});
test('all file-operation replies exclude server tokens; unsupported mapping and preview fail without storing content',async()=>{
 const {db,env}=await fixture();const old=globalThis.fetch;globalThis.fetch=googleWorkspaceFake({...files,form:{name:'Synthetic survey',mimeType:'application/vnd.google-apps.form'}}).fetcher;
 const scan=async(res:Response)=>{const raw=await res.text();assert.doesNotMatch(raw,/server-refresh-only|browser-must-never-see-server-access|access_token|refresh_token/);return JSON.parse(raw);};
 try{
  await scan(await call(env,base+'/picker-config?project=1'));
  // D1092: a Customer research Doc maps to its interview; a Doc in any other module still takes no mapping.
  await scan(await call(env,base+'/files','POST',{project:1,module:'solution_design',ids:['doc']}));
  await scan(await call(env,base+'/files','POST',{project:1,module:'customer_research',ids:['doc']}));
  await scan(await call(env,base+'/files','POST',{project:1,module:'demand_signals',ids:['form']}));
  const list=await scan(await call(env,base+'/files?project=1'));
  const doc=list.items.find((r:any)=>r.kind==='doc'&&r.module==='solution_design'),form=list.items.find((r:any)=>r.kind==='form');
  assert.equal((await scan(await call(env,base+`/files/${doc.uid}/mapping`,'PUT',{mapping:{}}))).error,'mapping_not_supported');
  const notes=list.items.find((r:any)=>r.kind==='doc'&&r.module==='customer_research');
  assert.equal((await scan(await call(env,base+`/files/${notes.uid}/mapping`,'PUT',{mapping:{interview_id:101}}))).saved,true);
  assert.equal((await scan(await call(env,base+`/files/${doc.uid}/preview`,'POST',{}))).error,'preview_not_supported');
  assert.equal((await scan(await call(env,base+`/files/${form.uid}/mapping`,'PUT',{mapping:[]}))).error,'invalid_mapping');
  assert.equal((await scan(await call(env,base+`/files/${form.uid}/mapping`,'PUT',{mapping:{question:'q1'}}))).saved,true);
  const preview=await scan(await call(env,base+`/files/${form.uid}/preview`,'POST',{}));
  assert.deepEqual(preview.rows,[{question_id:'q1',title:'Would you pay?'}]);assert.equal(preview.stored,false);
  assert.equal((await scan(await call(env,base+`/files/${form.uid}`,'DELETE'))).facts_kept,true);
 }finally{globalThis.fetch=old;db.close();}
});
test('D1091 GW1/GW2: /mine lists the member\'s own chosen files across ventures with the state and the Google account, and never a token', async()=>{
 const {db,env}=await fixture();const fake=googleWorkspaceFake(files);const old=globalThis.fetch;globalThis.fetch=fake.fetcher;
 try {
  assert.equal((await call(env,base+'/files','POST',{project:1,module:'revenue_traction',ids:['sheet']})).status,201);
  const before=fake.calls.length;
  const mine=await (await call(env,base+'/mine')).json() as any;
  assert.equal(fake.calls.length,before,'nothing is read from Google');
  assert.deepEqual([mine.state,mine.account_email,mine.ventures,mine.items.length],['ready','founder@example.test',1,1]);
  assert.deepEqual([mine.items[0].name,mine.items[0].venture_name,mine.items[0].module,mine.items[0].kind],['Synthetic metrics','Synthetic project','revenue_traction','sheet']);
  assert.doesNotMatch(JSON.stringify(mine),/server-refresh-only|refresh_token|access_token/);
  // Another member sees only their own: none chosen, no Google sign-in.
  const other=await (await call(env,base+'/mine','GET',undefined,2)).json() as any;
  assert.deepEqual([other.state,other.account_email,other.items,other.ventures],['google_not_connected',null,[],0]);
  // A stopped file leaves the list.
  await call(env,base+`/files/${mine.items[0].uid}`,'DELETE');
  assert.equal((await (await call(env,base+'/mine')).json() as any).items.length,0);
  // Without drive.file the state says so.
  db.prepare("UPDATE google_oauth_tokens SET scope = 'openid' WHERE user_id = 1").run();
  assert.equal((await (await call(env,base+'/mine')).json() as any).state,'workspace_not_allowed');
  assert.equal((await call(env,base+'/mine','GET',undefined,1,true)).status,403,'a support session is refused');
  assert.equal((await call(env,base+'/mine','GET',undefined,null)).status,401);
 } finally {globalThis.fetch=old;db.close();}
});
