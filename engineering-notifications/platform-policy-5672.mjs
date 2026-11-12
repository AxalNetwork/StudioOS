// D5672: observational aggregate sensor policy; absent, stale and insufficient data cannot recover an incident.
const sensors=new Set(['http','runtime','probe','queue','dlq','cron','workflow','dependency']);
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
export function evaluatePlatform(input,policy,now) {
  const unknown=reason=>({state:'unknown',reason});
  if(!sensors.has(input?.kind)||input.script!=='studioos'||!number(now)||policy?.approved!==true||!number(policy.maxAgeMs)||!number(input.observedAt)||input.observedAt>now||now-input.observedAt>policy.maxAgeMs||input.available!==true)return unknown('telemetry_unavailable');
  if(input.maintenance===true)return input.maintenanceVerified===true?{state:'maintenance',reason:'approved_maintenance'}:unknown('maintenance_unverified');
  let breach=false,reason='healthy';
  if(['http','runtime'].includes(input.kind)){
    if(!number(input.total)||!number(input.failures)||input.failures>input.total||!number(policy.minimumSamples)||policy.minimumSamples<1||!number(policy.rate)||policy.rate<=0||policy.rate>1)return unknown('invalid_denominator');
    if(input.total<policy.minimumSamples)return {state:'quiet',reason:'insufficient_volume'};
    breach=input.failures/input.total>=policy.rate;reason=input.kind==='http'?'handled_http_5xx':'runtime_outcome';
  }else if(input.kind==='probe'){
    if(!['edgeOk','customerOk','dependencyOk','independentlyConfirmed'].every(k=>typeof input[k]==='boolean'))return unknown('probe_incomplete');
    breach=!input.customerOk||!input.dependencyOk;
    if(breach&&!input.independentlyConfirmed)return unknown('probe_uncorroborated');
    reason=!input.customerOk?'customer_path_failure':!input.dependencyOk?'dependency_failure':'customer_path_healthy';
  }else if(input.kind==='queue'){
    if(!number(input.depth))return unknown('queue_depth_unavailable');
    if(input.depth===0)return {state:'healthy',reason:'quiet_queue'};
    if(!number(input.oldestAgeSeconds)||!number(policy.ageSeconds))return unknown('queue_age_unavailable');
    breach=input.oldestAgeSeconds>=policy.ageSeconds;reason='sustained_queue_age';
  }else if(input.kind==='dlq'){
    if(!Number.isSafeInteger(input.newLedgerRows)||input.newLedgerRows<0||input.checkpointVerified!==true)return unknown('dlq_checkpoint_unavailable');
    breach=input.newLedgerRows>0;reason='new_durable_dead_letter';
  }else if(input.kind==='cron'){
    if(!number(input.expectedCompletionAt)||!number(policy.graceMs))return unknown('cron_schedule_unavailable');
    if(input.lastSuccessAt!=null&&(!number(input.lastSuccessAt)||input.lastSuccessAt>input.observedAt))return unknown('cron_completion_unverified');
    if(input.status==='completed'&&(!number(input.expectedRunAt)||input.expectedRunAt>input.expectedCompletionAt))return unknown('cron_run_unverified');
    if(input.status==='failed')breach=true;
    else if(input.status==='completed'&&number(input.lastSuccessAt)&&input.lastSuccessAt>=input.expectedRunAt)return {state:'healthy',reason:'confirmed_completion'};
    else if(now>input.expectedCompletionAt+policy.graceMs)breach=true;
    else return {state:'waiting',reason:'within_completion_deadline'};
    reason='missed_or_failed_completion';
  }else if(input.kind==='workflow'){
    if(input.lastProgressAt!=null&&(!number(input.lastProgressAt)||input.lastProgressAt>input.observedAt))return unknown('workflow_progress_unverified');
    if(input.status==='complete')return {state:'healthy',reason:'workflow_complete'};
    if(input.status==='waiting'&&input.waitingForDemandVerified===true)return {state:'quiet',reason:'waiting_for_demand'};
    if(['errored','terminated'].includes(input.status))breach=true;
    else if(input.status==='running'&&number(input.lastProgressAt)&&number(policy.stuckMs))breach=now-input.lastProgressAt>policy.stuckMs;
    else return unknown('workflow_state_unavailable');
    reason='workflow_error_or_stuck';
  }else{
    if(!['healthy','failed'].includes(input.dependencyState))return unknown('dependency_unavailable');
    breach=input.dependencyState==='failed';reason='dependency_failure';
  }
  if(!breach)return {state:'healthy',reason};
  if(!number(policy.sustainMs))return unknown('threshold_unapproved');
  if(!number(input.breachSince)||input.breachSince>input.observedAt||now-input.breachSince<policy.sustainMs)return {state:'pending',reason};
  return {state:'firing',reason};
}
export function correlatePlatform(previous, observations, {complete,observedAt,episodeId}) {
  if(!/^[a-f0-9]{64}$/.test(episodeId||'')||!number(observedAt))throw Error('episode_identity_invalid');
  if(previous&&previous.episodeId!==episodeId)throw Error('episode_identity_mismatch');
  if(previous&&observedAt<=previous.observedAt)return {state:previous,transition:null};
  if(!Array.isArray(observations)||observations.length>32||observations.some(o=>!sensors.has(o.kind)||!['unknown','maintenance','quiet','healthy','waiting','pending','firing'].includes(o.state)))throw Error('observations_invalid');
  const firing=observations.filter(o=>o.state==='firing'),healthy=complete===true&&observations.length>0&&observations.every(o=>o.state==='healthy');
  const open=Boolean(firing.length||previous?.open&&!healthy);
  const state={episodeId,observedAt,open,repeats:(previous?.repeats||0)+(firing.length?1:0),counts:Object.fromEntries([...sensors].map(k=>[k,observations.filter(o=>o.kind===k&&o.state==='firing').length]))};
  return {state,transition:open&&!previous?.open?'firing':!open&&previous?.open?'recovery':null};
}
