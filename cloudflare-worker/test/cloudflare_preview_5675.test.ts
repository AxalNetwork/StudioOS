/** D5675: provider-free signed preview callback, existing host lifecycle, promotion refusal and synthetic cleanup. No cloud resources or messages. */
import { spawnSync } from 'node:child_process';
import test, { before, after, mock } from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
import { preparePreviewCanary,previewIngress,previewKey,validPreviewReceipt,previewPromotionEligible,reconcilePreviewCanaryAlarm,type CanaryJob } from '../../meeting-bot/worker/previewCanary.ts';
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

test('deployment checks settings before CI and exposes the signing secret only after candidate verification', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/meeting-bot-deploy.yml', import.meta.url), 'utf8');
  const steps = workflow.split(/^      - /m);
  const commands = [
    'verify-meeting-bot-preview.mjs --check-settings',
    'verify-production-candidate.mjs "$GITHUB_SHA" --wait',
    'verify-meeting-bot-preview.mjs --preflight',
    'npm ci --prefix cloudflare-worker',
    'build-meeting-bot-image.mjs',
    'Recheck the candidate before publishing the bot',
    '--env preview',
    'Verify deployed preview callback before normal promotion',
    'Recheck the candidate after preview verification',
    '--env ""',
  ];
  let previous = -1;
  for (const command of commands) {
    const current = steps.findIndex(step => step.includes(command));
    assert.ok(current > previous, `missing or out-of-order step: ${command}`);
    previous = current;
  }
  const earlyCheck = steps.find(step => step.includes('--check-settings'))!;
  assert.match(earlyCheck, /MEETING_BOT_PREVIEW_SECRET_PRESENT:.*secrets\.MEETING_BOT_PREVIEW_SECRET != ''/);
  const secretSteps = steps.filter(step => /\$\{\{\s*secrets\.MEETING_BOT_PREVIEW_SECRET\s*\}\}/.test(step));
  assert.equal(secretSteps.length, 2);
  assert.match(secretSteps[0], /verify-meeting-bot-preview\.mjs --preflight/);
  assert.match(secretSteps[1], /verify-meeting-bot-preview\.mjs$/m);
  for (const step of [earlyCheck, ...secretSteps]) {
    assert.match(step, /vars\.MEETING_BOT_PREVIEW_ORIGIN/);
    assert.match(step, /vars\.MEETING_BOT_PREVIEW_ROUTE_VERIFIED/);
  }
  assert.doesNotMatch(workflow, /continue-on-error|skip.canary|bypass/i);
  assert.match(workflow, /--var "PREVIEW_CANARY_ENABLED:on"/);
  assert.match(workflow, /--var "PREVIEW_CANARY_ORIGIN:\$\{MEETING_BOT_PREVIEW_ORIGIN\}"/);
  const cli = readFileSync(new URL('../../scripts/verify-meeting-bot-preview.mjs', import.meta.url), 'utf8');
  assert.match(cli, /previewPromotionEligible/);
  assert.doesNotMatch(cli, /hooks.slack|chat.postMessage|meeting_url|attendee/);
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


test('early settings, signing preflight and deployed probe enforce their own prerequisites', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cf-preview-cli-5675-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'receipt.json');
  const script = new URL('../../scripts/verify-meeting-bot-preview.mjs', import.meta.url);
  const config = {
    MEETING_BOT_PREVIEW_ORIGIN: origin,
    MEETING_BOT_PREVIEW_SECRET: root,
    MEETING_BOT_PREVIEW_SECRET_PRESENT: 'true',
    MEETING_BOT_PREVIEW_ROUTE_VERIFIED: 'true',
    GITHUB_SHA: 'a'.repeat(40),
    PREVIEW_CANARY_RECEIPT: output,
  };
  function run(args: string[], changes: Partial<typeof config>) {
    rmSync(output, { force: true });
    return spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script.pathname, ...args], {
      env: { ...config, ...changes }, encoding: 'utf8', timeout: 5000,
    });
  }

  for (const [mode, changes] of [
    ['--check-settings', { MEETING_BOT_PREVIEW_SECRET: '' }],
    ['--preflight', { MEETING_BOT_PREVIEW_SECRET_PRESENT: 'false' }],
  ] as const) {
    const result = run([mode], changes);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(output), false, 'a settings-only check cannot produce a passing deployment receipt');
  }

  const invalidOrigin = 'https://private-fixture.example.invalid';
  const shortSecret = 'short-fixture-secret';
  const missing = ['MEETING_BOT_PREVIEW_ORIGIN', 'MEETING_BOT_PREVIEW_ROUTE_VERIFIED', 'MEETING_BOT_PREVIEW_SECRET'];
  const cases: [string[], Partial<typeof config>, string[]][] = [
    [['--check-settings'], { MEETING_BOT_PREVIEW_SECRET_PRESENT: 'false', MEETING_BOT_PREVIEW_ORIGIN: '', MEETING_BOT_PREVIEW_ROUTE_VERIFIED: '' }, missing],
    [['--check-settings'], { MEETING_BOT_PREVIEW_ORIGIN: invalidOrigin }, ['MEETING_BOT_PREVIEW_ORIGIN']],
    [['--check-settings'], { GITHUB_SHA: 'bad-revision' }, ['GITHUB_SHA']],
    [['--preflight'], { GITHUB_SHA: 'bad-revision' }, ['GITHUB_SHA']],
    [['--preflight'], { MEETING_BOT_PREVIEW_ORIGIN: invalidOrigin }, ['MEETING_BOT_PREVIEW_ORIGIN']],
    [['--preflight'], { MEETING_BOT_PREVIEW_ROUTE_VERIFIED: 'false' }, ['MEETING_BOT_PREVIEW_ROUTE_VERIFIED']],
    [['--preflight'], { MEETING_BOT_PREVIEW_SECRET: shortSecret }, ['MEETING_BOT_PREVIEW_SECRET']],
    [[], { MEETING_BOT_PREVIEW_SECRET: '' }, ['MEETING_BOT_PREVIEW_SECRET']],
  ];
  for (const [args, changes, invalid] of cases) {
    const result = run(args, changes);
    assert.equal(result.status, 1, result.stderr);
    const raw = readFileSync(output, 'utf8');
    const evidence = JSON.parse(raw);
    assert.equal(evidence.stage, 'preflight');
    assert.equal(evidence.state, 'fail');
    assert.deepEqual(evidence.invalid_settings.sort(), [...invalid].sort());
    for (const name of invalid) assert.ok(result.stderr.includes(name), `missing guidance for ${name}`);
    const diagnostics = [raw, result.stdout, result.stderr].join('\n');
    for (const privateValue of [root, shortSecret, origin, invalidOrigin, 'bad-revision']) {
      assert.ok(!diagnostics.includes(privateValue), 'diagnostics must omit configured values');
    }
  }
});
