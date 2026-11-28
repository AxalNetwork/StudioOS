/** D7905: independent Linux engine evidence, no ambient credentials, and exact container cleanup.
 *
 * From frontend/test/README.md (moved by #6472): D7905: real-engine evidence contracts, isolated
 * candidate commands, per-run cleanup and fail-closed bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { JobContainer,readContainerPolicy,containerIsolationAdapter } from '../../scripts/ci/runners/job-container.mjs';
const IMAGE='sha256:'+'a'.repeat(64),CID='b'.repeat(64),NOW=1800000000000,DEADLINE=NOW+300000;
const clocked=new WeakSet();
const receipt=()=>({version:1,repository:'AxalNetwork/StudioOS',profile:'linux-x64',requestId:'00000000-0000-4000-8000-000000000001',logicalShard:'worker-1-of-6',childRunId:202,childAttempt:1,generation:1,executionDeadline:DEADLINE,event:'push',sourceSha:'e'.repeat(40)});
function fixture(t){
 if(!clocked.has(t)){t.mock.timers.enable({apis:['Date'],now:NOW});clocked.add(t);}
 const root=mkdtempSync(join(tmpdir(),'isolation-7905-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source'),plan=join(root,'plan.json');mkdirSync(source);writeFileSync(plan,'{}');
 const calls=[],staged=[],runtime={node:"22.23.3",python:"3.11.18",readable:true};let state;
 const engine=(args,options)=>{
  calls.push({args,options});
  if(args[0]==='create'){
   const val=key=>args[args.indexOf(key)+1],all=key=>args.flatMap((v,i)=>v===key?[args[i+1]]:[]);
   state={Id:CID,Image:IMAGE,State:{Running:true,Pid:123},Config:{User:val('--user'),Labels:{'vc.axal.studioos.job':'202-1-1'},Entrypoint:[val('--entrypoint')],Cmd:args.slice(-2),Env:all('--env')},
    HostConfig:{Privileged:false,Init:args.includes('--init'),ReadonlyRootfs:args.includes('--read-only'),CapDrop:all('--cap-drop'),CapAdd:null,SecurityOpt:all('--security-opt'),PidMode:'',IpcMode:val('--ipc'),CgroupnsMode:val('--cgroupns'),NetworkMode:val('--network'),PortBindings:{},Devices:[],DeviceRequests:null,VolumesFrom:null,ExtraHosts:null,Links:null,PidsLimit:Number(val('--pids-limit')),Memory:Number(val('--memory')),NanoCpus:Number(val('--cpus'))*1e9,Tmpfs:Object.fromEntries(all('--tmpfs').map(v=>[v.slice(0,v.indexOf(':')),v.slice(v.indexOf(':')+1)]))},
    Mounts:[{Type:'bind',Source:source,Destination:'/input',RW:false,Propagation:'rprivate'},{Type:'bind',Source:plan,Destination:'/input-plan.json',RW:false,Propagation:'rprivate'}]};return CID+'\n';
  }
  if(args[0]==='inspect')return JSON.stringify([state]);
  if(args[0]==='exec'&&args.includes('/usr/local/bin/node')&&args.includes('-e'))return runtime.readable?'readable':'';
  if(args[0]==='exec'&&args.includes('/usr/local/bin/node'))return runtime.node+'\n';
  if(args[0]==='exec'&&args.includes('/usr/local/bin/python3'))return runtime.python+'\n';
  return '';
 };
 const spawned=[];
 const job=new JobContainer({version:1,image:IMAGE,nodeVersion:'22.23.3',pythonVersion:'3.11.18'},{engine,namespace:()=>true,stage:inputs=>staged.push(inputs),spawnEngine:args=>{spawned.push(args);return spawn('/bin/sh',['-c','exit 0'],{stdio:'ignore'});}});
 return {job,calls,staged,spawned,runtime,source,plan,state:()=>state,create:()=>job.create(receipt(),{source,plan})};
}
test('D7905 creates a per-run unprivileged container with only read-only inputs and no listener or engine socket',async t=>{
 const f=fixture(t);assert.equal(await f.create(),CID);assert.equal(await f.job.verifyIsolation({receipt:receipt()}),true);
 const mounts=f.state().HostConfig.Tmpfs;f.state().HostConfig.Tmpfs=Object.fromEntries(Object.entries(mounts).reverse());assert.equal(await f.job.verifyIsolation({receipt:receipt()}),true);
 const args=f.calls[0].args;assert.ok(args.includes('--pull=never'));
 assert.deepEqual(args.filter(v=>v.startsWith('type=bind,')),[`type=bind,src=${f.source},dst=/input,readonly,bind-propagation=rprivate`,`type=bind,src=${f.plan},dst=/input-plan.json,readonly,bind-propagation=rprivate`]);
 assert.doesNotMatch(args.join(' '),/\.credentials|docker\.sock|ACTIONS_ID_TOKEN|GH_TOKEN|--privileged|--pid.host/);
 await assert.rejects(f.create(),/already_owned/);
});
test('D7905 actual engine metadata and namespaces must prove the boundary, not labels or receipt claims',async t=>{
 const f=fixture(t);await f.create();const baseline=structuredClone(f.state());
 const patches=[i=>i.State.Running=false,i=>i.State.Pid=0,i=>i.Id='c'.repeat(64),i=>i.Image='sha256:'+'d'.repeat(64),i=>i.Config.User='0:0',
  i=>i.Config.Env.push('ACTIONS_ID_TOKEN_REQUEST_TOKEN=synthetic'),i=>i.Config.Labels['vc.axal.studioos.job']='other',i=>i.Config.Entrypoint=['/evil'],i=>i.Config.Cmd=['-c','sleep 999999'],
  i=>i.HostConfig.Privileged=true,i=>i.HostConfig.Init=false,i=>i.HostConfig.ReadonlyRootfs=false,i=>i.HostConfig.CapDrop=[],i=>i.HostConfig.CapAdd=['SYS_ADMIN'],
  i=>i.HostConfig.SecurityOpt=[],i=>i.HostConfig.PidMode='host',i=>i.HostConfig.IpcMode='host',i=>i.HostConfig.CgroupnsMode='host',i=>i.HostConfig.NetworkMode='host',
  i=>i.HostConfig.PortBindings={'1/tcp':[{}]},i=>i.HostConfig.Devices=[{}],i=>i.HostConfig.DeviceRequests=[{}],i=>i.HostConfig.VolumesFrom=['foreign'],
  i=>i.HostConfig.ExtraHosts=['host:host-gateway'],i=>i.HostConfig.Links=['foreign'],i=>i.HostConfig.PidsLimit=-1,i=>i.HostConfig.Memory=0,i=>i.HostConfig.NanoCpus=0,
  i=>i.HostConfig.Tmpfs['/work']='rw',i=>i.Mounts.push({Source:'/var/run/docker.sock'}),i=>i.Mounts[0].RW=true,i=>i.Mounts[0].Source='/listener',i=>i.Mounts[0].Destination='/listener',i=>i.Mounts[0].Propagation='rshared'];
 for(const patch of patches){Object.assign(f.state(),structuredClone(baseline));patch(f.state());assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false,patch.toString());}
 Object.assign(f.state(),baseline);f.job.namespace=()=>false;assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false);
 f.job.namespace=()=>true;assert.equal(await f.job.verifyIsolation({receipt:{...receipt(),profile:'macos-arm64',job_isolation_verified:true}}),false);
 assert.equal(await f.job.verifyIsolation({receipt:{...receipt(),childRunId:203}}),false);
 assert.equal(await f.job.verifyIsolation({receipt:{...receipt(),sourceSha:'f'.repeat(40)}}),false);
 assert.equal(await f.job.verifyIsolation({receipt:{...receipt(),requestId:'00000000-0000-4000-8000-000000000002'}}),false);
 f.runtime.node='0.0.0';assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false);f.runtime.node='22.23.3';
 f.runtime.python='0.0.0';assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false);
});
test('D7905 fixed installs and tests run inside the same container, and timeout cleanup never targets another run',async t=>{
 const f=fixture(t),r=receipt();await f.job.create(r,{source:f.source,plan:f.plan});
 const admitted={allowed:true,identity:r,sourceSha:'e'.repeat(40),originalRunId:101,originalAttempt:1,originalEvent:'push',sourceRef:'refs/heads/main'};
 await assert.rejects(f.job.runCandidateInterruptible({receipt:r,admitted:{...admitted,sourceSha:'f'.repeat(40)}}),/invalid_isolated_execution/);
 const {args,timeout}=await f.job.candidateExec({receipt:r,admitted});
 assert.deepEqual(await f.job.runCandidateInterruptible({receipt:r,admitted}),{phase:'combined',status:'success',exitCode:0,signal:null});
 // S32 F6: the only candidate route is the interruptible spawner; the sync engine never runs a candidate shell.
 assert.equal(f.calls.some(c=>c.args[0]==='exec'&&c.args.includes('/bin/sh')),false);
 const run=f.spawned.at(-1);assert.deepEqual(run,args);assert.equal(run[run.indexOf('--user')+1],'10000:10000');assert.equal(run[run.indexOf(CID)+1],'/bin/sh');
 assert.match(run.at(-1),/npm ci --prefix cloudflare-worker; npm ci; exec node scripts\/test-drift-parts.mjs/);
 assert.doesNotMatch(run.join(' '),/GH_TOKEN|ACTIONS_ID_TOKEN|docker\.sock/);
 // D8009/S32 F1: candidate work ends FINISH_RESERVE_MS (60s export + 90s removal) before the absolute deadline.
 assert.equal(timeout,DEADLINE-150000-NOW);
 await f.job.cleanup(r);
 assert.deepEqual(f.calls.at(-1).args,['rm','--force',CID]);
 assert.equal(await f.job.verifyIsolation({receipt:r}),false);
 const other=fixture(t);await other.create();await assert.rejects(other.job.cleanup({...receipt(),generation:2}),/owner_mismatch/);
 other.state().Config.Labels['vc.axal.studioos.job']='other';await assert.rejects(other.job.cleanup(receipt()),/identity_mismatch/);
 assert.equal(other.calls.some(c=>c.args[0]==='rm'),false);
});
test('D7905 missing evidence, unpinned images, an operator flag and persistent Mac execution all fail closed',async t=>{
 assert.throws(()=>new JobContainer({version:1,image:'node:22',nodeVersion:'22.23.3',pythonVersion:'3.11.18'}),/unreviewed/);
 const f=fixture(t);assert.equal(await f.job.verifyIsolation({receipt:receipt(),job_isolation_verified:true}),false);
 await assert.rejects(f.job.create({...receipt(),profile:'macos-arm64'},{source:f.source,plan:f.plan}),/invalid_isolation_receipt/);
 assert.throws(()=>readContainerPolicy(f.plan),/untrusted/);
 const source=readFileSync(new URL('../../scripts/ci/runners/bootstrap.sh',import.meta.url),'utf8').split('# PYTHON_BEGIN\n')[1].split('# PYTHON_END')[0];
 const py=`import types\nfrom pathlib import Path\nb=types.ModuleType('bootstrap')\nexec(${JSON.stringify(source)},b.__dict__)\ntry:\n b.serve(Path('/not-a-runner'),0)\nexcept b.Refusal as e:\n assert str(e)=='self_hosted_isolation_canary_required_7905'\nelse:\n raise AssertionError('persistent listener started')\n`;
 const result=spawnSync('python3',['-c',py],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 assert.match(source,/if args\.action in \('register','start'\): isolation_enrollment_gate\(\)/);
});


test('D7905 the admission adapter is bound to actual engine evidence and the exact Linux child',async t=>{
 const f=fixture(t);await f.create();const verify=containerIsolationAdapter(f.job);
 const value={receipt:receipt(),context:{repository:'AxalNetwork/StudioOS',childRunId:202,childAttempt:1},profile:{id:'linux-x64'}};
 assert.equal(await verify(value),true);
 for(const patch of [{context:{...value.context,repository:'Other/Repo'}},{context:{...value.context,childRunId:203}},
  {context:{...value.context,childAttempt:2}},{profile:{id:'macos-arm64'}},{receipt:{...receipt(),sourceSha:'f'.repeat(40)}}])assert.equal(await verify({...value,...patch}),false);
 f.state().HostConfig.Privileged=true;assert.equal(await verify({...value,job_isolation_verified:true}),false);
 assert.throws(()=>containerIsolationAdapter({job_isolation_verified:true}),/supervisor_required/);
});
test('D7905 a failed start, rejected isolation or candidate failure cleans up only the recorded container',async t=>{
 for(const failure of ['start','isolation','candidate']){
  const f=fixture(t),engine=f.job.engine,r=receipt();
  f.job.engine=(args,options)=>{
   if(failure==='start'&&args[0]==='start')throw Error('synthetic start failure');
   if(failure==='isolation'&&args[0]==='inspect')f.state().HostConfig.Privileged=true;
   return engine(args,options);
  };
  if(failure==='candidate'){
   await f.job.create(r,{source:f.source,plan:f.plan});
   f.job.spawnEngine=()=>{throw Error('synthetic test failure');};
   assert.equal((await f.job.runCandidateInterruptible({receipt:r,admitted:{allowed:true,identity:r,sourceSha:r.sourceSha,originalRunId:101,originalAttempt:1,originalEvent:'push',sourceRef:'refs/heads/main'}})).status,'engine_failed');
   await f.job.cleanup(r);
  }else await assert.rejects(f.job.create(r,{source:f.source,plan:f.plan}),/container_start_or_isolation_failed/);
  assert.deepEqual(f.calls.at(-1).args,['rm','--force',CID]);
  assert.equal(f.job.owned,null);
 }
});


test('D7905 the container lifetime survives host loss and its init identity differs from every candidate process',async t=>{
 const f=fixture(t);await f.create();const args=f.calls[0].args;
 assert.equal(args[args.indexOf('--user')+1],'10001:10001');
 assert.ok(args.includes('--init'));
 // D8009: the container sleeps to the receipt's absolute deadline, computed in the container at start.
 assert.deepEqual(args.slice(-2),['-c','exec sleep "$(( STUDIOOS_JOB_DEADLINE - $(date +%s) - 1 ))"']);
 assert.ok(args.includes(`STUDIOOS_JOB_DEADLINE=${Math.floor(DEADLINE/1000)}`));
 assert.equal(args.some(v=>v.startsWith('STUDIOOS_JOB_MAX_SECONDS=')),false);
 for(const call of f.calls.filter(c=>c.args[0]==='exec'))assert.equal(call.args[call.args.indexOf('--user')+1],'10000:10000');
 f.state().Config.Env=f.state().Config.Env.map(v=>v.startsWith('STUDIOOS_JOB_DEADLINE=')?'STUDIOOS_JOB_DEADLINE=999999':v);
 assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false);
 for(const executionDeadline of [NOW,NOW-1,NOW+150000,NOW+1590001]){
  const expired=fixture(t);await assert.rejects(expired.job.create({...receipt(),executionDeadline},{source:expired.source,plan:expired.plan}),/invalid_container_deadline/);
  assert.equal(expired.calls.length,0);
 }
});
test('D7905 inputs are staged for the candidate before create, and an input the candidate cannot read fails isolation',async t=>{
 const f=fixture(t);await f.create();
 assert.equal(f.staged.length,1);assert.equal(f.staged[0].plan,f.plan);assert.equal(f.calls[0].args[0],'create');
 const probe=f.calls.find(c=>c.args[0]==='exec'&&c.args.includes('-e'));
 assert.equal(probe.args[probe.args.indexOf('--user')+1],'10000:10000');
 assert.match(probe.args.at(-1),/\/input-plan\.json/);assert.match(probe.args.at(-1),/\/input\/package\.json/);
 assert.equal(await f.job.verifyIsolation({receipt:receipt()}),true);
 f.runtime.readable=false;assert.equal(await f.job.verifyIsolation({receipt:receipt()}),false);
 const g=fixture(t);g.runtime.readable=false;await assert.rejects(g.create(),/container_start_or_isolation_failed/);
 assert.deepEqual(g.calls.at(-1).args,['rm','--force',CID]);
});
