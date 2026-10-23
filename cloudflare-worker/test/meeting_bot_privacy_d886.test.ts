/** D886 B9 follow-up: synthetic data only; real routes, supervisor, signed runtime callbacks and SQLite/R2. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { world, post, syntheticLink, hmacSecret } from './_meeting_bot_fixture.ts';
import { call, FOUNDER, OTHER, JWT_SECRET, segmentCount, chunkCount } from './_call_audio_fixture.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { MeetingBotRun } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { botRow } from '../src/services/meetingBots.ts';
import { purgeExpiredCallAudio } from '../src/services/callAudioRetention.ts';
import { runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { withGuard } from './_guard_stub.mjs';
import { RuntimeHost } from '../../meeting-bot/src/runtime.ts';
import { runBot } from '../../meeting-bot/src/lifecycle.ts';
import { httpTransport, signRequest } from '../../meeting-bot/src/callback.ts';
import { FakeAdapter } from '../../meeting-bot/src/fakeAdapter.ts';
import { FakeClock, StubCallback, settle, tone } from '../../meeting-bot/test/_harness.ts';
import { MEETING_BOT_NOTICE_PUBLISHED } from '../../meeting-bot/notice.mjs';

let serial=0;
/** Isolated source variants; the publication date and tracked files never change. */
async function variant(path:string, replacements:Array<[string,string]>=[], imports:Record<string,string>={}) {
  const file=new URL('../../'+path,import.meta.url);let source=readFileSync(file,'utf8');
  for(const [before,after] of replacements){assert.ok(source.includes(before),'mutation target exists');source=source.replace(before,()=>after);}
  if(path.endsWith('.ts'))source=stripTypeScriptTypes(source,{mode:'strip'});
  const resolve=(spec:string)=>{const url=new URL(/\.[mc]?[jt]s$/.test(spec)?spec:spec+'.ts',file);return imports[url.href]??url.href;};
  source=source.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_m,a,s,b)=>a+resolve(s)+b)
    .replace(/(import\(['"])(\.[^'"]+)(['"]\))/g,(_m,a,s,b)=>a+resolve(s)+b);
  source=source.replace(/(from\s*['"])([^.'"][^'"]*)(['"])/g,(_m,a,s,b)=>a+(/^(file:|data:|node:)/.test(s)?s:import.meta.resolve(s))+b);
  const url='data:text/javascript;base64,'+Buffer.from(source+'\n// isolated B9 '+ ++serial).toString('base64');
  return {url,module:await import(url)};
}
const key=(path:string)=>new URL('../../'+path,import.meta.url).href;
const published=await variant('meeting-bot/notice.mjs', [['MEETING_BOT_NOTICE_APPROVED_AT = null',"MEETING_BOT_NOTICE_APPROVED_AT = '2000-01-01'"]]);
const publishedImports={[key('meeting-bot/notice.mjs')]:published.url};
const approved=await variant('cloudflare-worker/src/durable-objects/meeting-bot-run.ts',[],publishedImports);
const approvedRuntime=await variant('meeting-bot/src/runtime.ts',[],publishedImports);
const defaults={Supervisor:approved.module.MeetingBotRun,Unpublished:MeetingBotRun,Runtime:RuntimeHost,PublishedRuntime:approvedRuntime.module.RuntimeHost,runBot,purge:purgeExpiredCallAudio,call};
type Modules=typeof defaults;
const platforms=['zoom','google_meet','teams'];
function company(w:any){
  w.db.exec(tableFromBaseline(readFileSync(new URL('../sql/schema_baseline.sql',import.meta.url),'utf8'),'company_profiles'));
  w.db.prepare('INSERT INTO company_profiles(id,uid,company_name) VALUES(11,?,?)').run('b9-fixture','Synthetic Venture');
  w.db.prepare('UPDATE projects SET company_id=11 WHERE id=10').run();
}
async function command(host:any,payload:any){
  const raw=JSON.stringify(payload);
  return host.fetch(new Request('https://runtime.invalid/start',{method:'POST',body:raw,headers:await signRequest(hmacSecret,'/start',raw,Date.now())}));
}

async function unpublished(m:Modules){
  assert.equal(MEETING_BOT_NOTICE_PUBLISHED,false);
  for(const platform of platforms)for(const scheduled of [false,true]){
    const w=world(500_000_000,m.Unpublished),at=Date.now()+5000;
    const r=await post(w,{meeting_url:syntheticLink(platform),...(scheduled?{scheduled_at:new Date(at).toISOString()}:{})});
    assert.equal(r.status,202);
    if(scheduled){assert.equal(r.body.bot.status,'queued');const now=Date.now;Date.now=()=>at;try{await w.supervisors.get(r.body.bot.uid).object.alarm();}finally{Date.now=now;}}
    const row=await botRow(w.env,r.body.bot.uid);
    assert.equal(row!.status,'failed');assert.equal(row!.failure_code,'notice_unpublished');
    assert.equal(w.starts.length,0);assert.equal(w.objects.size,0);assert.equal(w.stt.length,0);
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,0);
  }
  let factories=0;
  const host=new m.Runtime({secret:hmacSecret,callbackOrigin:'https://unit.invalid',adapter:async()=>{factories++;return new FakeAdapter({openDoor:true});},transport:()=>new StubCallback()});
  const now=Date.now();
  try{
    const r=await command(host,{uid:crypto.randomUUID(),platform:'google_meet',meeting_url:syntheticLink('google_meet'),limit_minutes:30,deadline_at:now+1800000,budget_deadline_at:now+120000,notice:published.module.meetingBotNotice()});
    assert.equal(r.status,503);assert.equal(factories,0);assert.equal(host.running,false);
  }finally{await host.shutdown();}
}
async function startNotice(m:Modules){
  for(const platform of platforms)for(const scheduled of [false,true]){
    const w=world(500_000_000,m.Supervisor);company(w);const at=Date.now()+5000;
    const r=await post(w,{meeting_url:syntheticLink(platform),venture_name:'untrusted',notice:'untrusted',...(scheduled?{scheduled_at:new Date(at).toISOString()}:{})});
    if(scheduled){assert.equal(w.starts.length,0);const now=Date.now;Date.now=()=>at;try{await w.supervisors.get(r.body.bot.uid).object.alarm();}finally{Date.now=now;}}
    assert.equal(w.starts.length,1);assert.equal(w.starts[0].venture_name,'Synthetic Venture');
    assert.equal(w.starts[0].notice,published.module.meetingBotNotice({ventureName:'Synthetic Venture'}));
    assert.equal(JSON.stringify(r.body).includes('Synthetic Venture'),false);
    if(!scheduled){
      const adapter=new FakeAdapter({platform:platform as any,openDoor:true}),cb=new StubCallback();
      const host=new m.PublishedRuntime({secret:hmacSecret,callbackOrigin:'https://unit.invalid',adapter:async()=>adapter,transport:()=>cb});
      try{
        assert.equal((await command(host,w.starts[0])).status,202);await settle(100);
        assert.deepEqual(adapter.chat,[w.starts[0].notice]);
        assert.ok(adapter.calls.indexOf('chat')<adapter.calls.indexOf('audio'));
        assert.equal((await command(host,w.starts[0])).status,200);await settle();assert.equal(adapter.chat.length,1);
      }finally{await host.shutdown();}
    }
  }
  for(const change of [{notice:''},{notice:'untrusted'},{venture_name:'another venture'}]){
    const w=world(500_000_000,m.Supervisor);company(w);await post(w);let factories=0;
    const host=new m.PublishedRuntime({secret:hmacSecret,callbackOrigin:'https://unit.invalid',adapter:async()=>{factories++;return new FakeAdapter({openDoor:true});},transport:()=>new StubCallback()});
    try{assert.equal((await command(host,{...w.starts[0],...change})).status,503);assert.equal(factories,0);}finally{await host.shutdown();}
  }
}
async function scheduledConsent(m:Modules){
  const w=world(500_000_000,m.Supervisor),at=Date.now()+5000;
  w.db.prepare("UPDATE interview_sessions SET consent_status='not_recorded' WHERE id=?").run(w.session);
  assert.equal((await post(w)).body.code,'consent_required');assert.equal(w.starts.length,0);
  w.db.prepare("UPDATE interview_sessions SET consent_status='given' WHERE id=?").run(w.session);
  const r=await post(w,{meeting_url:syntheticLink(),scheduled_at:new Date(at).toISOString()});
  assert.equal((await m.call(w.env,FOUNDER,'PATCH',`/sessions/${w.session}/consent`,{status:'declined'})).status,200);
  const now=Date.now;Date.now=()=>at;try{await w.supervisors.get(r.body.bot.uid).object.alarm();}finally{Date.now=now;}
  assert.equal(w.starts.length,0);assert.equal((await botRow(w.env,r.body.bot.uid))!.status,'stopped');
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM ai_budget_reservations').get().n,0);
}

/** Worker start payload drives B2's real lifecycle and signed HTTP client back into B1. */
async function capture(m:Modules,platform='teams',withdraw=false){
  const w=world(500_000_000,m.Supervisor),messages:any[]=[],wire:any[]=[],logs:string[]=[],puts:string[]=[];
  w.env.USE_CF_QUEUE='true';w.env.JOB_QUEUE={send:async(body:any)=>{messages.push(body);}};
  const clock=new FakeClock();clock.t=Date.now();const savedNow=Date.now;Date.now=()=>clock.now();
  const stop=new AbortController(),adapter=new FakeAdapter({platform:platform as any,openDoor:true});
  let run:Promise<any>|undefined;
  try{
    const sent=await post(w,{meeting_url:syntheticLink(platform)}),uid=sent.body.bot.uid;assert.equal(sent.status,202);
    w.env.MEETING_BOT_RUNTIME.stop=async()=>{w.stops.push(uid);stop.abort();};
    const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
    const transport=httpTransport({baseUrl:`https://unit.invalid/api/meeting-bots/${uid}/`,runId:uid,key:hmacSecret,now:()=>clock.now(),fetch:async(input:any,init:any)=>{
      if(init.method==='POST')wire.push(JSON.parse(init.body));else puts.push(String(input));
      return app.fetch(new Request(input,init),w.env);
    }});
    const payload=w.starts[0];adapter.arrive('fixture-p','Synthetic Participant');
    run=m.runBot({runId:uid,platform:payload.platform,meetingUrl:payload.meeting_url,notice:payload.notice,limitMs:payload.limit_minutes*60000,deadlineAt:payload.deadline_at,budgetDeadlineAt:payload.budget_deadline_at},{adapter,transport,clock,stop:stop.signal,log:(e:any,f:any)=>logs.push(JSON.stringify({e,...f}))});
    await clock.advance(100);
    assert.equal((await botRow(w.env,uid))!.status,'recording');
    assert.deepEqual(adapter.chat,[published.module.meetingBotNotice()]);assert.ok(adapter.calls.indexOf('chat')<adapter.calls.indexOf('audio'));
    adapter.speak('fixture-p');adapter.say(tone(16000));await clock.advance(1000);
    if(withdraw){
      assert.equal((await m.call(w.env,FOUNDER,'PATCH',`/sessions/${w.session}/consent`,{status:'declined'})).status,200);
      assert.equal(stop.signal.aborted,true,'withdrawal acknowledges only after runtime Stop');
      assert.equal((await botRow(w.env,uid))!.status,'stopped');
    }else adapter.end();
    const result=await clock.until(run);
    assert.equal(adapter.listening,0);assert.equal(adapter.chat.length,1);
    const unique=new Map<number,unknown>();
    for(const e of wire){if(unique.has(e.seq))assert.deepEqual(e,unique.get(e.seq));else unique.set(e.seq,e);}
    assert.deepEqual([...unique.keys()],[...unique.keys()].map((_e,i)=>i+1));
    assert.equal(logs.join('').includes('Synthetic Participant'),false);assert.equal(logs.join('').includes(payload.meeting_url),false);assert.equal(logs.join('').includes(payload.notice),false);
    if(withdraw){
      assert.equal((await botRow(w.env,uid))!.status,'stopped');assert.equal(w.stops.length,1);
      assert.equal(w.objects.size,0);assert.equal(chunkCount(w,w.session),0);assert.equal(messages.length,0);assert.equal(w.stt.length,0);
      assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM ai_budget_reservations WHERE status='pending'").get().n,0);
    }else{
      assert.equal(result.chunks_failed,0);assert.equal(chunkCount(w,w.session),1);assert.equal(w.objects.size,1);
      assert.equal((await botRow(w.env,uid))!.status,'processing');
      assert.equal(wire.at(-1).status,'processing');assert.equal(wire.at(-1).chunks,1);assert.equal(wire.at(-1).chunks_failed,0);
      await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`);assert.equal(messages.length,1);
    }
    return {...w,uid,messages,puts};
  }finally{stop.abort();if(run)await clock.until(run);Date.now=savedNow;}
}
async function complete(m:Modules,platform='teams'){
  const w=await capture(m,platform);
  w.env.AI=withGuard({run:async()=>({results:{channels:[{detected_language:'en',alternatives:[{transcript:'Synthetic passage.',words:[{word:'Synthetic passage.',start:0,end:1,speaker:0}]}]}]}})});
  assert.equal(await runInterviewProcessJob(w.env,w.messages[0].payload),'done');
  assert.equal((await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`)).body.bot.status,'done');
  assert.equal(segmentCount(w,w.session),1);
  const people=await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot/participants`);
  assert.equal(people.body.participants.length,1);assert.equal(people.body.participants[0].display_name,'Synthetic Participant');
  assert.ok((await botRow(w.env,w.uid))!.participants_enc!.startsWith('v1.'));
  return w;
}
async function retention(m:Modules){
  for(const platform of platforms){
    const w=await complete(m,platform),now=new Date();
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_channel_refs').get().n,0);
    const encoded=(await botRow(w.env,w.uid))!.participants_enc;
    w.db.prepare('UPDATE interview_session_chunks SET created_at=? WHERE session_id=?').run(new Date(now.getTime()-29*86400000).toISOString(),w.session);
    assert.equal((await m.purge(w.env,now)).sessions,0);assert.equal(w.objects.size,1);
    w.db.prepare('UPDATE interview_session_chunks SET created_at=? WHERE session_id=?').run(new Date(now.getTime()-31*86400000).toISOString(),w.session);
    w.db.prepare('INSERT INTO member_call_audio_settings(user_id,call_audio_retention_days) VALUES(?,NULL)').run(FOUNDER);
    assert.equal((await m.purge(w.env,now)).sessions,0);assert.equal(w.objects.size,1);
    w.db.prepare('DELETE FROM member_call_audio_settings').run();
    assert.deepEqual(await m.purge(w.env,now),{sessions:1,objects:1});
    assert.equal(w.objects.size,0);assert.equal(chunkCount(w,w.session),0);assert.equal(segmentCount(w,w.session),1);
    assert.equal((await botRow(w.env,w.uid))!.participants_enc,encoded);
    assert.equal(w.db.prepare('SELECT audio_removed_reason FROM interview_sessions WHERE id=?').get(w.session).audio_removed_reason,'retention');
    assert.equal((await m.purge(w.env,now)).sessions,0);
    const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
    assert.ok((await app.fetch(new Request(w.puts[0],{method:'PUT',body:new Uint8Array(32044)}),w.env)).status>=400);assert.equal(w.objects.size,0);
  }
}
async function deletion(m:Modules){
  const w=await complete(m),encoded=(await botRow(w.env,w.uid))!.participants_enc;
  assert.equal((await m.call(w.env,OTHER,'DELETE',`/sessions/${w.session}/audio`)).status,404);assert.equal(w.objects.size,1);
  assert.equal((await m.call(w.env,FOUNDER,'DELETE',`/sessions/${w.session}/audio`)).status,200);
  assert.equal(w.objects.size,0);assert.equal(chunkCount(w,w.session),0);assert.equal(segmentCount(w,w.session),1);
  assert.equal((await botRow(w.env,w.uid))!.participants_enc,encoded);
  assert.equal((await m.call(w.env,OTHER,'GET',`/sessions/${w.session}/bot/participants`)).status,404);
  // D1 cleanup must be explicit, even when foreign-key cascades are unavailable.
  w.db.exec('PRAGMA foreign_keys = OFF');
  assert.equal((await m.call(w.env,FOUNDER,'DELETE',`/sessions/${w.session}`)).status,200);
  assert.equal(segmentCount(w,w.session),0);assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bots').get().n,0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM meeting_bot_events').get().n,0);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM interview_chunk_transcripts WHERE session_id=?').get(w.session).n,0);
  assert.equal((await call(w.env,FOUNDER,'GET',`/sessions/${w.session}/bot`)).status,404);
}
async function lateConsent(m:Modules){
  const w=await capture(m);
  assert.equal((await m.call(w.env,FOUNDER,'PATCH',`/sessions/${w.session}/consent`,{status:'declined'})).status,200);
  await runInterviewProcessJob(w.env,w.messages[0].payload);
  assert.equal(w.stt.length,0);assert.equal(segmentCount(w,w.session),0);assert.equal((await botRow(w.env,w.uid))!.participants_enc,null);
}
const scenarios={unpublished,startNotice,scheduledConsent,withdrawal:(m:Modules)=>capture(m,'teams',true),retention,deletion,lateConsent};
for(const [name,scenario] of Object.entries(scenarios))test('B9 privacy: '+name,()=>scenario(defaults));

async function routeVariant(service?:{url:string},replacements:Array<[string,string]>=[]){
  const router=await variant('cloudflare-worker/src/routes/founder_validate_sessions.ts',replacements,service?{[key('cloudflare-worker/src/services/interviewSessions.ts')]:service.url}:{});
  const app=new Hono();app.route('/api/founder/validate',router.module.default);
  return async(env:any,user:number,method:string,path:string,body?:any)=>{
    const token=await new SignJWT({user_id:user,role:'founder'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res=await app.fetch(new Request('https://unit.invalid/api/founder/validate'+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
    return {status:res.status,body:await res.json() as any};
  };
}
test('B9 privacy mutations are caught between restored passing controls',async()=>{
  const mutations:Array<[string,(m:Modules)=>Promise<any>,()=>Promise<Partial<Modules>>]>=[
    ['Worker publication gate',unpublished,async()=>({Unpublished:(await variant('cloudflare-worker/src/durable-objects/meeting-bot-run.ts',[["if (!MEETING_BOT_NOTICE_PUBLISHED) return this.finish(run,'failed','notice_unpublished');",'']])).module.MeetingBotRun})],
    ['runtime draft fallback',unpublished,async()=>({Runtime:(await variant('meeting-bot/src/runtime.ts',[
      ['import { meetingBotNotice, MEETING_BOT_NOTICE_PUBLISHED }', 'import { draftMeetingBotNotice, MEETING_BOT_NOTICE_PUBLISHED }'],
      ['meetingBotNotice({ventureName})','draftMeetingBotNotice({ventureName})'],
    ])).module.RuntimeHost})],
    ['server notice carried on start',startNotice,async()=>({Supervisor:(await variant('cloudflare-worker/src/durable-objects/meeting-bot-run.ts',[['notice,venture_name:ventureName','notice:undefined,venture_name:ventureName']],publishedImports)).module.MeetingBotRun})],
    ['runtime exact notice',startNotice,async()=>({PublishedRuntime:(await variant('meeting-bot/src/runtime.ts',[["if(typeof command.notice!=='string'||command.notice!==approved)",'if(false)']],publishedImports)).module.RuntimeHost})],
    ['notice before listening',m=>capture(m),async()=>({runBot:(await variant('meeting-bot/src/lifecycle.ts',[["withRetry(()=>adapter.sendChat(cfg.notice),clock,NOTICE_TRIES)",'Promise.resolve(true)']])).module.runBot})],
    ['bot retention eligibility',retention,async()=>({purge:(await variant('cloudflare-worker/src/services/callAudioRetention.ts',[["IN ('upload','meeting_bot')","IN ('upload')"]])).module.purgeExpiredCallAudio})],
    ['young audio kept',retention,async()=>({purge:(await variant('cloudflare-worker/src/services/callAudioRetention.ts',[[">= COALESCE(m.call_audio_retention_days, ?2)",'>= 0 * ?2']])).module.purgeExpiredCallAudio})],
    ['keep until deleted',retention,async()=>({purge:(await variant('cloudflare-worker/src/services/callAudioRetention.ts',[["AND (m.user_id IS NULL OR m.call_audio_retention_days IS NOT NULL)",'']])).module.purgeExpiredCallAudio})],
    ['withdrawal stops runtime',m=>capture(m,'teams',true),async()=>({call:await routeVariant(undefined,[["try { await stopSessionBot(c.env, s.session.id, s.session.created_by_user_id); }",'try { /* isolated mutation */ }']])})],
    ['audio objects deleted',deletion,async()=>({call:await routeVariant(await variant('cloudflare-worker/src/services/interviewSessions.ts',[["await env.FILES.delete(keys.slice(i, i + 1000));",'void 0;']]))})],
    ['private events deleted',deletion,async()=>({call:await routeVariant(await variant('cloudflare-worker/src/services/interviewSessions.ts',[["DELETE FROM meeting_bot_events WHERE run_uid IN (SELECT uid FROM meeting_bots WHERE session_id = ?)","DELETE FROM meeting_bot_events WHERE 0 AND run_uid IN (SELECT uid FROM meeting_bots WHERE session_id = ?)"]]))})],
    ['final participant record deleted',deletion,async()=>({call:await routeVariant(await variant('cloudflare-worker/src/services/interviewSessions.ts',[["DELETE FROM meeting_bots WHERE session_id = ?","DELETE FROM meeting_bots WHERE 0 AND session_id = ?"]]))})],
  ];
  for(const [name,scenario,change] of mutations){await scenario(defaults);const mutated={...defaults,...await change()};await assert.rejects(()=>scenario(mutated),{name:'AssertionError'},name);await scenario(defaults);}
});
