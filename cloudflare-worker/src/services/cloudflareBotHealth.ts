/** D5674: content-free recording-stage evidence, shared site/host episode keys and stage-qualified recovery; no second recording ledger. */
import type { Env } from '../types';
import { botEnabled, BOT_HEARTBEAT_MS, BOT_PROCESSING_MAX_MS } from './meetingBots';
import { RUN_START_MS, runtimeErrorCode, runtimeVersion } from './meetingBotStartup';
import { cfHash, cfAudience, parseCfReceipt, type CfReceipt } from './cloudflareSourceReceipt';
export type BotProvider='zoom'|'google_meet'|'teams';
export const RECORDING_STAGES=['demand','dispatch','container_scheduling','container_start','readiness','callback','admission','notice','capture','upload','processing','terminal'] as const;
export type RecordingStage=typeof RECORDING_STAGES[number];
/** Internal only: key is the existing recording uid; it never enters a source receipt, route body or Slack. */
export type BotStageEvidence={key:string;revision:number;provider:BotProvider;status:string;created_ms:number;scheduled_ms:number;started_ms:number|null;ended_ms:number|null;
  heartbeat_ms:number|null;callback_ms:number|null;runtime_error:string|null;failure_code:string|null;runtime_version:string|null;
  processing_ms:number|null;final_receipt:boolean|null;stage_checks?:Partial<Record<RecordingStage,{at_ms:number;result:'pass'|'fail'}>>;
  failure_stage?:'upload'|'processing'|null};
export type BotOpenEpisode={component:CfReceipt['component'];provider:BotProvider;opened_ms:number;version:string|null};
export type BotHealthWindow={now:number;since:number;complete:boolean;script:'studioos-meeting-bot'|'studioos-meeting-bot-preview';
  enabled:Record<BotProvider,boolean>;runs:BotStageEvidence[];episodes_complete?:boolean;openEpisodes?:BotOpenEpisode[]};
type Symptom={component:CfReceipt['component'];code:CfReceipt['code'];state:CfReceipt['state']};
function symptom(r:BotStageEvidence,w:BotHealthWindow):Symptom{
  if(!w.enabled[r.provider]&&r.status==='queued')return {component:'recording',code:'disabled',state:'disabled'};
  if(r.status==='stopped')return {component:'recording',code:'cancelled',state:'activity'};
  if(r.status==='done')return {component:'recording',code:r.final_receipt===true?'success':'not_verified',state:r.final_receipt===true?'activity':'unknown'};
  if(r.status==='failed'){
    if(runtimeErrorCode(r.runtime_error))return {component:'startup',code:'startup_failed',state:'firing'};
    if(['runtime_unavailable','heartbeat_timeout'].includes(r.failure_code||'')&&r.callback_ms===null)return {component:'callback',code:'callback_missing',state:'firing'};
    if(['admission_refused','unsupported_platform','unsupported_link','consent_required','meeting_ended','budget_refused'].includes(r.failure_code||''))return {component:'admission',code:'provider_denied',state:'activity'};
    if(r.failure_stage==='upload')return {component:'upload',code:'upload_failed',state:'firing'};
    if(['processing_failed','processing_timeout','transcription_failed'].includes(r.failure_code||''))return {component:'processing',code:'processing_failed',state:'firing'};
    if(r.failure_code==='notice_failed')return {component:'notice',code:'not_verified',state:'firing'};
    if(['heartbeat_timeout','recording_failed','runtime_failed','no_audio'].includes(r.failure_code||''))return {component:'capture',code:'capture_stalled',state:'firing'};
    return {component:'recording',code:'not_verified',state:'firing'};
  }
  if(r.status==='queued'&&w.now>r.scheduled_ms+RUN_START_MS)return {component:'startup',code:'startup_failed',state:'firing'};
  if(r.status==='processing')return w.now-(r.processing_ms??r.ended_ms??w.now)>BOT_PROCESSING_MAX_MS?{component:'processing',code:'processing_failed',state:'firing'}:{component:'processing',code:'not_verified',state:'activity'};
  if(['joining','waiting_room','recording'].includes(r.status)){
    if(r.callback_ms===null&&w.now-(r.started_ms??r.scheduled_ms)>2*BOT_HEARTBEAT_MS)return {component:'callback',code:'callback_missing',state:'firing'};
    if(r.heartbeat_ms!==null&&w.now-r.heartbeat_ms>2*BOT_HEARTBEAT_MS)return {component:'capture',code:'capture_stalled',state:'firing'};
  }
  return {component:'recording',code:'not_verified',state:'activity'};
}
export async function botEpisodeKey(script:BotHealthWindow['script'],provider:BotProvider,component:CfReceipt['component']){
  // Host and site observations use the same service/provider/cause key, not a session, tenant or individual sensor ID.
  return cfHash(['cf',cfAudience(script),script,provider,component]);
}
export async function buildBotSourceReceipts(w:BotHealthWindow):Promise<CfReceipt[]>{
  if(!Number.isSafeInteger(w.now)||!Number.isSafeInteger(w.since)||w.since<0||w.since>w.now||w.runs.length>1000)throw Error('invalid_bot_observation');
  // #5988: `revision` carries the affected runtime version only when every counted run reports the same one; the stored inventory reads it back.
  const make=async(provider:BotProvider|'none',s:Symptom,count:number,denominator:number,extra:unknown=null,revision:string|null=null)=>parseCfReceipt({version:1,
    id:await cfHash([w.script,provider,s,w.since,w.now,count,extra]),script:w.script,audience:cfAudience(w.script),family:'recording',provider,
    platform_episode:w.script==='studioos-meeting-bot'?(s.component==='startup'?'meeting_bot:start_failed':s.component==='callback'?'meeting_bot:unreported':null):null,
    ...s,occurred_ms:w.now,observed_ms:w.now,count,denominator,window_start_ms:w.since,window_end_ms:w.now,versions:[],source:'unknown',github:null,revision,
    episode_key:provider==='none'?await cfHash(['cf',w.script,'bot-coverage']):await botEpisodeKey(w.script,provider,s.component),owner:w.script.endsWith('-preview')?'preview_owner':'meeting_oncall'});
  if(!w.complete)return [await make('none',{component:'coverage',code:'telemetry_unavailable',state:'unknown'},0,0)];
  const latest=new Map<string,BotStageEvidence>();
  for(const r of w.runs){
    if(typeof r.key!=='string'||!r.key||!['queued','joining','waiting_room','recording','processing','done','failed','stopped'].includes(r.status)||!Number.isSafeInteger(r.scheduled_ms)||[r.started_ms,r.ended_ms,r.heartbeat_ms,r.callback_ms,r.processing_ms].some(t=>t!==null&&(!Number.isSafeInteger(t)||t<0))||!['zoom','google_meet','teams'].includes(r.provider)||!Number.isSafeInteger(r.revision)||r.revision<0||!Number.isSafeInteger(r.created_ms)||r.created_ms>w.now+60000)throw Error('invalid_bot_evidence');
    const prior=latest.get(r.key);if(!prior||r.revision>prior.revision)latest.set(r.key,r);
  }
  const rows=[...latest.values()],groups=new Map<string,{provider:BotProvider;s:Symptom;count:number;versions:Set<string|null>}>(),out:CfReceipt[]=[];
  for(const r of rows){const s=symptom(r,w),key=JSON.stringify([r.provider,s]),v=runtimeVersion(r.runtime_version);const g=groups.get(key);if(g){g.count++;g.versions.add(v);}else groups.set(key,{provider:r.provider,s,count:1,versions:new Set([v])});}
  if(!rows.length)return [await make('none',{component:'recording',code:Object.values(w.enabled).some(Boolean)?'idle':'disabled',state:Object.values(w.enabled).some(Boolean)?'activity':'disabled'},0,0)];
  for(const g of groups.values())out.push(await make(g.provider,g.s,g.count,rows.filter(r=>r.provider===g.provider).length,null,g.s.state==='firing'&&g.versions.size===1?[...g.versions][0]:null));
  for(const e of w.episodes_complete===true?w.openEpisodes??[]:[]){
    const shared=['startup','callback'].includes(e.component)&&w.script==='studioos-meeting-bot';
    if(out.some(r=>(shared||r.provider===e.provider)&&r.component===e.component&&r.state==='firing'))continue;
    if(shared&&(w.openEpisodes??[]).some(other=>other.component===e.component&&!rows.some(r=>r.provider===other.provider&&r.status==='done'&&r.final_receipt===true&&r.ended_ms!==null&&r.ended_ms>=other.opened_ms&&(other.version===null||r.runtime_version===other.version))))continue;
    const qualified=rows.filter(r=>r.provider===e.provider&&r.status==='done'&&r.final_receipt===true&&r.ended_ms!==null&&r.ended_ms>=e.opened_ms
      &&(e.version===null||runtimeVersion(r.runtime_version)===e.version));
    const stageVerified=rows.some(r=>r.provider===e.provider&&r.stage_checks?.[e.component as RecordingStage]?.result==='pass'
      &&r.stage_checks[e.component as RecordingStage]!.at_ms>=e.opened_ms&&(e.version===null||runtimeVersion(r.runtime_version)===e.version));
    if(qualified.length||stageVerified)out.push(await make(e.provider,{component:e.component,code:'success',state:'recovered'},qualified.length,rows.filter(r=>r.provider===e.provider).length,[e.opened_ms,e.version]));
  }
  return out;
}
export function botPrerequisiteReport(env:Env){
  const origin=(()=>{try{const u=new URL(env.APP_URL||'');return u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash;}catch{return false;}})();
  return {enabled:botEnabled(env),checks:{host_binding:Boolean(env.MEETING_BOT_CONTAINER),run_binding:Boolean(env.MEETING_BOT_RUN),
    signing_context:(env.MEETING_BOT_SECRET?.length??0)>=32,callback_origin:origin,zoom_credentials:Boolean(env.MEETING_BOT_ZOOM_CLIENT_ID?.trim()&&env.MEETING_BOT_ZOOM_CLIENT_SECRET?.trim())},
    provider_enabled:{zoom:botEnabled(env),google_meet:botEnabled(env),teams:botEnabled(env)&&env.MEETING_BOT_TEAMS==='on'},
    verification:'presence_only' as const};
}
/** Read only existing recording/processing receipt metadata; no URL, participant, media, diagnostic payload or customer identifier leaves this projection. */
/** #5988: the scheduled bridge passes its script and the open-episode inventory it read from stored receipts; the HQ read passes neither and so never claims a recovery. */
export type BotEpisodeInventory={complete:boolean;episodes:BotOpenEpisode[]};
export async function readBotSourceEvidence(env:Env,now=Date.now(),opts:{script?:BotHealthWindow['script'];inventory?:BotEpisodeInventory}={}){
  const preflight=botPrerequisiteReport(env),runs:BotStageEvidence[]=[];let complete=true;
  try{
    const result=await env.DB.prepare(`SELECT b.uid,b.platform,b.status,b.failure_code,b.created_at,b.scheduled_at,b.started_at,b.ended_at,b.heartbeat_at,
      b.runtime_callback_seen_at,b.runtime_error_code,b.runtime_version,s.processing_updated_at,
      CASE WHEN (SELECT COUNT(*) FROM meeting_bots peers WHERE peers.session_id=b.session_id)=1 THEN
        EXISTS(SELECT 1 FROM interview_session_receipts a WHERE a.session_id=b.session_id AND a.kind='final' AND a.outcome='ok'
          AND a.created_at>=datetime(b.created_at/1000,'unixepoch')) ELSE NULL END AS final_receipt
      FROM meeting_bots b LEFT JOIN interview_sessions s ON s.id=b.session_id
      WHERE b.created_at>=? OR b.ended_at>=? OR b.status NOT IN ('done','failed','stopped') ORDER BY b.created_at DESC,b.uid LIMIT 1001`).bind(now-86400000,now-86400000).all<Record<string,unknown>>();
    if((result.success as unknown)===false||!Array.isArray(result.results)||result.results.length>1000)complete=false;
    else for(const r of result.results)runs.push({key:String(r.uid),revision:0,provider:r.platform as BotProvider,status:String(r.status),created_ms:Number(r.created_at),scheduled_ms:Number(r.scheduled_at),
      started_ms:r.started_at as number|null,ended_ms:r.ended_at as number|null,heartbeat_ms:r.heartbeat_at as number|null,callback_ms:r.runtime_callback_seen_at as number|null,
      runtime_error:runtimeErrorCode(r.runtime_error_code),failure_code:typeof r.failure_code==='string'?r.failure_code:null,runtime_version:runtimeVersion(r.runtime_version),
      processing_ms:typeof r.processing_updated_at==='string'&&Number.isFinite(Date.parse(r.processing_updated_at))?Date.parse(r.processing_updated_at.replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(r.processing_updated_at)?'':'Z')):null,final_receipt:r.final_receipt===null?null:r.final_receipt===1});
  }catch{complete=false;}
  const receipts=await buildBotSourceReceipts({now,since:now-86400000,script:opts.script??'studioos-meeting-bot',complete,enabled:preflight.provider_enabled,runs,
    episodes_complete:opts.inventory?.complete===true,openEpisodes:opts.inventory?.episodes??[]});
  return {state:complete?'observed':'unknown',preflight,receipts,
    stage_coverage:RECORDING_STAGES.map(stage=>({stage,availability:['demand','callback','processing','terminal'].includes(stage)?'ledger_metadata':'requires_verified_snapshot'})),delivery:'not_configured'};
}
