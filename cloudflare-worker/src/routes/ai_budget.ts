import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireSuperAdmin } from '../auth';
import { AI_LICENCE_KEYS, AiBudgetReviewConflict, AiBudgetReviewNotFound, listAiBudgetReviews,
  listAiLicenceCaps, loadAiBudget, settleAiBudgetReview, usdToMicro } from '../services/aiBudget';
import { aiTopupStatus, memberTopupReading, readAiTopupProduct } from '../services/aiTopups';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';

const r=new Hono<{Bindings:Env}>();
r.onError((error,c)=>{
  const status=AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c,status,{code:'ai_budget_access_refused',message:'This account cannot access that AI budget operation.'});
  return refuse(c,503,{code:'ai_budget_unreadable',message:'Unreadable: the AI budget operation could not be completed.',raw:error});
});
r.get('/me',async c=>{
  const user=await requireAuth(c);
  try { return c.json(await loadAiBudget(c.env,user.id)); }
  catch(error) { return refuse(c,503,{code:'ai_budget_unreadable',message:'Unreadable: your AI allowance and top-up balance could not be read.',raw:error,audience:'member'}); }
});
r.get('/top-up',async c=>{
  await requireAuth(c);
  try { return c.json(memberTopupReading(await readAiTopupProduct(c.env))); }
  catch(error) { return refuse(c,503,{code:'ai_topup_unreadable',message:'Unreadable: the AI top-up could not be read.',raw:error,audience:'member'}); }
});
// D750: why the top-up is or is not offered, for the Super Admin only.
r.get('/top-up/status',async c=>{
  await requireSuperAdmin(c);
  try { return c.json(await aiTopupStatus(c.env)); }
  catch(error) { return refuse(c,503,{code:'ai_topup_unreadable',message:'Unreadable: the AI top-up could not be read.',raw:error}); }
});
r.get('/caps',async c=>{
  await requireSuperAdmin(c);
  try { return c.json({plans:await listAiLicenceCaps(c.env)}); }
  catch(error) { return refuse(c,503,{code:'ai_caps_unreadable',message:'Unreadable: the AI plan allowances could not be read.',raw:error}); }
});
r.get('/reviews',async c=>{
  await requireSuperAdmin(c);
  try { return c.json({items:await listAiBudgetReviews(c.env)}); }
  catch(error) { return refuse(c,503,{code:'ai_reviews_unreadable',message:'Unreadable: the held AI runs could not be read.',raw:error}); }
});
for (const action of ['charge','refund'] as const) r.post(`/reviews/:uid/${action}`,async c=>{
  const actor=await requireSuperAdmin(c);
  const body=await c.req.json().catch(()=>null);
  const reason=body?.reason;
  if (typeof reason!=='string' || reason.trim().length<10 || reason.length>2000)
    return refuse(c,400,{code:'ai_review_reason_required',message:'Give a reason of at least 10 characters to settle this held run.'});
  try { return c.json(await settleAiBudgetReview(c.env,c.req.param('uid'),action,actor.id,reason)); }
  catch(error) {
    if (error instanceof AiBudgetReviewNotFound) return refuse(c,404,{code:'ai_review_not_found',message:'This held AI run was not found.'});
    if (error instanceof AiBudgetReviewConflict) return refuse(c,409,{code:'ai_review_not_pending',message:'This AI run is no longer held for review.'});
    return refuse(c,503,{code:'ai_review_not_settled',message:'Unreadable: the held AI run could not be settled.',raw:error});
  }
});
r.put('/caps/:licence',async c=>{
  const actor=await requireSuperAdmin(c);
  const key=c.req.param('licence');
  if (!AI_LICENCE_KEYS.includes(key as any)) return c.json({error:'invalid_licence',message:'Choose a recorded licence key.'},400);
  const body=await c.req.json().catch(()=>null);
  if (!body || typeof body.daily_usd!=='number' || typeof body.monthly_usd!=='number'
    || !Number.isFinite(body.daily_usd) || !Number.isFinite(body.monthly_usd) || body.daily_usd<0 || body.monthly_usd<0
    || body.daily_usd>Number.MAX_SAFE_INTEGER/1000000 || body.monthly_usd>Number.MAX_SAFE_INTEGER/1000000)
    return c.json({error:'invalid_caps',message:'Record nonnegative daily and monthly USD caps.'},400);
  try {
    const day=usdToMicro(body.daily_usd),month=usdToMicro(body.monthly_usd);
    const results=await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO ai_licence_caps(licence_key,daily_microusd,monthly_microusd,recorded_by) VALUES(?,?,?,?)
        ON CONFLICT(licence_key) DO UPDATE SET daily_microusd=excluded.daily_microusd,monthly_microusd=excluded.monthly_microusd,
        recorded_by=excluded.recorded_by,updated_at=datetime('now')`).bind(key,day,month,actor.id),
      c.env.DB.prepare('INSERT INTO activity_logs(action,details,actor,user_id) VALUES(?,?,?,?)')
        .bind('ai_licence_caps_recorded',JSON.stringify({licence_key:key,daily_microusd:day,monthly_microusd:month}),String(actor.id),actor.id),
    ]);
    if (results.length!==2 || results.some(x=>x.success!==true)) throw new Error('AI caps unreadable');
    return c.json({licence_key:key,daily_microusd:day,monthly_microusd:month});
  } catch(error) { return refuse(c,503,{code:'ai_caps_not_saved',message:'The AI caps were not saved.',raw:error}); }
});
export default r;
