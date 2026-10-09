/** D653: mounted requests and real atomic writes over the canonical SQLite schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_calls.ts';
import updateRoutes from '../src/routes/portfolio_updates.ts';
import * as service from '../src/services/roundCalls.ts';
import { termsHash } from '../src/services/roundCallPolicy.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET='fixture-only-d653-01234567890123456789';
const baseline=readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8');
const terms={name:'Energy seed',amount_cents:10000000,instrument:'safe',terms:'Recorded round terms',minimum_cheque_cents:100000,
  target_close:'2099-01-15',deck_id:1,deck_version:2,data_room_project_uid:'energy',stage:'seed',sector:'climate'};
async function fixture(state='sent') {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
  for(const table of ['users','founders','super_admins','user_sessions','user_company_links','projects','raise_rounds','raise_prospects',
    'contacts','activity_logs','pitch_decks','cap_table_scenarios','investor_profiles','data_room_files','data_room_folders',
    'data_room_grants','pairwise_ndas','notifications_inbox','user_settings','push_subscriptions',
    'mi_pro_subscriptions','user_recovery_state','portfolio_updates','job_postings']) {
    db.exec(tableFromBaseline(baseline,table));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/436_round_calls.sql','utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/437_share_an_update.sql','utf8'));
  db.exec("INSERT INTO founders(id,name,email) VALUES(1,'Owner','owner@example.test'),(2,'Other','other@example.test')");
  const user=db.prepare('INSERT INTO users(id,name,email,role,founder_id,kyc_status,is_active) VALUES(?,?,?,?,?,?,?)');
  for(const row of [[1,'Owner','owner@example.test','founder',1,'approved',1],[2,'Other','other@example.test','founder',2,'approved',1],
    [3,'HQ','hq@example.test','admin',null,'approved',1],[4,'Ivy','ivy@example.test','investor',null,'approved',1],
    [5,'Pending','pending@example.test','investor',null,'pending',1],[6,'Member','member@example.test','founder',2,'approved',1],
    [7,'Not invited','notinvited@example.test','investor',null,'approved',1],[8,'Inactive','inactive@example.test','investor',null,'approved',0],
    [9,'Plain admin','plain@example.test','admin',null,'approved',1]])user.run(...row);
  db.exec("INSERT INTO super_admins(user_id) VALUES(3); INSERT INTO projects(id,uid,name,founder_id,company_id,sector,stage,description,use_of_funds,revenue) VALUES(1,'energy','Energy',1,10,'climate','seed','energy storage','Product',0)");
  db.exec("INSERT INTO user_company_links(uid,user_id,company_id) VALUES('company-10',1,10),('company-11',1,11)");
  db.exec("INSERT INTO pitch_decks(id,project_id,version,title,slides) VALUES(1,1,2,'Energy deck','[]'); INSERT INTO data_room_folders(uid,project_id,name) VALUES('folder',1,'Diligence')");
  const hash=await termsHash(terms);
  db.prepare('INSERT INTO round_calls(id,uid,project_id,company_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,deck_version,data_room_project_uid,stage,sector,state,terms_hash,created_by) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('call',1,10,terms.name,terms.amount_cents,terms.instrument,terms.terms,terms.minimum_cheque_cents,terms.target_close,1,2,'energy','seed','climate',state,hash,1);
  for(const id of [4,5,6,8])db.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,match_reasons_json) VALUES(1,?,'match','[\"Stage fits seed\"]')").run(id);
  const env:any={DB:d1Over(db),JWT_SECRET:SECRET,ENVIRONMENT:'production',ROUND_CALLS_ENABLED:'true'};
  return {db,env,actor:db.prepare('SELECT * FROM users WHERE id=1').get() as any,investor:db.prepare('SELECT * FROM users WHERE id=4').get() as any};
}
async function request(f:any,router:any,path:string,who:number|null=1,method='GET',body?:unknown,extraEnv={},extraHeaders={}) {
  const app=new Hono<any>();app.route('/round-calls',router);
  app.onError((e,c)=>c.json({error:e.message},(AUTH_ERROR_STATUSES[e.message]||500) as any));
  const headers:any={...extraHeaders};
  if(who)headers.Authorization='Bearer '+await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  if(body!==undefined)headers['Content-Type']='application/json';
  const res=await app.request('/round-calls'+path,{method,headers,...body===undefined?{}:{body:JSON.stringify(body)}},{...f.env,...extraEnv});
  return {status:res.status,body:await res.json() as any};
}
const count=(db:any,table:string)=>Number(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n);
const actual={routes,service,updateRoutes};
async function updateRequest(f:any,router:any,path:string,who=1,method='GET',body?:unknown) {
  const app=new Hono<any>();app.route('/portfolio-updates',router);
  const headers:any={Authorization:'Bearer '+await new SignJWT({user_id:who}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))};
  if(body!==undefined)headers['Content-Type']='application/json';
  const res=await app.request('/portfolio-updates'+path,{method,headers,...body===undefined?{}:{body:JSON.stringify(body)}},f.env,{waitUntil:()=>{}} as any);
  return {status:res.status,body:await res.json() as any};
}
function seedAsk(f:any) {
  f.db.exec("INSERT INTO portfolio_updates(id,uid,project_id,author_user_id,title,status,sent_at) VALUES(1,'update',1,1,'Round update','draft','2098-01-01'); INSERT INTO update_asks(id,uid,update_id,kind,text,link_ref) VALUES(1,'ask',1,'capital','A round','call')");
  return {id:1,kind:'capital',link_ref:'call',project_id:1};
}
const checks:Record<string,(m:any)=>Promise<void>>={
  async flag(m){const f=await fixture();const results=[];
    for(const path of ['/context?project_id=1','/call','/call/responses'])results.push((await request(f,m.routes,path,4,path.endsWith('responses')?'POST':'GET',path.endsWith('responses')?{action:'question',question:'Private?'}:undefined,{ROUND_CALLS_ENABLED:undefined})).status);
    const availability=await request(f,m.routes,'/availability',1,'GET',undefined,{ROUND_CALLS_ENABLED:'false'});
    assert.deepEqual([results,availability.body.enabled,count(f.db,'contacts')],[[503,503,503],false,0]);},
  async access(m){const f=await fixture();const statuses=[];
    for(const who of [4,5,6,7,8,null])statuses.push((await request(f,m.routes,'/call',who)).status);
    assert.deepEqual(statuses,[200,403,404,404,401,401]);},
  async responseAccess(m){const f=await fixture();const statuses=[];
    for(const who of [5,6,7])statuses.push((await request(f,m.routes,'/call/responses',who,'POST',{action:'question',question:'Can I read?'})).status);
    assert.deepEqual([statuses,count(f.db,'contacts'),count(f.db,'round_call_questions')],[[403,403,404],0,0]);},
  async ownership(m){const f=await fixture();const statuses=[];
    for(const who of [1,2,9])statuses.push((await request(f,m.routes,'/context?project_id=1',who)).status);
    statuses.push((await request(f,m.routes,'/context?project_id=1',1,'GET',undefined,{}, {'X-Company-Id':'11'})).status);
    assert.deepEqual(statuses,[200,404,403,404]);},
  async counselRole(m){const f=await fixture('draft');
    assert.deepEqual([(await request(f,m.routes,'/call',9)).status,(await request(f,m.routes,'/call',3)).body.viewer],[403,'counsel']);},
  async send(m){const f=await fixture('draft');const r=await request(f,m.routes,'/call/send',1,'POST',{acknowledge_missing:true});
    assert.deepEqual([r.status,r.body.code,f.db.prepare('SELECT state FROM round_calls').get()!.state,count(f.db,'notifications_inbox')],[409,'counsel_approval_required','draft',0]);},
  async privacy(m){const f=await fixture();await request(f,m.routes,'/call',4);
    const before=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'));
    await m.service.respond(f.env,await m.service.loadCall(f.env,'call'),f.investor,{action:'question',question:'What is the use of funds?'});
    const after=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'));
    const b=before.recipients[0],a=after.recipients[0];
    assert.deepEqual([!!b.opened_at,Object.hasOwn(b,'name'),Object.hasOwn(b,'email'),Object.hasOwn(b,'investor_user_id'),a.name,a.email],[true,false,false,false,'Ivy','ivy@example.test']);},
  async pipeline(m){const f=await fixture();const call=await m.service.loadCall(f.env,'call');
    await m.service.respond(f.env,call,f.investor,{action:'commit',amount_cents:250000});
    await m.service.respond(f.env,call,f.investor,{action:'commit',amount_cents:300000});
    await m.service.respond(f.env,call,f.investor,{action:'question',question:'A real question'});
    const row=f.db.prepare('SELECT amount,commit_status,contact_id FROM raise_prospects').get()!;
    assert.deepEqual([count(f.db,'contacts'),count(f.db,'raise_rounds'),count(f.db,'raise_prospects'),count(f.db,'round_call_questions'),row.amount,row.commit_status,!!row.contact_id],[1,1,1,1,3000,'soft_circled',true]);},
  async rollback(m){const f=await fixture();f.db.exec('DROP TABLE activity_logs');
    let failed=false;try{await m.service.respond(f.env,await m.service.loadCall(f.env,'call'),f.investor,{action:'question',question:'Must roll back'});}catch{failed=true;}
    assert.deepEqual([failed,count(f.db,'contacts'),count(f.db,'raise_prospects'),count(f.db,'round_call_questions'),f.db.prepare('SELECT responded_at FROM round_call_recipients WHERE investor_user_id=4').get()!.responded_at],[true,0,0,0,null]);},
  async closed(m){const f=await fixture();await m.service.manageCall(f.env,await m.service.loadCall(f.env,'call'),f.actor,{action:'close'});
    const r=await request(f,m.routes,'/call/responses',4,'POST',{action:'commit',amount_cents:100000});
    const page=await m.service.investorPage(f.env,await m.service.loadCall(f.env,'call'),f.investor);
    assert.deepEqual([r.status,page.read_only,count(f.db,'contacts'),f.db.prepare('SELECT opened_at FROM round_call_recipients WHERE investor_user_id=4').get()!.opened_at],[409,true,0,null]);},
  async nda(m){const f=await fixture();const call=await m.service.loadCall(f.env,'call');
    f.db.exec("INSERT INTO data_room_grants(uid,project_id,investor_user_id,granted_by_user_id) VALUES('grant',1,4,2); INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(1,4,'active')");
    const blocked=await m.service.investorPage(f.env,call,f.investor);
    f.db.exec("INSERT INTO pairwise_ndas(party_a_user_id,party_b_user_id,status) VALUES(2,4,'active')");
    const granted=await m.service.investorPage(f.env,call,f.investor);
    f.db.exec("UPDATE pairwise_ndas SET status='revoked' WHERE party_a_user_id=2");
    const revoked=await m.service.investorPage(f.env,call,f.investor);
    assert.deepEqual([blocked.data_room.path,granted.data_room.path,revoked.data_room.path],[null,'/research/diligence/grant',null]);},
  async invalidation(m){const f=await fixture('draft');const call=await m.service.loadCall(f.env,'call');
    await m.service.recordCounsel(f.env,call,f.actor,'Counsel approval fixture',call.terms_hash,call.revision);
    const approved=await m.service.loadCall(f.env,'call');
    const edited=await m.service.saveDraft(f.env,await m.service.projectFacts(f.env,1),f.actor,{...terms,terms:'Changed terms'},approved);
    let stale=false;try{await m.service.recordCounsel(f.env,edited,f.actor,'Counsel approval fixture',approved.terms_hash,approved.revision);}catch{stale=true;}
    assert.deepEqual([edited.counsel_approved_hash,edited.revision>approved.revision,stale],[null,true,true]);},
  async updateLink(m){const f=await fixture();f.db.exec("INSERT INTO portfolio_updates(id,uid,project_id,author_user_id,title,status) VALUES(1,'update',1,1,'Round update','draft')");
    const body={asks:[{kind:'capital',text:'Join this round',link_ref:'forged'}]};
    const sent=await updateRequest(f,m.updateRoutes,'/update/share',1,'PUT',body);
    const first=f.db.prepare("SELECT link_ref FROM update_asks").get()!.link_ref;
    f.env.ROUND_CALLS_ENABLED='false';await updateRequest(f,m.updateRoutes,'/update/share',1,'PUT',body);
    assert.deepEqual([sent.status,first,f.db.prepare("SELECT link_ref FROM update_asks").get()!.link_ref],[200,'call',null]);},
  async updateFlag(m){const f=await fixture();f.env.ROUND_CALLS_ENABLED='false';
    assert.equal(await m.service.openCallForUpdate(f.env,1),null);},
  async updatePrivacy(m){const f=await fixture();const ask=seedAsk(f);const refs=[];
    for(const [who,author,audience] of [[1,true,undefined],[4,false,'investor'],[4,false,'network'],[5,false,'investor'],[7,false,'investor'],[9,true,undefined]]) {
      const user=f.db.prepare('SELECT * FROM users WHERE id=?').get(who as number);
      const rows=await m.service.updateAskLinks(f.env,[ask],user,author,audience);refs.push(rows[0].link_ref);
    }
    assert.deepEqual(refs,['call','call',null,null,null,null]);},
  async updateReply(m){const f=await fixture();const ask=seedAsk(f);
    const landed=await m.service.replyToLinkedCall(f.env,ask,f.investor,'Question from the update','reply');
    const page=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'));
    assert.deepEqual([landed,count(f.db,'update_ask_replies'),count(f.db,'round_call_questions'),count(f.db,'raise_prospects'),page.questions.map((q:any)=>q.question),page.recipients[0].name],[true,1,1,1,['Question from the update'],'Ivy']);},
  async updateRollback(m){const f=await fixture();const ask=seedAsk(f);f.db.exec('DROP TABLE activity_logs');
    let failed=false;try{await m.service.replyToLinkedCall(f.env,ask,f.investor,'Question from the update','reply');}catch{failed=true;}
    assert.deepEqual([failed,count(f.db,'update_ask_replies'),count(f.db,'round_call_questions'),count(f.db,'raise_prospects')],[true,0,0,0]);},

};
for(const [name,check] of Object.entries(checks))test('D653 real request/write: '+name,()=>check(actual));

// Mutants import the actual source with one changed behavior and absolute
// dependency URLs. Fresh databases prove failure; the original module then
// passes the same assertions. Other tests never see edited production files.
async function altered(path:string,old:string,replacement:string,index:number) {
  let source=readFileSync(path,'utf8');if(!source.includes(old))throw Error('Stale mutation: '+old);
  source=source.replace(old,replacement);
  let js=stripTypeScriptTypes(source,{mode:'strip'});
  const req=createRequire(pathToFileURL(resolve(path)));
  js=js.replace(/from (['"])([^'"]+)\1/g,(_m,q,spec)=>{
    let target;if(spec.startsWith('.')){target=resolve(dirname(path),spec);if(!existsSync(target))target+='.ts';}else target=req.resolve(spec);
    return 'from '+q+pathToFileURL(target).href+q;
  });
  return import('data:text/javascript;base64,'+Buffer.from(js+'\n// d653-'+index).toString('base64'));
}
const probes=[
  ['updateLink','updateRoutes',"const callUid=kind==='capital'?await openCallForUpdate(c.env,u.project_id):null;","const callUid=null;"],
  ['updateFlag','service',"if(!roundCallsEnabled(env)) return null;",""],
  ['updatePrivacy','service',"if(audienceName==='network')return {...ask,link_ref:null};",""],
  ['updatePrivacy','service',"verifiedInvestor(user)?1:0","1"],
  ['updateReply','service',"await respond(env,row,user,{action:'question',question:message},[source]);","await source.run();"],
  ['updateRollback','service',"statements.push(...extraStatements);","await env.DB.batch(extraStatements);"],

  ['flag','routes',"if(!roundCallsEnabled(c.env)) return","if(false) return"],
  ['access','routes',"return c.json(await investorPage(c.env,call,await investor(c)))","return c.json(await investorPage(c.env,call,user))"],
  ['responseAccess','routes',"if(!verifiedInvestor(user)) throw new RoundCallError('verified_investor_required',403);",""],
  ['ownership','routes',"project.founder_id !== user.founder_id","false"],
  ['ownership','routes',"!projectInActiveCompany(companyId,project)","false"],
  ['counselRole','routes',"await requireSuperAdmin(c); const page","const page"],
  ['send','service',"if (!counselApproved(call))","if (false)"],
  ['privacy','service',"const recipients = (rows.results || []).map(founderRecipient);","const recipients = (rows.results || []).map(row=>({...founderRecipient(row),name:row.name,email:row.email,investor_user_id:row.investor_user_id}));"],
  ['pipeline','service',"...roundCallPipelineStatements(env,{callId:call.id,projectId:call.project_id,investorId:investor.id,name:investor.name,email:investor.email,at,commitmentCents:cents}),",""],
  ['rollback','service',"statements.push(await audit(env,investor,call.project_id,'round_call_response_requested',{uid:call.uid,action}));",""],
  ['closed','service',"read_only:!writableCall(call,today())","read_only:false"],
  ['nda','service',"active?.granted_by_user_id ?? call.created_by","call.created_by"],
  ['invalidation','service',"counsel_approved_hash=NULL, counsel_approval_reference=NULL, counsel_approved_by=NULL, counsel_approved_at=NULL, updated_at=?","updated_at=?"],
];
for(const [index,[name,kind,old,replacement]]of probes.entries())test('D653 request mutation/restoration '+index+': '+name,async()=>{
  const path=kind==='routes'?'cloudflare-worker/src/routes/round_calls.ts':kind==='updateRoutes'?'cloudflare-worker/src/routes/portfolio_updates.ts':'cloudflare-worker/src/services/roundCalls.ts';
  const mutant=await altered(path,old,replacement,index);
  await assert.rejects(()=>checks[name]({...actual,[kind]:kind==='service'?mutant:mutant.default}),assert.AssertionError);
  await checks[name](actual);
});
