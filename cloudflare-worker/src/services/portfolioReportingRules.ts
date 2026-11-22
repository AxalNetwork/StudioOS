/** D6214: immutable, period-aware Portfolio reporting rule sets, inheriting HQ only without an effective own revision. */
import type { Env } from '../types';
export type ReportingRule = { kpi_key: string; name: string; definition: string | null; unit: string | null; cadence: 'monthly' | 'quarterly'; required: number; applies_to: string; sort_order: number };
export function validateReportingRules(raw: unknown): ReportingRule[] {
 if (!Array.isArray(raw) || raw.length > 100) throw new Error('Choose at most 100 figures.');
 const seen = new Set<string>();
 return raw.map((r: any,index) => {
  if (!r || typeof r !== 'object' || !/^[a-z][a-z0-9_]{0,63}$/.test(r.kpi_key) || ['constructor','prototype'].includes(r.kpi_key) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 100
   || !['monthly','quarterly'].includes(r.cadence) || ![0,1].includes(r.required)
   || typeof r.applies_to !== 'string' || !r.applies_to.trim() || r.applies_to.length > 100
   || ![r.definition,r.unit].every(v => v === null || typeof v === 'string' && v.length <= 1000)) throw new Error('A figure is invalid. Check its key, name, cadence, scope and required state.');
  if(seen.has(r.kpi_key))throw new Error(`The key ${r.kpi_key} is used by more than one figure.`);
  seen.add(r.kpi_key);
  return { kpi_key:r.kpi_key,name:r.name.trim(),definition:r.definition,unit:r.unit,cadence:r.cadence,required:r.required,applies_to:r.applies_to.trim(),sort_order:index };
 });
}
export function reportingPeriodNow(cadence: 'monthly'|'quarterly', today: string) {
 return cadence === 'monthly' ? today.slice(0,7) : `${today.slice(0,4)}-Q${Math.floor((Number(today.slice(5,7))-1)/3)+1}`;
}
export async function readReportingRules(env: Env, fundId: number|null, cadence: 'monthly'|'quarterly', period: string) {
 const column = cadence === 'monthly' ? 'effective_month' : 'effective_quarter';
 const rows = await env.DB.prepare(`SELECT h.*,u.name AS updated_by_name FROM portfolio_reporting_rule_sets h
 LEFT JOIN users u ON u.id=h.updated_by WHERE (h.fund_id IS ? OR h.fund_id IS NULL) AND (CASE WHEN ?='monthly' THEN h.effective_month ELSE h.effective_quarter END)<=?
 ORDER BY (h.fund_id IS ?) DESC,h.id DESC LIMIT 1`).bind(fundId,cadence,period,fundId).all<any>();
 if(rows.success !== true)throw new Error('Reporting rules unreadable');
 const row=rows.results[0];
 if(!row)throw new Error('Reporting rules not initialized');
 const allRules=validateReportingRules(JSON.parse(row.rules_json));
 return { revision:row.id, fund_id:fundId, inherited:fundId !== null && row.fund_id === null, cadence, period,
  effective_from:row[column], due_days:row.due_days, updated_at:row.updated_at, updated_by:row.updated_by, updated_by_name:row.updated_by_name,
  rules:allRules.filter(r=>r.cadence===cadence), all_rules:allRules };
}

/** Rules behind an unsigned figure list; a signed document's explicit figures always win. */
export async function dutyReportingRuleKeys(env: Env, duty: { kind: string; required_figures?: string|null; project_id: number; holder_user_id: number|null }, day: string) {
 if (!['monthly_financials','quarterly_kpi'].includes(duty.kind)) return [];
 let named: unknown; try { named=JSON.parse(duty.required_figures||'[]'); } catch { throw new Error('Reporting duty unreadable'); }
 if(Array.isArray(named)&&named.length)return [];
 const positions=await env.DB.prepare(`SELECT DISTINCT p.fund_id,pr.stage FROM portfolio_positions p JOIN projects pr ON pr.id=p.project_id
 JOIN vc_funds f ON f.id=p.fund_id WHERE p.project_id=? AND f.gp_user_id=?`).bind(duty.project_id,duty.holder_user_id).all<any>();
 if(positions.success!==true)throw new Error('Reporting book unreadable');
 const funds=positions.results.length?positions.results:[{fund_id:null,stage:null}];
 const cadences: Array<'monthly'|'quarterly'>=duty.kind==='monthly_financials'?['monthly']:['monthly','quarterly'];
 const keys: string[]=[];
 for(const fund of funds)for(const cadence of cadences){
  const set=await readReportingRules(env,fund.fund_id,cadence,reportingPeriodNow(cadence,day));
  for(const rule of set.rules)if(rule.required&&(rule.applies_to==='all'||rule.applies_to===fund.stage))keys.push(rule.kpi_key);
 }
 return [...new Set(keys)];
}
