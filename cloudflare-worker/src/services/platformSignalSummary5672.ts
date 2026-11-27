/** D5672: privileged metadata-only adapter over existing capacity, cron and durable dead-letter readers. */
import type { Env, User } from '../types';
import { isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { readPlatformCapacity, withTimeout } from './platformCapacity';
import { readCapacityAlerts } from './platformCapacityHistory';
import { readJobsSummary, readDlqSummary } from './platformSummary';
export async function platformSignalSummary5672(env: Env, user: Pick<User,'role'> & {is_super_admin?:unknown}, now=new Date()) {
  if(branchOf(env)||!isSuperAdmin(user))throw new Error('restricted_signal_reader');
  const [capacity,cron,dlq,alerts]=await Promise.all([
    withTimeout(readPlatformCapacity(env,now),5000).catch(()=>null),
    withTimeout(readJobsSummary(env,now),5000).catch(()=>({available:false as const})),
    withTimeout(readDlqSummary(env),5000).catch(()=>({available:false as const})),
    withTimeout(readCapacityAlerts(env,'hq',now),5000).catch(()=>({state:'unreadable' as const})),
  ]);
  return {schema:1,script:'studioos',observedAt:now.toISOString(),capacity:capacity?{available:true,metrics:capacity.metrics.map(m=>({key:m.key,availability:m.availability,value:m.value}))}:{available:false},
    cron:cron.available?{available:true,triggers:cron.triggers.map(t=>({trigger:t.trigger_name,state:t.state,status:t.status,lastFinishedAt:t.last_finished_at,expectedAt:t.expected_at}))}:{available:false},
    episodes:alerts.state==='ok'?{available:true,open:alerts.open.map(a=>({id:a.id,metric:a.metric_key,severity:a.severity,muted:a.muted})),cleared:alerts.cleared.map(a=>({id:a.id,metric:a.metric_key,clearedAt:a.cleared_at}))}:{available:false},
    dlq:dlq.available?{available:true,total:dlq.total}:{available:false},
    limitations:['binding_presence_is_not_health','dlq_total_is_not_new_arrivals','invocation_and_workflow_telemetry_require_separate_authorized_sources']};
}
