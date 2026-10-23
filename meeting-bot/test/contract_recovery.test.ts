/** D886 B2: uncertainty replays one event, never replaces its payload or duplicates audio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { httpTransport } from '../src/callback.ts';
import { encodeWav } from '../src/wav.ts';
import { EventBatcher } from '../src/events.ts';
import { runBot } from '../src/lifecycle.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import { FakeClock, StubCallback, tone, settle } from './_harness.ts';
import { FREE_LIMIT_MS } from '../src/constants.ts';

const UID='00000000-0000-4000-8000-000000000001',BASE=`https://axal.vc/api/meeting-bots/${UID}/`,KEY='synthetic-only-contract-key-0123456789',NOW=1_700_000_000_000;
const client=(fetch:typeof globalThis.fetch)=>httpTransport({baseUrl:BASE,runId:UID,key:KEY,fetch,now:()=>NOW});

test('a batch resumes after the accepted reply is lost; no confirmed prefix is sent again',async()=>{
  const seen:any[]=[],accepted=new Map<number,string>();let lose=true;
  const transport=client((async(_url,init)=>{
    const raw=String(init?.body),event=JSON.parse(raw);seen.push(event);
    if(accepted.has(event.seq)){assert.equal(accepted.get(event.seq),raw);return Response.json({duplicate:true});}
    assert.equal(event.seq,accepted.size+1);accepted.set(event.seq,raw);
    if(event.seq===2&&lose){lose=false;throw new Error('synthetic_disconnect');}
    return Response.json({budget_deadline_at:NOW+120_000});
  }) as typeof fetch);
  const events=[{n:1,type:'speaker' as const,participant_id:'synthetic',at_ms:0},{n:2,type:'speaker' as const,participant_id:null,at_ms:1},{n:3,type:'speaker' as const,participant_id:'synthetic',at_ms:2}];
  await assert.rejects(()=>transport.events(events));await transport.events(events);
  assert.deepEqual(seen.map(e=>e.seq),[1,2,2,3]);assert.equal(accepted.size,3);
});

test('uncertain status is acknowledged before concurrent heartbeat/chunk payloads get later sequence numbers',async()=>{
  const seen:any[]=[],accepted=new Map<number,string>();let lose=true;
  const transport=client((async(_url,init)=>{
    const raw=String(init?.body),event=JSON.parse(raw);seen.push(event);
    if(accepted.has(event.seq)){assert.equal(raw,accepted.get(event.seq));return Response.json({duplicate:true});}
    assert.equal(event.seq,accepted.size+1);accepted.set(event.seq,raw);
    if(lose){lose=false;throw new Error('synthetic_disconnect');}
    return Response.json({budget_deadline_at:NOW+120_000});
  }) as typeof fetch);
  await assert.rejects(()=>transport.status({state:'recording'}));
  await Promise.all([transport.status({state:'recording'}),transport.heartbeat()]);
  assert.deepEqual(seen.map(e=>[e.seq,e.type]),[[1,'status'],[1,'status'],[2,'heartbeat']]);
  await transport.status({state:'left',reason:'call_ended'});
  assert.equal(seen.at(-1).status,'processing');
});

test('a lost PUT acknowledgement renews the same manifest and accepts only B1 chunk_already_uploaded',async()=>{
  const seen:any[]=[],wav=encodeWav(tone(1600));let stored=false,puts=0;
  const transport=client((async(_url,init)=>{
    if(init?.method==='PUT'){puts++;stored=true;throw new Error('synthetic_disconnect');}
    const event=JSON.parse(String(init?.body));seen.push(event);
    if(stored)return Response.json({code:'chunk_already_uploaded'},{status:409});
    return Response.json({upload_path:`/api/meeting-bots/${UID}/chunks/7?token=synthetic`,expires_at:NOW+60_000});
  }) as typeof fetch);
  await assert.rejects(()=>transport.putChunk(7,wav,60_000));await transport.putChunk(7,wav,60_000);
  assert.equal(puts,1);assert.deepEqual(seen.map(e=>e.seq),[1,1]);assert.equal(seen[0].start_ms,60_000);assert.deepEqual(seen[0],seen[1]);
  const denied=client((async()=>Response.json({code:'another_conflict'},{status:409})) as typeof fetch);
  await assert.rejects(()=>denied.putChunk(7,wav),{message:'callback_409'});
});

test('roster snapshots preserve rename/join clocks and prior snapshots; silence is explicit',async()=>{
  const clock=new FakeClock(),callback=new StubCallback(),events=new EventBatcher(callback,clock,()=>{},clock.now());
  events.roster({kind:'join',key:'p1',name:'Synthetic A'});await clock.advance(10);
  events.roster({kind:'join',key:'p1',name:'Synthetic renamed'});events.speaker({key:'p1'});await clock.advance(10);
  events.roster({kind:'leave',key:'p1',name:'Synthetic renamed'});events.speaker({key:null});
  await events.flush();
  const snapshots=callback.allEvents.filter(e=>e.type==='roster');
  assert.deepEqual(snapshots.map(e=>e.participants[0]),[
    {id:'p1',name:'Synthetic A',joined_ms:0,left_ms:null},
    {id:'p1',name:'Synthetic renamed',joined_ms:0,left_ms:null},
    {id:'p1',name:'Synthetic renamed',joined_ms:0,left_ms:20},
  ]);
  assert.deepEqual(callback.allEvents.filter(e=>e.type==='speaker').map(e=>e.participant_id),['p1',null]);
});

const config=(clock:FakeClock,budget=120_000)=>({runId:UID,platform:'google_meet' as const,meetingUrl:'https://meet.google.com/abc-defg-hij',notice:'Synthetic notice',limitMs:FREE_LIMIT_MS,deadlineAt:clock.now()+FREE_LIMIT_MS,budgetDeadlineAt:clock.now()+budget});
test('expired lease stops a hung join and waiting room, with no audio or notice',async()=>{
  for(const hung of [false,true]){
    const clock=new FakeClock(),callback=new StubCallback(),adapter=new FakeAdapter();
    if(hung)adapter.join=async()=>new Promise(()=>{});
    const run=runBot(config(clock,1000),{clock,adapter,transport:callback});
    await clock.advance(1000);const result=await clock.until(run);
    assert.equal(result.reason,'tokens');assert.equal(adapter.leaveCalls,1);assert.equal(adapter.chat.length,0);assert.equal(adapter.listening,0);
  }
});

test('renewed leases extend capture; stale heartbeats never authorise recording after the funded boundary',async()=>{
  const clock=new FakeClock(),callback=new StubCallback(),adapter=new FakeAdapter({openDoor:true});adapter.arrive('p1','Synthetic');
  callback.leaseDeadline=clock.now()+40_000;
  const run=runBot(config(clock,20_000),{clock,adapter,transport:callback});
  await clock.advance(20_001);let done=false;run.then(()=>{done=true;});await settle();assert.equal(done,false);
  callback.leaseDeadline=clock.now()-1;await clock.advance(19_999);
  adapter.say(tone(32000));const result=await clock.until(run);
  assert.equal(result.reason,'tokens');assert.equal(callback.chunks.size,0);assert.equal(adapter.listening,0);
});

test('SIGTERM signal flushes captured tail once, closes subscriptions and reports interrupted',async()=>{
  const clock=new FakeClock(),callback=new StubCallback(),adapter=new FakeAdapter({openDoor:true}),shutdown=new AbortController();
  adapter.arrive('p1','Synthetic');const run=runBot(config(clock),{clock,adapter,transport:callback,shutdown:shutdown.signal});
  await clock.advance(1);adapter.say(tone(1600));shutdown.abort();adapter.say(tone(1600));
  const result=await clock.until(run);
  assert.equal(result.reason,'interrupted');assert.equal(callback.chunks.size,1);assert.equal(callback.chunks.get(0)?.byteLength,3244);assert.equal(adapter.listening,0);
});

test('a permanently failed upload has a bounded flush and never reports a complete recording',async()=>{
  const clock=new FakeClock(),callback=new StubCallback(),adapter=new FakeAdapter({openDoor:true});adapter.arrive('p1','Synthetic');
  callback.failChunk.set(0,1000);const run=runBot(config(clock),{clock,adapter,transport:callback});
  await clock.advance(1);adapter.say(tone(1600));adapter.end();const start=clock.now();
  const result=await clock.until(run);assert.equal(result.state,'failed');assert.equal(result.code,'processing_failed');assert.ok(clock.now()-start<=21_000);assert.equal(adapter.listening,0);
});
