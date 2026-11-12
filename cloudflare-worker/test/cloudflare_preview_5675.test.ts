/** D5675: provider-free signed preview callback, existing host lifecycle, promotion refusal and synthetic cleanup. No cloud resources or messages. */
import { spawnSync } from 'node:child_process';
import test, { before, after, mock } from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
import { preparePreviewCanary,previewIngress,previewKey,verifyPreviewRequest,validPreviewReceipt,previewPromotionEligible,reconcilePreviewCanaryAlarm,type CanaryJob } from '../../meeting-bot/worker/previewCanary.ts';
import { MeetingBotContainer } from '../../meeting-bot/worker/container.ts';
import { signRequest } from '../../meeting-bot/src/callback.ts';import { runPreviewCallback } from '../../meeting-bot/src/previewCanary.ts';
before(()=>mock.timers.enable({apis:['Date'],now:1900000000000}));
after(()=>mock.timers.reset());
const origin='https://studioos-meeting-bot-preview.synthetic.workers.dev',root='synthetic-preview-secret-'.repeat(3);
const job=():CanaryJob=>({version:1,audience:'preview',script:'studioos-meeting-bot-preview',id:'00000000-0000-4000-8000-000000000001',nonce:'b'.repeat(32),revision:'a'.repeat(40),created_ms:Date.now(),op:'run'});
const env=()=>({CF_BOT_AUDIENCE:'preview',PREVIEW_CANARY_ENABLED:'on',PREVIEW_CANARY_ORIGIN:origin,MEETING_BOT_PREVIEW_SECRET:root,MEETING_BOT_VERSION:'a'.repeat(40)});
async function signed(j:CanaryJob,keyRoot=root){const raw=JSON.stringify(j),path=j.op==='run'?'/canary/run':`/canary/${j.id}/callback`;return new Request(origin+path,{method:'POST',body:raw,headers:await signRequest(await previewKey(keyRoot,j,j.op),path,raw,Date.now())});}
function fixture(prepare=preparePreviewCanary,{realHost=false,badVersion=false,dropCallback=false,stopFails=false}={}){
 const config=env(),data=new Map<string,any>();let alarm:number|null=null,starts=0,stops=0,callbacks=0,allocations=0,clock=Date.now();let failStop=stopFails;
 const storage={get:async(k:string)=>structuredClone(data.get(k)),put:async(k:string,v:any)=>{data.set(k,structuredClone(v));},delete:async(ks:string|string[])=>{for(const k of Array.isArray(ks)?ks:[ks])data.delete(k);},setAlarm:async(n:number)=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};
 const state:any={storage,container:{images:{runtime:'registry.cloudflare.com/synthetic/runtime@sha256:'+'c'.repeat(64)},running:false,
   start(opts:any){starts++;this.running=true;assert.deepEqual(Object.keys(opts.env).sort(),['MEETING_BOT_CALLBACK_ORIGIN','MEETING_BOT_SECRET','MEETING_BOT_VERSION','PORT']);assert.equal(opts.env.MEETING_BOT_CALLBACK_ORIGIN,origin);},
   setInactivityTimeout:async()=>{},destroy:async()=>{stops++;if(failStop)throw Error('private stop failure');state.container.running=false;},
   getTcpPort:()=>({fetch:async()=>Response.json({ready:true,version:badVersion?'d'.repeat(40):config.MEETING_BOT_VERSION})}),
   exec:async(argv:string[])=>{assert.deepEqual(argv,['node','--experimental-strip-types','--no-warnings','/app/src/previewCanary.ts']);let raw='';let resolve!:(n:number)=>void;const exitCode=new Promise<number>(r=>{resolve=r;});
     return {exitCode,stdin:new WritableStream({write(bytes){raw+=new TextDecoder().decode(bytes);},async close(){try{
       await runPreviewCallback(JSON.parse(raw),async(url:any,init:any)=>{assert.equal(init.redirect,'error');assert.equal(new URL(url).origin,origin);callbacks++;
         if(dropCallback)return Response.json({accepted:true});return await hostFetch(new Request(url,init));});resolve(0);
       }catch{resolve(1);}}})};}
 }};
 let pending:Promise<any>=Promise.resolve();state.blockConcurrencyWhile=(f:()=>Promise<any>)=>{const p=pending.then(f);pending=p.then(()=>{},()=>{});return p;};
 state.waitUntil=()=>{};
 const real=new MeetingBotContainer(state,config as any);
 const hostFetch=async(req:Request)=>realHost?real.fetch(req):await state.blockConcurrencyWhile(()=>prepare(req,config,state,{clock:()=>clock,pause:async()=>{clock+=50000;}})).then((r:any)=>typeof r==='function'?r():r);
 const withNamespace:any={...config,MEETING_BOT_CONTAINER:{idFromName(name:string){allocations++;assert.match(name,/^canary:/);return name;},get:()=>({fetch:hostFetch})}};
 return {config:withNamespace,state,data,run:async(j=job())=>previewIngress(await signed(j),withNamespace),stats:()=>({starts,stops,callbacks,allocations,alarm}),allowStop:()=>{failStop=false;}};
}

test('existing preview host boots exact revision, receives a real signature/ack and stops its synthetic instance',async()=>{
 const f=fixture(preparePreviewCanary,{realHost:true}),j=job(),r=await f.run(j),raw=await r.text();assert.equal(r.status,200);
 const receipt=await validPreviewReceipt(r.headers,raw,root,j);assert.equal(previewPromotionEligible(receipt),true);assert.equal(f.stats().starts,1);assert.equal(f.stats().callbacks,1);assert.equal(f.state.container.running,false);
 const replay=await f.run(j);assert.equal(replay.status,200);assert.equal(f.stats().starts,1,'run replay cannot allocate a second container');
 assert.equal((await f.run({...j,created_ms:j.created_ms+1})).status,409,'replay cannot replace its creation timestamp');
 await reconcilePreviewCanaryAlarm(f.state,j.created_ms+600001);assert.equal(f.data.size,0);assert.equal(f.stats().alarm,null);
});

test('production, UI preview origin, wrong signature/environment/revision and expired challenges allocate nothing',async()=>{
 for(const patch of [{CF_BOT_AUDIENCE:'prod'},{PREVIEW_CANARY_ENABLED:'off'},{PREVIEW_CANARY_ORIGIN:'https://app.axal.vc'},{MEETING_BOT_VERSION:'e'.repeat(40)}]){
   const f=fixture();Object.assign(f.config,patch);assert.equal((await previewIngress(await signed(job()),f.config)).status,404);assert.equal(f.stats().allocations,0);
 }
 const f=fixture();assert.equal((await previewIngress(await signed(job(),'wrong-synthetic-key'.repeat(3)),f.config)).status,404);
 const old=job();old.created_ms-=300001;assert.equal((await previewIngress(await signed(old),f.config)).status,404);
 const wrong=job();(wrong as any).audience='prod';assert.equal((await previewIngress(await signed(wrong),f.config)).status,404);assert.equal(f.stats().starts,0);
});

test('wrong runtime build, missing callback and unknown cleanup block promotion and retain safe evidence',async()=>{
 for(const options of [{badVersion:true},{dropCallback:true},{stopFails:true}]){
  const f=fixture(preparePreviewCanary,options),j=job(),r=await f.run(j),receipt=await validPreviewReceipt(r.headers,await r.text(),root,j);
  assert.equal(r.status,503);assert.equal(previewPromotionEligible(receipt),false);assert.equal(receipt!.state,'fail');
  assert.doesNotMatch(JSON.stringify(receipt),/private stop|secret|https:/);
  if(options.stopFails){assert.equal(receipt!.cleaned,false);assert.ok(f.stats().alarm);f.allowStop();await reconcilePreviewCanaryAlarm(f.state,j.created_ms+150000);assert.equal(f.state.container.running,false);}
 }
});

test('guest callback has no production/redirect fallback and cannot manufacture receiver acknowledgement',async()=>{
 const j={...job(),op:'callback' as const},key=await previewKey(root,j,'callback');let calls=0;
 await assert.rejects(runPreviewCallback({target:'https://app.axal.vc/canary/'+j.id+'/callback',job:j,key},async()=>{calls++;return Response.json({accepted:true});}));assert.equal(calls,0);
 await assert.rejects(runPreviewCallback({target:origin+'/canary/'+j.id+'/callback',job:j,key},async(_u,i)=>{assert.equal(i!.redirect,'error');return new Response(null,{status:302});}));
 await assert.rejects(runPreviewCallback({target:origin+'/canary/'+j.id+'/callback',job:j,key},async()=>Response.json({accepted:false})));
});

test('normal deployment must pass preview before production; failure artifact is sanitized and rollback has no automatic bypass',()=>{
 const w=readFileSync(new URL('../../.github/workflows/meeting-bot-deploy.yml',import.meta.url),'utf8');
 const verify=w.lastIndexOf('run: node --experimental-strip-types --no-warnings scripts/verify-meeting-bot-preview.mjs');
 assert.ok(w.indexOf('--env preview')<verify);assert.ok(verify<w.indexOf('--env ""'));
 assert.ok(verify<w.indexOf('Recheck the candidate after preview verification'));assert.ok(w.indexOf('Recheck the candidate after preview verification')<w.indexOf('--env \"\"'));assert.match(w,/verify-production-candidate\.mjs \"\$GITHUB_SHA\" --wait/);
 assert.doesNotMatch(w,/continue-on-error|skip.canary|bypass/i);assert.match(w,/MEETING_BOT_PREVIEW_ROUTE_VERIFIED/);
 assert.ok(w.indexOf('verify-meeting-bot-preview.mjs --preflight')<w.indexOf('--env preview'));assert.match(w,/--var \"PREVIEW_CANARY_ENABLED:on\"/);assert.match(w,/--var \"PREVIEW_CANARY_ORIGIN:\$\{MEETING_BOT_PREVIEW_ORIGIN\}\"/);
 const cli=readFileSync(new URL('../../scripts/verify-meeting-bot-preview.mjs',import.meta.url),'utf8');assert.match(cli,/previewPromotionEligible/);assert.doesNotMatch(cli,/hooks.slack|chat.postMessage|meeting_url|attendee/);
});

test('mutations: audience, signature, callback persistence and stop acknowledgement each protect promotion',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cf-preview-5675-'));let source=readFileSync(new URL('../../meeting-bot/worker/previewCanary.ts',import.meta.url),'utf8');
 source=source.replace("'../src/callback.ts'",JSON.stringify(new URL('../../meeting-bot/src/callback.ts',import.meta.url).href));
 const changes:[string,string,string,(m:any)=>Promise<void>][]=[
 ['audience',"env.CF_BOT_AUDIENCE!=='preview'",'false',async m=>{const request=await signed(job());assert.equal(await m.verifyPreviewRequest(request,{...env(),CF_BOT_AUDIENCE:'prod'}),null);}],
 ['signature',"return await crypto.subtle.verify('HMAC',key,bytes,enc.encode(`v1:${ts}:POST:${url.pathname}:${raw}`))?job:null;",'return job;',async m=>{assert.equal(await m.verifyPreviewRequest(await signed(job(),'wrong-synthetic-key'.repeat(3)),env()),null);}],
 ['callback-proof',"if((await state.storage.get<CanaryState>('preview-canary'))?.callback!==true)throw Error('callback_missing');",'',async m=>{const f=fixture(m.preparePreviewCanary,{dropCallback:true}),j=job(),r=await f.run(j);assert.equal(previewPromotionEligible(await validPreviewReceipt(r.headers,await r.text(),root,j)),false);}],
 ['cleanup-proof','r.cleaned===true','true',async m=>{assert.equal(m.previewPromotionEligible({state:'pass',stage:'complete',image_digest:'sha256:'+'a'.repeat(64),cleaned:false}),false);}]
 ];
 try{for(const [label,before,after,journey] of changes){assert.ok(source.includes(before),label);const p=join(dir,label+'.ts');writeFileSync(p,source.replaceAll(before,after));await assert.rejects(journey(await import(pathToFileURL(p).href)),'must kill '+label);}}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('a new canary ID cannot bypass an unknown stop; acknowledged cleanup permits the next probe and replays stay cached',async()=>{
 const f=fixture(preparePreviewCanary,{stopFails:true}),first=job();assert.equal((await f.run(first)).status,503);
 const next={...job(),id:'00000000-0000-4000-8000-000000000002',nonce:'c'.repeat(32)};
 assert.equal((await f.run(next)).status,409);assert.equal(f.stats().starts,1);
 f.allowStop();await reconcilePreviewCanaryAlarm(f.state,first.created_ms+150000);
 assert.equal((await f.run(next)).status,200);assert.equal(f.stats().starts,2);
 const before=f.stats().starts;assert.equal((await f.run(first)).status,503);assert.equal(f.stats().starts,before);
 await reconcilePreviewCanaryAlarm(f.state,next.created_ms+600001);assert.equal(f.data.size,0);
});


test('the actual deployment CLI preflight runs without a test loader and refuses incomplete owner configuration before network access',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cf-preview-cli-5675-')),output=join(dir,'receipt.json');
 const script=new URL('../../scripts/verify-meeting-bot-preview.mjs',import.meta.url);
 const config={...process.env,MEETING_BOT_PREVIEW_ORIGIN:origin,MEETING_BOT_PREVIEW_SECRET:root,MEETING_BOT_PREVIEW_ROUTE_VERIFIED:'true',GITHUB_SHA:'a'.repeat(40),PREVIEW_CANARY_RECEIPT:output};
 const run=(change:Record<string,string>)=>spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',script.pathname,'--preflight'],{env:{...config,...change},encoding:'utf8',timeout:5000});
 try{
  const valid=run({});assert.equal(valid.status,0,valid.stderr);assert.equal(existsSync(output),false);
  for(const change of [{MEETING_BOT_PREVIEW_ORIGIN:'https://app.axal.vc'},{MEETING_BOT_PREVIEW_SECRET:''},{MEETING_BOT_PREVIEW_ROUTE_VERIFIED:'false'},{GITHUB_SHA:'invalid'}]){
   const r=run(change);assert.equal(r.status,1,r.stderr);const evidence=JSON.parse(readFileSync(output,'utf8'));assert.equal(evidence.stage,'preflight');assert.equal(evidence.state,'fail');assert.ok(!JSON.stringify(evidence).includes(root));
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
