/** D653: mounted requests and real atomic writes over the canonical SQLite schema. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import routes from '../src/routes/round_calls.ts';
import updateRoutes from '../src/routes/portfolio_updates.ts';
import * as service from '../src/services/roundCalls.ts';
import { termsHash, deckContentHash } from '../src/services/roundCallPolicy.ts';
import { hardDeleteProject } from '../src/services/projectTrash.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const SECRET='fixture-only-d653-01234567890123456789';
const baseline=readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8');
const terms={name:'Energy seed',amount_cents:10000000,instrument:'safe',terms:'Recorded round terms',minimum_cheque_cents:100000,
  target_close:'2099-01-15',deck_id:1,deck_version:2,data_room_project_uid:'energy',stage:'seed',sector:'climate'};
async function fixture(state='sent',migration=readFileSync('cloudflare-worker/sql/migrations/436_round_calls.sql','utf8')) {
  const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
  for(const table of ['entities','users','founders','super_admins','user_sessions','user_company_links','projects','raise_rounds','raise_prospects',
    'contacts','activity_logs','pitch_decks','cap_table_scenarios','investor_profiles','data_room_files','data_room_folders',
    'data_room_grants','pairwise_ndas','notifications_inbox','user_settings',
    'mi_pro_subscriptions','portfolio_updates','job_postings']) {
    db.exec(tableFromBaseline(baseline,table));
  }
  // Not in the baseline: these two come from their own migrations (302, 277).
  db.exec(readFileSync('cloudflare-worker/sql/migrations/302_push_subscriptions.sql','utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/277_user_recovery_state.sql','utf8'));
  db.exec(migration);
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
  const deckHash=await deckContentHash('[]');
  const hash=await termsHash({...terms,deck_content_hash:deckHash});
  db.prepare('INSERT INTO round_calls(id,uid,project_id,company_id,name,amount_cents,instrument,terms,minimum_cheque_cents,target_close,deck_id,deck_version,data_room_project_uid,stage,sector,state,terms_hash,created_by) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('call',1,10,terms.name,terms.amount_cents,terms.instrument,terms.terms,terms.minimum_cheque_cents,terms.target_close,1,2,'energy','seed','climate',state,hash,1);
  db.prepare('UPDATE round_calls SET deck_content_hash=? WHERE id=1').run(deckHash);
  for(const id of [4,5,6,8])db.prepare("INSERT INTO round_call_recipients(call_id,investor_user_id,origin,match_reasons_json) VALUES(1,?,'match','[\"Stage fits seed\"]')").run(id);
  const env:any={DB:d1Over(db),JWT_SECRET:SECRET,ENVIRONMENT:'production',ROUND_CALLS_ENABLED:'true'};
  return {db,env,counsel:db.prepare('SELECT * FROM users WHERE id=3').get() as any,other:db.prepare('SELECT * FROM users WHERE id=2').get() as any,plain:db.prepare('SELECT * FROM users WHERE id=9').get() as any,actor:db.prepare('SELECT * FROM users WHERE id=1').get() as any,investor:db.prepare('SELECT * FROM users WHERE id=4').get() as any};
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
const actual={routes,service,updateRoutes,migration:readFileSync('cloudflare-worker/sql/migrations/436_round_calls.sql','utf8'),wrangler:readFileSync('wrangler.toml','utf8')};
const statusOf=async(action:()=>Promise<unknown>)=>{try{await action();return 200;}catch(e:any){return e.status||500;}};
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
    const disabled=await statusOf(()=>m.service.loadCall({...f.env,ROUND_CALLS_ENABLED:'false'},'call'));
    assert.deepEqual([results,availability.body.enabled,count(f.db,'contacts'),disabled],[[503,503,503],false,0,503]);},
  async access(m){const f=await fixture();const statuses=[];
    for(const who of [4,5,6,7,8,null])statuses.push((await request(f,m.routes,'/call',who)).status);
    const direct=[];for(const id of [4,5,6,7,8])direct.push(await statusOf(()=>m.service.investorPage(f.env,f.db.prepare('SELECT * FROM round_calls').get(),f.db.prepare('SELECT * FROM users WHERE id=?').get(id))));
    assert.deepEqual([statuses,direct],[[200,403,404,404,401,401],[200,403,403,404,403]]);},
  async responseAccess(m){const f=await fixture();const statuses=[];
    for(const who of [5,6,7])statuses.push((await request(f,m.routes,'/call/responses',who,'POST',{action:'question',question:'Can I read?'})).status);
    const denied=await statusOf(()=>m.service.respond(f.env,f.db.prepare('SELECT * FROM round_calls').get(),f.db.prepare('SELECT * FROM users WHERE id=5').get(),{action:'question',question:'Denied'}));
    assert.deepEqual([statuses,denied,count(f.db,'contacts'),count(f.db,'round_call_questions'),count(f.db,'activity_logs')],[[403,403,404],403,0,0,0]);},
  async ownership(m){const f=await fixture();const statuses=[];
    for(const who of [1,2,9])statuses.push((await request(f,m.routes,'/context?project_id=1',who)).status);
    statuses.push((await request(f,m.routes,'/context?project_id=1',1,'GET',undefined,{}, {'X-Company-Id':'11'})).status);
    const wrong=await statusOf(()=>m.service.founderPage(f.env,f.db.prepare('SELECT * FROM round_calls').get(),f.other));
    f.db.exec('UPDATE users SET founder_id=NULL WHERE id=1; UPDATE projects SET founder_id=NULL WHERE id=1');
    statuses.push((await request(f,m.routes,'/context?project_id=1',1)).status);
    const orphan=await statusOf(()=>m.service.founderPage(f.env,f.db.prepare('SELECT * FROM round_calls').get(),f.actor));
    assert.deepEqual([statuses,wrong,orphan],[[200,404,403,404,404],404,404]);},
  async counselRole(m){const f=await fixture('draft');
    const direct=await statusOf(()=>m.service.founderPage(f.env,f.db.prepare('SELECT * FROM round_calls').get(),f.plain));
    assert.deepEqual([(await request(f,m.routes,'/call',9)).status,(await request(f,m.routes,'/call',3)).body.viewer,direct],[403,'counsel',403]);},
  async send(m){const f=await fixture('draft');const r=await request(f,m.routes,'/call/send',1,'POST',{acknowledge_missing:true});
    assert.deepEqual([r.status,r.body.code,f.db.prepare('SELECT state FROM round_calls').get()!.state,count(f.db,'notifications_inbox')],[409,'counsel_approval_required','draft',0]);},
  async privacy(m){const f=await fixture();await request(f,m.routes,'/call',4);
    const before=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'),f.actor);
    await m.service.respond(f.env,await m.service.loadCall(f.env,'call'),f.investor,{action:'question',question:'What is the use of funds?'});
    const after=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'),f.actor);
    const b=before.recipients[0],a=after.recipients[0];
    assert.deepEqual([!!b.opened_at,Object.hasOwn(b,'name'),Object.hasOwn(b,'email'),Object.hasOwn(b,'investor_user_id'),a.name,a.email],[true,false,false,false,'Ivy','ivy@example.test']);},
  async pipeline(m){const f=await fixture();const call=await m.service.loadCall(f.env,'call');
    await m.service.respond(f.env,call,f.investor,{action:'commit',amount_cents:250000});
    await m.service.respond(f.env,call,f.investor,{action:'commit',amount_cents:300000});
    await m.service.respond(f.env,call,f.investor,{action:'question',question:'A real question'});
    const row=f.db.prepare('SELECT amount,commit_status,contact_id FROM raise_prospects').get() as any;
    assert.ok(row,'a commitment wrote no prospect');
    assert.deepEqual([count(f.db,'contacts'),count(f.db,'raise_rounds'),count(f.db,'raise_prospects'),count(f.db,'round_call_questions'),row.amount,row.commit_status,!!row.contact_id],[1,1,1,1,3000,'soft',true]);},
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
    await m.service.recordCounsel(f.env,call,f.counsel,'Counsel approval fixture',call.terms_hash,call.revision);
    const approved=await m.service.loadCall(f.env,'call');
    const edited=await m.service.saveDraft(f.env,await m.service.projectFacts(f.env,1),f.actor,{...terms,terms:'Changed terms'},approved);
    let stale=false;try{await m.service.recordCounsel(f.env,edited,f.counsel,'Counsel approval fixture',approved.terms_hash,approved.revision);}catch{stale=true;}
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
    const page=await m.service.founderPage(f.env,await m.service.loadCall(f.env,'call'),f.actor);
    assert.deepEqual([landed,count(f.db,'update_ask_replies'),count(f.db,'round_call_questions'),count(f.db,'raise_prospects'),page.questions.map((q:any)=>q.question),page.recipients[0].name],[true,1,1,1,['Question from the update'],'Ivy']);},
  async updateRollback(m){const ok=await fixture();const okAsk=seedAsk(ok);
    assert.equal(await m.service.replyToLinkedCall(ok.env,okAsk,ok.investor,'Question from the update','reply'),true);
    assert.equal(count(ok.db,'update_ask_replies'),1,'a reply to a linked ask lands with the question, in the same batch');
    const f=await fixture();const ask=seedAsk(f);f.db.exec('DROP TABLE activity_logs');
    let failed=false;try{await m.service.replyToLinkedCall(f.env,ask,f.investor,'Question from the update','reply');}catch{failed=true;}
    assert.deepEqual([failed,count(f.db,'update_ask_replies'),count(f.db,'round_call_questions'),count(f.db,'raise_prospects')],[true,0,0,0]);},

  async delivered(m){const f=await fixture('draft');
    f.db.exec('DELETE FROM round_call_recipients WHERE investor_user_id<>4');
    const call=await m.service.loadCall(f.env,'call');
    await m.service.recordCounsel(f.env,call,f.counsel,'Counsel approval fixture',call.terms_hash,call.revision);
    const approved=await m.service.loadCall(f.env,'call');
    const sent=await m.service.sendCall(f.env,approved,f.actor,false);
    let duplicate=false;try{await m.service.sendCall(f.env,await m.service.loadCall(f.env,'call'),f.actor,false);}catch{duplicate=true;}
    assert.deepEqual([sent.state,sent.recipients,sent.notified,sent.not_delivered,count(f.db,'notifications_inbox'),duplicate],['sent',1,1,0,1,true]);},
  async wired(m){const f=await fixture();
    f.db.exec("INSERT INTO contacts(id,uid,project_id,audience,name,email) VALUES(10,'contact',1,'investor','Ivy','ivy@example.test'); INSERT INTO raise_prospects(uid,project_id,contact_id,email,stage,amount,commit_status) VALUES('prospect',1,10,'ivy@example.test','committed',7000,'wired')");
    await m.service.respond(f.env,await m.service.loadCall(f.env,'call'),f.investor,{action:'commit',amount_cents:250000});
    const row=f.db.prepare('SELECT amount,commit_status FROM raise_prospects').get()!;
    assert.deepEqual([row.amount,row.commit_status,count(f.db,'contacts'),count(f.db,'raise_prospects')],[7000,'wired',1,1]);},

  async selfApproval(m){const f=await fixture('draft');const call=await m.service.loadCall(f.env,'call');
    const status=await statusOf(()=>m.service.recordCounsel(f.env,call,f.actor,'Counsel approval fixture',call.terms_hash,call.revision));
    assert.deepEqual([status,f.db.prepare('SELECT counsel_approved_hash FROM round_calls').get()!.counsel_approved_hash,count(f.db,'activity_logs')],[403,null,0]);},
  async extension(m){const f=await fixture();f.db.exec("UPDATE round_calls SET target_close='2020-01-01'");
    const extended=await m.service.manageCall(f.env,await m.service.loadCall(f.env,'call'),f.actor,{action:'extend',target_close:'2099-02-01'});
    const paused=await statusOf(()=>m.service.respond(f.env,extended,f.investor,{action:'question',question:'Paused?'}));
    const renewed=await statusOf(()=>m.service.recordCounsel(f.env,extended,f.counsel,'Counsel renewed approval',extended.terms_hash,extended.revision));
    const resumed=await m.service.loadCall(f.env,'call');
    const response=await statusOf(()=>m.service.respond(f.env,resumed,f.investor,{action:'question',question:'Resumed'}));
    assert.deepEqual([extended.state,extended.counsel_approved_hash,paused,renewed,resumed.state,response,count(f.db,'notifications_inbox')],['awaiting_counsel',null,409,200,'sent',200,0]);},
  async deckApproval(m){const f=await fixture('draft');f.db.exec('DELETE FROM round_call_recipients WHERE investor_user_id<>4');
    const call=await m.service.loadCall(f.env,'call');await m.service.recordCounsel(f.env,call,f.counsel,'Counsel approval fixture',call.terms_hash,call.revision);
    f.db.exec(`UPDATE pitch_decks SET slides='[{"title":"Changed after approval"}]'`);
    const approved=await m.service.loadCall(f.env,'call');
    const status=await statusOf(()=>m.service.sendCall(f.env,approved,f.actor,false));
    assert.deepEqual([status,f.db.prepare('SELECT state FROM round_calls').get()!.state,count(f.db,'notifications_inbox')],[409,'draft',0]);},
  async responseRace(m){const f=await fixture();const call=await m.service.loadCall(f.env,'call');
    await m.service.respond(f.env,call,f.investor,{action:'question',question:'First response'});
    f.db.exec('DELETE FROM activity_logs; DELETE FROM round_call_questions');
    const real=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async(statements:any[])=>{f.db.exec("UPDATE round_calls SET state='closed'");return real(statements);};
    const status=await statusOf(()=>m.service.respond(f.env,call,f.investor,{action:'question',question:'Rejected race'}));
    assert.deepEqual([status,count(f.db,'activity_logs'),count(f.db,'round_call_questions')],[409,0,0]);},
  async purge(m){const f=await fixture('sent',m.migration);
    f.db.exec("INSERT INTO round_call_questions(uid,call_id,investor_user_id,question) VALUES('purge-q',1,4,'Private'); UPDATE round_calls SET deck_id=NULL; DELETE FROM pitch_decks; DELETE FROM data_room_folders; PRAGMA foreign_keys=ON");
    const ok=await statusOf(()=>hardDeleteProject(f.env,1));
    assert.deepEqual([ok,count(f.db,'projects'),count(f.db,'round_calls'),count(f.db,'round_call_recipients'),count(f.db,'round_call_questions')],[200,0,0,0,0]);},
  async productionFlag(m){const vars=(section:string)=>m.wrangler.split('['+section+']')[1]?.split(/\n\[/)[0];
    assert.deepEqual(['vars','env.production.vars'].map(section=>/ROUND_CALLS_ENABLED\s*=\s*"([^"]+)"/.exec(vars(section)||'')?.[1]),['false','false']);},

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
    if(spec.startsWith('data:'))return 'from '+q+spec+q;
    let target;if(spec.startsWith('.')){target=resolve(dirname(path),spec);if(!existsSync(target)||(statSync(target).isDirectory()&&existsSync(target+'.ts')))target+='.ts';else if(statSync(target).isDirectory())target=resolve(target,'index.ts');}else{try{target=req.resolve(spec);}catch{return _m;}}
    return 'from '+q+pathToFileURL(target).href+q;
  });
  const url='data:text/javascript;base64,'+Buffer.from(js+'\n// d653-'+index).toString('base64');
  return {module:await import(url),url};
}
const probes=[
  ['selfApproval','service',"expectedRevision:unknown) {\n  await counselActor(env,actor,call.project_id);", "expectedRevision:unknown) {"],
  ['extension','service',"SET state='awaiting_counsel',target_close", "SET state='sent',target_close"],
  ['deckApproval','service',"if(!deck||await deckContentHash(deck.slides)!==call.deck_content_hash)", "if(false)"],
  ['responseRace','service',"AND response_claim=?)", "AND ? IS NOT NULL)"],
  ['purge','migration',"REFERENCES round_calls(id) ON DELETE CASCADE", "REFERENCES round_calls(id)"],
  ['productionFlag','wrangler','ROUND_CALLS_ENABLED = "false"','ROUND_CALLS_ENABLED = "true"'],
  ['wired','contacts',"COALESCE(commit_status,'') NOT IN ('signed','wired')","1=1"],
  ['delivered','service',"if(id!=null) notified++;","if(false) notified++;"],
  ['updateLink','updateRoutes',"const callUid=kind==='capital'?await openCallForUpdate(c.env,u.project_id):null;","const callUid=null;"],
  ['updateFlag','service',"if(!roundCallsEnabled(env)) return null;",""],
  ['updatePrivacy','service',"if(audienceName==='network')return {...ask,link_ref:null};",""],
  ['updatePrivacy','service',"verifiedInvestor(user)?1:0","1"],
  ['updateReply','service',"await respond(env,row,user,{action:'question',question:message},claim=>[source(claim)]);","await source(crypto.randomUUID()).run();"],
  ['updateRollback','service',"statements.push(...extraStatements(claim));","await env.DB.batch(extraStatements(claim));"],

  ['flag','service',"if(!roundCallsEnabled(env)) throw","if(false) throw"],
  ['access','service',"if(!current||!verifiedInvestor(current))","if(false)"],
  ['responseAccess','service',"if(!current||!verifiedInvestor(current))","if(false)"],
  ['ownership','service',"current.founder_id==null||current.founder_id!==project.founder_id","false"],
  ['ownership','routes',"!projectInActiveCompany(companyId,project)","false"],
  ['counselRole','service',"JOIN super_admins s ON s.user_id=u.id",""],
  ['send','service',"if (!counselApproved(call))","if (false)"],
  ['privacy','service',"const recipients = (rows.results || []).map(founderRecipient);","const recipients = (rows.results || []).map(row=>({...founderRecipient(row),name:row.name,email:row.email,investor_user_id:row.investor_user_id}));"],
  ['pipeline','service',"...roundCallPipelineStatements(env,{callId:call.id,projectId:call.project_id,investorId:investor.id,name:investor.name,email:investor.email,at,claim,commitmentCents:cents}),",""],
  ['rollback','service',"statements.push(await responseAudit(env,investor,call,action,claim));",""],
  ['closed','service',"read_only:!writableCall(call,today())","read_only:false"],
  ['nda','service',"active?.granted_by_user_id ?? call.created_by","call.created_by"],
  ['invalidation','service',"counsel_approved_hash=NULL, counsel_approval_reference=NULL, counsel_approved_by=NULL, counsel_approved_at=NULL, updated_at=?","updated_at=?"],
];
for(const [index,[name,kind,old,replacement]]of probes.entries())test('D653 request mutation/restoration '+index+': '+name,async()=>{
  if(kind==='migration'||kind==='wrangler'){if(!actual[kind].includes(old))throw Error('Stale configuration mutation: '+old);await assert.rejects(()=>checks[name]({...actual,[kind]:actual[kind].replaceAll(old,replacement)}),assert.AssertionError);await checks[name](actual);return;}
  const path=kind==='routes'?'cloudflare-worker/src/routes/round_calls.ts':kind==='updateRoutes'?'cloudflare-worker/src/routes/portfolio_updates.ts':kind==='contacts'?'cloudflare-worker/src/routes/contacts.ts':'cloudflare-worker/src/services/roundCalls.ts';
  let mutant=await altered(path,old,replacement,index);
  let target=kind;
  if(kind==='contacts'){mutant=await altered('cloudflare-worker/src/services/roundCalls.ts',"from '../routes/contacts'","from '"+mutant.url+"'",index+1000);target='service';}
  let wired:any={[target]:target==='service'?mutant.module:mutant.module.default};
  // A changed service must reach the checks that go through the routes too,
  // so the routes are rebuilt over the mutant rather than the real service.
  if(target==='service'){
    const svc="from '../services/roundCalls'";
    wired.routes=(await altered('cloudflare-worker/src/routes/round_calls.ts',svc,"from '"+mutant.url+"'",index+2000)).module.default;
    wired.updateRoutes=(await altered('cloudflare-worker/src/routes/portfolio_updates.ts',svc,"from '"+mutant.url+"'",index+3000)).module.default;
  }
  await assert.rejects(()=>checks[name]({...actual,...wired}),assert.AssertionError);
  await checks[name](actual);
});
