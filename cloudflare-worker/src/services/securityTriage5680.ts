/** D5680: deny-first metadata triage over the existing typed security ledger; no public writer, finding body or raw link. */
import type { Env, User } from '../types';
import { SECURITY_EVENT_KINDS, type SecurityEventKind } from './securityEvents';
import { isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
export const TRIAGE_OWNERS = {
  authentication:'identity-security', tenant_isolation:'platform-security', privileges:'platform-security',
  key_handling:'platform-security', payments:'billing-security', investor_fund:'fund-operations-security',
  contracts:'legal-security', signatures:'legal-security', pii:'privacy-security',
} as const;
export type TriageDomain = keyof typeof TRIAGE_OWNERS;
export interface TriageGrant { verified:boolean; private:boolean; slackConnect:boolean; recipientAllowed:boolean; tenantScopeKnown:boolean; teamMatches:boolean; purpose:'restricted-case'|'generic-impact'; domain:TriageDomain; caseId?:string; channelId:string; }
export interface TriageInput { kind:SecurityEventKind|'scanner'; domain:TriageDomain; state:'firing'|'recovery'; count:number; corroborated:boolean; caseId:string; scannerFailed?:boolean; operationalImpactVerified?:boolean; recoveryVerified?:boolean; }
export interface TriagePolicy { approved:boolean; minimumCount:number; existenceSensitive:boolean; genericImpactAllowed:boolean; }
export function securityTriage5680(input:TriageInput,policy:TriagePolicy,grant:TriageGrant) {
  const withheld={state:'withheld' as const};
  if(policy?.approved!==true || !Object.hasOwn(TRIAGE_OWNERS,input?.domain) || grant?.verified!==true || grant.private!==true || grant.slackConnect!==false || grant.recipientAllowed!==true || grant.tenantScopeKnown!==true || grant.teamMatches!==true || grant.domain!==input.domain || !/^[CG][A-Z0-9]{2,30}$/.test(grant.channelId||''))return withheld;
  if(!['signin','step_up','gate','recovery','scanner'].includes(input.kind)||!['firing','recovery'].includes(input.state)||!Number.isSafeInteger(input.count)||input.count<0||!Number.isSafeInteger(policy.minimumCount)||policy.minimumCount<1)return withheld;
  if(input.state==='recovery'&&input.recoveryVerified!==true)return withheld;
  if(input.kind==='scanner'&&input.scannerFailed===true)return {state:'scanner_unavailable' as const};
  if(input.state==='firing'&&(input.count<policy.minimumCount||input.corroborated!==true))return {state:'routine' as const};
  if(grant.purpose==='generic-impact'){
    if(policy.existenceSensitive!==false||policy.genericImpactAllowed!==true||input.operationalImpactVerified!==true)return withheld;
    return {state:'permitted' as const,route:'section' as const,payload:{schema:1,label:'operational-impact',state:input.state==='recovery'?'recovered':'degraded'}};
  }
  if(grant.purpose!=='restricted-case'||grant.caseId!==input.caseId||!/^case_[A-Za-z0-9]{16,64}$/.test(input.caseId))return withheld;
  return {state:'permitted' as const,route:'security' as const,payload:{schema:1,label:'restricted-security',domain:input.domain,owner:TRIAGE_OWNERS[input.domain],state:input.state,caseId:input.caseId}};
}
/** Read aggregate kind/outcome counts only after the existing HQ Super Admin gate; never read user, network, detail or evidence columns. */
export async function securityTriageCounts5680(env:Env,user:Pick<User,'role'>&{is_super_admin?:unknown},from:string,to:string) {
  if(branchOf(env)||!isSuperAdmin(user))throw Error('restricted_security_reader');
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(from)||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(to)||from>=to)throw Error('invalid_window');
  const span=Date.parse(to.replace(' ','T')+'Z')-Date.parse(from.replace(' ','T')+'Z');
  if(!Number.isFinite(span)||span<=0||span>86400000)throw Error('invalid_window');
  try{
    const rows=await env.DB.prepare('SELECT kind, outcome, COUNT(*) AS count FROM security_events WHERE occurred_at >= ? AND occurred_at < ? GROUP BY kind, outcome').bind(from,to).all<{kind:SecurityEventKind;outcome:string;count:number}>();
    if(rows.results.some(r=>!SECURITY_EVENT_KINDS.includes(r.kind)||!['ok','refused'].includes(r.outcome)||!Number.isSafeInteger(r.count)||r.count<0))return {available:false as const,counts:null};
    return {available:true as const,counts:rows.results.map(r=>({kind:r.kind,outcome:r.outcome,count:r.count})),scope:'hq-privileged-aggregate' as const};
  }catch{return {available:false as const,counts:null};}
}
/** No destination or finding text comes from input. The injected #5667 publisher receives only the permitted schema. */
export async function deliverSecurityTriage5680(input:TriageInput,policy:TriagePolicy,authorize:()=>Promise<TriageGrant>,publish:(route:'section'|'security',payload:unknown,destination:Readonly<{channelId:string}>)=>Promise<unknown>) {
  let grant:TriageGrant;
  try{grant=await authorize()}catch{return {state:'unavailable' as const}}
  const result=securityTriage5680(input,policy,grant);
  if(result.state!=='permitted')return result;
  let outcome:unknown;
  try{outcome=await publish(result.route,result.payload,{channelId:grant.channelId})}catch{return {state:'ambiguous' as const}}
  const value=outcome as {state?:string;key?:string};
  if(value?.state==='pending'&&/^[a-f0-9]{64}$/.test(value.key||''))return {state:'pending' as const,key:value.key};
  return {state:'ambiguous' as const};
}
