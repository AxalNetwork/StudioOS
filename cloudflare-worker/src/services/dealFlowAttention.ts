/** D6424: firm-recorded stale thresholds and visible open diligence requests; unknown and failed sources never become zero. */
import type { Env } from '../types';
import { FlowError, readFlow, type Scope } from './dealFlow';
export async function attentionRule(env:Env,scope:Scope){
 if(scope.companyId===null)return{days:null,writable:false};
 const row=await env.DB.prepare('SELECT stale_after_days FROM deal_flow_attention_rules WHERE company_id = ?').bind(scope.companyId).first<{stale_after_days:number|null}>();
 return{days:row?.stale_after_days??null,writable:true};
}
export async function saveAttentionRule(env:Env,scope:Scope,days:unknown){
 if(scope.companyId===null)throw new FlowError('firm_required',409,'Choose your firm to record its stale rule.');
 if(days!==null&&(!Number.isSafeInteger(days)||Number(days)<1||Number(days)>3650))throw new FlowError('invalid_stale_days',400,'Choose whole days from 1 to 3650, or clear the rule.');
 await env.DB.prepare(`INSERT INTO deal_flow_attention_rules(company_id,stale_after_days,updated_by_user_id) VALUES(?,?,?)
   ON CONFLICT(company_id) DO UPDATE SET stale_after_days=excluded.stale_after_days,updated_by_user_id=excluded.updated_by_user_id,updated_at=datetime('now')`).bind(scope.companyId,days,scope.user.id).run();
 return attentionRule(env,scope);
}
export async function flowAttention(env:Env,scope:Scope){
 const flow=await readFlow(env,scope);
 let rule:{days:number|null;writable:boolean}|null=null;
 let stale:{state:string;count:number|null;reason:string|null}={state:'unreadable',count:null,reason:'The firm’s stale rule could not be read.'};
 let diligence:{state:string;count:number|null;reason:string|null}={state:'unreadable',count:null,reason:'Waiting on diligence could not be read.'};
 const items=flow.items.map(r=>({deal_id:r.deal_id,stale:null as boolean|null,open_diligence_requests:null as number|null}));
 try{
  rule=await attentionRule(env,scope);
  if(rule.days===null)stale={state:'not_recorded',count:null,reason:'Your firm has not recorded a days-in-stage stale rule.'};
  else if(flow.items.some(r=>r.stage!=='passed'&&r.days_in_stage===null))stale={state:'not_recorded',count:null,reason:'A deal’s stage start is not recorded.'};
  else{for(let i=0;i<items.length;i++)items[i].stale=flow.items[i].stage!=='passed'&&Number(flow.items[i].days_in_stage)>=rule.days;
   stale={state:'recorded',count:items.filter(r=>r.stale).length,reason:null};}
 }catch{/* The failed rule stays unreadable. */}
 try{
  const ids=flow.items.filter(r=>r.can_open&&r.stage!=='passed').map(r=>r.deal_id);
  const rows=await env.DB.prepare(`SELECT d.id AS deal_id,COUNT(r.id) AS open_requests FROM deals d
    JOIN dd_cases k ON k.subject_type='project' AND k.subject_id=d.project_id AND k.status IN ('open','in_review')
    JOIN dd_requests r ON r.case_id=k.id AND r.state='requested' AND r.responded_at IS NULL
    WHERE d.id IN (SELECT value FROM json_each(?))
      AND (k.owner_user_id=? OR EXISTS(SELECT 1 FROM dd_reviewers v WHERE v.case_id=k.id AND v.user_id=?)) GROUP BY d.id`).bind(JSON.stringify(ids),scope.user.id,scope.user.id).all<{deal_id:number;open_requests:number}>();
  if(!rows.success)throw new Error('diligence_unreadable');
  for(const item of items)item.open_diligence_requests=Number(rows.results?.find(r=>Number(r.deal_id)===item.deal_id)?.open_requests??0);
  diligence={state:'recorded',count:items.filter(r=>Number(r.open_diligence_requests)>0).length,reason:null};
 }catch{/* Failure is not an empty list. */}
 return{rule,stale,diligence,items};
}
