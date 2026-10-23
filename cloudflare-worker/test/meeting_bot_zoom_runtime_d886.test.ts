/** B8: stored-run Zoom bootstrap, entirely synthetic provider responses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { jwtVerify } from 'jose';
import { Hono } from 'hono';
import { fixture,seed,mig,FOUNDER } from './_call_audio_fixture.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { botRow } from '../src/services/meetingBots.ts';
import { zoomRuntimeCredentials } from '../src/services/meetingBotZoom.ts';
import { MeetingBotRun } from '../src/durable-objects/meeting-bot-run.ts';
import callbacks from '../src/routes/meeting_bot_callbacks.ts';
import { runtimeHeaders,runtimeKey } from '../src/services/meetingBotRuntime.ts';
const UID='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002';
const MASTER='synthetic-runtime-master-secret-0123456789',SDK='synthetic-sdk-credential-01234567890123456789';
const ACCESS='synthetic-founder-access',OBF='synthetic-join-token';
async function world(){
  const w=fixture();w.db.exec(mig('531_meeting_bots.sql'));w.db.exec(mig('532_meeting_bot_participants.sql'));
  w.db.exec(tableFromBaseline(readFileSync('cloudflare-worker/sql/schema_baseline.sql','utf8'),'integrations'));
  const session=seed(w,{kind:'recorder',chunks:0,ageDays:0});
  w.env.KEK_PII='k'.repeat(48);
  const enc=await encryptCredentials(w.env,'fixture-zoom',{access_token:ACCESS,refresh_token:'synthetic-refresh',expires_at:Date.now()+3600_000} as any);
  w.db.prepare("INSERT INTO integrations(uid,user_id,provider_key,status,auth_type,credentials_enc) VALUES('fixture-zoom',2,'zoom','active','oauth2',?)").run(enc);
  const url=await encryptColumn(w.env,'meeting_bots','meeting_url_enc',UID,'https://unit.zoom.us/j/111111111?pwd=synthetic');
  w.db.prepare(`INSERT INTO meeting_bots(uid,user_id,project_id,session_id,platform,meeting_url_enc,status,scheduled_at,started_at,limit_minutes,cost_per_minute_microusd,rate_per_minute_microusd,created_at)
    VALUES(?,2,10,?,'zoom',?,'joining',0,?,30,100,125,?)`).run(UID,session,url,Date.now(),Date.now());
  Object.assign(w.env,{MEETING_BOT:'on',MEETING_BOT_SECRET:MASTER,MEETING_BOT_RUNTIME:{start:async()=>{},stop:async()=>{}},MEETING_BOT_ZOOM_CLIENT_ID:'synthetic-sdk-client',MEETING_BOT_ZOOM_CLIENT_SECRET:SDK});
  const rows=new Map<string,any>([['billing',[{end:Date.now()+120_000}]]]);
  const state={blockConcurrencyWhile:(f:any)=>f(),storage:{get:async(k:string)=>rows.get(k),put:async(k:string,v:any)=>rows.set(k,v),setAlarm:async()=>{}}};
  const supervisor=new MeetingBotRun(state as any,w.env);
  w.env.MEETING_BOT_RUN={idFromName:(s:string)=>s,get:()=>({fetch:(r:Request)=>supervisor.fetch(r)})} as any;
  return {...w,session,rows,run:(await botRow(w.env,UID))!};
}
async function scenario(fn=zoomRuntimeCredentials){
  const w=await world(),original=fetch;let calls=0,mode='ok';
  globalThis.fetch=(async(input:any,init:any)=>{
    calls++;const url=new URL(typeof input==='string'?input:input.url);
    assert.equal(url.origin,'https://api.zoom.us');assert.equal(url.searchParams.get('meeting_id'),'111111111');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+ACCESS);
    if(mode==='withdraw')w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();
    return Response.json(mode==='refuse'?{}:{token:OBF},{status:mode==='refuse'?400:200});
  }) as typeof fetch;
  try{
    const before=w.db.prepare('SELECT total_changes() n').get()!.n;
    const result=await fn(w.env,w.run);assert.equal(result.token,OBF);
    const {payload}=await jwtVerify(result.sdk_jwt,new TextEncoder().encode(SDK),{algorithms:['HS256']});
    assert.equal(payload.appKey,'synthetic-sdk-client');assert.equal(payload.mn,'111111111');assert.equal(payload.role,0);
    assert.equal(Number(payload.exp)-Number(payload.iat),7200);assert.equal(payload.tokenExp,payload.exp);
    assert.equal(w.db.prepare('SELECT total_changes() n').get()!.n,before);
    mode='refuse';const waiting=await fn(w.env,w.run);assert.equal(waiting.waitingForHost,true);assert.equal(waiting.token,undefined);
    mode='ok';let count=calls;
    await assert.rejects(()=>fn(w.env,{...w.run,user_id:FOUNDER+1}));assert.equal(calls,count);
    await assert.rejects(()=>fn(w.env,{...w.run,status:'done'}));assert.equal(calls,count);
    w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();
    await assert.rejects(()=>fn(w.env,w.run));assert.equal(calls,count);
    w.db.prepare("UPDATE interview_sessions SET consent_status='given'").run();mode='withdraw';
    await assert.rejects(()=>fn(w.env,w.run));
  }finally{globalThis.fetch=original;w.db.close();}
}
test('B8 Zoom bootstrap binds tokens to the founder/stored meeting and rechecks consent after the provider',()=>scenario());

test('B8 the authenticated supervisor heartbeat renews the private host with its paid lease',async()=>{
  const w=await world(),renewals:any[]=[];
  w.env.MEETING_BOT_RUNTIME!.heartbeat=async lease=>{renewals.push(lease);};
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const path=`/api/meeting-bots/${UID}/events`,raw=JSON.stringify({seq:1,type:'heartbeat'});
  try{
    const response=await app.fetch(new Request('https://worker.example.test'+path,{method:'POST',body:raw,headers:await runtimeHeaders(await runtimeKey(MASTER,UID),path,raw)}),w.env);
    assert.equal(response.status,200);assert.deepEqual(renewals,[{uid:UID,deadline_at:w.run.started_at!+1_800_000,budget_deadline_at:w.rows.get('billing')[0].end}]);
  }finally{w.db.close();}
});

test('B8 Zoom ingress authenticates run scope, forbids identity overrides, and throttles mints durably',async()=>{
  const w=await world(),original=fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json({token:OBF});}) as typeof fetch;
  const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
  const call=async(uid=UID,raw='{}',keyUid=uid)=>{
    const path=`/api/meeting-bots/${uid}/zoom-credentials`;
    return app.fetch(new Request('https://worker.example.test'+path,{method:'POST',body:raw,headers:await runtimeHeaders(await runtimeKey(MASTER,keyUid),path,raw)}),w.env);
  };
  try{
    assert.equal((await call(OTHER,'{}',UID)).status,401);assert.equal(calls,0);
    assert.equal((await call(UID,'{"user_id":3}')).status,400);assert.equal(calls,0);
    const response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    const result=await response.json();assert.equal(result.token,OBF);assert.ok(result.sdk_jwt);assert.equal(calls,1);
    assert.equal((await call()).status,429);assert.equal(calls,1);
    w.rows.delete('credentials_requested_at');w.db.prepare("UPDATE interview_sessions SET consent_status='declined'").run();
    assert.equal((await call()).status,403);assert.equal(calls,1);
    w.db.prepare("UPDATE interview_sessions SET consent_status='given'").run();w.rows.set('billing',[{end:Date.now()-1}]);
    assert.equal((await call()).status,403);assert.equal(calls,1);
  }finally{globalThis.fetch=original;w.db.close();}
});

test('B8 bootstrap withholds credentials after late authority, lease or rollout revocation',async()=>{
  const original=fetch;
  for(const mode of ['authority','lease','rollout']){
    const w=await world();
    globalThis.fetch=(async()=>{
      if(mode==='authority')w.db.prepare('UPDATE users SET jwt_min_iat=? WHERE id=2').run(Math.floor(Date.now()/1000)+1);
      if(mode==='lease')w.rows.set('billing',[{end:Date.now()-1}]);
      if(mode==='rollout')w.env.MEETING_BOT='off';
      return Response.json({token:OBF});
    }) as typeof fetch;
    try{
      const app=new Hono();app.route('/api/meeting-bots',callbacks as any);
      const path=`/api/meeting-bots/${UID}/zoom-credentials`,raw='{}';
      const response=await app.fetch(new Request('https://worker.example.test'+path,{method:'POST',body:raw,headers:await runtimeHeaders(await runtimeKey(MASTER,UID),path,raw)}),w.env);
      assert.equal(response.status,403);const body=await response.json();assert.equal(body.sdk_jwt,undefined);assert.equal(body.token,undefined);
    }finally{globalThis.fetch=original;w.db.close();}
  }
});

const file=new URL('../src/services/meetingBotZoom.ts',import.meta.url),source=readFileSync(file,'utf8');
for(const [i,[before,after]] of [
  ['await botSession(env,run);',''],['zoomConnection(env,run.user_id)','zoomConnection(env,run.user_id+1)'],
  ['mintObfToken(env,connection,meeting)','mintObfToken(env,connection,\'999999999\')'],['role:0','role:1'],['iat+7200','iat+1'],
].entries())test('B8 Zoom credential mutation '+i+' is caught',async()=>{
  await scenario();assert.ok(source.includes(before));
  const js=stripTypeScriptTypes(source.replaceAll(before,after),{mode:'strip'})
    .replace(/from '(\.[^']+)'/g,(_m,s)=>`from '${new URL(s+'.ts',file).href}'`)
    .replace("from 'jose'",`from '${new URL('../node_modules/jose/dist/webapi/index.js',import.meta.url).href}'`);
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  await assert.rejects(()=>scenario(mutant.zoomRuntimeCredentials));await scenario();
});
