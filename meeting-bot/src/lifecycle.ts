/** D886 B2: notice before capture, Worker-funded runtime, bounded cleanup. */
import { ADMIT_TIMEOUT_MS, ALONE_MS, BOT_NAME, EVENT_FLUSH_MS, HEARTBEAT_MS, NOTICE_TRIES, PAID_LIMIT_MS } from './constants.ts';
import { TransportError } from './callback.ts';
import { EventBatcher } from './events.ts';
import { logLine } from './log.ts';
import { ChunkUploader, withRetry } from './uploader.ts';
import { Chunker } from './wav.ts';
import { AdapterFailure } from './types.ts';
import type { CallbackTransport, Clock, FailureCode, LeaveReason, LogSink, MeetingAdapter, RunConfig, StatusReport, Unsubscribe } from './types.ts';

export interface RunDeps {
  readonly adapter: MeetingAdapter; readonly transport: CallbackTransport; readonly clock?: Clock; readonly log?: LogSink;
  readonly stop?: AbortSignal;
  /** SIGTERM/SIGINT: finish one bounded flush, then exit. */
  readonly shutdown?: AbortSignal;
}
export interface RunResult extends StatusReport { readonly state: 'left'|'failed' }
export const realClock: Clock = {
  now:()=>Date.now(), setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);return()=>clearTimeout(t);},
  sleep:ms=>new Promise(r=>setTimeout(r,ms)),
};
export function checkConfig(cfg: RunConfig, now=Date.now()): void {
  if (!cfg.notice?.trim()) throw new Error('notice_required');
  if (!Number.isFinite(cfg.limitMs)||cfg.limitMs<=0||cfg.limitMs>PAID_LIMIT_MS) throw new Error('limit_out_of_range');
  if (!Number.isSafeInteger(cfg.deadlineAt)||cfg.deadlineAt<=now||cfg.deadlineAt>now+cfg.limitMs
    ||!Number.isSafeInteger(cfg.budgetDeadlineAt)||cfg.budgetDeadlineAt<=now||cfg.budgetDeadlineAt>cfg.deadlineAt) throw new Error('lease_required');
}
const codeOf=(e:unknown):FailureCode=>e instanceof AdapterFailure?e.code:'platform_blocked';
export async function runBot(cfg: RunConfig,deps: RunDeps): Promise<RunResult> {
  const clock=deps.clock??realClock,log=deps.log??(()=>{}),{adapter,transport}=deps;
  checkConfig(cfg,clock.now());
  const control=new AbortController();
  let fundedUntil=0,dataStop:AbortController|null=null,leaving:Promise<void>|null=null;
  let reason: LeaveReason='stopped', finished=false, heartbeatCancel=()=>{},leaseCancel=()=>{};
  const end=(r:LeaveReason)=>{if(!control.signal.aborted){reason=r;control.abort();void leave();}};
  const onStop=()=>end('stopped'),onShutdown=()=>end('interrupted');
  deps.stop?.addEventListener('abort',onStop);deps.shutdown?.addEventListener('abort',onShutdown);
  const planCancel=clock.setTimeout(()=>end('time_limit'),cfg.deadlineAt-clock.now());
  const renew=(deadline:number)=>{
    // Stale or malformed replies never extend a funded interval.
    if(!Number.isSafeInteger(deadline)||deadline<=clock.now()) return;
    fundedUntil=Math.min(deadline,cfg.deadlineAt);
    leaseCancel();leaseCancel=clock.setTimeout(()=>end('tokens'),Math.min(deadline,cfg.deadlineAt)-clock.now());
  };
  renew(cfg.budgetDeadlineAt);
  const heartbeat=async()=>{
    if(finished||control.signal.aborted)return;
    try{renew(await transport.heartbeat());}catch(error){
      if(error instanceof TransportError&&[401,402,403,409].includes(error.status))end(error.status===402?'tokens':'stopped');
      logLine(log,'heartbeat_unsent');
    }
    if(!finished&&!control.signal.aborted)heartbeatCancel=clock.setTimeout(()=>{void heartbeat();},HEARTBEAT_MS);
  };
  heartbeatCancel=clock.setTimeout(()=>{void heartbeat();},HEARTBEAT_MS);
  const report=async(r:StatusReport,tries?:number)=>{
    const terminal=r.state==='failed'||r.state==='left';
    logLine(log,'status',{platform:cfg.platform,state:r.state,reason:r.reason,code:r.code});
    const ok=await withRetry(async()=>{const lease=await transport.status(r);if(typeof lease==='number')renew(lease);},clock,tries??(terminal?1:3),terminal?undefined:control.signal);
    if(!ok)logLine(log,'status_unsent',{state:r.state});
    return ok;
  };
  const leave=()=>leaving??(leaving=(async()=>{
    let cancel=()=>{};
    await Promise.race([Promise.resolve().then(()=>adapter.leave()).catch(()=>{}),new Promise<void>(resolve=>{cancel=clock.setTimeout(resolve,5000);})]);cancel();
  })());
  const failure=async(code:FailureCode):Promise<RunResult>=>{
    await leave();const result:RunResult={state:'failed',code};await report(result);return result;
  };
  const early=async():Promise<RunResult>=>{
    await leave();const result:RunResult={state:'left',reason,chunks:0,last_seq:-1,chunks_failed:0,events:0,events_dropped:0};await report(result);return result;
  };
  const interrupted=new Promise<'stopped'>(resolve=>control.signal.addEventListener('abort',()=>resolve('stopped'),{once:true}));
  const attempt=async<T>(work:Promise<T>):Promise<T|'stopped'>=>{
    work.catch(()=>{});
    return control.signal.aborted?'stopped':Promise.race([work,interrupted]);
  };
  try {
    if(deps.stop?.aborted)onStop();if(deps.shutdown?.aborted)onShutdown();
    let valid=false;
    try{const url=new URL(cfg.meetingUrl);valid=url.protocol==='https:'&&!url.username&&!url.password;}catch{/* fail below */}
    if(!valid)return await failure('link_invalid');
    if(control.signal.aborted)return await early();
    if(!await report({state:'joining'}))return await failure('platform_blocked');
    try {
      if(await attempt(adapter.join({url:cfg.meetingUrl,botName:BOT_NAME,signal:control.signal}))==='stopped')return await early();
      if(!await report({state:'waiting_room'}))return await failure('platform_blocked');
      let cancel=()=>{};
      const timeout=new Promise<'timeout'>(resolve=>{cancel=clock.setTimeout(()=>resolve('timeout'),ADMIT_TIMEOUT_MS);});
      try {
        const admission=await Promise.race([attempt(adapter.admitted(control.signal)),timeout]);
        if(admission==='stopped')return await early();
        if(admission==='timeout'){control.abort();return await failure('not_admitted');}
      }finally{cancel();}
    }catch(e){return control.signal.aborted?await early():await failure(codeOf(e));}
    const announced=await attempt(withRetry(()=>adapter.sendChat(cfg.notice),clock,NOTICE_TRIES));
    if(announced==='stopped'||control.signal.aborted)return await early();
    if(!announced)return await failure('notice_failed');
    logLine(log,'notice_posted',{platform:cfg.platform});
    if(!await report({state:'recording'}))return await failure('platform_blocked');
    if(control.signal.aborted)return await early();
    dataStop=new AbortController();
    const origin=clock.now(),chunker=new Chunker(),uploader=new ChunkUploader(transport,clock,log,dataStop.signal),events=new EventBatcher(transport,clock,log,origin,dataStop.signal);
    const present=new Set<string>(),seen=new Set<string>(),subs:Unsubscribe[]=[];
    let aloneCancel:(()=>void)|null=null,flushCancel=()=>{},finish:(why:LeaveReason)=>void=()=>{};
    let capturing=true;
    const done=new Promise<LeaveReason>(resolve=>{finish=why=>{capturing=false;resolve(why);};});
    const stopRecording=()=>finish(reason);
    control.signal.addEventListener('abort',stopRecording,{once:true});
    const checkAlone=()=>{
      if(!present.size&&!aloneCancel)aloneCancel=clock.setTimeout(()=>finish('alone'),ALONE_MS);
      if(present.size&&aloneCancel){aloneCancel();aloneCancel=null;}
    };
    const authorised=()=>{
      if(clock.now()>=cfg.deadlineAt)end('time_limit');
      else if(clock.now()>=fundedUntil)end('tokens');
      return capturing&&!control.signal.aborted;
    };
    const tick=()=>{void events.flush();flushCancel=clock.setTimeout(tick,EVENT_FLUSH_MS);};
    let ended:LeaveReason;
    try {
      subs.push(adapter.ended(()=>finish('call_ended')));
      subs.push(adapter.roster(c=>{
        if(!authorised())return;
        if(c.kind==='join'){present.add(c.key);seen.add(c.key);}else present.delete(c.key);
        events.roster(c);checkAlone();
      }));
      subs.push(adapter.speakers(c=>{if(authorised())events.speaker(c);}));
      subs.push(adapter.audio(f=>{if(authorised())for(const chunk of chunker.push(f.samples))uploader.add(chunk);}));
      tick();checkAlone();if(control.signal.aborted)stopRecording();
      ended=await done;
    } catch(e) {return await failure(codeOf(e));}
    finally {
      capturing=false;
      for(const off of subs){try{off();}catch{/* continue cleanup */}}
      flushCancel();if(aloneCancel)(aloneCancel as ()=>void)();control.signal.removeEventListener('abort',stopRecording);
    }
    // Capture and timers stop before leave or any potentially slow upload.
    await leave();
    finished=true;heartbeatCancel();leaseCancel();
    events.speaker({key:null});
    const partial=chunker.flush();if(partial)uploader.add(partial);
    // B1's Stop drain is 30s; finish before it, even when a network stays down.
    let drainCancel=()=>{},timedOut=false;
    await Promise.race([
      Promise.all([uploader.drain(),events.flush()]),
      new Promise<void>(resolve=>{drainCancel=clock.setTimeout(()=>{timedOut=true;resolve();},20_000);}),
    ]);drainCancel();
    const incomplete=timedOut||uploader.failedCount>0||events.droppedCount+events.pendingCount>0;
    const result:RunResult={state:incomplete?'failed':'left',...(incomplete?{code:'processing_failed' as const}:{reason:ended}),
      chunks:uploader.storedCount,last_seq:uploader.lastSeq,chunks_failed:uploader.failedCount,events:events.sentCount,
      events_dropped:events.droppedCount+events.pendingCount,participants:seen.size};
    dataStop.abort();
    await report(result,1);return result;
  } finally {
    finished=true;dataStop?.abort();planCancel();leaseCancel();heartbeatCancel();control.abort();transport.close?.();
    deps.stop?.removeEventListener('abort',onStop);deps.shutdown?.removeEventListener('abort',onShutdown);
  }
}
