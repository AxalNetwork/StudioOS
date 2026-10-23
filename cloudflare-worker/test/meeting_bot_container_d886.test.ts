/** B8: synthetic container/network only; no provider or production calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac, randomBytes } from 'node:crypto';
import { MeetingBotContainer } from '../src/durable-objects/meeting-bot-container.ts';
import { meetingBotRuntime, runtimeKey, runtimeHeaders } from '../src/services/meetingBotRuntime.ts';
import { validBotCallback } from '../src/durable-objects/meeting-bot-run.ts';
import { botConfigured } from '../src/services/meetingBots.ts';
import { RuntimeHost } from '../../meeting-bot/src/runtime.ts';
import { FakeAdapter } from '../../meeting-bot/src/fakeAdapter.ts';
import type { Env } from '../src/types.ts';

const UID='00000000-0000-4000-8000-000000000001',OTHER='00000000-0000-4000-8000-000000000002';
const SECRET=randomBytes(32).toString('hex');
test('B8 incomplete container/Zoom configuration is refused before dispatch can reserve a budget',()=>{
  const env={MEETING_BOT:'on',MEETING_BOT_SECRET:SECRET,APP_URL:'https://worker.example.test',MEETING_BOT_RUN:{},MEETING_BOT_CONTAINER:{}} as Env;
  assert.equal(botConfigured(env,'google_meet'),true);assert.equal(botConfigured(env,'teams'),true);assert.equal(botConfigured(env,'zoom'),false);
  env.MEETING_BOT_ZOOM_CLIENT_ID='synthetic-sdk-client';env.MEETING_BOT_ZOOM_CLIENT_SECRET='synthetic-sdk-secret';assert.equal(botConfigured(env,'zoom'),true);
  env.APP_URL='http://worker.example.test';assert.equal(botConfigured(env,'google_meet'),false);
});
const input=()=>({uid:UID,platform:'google_meet',meeting_url:'https://meet.google.com/abc-defg-hij',limit_minutes:30,
  deadline_at:Date.now()+1_800_000,budget_deadline_at:Date.now()+120_000,notice:'Synthetic notice',venture_name:null});
type Host=typeof MeetingBotContainer;
function harness(Class:Host=MeetingBotContainer) {
  const rows=new Map<string,any>(),starts:ContainerStartupOptions[]=[],commands:Request[]=[],signals:number[]=[],timeouts:number[]=[];
  let alarm=0,destroys=0,refuse=false,crash=false,transient=0;
  let forward: ((r:Request)=>Promise<Response>)|undefined;
  const container={running:false,images:{runtime:'registry.cloudflare.com/synthetic/runtime@sha256:'+'a'.repeat(64)},
    start(opts:ContainerStartupOptions){starts.push(opts);this.running=true;if(crash)throw new Error('SYNTHETIC_PRIVATE_ERROR');},
    async destroy(){destroys++;this.running=false;},signal(n:number){signals.push(n);},monitor:async()=>{},
    async setInactivityTimeout(ms:number){timeouts.push(ms);},getTcpPort(port:number){assert.equal(port,8080);return {fetch:async(r:Request)=>{
      commands.push(r.clone());if(transient-->0)throw new Error('cold');return forward?forward(r):Response.json({}, {status:refuse?503:202});
    }};}};
  const state={container,waitUntil:()=>{},blockConcurrencyWhile:(f:any)=>f(),storage:{
    get:async(k:string)=>structuredClone(rows.get(k)),put:async(k:string,v:any)=>rows.set(k,structuredClone(v)),setAlarm:async(t:number)=>{alarm=t;}}};
  const env={APP_URL:'https://worker.example.test',MEETING_BOT_SECRET:SECRET} as Env;
  let host=new Class(state as any,env);
  return {rows,starts,commands,signals,timeouts,container,env,state,
    get alarm(){return alarm;},get destroys(){return destroys;},
    refuse(){refuse=true;},crash(){crash=true;},cold(n:number){transient=n;},forward(fn:(r:Request)=>Promise<Response>){forward=fn;},
    revive(){host=new Class(state as any,env);},alarmCall:()=>host.alarm(),
    call:(path:string,body:any=input(),method='POST')=>host.fetch(new Request('https://container.internal'+path,{method,...(method==='POST'?{body:JSON.stringify(body)}:{})})),
  };
}
const cases:Record<string,(Class:Host)=>Promise<void>>={
  async 'private start uses standard-2 and a per-run key, and stores no command data'(Class){
    const h=harness(Class),run=input();
    assert.equal((await h.call('/start',run)).status,202);
    assert.equal(h.starts.length,1);assert.equal(h.starts[0].instance,'standard-2');assert.equal(h.starts[0].enableInternet,true);assert.equal(h.starts[0].image,h.container.images.runtime);
    assert.deepEqual(h.starts[0].env,{MEETING_BOT_SECRET:await runtimeKey(SECRET,UID),MEETING_BOT_CALLBACK_ORIGIN:'https://worker.example.test',PORT:'8080'});
    assert.notEqual(h.starts[0].env!.MEETING_BOT_SECRET,SECRET);
    const stored=JSON.stringify([...h.rows]);
    for(const value of [run.meeting_url,run.notice,SECRET,h.starts[0].env!.MEETING_BOT_SECRET])assert.equal(stored.includes(value),false);
    assert.equal(h.commands.length,1);assert.deepEqual(await h.commands[0].clone().json(),run);
    const ts=h.commands[0].headers.get('x-meeting-bot-timestamp');
    const expected=createHmac('sha256',await runtimeKey(SECRET,UID)).update(`v1:${ts}:POST:/start:${JSON.stringify(run)}`).digest('hex');
    assert.equal(h.commands[0].headers.get('x-meeting-bot-signature'),expected);
    assert.equal(h.alarm,run.budget_deadline_at+30_000);assert.equal(h.timeouts[0],120_000);
  },
  async 'start is idempotent across eviction and changed commands or crashed processes cannot restart'(Class){
    const h=harness(Class),run=input();await h.call('/start',run);h.revive();
    assert.equal((await h.call('/start',run)).status,200);assert.equal(h.starts.length,1);
    assert.equal((await h.call('/start',{...run,notice:'Changed'})).status,409);
    assert.equal((await h.call('/start',{...run,uid:OTHER})).status,409);
    h.container.running=false;assert.equal((await h.call('/start',run)).status,409);assert.equal(h.starts.length,1);
  },
  async 'Stop tombstones survive reconstruction and allow only a bounded final drain'(Class){
    const h=harness(Class),run=input();await h.call('/start',run);await h.call('/stop',{uid:UID});h.revive();
    assert.deepEqual(h.signals,[15]);assert.equal((await h.call('/start',run)).status,409);
    assert.equal(new URL(h.commands.at(-1)!.url).pathname,'/stop');
    assert.ok(h.alarm<=Date.now()+30_000);await h.alarmCall();assert.equal(h.destroys,1);
    const early=harness(Class);await early.call('/stop',{uid:UID});early.revive();
    assert.equal((await early.call('/start',run)).status,409);assert.equal(early.starts.length,0);
  },
  async 'only a funded monotonic heartbeat renews the host and an expired alarm kills it'(Class){
    const h=harness(Class),run=input();await h.call('/start',run);
    const lease={uid:UID,deadline_at:run.deadline_at,budget_deadline_at:run.budget_deadline_at+120_000};
    assert.equal((await h.call('/heartbeat',lease)).status,200);assert.equal(h.alarm,lease.budget_deadline_at+30_000);
    assert.equal((await h.call('/heartbeat',{...lease,budget_deadline_at:run.budget_deadline_at})).status,400);
    assert.equal((await h.call('/heartbeat',{...lease,deadline_at:run.deadline_at+1})).status,400);
    assert.equal((await h.call('/heartbeat',{...lease,budget_deadline_at:run.deadline_at+1})).status,400);
    const clock=Date.now;Date.now=()=>lease.budget_deadline_at+30_001;
    try {await h.alarmCall();assert.equal(h.destroys,1);}finally{Date.now=clock;}
  },
  async 'refused or failed startup destroys the process and cannot leak provider errors'(Class){
    for(const kind of ['refuse','crash'] as const){const h=harness(Class);h[kind]();
      const response=await h.call('/start',input());assert.equal(response.status,503);assert.equal(h.destroys,1);
      assert.equal((await response.text()).includes('SYNTHETIC_PRIVATE'),false);assert.equal(h.rows.get('lease').stopped,true);
    }
    const h=harness(Class);h.cold(1);assert.equal((await h.call('/start',input())).status,202);assert.equal(h.commands.length,2);
  },
  async 'invalid startup bounds and an insecure callback origin refuse before boot'(Class){
    for(const change of [{uid:'../other'},{deadline_at:Date.now()-1},{limit_minutes:1},{budget_deadline_at:Date.now()+7_300_000},{notice:undefined},{meeting_url:'x'.repeat(2049)}]){
      const h=harness(Class);assert.equal((await h.call('/start',{...input(),...change})).status,400);assert.equal(h.starts.length,0);
    }
    const h=harness(Class);h.env.APP_URL='http://worker.example.test';assert.equal((await h.call('/start',input())).status,503);assert.equal(h.starts.length,0);
  },
};
for(const [name,scenario] of Object.entries(cases))test('B8 '+name,()=>scenario(MeetingBotContainer));

test('B8 derived callbacks cannot authenticate another run or another path',async()=>{
  const key=await runtimeKey(SECRET,UID),path=`/api/meeting-bots/${UID}/events`,raw='{"seq":1,"type":"heartbeat"}';
  assert.equal(key,createHmac('sha256',SECRET).update(`meeting-bot-runtime:v1:${UID}`).digest('hex'));
  const headers=await runtimeHeaders(key,path,raw),env={MEETING_BOT_SECRET:SECRET} as Env;
  assert.equal(await validBotCallback(env,new Request('https://worker.example.test'+path,{method:'POST',headers}),raw),true);
  const otherPath=`/api/meeting-bots/${OTHER}/events`;
  const otherHeaders=await runtimeHeaders(key,otherPath,raw);
  assert.equal(await validBotCallback(env,new Request('https://worker.example.test'+otherPath,{method:'POST',headers:otherHeaders}),raw),false);
  assert.notEqual(await runtimeKey(SECRET,UID),await runtimeKey(SECRET,OTHER));
});

test('B8 binding adapter routes start, heartbeat and Stop to one jurisdiction-scoped object',async()=>{
  const h=harness(),names:string[]=[],jurisdictions:string[]=[];
  const ns={idFromName:(name:string)=>{names.push(name);return name;},get:()=>({fetch:async(r:Request)=>h.call(new URL(r.url).pathname,await r.json())})};
  const env={...h.env,BRANCH_DO_JURISDICTION:'eu',MEETING_BOT_CONTAINER:{jurisdiction:(j:string)=>{jurisdictions.push(j);return ns;}}} as unknown as Env;
  const runtime=meetingBotRuntime(env),run=input();await runtime.start(run);await runtime.heartbeat!({uid:UID,deadline_at:run.deadline_at,budget_deadline_at:run.budget_deadline_at});
  assert.equal(h.rows.get('lease').stopped,false);assert.equal(h.container.running,true);
  await runtime.stop({uid:UID});assert.equal(h.rows.get('lease').stopped,true);
  assert.deepEqual(names,[UID,UID,UID]);assert.deepEqual(jurisdictions,['eu']);assert.equal(h.starts.length,1);
  await assert.rejects(()=>runtime.start({...run,uid:'../other'}),/runtime_unavailable/);
});

test('B8 private host drives the real B2 signed command server and releases its adapter',async()=>{
  const h=harness(),adapter=new FakeAdapter({openDoor:true});adapter.arrive('fixture','Fixture');
  const statuses:any[]=[];const run=input();
  const server=new RuntimeHost({secret:await runtimeKey(SECRET,UID),callbackOrigin:'https://worker.example.test',notice:()=>run.notice,
    adapter:async()=>adapter,transport:()=>({status:async r=>{statuses.push(r);return run.budget_deadline_at;},heartbeat:async()=>run.budget_deadline_at,events:async()=>{},putChunk:async()=>{}})});
  h.forward(r=>server.fetch(r));
  try {
    assert.equal((await h.call('/start',run)).status,202);
    await new Promise(resolve=>setTimeout(resolve,10));assert.ok(statuses.some(s=>s.state==='recording'));
    assert.equal((await h.call('/stop',{uid:UID})).status,200);await server.shutdown();assert.equal(adapter.listening,0);assert.equal(adapter.leaveCalls,1);
  }finally{await server.shutdown();}
});

const path=new URL('../src/durable-objects/meeting-bot-container.ts',import.meta.url),source=readFileSync(path,'utf8');
const mutants=[['instance:\'standard-2\'','instance:\'lite\''],['env:{MEETING_BOT_SECRET:key','env:{MEETING_BOT_SECRET:this.env.MEETING_BOT_SECRET!'],
  ['lease.fingerprint!==fingerprint','false'],['if (lease?.stopped)','if (false)'],['lease.started && container.running','lease.started'],
  ['body.budget_deadline_at<lease.funded','false'],['body.deadline_at!==lease.deadline','false'],['body.budget_deadline_at>lease.deadline','false'],
  ['instance:\'standard-2\',enableInternet:true','instance:\'standard-2\',enableInternet:false'],
  ['await this.destroy(lease); return reply(503','return reply(503'],['container.signal(15)','container.signal(9)']];
for(const [index,[before,after]] of mutants.entries())test('B8 host mutation '+index+' is caught',async()=>{
  for(const scenario of Object.values(cases))await scenario(MeetingBotContainer);
  assert.ok(source.includes(before));
  const js=stripTypeScriptTypes(source.replace(before,after),{mode:'strip'}).replace(/from '(\.[^']+)'/g,(_m,s)=>`from '${new URL(s+'.ts',path).href}'`);
  const {MeetingBotContainer:Mutant}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  let caught=false;for(const scenario of Object.values(cases)){try{await scenario(Mutant);}catch{caught=true;break;}}
  assert.equal(caught,true);
  for(const scenario of Object.values(cases))await scenario(MeetingBotContainer);
});
