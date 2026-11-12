// D5671: provider authentication, strict metadata, isolation, durable episode replay and shared Slack transport failures.
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {normalizeCloudflare,receiveCloudflare} from '../../engineering-notifications/cloudflare-receiver-5671.mjs';
import {CloudflareDelivery} from '../../engineering-notifications/cloudflare-outbox-5671.mjs';
import {cloudflareTransport} from '../../engineering-notifications/cloudflare-transport-5671.mjs';
const now=Date.parse('2026-11-12T10:00:00Z'),secret='fixture-authentication-value-only-5671',id='a'.repeat(32),policy='b'.repeat(32);
const config={reviewed:true,accountId:id,policies:{[policy]:{script:'studioos-meeting-bot-preview',environment:'preview',summaryApproved:true,sourceScopeVerified:true,sensitivity:'operational',component:'runtime',alertType:'workers_observability_alert',phaseMap:{START:'firing',END:'recovery',INFO:'observation'}}}};
const payload=(phase='START',ts=now/1000)=>({account_id:id,policy_id:policy,alert_type:'workers_observability_alert',alert_correlation_id:'c'.repeat(32),alert_event:phase,ts,text:'<!channel> private transcript',data:{url:'https://private.example/?token=secret'}});
const event=(phase='START',ts=now/1000)=>normalizeCloudflare(payload(phase,ts),config,now+10000);
function fixture(){let clock=now,sent=[];const db=new DatabaseSync(':memory:'),sql={exec(q,...a){const r=db.prepare(q).all(...a);return{toArray:()=>r}}},transaction=fn=>{db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 const channel=id=>({id,private:true,enabled:true,retentionDays:90,publisher:'internal-bot'}),registry={schema:1,version:1,reviewedBy:'guillaumelauzier',approvedAt:new Date(now).toISOString(),purpose:'cloudflare-notifications',teamId:'TFIXTURE',slackConnect:false,recipientAccessVerified:true,channels:{health:{...channel('CHEALTH'),routeRole:'cloudflare-health'},activity:{...channel('CACTIVITY'),routeRole:'cloudflare-activity'},prs:{...channel('CPREVIEW'),routeRole:'cloudflare-preview'}}};
 const box=new CloudflareDelivery({sql,transaction,registry,now:()=>clock,jitter:()=>0,deliver:async r=>{sent.push(r);return{state:'acknowledged',receipt:{transport:'adapter',status:200,channel:r.channel.id,ts:`${1000+sent.length}.000001`}}}});
 return {db,sql,box,sent,set:v=>clock=v,drain:async()=>{for(let i=0;i<1000;i++){clock+=1000;await box.tick();if(box.nextWake()===null)return}throw Error('not drained')}};
}
test('auth, account and registered policy are required before durable acceptance; diagnostic content is absent',async()=>{
 let accepted=[];const request=(body=payload(),auth=secret)=>new Request('https://fixture/cf',{method:'POST',headers:{'cf-webhook-auth':auth,'content-type':'application/json'},body:JSON.stringify(body)}),options={secret,config,now:()=>now,accept:e=>accepted.push(e)};
 assert.equal((await receiveCloudflare(request(payload(),'wrong'),options)).status,401);assert.equal(accepted.length,0);
 assert.equal((await receiveCloudflare(request({...payload(),account_id:'d'.repeat(32)}),options)).status,422);
 assert.equal((await receiveCloudflare(request({text:'provider Save and Test'}),options)).status,422);
 assert.equal((await receiveCloudflare(request(),options)).status,202);assert.equal(accepted.length,1);assert.doesNotMatch(JSON.stringify(accepted),/channel|transcript|private\.example|token/);
 assert.equal((await receiveCloudflare(request(),{...options,accept:()=>{throw Error('disk')}})).status,503);
 assert.equal((await receiveCloudflare(request({...payload(),text:'x'.repeat(65000)}),options)).status,413);
});
test('preview never selects production; unregistered types and malformed states are rejected',async()=>{
 await assert.rejects(normalizeCloudflare(payload(),{...config,policies:{[policy]:{...config.policies[policy],environment:'prod'}}},now),/unapproved/);
 await assert.rejects(normalizeCloudflare({...payload(),alert_type:'unknown'},config,now),/unapproved/);
 await assert.rejects(normalizeCloudflare({...payload(),alert_event:'unknown'},config,now),/unknown/);
 await assert.rejects(normalizeCloudflare(payload('START',now/1000+301),config,now),/unknown/);
});
test('duplicates and reversed recovery retain one root and latest healthy update; every item has a digest receipt',async()=>{
 const f=fixture();try{const fire=await event(),recover=await event('END',now/1000+2);f.box.accept(recover);f.box.accept(fire);f.box.accept(fire);f.set(now+300001);await f.drain();
 assert.equal(f.box.summary().eligible,2);assert.equal(f.box.summary().unbatched,0);assert.ok(f.sent.every(x=>x.channel.id==='CPREVIEW'));
 assert.equal(f.sent.filter(x=>x.operation==='post'&&!x.threadTs&&x.text.includes('current state')).length,1);
 const updates=f.sent.filter(x=>x.operation==='update');assert.equal(updates.length,1);assert.match(updates[0].text,/recovery/);
 const rows=f.sql.exec('SELECT * FROM cf_events').toArray();for(const r of rows){const chunk=f.box.box.get(r.chunk_key);assert.equal(chunk.state,'acknowledged');assert.ok(chunk.items.includes(r.event_key))}
 assert.throws(()=>f.box.accept({...fire,script:'<!channel>'}),/invalid/);assert.throws(()=>f.box.accept({...fire,raw:'private'}),/refused/);
 }finally{f.db.close()}
});
test('large activity-only bursts are paged without top-level health pings and future flush has an alarm deadline',async()=>{
 const f=fixture();try{for(let i=0;i<120;i++){const e=await normalizeCloudflare({...payload('INFO'),alert_correlation_id:i.toString(16).padStart(32,'0')},config,now);f.box.accept(e)}
 assert.equal(f.box.nextWake(),now+300000);f.set(now+300001);await f.drain();assert.equal(f.box.summary().eligible,120);assert.equal(f.box.summary().unbatched,0);
 const texts=f.sent.filter(x=>x.text.includes('event:'));assert.ok(texts.length>1);assert.ok(texts.every(x=>x.text.length<8000));assert.ok(f.sent.every(x=>!x.text.includes('current state')));
 }finally{f.db.close()}
});
test('live Slack preflight rejects external or unknown sharing before any message request',async()=>{
 for(const shared of [true,undefined,false]){const calls=[];const send=cloudflareTransport({token:'fixture',fetchImpl:async(url,init)=>{const method=url.split('/').at(-1);calls.push(method);return Response.json(method==='auth.test'?{ok:true,team_id:'TFIXTURE'}:method==='conversations.info'?{ok:true,channel:{id:'CPREVIEW',is_private:true,is_member:true,is_ext_shared:shared}}:{ok:true,channel:'CPREVIEW',ts:'1234.000001'})}});
 const result=await send({registry:{teamId:'TFIXTURE'},channel:{id:'CPREVIEW',private:true},text:'fixture',operation:'post'});
 assert.equal(result.state,shared===false?'acknowledged':'dead');assert.equal(calls.includes('chat.postMessage'),shared===false);
 }
});

test('missing audience grants, Slack Connect or nonprivate route registration are refused',()=>{
 const f=fixture();try{for(const override of [{slackConnect:true},{recipientAccessVerified:false},{channels:{...f.box.box.registry.channels,health:{...f.box.box.registry.channels.health,private:false}}}]){
 assert.throws(()=>new CloudflareDelivery({sql:f.sql,transaction:f.box.transaction,registry:{...f.box.box.registry,...override},deliver:async()=>{throw Error('not reached')}}),/unapproved/);
 }}finally{f.db.close()}
});

test('real Workers SQLite preserves CF intent and receipt over restart without a live transport',async()=>{
 const {createRequire}=await import('node:module'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const require=createRequire(new URL('../../cloudflare-worker/package.json',import.meta.url)),{build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 const f=fixture(),registry=f.box.box.registry;f.db.close();const e=await event();
 const entry=new URL('../../engineering-notifications/cloudflare-worker-5671.mjs',import.meta.url).pathname;
 const source=`import {CloudflareDeliveryActor} from ${JSON.stringify(entry)}; export class FixtureActor extends CloudflareDeliveryActor { async add(e){return this.delivery.accept(e)} async step(){this.clock=(this.clock||${now+300001})+1001;this.delivery.now=()=>this.clock;this.delivery.box.now=()=>this.clock;this.delivery.box.deliver=async r=>({state:'acknowledged',receipt:{channel:r.channel.id,ts:'1234.000001',status:200,transport:'adapter'}});return this.delivery.tick()} async receipt(k){return this.delivery.box.get(k)} } export default {async fetch(r,env){const a=env.CF_DELIVERY.getByName('fixture'),p=new URL(r.url).pathname;return Response.json(p==='/status'?await a.status():p==='/scheduled'?await a.recordScheduled():p==='/add'?await a.add(await r.json()):p==='/step'?await a.step():await a.receipt(${JSON.stringify('cf:episode:'+e.episode)}))}};`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers']});
 const dir=mkdtempSync(join(tmpdir(),'s38-cf-5671-')),options=convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-08',compatibilityFlags:['nodejs_compat'],resourcePersistencePath:dir,durableObjects:{CF_DELIVERY:{className:'FixtureActor',useSQLite:true}},bindings:{CF_DELIVERY_ENABLED:'false',ROUTING_REGISTRY:JSON.stringify(registry)}});
 let mf=new Miniflare(options);try{
 assert.equal((await(await mf.dispatchFetch('https://fixture/status')).json()).lastScheduledAt,null);
 assert.equal((await (await mf.dispatchFetch('https://fixture/add',{method:'POST',body:JSON.stringify(e)})).json()).accepted,true);
 await mf.dispatchFetch('https://fixture/step');const receipt=await(await mf.dispatchFetch('https://fixture/receipt')).json();assert.equal(receipt.state,'acknowledged');assert.equal(receipt.receipt.channel,'CPREVIEW');
 await mf.dispatchFetch('https://fixture/scheduled');const scheduled=(await(await mf.dispatchFetch('https://fixture/status')).json()).lastScheduledAt;assert.ok(Number.isFinite(scheduled));
 await mf.dispose();mf=new Miniflare(options);assert.equal((await(await mf.dispatchFetch('https://fixture/status')).json()).lastScheduledAt,scheduled);assert.equal((await(await mf.dispatchFetch('https://fixture/receipt')).json()).state,'acknowledged');
 assert.equal((await(await mf.dispatchFetch('https://fixture/add',{method:'POST',body:JSON.stringify(e)})).json()).duplicate,true);
 }finally{await mf.dispose();rmSync(dir,{recursive:true})}
});

test('independent observer distinguishes missed schedule, idle, stale delivery and failed private status reads',async()=>{
 const {cloudflareHeartbeat,readCloudflareHeartbeat}=await import('../../engineering-notifications/cloudflare-heartbeat-5671.mjs');
 const status={enabled:true,lastScheduledAt:now,summary:{undeliveredIntents:0,unbatched:0,oldestUndeliveredAgeMs:null}};
 assert.equal(cloudflareHeartbeat(status,now).state,'healthy');assert.equal(cloudflareHeartbeat({...status,lastScheduledAt:now-900001},now).state,'missed_heartbeat');
 assert.equal(cloudflareHeartbeat({...status,lastScheduledAt:null},now).state,'unknown');
 assert.equal(cloudflareHeartbeat({...status,summary:{undeliveredIntents:1,unbatched:0,oldestUndeliveredAgeMs:600001}},now).state,'delivery_delayed');
 assert.equal(cloudflareHeartbeat({...status,summary:{undeliveredIntents:1,unbatched:0,oldestUndeliveredAgeMs:null}},now).state,'unknown');
 assert.equal(cloudflareHeartbeat(null,now,{maintenance:true}).state,'maintenance');
 let calls=0;assert.equal((await readCloudflareHeartbeat({url:'https://evil.example/status',secret,fetchImpl:async()=>{calls++;return Response.json(status)}})).state,'unknown');assert.equal(calls,0);
 assert.equal((await readCloudflareHeartbeat({url:'https://fixture.account.workers.dev/status',secret,now:()=>now,fetchImpl:async()=>Response.json(status)})).state,'healthy');
 assert.equal((await readCloudflareHeartbeat({url:'https://fixture.account.workers.dev/status',secret,fetchImpl:async()=>{throw Error('private')}})).state,'unknown');
});
