/** D886 B2: one idempotent run per container. Commands acknowledge before callbacks. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { runBot, checkConfig } from './lifecycle.ts';
import { httpTransport, signRequest } from './callback.ts';
import { logLine } from './log.ts';
import { meetingBotNotice, MEETING_BOT_NOTICE_PUBLISHED } from '../notice.mjs';
import type { CallbackTransport, LogSink, MeetingAdapter, Platform, RunConfig } from './types.ts';

export interface RuntimeOptions {
  secret: string; callbackOrigin: string;
  adapter: (platform: Platform)=>Promise<MeetingAdapter>;
  log?: LogSink; now?: ()=>number;
  /** Tests inject the publication decision and the callback, never an env bypass. */
  notice?: (ventureName?:string)=>string;
  transport?: (uid:string)=>CallbackTransport;
}
const reply=(body:object,status=200)=>Response.json(body,{status});
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export class RuntimeHost {
  private readonly options: RuntimeOptions;
  private active: {uid:string; fingerprint:string; stop:AbortController; done:Promise<void>; ended:boolean}|null=null;
  private readonly shutdownController=new AbortController();
  constructor(options:RuntimeOptions){
    if(options.secret.length<32)throw new Error('runtime_secret_required');
    const origin=new URL(options.callbackOrigin);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('runtime_origin_invalid');
    this.options=options;
  }
  async fetch(request:Request):Promise<Response>{
    const path=new URL(request.url).pathname,now=this.options.now?.()??Date.now();
    if(request.method==='GET'&&path==='/healthz')return reply({ready:MEETING_BOT_NOTICE_PUBLISHED});
    if(request.method!=='POST'||!['/start','/stop'].includes(path))return reply({code:'not_found'},404);
    let raw='';
    try{
      const reader=request.body?.getReader(),decoder=new TextDecoder();let size=0;
      if(reader)try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>16_384){await reader.cancel();return reply({code:'too_large'},413);}raw+=decoder.decode(item.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
    }catch{return reply({code:'invalid_command'},400);}
    const timestamp=request.headers.get('x-meeting-bot-timestamp')??'',signature=request.headers.get('x-meeting-bot-signature')??'';
    if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300_000||!/^[a-f0-9]{64}$/.test(signature))return reply({code:'invalid_signature'},401);
    const expected=(await signRequest(this.options.secret,path,raw,Number(timestamp)))['x-meeting-bot-signature'];
    if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))return reply({code:'invalid_signature'},401);
    let command:any;
    try{command=JSON.parse(raw);}catch{return reply({code:'invalid_command'},400);}
    if(!uuid(command?.uid))return reply({code:'invalid_command'},400);
    if(path==='/stop'){
      const active=this.active;
      if(!active||active.uid!==command.uid)return reply({code:'run_not_found'},404);
      active.stop.abort();return reply({accepted:true});
    }
    if(this.shutdownController.signal.aborted)return reply({code:'runtime_stopping'},503);
    const fingerprint=createHash('sha256').update(raw).digest('hex');
    if(this.active)return this.active.uid===command.uid&&this.active.fingerprint===fingerprint?reply({accepted:true}):reply({code:'runtime_busy'},409);
    if(!['zoom','google_meet','teams'].includes(command.platform)||![30,120].includes(command.limit_minutes)
      ||typeof command.meeting_url!=='string'||command.meeting_url.length>2048)return reply({code:'invalid_command'},400);
    let cfg:RunConfig;
    try{
      cfg={runId:command.uid,platform:command.platform,meetingUrl:command.meeting_url,
        notice:(this.options.notice??(ventureName=>meetingBotNotice({ventureName})))(typeof command.venture_name==='string'?command.venture_name:undefined),limitMs:command.limit_minutes*60_000,
        deadlineAt:command.deadline_at,budgetDeadlineAt:command.budget_deadline_at};
      checkConfig(cfg,now);
    }catch{return reply({code:'runtime_not_ready'},503);}
    const stop=new AbortController();
    const active={uid:command.uid,fingerprint,stop,done:Promise.resolve(),ended:false};this.active=active;
    const transport=this.options.transport?.(command.uid)??httpTransport({baseUrl:new URL(`/api/meeting-bots/${command.uid}/`,this.options.callbackOrigin).href,runId:command.uid,key:this.options.secret});
    // Scheduling, not awaiting: a start/stop RPC may be called by the same
    // serialized DO that must receive the callback. Awaiting would deadlock.
    active.done=Promise.resolve().then(async()=>{
      try{
        const adapter=await this.options.adapter(cfg.platform);
        await runBot(cfg,{adapter,transport,stop:stop.signal,shutdown:this.shutdownController.signal,log:this.options.log});
      }catch{
        logLine(this.options.log??(()=>{}),'runtime_failed');
        try{await transport.status({state:'failed',code:'platform_blocked'});}catch{/* no raw exception */}
      }finally{active.ended=true;}
    });
    return reply({accepted:true},202);
  }
  async shutdown():Promise<void>{this.shutdownController.abort();await this.active?.done;}
  get running(){return this.active!==null&&!this.active.ended;}
}
