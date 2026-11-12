/** D5675: preview-only authenticated synthetic startup/callback gate on the existing preview host/namespace; no customer meeting or site database. */
import { signRequest } from '../src/callback';
export type CanaryEnv={CF_BOT_AUDIENCE?:string;PREVIEW_CANARY_ENABLED?:string;PREVIEW_CANARY_ORIGIN?:string;MEETING_BOT_PREVIEW_SECRET?:string;
  MEETING_BOT_VERSION?:string;MEETING_BOT_CONTAINER?:DurableObjectNamespace};
export type CanaryJob={version:1;audience:'preview';script:'studioos-meeting-bot-preview';id:string;nonce:string;revision:string;created_ms:number;op:'run'|'callback'};
export type CanaryReceipt={version:1;audience:'preview';script:'studioos-meeting-bot-preview';id:string;nonce:string;revision:string;
  state:'pass'|'fail';stage:'startup'|'readiness'|'callback'|'cleanup'|'complete';elapsed_ms:number;image_digest:string|null;cleaned:boolean};
const enc=new TextEncoder(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
export function previewOrigin(value:string|undefined):string|null{
  try{const u=new URL(value||'');return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'
    &&/^studioos-meeting-bot-preview\.[a-z0-9-]+\.workers\.dev$/.test(u.hostname)?u.origin:null;}catch{return null;}
}
export async function previewKey(root:string,job:CanaryJob,role:'run'|'callback'|'receipt'){
  const key=await crypto.subtle.importKey('raw',enc.encode(root),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify(['preview-canary-v1',role,job.id,job.nonce,job.revision]))));
}
export function parseCanaryJob(value:unknown,now=Date.now()):CanaryJob|null{
  const j=value as CanaryJob;
  if(!j||Object.keys(j).some(k=>!['version','audience','script','id','nonce','revision','created_ms','op'].includes(k))||j.version!==1||j.audience!=='preview'||j.script!=='studioos-meeting-bot-preview'
    ||!uuid.test(j.id)||!(/^[a-f0-9]{32}$/).test(j.nonce)||!(/^[a-f0-9]{40}$/).test(j.revision)||!['run','callback'].includes(j.op)
    ||!Number.isSafeInteger(j.created_ms)||Math.abs(now-j.created_ms)>300000)return null;
  return j;
}
async function readBody(request:Pick<Request,'body'>):Promise<string>{
  if(!request.body)throw Error('invalid_canary');const r=request.body.getReader();let length=0;const chunks:Uint8Array[]=[];
  try{for(;;){const b=await r.read();if(b.done)break;length+=b.value.length;if(length>2048){await r.cancel();throw Error('invalid_canary');}chunks.push(b.value);}}
  finally{r.releaseLock();}
  const bytes=new Uint8Array(length);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length;}return new TextDecoder().decode(bytes);
}
export async function verifyPreviewRequest(request:Request,env:CanaryEnv,now=Date.now()):Promise<CanaryJob|null>{
  if(env.CF_BOT_AUDIENCE!=='preview'||env.PREVIEW_CANARY_ENABLED!=='on'||(env.MEETING_BOT_PREVIEW_SECRET?.length??0)<32)return null;
  const url=new URL(request.url),origin=previewOrigin(env.PREVIEW_CANARY_ORIGIN);if(!origin||url.origin!==origin||request.method!=='POST'||url.search||url.hash)return null;
  try{
    const raw=await readBody(request),job=parseCanaryJob(JSON.parse(raw),now);if(!job||job.revision!==env.MEETING_BOT_VERSION)return null;
    if(url.pathname!==(job.op==='run'?'/canary/run':`/canary/${job.id}/callback`))return null;
    const ts=request.headers.get('x-meeting-bot-timestamp')||'',signature=request.headers.get('x-meeting-bot-signature')||'';
    if(!/^\d{13}$/.test(ts)||Math.abs(now-Number(ts))>300000||!/^[a-f0-9]{64}$/.test(signature))return null;
    const key=await crypto.subtle.importKey('raw',enc.encode(await previewKey(env.MEETING_BOT_PREVIEW_SECRET!,job,job.op)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const bytes=Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16));
    return await crypto.subtle.verify('HMAC',key,bytes,enc.encode(`v1:${ts}:POST:${url.pathname}:${raw}`))?job:null;
  }catch{return null;}
}
export async function previewIngress(request:Request,env:CanaryEnv):Promise<Response>{
  const job=await verifyPreviewRequest(request.clone(),env);if(!job||!env.MEETING_BOT_CONTAINER)return new Response(null,{status:404});
  const stub=env.MEETING_BOT_CONTAINER.get(env.MEETING_BOT_CONTAINER.idFromName('canary:control'));
  const response=await stub.fetch(request);
  if(job.op!=='run')return response;
  const raw=await readBody(response);if(raw.length>2048)return Response.json({error:'canary_unavailable'},{status:503});
  const headers=await signRequest(await previewKey(env.MEETING_BOT_PREVIEW_SECRET!,job,'receipt'),'/canary/receipt',raw,Date.now());
  return new Response(raw,{status:response.status,headers:{...headers,'content-type':'application/json','cache-control':'no-store'}});
}
type CanaryState={job:CanaryJob;callback:boolean;receipt?:CanaryReceipt};
type CanaryHistory={job:CanaryJob;receipt:CanaryReceipt};
/** Called inside the host's existing concurrency guard; long work is returned to run outside it so callbacks can enter. */
export async function preparePreviewCanary(request:Request,env:CanaryEnv,state:DurableObjectState,options:CanaryOptions={}):Promise<Response|(()=>Promise<Response>)>{
  const job=await verifyPreviewRequest(request.clone(),env);if(!job||!state.container)return new Response(null,{status:404});
  const old=await state.storage.get<CanaryState>('preview-canary');
  if(job.op==='callback'){
    if(!old||old.receipt||['id','nonce','revision','created_ms','audience','script'].some(k=>old.job[k as keyof CanaryJob]!==job[k as keyof CanaryJob]))return Response.json({accepted:false},{status:409});
    if(!old.callback)await state.storage.put('preview-canary',{...old,callback:true});
    return Response.json({accepted:true});
  }
  const history=(await state.storage.get<CanaryHistory[]>('preview-canary-history')??[]).filter(x=>x.job.created_ms+600000>Date.now());
  const prior=history.find(x=>x.job.id===job.id);
  if(prior)return prior.job.nonce===job.nonce&&prior.job.revision===job.revision&&prior.job.created_ms===job.created_ms?Response.json(prior.receipt,{status:prior.receipt.state==='pass'?200:503}):Response.json({error:'canary_conflict'},{status:409});
  if(old){
    if(old.job.id===job.id)return old.job.nonce===job.nonce&&old.job.revision===job.revision&&old.job.created_ms===job.created_ms&&old.receipt?Response.json(old.receipt,{status:old.receipt.state==='pass'?200:503}):Response.json({error:'canary_busy'},{status:409});
    // One control object fences all canaries: a new ID cannot bypass unknown cleanup of the previous instance.
    if(!old.receipt?.cleaned||history.length>=20)return Response.json({error:'canary_cleanup_unconfirmed'},{status:409});
    history.push({job:old.job,receipt:old.receipt});await state.storage.put('preview-canary-history',history);
    await state.storage.delete(['preview-canary','lease']);
  }
  if(await state.storage.get('lease')||state.container.running)return Response.json({error:'canary_busy'},{status:409});
  await state.storage.put('preview-canary',{job,callback:false});
  // Existing host alarm reconciles this synthetic lease even if the request/instance dies.
  await state.storage.put('lease',{uid:job.id,deadline:Date.now()+120000,funded:Date.now()+120000,fingerprint:'preview-canary',started:false,stopped:false});
  await state.storage.setAlarm(Date.now()+150000);
  return ()=>drivePreviewCanary(job,env,state,options);
}
type CanaryOptions={clock?:()=>number;pause?:()=>Promise<void>};
async function drivePreviewCanary(job:CanaryJob,env:CanaryEnv,state:DurableObjectState,options:CanaryOptions={}):Promise<Response>{
  const clock=options.clock??Date.now,pause=options.pause??(()=>new Promise<void>(r=>setTimeout(r,100)));
  const container=state.container!,start=clock();let stage:CanaryReceipt['stage']='startup',cleaned=false,passed=false,image_digest:string|null=null;
  try{
    const image=container.images.runtime;if(!image||!/@sha256:[a-f0-9]{64}$/.test(image))throw Error('image_unknown');image_digest=image.slice(image.lastIndexOf('@')+1);
    const key=await previewKey(env.MEETING_BOT_PREVIEW_SECRET!,job,'callback');
    container.start({image,instance:'standard-2',enableInternet:true,env:{PORT:'8080',MEETING_BOT_SECRET:key,MEETING_BOT_CALLBACK_ORIGIN:previewOrigin(env.PREVIEW_CANARY_ORIGIN)!,MEETING_BOT_VERSION:job.revision}});
    await container.setInactivityTimeout(120000);stage='readiness';
    const port=container.getTcpPort(8080),until=clock()+40000;
    for(;;){
      try{const r=await port.fetch(new Request('http://runtime.internal/healthz',{signal:AbortSignal.timeout(1500)}));const h=JSON.parse(await readBody(r)) as {ready?:boolean;version?:string};if(r.ok&&h.ready===true&&h.version===job.revision)break;}catch{}
      if(clock()>=until)throw Error('readiness_failed');await pause();
    }
    stage='callback';
    const payload={target:`${previewOrigin(env.PREVIEW_CANARY_ORIGIN)}/canary/${job.id}/callback`,job:{...job,op:'callback'},key};
    const process=await container.exec(['node','--experimental-strip-types','--no-warnings','/app/src/previewCanary.ts'],{stdin:'pipe',stdout:'ignore',stderr:'ignore',user:'node'});
    if(!process.stdin)throw Error('canary_pipe_unavailable');const writer=process.stdin.getWriter();await writer.write(enc.encode(JSON.stringify(payload)));await writer.close();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{const code=await Promise.race([process.exitCode,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('callback_timeout')),15000);})]);if(code!==0)throw Error('callback_failed');}
    finally{if(timer!==undefined)clearTimeout(timer);}
    if((await state.storage.get<CanaryState>('preview-canary'))?.callback!==true)throw Error('callback_missing');passed=true;
  }catch{passed=false;}
  finally{try{await container.destroy();cleaned=true;}catch{passed=false;stage='cleanup';}}
  const receipt:CanaryReceipt={version:1,audience:'preview',script:'studioos-meeting-bot-preview',id:job.id,nonce:job.nonce,revision:job.revision,
    state:passed&&cleaned?'pass':'fail',stage:passed&&cleaned?'complete':stage,elapsed_ms:clock()-start,image_digest,cleaned};
  const current=await state.storage.get<CanaryState>('preview-canary');await state.storage.put('preview-canary',{job,callback:current?.callback===true,receipt});
  const lease=await state.storage.get<Record<string,unknown>>('lease');if(lease)await state.storage.put('lease',{...lease,stopped:true});
  const history=await state.storage.get<CanaryHistory[]>('preview-canary-history')??[];
  await state.storage.setAlarm(cleaned?Math.min(job.created_ms+600000,...history.map(x=>x.job.created_ms+600000)):Date.now()+30000);
  return Response.json(receipt,{status:receipt.state==='pass'?200:503});
}

/** Alarm cleanup is independent of the admission flag. Only this synthetic lease may be removed. */
export async function reconcilePreviewCanaryAlarm(state:DurableObjectState,now=Date.now()):Promise<boolean>{
  const c=await state.storage.get<CanaryState>('preview-canary'),prior=await state.storage.get<CanaryHistory[]>('preview-canary-history');
  const history=(prior??[]).filter(x=>x.job.created_ms+600000>now);
  if(prior){if(history.length)await state.storage.put('preview-canary-history',history);else await state.storage.delete('preview-canary-history');}
  if(!c){if(prior){if(history.length)await state.storage.setAlarm(Math.min(...history.map(x=>x.job.created_ms+600000)));else await state.storage.deleteAlarm();return true;}return false;}
  const lease=await state.storage.get<Record<string,unknown>>('lease');
  if(lease?.fingerprint!=='preview-canary'||lease.uid!==c.job.id)throw Error('canary_lease_mismatch');
  if(c.receipt?.cleaned&&now>=c.job.created_ms+600000){await state.storage.delete(['preview-canary','lease']);if(history.length)await state.storage.setAlarm(Math.min(...history.map(x=>x.job.created_ms+600000)));else await state.storage.deleteAlarm();return true;}
  if(!c.receipt?.cleaned&&now>=Number(lease.deadline)){
    let cleaned=false;try{await state.container?.destroy();cleaned=Boolean(state.container);}catch{}
    const receipt:CanaryReceipt=c.receipt?{...c.receipt,cleaned}:{version:1,audience:'preview',script:'studioos-meeting-bot-preview',id:c.job.id,nonce:c.job.nonce,revision:c.job.revision,state:'fail',stage:'cleanup',elapsed_ms:Math.max(0,now-c.job.created_ms),image_digest:null,cleaned};
    await state.storage.put('preview-canary',{...c,receipt});
    await state.storage.put('lease',{...lease,stopped:true});
    await state.storage.setAlarm(cleaned?Math.max(now+1,c.job.created_ms+600000):now+30000);return true;
  }
  await state.storage.setAlarm(Math.min(c.receipt?.cleaned?c.job.created_ms+600000:Number(lease.deadline),...history.map(x=>x.job.created_ms+600000)));return true;
}
export async function validPreviewReceipt(headers:Headers,raw:string,root:string,job:CanaryJob,now=Date.now()):Promise<CanaryReceipt|null>{
 try{const r=JSON.parse(raw) as CanaryReceipt,ts=headers.get('x-meeting-bot-timestamp')||'',sig=headers.get('x-meeting-bot-signature')||'';
  if(raw.length>2048||!/^\d{13}$/.test(ts)||Math.abs(now-Number(ts))>300000||!(/^[a-f0-9]{64}$/).test(sig)||r.version!==1||r.audience!=='preview'||r.script!=='studioos-meeting-bot-preview'||r.id!==job.id||r.nonce!==job.nonce||r.revision!==job.revision
    ||!['pass','fail'].includes(r.state)||!['startup','readiness','callback','cleanup','complete'].includes(r.stage)||typeof r.cleaned!=='boolean'||!Number.isSafeInteger(r.elapsed_ms)||r.elapsed_ms<0||r.elapsed_ms>180000
    ||!(r.image_digest===null||/^sha256:[a-f0-9]{64}$/.test(r.image_digest))||Object.keys(r).some(k=>!['version','audience','script','id','nonce','revision','state','stage','elapsed_ms','image_digest','cleaned'].includes(k)))return null;
  const key=await crypto.subtle.importKey('raw',enc.encode(await previewKey(root,job,'receipt')),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('HMAC',key,Uint8Array.from(sig.match(/../g)!,s=>parseInt(s,16)),enc.encode(`v1:${ts}:POST:/canary/receipt:${raw}`))?r:null;
 }catch{return null;}
}

export function previewPromotionEligible(r:CanaryReceipt|null):boolean{
 return Boolean(r&&r.state==='pass'&&r.stage==='complete'&&r.cleaned===true&&r.image_digest!==null);
}
