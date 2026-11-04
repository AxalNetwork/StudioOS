/** D4488 (#4488): real migrated D1, mounted Distribution Ask and a synthetic AI; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import router from '../src/routes/grow_distribution_ask.ts';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withGuard } from './_guard_stub.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { proposeRail, decideRail } from '../src/services/railProposals.ts';
import { DISTRIBUTION_PAGE, DISTRIBUTION_OPTION } from '../src/services/distributionDrafts.ts';

test.after(removeMigratedDatabases);
const SECRET = 'synthetic-4488'.repeat(8);
const BASE = '/api/grow/distribution/ask';
const REQUEST = { project: 1, campaign_uid: 'campaign-one', kinds: ['post'], sources: ['validate', 'research', 'distribution'] };
function fixture(answer = '{"drafts":[{"index":0,"text":"Try our shipment checklist."}]}') {
  __resetForTest();
  const db = migratedDatabase();
  db.exec(`INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES (1,'Synthetic Founder','one@example.invalid','founder',100,1),(2,'Other','two@example.invalid','founder',200,1),(3,'Reader','three@example.invalid','advisor',NULL,1);
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic Venture',100),(2,'Other Venture',200);
    INSERT INTO project_members(project_id,user_id,role,status) VALUES (1,3,'advisor','accepted');
    INSERT INTO grow_campaigns(id,uid,project_id,name,goal,created_by) VALUES (1,'campaign-one',1,'Demo','demos',1),(2,'campaign-other',2,'Other','sales',2);
    INSERT INTO customer_segments(id,project_id,name,name_norm,description) VALUES (1,1,'Shipment teams','shipment teams','Late shipments'),(2,2,'PRIVATE other audience','other','PRIVATE other pain');
    INSERT INTO pain_groups(project_id,title) VALUES (1,'Missing shipment updates');
    INSERT INTO growth_channels(uid,project_id,name,state,utm_source) VALUES ('channel-one',1,'LinkedIn','testing','linkedin');
    INSERT INTO discovery_interviews(project_id,interviewee_name,notes,quote_consent) VALUES (1,'PRIVATE identity','Consented synthetic research',1),(1,'PRIVATE nonconsenting','PRIVATE nonconsenting note',0),(2,'PRIVATE other venture','PRIVATE other research',1);
    INSERT INTO project_metrics(project_id,snapshot_date,source,cash_balance,net_burn,notes) VALUES (1,'2026-11-01','mercury',987654,48000,'PRIVATE bank note');
    INSERT INTO ai_topup_accounts(user_id,balance_microusd) VALUES (1,50000000);
    INSERT OR IGNORE INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES ('founder:free',0,0,1);`);
  const prompts: string[] = [];
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development', AI: withGuard({ run: async (_m: string, i: any) => { prompts.push(JSON.stringify(i)); return { response: answer, usage: { prompt_tokens: 80, completion_tokens: 40 } }; } }) };
  const app = new Hono<any>().route(BASE, router);
  async function call(method: string, path: string, body?: unknown, who = 1) {
    const token = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(SECRET));
    const r = await app.request(`https://unit.test${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    return { status: r.status, body: await r.json() as any };
  }
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n;
  const propose = (payload: any) => proposeRail(env, { userId: 1, page: DISTRIBUTION_PAGE, option: DISTRIBUTION_OPTION, record: 'distribution:1', kind: 'draft', payload: { version: 1, project: 1, campaign_uid: 'campaign-one', target: 'campaign', sources: [], ...payload } });
  return { db, env, call, count, prompts, propose };
}

test('quote runs nothing; a quoted run stores proposals and reads only selected venture records', async () => {
  const f = fixture();
  const q = await f.call('POST','/quote',REQUEST);
  assert.equal(q.status,200);
  assert.ok(q.body.estimate.hold_microusd > 0);
  assert.equal(f.prompts.length,0);
  assert.equal(f.count('ai_rail_proposals'),0);
  const r = await f.call('POST','/run',{ ...REQUEST, quote: q.body.estimate });
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.proposals.length,1);
  assert.match(f.prompts[0],/Shipment teams/);
  assert.match(f.prompts[0],/Consented synthetic research/);
  assert.doesNotMatch(f.prompts.join(' '),/PRIVATE|987654|48000/);
  assert.equal(f.count('grow_campaign_creatives'),0);
  assert.equal(f.count('publish_sends'),0);
  assert.equal(f.count('mail_sent'),0);
});

test('unquoted run, foreign campaign and reader refuse before AI', async () => {
  const f = fixture();
  assert.equal((await f.call('POST','/run',REQUEST)).status,409);
  assert.equal((await f.call('POST','/quote',{ ...REQUEST,campaign_uid:'campaign-other' })).status,404);
  assert.equal((await f.call('POST','/quote',REQUEST,3)).status,403);
  assert.equal(f.prompts.length,0);
});

test('an exhausted allowance is 402 without proposals or provider errors', async () => {
  const f = fixture();
  f.db.exec('UPDATE ai_topup_accounts SET balance_microusd = 0');
  const q = await f.call('POST','/quote',REQUEST);
  const r = await f.call('POST','/run',{ ...REQUEST,quote:q.body.estimate });
  assert.equal(r.status,402);
  assert.match(r.body.message,/included AI allowance and top-up balance cannot cover this run/);
  assert.equal(f.count('ai_rail_proposals'),0);
  assert.equal(f.prompts.length,0);
});

test('bulk accepts only three safe kinds; all action, money and creative kinds refuse per uid', async () => {
  const f = fixture();
  const kinds = ['post','subject_line','newsletter','reply','send','schedule','ad_creative','ad_spend','budget','rule'];
  const proposals = [];
  for (const kind of kinds) proposals.push(await f.propose({ kind,text:'Synthetic copy',...(kind === 'ad_creative' ? { placement:'google_search_text',creative_field:'headline' } : {}) }));
  proposals.push(await f.propose({ kind:'post',text:'Copy',budget:100 }));
  proposals.push(await f.propose({ kind:'post',text:'Copy',values:{money:100} }));
  const r = await f.call('POST','/accept-safe',{ project:1,uids:proposals.map(p=>p.uid) });
  assert.equal(r.status,200);
  assert.deepEqual(r.body.results.map((v:any)=>v.status),[200,200,200,409,409,409,409,409,409,409,409,409]);
  assert.equal(f.count('grow_campaign_creatives'),0);
  assert.equal(f.count('publish_sends'),0);
  assert.equal(f.count('mail_sent'),0);
});

test('individual ad acceptance uses the existing creative store, is once-only and cannot bypass its route', async () => {
  const f = fixture();
  const p = await f.propose({ kind:'ad_creative',text:'Late shipments, seen early',placement:'google_search_text',creative_field:'headline' });
  assert.equal(await decideRail(f.env,1,p.uid,'accept'),null);
  const r = await f.call('POST',`/${p.uid}/decide`,{ project:1,decision:'accept' });
  assert.equal(r.status,200);
  assert.equal((f.db.prepare('SELECT text FROM grow_campaign_creatives').get() as any).text,'Late shipments, seen early');
  assert.equal((await f.call('POST',`/${p.uid}/decide`,{ project:1,decision:'accept' })).status,409);
  assert.equal(f.count('publish_sends'),0);
  assert.equal(f.count('mail_sent'),0);
  const form = await f.propose({ kind:'ad_creative',target:'form',text:'Unsaved draft',placement:'meta_feed_4_5',creative_field:'body' });
  assert.equal((await f.call('POST',`/${form.uid}/decide`,{ project:1,decision:'accept' })).status,200);
  assert.equal(f.count('grow_campaign_creatives'),1);
});

test('unticked sources stay out, paused runs refuse, and malformed AI output writes no proposal', async () => {
  const f=fixture();
  const req={...REQUEST,sources:['distribution']};
  const q=await f.call('POST','/quote',req);
  assert.equal((await f.call('POST','/run',{...req,quote:q.body.estimate})).status,200);
  assert.doesNotMatch(f.prompts[0],/Shipment teams|Consented synthetic research|Missing shipment updates/);
  f.db.exec("INSERT INTO member_ai_pauses(user_id,paused_by,reason) VALUES (1,1,'Synthetic pause')");
  assert.equal((await f.call('POST','/quote',req)).status,403);
  assert.equal((await f.call('POST','/run',{...req,quote:q.body.estimate})).status,403);
  assert.equal(f.prompts.length,1);
  const bad=fixture('{"drafts":[{"index":0,"text":"PRIVATE provider","budget":100}]}');
  const bq=await bad.call('POST','/quote',REQUEST);
  const r=await bad.call('POST','/run',{...REQUEST,quote:bq.body.estimate});
  assert.equal(r.status,503);
  assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE provider/);
  assert.equal(bad.count('ai_rail_proposals'),0);
});

test('list and decisions scope the member and venture; form fields edit only selected values, never campaign data', async()=>{
  const f=fixture();
  const one=await f.propose({kind:'campaign_fields',target:'form',values:{name:'New plan',goal:'sales',segment_id:1}});
  const other=await proposeRail(f.env,{userId:1,page:DISTRIBUTION_PAGE,option:DISTRIBUTION_OPTION,record:'distribution:2',kind:'draft',payload:{version:1,project:2,campaign_uid:null,target:'form',kind:'post',text:'Other venture',sources:[]}});
  assert.deepEqual((await f.call('GET','/proposals?project=1')).body.proposals.map((p:any)=>p.uid),[one.uid]);
  assert.equal((await f.call('POST',`/${other.uid}/decide`,{project:1,decision:'accept'})).status,409);
  assert.equal((await f.call('POST',`/${one.uid}/decide`,{project:1,decision:'accept'},2)).status,409);
  assert.equal((await f.call('POST',`/${one.uid}/decide`,{project:1,decision:'edit',edited:{values:{segment_id:2}}})).status,404);
  const accepted=await f.call('POST',`/${one.uid}/decide`,{project:1,decision:'edit',edited:{values:{name:'Only the name'}}});
  assert.equal(accepted.status,200);
  assert.deepEqual(accepted.body.proposal.decided_payload.values,{name:'Only the name'});
  assert.equal((f.db.prepare('SELECT name FROM grow_campaigns WHERE id=1').get() as any).name,'Demo');
});

test('ending a campaign before the creative transaction keeps both proposal and creative unchanged', async()=>{
  const f=fixture();
  const p=await f.propose({kind:'ad_creative',text:'Never written',placement:'google_search_text',creative_field:'headline'});
  const original=f.env.DB.batch;
  f.env.DB.batch=async(statements:any[])=>{f.db.exec("UPDATE grow_campaigns SET status='ended' WHERE id=1");return original.call(f.env.DB,statements);};
  const r=await f.call('POST',`/${p.uid}/decide`,{project:1,decision:'accept'});
  assert.equal(r.status,409);
  assert.equal(f.count('grow_campaign_creatives'),0);
  assert.equal((f.db.prepare('SELECT status FROM ai_rail_proposals WHERE uid=?').get(p.uid) as any).status,'proposed');
  assert.equal(f.count('activity_logs'),0);
});

test('an archived campaign keeps its unaccepted text discardable without changing domain records',async()=>{
  const f=fixture();const p=await f.propose({kind:'post',text:'Old draft'});
  f.db.exec("UPDATE grow_campaigns SET archived_at=datetime('now') WHERE id=1");
  assert.equal((await f.call('POST',`/${p.uid}/decide`,{project:1,decision:'accept'})).status,404);
  assert.equal((await f.call('POST',`/${p.uid}/decide`,{project:1,decision:'discard'})).status,200);
  assert.equal(f.count('grow_campaign_creatives'),0);
});

test('structured creative targets quote and run intact; unknown target fields refuse before AI',async()=>{
  const f=fixture();
  const kind={kind:'ad_creative',placement:'google_search_text',field:'headline',channel_uid:'channel-one'};
  const request={...REQUEST,target:'form',kinds:[kind]};
  const q=await f.call('POST','/quote',request);
  assert.equal(q.status,200);
  const r=await f.call('POST','/run',{...request,quote:q.body.estimate});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(Object.fromEntries(['kind','placement','creative_field','channel_uid','target'].map(k=>[k,r.body.proposals[0].payload[k]])),{kind:'ad_creative',placement:'google_search_text',creative_field:'headline',channel_uid:'channel-one',target:'form'});
  assert.equal(f.count('grow_campaign_creatives'),0);
  assert.equal((await f.call('POST','/quote',{...request,kinds:[{...kind,budget:100}]})).status,400);
  assert.equal(f.prompts.length,1);
});
