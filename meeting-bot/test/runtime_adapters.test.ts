/** B8 adapter selection/credential transport without browsers, native code or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { runtimeAdapter } from '../src/runtimeAdapters.ts';
import type { RuntimeAdapterContext } from '../src/runtime.ts';
import type { ZoomSdkBridge } from '../src/zoomAdapter.ts';
const uid='00000000-0000-4000-8000-000000000001',secret=randomBytes(32).toString('hex');
const transport={status:async()=>{},heartbeat:async()=>Date.now()+120_000,events:async()=>{},putChunk:async()=>{}};
const context:RuntimeAdapterContext={uid,secret,callbackOrigin:'https://worker.example.test',transport};
test('packaged browser selection includes Teams and Meet and closes each owned browser',async()=>{
  for(const platform of ['google_meet','teams'] as const){
    let closed=0;
    const browser={newPage:async()=>({evaluate:async()=>{}}),close:async()=>{closed++;}};
    const adapter=await runtimeAdapter(platform,context,{launch:async()=>browser as any});
    assert.equal(adapter.platform,platform);await adapter.leave();await adapter.leave();assert.equal(closed,1);
  }
});
test('Zoom uses only run-scoped signed bootstrap and hands fresh OBF to the native bridge',async()=>{
  let jwt='',joined:any,calls=0;
  const sdk={join:async(i:any)=>{joined=i;},leave:async()=>{}} as unknown as ZoomSdkBridge;
  const adapter=await runtimeAdapter('zoom',context,{zoom:value=>{jwt=value;return sdk;},fetch:(async(input:any,init:any)=>{
    calls++;const url=new URL(input);assert.equal(url.href,`https://worker.example.test/api/meeting-bots/${uid}/zoom-credentials`);
    assert.equal(init.body,'{}');assert.equal(init.redirect,'error');
    const ts=init.headers['x-meeting-bot-timestamp'];
    assert.equal(init.headers['x-meeting-bot-signature'],createHmac('sha256',secret).update(`v1:${ts}:POST:${url.pathname}:{}`).digest('hex'));
    return Response.json({sdk_jwt:'synthetic-sdk-jwt-'.repeat(3),token:'synthetic-obf'});
  }) as typeof fetch});
  await adapter.join({url:'https://unit.zoom.us/wc/join/111111111?pwd=synthetic',botName:'Eadwyn AI',signal:new AbortController().signal});
  assert.equal(jwt,'synthetic-sdk-jwt-'.repeat(3));assert.equal(calls,1);assert.equal(joined.meetingId,'111111111');assert.equal(joined.obfToken,'synthetic-obf');
  await adapter.leave();
});
test('a failed credential request creates no native sidecar and keeps the response private',async()=>{
  let native=0;
  for(const [status,jwt,token] of [[403,'synthetic-sdk-jwt-'.repeat(3),'fixture'],[200,'','fixture'],[200,'synthetic-sdk-jwt-'.repeat(3),'x'.repeat(8193)]] as const)
    await assert.rejects(()=>runtimeAdapter('zoom',context,{zoom:()=>{native++;throw new Error('not reached');},fetch:(async()=>Response.json({sdk_jwt:jwt,token,message:'synthetic-private-provider'}, {status})) as typeof fetch}),{message:'obf_unavailable'});
  assert.equal(native,0);
});
