/** D886 B1. All meeting/participant values below are synthetic and never logged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fixture, seed, call, mig, FOUNDER, OTHER } from './_call_audio_fixture.ts';
import { MeetingBotRun, botHmac, BOT_CALLBACK_WINDOW_MS } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { BOT_COMMISSION_MULTIPLIER, botRate, botLimit, botPlatform, botRow, botSession } from '../src/services/meetingBots.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import { runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { withGuard } from './_guard_stub.mjs';

const syntheticLink = (p='zoom') => p==='zoom' ? ['https:/','unit.zoom.us','j',String(111111111)].join('/')
  : p==='google_meet' ? ['https:/','meet.google.com','abc-defg-hij'].join('/')
    : ['https:/','teams.microsoft.com','meet','synthetic'].join('/');
const hmacSecret = 'd886-'+'x'.repeat(40);
function world(monthMicro=500_000_000) {
  const w=fixture({monthMicro});
  w.db.exec(mig('525_ai_reservation_idempotency.sql'));
  w.db.exec(mig('531_meeting_bots.sql'));
  w.db.exec(mig('532_meeting_bot_participants.sql'));
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
      const object=new MeetingBotRun(state,w.env);objects.set(uid,{object,state,data,get alarm(){return alarm;}});
    }
    return {fetch:(r:Request)=>objects.get(uid).object.fetch(r)};
  }};
  return {...w,session,starts,stops,supervisors:objects};
}
const post = (w:any,args:any={meeting_url:syntheticLink()})=>call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot`,args);
async function event(w:any,uid:string,data:any,{timestamp=Date.now(),signature}:any={}) {
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
  assert.equal((await event(p,id,{seq:3,type:'status',status:'done'})).body.code,'bot_processing');
  assert.equal((await botRow(p.env,id))!.status,'processing');
  assert.equal(p.stops.length,1);
});

test('D886 signed upload to recorder job to named final transcript completes only after assembly',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  const messages:any[]=[];let transcriptions=0;
  w.env.USE_CF_QUEUE='true';w.env.JOB_QUEUE={send:async(body:any)=>{messages.push(body);}} as any;
  w.env.AI=withGuard({run:async(model:string)=>{assert.equal(model,'@cf/deepgram/nova-3');transcriptions++;
    return {results:{channels:[{detected_language:'en',alternatives:[{transcript:'Fixture.',words:[{word:'Fixture.',start:0,end:1,speaker:0}]}]}]}};}}) as any;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  await event(w,uid,{seq:2,type:'roster',participants:[{id:'p',name:'Fixture speaker',joined_ms:0,left_ms:null}]});
  await event(w,uid,{seq:3,type:'speaker',participant_id:'p',at_ms:0});
  const ticket=await event(w,uid,{seq:4,type:'chunk',chunk_seq:0,start_ms:0,size_bytes:wav().byteLength});
  assert.equal((await upload(w,ticket.body.upload_path)).status,200);
  assert.equal((await event(w,uid,{seq:5,type:'speaker',participant_id:null,at_ms:1000})).status,200);
  assert.equal((await event(w,uid,{seq:6,type:'status',status:'processing'})).status,200);
  assert.equal((await event(w,uid,{seq:7,type:'status',status:'done'})).body.code,'bot_processing');
  assert.equal((await event(w,uid,{seq:7,type:'speaker',participant_id:'p',at_ms:1000})).body.code,'bot_processing');
  await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);
  await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);
  assert.equal(messages.length,1);assert.equal(messages[0].job_type,'interview_process');
  assert.equal(await runInterviewProcessJob(w.env,messages[0].payload),'done');
  assert.equal(transcriptions,1);
  const finished=await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);
  assert.equal(finished.body.bot.status,'done');
  assert.equal(w.db.prepare('SELECT speaker_label FROM interview_transcript_segments WHERE session_id=?').get(w.session).speaker_label,'Fixture speaker');
  const row=(await botRow(w.env,uid))!;
  const participants=JSON.parse((await decryptColumn(w.env,'meeting_bots','participants_enc',uid,row.participants_enc!))!);
  assert.equal(participants.length,1);assert.equal(participants[0].joined_ms,0);
  assert.equal(await runInterviewProcessJob(w.env,messages[0].payload),null);
  assert.equal(transcriptions,1);
});

test('D886 moving processing progress keeps assembly alive without extending runtime billing',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  await event(w,uid,{seq:2,type:'status',status:'processing'});
  w.supervisors.get(uid).data.set('assembly_queued',true);
  const run=(await botRow(w.env,uid))!,clock=Date.now;
  const later=run.ended_at!+360000;
  Date.now=()=>later;
  try {
    const fresh=new Date(later-1000).toISOString().replace('T',' ').slice(0,19);
    w.db.prepare("UPDATE interview_sessions SET processing_stage='transcribing',processing_updated_at=? WHERE id=?").run(fresh,w.session);
    await w.supervisors.get(uid).object.alarm();
    assert.equal((await botRow(w.env,uid))!.status,'processing');
    assert.equal((await botRow(w.env,uid))!.ended_at,run.ended_at);
    const stale=new Date(later-360000).toISOString().replace('T',' ').slice(0,19);
    w.db.prepare('UPDATE interview_sessions SET processing_updated_at=? WHERE id=?').run(stale,w.session);
    await w.supervisors.get(uid).object.alarm();
    assert.equal((await botRow(w.env,uid))!.failure_code,'processing_timeout');
  }finally{Date.now=clock;}
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


test('D886 Stop flushes the captured tail during a bounded drain; withdrawal still blocks it immediately',async()=>{
  const w=world(),r=await post(w),uid=r.body.bot.uid,run=(await botRow(w.env,uid))!,clock=Date.now;
  await event(w,uid,{seq:1,type:'status',status:'recording'});
  try {
    Date.now=()=>run.started_at!+2000;
    const stopped=await call(w.env,FOUNDER,'POST',`/sessions/${w.session}/bot/stop`,{});assert.equal(stopped.body.bot.status,'processing');
    const ticket=await event(w,uid,{seq:2,type:'chunk',chunk_seq:0,size_bytes:wav().byteLength,start_ms:0});
    assert.equal((await upload(w,ticket.body.upload_path)).status,200);
    const beyond=await event(w,uid,{seq:3,type:'chunk',chunk_seq:1,size_bytes:wav().byteLength,start_ms:2000});
    assert.equal((await upload(w,beyond.body.upload_path)).status,413);
    assert.equal((await event(w,uid,{seq:4,type:'status',status:'done'})).body.bot.status,'stopped');
    assert.equal(w.stops.length,1);
  }finally{Date.now=clock;}
});
