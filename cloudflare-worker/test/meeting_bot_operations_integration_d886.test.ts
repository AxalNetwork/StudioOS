/** B10 against migration 531, real session/ledger gates and encrypted events. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { SignJWT } from 'jose';
import { fixture, seed, mig, FOUNDER, JWT_SECRET } from './_call_audio_fixture.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { readMeetingBotOperations } from '../src/services/meetingBotOperationsRead.ts';
import { ownBotTest, dispatchBotTest } from '../src/services/meetingBotOperationsTest.ts';
import platform from '../src/routes/admin_platform.ts';
import { sweepMeetingBotOperations, recordMeetingBotAlert } from '../src/services/meetingBotOperationsAlerts.ts';

const now = Date.parse('2026-10-23T12:00:00Z');
const uid = '00000000-0000-0000-0000-000000000001';
function world() {
  const w = fixture();
  w.db.exec(mig('525_ai_reservation_idempotency.sql'));
  w.db.exec(mig('531_meeting_bots.sql'));
  const session = seed(w,{kind:'recorder',chunks:0,ageDays:0});
  w.db.prepare("UPDATE interview_sessions SET status='draft',processing_stage=NULL WHERE id=?").run(session);
  const insert = (id=uid, status='done', created=now-120_000) => {
    w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,status,scheduled_at,
      started_at,ended_at,heartbeat_at,minutes,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at)
      VALUES(?,2,10,?,'zoom','SYNTHETIC_PRIVATE_CIPHER',?,?,?,?,?,2,30,2232,2790,?)`)
      .run(id,session,status,created,created,status==='done'?now-30_000:null,now-10_000,created);
  };
  return {...w,session,insert};
}
async function settled(w:any,key:string,cost:number,user=FOUNDER) {
  const hold = await reserveAiBudget(w.env,user,cost,new Date(now),{idempotencyKey:key});
  assert.equal(hold.ok,true);
  if (!hold.ok) throw new Error('fixture_hold');
  await settleAiReservation(w.env,hold.reservation,cost);
  return hold.reservation.uid;
}
async function aggregation(read=readMeetingBotOperations) {
  const w=world();
  try {
    w.insert();
    await settled(w,`meeting-bot:${uid}:0`,5000);
    await settled(w,`meeting-bot:${uid}:1`,580);
    await settled(w,`meeting-bot:${uid}:wrong-user`,99000,3);
    await settled(w,`meeting-bot:${uid}extra:0`,99000);
    const stt=await settled(w,'synthetic-stt',700);
    w.db.prepare(`INSERT INTO interview_session_receipts(session_id,kind,model,audio_minutes,cost_microusd,outcome,created_at)
      VALUES(?,'final','synthetic',1,560,'ok',?)`).run(w.session,'2026-10-23 11:59:00');
    // Failed attempts must not replace the successful audio duration.
    w.db.prepare(`INSERT INTO interview_session_receipts(session_id,kind,model,audio_minutes,outcome,created_at)
      VALUES(?,'final','synthetic',99,'failed',?)`).run(w.session,'2026-10-23 11:59:30');
    w.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,charged_microusd,reservation_uid,record_ref,created_at)
      VALUES(2,'transcribe','synthetic',700,?,?,?)`).run(stt,`session:${w.session}`,'2026-10-23 11:59:00');
    w.db.prepare(`INSERT INTO ai_usage_logs(user_id,task,model,charged_microusd,record_ref,created_at)
      VALUES(3,'transcribe','synthetic',99999,?,?)`).run(`session:${w.session}`,'2026-10-23 11:59:00');
    const result=await read(w.env,now);
    assert.equal(result.state,'ok'); if(result.state!=='ok') throw new Error('fixture_read');
    assert.equal(result.today.runs,1);
    assert.equal(result.today.bot_minutes,2); // B1's rounded billed runtime, not 1.5 elapsed or 1 audio minute.
    assert.equal(result.today.recorded_minutes,1);
    assert.equal(result.today.financials.charged_microusd,5580);
    assert.equal(result.today.audio_charged_microusd,700);
    assert.equal(result.today.financials.runtime_seconds,90);
    assert.equal(result.today.financials.provider_cost_microusd,null);
    assert.equal(result.today.financials.realised_markup_bps,null);
    assert.equal(JSON.stringify(result).includes(uid),false);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'),false);
    await reserveAiBudget(w.env,FOUNDER,100,new Date(now),{idempotencyKey:`meeting-bot:${uid}:2`});
    const pending=await read(w.env,now);
    assert.equal(pending.state,'ok');
    if(pending.state==='ok') assert.equal(pending.today.financials.charged_microusd,null);
    w.db.prepare("UPDATE ai_budget_reservations SET status='pending',settlement_uid=NULL,actual_included_microusd=NULL,actual_topup_microusd=NULL WHERE uid=?").run(stt);
    const unsettled=await read(w.env,now);
    if(unsettled.state==='ok') assert.equal(unsettled.today.audio_charged_microusd,null);
    w.insert('00000000-0000-0000-0000-000000000002');
    const ambiguous=await read(w.env,now);
    assert.equal(ambiguous.state,'ok');
    if(ambiguous.state==='ok') assert.equal(ambiguous.today.recorded_minutes,null);
  } finally {w.db.close();}
}
test('D886 canonical billing separates rounded bot minutes, audio, settled charges and unmeasured cost',()=>aggregation());

async function pages(read=readMeetingBotOperations) {
  const w=world();
  try {
    for(let i=1;i<=501;i++) w.insert(`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);
    const result=await read(w.env,now);
    assert.equal(result.state,'ok'); if(result.state==='ok') assert.equal(result.today.runs,501);
    const DB={prepare(sql:string){if(sql.includes('FROM meeting_bots b')) return {bind(cursor:string,...args:any[]){
      if(cursor!=='') throw new Error('SYNTHETIC_PRIVATE_PAGE_FAILURE');
      return w.env.DB.prepare(sql).bind(cursor,...args);
    }};return w.env.DB.prepare(sql);}};
    assert.equal((await read({...w.env,DB},now)).state,'unreadable');
  } finally {w.db.close();}
}
test('D886 canonical reader exhausts pages and fails the entire snapshot when a later page fails',()=>pages());

async function timings(own=ownBotTest) {
  const w=world();
  try {
    w.insert();
    w.db.prepare("UPDATE meeting_bots SET failure_code='SYNTHETIC_PRIVATE_FAILURE' WHERE uid=?").run(uid);
    for(const [seq,kind,payload,received] of [
      [1,'status',{status:'recording',extra:'SYNTHETIC_PRIVATE_EVENT'},now-100_000],
      [2,'roster',{participants:[{name:'SYNTHETIC_PRIVATE_PERSON'}]},now-90_000],
      [3,'status',{status:'processing'},now-30_000],
    ] as const) {
      const cipher=await encryptColumn(w.env,'meeting_bot_events','payload_enc',`${uid}:${seq}`,JSON.stringify(payload));
      w.db.prepare('INSERT INTO meeting_bot_events VALUES(?,?,?,?,?)').run(uid,seq,kind,cipher,received);
    }
    assert.equal(await own(w.env,3,uid,now),null);
    const result=await own(w.env,FOUNDER,uid,now);
    assert.ok(result);
    assert.deepEqual(result!.stages.map(s=>[s.stage,s.elapsed_ms,s.duration_ms]),[
      ['queued',0,0],['joining',0,20_000],['recording',20_000,70_000],['processing',90_000,20_000],['done',110_000,null],
    ]);
    assert.equal(result!.failure_code,'unknown');
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'),false);
    // Unreadable roster is irrelevant; unreadable status must fail closed.
    w.db.prepare("UPDATE meeting_bot_events SET payload_enc='broken' WHERE kind='roster'").run();
    assert.ok(await own(w.env,FOUNDER,uid,now));
    w.db.prepare("UPDATE meeting_bot_events SET payload_enc='broken' WHERE kind='status'").run();
    await assert.rejects(()=>own(w.env,FOUNDER,uid,now));
  } finally {w.db.close();}
}
test('D886 live stage timings read only owned status events and use the terminal transition clock',()=>timings());

async function dispatch(start=dispatchBotTest) {
  const w=world();
  try {
    const actor={...w.db.prepare('SELECT * FROM users WHERE id=2').get(),id:FOUNDER} as any;
    let init=0;
    Object.assign(w.env,{MEETING_BOT:'on',MEETING_BOT_SECRET:'synthetic-'.repeat(5),MEETING_BOT_COST_MICROUSD_PER_MINUTE:'2232',
      MEETING_BOT_RUNTIME:{},MEETING_BOT_RUN:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>{init++;return new Response('{}');}})}});
    await assert.rejects(()=>start(w.env,{...actor,id:3},w.session,'https://meet.google.com/abc-defg-hij'),{code:'session_not_found'});
    w.db.prepare("UPDATE interview_sessions SET consent_status='not_recorded' WHERE id=?").run(w.session);
    assert.equal((await (await start(w.env,actor,w.session,'https://meet.google.com/abc-defg-hij')).json()).code,'consent_required');
    assert.equal(init,0);
    w.db.prepare("UPDATE interview_sessions SET consent_status='given' WHERE id=?").run(w.session);
    w.env.MEETING_BOT_COST_MICROUSD_PER_MINUTE='1000000000';
    assert.equal((await start(w.env,actor,w.session,'https://meet.google.com/abc-defg-hij')).status,402);
    assert.equal(init,0);
    w.env.MEETING_BOT_COST_MICROUSD_PER_MINUTE='2232';
    const response=await start(w.env,actor,w.session,'https://meet.google.com/abc-defg-hij');
    assert.equal(response.status,202);assert.equal(init,1);
    assert.equal((await response.json()).bot.status,'queued');
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM meeting_bots').get()!.n,1);
  } finally {w.db.close();}
}
test('D886 live dispatch uses B1 ownership, consent and full-plan budget gates',()=>dispatch());

test('D886 mounted HQ action requires a fresh TOTP session and audits successful own-session dispatch',async()=>{
  const w=world();
  try {
    const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
    w.db.exec(tableFromBaseline(baseline,'user_sessions'));
    w.db.prepare("UPDATE users SET role='admin' WHERE id=2").run();
    w.db.prepare('INSERT INTO super_admins(user_id) VALUES(2)').run();
    w.db.prepare("INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(2,'synthetic-totp','totp',datetime('now'))").run();
    const token=await new SignJWT({user_id:2,role:'admin',jti:'synthetic-totp'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const send=()=>platform.fetch(new Request('https://example.test/meeting-bots/test',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({session_id:w.session,meeting_url:'https://meet.google.com/abc-defg-hij'})}),w.env);
    Object.assign(w.env,{MEETING_BOT:'on',MEETING_BOT_SECRET:'synthetic-'.repeat(5),MEETING_BOT_COST_MICROUSD_PER_MINUTE:'2232',MEETING_BOT_RUNTIME:{},
      MEETING_BOT_RUN:{idFromName:(s:string)=>s,get:()=>({fetch:async()=>new Response('{}')})}});
    w.db.prepare("UPDATE user_sessions SET factor='google' WHERE jti='synthetic-totp'").run();
    assert.notEqual((await send()).status,200);
    w.db.prepare("UPDATE user_sessions SET factor='totp',created_at=datetime('now','-1 day') WHERE jti='synthetic-totp'").run();
    assert.notEqual((await send()).status,200);
    w.db.prepare("UPDATE user_sessions SET created_at=datetime('now') WHERE jti='synthetic-totp'").run();
    const response=await send();assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.test.status,'queued');
    const actions=w.db.prepare("SELECT * FROM activity_logs WHERE action='meeting_bot_test_dispatched'").all();
    assert.equal(actions.length,1);assert.equal(JSON.stringify(actions).includes('meet.google.com'),false);
  } finally {w.db.close();}
});

async function sweep(run=sweepMeetingBotOperations) {
  const w=world();
  try {
    const baseline=readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8');
    for(const table of ['notifications','notifications_inbox']) w.db.exec(tableFromBaseline(baseline,table));
    const at=baseline.indexOf('CREATE UNIQUE INDEX uq_notifications_dedupe');
    w.db.exec(baseline.slice(at,baseline.indexOf(';',at)+1));
    w.db.exec('ALTER TABLE users ADD COLUMN notification_prefs TEXT');
    w.insert(uid,'recording');
    w.db.prepare('UPDATE meeting_bots SET heartbeat_at=? WHERE uid=?').run(now-120_001,uid);
    for(let i=2;i<=11;i++) {
      const id=`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
      w.insert(id);
      if(i<6) w.db.prepare("UPDATE meeting_bots SET status='failed',failure_code='runtime_failed' WHERE uid=?").run(id);
    }
    await run(w.env,now);await run(w.env,now);
    const rows=w.db.prepare('SELECT type,payload FROM notifications_inbox WHERE user_id=1').all();
    assert.equal(rows.length,2);
    assert.deepEqual(rows.map(r=>JSON.parse(String(r.payload)).kind).sort(),['failure_rate','missed_heartbeat']);
    assert.equal(JSON.stringify(rows).includes(uid),false);
    await run(w.env,now+13*3600_000);
    const kinds=w.db.prepare('SELECT payload FROM notifications_inbox WHERE user_id=1').all().map(r=>JSON.parse(String(r.payload)).kind);
    assert.equal(kinds.filter(k=>k==='missed_heartbeat').length,1);
    assert.equal(kinds.filter(k=>k==='failure_rate').length,2);
    // One recipient's transient write failure must not prevent another's inbox.
    w.db.prepare("UPDATE users SET role='admin' WHERE id=2").run();
    w.db.prepare('INSERT INTO super_admins(user_id) VALUES(2)').run();
    const original=w.env.DB.batch.bind(w.env.DB);let first=true;
    const DB={...w.env.DB,batch:async (statements:any[])=>{if(first){first=false;throw new Error('SYNTHETIC_PRIVATE_WRITE');}return original(statements);}};
    await assert.rejects(()=>recordMeetingBotAlert({...w.env,DB},{kind:'missed_heartbeat',platform:'zoom',runs:1},'synthetic-isolation'));
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM notifications_inbox WHERE user_id=2').get()!.n,1);
  } finally {w.db.close();}
}
test('D886 scheduled alerts use canonical cohorts, durable episodes and isolated recipient delivery',()=>sweep());

let mutation=0;
async function changed(file:string,before:string,after:string) {
  const path=new URL('../src/services/'+file,import.meta.url),source=readFileSync(path,'utf8');
  assert.ok(source.includes(before));
  const js=stripTypeScriptTypes(source.replace(before,()=>after),{mode:'strip'}).replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_m,p,s,q)=>p+new URL(s+'.ts',path).href+q);
  return import('data:text/javascript;base64,'+Buffer.from(js+'\n// mutation '+ ++mutation).toString('base64'));
}
for(const [name,file,before,after,scenario,fn] of [
  ['bot charge ownership','meetingBotOperationsRead.ts','r.user_id=b.user_id AND','',aggregation,'readMeetingBotOperations'],
  ['pending bot holds','meetingBotOperationsRead.ts',"SUM(CASE WHEN r.status IN ('settled','refunded') AND r.actual_included_microusd IS NOT NULL AND r.actual_topup_microusd IS NOT NULL THEN 1 ELSE 0 END)=COUNT(r.uid)","1=1",aggregation,'readMeetingBotOperations'],
  ['audio attribution','meetingBotOperationsRead.ts',"a.outcome='ok'","1=1",aggregation,'readMeetingBotOperations'],
  ['ambiguous session','meetingBotOperationsRead.ts','sc.runs=1','sc.runs>=1',aggregation,'readMeetingBotOperations'],
  ['wrong STT user','meetingBotOperationsRead.ts',"l.user_id=b.user_id AND l.task='transcribe'","l.task='transcribe'",aggregation,'readMeetingBotOperations'],
  ['rounded bot minutes','meetingBotOperationsRead.ts','b.minutes AS billed_bot_minutes','(b.ended_at-b.started_at)/60000.0 AS billed_bot_minutes',aggregation,'readMeetingBotOperations'],
  ['truncated snapshot','meetingBotOperationsRead.ts','if (result.results.length < PAGE) break;','break;',pages,'readMeetingBotOperations'],
  ['test owner','meetingBotOperationsTest.ts','WHERE uid=? AND user_id=?','WHERE uid=? AND ? IS NOT NULL',timings,'ownBotTest'],
  ['status content scope','meetingBotOperationsTest.ts',"kind='status'","kind IN ('status','roster')",timings,'ownBotTest'],
  ['processing end as terminal','meetingBotOperationsTest.ts','times.set(run.status,run.heartbeat_at)','times.set(run.status,run.ended_at!)',timings,'ownBotTest'],
  ['repeat heartbeat alerts','meetingBotOperationsAlerts.ts','`meeting-bot:heartbeat:${row.uid}`','`meeting-bot:heartbeat:${row.uid}:${day}`',sweep,'sweepMeetingBotOperations'],
] as const) test('D886 integration mutation: '+name,async()=>{
  await scenario();const mutant=await changed(file,before,after);
  await assert.rejects(()=>scenario(mutant[fn]));await scenario();
});
