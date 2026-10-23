/** D886 B1. All meeting/participant values below are synthetic and never logged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Hono } from 'hono';
import { fixture, seed, call, mig, FOUNDER, OTHER } from './_call_audio_fixture.ts';
import { MeetingBotRun as UnpublishedMeetingBotRun, botHmac, BOT_CALLBACK_WINDOW_MS } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { BOT_COMMISSION_MULTIPLIER, botRate, botLimit, botPlatform, botRow, botSession } from '../src/services/meetingBots.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';

const syntheticLink = (p='zoom') => p==='zoom' ? ['https:/','unit.zoom.us','j',String(111111111)].join('/')
  : p==='google_meet' ? ['https:/','meet.google.com','abc-defg-hij'].join('/')
    : ['https:/','teams.microsoft.com','meet','synthetic'].join('/');
const hmacSecret = 'd886-'+'x'.repeat(40);
// Positive contract tests use the real shared wording with only its approval date
// changed in memory. Production remains unpublished; no env bypass is introduced.
let variantSerial = 0;
async function supervisorVariant(before = '', after = '', published = true) {
  const file = new URL('../src/durable-objects/meeting-bot-run.ts', import.meta.url);
  let source = readFileSync(file, 'utf8');
  if (before) { assert.ok(source.includes(before)); source = source.replace(before, () => after); }
  const notice = readFileSync(new URL('../../meeting-bot/notice.mjs', import.meta.url), 'utf8')
    .replace('MEETING_BOT_NOTICE_APPROVED_AT = null', published ? "MEETING_BOT_NOTICE_APPROVED_AT = '2026-10-23'" : 'MEETING_BOT_NOTICE_APPROVED_AT = null');
  const noticeUrl = 'data:text/javascript;base64,' + Buffer.from(notice).toString('base64');
  let changed = stripTypeScriptTypes(source, {mode:'strip'});
  changed = changed.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, a, spec, b) =>
    a + (spec.endsWith('notice.mjs') ? noticeUrl : new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec+'.ts', file).href) + b);
  return import('data:text/javascript;base64,' + Buffer.from(changed+'\n// test variant '+ ++variantSerial).toString('base64'));
}
const {MeetingBotRun} = await supervisorVariant();
function world(monthMicro=500_000_000, Supervisor=MeetingBotRun) {
  const w=fixture({monthMicro});
  w.db.exec(mig('525_ai_reservation_idempotency.sql'));
  w.db.exec(mig('531_meeting_bots.sql'));
  const session=seed(w,{kind:'recorder',chunks:0,ageDays:0});
  w.db.prepare("UPDATE interview_sessions SET status='draft', processing_stage=NULL, consent_method='written', consent_at=datetime('now') WHERE id=?").run(session);
  w.db.prepare('DELETE FROM interview_transcript_segments WHERE session_id=?').run(session);
  const starts:any[]=[], stops:string[]=[], objects=new Map<string,any>();
  Object.assign(w.env,{AI_BILLING:'charged',MEETING_BOT:'on',MEETING_BOT_SECRET:hmacSecret,MEETING_BOT_COST_MICROUSD_PER_MINUTE:'10000',
    MEETING_BOT_RUNTIME:{ async start(run:any){starts.push(run);}, async stop(run:any){stops.push(run.uid);} }});
  w.env.MEETING_BOT_RUN={idFromName:(s:string)=>s,get(uid:string){
    if (!objects.has(uid)) {
      const data=new Map<string,any>(); let alarm:number|null=null; let tail=Promise.resolve();
      const state:any={storage:{async get(k:string){return structuredClone(data.get(k));},async put(k:string,v:any){data.set(k,structuredClone(v));},async list({prefix}:any){return new Map([...data].filter(([k])=>k.startsWith(prefix)));},async delete(keys:any){for(const k of [keys].flat())data.delete(k);},async getAlarm(){return alarm;},async setAlarm(t:number){alarm=t;},async deleteAlarm(){alarm=null;}},
        blockConcurrencyWhile(fn:any){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
      const object=new Supervisor(state,w.env);objects.set(uid,{object,state,data,get alarm(){return alarm;}});
    }
    return {fetch:(r:Request)=>objects.get(uid).object.fetch(r)};
  }};
  return {...w,session,starts,stops,supervisors:objects};
}
const post = (w:any,args:any={meeting_url:syntheticLink()})=>call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot`,args);
async function event(w:any,uid:string,data:any,{timestamp=Date.now(),signature}:any={}) {
  // B1 follow-up completion declaration, as the aligned runtime sends it.
  if (data.type==='status' && ['processing','done'].includes(data.status) && !('chunks' in data)) {
    data={...data,chunks:w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id=?').get(w.session).n,chunks_failed:0};
  }
  const path=`/api/meeting-bots/${uid}/events`,raw=JSON.stringify(data),ts=String(timestamp);
  const sig=signature??await botHmac(hmacSecret,`v1:${ts}:POST:${path}:${raw}`);
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const response=await app.fetch(new Request('https://unit.invalid'+path,{method:'POST',headers:{'x-meeting-bot-timestamp':ts,'x-meeting-bot-signature':sig,'content-type':'application/json'},body:raw}),w.env);
  return {status:response.status,body:await response.json() as any};
}
function wav(seconds=1) {
  const b=new ArrayBuffer(44+32000*seconds),v=new DataView(b),u=new Uint8Array(b);
  for (const [at,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const) for(let i=0;i<s.length;i++)u[at+i]=s.charCodeAt(i);
  v.setUint32(4,b.byteLength-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,b.byteLength-44,true);return b;
}
async function upload(w:any,path:string,bytes=wav()) {
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const r=await app.fetch(new Request('https://unit.invalid'+path,{method:'PUT',body:bytes,headers:{'content-length':String(bytes.byteLength)}}),w.env);
  return {status:r.status,body:await r.json() as any};
}

test('D886 dispatch: tenant/consent/link/config gates, encrypted link, one active bot and exact 25% rate',async()=>{
  const w=world();
  assert.equal(BOT_COMMISSION_MULTIPLIER,1.25);assert.equal(botRate(10000),12500);assert.equal(botRate(1),2);
  assert.equal(botLimit({role:'founder',subscription_tier:'free'} as any),30);
  assert.equal(botLimit({role:'founder',subscription_tier:'growth',subscription_status:'active'} as any),120);
  for(const p of ['zoom','google_meet','teams'])assert.equal(botPlatform(syntheticLink(p)).platform,p);
  w.db.prepare("UPDATE users SET role='admin',founder_id=100 WHERE id=?").run(OTHER);
  await assert.rejects(()=>botSession(w.env,{user_id:OTHER,session_id:w.session,project_id:10}), {code:'session_not_found'});
  assert.equal((await call(w.env,OTHER,'POST',`/sessions/${w.session}/bot`,{meeting_url:syntheticLink()})).status,404);
  w.db.prepare("UPDATE interview_sessions SET consent_status='not_recorded' WHERE id=?").run(w.session);
  assert.equal((await post(w)).body.code,'consent_required');
  w.db.prepare("UPDATE interview_sessions SET consent_status='given' WHERE id=?").run(w.session);
  for(const value of ['http://example.invalid','https://unit.zoom.us.attacker.invalid/j/111111111','https://meet.google.com@attacker.invalid/abc-defg-hij'])assert.equal((await post(w,{meeting_url:value})).body.code,'unsupported_link');
  w.env.MEETING_BOT='off';assert.equal((await post(w)).body.code,'bot_unavailable');w.env.MEETING_BOT='on';
  w.env.MEETING_BOT_COST_MICROUSD_PER_MINUTE='';assert.equal((await post(w)).body.code,'bot_price_unavailable');w.env.MEETING_BOT_COST_MICROUSD_PER_MINUTE='10000';
  const r=await post(w);assert.equal(r.status,202);const uid=r.body.bot.uid;
  assert.equal('meeting_url_enc' in r.body.bot,false);assert.equal('reservation_uid' in r.body.bot,false);
  assert.equal(r.body.bot.status,'joining');assert.equal(r.body.bot.limit_minutes,30);assert.equal(r.body.bot.participant_count,null);
  assert.equal(JSON.stringify(r.body).includes(syntheticLink()),false);assert.equal(w.starts.length,1);
  const row=await botRow(w.env,uid);assert.ok(row!.meeting_url_enc.startsWith('v1.'));assert.equal(await decryptColumn(w.env,'meeting_bots','meeting_url_enc',uid,row!.meeting_url_enc),syntheticLink());
  assert.equal((await post(w)).body.code,'bot_already_running');
  assert.equal((await call(w.env,OTHER,'GET',`/sessions/${w.session}/bot`)).status,404);
  assert.equal((await call(w.env,OTHER,'POST',`/sessions/${w.session}/bot/stop`,{})).status,404);
});

test('D886 budget refusal has no run, runtime call or paid hold',async()=>{
  const w=world();w.env.MEETING_BOT_COST_MICROUSD_PER_MINUTE='1000000000';
  const r=await post(w);assert.equal(r.status,402);assert.equal(w.starts.length,0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n,0);
});

test('D886 scheduled alarm starts once at its persisted time, holds only a running block, and snapshots paid plan limit',async()=>{
  const w=world();w.db.prepare("UPDATE users SET subscription_tier='growth',subscription_status='active' WHERE id=?").run(FOUNDER);
  const time=Date.now()+3600_000,r=await post(w,{meeting_url:syntheticLink('teams'),scheduled_at:new Date(time).toISOString()});
  assert.equal(r.status,202);assert.equal(r.body.bot.status,'queued');assert.equal(r.body.bot.limit_minutes,120);assert.equal(w.starts.length,0);
  const row=await botRow(w.env,r.body.bot.uid);
  assert.equal(row!.reservation_uid,null);assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,0);
  const saved=Date.now;Date.now=()=>time;
  try {await w.supervisors.get(row!.uid).object.alarm();await w.supervisors.get(row!.uid).object.alarm();}finally{Date.now=saved;}
  assert.equal(w.starts.length,1);assert.equal((await botRow(w.env,row!.uid))!.status,'joining');
  const hold=w.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').get((await botRow(w.env,row!.uid))!.reservation_uid);
  assert.equal(hold.included_microusd+hold.topup_microusd,12500*2);
});

test('D886 signed events reject forged/stale/path-swapped callbacks and illegal transitions; roster and speaker are encrypted data',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  assert.equal((await event(w,uid,{seq:1,type:'status',status:'recording'},{signature:'0'.repeat(64)})).status,401);
  assert.equal((await event(w,uid,{seq:1,type:'heartbeat'},{timestamp:Date.now()-BOT_CALLBACK_WINDOW_MS-1})).status,401);
  const ts=Date.now(),raw=JSON.stringify({seq:1,type:'heartbeat'});
  const signed=await botHmac(hmacSecret,`v1:${ts}:POST:/api/meeting-bots/${uid}/events:${raw}`);
  assert.equal((await event(w,crypto.randomUUID(),{seq:1,type:'heartbeat'},{timestamp:ts,signature:signed})).status,401);
  assert.equal((await event(w,uid,{seq:1,type:'status',status:'done'})).body.code,'invalid_bot_transition');
  assert.equal((await event(w,uid,{seq:1,type:'status',status:'recording'})).status,200);
  const roster={seq:2,type:'roster',participants:[{id:'fixture-a',name:'SYNTHETIC-PARTICIPANT',joined_ms:0,left_ms:null}]};
  assert.equal((await event(w,uid,roster)).body.bot.participant_count,1);
  assert.equal((await event(w,uid,roster)).body.duplicate,true);
  assert.equal((await event(w,uid,{seq:3,type:'speaker',participant_id:'fixture-a',at_ms:1})).status,200);
  const rows=w.db.prepare('SELECT * FROM meeting_bot_events').all();
  assert.ok(rows.every((x:any)=>x.payload_enc.startsWith('v1.')));assert.equal(JSON.stringify(rows).includes('SYNTHETIC-PARTICIPANT'),false);
  const status=await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);assert.equal(JSON.stringify(status).includes('SYNTHETIC-PARTICIPANT'),false);
  assert.equal(JSON.stringify(w.db.prepare('SELECT details FROM activity_logs').all()).includes('SYNTHETIC-PARTICIPANT'),false);
  assert.equal((await event(w,uid,{seq:0,type:'heartbeat'})).body.code,'stale_bot_event');
});

test('D886 one-time chunk tickets enforce WAV format, binding, consent, size and replay; existing chunk store is reused',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  assert.equal((await event(w,uid,{seq:1,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0})).status,400);
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});assert.equal(ticket.status,200);
  const retry=await event(w,uid,{seq:2,type:'chunk',chunk_seq:999,size_bytes:99,start_ms:0});
  assert.equal(retry.status,200);assert.match(retry.body.upload_path,/chunks\/0/);
  ticket.body.upload_path=retry.body.upload_path;
  const manifest=w.db.prepare("SELECT * FROM meeting_bot_events WHERE run_uid=? AND kind='chunk'").get(uid);
  const decoded=JSON.parse((await decryptColumn(w.env,'meeting_bot_events','payload_enc',uid+':2',manifest.payload_enc))!);
  assert.equal(decoded.chunk_seq,0);assert.equal(decoded.size_bytes,wav().byteLength);
  assert.equal((await upload(w,ticket.body.upload_path.replace('/chunks/0','/chunks/1'))).status,401);
  assert.equal((await upload(w,ticket.body.upload_path,new ArrayBuffer(wav().byteLength))).status,415);
  assert.equal((await upload(w,ticket.body.upload_path)).status,200);
  assert.equal((await upload(w,ticket.body.upload_path)).status,401);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id=?').get(w.session).n,1);
  assert.equal(w.objects.size,1);
  const next=await event(w,uid,{seq:3,type:'chunk',chunk_seq:1,size_bytes:wav().byteLength,start_ms:1000});
  w.db.prepare("UPDATE interview_sessions SET consent_status='declined' WHERE id=?").run(w.session);
  assert.equal((await upload(w,next.body.upload_path)).status,409);assert.equal(w.objects.size,1);
});

test('D886 time limit stops the runtime, terminal replay settles once and unused hold is returned',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid,run=(await botRow(w.env,uid))!;
  const saved=Date.now;Date.now=()=>run.started_at!+30*60_000;
  try {await w.supervisors.get(uid).object.alarm();await w.supervisors.get(uid).object.alarm();}finally{Date.now=saved;}
  const final=(await botRow(w.env,uid))!;assert.equal(final.status,'stopped');assert.equal(final.failure_code,'time_limit');assert.equal(final.minutes,2);
  assert.equal(w.stops.length,1);assert.equal(w.supervisors.get(uid).alarm,null);
  const hold=w.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').get(run.reservation_uid);assert.equal(hold.status,'settled');
  const token=hold.settlement_uid;await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{});
  assert.equal(w.db.prepare('SELECT settlement_uid FROM ai_budget_reservations WHERE uid=?').get(run.reservation_uid).settlement_uid,token);
  const short=world(),s=await post(short),sr=(await botRow(short.env,s.body.bot.uid))!;
  await call(short.env,FOUNDER,'POST',`/sessions/${short.session}/bot/stop`,{});
  assert.ok((await botRow(short.env,sr.uid))!.minutes!<=1);
  const sh=short.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').get(sr.reservation_uid);
  assert.ok(sh.actual_included_microusd+sh.actual_topup_microusd<=12500);
});

test('D886 revocation, missing heartbeat, deleted session and runtime start failure stop safely',async()=>{
  for(const mode of ['consent','membership','heartbeat','deleted','runtime']){
    const w=world();if(mode==='runtime')w.env.MEETING_BOT_RUNTIME.start=async()=>{throw new Error('SYNTHETIC-RUNTIME-DETAIL');};
    const r=await post(w),uid=r.body.bot.uid;assert.ok(uid);
    if(mode==='consent')w.db.prepare("UPDATE interview_sessions SET consent_status='declined' WHERE id=?").run(w.session);
    if(mode==='membership')w.db.prepare('UPDATE projects SET founder_id=999 WHERE id=10').run();
    if(mode==='deleted')w.db.prepare('DELETE FROM interview_sessions WHERE id=?').run(w.session);
    const saved=Date.now;if(mode==='heartbeat')Date.now=()=>saved()+180_000;
    try{await w.supervisors.get(uid).object.alarm();}finally{Date.now=saved;}
    assert.ok(w.stops.length>=1);assert.equal(JSON.stringify(await botRow(w.env,uid)).includes('SYNTHETIC-RUNTIME-DETAIL'),false);
    if(mode!=='deleted')assert.ok(['stopped','failed'].includes((await botRow(w.env,uid))!.status));
    if(mode==='heartbeat')assert.equal((await botRow(w.env,uid))!.failure_code,'heartbeat_timeout');
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status='pending'").get().n,0);
  }
});


test('D886 withdrawal and deletion routes stop a live bot, and a late upload cannot recreate deleted audio',async()=>{
  for(const mode of ['withdraw','audio','session']){
    const w=world(),r=await post(w),uid=r.body.bot.uid;
    await event(w,uid,{seq:1,type:'status',status:'recording'});
    const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
    const route=mode==='withdraw'?await call(w.env,FOUNDER,'PATCH',`/sessions/${w.session}/consent`,{status:'declined'})
      :await call(w.env,FOUNDER,'DELETE',`/sessions/${w.session}${mode==='audio'?'/audio':''}`);
    assert.equal(route.status,200);assert.equal(w.stops.length,1);
    if(mode==='session') {assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n,0);assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bot_events').get().n,0);}
    assert.ok((await upload(w,ticket.body.upload_path)).status>=400);assert.equal(w.objects.size,0);
  }
});

test('D886 stop errors retry on alarm; crashes/recreation do not restart a live run or charge twice',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid,supervisor=w.supervisors.get(uid);
  let attempts=0;w.env.MEETING_BOT_RUNTIME.stop=async()=>{attempts++;if(attempts===1)throw new Error('synthetic stop failure');};
  const stopped=await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{});assert.equal(stopped.status,200);
  assert.ok(supervisor.alarm!==null);assert.equal((await botRow(w.env,uid))!.status,'stopped');
  const held=w.db.prepare('SELECT settlement_uid FROM ai_budget_reservations WHERE uid=?').get((await botRow(w.env,uid))!.reservation_uid).settlement_uid;
  const recreated=new MeetingBotRun(supervisor.state,w.env);
  await recreated.alarm();assert.equal(attempts,2);assert.equal(w.starts.length,1);assert.equal(supervisor.alarm,null);
  assert.equal((await botRow(w.env,uid))!.meeting_url_enc,'');
  assert.equal(w.db.prepare('SELECT settlement_uid FROM ai_budget_reservations WHERE uid=?').get((await botRow(w.env,uid))!.reservation_uid).settlement_uid,held);
});

test('D886 upload in flight is cleaned up on withdrawal, and total audio and deadline stay bounded',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
  const put=w.env.FILES.put;
  w.env.FILES.put=async(...args:any[])=>{await put(...args);w.db.prepare("UPDATE interview_sessions SET consent_status='declined' WHERE id=?").run(w.session);};
  assert.equal((await upload(w,ticket.body.upload_path)).status,409);assert.equal(w.objects.size,0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_session_chunks WHERE session_id=?').get(w.session).n,0);
  const other=world(),rr=await post(other),u=rr.body.bot.uid;
  await event(other,u,{seq:1,type:'status',status:'recording'});
  const over=await event(other,u,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:30*60_000});
  assert.equal((await upload(other,over.body.upload_path)).status,413);
  const good=await event(other,u,{seq:3,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
  const run=(await botRow(other.env,u))!,saved=Date.now;Date.now=()=>run.started_at!+30*60_000;
  try {assert.equal((await upload(other,good.body.upload_path)).status,401);} finally{Date.now=saved;}
});


test('D886 scheduled events cannot bypass alarm, expired authority stops a run, and processing completes only after recording',async()=>{
  const w=world(),scheduled=Date.now()+3600_000,r=await post(w,{meeting_url:syntheticLink(),scheduled_at:new Date(scheduled).toISOString()}),uid=r.body.bot.uid;
  assert.equal((await event(w,uid,{seq:1,type:'status',status:'joining'})).body.code,'bot_not_started');assert.equal(w.starts.length,0);
  assert.equal((await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{})).body.bot.status,'stopped');
  assert.equal((await botRow(w.env,uid))!.minutes,0);assert.equal(w.stops.length,0);
  const v=world(),rr=await post(v),u=rr.body.bot.uid;
  v.db.prepare('UPDATE users SET jwt_min_iat=? WHERE id=?').run(Math.ceil(Date.now()/1000)+1,FOUNDER);
  await v.supervisors.get(u).object.alarm();assert.equal((await botRow(v.env,u))!.status,'stopped');
  const p=world(),pp=await post(p),id=pp.body.bot.uid;
  await event(p,id,{seq:1,type:'status',status:'recording'});
  assert.equal((await event(p,id,{seq:2,type:'status',status:'processing'})).status,200);
  assert.equal((await event(p,id,{seq:3,type:'status',status:'done'})).body.bot.status,'done');
  assert.equal((await event(p,id,{seq:3,type:'status',status:'done'})).body.duplicate,true);
  assert.equal(p.stops.length,1);
});


test('D886 racing dispatch holds one budget only; total bytes, audio retention and completed status remain scoped',async()=>{
  const w=world(),results=await Promise.all([post(w),post(w)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);assert.equal(w.starts.length,1);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status='pending'").get().n,1);
  const uid=results.find(r=>r.status===202)!.body.bot.uid;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
  w.db.prepare("INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes) VALUES(?,99,'synthetic','audio/wav',?)").run(w.session,30*60*32000+44);
  assert.equal((await upload(w,ticket.body.upload_path)).status,413);
  w.db.prepare('DELETE FROM interview_session_chunks WHERE session_id=? AND seq=99').run(w.session);
  assert.equal((await upload(w,ticket.body.upload_path)).status,200);
  await event(w,uid,{seq:3,type:'status',status:'processing'});
  await event(w,uid,{seq:4,type:'status',status:'done'});
  w.db.prepare("UPDATE interview_session_chunks SET created_at=datetime('now','-31 days') WHERE session_id=?").run(w.session);
  const {purgeExpiredCallAudio}=await import('../src/services/callAudioRetention.ts');
  assert.equal((await purgeExpiredCallAudio(w.env)).sessions,1);assert.equal(w.objects.size,0);
});

test('D886 dispatch checks bot plus transcription without a full hold; billing renews two-minute blocks and stops on tokens',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid,row=(await botRow(w.env,uid))!,clock=Date.now;
  const hold=w.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').get(row.reservation_uid);
  assert.equal(hold.included_microusd+hold.topup_microusd,25000);
  assert.equal(w.starts[0].budget_deadline_at,row.started_at!+120_000);
  try {
    Date.now=()=>row.started_at!+60_000;await event(w,uid,{seq:1,type:'heartbeat'});
    Date.now=()=>row.started_at!+120_000;await w.supervisors.get(uid).object.alarm();
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,2);
    assert.equal(w.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(row.reservation_uid).status,'settled');
    // Other AI use consumes the remaining allowance before the next boundary.
    w.db.prepare('UPDATE ai_included_spend SET spend_microusd=500000000').run();
    Date.now=()=>row.started_at!+180_000;await event(w,uid,{seq:2,type:'heartbeat'});
    Date.now=()=>row.started_at!+240_000;await w.supervisors.get(uid).object.alarm();
    const ended=(await botRow(w.env,uid))!;assert.equal(ended.status,'stopped');assert.equal(ended.failure_code,'tokens');assert.equal(ended.minutes,4);assert.equal(w.stops.length,1);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status='pending'").get().n,0);
  }finally{Date.now=clock;}
  const small=world(400000);
  // Bot alone fits (375k); bot + Nova (570001) does not.
  assert.equal((await post(small)).status,402);assert.equal(small.starts.length,0);
});

test('D886 canary is Super Admin only; public mode needs a measured price and existing billing modes apply',async()=>{
  const w=world();w.env.MEETING_BOT='canary';assert.equal((await post(w)).status,503);
  w.db.exec('CREATE TABLE IF NOT EXISTS super_admins(user_id INTEGER PRIMARY KEY)');
  w.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(FOUNDER);w.db.prepare('INSERT INTO super_admins VALUES(?)').run(FOUNDER);
  const r=await post(w);assert.equal(r.status,202);assert.equal(r.body.bot.rate_per_minute_microusd,2232);
  const cost=world();cost.env.AI_BILLING='cost';assert.equal((await post(cost)).body.bot.rate_per_minute_microusd,10000);
});

test('D886 interrupted dispatch is recovered by GET, but a missed schedule cannot start hours later',async()=>{
  const w=world(),fetch=w.env.MEETING_BOT_RUN.get;
  w.env.MEETING_BOT_RUN.get=()=>({async fetch(){throw new Error('synthetic interrupted init');}});
  assert.equal((await post(w)).status,503);assert.equal(w.starts.length,0);
  w.env.MEETING_BOT_RUN.get=fetch;
  const recovered=await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);assert.equal(recovered.status,200);assert.equal(recovered.body.bot.status,'joining');assert.equal(w.starts.length,1);
  const late=world(),get=late.env.MEETING_BOT_RUN.get;
  late.env.MEETING_BOT_RUN.get=()=>({async fetch(){throw new Error('synthetic interrupted init');}});
  await post(late);late.env.MEETING_BOT_RUN.get=get;
  const clock=Date.now;Date.now=()=>clock()+3600_000;
  try {const missed=await call(late.env,FOUNDER,'GET',`/sessions/${late.session}/bot`);assert.equal(missed.body.bot.failure_code,'schedule_missed');assert.equal(late.starts.length,0);}finally{Date.now=clock;}
});


test('D886 Stop bounds the captured tail; a rejected part prevents completion',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid,run=(await botRow(w.env,uid))!,clock=Date.now;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  try {
    Date.now=()=>run.started_at!+2000;
    const stopped=await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{});assert.equal(stopped.body.bot.status,'processing');
    const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
    assert.equal((await upload(w,ticket.body.upload_path)).status,200);
    const beyond=await event(w,uid,{seq:3,type:'chunk',chunk_seq:1,size_bytes:wav().byteLength,start_ms:2000});
    assert.equal((await upload(w,beyond.body.upload_path)).status,413);
    assert.equal((await event(w,uid,{seq:4,type:'status',status:'done'})).body.bot.failure_code,'processing_failed');
    assert.equal(w.stops.length,1);
  }finally{Date.now=clock;}
});

async function renewal(Supervisor=MeetingBotRun) {
  const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid,row=(await botRow(w.env,uid))!,clock=Date.now;
  const base=row.started_at!;
  try {
    Date.now=()=>base+99_999;
    const before=await event(w,uid,{seq:1,type:'heartbeat'});
    assert.equal(before.body.budget_deadline_at,base+120_000);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,1);
    await w.supervisors.get(uid).object.alarm();
    assert.equal(w.supervisors.get(uid).alarm,base+100_000,'alarm reaches the renewal lead');
    Date.now=()=>base+100_000;
    const renewed=await event(w,uid,{seq:2,type:'heartbeat'});
    assert.equal(renewed.body.budget_deadline_at,base+240_000,'lease is extended before the old one expires');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,2);
    assert.equal(w.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(row.reservation_uid).status,'pending','the current part is not charged early');
    const duplicate=await event(w,uid,{seq:2,type:'heartbeat'});
    assert.equal(duplicate.body.budget_deadline_at,base+240_000,'a lost renewal response can be retried');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,2);
    Date.now=()=>base+120_000; await event(w,uid,{seq:3,type:'heartbeat'});
    assert.equal(w.db.prepare('SELECT status FROM ai_budget_reservations WHERE uid=?').get(row.reservation_uid).status,'settled');
    assert.equal(w.starts.length,1);
  }finally{Date.now=clock;}
}
async function noticeOff(Supervisor=UnpublishedMeetingBotRun) {
  const w=world(500_000_000,Supervisor),r=await post(w);
  assert.equal(r.status,202);assert.equal(r.body.bot.status,'failed'); assert.equal(r.body.bot.failure_code,'notice_unpublished');
  assert.equal(w.starts.length,0);assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,0);
}
async function noticeCompany(Supervisor=MeetingBotRun) {
  const w=world(500_000_000,Supervisor);
  const {tableFromBaseline}=await import('./_baseline.mjs');
  w.db.exec(tableFromBaseline(readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8'),'company_profiles'));
  w.db.prepare('INSERT INTO company_profiles(id,uid,company_name) VALUES(?,?,?)').run(11,'synthetic-company','Synthetic Venture');
  w.db.prepare('UPDATE projects SET company_id=11 WHERE id=10').run();
  const r=await post(w,{meeting_url:syntheticLink(),venture_name:'untrusted-label',notice:'untrusted-notice'});
  assert.equal(r.body.bot.status,'joining');assert.equal(w.starts.length,1);
  assert.equal(w.starts[0].venture_name,'Synthetic Venture');
  const {draftMeetingBotNotice}=await import('../../meeting-bot/notice.mjs');
  assert.equal(w.starts[0].notice,draftMeetingBotNotice({ventureName:'Synthetic Venture'}));
  assert.equal(JSON.stringify(r.body).includes('Synthetic Venture'),false);
  assert.equal(JSON.stringify(w.db.prepare('SELECT details FROM activity_logs').all()).includes('Synthetic Venture'),false);
}
async function complete(Supervisor=MeetingBotRun) {
  const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
  assert.equal((await upload(w,ticket.body.upload_path)).status,200);
  assert.equal((await event(w,uid,{seq:3,type:'status',status:'processing',chunks:1,chunks_failed:0})).body.bot.status,'processing');
  assert.equal((await upload(w,ticket.body.upload_path)).status,401);
  assert.equal((await event(w,uid,{seq:4,type:'status',status:'done',chunks:1,chunks_failed:0})).body.bot.status,'done');
  assert.equal(w.stops.length,1);
}
async function incomplete(Supervisor=MeetingBotRun) {
  for(const kind of ['pending','unannounced','failed','unknown','gap','missing_row','uncommitted_ticket','extra_ticket','extra_row','shifted_row']) {
    const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid;
    await event(w,uid,{seq:1,type:'status',status:'recording'});
    if(['pending','missing_row','gap','uncommitted_ticket','extra_ticket','extra_row','shifted_row'].includes(kind)) {
      const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:kind==='gap'?1:0,size_bytes:wav().byteLength,start_ms:0});
      if(!['pending','extra_ticket'].includes(kind)) assert.equal((await upload(w,ticket.body.upload_path)).status,200);
      if(kind==='uncommitted_ticket') {const data=w.supervisors.get(uid).data;data.set('chunk:0',{...data.get('chunk:0'),used:false});}
      if(kind==='extra_row')w.db.prepare("INSERT INTO interview_session_chunks(session_id,seq,r2_key,mime,size_bytes) VALUES(?,99,'synthetic-extra','audio/wav',32044)").run(w.session);
      if(kind==='shifted_row')w.db.prepare('UPDATE interview_session_chunks SET seq=1 WHERE session_id=?').run(w.session);
      if(kind==='missing_row')w.db.prepare('DELETE FROM interview_session_chunks WHERE session_id=?').run(w.session);
    }
    const chunks=['failed','extra_ticket'].includes(kind)?0:kind==='unknown'?null:1;
    const done=await event(w,uid,{seq:3,type:'status',status:'processing',chunks,chunks_failed:kind==='failed'?1:0});
    assert.equal(done.status,200,kind);assert.equal(done.body.bot.status,'failed',kind); assert.equal(done.body.bot.failure_code,'processing_failed',kind);
    assert.equal((await botRow(w.env,uid))!.status,'failed');
  }
}
async function stopDrain(Supervisor=MeetingBotRun) {
  for(const expired of [false,true]) {
    const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid,row=(await botRow(w.env,uid))!,clock=Date.now;
    await event(w,uid,{seq:1,type:'status',status:'recording'});
    try {
      Date.now=()=>row.started_at!+2000;
      await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{});
      const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
      if(!expired) {
        assert.equal((await upload(w,ticket.body.upload_path)).status,200);
        assert.equal((await event(w,uid,{seq:3,type:'status',status:'done',chunks:1,chunks_failed:0})).body.bot.status,'stopped');
      }else {
        Date.now=()=>row.started_at!+32_000;
        await w.supervisors.get(uid).object.alarm();
        assert.equal((await botRow(w.env,uid))!.failure_code,'processing_failed');
        assert.ok((await upload(w,ticket.body.upload_path)).status>=400);
      }
    }finally{Date.now=clock;}
  }
}
test('B1 follow-up: lease renews exactly 20 seconds early, without early settlement or duplicate holds',()=>renewal());
test('B1 follow-up: unpublished notice refuses start without spending',()=>noticeOff());
test('B1 follow-up: approved notice names the run-authorized company',()=>noticeCompany());
test('B1 follow-up: normal completion uploads before processing',()=>complete());
test('B1 follow-up: incomplete, failed or unknown uploads never become a complete recording',()=>incomplete());
test('B1 follow-up: Stop drains for 30 seconds and an incomplete drain fails',()=>stopDrain());

async function finalLease(Supervisor=MeetingBotRun) {
  const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid,row=(await botRow(w.env,uid))!,clock=Date.now;
  try {
    for(let minute=1;minute<=28;minute++) {Date.now=()=>row.started_at!+minute*60_000;await event(w,uid,{seq:minute,type:'heartbeat'});}
    const count=w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n;
    assert.equal(count,15);
    Date.now=()=>row.started_at!+30*60_000-20_000;
    assert.equal((await event(w,uid,{seq:29,type:'heartbeat'})).body.budget_deadline_at,row.started_at!+30*60_000);
    await w.supervisors.get(uid).object.alarm();
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,count);
    assert.equal(w.supervisors.get(uid).alarm,row.started_at!+30*60_000);
  }finally{Date.now=clock;}
}
async function renewalRefusal(Supervisor=MeetingBotRun) {
  const w=world(500_000_000,Supervisor),r=await post(w),uid=r.body.bot.uid,row=(await botRow(w.env,uid))!,clock=Date.now;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  w.db.prepare('UPDATE ai_included_spend SET spend_microusd=500000000').run();
  try {
    Date.now=()=>row.started_at!+100_000;
    assert.equal((await event(w,uid,{seq:2,type:'heartbeat'})).status,402);
    assert.equal((await botRow(w.env,uid))!.failure_code,'tokens');
    assert.equal(w.stops.length,1);assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status='pending'").get().n,0);
  }finally{Date.now=clock;}
}
test('B1 follow-up: the plan limit never creates a zero-length extra block',()=>finalLease());
test('B1 follow-up: a refused advance hold still stops with tokens',()=>renewalRefusal());

for(const [name,before,after,check,published] of [
  ['renewal lead removed','export const BOT_RENEWAL_LEAD_MS = 20_000','export const BOT_RENEWAL_LEAD_MS = 0',renewal,true],
  ['renewal boundary delayed','now < last.end - BOT_RENEWAL_LEAD_MS','now <= last.end - BOT_RENEWAL_LEAD_MS',renewal,true],
  ['current block charged early','elapsedOnly && block.end > end','false',renewal,true],
  ['alarm waits until expiry','lease-BOT_RENEWAL_LEAD_MS','lease',renewal,true],
  ['duplicate loses renewed lease','duplicate:true,bot:botView(run),budget_deadline_at:await this.lease()','duplicate:true,bot:botView(run)',renewal,true],
  ['unpublished gate ignored','if (!MEETING_BOT_NOTICE_PUBLISHED)','if (false)',noticeOff,false],
  ['venture attribution omitted','await botVentureName(this.env,run)','null',noticeCompany,true],
  ['notice omitted from start','!,notice,venture_name:ventureName','!,venture_name:ventureName',noticeCompany,true],
  ['upload checks skipped',"if ((status==='processing' || status==='done') && !await this.uploadsComplete(run,event))",'if (false)',incomplete,true],
  ['runtime failure count ignored',"if (!int(count,3600) || (event.chunks_failed === undefined ? (prior === undefined ? null : 0) : event.chunks_failed) !== 0)",'if (false)',incomplete,true],
  ['extra ticket ignored','tickets.size !== count || rows.length !== count','rows.length !== count',incomplete,true],
  ['extra durable row ignored','tickets.size !== count || rows.length !== count','tickets.size !== count',incomplete,true],
  ['unused ticket accepted','!tickets.get(`chunk:${seq}`)?.used','false',incomplete,true],
  ['shifted sequence accepted','rows[seq].seq !== seq','false',incomplete,true],
  ['expired incomplete drain accepted',"if (!await this.state.storage.get('uploads_complete')) return this.finish(run,'failed','processing_failed');",'',stopDrain,true],
  ['extra final block funded','if (last && last.end >= (run.started_at ?? blocks[0].start) + run.limit_minutes*60_000)','if (false)',finalLease,true],
  ['refused advance hold ignored',"if (!held.ok || held.replayed && held.status!=='pending') return false;","if (!held.ok || held.replayed && held.status!=='pending') return true;",renewalRefusal,true],
] as const) test('B1 follow-up mutation: '+name,async()=>{
  await check(published?MeetingBotRun:UnpublishedMeetingBotRun);
  const variant=await supervisorVariant(before,after,published);
  await assert.rejects(()=>check(variant.MeetingBotRun),{name:'AssertionError'});
  await check(published?MeetingBotRun:UnpublishedMeetingBotRun);
});


test('B7 participants read is creator-only, decrypts the latest roster, excludes bot/IDs and distinguishes missing/corrupt data',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  assert.equal(w.db.prepare('SELECT submitted_via FROM interview_sessions WHERE id=?').get(w.session).submitted_via,'meeting_bot');
  const path=`/sessions/${w.session}/bot/participants`;
  assert.equal((await call(w.env,FOUNDER,'GET',path)).body.participants,null);
  await event(w,uid,{seq:1,type:'roster',participants:[{id:'fixture-a',name:'Fixture name',joined_ms:0,left_ms:null},{id:'fixture-b',name:'person@example.invalid',joined_ms:10,left_ms:100},{id:'fixture-bot',name:'Eadwyn AI',joined_ms:0,left_ms:null}]});
  const read=await call(w.env,FOUNDER,'GET',path);assert.equal(read.status,200);
  assert.deepEqual(read.body.participants,[{display_name:'Fixture name',joined_ms:0,left_ms:null},{display_name:'Participant 2',joined_ms:10,left_ms:100}]);
  assert.equal(JSON.stringify(read.body).includes('fixture-a'),false);assert.equal(JSON.stringify(read.body).includes('@'),false);
  w.db.prepare("UPDATE users SET role='admin',founder_id=100 WHERE id=?").run(OTHER);
  assert.equal((await call(w.env,OTHER,'GET',path)).status,404);
  w.db.prepare("UPDATE meeting_bot_events SET payload_enc='corrupt' WHERE run_uid=?").run(uid);
  assert.equal((await call(w.env,FOUNDER,'GET',path)).status,503);
});

test('B7 queued bot cannot be started as a device from a stale session snapshot',async()=>{
  const w=world();const {loadSession,transition}=await import('../src/services/interviewSessions.ts');
  const before=await loadSession(w.env,w.session);
  const r=await post(w,{meeting_url:syntheticLink(),scheduled_at:new Date(Date.now()+3600000).toISOString()});assert.equal(r.status,202);
  assert.equal(await transition(w.env,before!,'start'),false);
  assert.equal((await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/start`,{})).status,409);
});
