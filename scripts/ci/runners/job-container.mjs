/** D7905: trusted-host Linux candidate container boundary; no enrollment or image acquisition. */
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { receiptIdentity } from '../runner-admission.mjs';
import { lstatSync, readFileSync, realpathSync, readlinkSync } from 'node:fs';
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=n=>Number.isSafeInteger(n)&&n>0;
const need=(v,reason)=>{if(!v)throw Error(reason);};
const SHELL='sleep "$STUDIOOS_JOB_MAX_SECONDS"';
const ENV=['PATH=/usr/local/bin:/usr/bin:/bin','HOME=/work/home','LANG=C.UTF-8','CI=true','TZ=UTC'];
const LABEL='vc.axal.studioos.job';
const safePath=path=>{need(typeof path==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(path)&&!path.split('/').includes('..')&&path!=='/','unsafe_container_input');return realpathSync(path);};
const ownerOf=r=>{
 need(r?.version===1&&r.repository==='AxalNetwork/StudioOS'&&r.profile==='linux-x64'&&/^[a-f0-9]{40}$/.test(r.sourceSha??'')&&['push','merge_group'].includes(r.event)&&ID(r.childRunId)&&r.childAttempt===1&&ID(r.generation)
   &&/^[a-f0-9-]{36}$/.test(r.requestId??'')&&/^worker-[1-6]-of-6$/.test(r.logicalShard??''),'invalid_isolation_receipt');
 return `${r.childRunId}-${r.childAttempt}-${r.generation}`;
};
/** Must be a root-owned local policy outside listener/job-writable directories, not workflow JSON. */
export function readContainerPolicy(path) {
 const actual=safePath(path),parts=actual.split('/');
 for(let i=1;i<=parts.length;i++) {
  const current=parts.slice(0,i).join('/')||'/',st=lstatSync(current);
  need(st.uid===0&&!(st.mode&0o022)&&!st.isSymbolicLink(),'untrusted_container_policy');
 }
 const stat=lstatSync(actual);need(stat.isFile()&&stat.nlink===1&&stat.size<=4096,'untrusted_container_policy');
 const policy=JSON.parse(readFileSync(actual,'utf8'));
 need(policy.version===1&&DIGEST.test(policy.image??'')&&policy.nodeVersion==='22.23.3'&&policy.pythonVersion==='3.11.18','unreviewed_container_runtime');
 return Object.freeze(policy);
}
const same=isDeepStrictEqual;
/** Inspect actual engine state on the trusted host; caller/operator booleans never prove a boundary. */
export function verifiedContainer(info,{owner,source,plan,image,pidNamespace,mountNamespace,maxSeconds}) {
 const h=info?.HostConfig,c=info?.Config;
 return Boolean(info?.State?.Running===true&&ID(info.State.Pid)&&info.Image===image&&c?.User==='10001:10001'
   &&c.Labels?.[LABEL]===owner&&same(c.Entrypoint,['/bin/sh'])&&same(c.Cmd,['-c',SHELL])
   &&Array.isArray(c.Env)&&c.Env.length===ENV.length+1&&ENV.every(v=>c.Env.includes(v))
   &&ID(maxSeconds)&&maxSeconds<=1590&&c.Env.includes(`STUDIOOS_JOB_MAX_SECONDS=${maxSeconds}`)
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
 constructor(policy,{engine=(args,{timeout=30000}={})=>execFileSync('/usr/local/bin/docker',args,{encoding:'utf8',timeout,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'},stdio:args[0]==='exec'&&args.includes('/bin/sh')?['ignore','inherit','inherit']:['ignore','pipe','pipe']}),namespace=(pid,kind)=>readlinkSync(`/proc/${pid}/ns/${kind}`)!==readlinkSync(`/proc/self/ns/${kind}`)}={}) {
  need(policy?.version===1&&DIGEST.test(policy.image??'')&&policy.nodeVersion==='22.23.3'&&policy.pythonVersion==='3.11.18','unreviewed_container_runtime');
  this.policy=Object.freeze({...policy});this.engine=engine;this.namespace=namespace;this.owned=null;
 }
 create(receipt,{source,plan}) {
  need(this.owned===null,'container_already_owned');const owner=ownerOf(receipt);
  const remaining=receipt.executionDeadline-Date.now();need(Number.isSafeInteger(remaining)&&remaining>0&&remaining<=1590000,'invalid_container_deadline');
  const maxSeconds=Math.ceil(remaining/1000);
  source=safePath(source);plan=safePath(plan);
  need(lstatSync(source).isDirectory()&&lstatSync(plan).isFile()&&source!==plan,'unsafe_container_input');
  const args=['create','--pull=never','--name',`studioos-job-${owner}`,'--label',`${LABEL}=${owner}`,
   '--user','10001:10001','--init','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--ipc','private','--cgroupns','private','--network','bridge','--pids-limit','256','--memory','4294967296','--cpus','2',
   '--tmpfs','/work:rw,nosuid,nodev,size=4294967296,uid=10000,gid=10000,mode=0700',
   '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=268435456,uid=10000,gid=10000,mode=0700',
   '--mount',`type=bind,src=${source},dst=/input,readonly,bind-propagation=rprivate`,
   '--mount',`type=bind,src=${plan},dst=/input-plan.json,readonly,bind-propagation=rprivate`,
   ...[...ENV,`STUDIOOS_JOB_MAX_SECONDS=${maxSeconds}`].flatMap(e=>['--env',e]),'--entrypoint','/bin/sh',this.policy.image,'-c',SHELL];
  const id=this.engine(args).trim();need(/^[a-f0-9]{64}$/.test(id),'container_creation_unconfirmed');
  // Persist exact local ownership before start/inspection. A failure never broadens cleanup to a name/pool.
  this.owned={id,owner,source,plan,image:this.policy.image,receipt:receiptIdentity(receipt),maxSeconds};
  try { this.engine(['start',id]);need(this.verifyIsolation({receipt}),'execution_isolation_unverified'); }
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
   return this.engine(['exec','--user','10000:10000',this.owned.id,'/usr/local/bin/node','-p','process.versions.node']).trim()===this.policy.nodeVersion
     &&this.engine(['exec','--user','10000:10000',this.owned.id,'/usr/local/bin/python3','-c','import platform; print(platform.python_version())']).trim()===this.policy.pythonVersion;
  }catch{return false;}
 }
 /** Installs and tests share the same isolated writable tmpfs; no candidate command runs on the host. */
 runCandidate({receipt,admitted}) {
  need(this.verifyIsolation({receipt}),'execution_isolation_unverified');
  need(admitted?.allowed===true&&same(admitted.identity,receipt)&&/^[a-f0-9]{40}$/.test(admitted.sourceSha??'')
   &&admitted.sourceSha===receipt.sourceSha&&ID(admitted.originalRunId)&&ID(admitted.originalAttempt)&&['push','merge_group'].includes(admitted.originalEvent)
   &&(admitted.originalEvent==='push'?admitted.sourceRef==='refs/heads/main':/^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9._/-]+$/.test(admitted.sourceRef??'')&&!admitted.sourceRef.includes('..')),'invalid_isolated_execution');
  const event=admitted.originalEvent==='push'?{ref:'refs/heads/main',after:admitted.sourceSha}:{merge_group:{base_sha:admitted.queueBaseSha,head_sha:admitted.sourceSha}};
  need(admitted.originalEvent!=='merge_group'||/^[a-f0-9]{40}$/.test(admitted.queueBaseSha??''),'invalid_isolated_execution');
  const env={PART:receipt.logicalShard,GITHUB_SHA:admitted.sourceSha,GITHUB_EVENT_NAME:admitted.originalEvent,GITHUB_REF:admitted.sourceRef,GITHUB_RUN_ID:String(admitted.originalRunId),GITHUB_RUN_ATTEMPT:String(admitted.originalAttempt),ORIGINAL_EVENT:JSON.stringify(event)};
  const script='mkdir -p /work/source /work/home /work/traces; cp -R /input/. /work/source/; chmod -R u+rwX /work/source; cd /work/source; printf "%s" "$ORIGINAL_EVENT" > /work/event.json; unset ORIGINAL_EVENT; export GITHUB_EVENT_PATH=/work/event.json TEST_TRACE_DIR=/work/traces TEST_TRACE_ROOT=/work/source TMPDIR=/tmp; npm ci --prefix cloudflare-worker; npm ci; exec node scripts/test-drift-parts.mjs "$PART" --plan-file /input-plan.json';
  const deadlineRemaining=receipt.executionDeadline-Date.now();need(Number.isSafeInteger(deadlineRemaining)&&deadlineRemaining>0&&deadlineRemaining<=25*60000+90000,'invalid_container_deadline');
  const remaining=Math.min(deadlineRemaining,25*60000);
  try { return this.engine(['exec','--user','10000:10000',...Object.entries(env).flatMap(([k,v])=>['--env',`${k}=${v}`]),this.owned.id,'/bin/sh','-ec',script],{timeout:remaining}); }
  finally { this.cleanup(receipt); }
 }
 cleanup(receipt) {
  if(this.owned===null)return;
  need(ownerOf(receipt)===this.owned.owner&&same(receiptIdentity(receipt),this.owned.receipt),'container_cleanup_owner_mismatch');
  const rows=JSON.parse(this.engine(['inspect',this.owned.id]));
  need(rows.length===1&&rows[0].Id===this.owned.id&&rows[0].Config?.Labels?.[LABEL]===this.owned.owner,'container_cleanup_identity_mismatch');
  this.engine(['rm','--force',this.owned.id]);this.owned=null;
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
