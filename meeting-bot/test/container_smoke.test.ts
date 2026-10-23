/** Runs inside the image build too. Fake adapter only; no provider/network calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeHost } from '../src/runtime.ts';
import { signRequest } from '../src/callback.ts';
import { FakeAdapter } from '../src/fakeAdapter.ts';
import type { CallbackTransport, StatusReport } from '../src/types.ts';

const UID='00000000-0000-4000-8000-000000000001',SECRET='synthetic-runtime-only-secret-0123456789';
async function command(host:RuntimeHost,path:string,payload:object,secret=SECRET){
  const raw=JSON.stringify(payload),headers={'content-type':'application/json',...await signRequest(secret,path,raw,Date.now())};
  return host.fetch(new Request('http://runtime.internal'+path,{method:'POST',headers,body:raw}));
}
const run=()=>({uid:UID,platform:'google_meet',meeting_url:'https://meet.google.com/abc-defg-hij',limit_minutes:30,deadline_at:Date.now()+1_800_000,budget_deadline_at:Date.now()+120_000});

test('container command smoke: authenticated, idempotent, promptly acknowledged start and stop',async()=>{
  let release:(value:FakeAdapter)=>void=()=>{},calls=0;const statuses:StatusReport[]=[];
  const adapter=new FakeAdapter({openDoor:true});adapter.arrive('synthetic-person','Synthetic');
  const transport:CallbackTransport={async status(report){statuses.push(report);return Date.now()+120_000;},async heartbeat(){return Date.now()+120_000;},async events(){},async putChunk(){}};
  const host=new RuntimeHost({secret:SECRET,callbackOrigin:'https://axal.vc',notice:()=> 'Synthetic test notice',transport:()=>transport,
    adapter:async()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
  const input=run();
  assert.equal((await command(host,'/start',input,'different-secret')).status,401);assert.equal(calls,0);
  const response=await command(host,'/start',input);assert.equal(response.status,202);
  // The adapter is still pending; the control-plane RPC has already returned.
  assert.equal(statuses.length,0);assert.equal((await command(host,'/start',input)).status,200);assert.equal(calls,1);
  assert.equal((await command(host,'/start',{...input,meeting_url:'https://meet.google.com/xxx-yyyy-zzz'})).status,409);
  release(adapter);await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(statuses.some(s=>s.state==='recording'));
  assert.equal((await command(host,'/stop',{uid:UID})).status,200);
  await host.shutdown();assert.equal(host.running,false);assert.equal(adapter.listening,0);assert.equal(adapter.leaveCalls,1);
});

test('container refuses unpublished notice, invalid lease, stale signatures and oversized commands before joining',async()=>{
  let calls=0;
  const host=new RuntimeHost({secret:SECRET,callbackOrigin:'https://axal.vc',adapter:async()=>{calls++;return new FakeAdapter();}});
  assert.equal((await command(host,'/start',run())).status,503);assert.equal(calls,0);
  const raw=JSON.stringify(run());
  const stale=await signRequest(SECRET,'/start',raw,Date.now()-301_000);
  assert.equal((await host.fetch(new Request('http://runtime.internal/start',{method:'POST',headers:stale,body:raw}))).status,401);
  assert.equal((await command(host,'/start',{...run(),padding:'x'.repeat(17000)})).status,413);assert.equal(calls,0);
  assert.throws(()=>new RuntimeHost({secret:SECRET,callbackOrigin:'http://axal.vc',adapter:async()=>new FakeAdapter()}));
  const allowed=new RuntimeHost({secret:SECRET,callbackOrigin:'https://axal.vc',notice:()=> 'Synthetic notice',adapter:async()=>{calls++;return new FakeAdapter();}});
  assert.equal((await command(allowed,'/start',{...run(),budget_deadline_at:Date.now()-1})).status,503);assert.equal(calls,0);
});
