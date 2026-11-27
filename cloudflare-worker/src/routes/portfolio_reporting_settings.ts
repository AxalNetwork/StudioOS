/** D6214: attributed per-fund reporting settings; only its active-company GP can write. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, canViewLpData } from '../auth';
import { requireFundGp, fundManageScope } from '../services/fundGpAccess';
import { validateReportingRules, readReportingRules, reportingPeriodNow } from '../services/portfolioReportingRules';
import { assertFundAct, isSupportSession } from '../services/fundAdminAccess';
import { periodBounds } from '../services/portfolioMetrics';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
const router = new Hono<{Bindings:Env}>();
function failure(c:any,e:any) { if(e instanceof Response)return e;const status=Object.hasOwn(AUTH_ERROR_STATUSES,e?.message)?AUTH_ERROR_STATUSES[e.message]:undefined;return c.json({error:status?'This account cannot access these reporting settings.':'Reporting settings are unreadable. Try again.'},status||503); }
router.get('/books',async c=>{
 try{const user=await requireAuth(c),scope=await fundManageScope(c,user);
 const rows=await c.env.DB.prepare(`SELECT f.id,f.name FROM vc_funds f WHERE ${scope.sql} ORDER BY f.name,f.id`).bind(...scope.binds).all();
 if(rows.success!==true)throw new Error('read');
 if(!canViewLpData(user)&&!rows.results.length)return c.json({error:'Forbidden'},403);
 return c.json({items:rows.results});}catch(e){return failure(c,e);}
});
router.get('/:fund',async c=>{
 try{const user=await requireAuth(c),raw=c.req.param('fund');let id:number|null=null;
 if(raw!=='hq'){if(!/^[1-9]\d{0,14}$/.test(raw))return c.json({error:'Choose a fund.'},400);id=Number(raw);await requireFundGp(c,id);}
 else if(!canViewLpData(user))return c.json({error:'Forbidden'},403);
 const cadence=c.req.query('cadence');if(!['monthly','quarterly'].includes(cadence||''))return c.json({error:'Choose a cadence.'},400);
 const today=new Date().toISOString().slice(0,10),asked=c.req.query('period'),period=asked||reportingPeriodNow(cadence as 'monthly'|'quarterly',today);
 if(!periodBounds(cadence as 'monthly'|'quarterly',period))return c.json({error:'Choose a valid reporting period.'},400);
 const result=await readReportingRules(c.env,id,cadence as 'monthly'|'quarterly',period);
 const stages=id===null?{success:true,results:[]}:await c.env.DB.prepare('SELECT DISTINCT pr.stage FROM portfolio_positions p JOIN projects pr ON pr.id=p.project_id WHERE p.fund_id=? AND pr.deleted_at IS NULL AND pr.stage IS NOT NULL ORDER BY pr.stage').bind(id).all<{stage:string}>();
 if(stages.success!==true)throw new Error('Stages unreadable');
 return c.json({...result,stages:stages.results.map((r:any)=>r.stage),can_manage:id!==null && !(await isSupportSession(c))});
 }catch(e){return failure(c,e);}
});
router.put('/:fund',async c=>{
 try{const raw=c.req.param('fund');if(!/^[1-9]\d{0,14}$/.test(raw))return c.json({error:'Choose a fund you manage.'},400);
 const id=Number(raw),gp=await requireFundGp(c,id),{user}=gp;
 await assertFundAct(c,gp,'fund_report.draft');
 const b=await c.req.json().catch(()=>null);let rules;
 try{rules=validateReportingRules(b?.rules);}catch{return c.json({error:'A figure is invalid or a key is repeated. Check its key, name, cadence, scope and required state.'},400);}
 if(!Number.isSafeInteger(b?.revision)||b.revision<1||!Number.isInteger(b?.due_days)||b.due_days<0||b.due_days>365)return c.json({error:'Refresh the rules and choose a due day from 0 to 365.'},400);
 const today=new Date().toISOString().slice(0,10),month=reportingPeriodNow('monthly',today),quarter=reportingPeriodNow('quarterly',today);
 const current=await readReportingRules(c.env,id,'monthly',month);
 if(current.revision!==b.revision)return c.json({error:'The rules changed. Compare the current revision before saving.',current},409);
 const result=await c.env.DB.batch([
 c.env.DB.prepare(`INSERT INTO portfolio_reporting_rule_sets(fund_id,rules_json,due_days,effective_month,effective_quarter,updated_by)
 SELECT ?,?,?,?,?,? WHERE ?=(SELECT h.id FROM portfolio_reporting_rule_sets h WHERE (h.fund_id=? OR h.fund_id IS NULL) AND h.effective_month<=? ORDER BY (h.fund_id=?) DESC,h.id DESC LIMIT 1)`)
 .bind(id,JSON.stringify(rules),b.due_days,month,quarter,user.id,b.revision,id,month,id),
 c.env.DB.prepare("INSERT INTO activity_logs(user_id,action,entity_type,entity_id,details) SELECT ?,'portfolio_reporting_rules_saved','fund',?,? WHERE changes()=1").bind(user.id,String(id),JSON.stringify({effective_month:month,effective_quarter:quarter})),
 ]);
 if(result[0].success!==true)throw new Error('write');
 if(!result[0].meta.changes)return c.json({error:'The rules changed. Refresh and compare before saving.'},409);
 return c.json({...await readReportingRules(c.env,id,'monthly',month),effective_month:month,effective_quarter:quarter});
 }catch(e){return failure(c,e);}
});
export const mount={path:'/api/portfolio-reporting-settings',router:router};
export default router;
