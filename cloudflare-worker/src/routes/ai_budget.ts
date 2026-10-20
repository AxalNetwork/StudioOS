import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireFactor, requireHqAdmin, requireStepUp, requireSuperAdmin } from '../auth';
import { AI_LICENCE_KEYS, AiBudgetReviewConflict, AiBudgetReviewNotFound, listAiBudgetReviews,
  listAiLicenceCaps, loadAiBudget, planView, resolveAiCaps, settleAiBudgetReview, TYPED_CAP_LICENCES, usdToMicro } from '../services/aiBudget';
import { parseSpendLimit, readSpendLimit, writeSpendLimit } from '../services/aiSpendLimit';
import { PLAN_AI_SHARE } from '../services/planAllowance';
import { aiTopupStatus, memberTopupReading, readAiTopupProduct } from '../services/aiTopups';
import { HISTORY_MAX, ledgerBalance, memberAccount, memberHistory, memberTopUp, packLines, packLabel, reconcile, recordAdjustment } from '../services/aiCredits';
import { logAdminAction } from '../services/adminAudit';
import { COST_GROUPS, COST_RANGES, costCsv, memberCost, type CostGroup, type CostRange } from '../services/aiCost';
import { CONSUMPTION_GROUPS, memberConsumption, memberMonth, monthBounds, monthKey, type ConsumptionGroup } from '../services/aiConsumption';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../util/authErrors';

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
/**
 * D755 (#1919): the packs on sale, the hold and the latest purchase, with the
 * state and never the reason (D750 decision 3). `configured` and `product` are
 * D750's single-price fields, DEPRECATED: kept until CR4 PR 2 and CR7 merge.
 */
r.get('/top-up',async c=>{
  const user=await requireAuth(c);
  try { return c.json({...memberTopupReading(await readAiTopupProduct(c.env)),...await memberTopUp(c.env,user.id)}); }
  catch(error) { return refuse(c,503,{code:'ai_topup_unreadable',message:'Unreadable: the AI top-up could not be read.',raw:error,audience:'member'}); }
});
// D755: the member's own top-up history, newest first; `runs=1` adds each run's hold, release and spend.
r.get('/history',async c=>{
  const user=await requireAuth(c);
  const limit=c.req.query('limit')===undefined?20:Number(c.req.query('limit'));
  if (!Number.isInteger(limit) || limit<1 || limit>HISTORY_MAX) return c.json({error:'invalid_limit',message:`Ask for 1 to ${HISTORY_MAX} rows.`},400);
  try { return c.json(await memberHistory(c.env,user.id,{before:c.req.query('before'),limit,runs:c.req.query('runs')==='1'})); }
  catch(error) {
    if (error instanceof RangeError) return c.json({error:'invalid_cursor',message:'That page cursor is not one this list gave.'},400);
    return refuse(c,503,{code:'ai_history_unreadable',message:'Unreadable: your top-up history could not be read.',raw:error,audience:'member'});
  }
});
/**
 * D776 (#2093): the member's own runs this month (or `month=YYYY-MM`), grouped
 * by the rail's page, by option within a page, or by record, with what they
 * were charged and the allowance and token split. Their own rows only.
 */
r.get('/runs',async c=>{
  const user=await requireAuth(c);
  const group=(c.req.query('group')??'page') as ConsumptionGroup;
  if (!CONSUMPTION_GROUPS.includes(group)) return c.json({error:'invalid_group',message:'Group by page, option or record.'},400);
  const month=c.req.query('month')??monthKey(new Date());
  if (!monthBounds(month)) return c.json({error:'invalid_month',message:'Give the month as YYYY-MM.'},400);
  try { return c.json(await memberConsumption(c.env,user.id,group,month)); }
  catch(error) { return refuse(c,503,{code:'ai_runs_unreadable',message:'Unreadable: where your AI spend went could not be read.',raw:error,audience:'member'}); }
});
/**
 * D787 (#2212): the member's own cost per day and per model, tokens in and
 * out, the other units, cost and charged (`services/aiCost.ts`). `range` is
 * `mtd` (the default), `30d` or `prev_month`, in UTC; `group` is `model` (the
 * default), `page` or `option`. Their own rows only: no user or company is
 * taken from the request. `cost.csv` is the same read, one row per day and model.
 */
function costQuery(c:any):{range:CostRange;group:CostGroup}|Response {
  const range=(c.req.query('range')??'mtd') as CostRange;
  if (!COST_RANGES.includes(range)) return c.json({error:'invalid_range',message:'Ask for mtd, 30d or prev_month.'},400);
  const group=(c.req.query('group')??'model') as CostGroup;
  if (!COST_GROUPS.includes(group)) return c.json({error:'invalid_group',message:'Group by model, page or option.'},400);
  return {range,group};
}
r.get('/cost',async c=>{
  const user=await requireAuth(c);
  const q=costQuery(c);
  if (q instanceof Response) return q;
  try { return c.json(await memberCost(c.env,Number(user.id),q.range,q.group)); }
  catch(error) { return refuse(c,503,{code:'ai_cost_unreadable',message:'Unreadable: your AI cost could not be read.',raw:error,audience:'member'}); }
});
r.get('/cost.csv',async c=>{
  const user=await requireAuth(c);
  const q=costQuery(c);
  if (q instanceof Response) return q;
  try {
    const cost=await memberCost(c.env,Number(user.id),q.range,q.group);
    return new Response(costCsv(cost),{headers:{'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':`attachment; filename="ai-cost-${cost.range.from}-to-${cost.range.to}.csv"`,'Cache-Control':'no-store'}});
  }
  catch(error) { return refuse(c,503,{code:'ai_cost_unreadable',message:'Unreadable: your AI cost could not be read.',raw:error,audience:'member'}); }
});
/**
 * D788 (#2213): the member's own monthly AI spend limit (`services/aiSpendLimit.ts`):
 * the limit, this UTC month's charge, the share used, the notices, and the plan's
 * allowance beside it for context.
 */
r.get('/limit',async c=>{
  const user=await requireAuth(c);
  try {
    const caps=await resolveAiCaps(c.env,user.id);
    return c.json({...await readSpendLimit(c.env,user.id),
      allowance:{monthly_microusd:caps.monthly_microusd,source:caps.source,plan:planView(caps.plan)}});
  }
  catch(error) { return refuse(c,503,{code:'ai_spend_limit_unreadable',message:'Unreadable: your AI spend limit could not be read.',raw:error,audience:'member'}); }
});
/**
 * D788: set (`monthly_limit_usd` in dollars, at most two decimals, $0 to
 * $100,000) or remove (`null`) the limit, and switch its notices. A money
 * setting, so it asks for a recent sign-in as billing does: a TOTP session
 * stepped up within its window.
 */
r.put('/limit',async c=>{
  try { await requireFactor(c,'totp'); await requireStepUp(c); }
  catch(error) {
    // The gate's own answers, as billing's: the step-up body the SPA prompts from, else `{detail}`.
    const msg=(error as Error)?.message;
    if (msg===STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(error),403);
    if (msg && AUTH_ERROR_STATUSES[msg]) return c.json({detail:msg},AUTH_ERROR_STATUSES[msg] as 401|403);
    throw error;
  }
  const user=await requireAuth(c);
  const parsed=parseSpendLimit(await c.req.json().catch(()=>null));
  if (!parsed.ok) return c.json({error:'invalid_spend_limit',field:parsed.field,message:parsed.message},400);
  try {
    await writeSpendLimit(c.env,user.id,parsed.limit_microusd,parsed.notify);
    return c.json(await readSpendLimit(c.env,user.id));
  }
  catch(error) { return refuse(c,503,{code:'ai_spend_limit_unwritable',message:'Unreadable: your AI spend limit could not be saved.',raw:error,audience:'member'}); }
});
// D750, then D755 §14: why each pack is or is not offered, for the Super Admin only. The top-level
// fields are D750's single-price line, DEPRECATED until CR8 draws `packs`.
r.get('/top-up/status',async c=>{
  await requireSuperAdmin(c);
  try {
    const {stripeMode}=await import('../services/catalog');
    const lines=await packLines(c.env);
    return c.json({...await aiTopupStatus(c.env),mode:stripeMode(c.env),packs:lines.map(l=>({uid:l.uid,origin:l.origin,
      label:l.face_cents===null?null:packLabel(l.face_cents),state:l.state,reason:l.reason,price_id_suffix:l.price_id?l.price_id.slice(-6):null,
      on_sale:l.on_sale,bonus_microusd:l.bonus_microusd,sort:l.origin==='environment'?null:l.sort,adoptable:l.adoptable}))});
  }
  catch(error) { return refuse(c,503,{code:'ai_topup_unreadable',message:'Unreadable: the AI top-up could not be read.',raw:error}); }
});
r.get('/caps',async c=>{
  await requireSuperAdmin(c);
  // D783: the typed caps (the admin licence only), and each catalogue plan's computed allowance, read-only.
  try {
    const {plansAndPacks}=await import('../services/aiCredits');
    const catalogue=(await plansAndPacks(c.env)).plans;
    return c.json({plans:await listAiLicenceCaps(c.env),share:PLAN_AI_SHARE,catalogue});
  }
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
  if (!TYPED_CAP_LICENCES.has(key as any)) return refuse(c,409,{code:'ai_allowance_computed',
    message:"This plan's AI allowance is 25% of what each member pays for it, so it cannot be typed."});
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
// ---------------------------------------------------------------------------
// D755 §14 (#1919): one member's AI account, adjustments and reconcile. Super Admin only.
// ---------------------------------------------------------------------------
async function memberOf(c:any):Promise<number|null> {
  const id=Number(c.req.param('userId'));
  if (!Number.isSafeInteger(id) || id<=0) return null;
  const row=await c.env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
  return row?id:null;
}
r.get('/members/:userId',async c=>{
  const actor=await requireSuperAdmin(c);
  const limit=c.req.query('limit')===undefined?20:Number(c.req.query('limit'));
  if (!Number.isInteger(limit) || limit<1 || limit>HISTORY_MAX) return c.json({error:'invalid_limit',message:`Ask for 1 to ${HISTORY_MAX} rows.`},400);
  try {
    const id=await memberOf(c);
    if (id===null) return refuse(c,404,{code:'ai_member_not_found',message:'No member has that ID.'});
    const account=await memberAccount(c.env,id,{before:c.req.query('before'),limit});
    await logAdminAction(c.env,actor.id,(actor as any).email ?? '','ai_member_account_read',{member_id:id});
    return c.json(account);
  } catch(error) {
    if (error instanceof RangeError) return c.json({error:'invalid_cursor',message:'That page cursor is not one this list gave.'},400);
    return refuse(c,503,{code:'ai_member_account_unreadable',message:'Unreadable: this member\'s AI account could not be read.',raw:error});
  }
});
r.post('/members/:userId/adjustments',async c=>{
  const actor=await requireSuperAdmin(c);
  const body=await c.req.json().catch(()=>null) as any;
  const amount=body?.amount_usd, reason=typeof body?.reason==='string'?body.reason.trim():'', key=body?.idempotency_key;
  if (typeof key!=='string' || !/^[A-Za-z0-9_-]{8,64}$/.test(key))
    return c.json({error:'idempotency_key_required',message:'Send an idempotency key of 8 to 64 letters, digits, - or _.'},400);
  // The bounds and the reason's length are recordAdjustment's (§16), checked there once.
  const delta=typeof amount==='number' && Number.isFinite(amount) ? Math.sign(amount)*Math.round(Math.abs(amount)*1_000_000) : NaN;
  if (!Number.isSafeInteger(delta))
    return c.json({error:'ai_adjustment_out_of_bounds',message:'An adjustment moves at most $100 either way, and never $0.'},400);
  try {
    const id=await memberOf(c);
    if (id===null) return refuse(c,404,{code:'ai_member_not_found',message:'No member has that ID.'});
    const out=await recordAdjustment(c.env,{userId:id,actorId:actor.id,deltaMicrousd:delta,reason,key});
    if (!out.ok) return c.json({error:out.error,message:out.detail},out.error==='idempotency_key_reused'?409:400);
    return c.json({uid:out.uid,already_recorded:out.already,delta_microusd:out.delta_microusd,balance_microusd:out.balance_microusd,
      ledger_balance_microusd:await ledgerBalance(c.env,id)});
  } catch(error) { return refuse(c,503,{code:'ai_adjustment_not_recorded',message:'The adjustment was not recorded. Nothing changed.',raw:error}); }
});
// ---------------------------------------------------------------------------
// D776 PR 2 (#2093): HQ › AI allowances, read-only. HQ's Admin and Super Admin.
// ---------------------------------------------------------------------------
/**
 * One member's month: their runs by option within a page, with the charge and
 * the allowance and token split (the member's own grouped read, scoped by
 * user_id), and each run with its cost, charge and model. Each read is
 * audited, as D755's member account read is; the audit line names the member's
 * id and the month, never a figure.
 */
r.get('/members/:userId/runs',async c=>{
  const actor=await requireHqAdmin(c);
  const month=c.req.query('month')??monthKey(new Date());
  if (!monthBounds(month)) return c.json({error:'invalid_month',message:'Give the month as YYYY-MM.'},400);
  try {
    const id=await memberOf(c);
    if (id===null) return refuse(c,404,{code:'ai_member_not_found',message:'No member has that ID.'});
    const out=await memberMonth(c.env,id,month);
    await logAdminAction(c.env,actor.id,(actor as any).email ?? '','ai_member_runs_read',{member_id:id,month});
    return c.json(out);
  } catch(error) { return refuse(c,503,{code:'ai_member_runs_unreadable',message:'Unreadable: where this member\'s AI spend went could not be read.',raw:error}); }
});
r.get('/reconcile',async c=>{
  await requireSuperAdmin(c);
  try { return c.json(await reconcile(c.env)); }
  catch(error) { return refuse(c,503,{code:'ai_reconcile_unreadable',message:'Unreadable: the AI balances could not be reconciled.',raw:error}); }
});
export default r;
