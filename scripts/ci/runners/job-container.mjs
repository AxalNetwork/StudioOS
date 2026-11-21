/** D7905: trusted-host Linux candidate container boundary; no enrollment or image acquisition. */
import { execFileSync, spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { receiptIdentity } from '../runner-admission.mjs';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, readlinkSync } from 'node:fs';
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=n=>Number.isSafeInteger(n)&&n>0;
const need=(v,reason)=>{if(!v)throw Error(reason);};
/**
 * D8009: the container stops at the receipt's ABSOLUTE execution deadline, computed in the container at start,
 * not at a duration captured before staging/create. A deadline already past makes sleep fail, so it never runs.
 */
const SHELL='exec sleep "$(( STUDIOOS_JOB_DEADLINE - $(date +%s) ))"';
/**
 * D8009: candidate installs and tests stop this long before the absolute deadline, leaving time for observation
 * capture, a bounded export and exact inspect+rm removal (two engine calls of 30s each). This shortens candidate
 * work; it raises no timeout, cap or lease.
 */
export const FINISH_RESERVE_MS=90000;
/** Each ACL staging call is bounded so staging plus cleanup stays inside the coordinator's 120s cancellation budget. */
export const STAGE_TIMEOUT_MS=20000;
const ENV=['PATH=/usr/local/bin:/usr/bin:/bin','HOME=/work/home','LANG=C.UTF-8','CI=true','TZ=UTC'];
const LABEL='vc.axal.studioos.job';
const CANDIDATE='10000:10000';
const OWNER=/^[1-9][0-9]*-1-[1-9][0-9]*$/,CONTAINER=/^[a-f0-9]{64}$/;
/** Fixed engine client: no shell, scrubbed environment, the candidate's own output streams only for its run. */
export const dockerEngine=(args,{timeout=30000}={})=>execFileSync('/usr/local/bin/docker',args,{encoding:'utf8',timeout,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'},stdio:args[0]==='exec'&&args.includes('/bin/sh')?['ignore','inherit','inherit']:['ignore','pipe','pipe']});
const dockerSpawn=args=>spawn('/usr/local/bin/docker',args,{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','inherit','inherit'],shell:false});
/**
 * The listener's service umask (0077) leaves the checkout and plan unreadable to the distinct candidate UID.
 * Grant that one UID read (and directory traverse) on exactly these two inputs. -P never follows a candidate
 * symlink to grant access to its target; nothing else of the listener's becomes readable.
 */
export const aclStage=({source,plan},run=args=>execFileSync('/usr/bin/setfacl',args,{encoding:'utf8',timeout:STAGE_TIMEOUT_MS,env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']}))=>{
 run(['-R','-P','-m','u:10000:rX','--',source]);run(['-m','u:10000:r','--',plan]);
};
/** Probe run as the candidate identity inside the container: the bound inputs are actually readable. */
const READABLE="const fs=require('fs');fs.accessSync('/input-plan.json',fs.constants.R_OK);fs.accessSync('/input',fs.constants.R_OK|fs.constants.X_OK);fs.accessSync('/input/package.json',fs.constants.R_OK);process.stdout.write('readable')";
const safePath=path=>{need(typeof path==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..')&&path!=='/','unsafe_container_input');return realpathSync(path);};
const ownerOf=r=>{
 need(r?.version===1&&r.repository==='AxalNetwork/StudioOS'&&r.profile==='linux-x64'&&/^[a-f0-9]{40}$/.test(r.sourceSha??'')&&['push','merge_group'].includes(r.event)&&ID(r.childRunId)&&r.childAttempt===1&&ID(r.generation)
   &&/^[a-f0-9-]{36}$/.test(r.requestId??'')&&/^worker-[1-6]-of-6$/.test(r.logicalShard??''),'invalid_isolation_receipt');
 return `${r.childRunId}-${r.childAttempt}-${r.generation}`;
};
/** Must be a root-owned local policy outside listener/job-writable directories, not workflow JSON. */
export function readContainerPolicy(path) {
 const actual=safePath(path),parts=actual.split('/');
 // Every parent directory: root-owned, not group/other-writable, not a link, so no one else can swap the file.
 for(let i=1;i<parts.length;i++) {
  const current=parts.slice(0,i).join('/')||'/',st=lstatSync(current);
  need(st.uid===0&&!(st.mode&0o022)&&!st.isSymbolicLink(),'untrusted_container_policy');
 }
 // The file itself is opened once, never through a final link, and every check runs on that open handle.
 let fd;
 try { fd=openSync(actual,constants.O_RDONLY|constants.O_NOFOLLOW); } catch { need(false,'untrusted_container_policy'); }
 let text;
 try {
  const opened=fstatSync(fd);
  need(opened.isFile()&&opened.uid===0&&!(opened.mode&0o022)&&opened.nlink===1&&opened.size<=4096,'untrusted_container_policy');
  text=readFileSync(fd,'utf8');
 } finally { closeSync(fd); }
 const policy=JSON.parse(text);
 need(policy.version===1&&DIGEST.test(policy.image??'')&&policy.nodeVersion==='22.23.3'&&policy.pythonVersion==='3.11.18','unreviewed_container_runtime');
 return Object.freeze(policy);
}
const same=isDeepStrictEqual;
/** Inspect actual engine state on the trusted host; caller/operator booleans never prove a boundary. */
export function verifiedContainer(info,{owner,source,plan,image,pidNamespace,mountNamespace,deadlineSeconds}) {
 const h=info?.HostConfig,c=info?.Config;
 return Boolean(info?.State?.Running===true&&ID(info.State.Pid)&&info.Image===image&&c?.User==='10001:10001'
   &&c.Labels?.[LABEL]===owner&&same(c.Entrypoint,['/bin/sh'])&&same(c.Cmd,['-c',SHELL])
   &&Array.isArray(c.Env)&&c.Env.length===ENV.length+1&&ENV.every(v=>c.Env.includes(v))
   &&ID(deadlineSeconds)&&c.Env.includes(`STUDIOOS_JOB_DEADLINE=${deadlineSeconds}`)
   &&h?.Privileged===false&&h.Init===true&&h.ReadonlyRootfs===true&&same(h.CapDrop,['ALL'])&&!(h.CapAdd?.length)
   &&same(h.SecurityOpt,['no-new-privileges'])&&h.PidMode===''&&h.IpcMode==='private'&&h.CgroupnsMode==='private'
   &&h.NetworkMode==='bridge'&&!(h.PortBindings&&Object.keys(h.PortBindings).length)&&!(h.Devices?.length)&&!(h.DeviceRequests?.length)
   &&!(h.VolumesFrom?.length)&&!(h.ExtraHosts?.length)&&!(h.Links?.length)
   &&h.PidsLimit===256&&h.Memory===4294967296&&h.NanoCpus===2000000000
   &&same(h.Tmpfs,{'/work':'rw,nosuid,nodev,size=4294967296,uid=10000,gid=10000,mode=0700','/tmp':'rw,nosuid,nodev,noexec,size=268435456,uid=10000,gid=10000,mode=0700'})
   &&Array.isArray(info.Mounts)&&info.Mounts.length===2&&[
    [source,'/input'],[plan,'/input-plan.json'],
   ].every(([src,dst])=>info.Mounts.some(m=>m.Type==='bind'&&m.Source===src&&m.Destination===dst&&m.RW===false&&m.Propagation==='rprivate'))
   &&pidNamespace===true&&mountNamespace===true);
}
/** Each object owns at most one exact container ID. Never accept a candidate container ID or shell command. */
export class JobContainer {
 constructor(policy,{engine=dockerEngine,spawnEngine=dockerSpawn,stage=aclStage,namespace=(pid,kind)=>readlinkSync(`/proc/${pid}/ns/${kind}`)!==readlinkSync(`/proc/self/ns/${kind}`)}={}) {
  need(policy?.version===1&&DIGEST.test(policy.image??'')&&policy.nodeVersion==='22.23.3'&&policy.pythonVersion==='3.11.18','unreviewed_container_runtime');
  this.policy=Object.freeze({...policy});this.engine=engine;this.spawnEngine=spawnEngine;this.stage=stage;this.namespace=namespace;this.owned=null;
  /** Set by the trusted supervisor to persist exact ownership before start, for recovery after process loss. */
  this.onOwned=null;
 }
 create(receipt,{source,plan}) {
  need(this.owned===null,'container_already_owned');const owner=ownerOf(receipt);
  const deadline=receipt.executionDeadline;
  need(Number.isSafeInteger(deadline)&&deadline-Date.now()>FINISH_RESERVE_MS&&deadline-Date.now()<=1590000,'invalid_container_deadline');
  source=safePath(source);plan=safePath(plan);
  need(lstatSync(source).isDirectory()&&lstatSync(plan).isFile()&&source!==plan,'unsafe_container_input');
  try { this.stage({source,plan}); } catch { need(false,'container_input_staging_failed'); }
  // Re-checked after staging: the absolute stop never moves later, and there must still be work time left.
  need(deadline-Date.now()>FINISH_RESERVE_MS,'insufficient_execution_budget');
  const deadlineSeconds=Math.floor(deadline/1000);
  const args=['create','--pull=never','--name',`studioos-job-${owner}`,'--label',`${LABEL}=${owner}`,
   '--user','10001:10001','--init','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--ipc','private','--cgroupns','private','--network','bridge','--pids-limit','256','--memory','4294967296','--cpus','2',
   '--tmpfs','/work:rw,nosuid,nodev,size=4294967296,uid=10000,gid=10000,mode=0700',
   '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=268435456,uid=10000,gid=10000,mode=0700',
   '--mount',`type=bind,src=${source},dst=/input,readonly,bind-propagation=rprivate`,
   '--mount',`type=bind,src=${plan},dst=/input-plan.json,readonly,bind-propagation=rprivate`,
   ...[...ENV,`STUDIOOS_JOB_DEADLINE=${deadlineSeconds}`].flatMap(e=>['--env',e]),'--entrypoint','/bin/sh',this.policy.image,'-c',SHELL];
  const id=this.engine(args).trim();need(/^[a-f0-9]{64}$/.test(id),'container_creation_unconfirmed');
  // Persist exact local ownership before start/inspection. A failure never broadens cleanup to a name/pool.
  this.owned={id,owner,source,plan,image:this.policy.image,receipt:receiptIdentity(receipt),deadlineSeconds};
  try { if(this.onOwned)this.onOwned({version:1,id,owner});this.engine(['start',id]);need(this.verifyIsolation({receipt}),'execution_isolation_unverified'); }
  catch {
   // A start/verification error must not leave a known owned process behind.
   try { this.cleanup(receipt); } catch { /* Unreadable ownership is never authority to remove a different container. */ }
   throw Error('container_start_or_isolation_failed');
  }
  return id;
 }
 verifyIsolation({receipt,profile}={}) {
  try {
   if(profile&&profile.id!=='linux-x64')return false;
   const owner=ownerOf(receipt);if(!this.owned||owner!==this.owned.owner||!same(receiptIdentity(receipt),this.owned.receipt))return false;
   const rows=JSON.parse(this.engine(['inspect',this.owned.id]));
   if(!Array.isArray(rows)||rows.length!==1||rows[0].Id!==this.owned.id)return false;
   const info=rows[0],pid=info.State?.Pid;
   if(!verifiedContainer(info,{...this.owned,pidNamespace:ID(pid)&&this.namespace(pid,'pid'),mountNamespace:ID(pid)&&this.namespace(pid,'mnt')}))return false;
   return this.engine(['exec','--user',CANDIDATE,this.owned.id,'/usr/local/bin/node','-p','process.versions.node']).trim()===this.policy.nodeVersion
     &&this.engine(['exec','--user',CANDIDATE,this.owned.id,'/usr/local/bin/node','-e',READABLE]).trim()==='readable'
     &&this.engine(['exec','--user',CANDIDATE,this.owned.id,'/usr/local/bin/python3','-c','import platform; print(platform.python_version())']).trim()===this.policy.pythonVersion;
  }catch{return false;}
 }
 /**
  * Installs and tests share the same isolated writable tmpfs; no candidate command runs on the host.
  * phase 'install' and 'test' are separate execs so an install failure is never reported as a test failure;
  * 'combined' is the single-exec form. Every phase ends FINISH_RESERVE_MS before the absolute deadline.
  */
 candidateExec({receipt,admitted,phase='combined'}) {
  need(['combined','install','test'].includes(phase),'invalid_candidate_phase');
  need(this.verifyIsolation({receipt}),'execution_isolation_unverified');
  need(admitted?.allowed===true&&same(admitted.identity,receipt)&&/^[a-f0-9]{40}$/.test(admitted.sourceSha??'')
   &&admitted.sourceSha===receipt.sourceSha&&ID(admitted.originalRunId)&&ID(admitted.originalAttempt)&&['push','merge_group'].includes(admitted.originalEvent)
   &&(admitted.originalEvent==='push'?admitted.sourceRef==='refs/heads/main':/^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9._/-]+$/.test(admitted.sourceRef??'')&&!admitted.sourceRef.includes('..')),'invalid_isolated_execution');
  const event=admitted.originalEvent==='push'?{ref:'refs/heads/main',after:admitted.sourceSha}:{merge_group:{base_sha:admitted.queueBaseSha,head_sha:admitted.sourceSha}};
  need(admitted.originalEvent!=='merge_group'||/^[a-f0-9]{40}$/.test(admitted.queueBaseSha??''),'invalid_isolated_execution');
  const env={PART:receipt.logicalShard,GITHUB_SHA:admitted.sourceSha,GITHUB_EVENT_NAME:admitted.originalEvent,GITHUB_REF:admitted.sourceRef,GITHUB_RUN_ID:String(admitted.originalRunId),GITHUB_RUN_ATTEMPT:String(admitted.originalAttempt),ORIGINAL_EVENT:JSON.stringify(event)};
  const setup='mkdir -p /work/source /work/home /work/traces; cp -R /input/. /work/source/; chmod -R u+rwX /work/source; cd /work/source; printf "%s" "$ORIGINAL_EVENT" > /work/event.json; unset ORIGINAL_EVENT; export GITHUB_EVENT_PATH=/work/event.json TEST_TRACE_DIR=/work/traces TEST_TRACE_ROOT=/work/source TMPDIR=/tmp; npm ci --prefix cloudflare-worker; npm ci';
  const test='cd /work/source; unset ORIGINAL_EVENT; export GITHUB_EVENT_PATH=/work/event.json TEST_TRACE_DIR=/work/traces TEST_TRACE_ROOT=/work/source TMPDIR=/tmp; exec node scripts/test-drift-parts.mjs "$PART" --plan-file /input-plan.json';
  const script=phase==='install'?setup:phase==='test'?test:`${setup}; ${test.slice(test.indexOf('exec '))}`;
  const workRemaining=receipt.executionDeadline-FINISH_RESERVE_MS-Date.now();
  need(Number.isSafeInteger(workRemaining)&&workRemaining>0&&workRemaining<=25*60000,'insufficient_execution_budget');
  return {args:['exec','--user',CANDIDATE,...Object.entries(env).flatMap(([k,v])=>['--env',`${k}=${v}`]),this.owned.id,'/bin/sh','-ec',script],timeout:workRemaining};
 }
 runCandidate({receipt,admitted}) {
  const {args,timeout}=this.candidateExec({receipt,admitted});
  try { return this.engine(args,{timeout}); }
  finally { this.cleanup(receipt); }
 }
 /**
  * Interruptible run for the trusted supervisor. It returns the raw observation and never removes the container:
  * the supervisor owns removal, so it can capture observations and export before verified removal. Killing the
  * engine client does not stop processes inside the container; the supervisor's exact-ID removal does.
  * status: success | failure (raw exitCode kept) | timed_out | cancelled | engine_failed (infrastructure).
  */
 async runCandidateInterruptible({receipt,admitted,signal,phase='combined',timers={setTimeout,clearTimeout}}) {
  if(signal?.aborted)return {phase,status:'cancelled',exitCode:null,signal:null};
  const {args,timeout}=this.candidateExec({receipt,admitted,phase});
  return await new Promise(accept=>{
   let child;
   try { child=this.spawnEngine(args); } catch { accept({phase,status:'engine_failed',exitCode:null,signal:null});return; }
   let stopped=null,exited=null;
   // Once the process has exited, a later abort or deadline cannot rewrite what was observed.
   child.once('exit',(code,sig)=>{if(!stopped)exited={code,sig};});
   const stop=reason=>{if(stopped||exited)return;stopped=reason;try{child.kill('SIGKILL');}catch{}};
   const abort=()=>stop('cancelled');
   const timer=timers.setTimeout(()=>stop('timed_out'),timeout);
   signal?.addEventListener('abort',abort,{once:true});
   const done=()=>{timers.clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   child.once('error',()=>{done();accept({phase,status:stopped??'engine_failed',exitCode:null,signal:null});});
   child.once('close',(closeCode,closeSig)=>{
    done();
    const code=exited?exited.code:closeCode,sig=exited?exited.sig:closeSig;
    // A stop we requested wins only over the engine client's own kill; a real exit observed first is kept.
    if(stopped)accept({phase,status:stopped,exitCode:null,signal:sig??null});
    else if(code===0)accept({phase,status:'success',exitCode:0,signal:null});
    // docker exec reports 125-127 for its own failures (daemon, exec setup, command not found).
    else if(Number.isSafeInteger(code)&&code>0&&code<125)accept({phase,status:'failure',exitCode:code,signal:null});
    else accept({phase,status:Number.isSafeInteger(code)?'engine_failed':'unknown',exitCode:Number.isSafeInteger(code)?code:null,signal:sig??null});
   });
  });
 }
 /** After removal: the exact recorded ID is gone. Unreadable engine state is never treated as removed. */
 verifyRemoved(record) { return JobContainer.isRemoved(record,{engine:this.engine}); }
 static isRemoved(record,{engine=dockerEngine}={}) {
  need(record?.version===1&&CONTAINER.test(record.id??'')&&OWNER.test(record.owner??''),'invalid_container_record');
  try { engine(['inspect',record.id]);return false; }
  catch (error) { return /No such (object|container)/i.test(String(error?.stderr??error?.message??'')); }
 }
 cleanup(receipt) {
  if(this.owned===null)return;
  need(ownerOf(receipt)===this.owned.owner&&same(receiptIdentity(receipt),this.owned.receipt),'container_cleanup_owner_mismatch');
  const rows=JSON.parse(this.engine(['inspect',this.owned.id]));
  need(rows.length===1&&rows[0].Id===this.owned.id&&rows[0].Config?.Labels?.[LABEL]===this.owned.owner,'container_cleanup_identity_mismatch');
  this.engine(['rm','--force',this.owned.id]);this.owned=null;
 }
 /**
  * After supervisor loss: remove exactly the recorded container, only while the engine still reports that ID,
  * its owner label and its fixed name. A missing container is already gone; any other mismatch refuses.
  */
 static recover(record,{engine=dockerEngine}={}) {
  need(record?.version===1&&CONTAINER.test(record.id??'')&&OWNER.test(record.owner??''),'invalid_container_record');
  let rows;
  try { rows=JSON.parse(engine(['inspect',record.id])); }
  catch (error) { if(/No such (object|container)/i.test(String(error?.stderr??error?.message??'')))return 'absent';throw Error('container_recovery_unreadable'); }
  need(Array.isArray(rows)&&rows.length===1&&rows[0].Id===record.id&&rows[0].Config?.Labels?.[LABEL]===record.owner&&rows[0].Name===`/studioos-job-${record.owner}`,'container_recovery_identity_mismatch');
  engine(['rm','--force',record.id]);
  return 'removed';
 }
}

/** Bound implementation for admitRunnerJob's verifyIsolation port; no caller flag is evidence. */
export function containerIsolationAdapter(job) {
 need(job instanceof JobContainer,'isolation_supervisor_required');
 return async ({receipt,context,profile}={})=>{
  if(context?.repository!=='AxalNetwork/StudioOS'||profile?.id!=='linux-x64'
    ||String(context.childRunId)!==String(receipt?.childRunId)||String(context.childAttempt)!==String(receipt?.childAttempt))return false;
  return job.verifyIsolation({receipt,profile});
 };
}
