/** D7821 (#7821): admin-only classification recompute and audited manual company-label decisions; no UI. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { recomputeCompanyClassifications, writeCompanySectorOverride } from '../services/researchCompanyClassification';
import type { RouteMount } from '../util/routeRegistry';
const mapping = new Hono<{Bindings:Env}>();
mapping.post('/recompute',async c=>{
 await requireAdmin(c);
 const body=await c.req.json().catch(()=>null);
 if(!body||typeof body!=='object'||Array.isArray(body))return refuse(c,400,{code:'invalid_recompute_page',message:'Provide a JSON recompute page.'});
 const after=body?.after ?? '', limit=body?.limit ?? 100;
 if(typeof after!=='string'||after.length>200||!Number.isInteger(limit)||limit<1||limit>100)return refuse(c,400,{code:'invalid_recompute_page',message:'Use an after cursor and a limit from 1 to 100.'});
 const result=await recomputeCompanyClassifications(c.env,after,limit);
 if(result.stale)return refuse(c,409,{code:'recompute_rules_changed',message:'An override changed during recompute. Restart from the beginning.'});
 return c.json(result);
});
mapping.post('/overrides',async c=>{
 const user=await requireAdmin(c);
 const body=await c.req.json().catch(()=>null);
 if(typeof body?.raw_value!=='string'||!body.raw_value.trim()||body.raw_value.length>500||typeof body.target!=='string'||body.target.length>100||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000)return refuse(c,400,{code:'invalid_company_override',message:'Provide a company label, market slug (or empty target to pin unmapped) and a reason.'});
 if(!await writeCompanySectorOverride(c.env,user.id,body.raw_value,body.target,body.reason.trim()))return refuse(c,400,{code:'invalid_market_slug',message:'The override target must be a tracked market slug.'});
 return c.json({saved:true,author:user.id,needs_recompute:true});
});
export const mount:RouteMount={path:'/api/admin/research-company-mapping',router:mapping};
export default mapping;
