/** D1487/D1488 (#3724): real SQLite routes, private signal ownership, eligibility, vectors and Explain billing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import rec, { EVENT_REC_AI, EVENT_REC_PAGE } from '../src/routes/event_recommendations.ts';
import events from '../src/routes/events.ts';
import eventsPublic from '../src/routes/events_public.ts';
import { RECOMMENDATION_DEPS, cosine } from '../src/services/eventRecommendations.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { AI_BUDGET_MIGRATION, AI_LOG_SCHEMA, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest, run as runAI } from '../src/services/aiRouter.ts';
import { tableFromBaseline } from './_baseline.mjs';
const SECRET = 'synthetic-3724-event-recommendation-secret';
function table(name: string) {
  const files = ['schema_baseline.sql', ...readdirSync(new URL('../sql/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort(compareMigrations).map(f=>'migrations/'+f)];
  for (const file of files) { try { return tableFromBaseline(readFileSync(new URL('../sql/'+file,import.meta.url),'utf8'),name); } catch {} }
  throw new Error('table absent: '+name);
}
function fixture() {
  const db = new DatabaseSync(':memory:',{ enableForeignKeyConstraints:false });
  for (const t of ['users','projects','assessment_results','raise_rounds','customer_segments','job_postings','investor_profiles','advisors','advisor_services','engagements','ai_rail_preferences','ai_usage_logs']) db.exec(table(t));
  for (const f of ['109_events_core.sql','392_event_organiser.sql','546_events_review_columns.sql','611_event_registrations_comp_promoted.sql','493_ai_usage_charged.sql','709_event_recommendations.sql']) db.exec(readFileSync(new URL('../sql/migrations/'+f,import.meta.url),'utf8'));
  db.exec("INSERT INTO users (id,email,name,role,founder_id,partner_id) VALUES (1,'host@example.test','Host','admin',NULL,NULL),(2,'founder@example.test','Founder','founder',20,NULL),(3,'investor@example.test','Investor','investor',NULL,NULL),(4,'advisor@example.test','Advisor','advisor',NULL,NULL),(5,'partner@example.test','Partner','partner',NULL,50),(6,'explorer@example.test','Explorer','exploring',NULL,NULL),(7,'other@example.test','Other private member','founder',70,NULL);" );
  db.exec("INSERT INTO projects (id,name,founder_id,stage,sector) VALUES (10,'Synthetic venture',20,'MVP','fintech'),(11,'Other private venture',70,'MVP','fintech');");
  db.exec("INSERT INTO raise_rounds (id,uid,project_id,name,status) VALUES (1,'own-round',10,'Seed','active'),(2,'other-round',11,'Secret Series Z','active');");
  db.exec("INSERT INTO customer_segments (id,project_id,name,name_norm) VALUES (1,10,'CFOs','cfos'); INSERT INTO job_postings (id,slug,project_id,title,status) VALUES (1,'own-job',10,'Engineer','published');");
  db.exec("INSERT INTO investor_profiles (user_id,sectors_json,stages_json,thesis_text) VALUES (3,'[\"climate\"]','[\"Seed\"]','Private thesis must never leave'); INSERT INTO advisors (id,uid,user_id,display_name) VALUES (4,'advisor',4,'Advisor'); INSERT INTO advisor_services (uid,advisor_id,title) VALUES ('own-service',4,'Marketing sprint');");
  db.exec("INSERT INTO engagements (uid,need_id,quote_id,partner_id,founder_id,project_id,price) VALUES ('own-engagement',1,1,50,20,10,100);");
  db.exec("INSERT INTO assessment_results (session_id,game_id,user_id,track) VALUES (2,1,2,'founder_origin_v1'),(6,1,6,'explorer_v1');");
  const insert = db.prepare("INSERT INTO events (id,slug,host_user_id,title,summary,description,type,starts_at,status,visibility,admin_published,topics_json) VALUES (?,?,1,?,?,?,'workshop','2099-01-01T10:00:00Z','published','public',1,?)");
  for (let i=1;i<=16;i++) insert.run(i,'event-'+i,'Fintech Seed CFOs engineer climate marketing MVP workshop '+i,'Synthetic venture workshop','Recorded content','["fundraising","ai"]');
  const DB = d1Over(db); const app = new Hono<any>().route('/api/events',rec).route('/api/events',events).route('/api/public',eventsPublic);
  const env:any={ DB,JWT_SECRET:SECRET,ENVIRONMENT:'development' };
  return { db,env,async call(path:string,user:number|null=2,method='GET',body?:unknown,support=false) {
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if (user!==null) headers.Authorization='Bearer '+await new SignJWT({user_id:user,...(support?{impersonated_by:1}:{})}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const r=await app.fetch(new Request('http://test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(){},passThroughOnException(){}});
    return {status:r.status,body:await r.json() as any};
  }};
}

test('record reasons belong to the caller; each profile uses its own records, with honest missing and unreadable signals',async()=>{
  const f=fixture();try {
    const founder=await f.call('/api/events/recommended');assert.equal(founder.status,200,JSON.stringify(founder.body));
    const reasons=founder.body.events.flatMap((e:any)=>e.reasons);
    assert.ok(reasons.some((r:any)=>r.code==='raise_round'&&r.text==='You have a Seed round open.'&&r.ref.id===1));
    assert.ok(reasons.every((r:any)=>!/(attend|[0-9]+ investors)/i.test(r.text)));
    assert.ok(!JSON.stringify(founder.body).includes('Secret Series Z'));assert.ok(!JSON.stringify(founder.body).includes('Other private member'));assert.ok(reasons.filter((r:any)=>r.code==='sector'||r.code==='stage').every((r:any)=>r.ref.id===10));
    for (const [user,code] of [[3,'thesis'],[4,'service'],[5,'engagement']] as const) { const r=await f.call('/api/events/recommended',user);assert.equal(r.status,200);assert.ok(r.body.events.some((e:any)=>e.reasons.some((x:any)=>x.code===code)),code);assert.ok(!JSON.stringify(r.body).includes('Private thesis must never leave')); }
    f.db.exec("UPDATE investor_profiles SET sectors_json='[\"AI\"]' WHERE user_id=3");assert.ok((await f.call('/api/events/recommended',3)).body.events.some((e:any)=>e.reasons.some((r:any)=>r.code==='thesis'&&r.text.includes('AI'))));
    f.db.exec('DELETE FROM assessment_results WHERE user_id=6');const explorer=await f.call('/api/events/recommended',6);assert.ok(explorer.body.events.some((e:any)=>e.reasons.some((r:any)=>r.text==='Popular with new members')));
    f.db.exec('DELETE FROM raise_rounds WHERE id=1');const missing=await f.call('/api/events/recommended');assert.equal(missing.body.signals.raise_round,'not_recorded');assert.ok(!missing.body.events.some((e:any)=>e.reasons.some((r:any)=>r.code==='raise_round')));
    f.db.exec('DROP TABLE customer_segments');const failed=await f.call('/api/events/recommended');assert.equal(failed.status,200);assert.equal(failed.body.signals.segment,'unreadable');assert.equal(failed.body.signals.sector,'read');
    f.db.exec('DROP TABLE events');assert.equal((await f.call('/api/events/recommended')).status,503);
  }finally{f.db.close();}
});

test('candidate gates exclude private, unlisted, unapproved, past, cancelled, hosted, held, ineligible and hidden events',async()=>{
  const f=fixture();try {
    f.db.exec("UPDATE events SET visibility='private' WHERE id=2; UPDATE events SET visibility='unlisted' WHERE id=3; UPDATE events SET admin_published=0 WHERE id=4; UPDATE events SET starts_at='2000-01-01' WHERE id=5; UPDATE events SET status='cancelled' WHERE id=6; UPDATE events SET host_user_id=2 WHERE id=7; UPDATE events SET audience_rules_json='{\"mode\":\"selected\",\"roles\":[\"investor\"]}' WHERE id=9;");
    f.db.exec("INSERT INTO event_registrations(event_id,user_id,email,status) VALUES (8,2,'founder@example.test','confirmed');");
    assert.equal((await f.call('/api/events/10/recommendation-feedback',2,'POST',{verdict:'not_for_me',reason:'topic'})).status,200);
    const r=await f.call('/api/events/recommended?limit=50');assert.equal(r.status,200);const ids=r.body.events.map((e:any)=>e.id);assert.ok(ids.includes(1));for(let i=2;i<=10;i++)assert.ok(!ids.includes(i),'excluded '+i);
    assert.ok(!JSON.stringify(r.body).includes('attendee'));assert.ok(r.body.events.every((e:any)=>e.source==='axal'&&e.registration_eligible.eligible===true&&e.location_url===null));
    f.db.exec('DROP TABLE IF EXISTS user_personas');f.db.exec("UPDATE events SET audience_rules_json='{\"mode\":\"selected\",\"roles\":[\"advisor\"],\"personas\":[\"missing\"]}' WHERE id=1");
    assert.equal((await f.call('/api/events/recommended')).status,503,'unreadable eligibility is never eligible');
  }finally{f.db.close();}
});

test('preferences and feedback validate, remain private, reject support-session writes and disable all ranking work',async()=>{
  const f=fixture();const embed=RECOMMENDATION_DEPS.embed;const modelRun=EVENT_REC_AI.run;try {
    let modelCalls=0;EVENT_REC_AI.run=async()=>{modelCalls++;return {ok:false,error:'unexpected'} as any;};
    let calls=0;RECOMMENDATION_DEPS.embed=async()=>{calls++;return new Array(768).fill(1);};f.env.AI={};
    assert.equal((await f.call('/api/events/recommendation-prefs',null)).status,401);
    for (const body of [{enabled:'yes'},{travel_km:-1},{interests:['unknown']},{formats:['fax']},{types:['unknown']}]) assert.equal((await f.call('/api/events/recommendation-prefs',2,'PUT',body)).status,400);
    assert.equal((await f.call('/api/events/recommendation-prefs',2,'PUT',{goals_90d:'x'.repeat(501)})).body.error,'too_long');
    for(const path of ['/api/events/recommendation-prefs','/api/events/1/recommendation-feedback']) assert.equal((await f.call(path,2,path.endsWith('prefs')?'PUT':'POST',{enabled:false,verdict:'saved'},true)).status,403);
    assert.equal((await f.call('/api/events/1/recommendation-feedback',2,'POST',{verdict:'bad'})).status,400);
    assert.equal((await f.call('/api/events/1/recommendation-feedback',2,'POST',{verdict:'not_for_me',reason:'bad'})).status,400);
    assert.equal((await f.call('/api/events/1/recommendation-feedback',2,'POST',{verdict:'saved'})).status,200);
    assert.deepEqual((await f.call('/api/events/recommendation-prefs')).body.saved,[1]);assert.deepEqual((await f.call('/api/events/recommendation-prefs',3)).body.saved,[]);
    await f.call('/api/events/1/recommendation-feedback',2,'POST',{verdict:null});assert.deepEqual((await f.call('/api/events/recommendation-prefs')).body.saved,[]);
    f.db.exec("UPDATE events SET visibility='private' WHERE id=2");assert.equal((await f.call('/api/events/2/recommendation-feedback',2,'POST',{verdict:'saved'})).status,404);
    await f.call('/api/events/recommendation-prefs',2,'PUT',{enabled:false});const off=await f.call('/api/events/recommended');assert.equal(off.body.enabled,false);assert.deepEqual(off.body.events,[]);assert.equal(calls,0);assert.equal(modelCalls,0);
  }finally{RECOMMENDATION_DEPS.embed=embed;EVENT_REC_AI.run=modelRun;f.db.close();}
});

test('bounded system embeddings are cached only in D1 and invalidate when recorded content changes',async()=>{
  const f=fixture();const embed=RECOMMENDATION_DEPS.embed;try {
    let calls=0;RECOMMENDATION_DEPS.embed=async()=>{calls++;return new Array(768).fill(1);};f.env.AI={};f.env.VECTORIZE={upsert(){throw new Error('must not publish vectors');}};
    await f.call('/api/events/recommended');assert.ok(calls>0&&calls<=10);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM event_rec_member_vectors').get()!.n,1);
    f.db.exec('DELETE FROM events WHERE id>3');const before=calls;await f.call('/api/events/recommended');assert.equal(calls,before,'cached second view embeds nothing');
    f.db.exec("UPDATE events SET summary='Changed public content' WHERE id=1");await f.call('/api/events/recommended');assert.equal(calls,before+1);
    await f.call('/api/events/recommendation-prefs',2,'PUT',{goals_90d:'Raise a seed round'});await f.call('/api/events/recommended');assert.equal(calls,before+2);
    assert.equal(cosine(new Array(768).fill(1),new Array(768).fill(1)),1);assert.equal(cosine([],[]),0);assert.equal(cosine(new Array(768).fill(0),new Array(768).fill(1)),0);
  }finally{RECOMMENDATION_DEPS.embed=embed;f.db.close();}
});

test('host topics validate on create/edit and public topic filtering uses stored topics',async()=>{
  const f=fixture();try{
    const base={title:'New synthetic workshop',starts_at:'2099-02-01T10:00:00Z'};
    assert.equal((await f.call('/api/events',2,'POST',{...base,topics:['unknown']})).status,400);
    const created=await f.call('/api/events',2,'POST',{...base,topics:['ai','hiring']});assert.equal(created.status,201,JSON.stringify(created.body));assert.deepEqual(created.body.event.topics,['ai','hiring']);
    const id=created.body.event.id;assert.equal((await f.call('/api/events/'+id,3,'PATCH',{topics:['climate']})).status,403);
    assert.equal((await f.call('/api/events/'+id,2,'PATCH',{topics:['ai','ai']})).status,400);
    assert.equal((await f.call('/api/events/'+id,2,'PATCH',{topics:['climate']})).status,200);
    f.db.prepare("UPDATE events SET status='published',visibility='public',admin_published=1 WHERE id=?").run(id);
    const feed=await f.call('/api/public/events?topic=climate',null);assert.equal(feed.status,200);assert.deepEqual(feed.body.events.map((e:any)=>e.id),[id]);assert.equal(feed.body.total,1);
    assert.equal((await f.call('/api/public/events?topic=invalid',null)).status,400);
  }finally{f.db.close();}
});

test('Explain quote runs no model; paid run uses caller reasons and a fixed event rail record; refusals protect the free list',async()=>{
  const f=fixture();const original={...EVENT_REC_AI};try{
    let runs=0,quotes=0;const opts:any[]=[];
    EVENT_REC_AI.quote=async(_env:any,o:any)=>{quotes++;opts.push(o);return {ok:true,hold_microusd:120,model:'synthetic'};};
    f.db.exec("INSERT INTO ai_usage_logs(id,user_id,task,model,charged_microusd) VALUES (1,2,'rail_match','synthetic',75)");
    EVENT_REC_AI.run=async(_env:any,o:any)=>{runs++;opts.push(o);return {ok:true,output:'Your recorded round matches the fundraising topic.',usage:{} as any,usageLogId:1} as any;};
    const quote=await f.call('/api/events/1/recommendation/explain/quote',2,'POST');assert.equal(quote.status,200);assert.equal(quote.body.hold_microusd,120);assert.equal(runs,0);assert.equal(quotes,1);
    const run=await f.call('/api/events/1/recommendation/explain',2,'POST',{quote_uid:quote.body.quote_uid,user_id:7,reasons:['Secret Series Z']});assert.equal(run.status,200);assert.equal(run.body.charged_microusd,75);assert.equal(run.body.usage_log_id,1);assert.equal(runs,1);assert.equal(opts[1].userId,2);assert.equal(opts[1].rail.page,EVENT_REC_PAGE);assert.equal(opts[1].rail.record,'event:1');assert.ok(!JSON.stringify(opts).includes('Secret Series Z'));
    assert.equal((await f.call('/api/events/1/recommendation/explain',2,'POST',{},true)).status,403);assert.equal(runs,1);
    f.db.prepare("INSERT INTO ai_rail_preferences(uid,user_id,section,task,mode) VALUES ('synthetic-off',?,?,'','manual')").run(2,EVENT_REC_PAGE.toLowerCase());assert.equal((await f.call('/api/events/1/recommendation/explain/quote',2,'POST')).status,403);assert.equal(runs,1);assert.equal((await f.call('/api/events/recommended')).status,200);
    f.db.exec('DELETE FROM ai_rail_preferences');EVENT_REC_AI.quote=async()=>({ok:false,refusal:'budget_user_day',error:'synthetic'} as any);assert.equal((await f.call('/api/events/1/recommendation/explain/quote',2,'POST')).status,402);EVENT_REC_AI.quote=async()=>({ok:true,hold_microusd:120,model:'synthetic'});for(const [refusal,status] of [['budget_user_day',402],['ai_paused',403],['guard_blocked',422],['guard_unavailable',503]] as const){ EVENT_REC_AI.run=async()=>({ok:false,refusal,error:'synthetic'} as any);assert.equal((await f.call('/api/events/1/recommendation/explain',2,'POST',{quote_uid:quote.body.quote_uid})).status,status); }
  }finally{Object.assign(EVENT_REC_AI,original);f.db.close();}
});

test('migration 709 cascades member-private preferences/feedback/vectors and deletes event vectors with their event',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE events(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1); INSERT INTO events VALUES (1);');
  db.exec(readFileSync(new URL('../sql/migrations/709_event_recommendations.sql',import.meta.url),'utf8'));
  db.exec("INSERT INTO event_rec_prefs(user_id) VALUES (1); INSERT INTO event_rec_feedback(user_id,event_id,verdict) VALUES (1,1,'saved'); INSERT INTO event_rec_member_vectors(user_id,vector,norm,content_hash) VALUES (1,X'00',1,'test'); INSERT INTO event_rec_vectors(event_id,vector,norm,content_hash) VALUES (1,X'00',1,'test');");
  db.exec('DELETE FROM users WHERE id=1');
  for(const table of ['event_rec_prefs','event_rec_feedback','event_rec_member_vectors'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get()!.n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_rec_vectors').get()!.n,1);
  db.exec('DELETE FROM events WHERE id=1');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_rec_vectors').get()!.n,0);
 }finally{db.close();}
});

// D4450: a paid explanation survives an unavailable receipt; null is not a zero charge.
test('Explain retains generated text when the post-charge receipt read fails', async () => {
  const f = fixture(); const original = { ...EVENT_REC_AI };
  try {
    EVENT_REC_AI.quote = async () => ({ ok: true, hold_microusd: 120, model: 'synthetic' } as any);
    EVENT_REC_AI.run = async () => ({ ok: true, output: 'Your recorded round matches this event.', usage: {}, usageLogId: 1 } as any);
    f.db.exec("INSERT INTO ai_usage_logs(id,user_id,task,model,charged_microusd) VALUES (1,2,'rail_match','synthetic',75)");
    const quote = await f.call('/api/events/1/recommendation/explain/quote', 2, 'POST');
    const body = { quote_uid: quote.body.quote_uid };
    const charged = await f.call('/api/events/1/recommendation/explain', 2, 'POST', body);
    assert.equal(charged.status, 200);
    assert.equal(charged.body.charged_microusd, 75);
    const freshQuote = await f.call('/api/events/1/recommendation/explain/quote', 2, 'POST');
    const DB = f.env.DB;
    f.env.DB = { ...DB, prepare(sql: string) {
      const stmt = DB.prepare(sql);
      if (sql.startsWith('SELECT charged_microusd FROM ai_usage_logs')) {
        return { bind(...args: any[]) { stmt.bind(...args); return { async first() { throw new Error('synthetic receipt outage'); } }; } };
      }
      return stmt;
    } };
    const unreadable = await f.call('/api/events/1/recommendation/explain', 2, 'POST', { quote_uid: freshQuote.body.quote_uid });
    assert.equal(unreadable.status, 200, JSON.stringify(unreadable.body));
    assert.deepEqual(unreadable.body, { text: 'Your recorded round matches this event.', usage_log_id: 1, charged_microusd: null });
  } finally { Object.assign(EVENT_REC_AI, original); f.db.close(); }
});

// The real router/ledger proves that carrying the quote identity prevents a second hold and charge.
test('Explain retries reuse one paid run; quote expiry and changed member/event/input/price refuse before a charge', async () => {
  const f = fixture(); const original = { ...EVENT_REC_AI }; const embed = RECOMMENDATION_DEPS.embed;
  __resetForTest();
  try {
    const sql = (name: string) => readFileSync(new URL('../sql/migrations/'+name,import.meta.url),'utf8');
    f.db.exec('DROP TABLE ai_usage_logs'); f.db.exec(AI_LOG_SCHEMA);
    f.db.exec(AI_BUDGET_MIGRATION + ['510_member_ai_pauses.sql','525_ai_reservation_idempotency.sql','632_ai_hold_context.sql'].map(sql).join('\n'));
    setFixtureAllowance(f.db, 0);
    f.db.exec("UPDATE users SET subscription_tier='growth',subscription_status='active' WHERE id IN (2,7); INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES (2,5000000),(7,5000000)");
    f.db.exec('UPDATE users SET founder_id=20 WHERE id=7; DELETE FROM assessment_results WHERE user_id IN (2,7)');
    let calls = 0;
    f.env.AI = withGuard({ run: async () => { calls++; return { response: 'Your recorded round matches this event.', usage: { prompt_tokens: 40, completion_tokens: 10 } }; } });
    RECOMMENDATION_DEPS.embed = async () => new Array(768).fill(1);
    EVENT_REC_AI.run = runAI;
    const beforeQuote = Date.now();
    const quote = await f.call('/api/events/1/recommendation/explain/quote',2,'POST');
    const afterQuote = Date.now();
    assert.equal(quote.status,200,JSON.stringify(quote.body));
    assert.equal(Date.parse(quote.body.expires_at),parseInt(quote.body.quote_uid.split('.')[0],36));
    assert.ok(Date.parse(quote.body.expires_at)>=beforeQuote+10*60_000 && Date.parse(quote.body.expires_at)<=afterQuote+10*60_000,'the existing deck quote lifetime is ten minutes');
    const body = {quote_uid:quote.body.quote_uid};
    const balance = () => Number(f.db.prepare('SELECT balance_microusd FROM ai_topup_accounts WHERE user_id=2').get()!.balance_microusd);
    const holds = () => f.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get()!.n;
    const rejected = async (payload: unknown, event = 1, user = 2) => {
      const r = await f.call(`/api/events/${event}/recommendation/explain`,user,'POST',payload);
      assert.equal(r.status,409,JSON.stringify(r.body));
      assert.equal(r.body.message,'This price has expired. Get a new quote.');
      assert.deepEqual([calls,holds(),balance()],[0,0,5000000]);
    };
    await rejected({});
    const [,signature] = body.quote_uid.split('.');
    await rejected({quote_uid:(Date.now()-1).toString(36)+'.'+signature});
    await rejected({quote_uid:body.quote_uid.replace(/.$/, (v: string) => v === '0' ? '1' : '0')});
    await rejected(body,2);
    await rejected(body,1,7);
    f.db.exec("UPDATE events SET summary='Synthetic venture worksh0p' WHERE id=1");
    await rejected(body);
    f.db.exec("UPDATE events SET summary='Synthetic venture workshop' WHERE id=1");
    const quoteFn = EVENT_REC_AI.quote;
    EVENT_REC_AI.quote = async (env,opts) => { const q = await quoteFn(env,opts); return q.ok ? {...q,hold_microusd:q.hold_microusd+1} : q; };
    await rejected(body);
    EVENT_REC_AI.quote = quoteFn;
    const first = await f.call('/api/events/1/recommendation/explain',2,'POST',body);
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.text,'Your recorded round matches this event.');
    assert.equal(calls,1);
    assert.ok(balance()<5000000,'the first run charged actual top-up tokens');
    assert.equal(first.body.charged_microusd,5000000-balance());
    assert.ok(Number.isSafeInteger(first.body.usage_log_id) && first.body.usage_log_id>0);
    const usageRows = () => f.db.prepare("SELECT COUNT(*) AS n FROM ai_usage_logs WHERE task='rail_match'").get()!.n;
    assert.equal(usageRows(),1);
    const chargedBalance = balance(); const held = holds();
    const again = await f.call('/api/events/1/recommendation/explain',2,'POST',body);
    assert.deepEqual([again.status,again.body.error],[409,'step_replayed']);
    assert.equal(usageRows(),1,'a replay writes no second charged usage row');
    assert.deepEqual([calls,holds(),balance()],[1,held,chargedBalance],'a retry takes no second hold or charge');
    const key = f.db.prepare("SELECT idempotency_key FROM ai_budget_reservations WHERE operation='ai.rail_match'").get()!.idempotency_key;
    assert.equal(key,`event-explain:2:1:${body.quote_uid}`);
    const fresh = await f.call('/api/events/1/recommendation/explain/quote',2,'POST');
    assert.notEqual(fresh.body.quote_uid,body.quote_uid);
    const next = await f.call('/api/events/1/recommendation/explain',2,'POST',{quote_uid:fresh.body.quote_uid});
    assert.equal(next.status,200,JSON.stringify(next.body));
    assert.equal(calls,2,'a fresh displayed quote can start a new paid run');
    assert.ok(balance()<chargedBalance);
  } finally { Object.assign(EVENT_REC_AI,original);RECOMMENDATION_DEPS.embed=embed;__resetForTest();f.db.close(); }
});
