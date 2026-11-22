/** D8011: real signed tokens/SQLite and explicit fake network/authority boundaries; no live capacity proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, sign } from 'node:crypto';
import '../../merge-control/test/runtime-loader.mjs';
const { CapacityControl, SqlCapacityBudgetStore } = await import('../../merge-control/src/ciCapacityRuntime.ts');
import { CapacityTransport } from '../../merge-control/src/ciCapacityTransport.ts';
import { authenticateCapacity, capacityPlatformFetch, CAPACITY_ISSUER } from '../../merge-control/src/ciCapacityAuth.ts';
import { CapacityRequestBudget, CAPACITY_AUTH_LIMITS as L } from '../../merge-control/src/lib/ciCapacityAuthPolicy.ts';
import { createReceiptReader } from '../../scripts/ci/capacity-client.mjs';

const REPO='AxalNetwork/StudioOS',EXEC='b'.repeat(40),NOW=1_800_000_000_000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'composed-fixture',alg:'RS256',use:'sig'};
const config={repository:REPO,repositoryId:7,executorSha:EXEC,approvedGroupId:5,selfHostedProfiles:['linux-x64'],
  prerequisiteJobs:['fast'],fullSuiteJobs:[],appId:23,maxExternalWorkerShards:0,maxIncludedWorkerShards:0,publication:'pilot'};
const body={requestId:'00000000-0000-4000-8000-000000008011',shard:'worker-1-of-6',generation:1,profile:'linux-x64'};
function claims(patch={}){
  const now=Math.floor(Date.now()/1000);
  return {iss:CAPACITY_ISSUER,aud:'fixture-capacity',sub:`repo:${REPO}:ref:refs/heads/main`,repository:REPO,repository_id:'7',
    run_id:'100',run_attempt:'1',event_name:'workflow_dispatch',ref:'refs/heads/main',sha:EXEC,workflow_sha:EXEC,
    workflow_ref:`${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`,exp:now+300,iat:now,nbf:now-1,...patch};
}
function token(value=claims()){
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
  const payload=header+'.'+Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url');
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(t){
  t.mock.timers.enable({apis:['Date'],now:NOW});
  t.mock.method(console,'error',()=>{});
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const kv=new Map([['capacity-kill',false]]);
  const storage={sql:{exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}},
    transactionSync(fn){db.exec('BEGIN');try{const out=fn();db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}},
    get:async key=>kv.get(key),put:async(key,value)=>{kv.set(key,value);},setAlarm:async()=>{},deleteAlarm:async()=>{}};
  const env={REPOSITORY:REPO,CAPACITY_ENABLED:'true',CAPACITY_OWNER_TOKEN:'fixture-owner',CAPACITY_AUDIENCE:'fixture-capacity',CAPACITY_CONFIG:JSON.stringify(config)};
  let keyReads=0,verifications=0,work=0,owned=true,lastRedirect,provider=async()=>Response.json({keys:[jwk]});
  const verify=crypto.subtle.verify.bind(crypto.subtle);
  t.mock.method(crypto.subtle,'verify',async(...args)=>{verifications++;return verify(...args);});
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    assert.equal(String(input),`${CAPACITY_ISSUER}/.well-known/jwks`,'no live provider/API request');
    lastRedirect=init.redirect;keyReads++;return provider(input,init);
  });
  let control;
  const restart=()=>{
    control=new CapacityControl({storage},env);
    // Only the external parent/receipt observation is faked; auth, admission, SQL, ordering and transport are real.
    const transport=new CapacityTransport({receipt:async(_id,_shard,run,attempt)=>{
      work++;return owned&&run===100&&attempt===1?{repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC,
        requestId:body.requestId,logicalShard:body.shard,generation:1,profile:body.profile}:null;
    }},config,async()=>env.CAPACITY_ENABLED==='true'&&await storage.get('capacity-kill')===false,async()=>{});
    t.mock.method(control,'components',async()=>({transport,config}));
  };restart();
  const send=async(bearer=token(),value=body,path='/capacity/receipt')=>control.fetch(new Request('https://capacity.invalid'+path,
    {method:'POST',headers:{authorization:'Bearer '+bearer},body:JSON.stringify(value)}));
  const reader=()=>{
    let acquisitions=0;
    const read=createReceiptReader({url:'https://capacity.invalid',audience:'fixture-capacity',
      oidcToken:async()=>token(claims({jti:String(++acquisitions)})),fetcher:(input,init)=>control.fetch(new Request(input,init))});
    const input={request:{...body,generation:String(body.generation)},context:{repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC},phase:'execute'};
    return {read:()=>read(input),acquisitions:()=>acquisitions};
  };
  return {db,storage,env,kv,send,reader,restart,control:()=>control,provider:value=>{provider=value;},owned:value=>{owned=value;},
    counts:()=>({keyReads,verifications,work}),redirect:()=>lastRedirect,window:()=>JSON.parse(db.prepare('SELECT state FROM capacity_auth_budget WHERE id=1').get().state)};
}

test('per-authority keys cache material while every real signature and claim is checked',async t=>{
  const f=fixture(t);
  assert.equal((await f.send()).status,200);assert.equal((await f.send()).status,200);
  assert.deepEqual(f.counts(),{keyReads:1,verifications:2,work:2});
  assert.equal(f.redirect(),'manual');
  for(const patch of [{aud:'other'},{repository_id:'8'},{run_attempt:'2'},{sha:'a'.repeat(40)},
    {workflow_sha:'a'.repeat(40)},{workflow_ref:`${REPO}/.github/workflows/runner-executor.yml@refs/heads/other`},
    {exp:Math.floor(Date.now()/1000)},{iss:'https://other.invalid'}])assert.equal((await f.send(token(claims(patch)))).status,403);
  const signed=token(),parts=signed.split('.');parts[2]='c2ln';
  assert.equal((await f.send(parts.join('.'))).status,403);
  assert.deepEqual(f.counts(),{keyReads:1,verifications:11,work:2});
  assert.equal(f.window().lanes.receipt.used,2);
});

test('unproved paths and invalid identities never read the body or enter ordered work',async t=>{
  const f=fixture(t);let reads=0;
  const request=new Request('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer invalid.jwt.value'},body:'{}'});
  Object.defineProperty(request,'body',{get(){reads++;throw Error('must not read an unauthenticated body');}});
  assert.equal((await f.control().fetch(request)).status,403);assert.equal(reads,0);
  assert.equal((await f.send(token(),{},'/capacity/submit')).status,403);
  assert.deepEqual(f.counts(),{keyReads:1,verifications:1,work:0});
});

test('durable kill reads are inside bounded admission, and the disabled environment gate reads nothing',async t=>{
  const f=fixture(t);let reads=0;const started=deferred(),finish=deferred();
  t.mock.method(f.storage,'get',async()=>{reads++;if(reads===L.authConcurrent)started.resolve();return finish.promise;});
  const pending=Array.from({length:L.authConcurrent},()=>f.send());await started.promise;
  const overflow=f.send();let results;
  try{
    const immediate=await Promise.race([overflow,new Promise(resolve=>setImmediate(()=>resolve(null)))]);
    assert.equal(immediate?.status,429,'overflow is refused without waiting on durable enablement');assert.equal(reads,L.authConcurrent);
    f.env.CAPACITY_ENABLED='false';assert.equal((await f.send()).status,503);assert.equal(reads,L.authConcurrent);
    assert.equal(f.counts().keyReads,0);assert.equal(f.window().authUsed,L.authConcurrent);
  }finally{finish.resolve(true);results=await Promise.all(pending);await overflow;}
  assert.deepEqual(results.map(result=>result.status),Array(L.authConcurrent).fill(503));
  assert.equal(f.counts().work,0);
});

test('pending authentication does not queue ahead of independently authenticated owner controls or alarms',async t=>{
  const f=fixture(t),started=deferred(),finish=deferred();let bodyReads=0;
  f.provider(async()=>{started.resolve();return finish.promise;});
  const request=new Request('https://capacity.invalid/capacity/receipt',{method:'POST',headers:{authorization:'Bearer '+token()},body:JSON.stringify(body)});
  const stream=request.body;Object.defineProperty(request,'body',{get(){bodyReads++;return stream;}});
  const pending=f.control().fetch(request);await started.promise;
  try{
    const status=f.control().fetch(new Request('https://capacity.invalid/capacity/status',{headers:{authorization:'Bearer fixture-owner'}}));
    const immediate=await Promise.race([status,new Promise(resolve=>setImmediate(()=>resolve(null)))]);
    assert.equal(immediate?.status,200,'owner status completes during the pending key fetch');
    await f.control().alarm();
    const killed=await f.control().fetch(new Request('https://capacity.invalid/capacity/switch',{method:'POST',headers:{authorization:'Bearer fixture-owner'},body:'{"kill":true}'}));
    assert.equal(killed.status,200);
  }finally{finish.resolve(Response.json({keys:[jwk]}));}
  assert.equal((await pending).status,503);assert.equal(f.counts().work,0);assert.equal(bodyReads,0,'revocation is rechecked before body work');
});

test('the actual reader continues with one exact token after ordinary authentication exhaustion',async t=>{
  const f=fixture(t),reader=f.reader();assert.equal((await reader.read()).active,true);
  for(let n=1;n<L.authPerWindow;n++)assert.equal((await f.send('invalid.jwt.value')).status,403);
  assert.equal((await f.send(token(claims({jti:'different'})))).status,429);
  assert.equal((await reader.read()).active,true);
  assert.equal(reader.acquisitions(),1);assert.equal(f.window().authUsed,L.authPerWindow);assert.equal(f.window().progressAuthUsed,1);
  assert.equal(f.counts().verifications,2,'the reused bearer still receives real signature verification');
  f.owned(false);await assert.rejects(reader.read(),/capacity_receipt_refused/);
  assert.equal(f.counts().verifications,3);assert.equal(f.window().progressAuthUsed,2);
  assert.equal(JSON.stringify(f.window()).includes('Bearer'),false);
  t.mock.timers.setTime(NOW+L.progressProofMs);
  await assert.rejects(reader.read(),/capacity_authority_unavailable/);
  assert.equal(reader.acquisitions(),2,'a replacement token must bootstrap through ordinary admission');
});

test('current generation and profile checks remain mandatory for protected receipt reads',async t=>{
  const f=fixture(t),bearer=token();assert.equal((await f.send(bearer)).status,200);
  for(let n=1;n<L.authPerWindow;n++)await f.send('invalid.jwt.value');
  for(const patch of [{generation:2},{profile:'macos-arm64'}]){
    const result=await f.send(bearer,{...body,...patch});assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{active:false,receipt:null});
  }
  assert.equal(f.window().progressAuthUsed,2);assert.equal(f.counts().verifications,3);
});

test('the atomic SQLite budget survives replacement instances and rolls back storage failures',async t=>{
  const f=fixture(t),store=new SqlCapacityBudgetStore(f.storage);
  const verify=async()=>({repository_id:'7',run_id:'100',run_attempt:'1'});
  for(let n=0;n<L.submitPerCaller;n++)await new CapacityRequestBudget(store).run(verify,()=> 'submit',async()=>true);
  await assert.rejects(new CapacityRequestBudget(new SqlCapacityBudgetStore(f.storage)).run(verify,()=> 'submit',async()=>assert.fail()),/work_limited/);
  assert.equal(f.window().lanes.submit.used,L.submitPerCaller);
  const before=f.window(),exec=f.storage.sql.exec.bind(f.storage.sql);
  t.mock.method(f.storage.sql,'exec',(query,...args)=>{if(query.startsWith('INSERT INTO capacity_auth_budget'))throw Error('fixture-disk-error');return exec(query,...args);});
  await assert.rejects(new CapacityRequestBudget(store).run(verify,()=> 'receipt',async()=>assert.fail()),/fixture-disk-error/);
  assert.deepEqual(f.window(),before,'failed persistence never consumes a partial reservation or admits work');
});

test('claims use the verification-completion clock, so a slow provider cannot prolong token expiry',async t=>{
  fixture(t);const bearer=token(claims({exp:NOW/1000+1}));
  const request=new Request('https://capacity.invalid',{headers:{authorization:'Bearer '+bearer}});
  const keys={get:async()=>{t.mock.timers.setTime(NOW+2000);return jwk;}};
  await assert.rejects(authenticateCapacity(request,'fixture-capacity',REPO,()=>assert.fail(),Date.now,keys),/claims_refused/);
});

test('reader acquisition is coalesced, expiry-bounded, scoped and discarded after authority errors',async t=>{
  const f=fixture(t),start=deferred(),finish=deferred();let acquisitions=0;
  const input={request:{...body,generation:'1'},context:{repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC},phase:'execute'};
  const read=createReceiptReader({url:'https://capacity.invalid',audience:'fixture-capacity',oidcToken:async()=>{
    acquisitions++;if(acquisitions===1){start.resolve();await finish.promise;}
    return token(claims({jti:String(acquisitions),exp:Math.floor(Date.now()/1000)+2}));
  },fetcher:(url,init)=>f.control().fetch(new Request(url,init))});
  const first=read(input),second=read(input);t.after(async()=>{finish.resolve();await Promise.allSettled([first,second]);});
  await start.promise;assert.equal(acquisitions,1);finish.resolve();
  assert.equal((await first).active,true);assert.equal((await second).active,true);assert.equal(f.counts().verifications,2);
  t.mock.timers.setTime(NOW+1000);assert.equal((await read(input)).active,true);assert.equal(acquisitions,2);
  await assert.rejects(read({...input,context:{...input.context,childRunId:101}}),/capacity_receipt_refused/);assert.equal(acquisitions,3);
  assert.equal((await read(input)).active,true);assert.equal(acquisitions,4,'a different caller context cannot reuse the previous bearer');
  f.env.CAPACITY_ENABLED='false';await assert.rejects(read(input),/capacity_authority_unavailable/);
  f.env.CAPACITY_ENABLED='true';assert.equal((await read(input)).active,true);assert.equal(acquisitions,5);
  const expired=createReceiptReader({url:'https://capacity.invalid',audience:'fixture-capacity',
    oidcToken:async()=>token(claims({exp:Math.floor(Date.now()/1000)})),fetcher:()=>assert.fail('expired client bearer must never be sent')});
  await assert.rejects(expired(input),/invalid_oidc_response/);
});

test('replacement CapacityControl instances retain the durable ordinary admission limit',async t=>{
  const f=fixture(t);for(let n=0;n<L.authPerWindow;n++)await f.send('invalid.jwt.value');
  f.restart();assert.equal((await f.send()).status,429);
  assert.equal(f.window().authUsed,L.authPerWindow);assert.deepEqual(f.counts(),{keyReads:0,verifications:0,work:0});
});

test('failed coalesced OIDC acquisition releases only its flight and a later receipt retries verification',async t=>{
 const f=fixture(t),start=deferred(),finish=deferred();let acquisitions=0;
 const input={request:{...body,generation:'1'},context:{repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC},phase:'execute'};
 const read=createReceiptReader({url:'https://capacity.invalid',audience:'fixture-capacity',oidcToken:async()=>{
  acquisitions++;if(acquisitions===1){start.resolve();await finish.promise;throw Error('fixture OIDC unavailable');}
  return token();
 },fetcher:(url,init)=>f.control().fetch(new Request(url,init))});
 const first=assert.rejects(read(input),/OIDC unavailable/),second=assert.rejects(read(input),/OIDC unavailable/);
 t.after(async()=>{finish.resolve();await Promise.all([first,second]);});
 await start.promise;assert.equal(acquisitions,1);finish.resolve();await Promise.all([first,second]);
 assert.equal((await read(input)).active,true);assert.equal(acquisitions,2);assert.equal(f.counts().verifications,1);
});

test('same-context receipt validation failures discard the bearer before the next read',async t=>{
  t.mock.timers.enable({apis:['Date'],now:NOW});
  const receipt={repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC,requestId:body.requestId,logicalShard:body.shard,generation:1,profile:body.profile};
  const input={request:{...body,generation:'1'},context:{repository:REPO,childRunId:100,childAttempt:1,executorSha:EXEC},phase:'execute'};
  for(const bad of [null,{}, {active:false,receipt:null},{active:true,receipt:{...receipt,childRunId:999}},
    {active:true,receipt:{...receipt,generation:2}},{active:true,receipt:{...receipt,profile:'macos-arm64'}}]){
    let acquisitions=0,reads=0;
    const read=createReceiptReader({url:'https://capacity.invalid',audience:'fixture-capacity',
      oidcToken:async()=>token(claims({jti:String(++acquisitions)})),
      fetcher:async()=>Response.json(++reads===2?bad:{active:true,receipt})});
    assert.equal((await read(input)).active,true);await assert.rejects(read(input),/capacity_receipt_refused/);
    assert.equal((await read(input)).active,true);assert.equal(acquisitions,2,'validation failure clears the same-context bearer');
  }
});

test('the Workers fetch adapter uses manual redirects and refuses redirects without a second request',async t=>{
  let calls=0,cancelled=false,redirect;
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
    calls++;redirect=init.redirect;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{location:'https://other.invalid'}});
  });
  await assert.rejects(capacityPlatformFetch(`${CAPACITY_ISSUER}/.well-known/jwks`,{redirect:'error'}),/capacity_redirect_refused/);
  assert.equal(redirect,'manual');assert.equal(calls,1);assert.equal(cancelled,true);
  t.mock.method(globalThis,'fetch',async()=>{
    const result=Response.json({keys:[jwk]});Object.defineProperty(result,'redirected',{value:true});return result;
  });
  await assert.rejects(capacityPlatformFetch(`${CAPACITY_ISSUER}/.well-known/jwks`),/capacity_redirect_refused/);
});

test('an existing malformed SQLite budget cell cannot become the absent-row sentinel',async t=>{
  const f=fixture(t),store=new SqlCapacityBudgetStore(f.storage);let verified=0,worked=0,decided=0;
  for(const raw of ['null','false','0','""','[]','true']){
    f.db.prepare('INSERT INTO capacity_auth_budget (id,state) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(raw);
    await assert.rejects(store.update(()=>{decided++;throw Error('malformed rows must not reach decide');}),/capacity_budget_state_invalid/);
    await assert.rejects(new CapacityRequestBudget(store).run(async()=>{verified++;return {repository_id:'7',run_id:'100',run_attempt:'1'};},()=> 'receipt',async()=>{worked++;}),/capacity_budget_state_invalid/);
    assert.equal(f.db.prepare('SELECT state FROM capacity_auth_budget WHERE id=1').get().state,raw,'corrupt persisted evidence is retained');
  }
  assert.equal(decided,0);assert.equal(verified,0);assert.equal(worked,0);
  f.db.prepare('DELETE FROM capacity_auth_budget').run();
  assert.equal(await new CapacityRequestBudget(store).run(async()=>({repository_id:'7',run_id:'100',run_attempt:'1'}),()=> 'receipt',async()=>true),true);
});
