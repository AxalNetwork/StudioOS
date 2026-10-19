/** D629: licence allowance and paid AI balance. All durable amounts are integer micro-USD. */
import type { Env } from '../types';
import { userMeetsTier } from '../middleware/requireTier';
import { effectiveInvestorTier } from '../middleware/requireInvestorTier';

export const AI_USD_SCALE = 1_000_000;
export const AI_CAP_DEFAULTS = { day: 5, month: 50, orgMonth: 5000 } as const;
export const AI_CAP_VARS = { day: 'WORKERS_AI_BUDGET_USD_DAY', month: 'WORKERS_AI_BUDGET_USD_MONTH' } as const;
export const AI_LICENCE_KEYS = ['founder:free','founder:growth','founder:studio','investor:free','investor:professional','investor:institutional','advisor','partner','admin','other'] as const;
export type AiLicenceKey = typeof AI_LICENCE_KEYS[number];
export function usdToMicro(value: number): number {
  const n = Math.ceil(value * AI_USD_SCALE);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(n)) throw new Error('AI amount unreadable');
  return n;
}
function amount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('AI amount unreadable');
  return value;
}
export function environmentAiCaps(env: Env) {
  const vars = env as unknown as Record<string,string|undefined>;
  const cap = (key:string, fallback:number) => {
    const n = Number(vars[key]);
    return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER / AI_USD_SCALE ? n : fallback;
  };
  return { day:cap(AI_CAP_VARS.day,AI_CAP_DEFAULTS.day), month:cap(AI_CAP_VARS.month,AI_CAP_DEFAULTS.month),
    orgMonth:cap('WORKERS_AI_BUDGET_USD_ORG_MONTH',AI_CAP_DEFAULTS.orgMonth) };
}
export function aiLicenceKey(user: any): AiLicenceKey {
  if (user.role === 'founder') return userMeetsTier(user,'studio') ? 'founder:studio' : userMeetsTier(user,'growth') ? 'founder:growth' : 'founder:free';
  if (user.role === 'investor') return `investor:${effectiveInvestorTier(user)}`;
  return ['advisor','partner','admin'].includes(user.role) ? user.role : 'other';
}
export async function resolveAiCaps(env: Env, userId:number) {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<any>();
  if (!user || !Number.isSafeInteger(userId) || userId <= 0 || user.is_active === 0) throw new Error('AI account unreadable');
  const licence = aiLicenceKey(user);
  const recorded = await env.DB.prepare('SELECT daily_microusd, monthly_microusd FROM ai_licence_caps WHERE licence_key = ?').bind(licence).first<any>();
  const fallback = environmentAiCaps(env);
  return { licence, source:recorded ? 'recorded' : 'environment',
    daily_microusd:recorded ? amount(recorded.daily_microusd) : usdToMicro(fallback.day),
    monthly_microusd:recorded ? amount(recorded.monthly_microusd) : usdToMicro(fallback.month) };
}
export async function listAiLicenceCaps(env:Env) {
  const rows=await env.DB.prepare(`SELECT c.licence_key,c.daily_microusd,c.monthly_microusd,c.recorded_by,
    u.name AS recorded_by_name,c.updated_at AS recorded_at FROM ai_licence_caps c
    LEFT JOIN users u ON u.id=c.recorded_by`).all<any>();
  if (rows.success !== true) throw new Error('AI caps unreadable');
  const byKey=new Map(rows.results.map(row=>[row.licence_key,row]));
  const fallback=environmentAiCaps(env);
  return AI_LICENCE_KEYS.map(licence_key=>{
    const recorded=byKey.get(licence_key);
    return {licence_key,source:recorded?'recorded' as const:'environment' as const,
      daily_microusd:recorded?amount(recorded.daily_microusd):usdToMicro(fallback.day),
      monthly_microusd:recorded?amount(recorded.monthly_microusd):usdToMicro(fallback.month),
      recorded_by:recorded?amount(recorded.recorded_by):null,
      recorded_by_name:recorded?recorded.recorded_by_name:null,
      recorded_at:recorded?recorded.recorded_at:null};
  });
}
async function batch(env:Env, statements:D1PreparedStatement[]) {
  const results = await env.DB.batch(statements);
  if (results.length !== statements.length || results.some(r=>r.success !== true)) throw new Error('AI budget unreadable');
  return results;
}
const clock = (now:Date) => ({ day:now.toISOString().slice(0,10),month:now.toISOString().slice(0,7),at:now.toISOString().slice(0,19).replace('T',' ') });
async function seedSpend(env:Env, userId:number, key:string, length:number) {
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(est_cost_usd),0) AS spend FROM ai_usage_logs
    WHERE user_id = ? AND refusal IS NULL AND substr(created_at,1,?) = ?`).bind(userId,length,key).first<any>();
  if (!row) throw new Error('AI usage unreadable');
  let seed = usdToMicro(row.spend);
  const store = (env as any).AI_SPEND || env.TOKENS;
  if (store) {
    // Existing enforcement may exceed the best-effort usage log. Missing is zero; a failed read is unknown.
    const old = await store.get(`ai_spend:user:${userId}:${key}`);
    if (old !== null) seed = Math.max(seed,usdToMicro(Number(old)));
  }
  return seed;
}
async function initialize(env:Env,userId:number,now:Date) {
  const t=clock(now);
  for (const [kind,key,len] of [['day',t.day,10],['month',t.month,7]] as const) {
    const existing=await env.DB.prepare('SELECT spend_microusd FROM ai_included_spend WHERE user_id = ? AND period_kind = ? AND period_key = ?').bind(userId,kind,key).first<any>();
    if (!existing) {
      const seed=await seedSpend(env,userId,key,len);
      const r=await env.DB.prepare('INSERT OR IGNORE INTO ai_included_spend(user_id,period_kind,period_key,spend_microusd) VALUES(?,?,?,?)').bind(userId,kind,key,seed).run();
      if (r.success !== true) throw new Error('AI budget unreadable');
    }
  }
  const bank=await env.DB.prepare('INSERT OR IGNORE INTO ai_topup_accounts(user_id) VALUES(?)').bind(userId).run();
  if (bank.success !== true) throw new Error('AI budget unreadable');
}
export interface AiReservation { uid:string; userId:number }
export class AiBudgetReviewConflict extends Error {}
export class AiBudgetReviewNotFound extends Error {}
type ReviewAudit={actorId:number;reason:string;recordedCost:number;action:'charge'|'refund'};
/** CAS settlement token makes every money update and the optional audit harmless on replay. */
async function commitSettlement(env:Env,row:any,costMicrousd:number,refund:boolean,expectedStatus:'pending'|'review',audit?:ReviewAudit) {
  const included=Math.min(costMicrousd,amount(row.included_microusd));
  const paid=costMicrousd-included;
  const token=crypto.randomUUID();
  const statements=[
    env.DB.prepare(`UPDATE ai_budget_reservations SET status=?, settlement_uid=?, actual_included_microusd=?, actual_topup_microusd=?, updated_at=datetime('now')
      WHERE uid=? AND user_id=? AND status=?`).bind(refund?'refunded':'settled',token,included,paid,row.uid,row.user_id,expectedStatus),
    env.DB.prepare(`UPDATE ai_included_spend SET spend_microusd=spend_microusd-?,updated_at=datetime('now')
      WHERE user_id=? AND period_kind='day' AND period_key=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.included_microusd-included,row.user_id,row.day_key,row.uid,token),
    env.DB.prepare(`UPDATE ai_included_spend SET spend_microusd=spend_microusd-?,updated_at=datetime('now')
      WHERE user_id=? AND period_kind='month' AND period_key=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.included_microusd-included,row.user_id,row.month_key,row.uid,token),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+?,updated_at=datetime('now')
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.topup_microusd-paid,row.user_id,row.uid,token),
    // D755: the release and spend ledger rows are written by migration 486's trigger on the status change.
  ];
  if (audit) {
    const held=amount(amount(row.included_microusd)+amount(row.topup_microusd));
    const details=JSON.stringify({reservation_uid:row.uid,member_id:row.user_id,
      held_microusd:held,recorded_cost_microusd:audit.recordedCost,charged_microusd:costMicrousd,
      absorbed_microusd:amount(audit.recordedCost-costMicrousd),
      included_microusd:included,topup_microusd:paid,reason:audit.reason});
    statements.push(env.DB.prepare(`INSERT INTO activity_logs(action,details,actor,user_id)
      SELECT ?,?,?,user_id FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?`)
      .bind(`ai_budget_review_${audit.action}`,details,String(audit.actorId),row.uid,token));
  }
  const result=await batch(env,statements);
  return result[0].meta.changes === 1;
}
/** A provider overage stays held, with its recorded cost on the same row. */
export async function settleAiReservation(env:Env, reservation:AiReservation, costMicrousd:number, refund=false) {
  amount(costMicrousd);
  const row=await env.DB.prepare('SELECT * FROM ai_budget_reservations WHERE uid = ? AND user_id = ?').bind(reservation.uid,reservation.userId).first<any>();
  if (!row) throw new Error('AI reservation unreadable');
  if (row.status !== 'pending') return;
  const held=amount(amount(row.included_microusd)+amount(row.topup_microusd));
  if (costMicrousd > held) {
    const result=await env.DB.prepare(`UPDATE ai_budget_reservations
      SET status='review',recorded_cost_microusd=?,updated_at=datetime('now')
      WHERE uid=? AND user_id=? AND status='pending'`).bind(costMicrousd,reservation.uid,reservation.userId).run();
    if (result.success !== true) throw new Error('AI budget unreadable');
    throw new Error('AI usage exceeds reservation');
  }
  await commitSettlement(env,row,costMicrousd,refund,'pending');
}
export async function listAiBudgetReviews(env:Env) {
  const rows=await env.DB.prepare(`SELECT r.uid,r.user_id,u.name AS member_name,r.created_at AS at,
    r.included_microusd,r.topup_microusd,r.recorded_cost_microusd
    FROM ai_budget_reservations r JOIN users u ON u.id=r.user_id
    WHERE r.status='review' ORDER BY r.created_at,r.uid`).all<any>();
  if (rows.success !== true) throw new Error('AI reviews unreadable');
  return rows.results.map(row=>({uid:row.uid,member_id:row.user_id,member_name:row.member_name,at:row.at,
    held_microusd:amount(amount(row.included_microusd)+amount(row.topup_microusd)),
    recorded_cost_microusd:amount(row.recorded_cost_microusd)}));
}
/** Only the Super Admin route calls this after validating its actor and reason. */
export async function settleAiBudgetReview(env:Env,uid:string,action:'charge'|'refund',actorId:number,reason:string) {
  if (!Number.isSafeInteger(actorId) || actorId<=0 || typeof reason!=='string' || reason.trim().length<10)
    throw new Error('AI review decision unreadable');
  const row=await env.DB.prepare('SELECT * FROM ai_budget_reservations WHERE uid=?').bind(uid).first<any>();
  if (!row) throw new AiBudgetReviewNotFound('AI review not found');
  const held=amount(amount(row.included_microusd)+amount(row.topup_microusd));
  const desired=action==='charge'?'settled':'refunded';
  if (row.status!== 'review') {
    const alreadyCharged=row.actual_included_microusd==null || row.actual_topup_microusd==null
      ? null : amount(amount(row.actual_included_microusd)+amount(row.actual_topup_microusd));
    if (row.status===desired && row.recorded_cost_microusd!=null && alreadyCharged===(action==='charge'?held:0))
      return {uid,status:desired,already_settled:true,held_microusd:held,recorded_cost_microusd:amount(row.recorded_cost_microusd),
        charged_microusd:action==='charge'?held:0};
    throw new AiBudgetReviewConflict('AI hold is not in review');
  }
  const recordedCost=amount(row.recorded_cost_microusd);
  const charged=action==='charge'?held:0;
  const changed=await commitSettlement(env,row,charged,action==='refund','review',
    {actorId,reason:reason.trim(),recordedCost,action});
  if (!changed) {
    const latest=await env.DB.prepare(`SELECT status,recorded_cost_microusd,actual_included_microusd,actual_topup_microusd
      FROM ai_budget_reservations WHERE uid=?`).bind(uid).first<any>();
    const latestCharged=latest?.actual_included_microusd==null || latest?.actual_topup_microusd==null
      ? null : amount(amount(latest.actual_included_microusd)+amount(latest.actual_topup_microusd));
    if (latest?.status===desired && latest.recorded_cost_microusd!=null && latestCharged===charged)
      return {uid,status:desired,already_settled:true,held_microusd:held,
        recorded_cost_microusd:recordedCost,charged_microusd:charged};
    throw new AiBudgetReviewConflict('AI hold is no longer in review');
  }
  return {uid,status:desired,already_settled:false,held_microusd:held,
    recorded_cost_microusd:recordedCost,charged_microusd:charged};
}
async function releaseExpired(env:Env,userId:number,now:Date) {
  const rows=await env.DB.prepare("SELECT uid FROM ai_budget_reservations WHERE user_id=? AND status='pending' AND expires_at<=? ORDER BY expires_at LIMIT 100")
    .bind(userId,clock(now).at).all<{uid:string}>();
  if (rows.success !== true) throw new Error('AI reservations unreadable');
  for (const r of rows.results) await settleAiReservation(env,{uid:r.uid,userId},0,true);
}
export async function loadAiBudget(env:Env,userId:number,now=new Date()) {
  const caps=await resolveAiCaps(env,userId);
  await releaseExpired(env,userId,now);
  await initialize(env,userId,now);
  const t=clock(now);
  // One SQLite snapshot for allowance, holds and paid balance.
  const row=await env.DB.prepare(`SELECT a.balance_microusd,d.spend_microusd AS daily,m.spend_microusd AS monthly,
      (SELECT COALESCE(SUM(included_microusd),0) FROM ai_budget_reservations WHERE user_id=a.user_id AND status IN ('pending','review') AND day_key=?) AS day_held,
      (SELECT COALESCE(SUM(included_microusd),0) FROM ai_budget_reservations WHERE user_id=a.user_id AND status IN ('pending','review') AND month_key=?) AS month_held,
      (SELECT COALESCE(SUM(topup_microusd),0) FROM ai_budget_reservations WHERE user_id=a.user_id AND status IN ('pending','review')) AS paid_held
    FROM ai_topup_accounts a JOIN ai_included_spend d ON d.user_id=a.user_id AND d.period_kind='day' AND d.period_key=?
      JOIN ai_included_spend m ON m.user_id=a.user_id AND m.period_kind='month' AND m.period_key=? WHERE a.user_id=?`)
    .bind(t.day,t.month,t.day,t.month,userId).first<any>();
  if (!row) throw new Error('AI budget unreadable');
  const held=await env.DB.prepare(`SELECT uid,created_at AS at,included_microusd,topup_microusd,recorded_cost_microusd
    FROM ai_budget_reservations WHERE user_id=? AND status='review' ORDER BY created_at,uid`).bind(userId).all<any>();
  if (held.success !== true) throw new Error('AI reviews unreadable');
  const daily=amount(row.daily),monthly=amount(row.monthly),dayHeld=amount(row.day_held),monthHeld=amount(row.month_held);
  return { ...caps, day_key:t.day,month_key:t.month,
    day_spend_microusd:amount(daily-dayHeld),month_spend_microusd:amount(monthly-monthHeld),
    day_reserved_microusd:dayHeld,month_reserved_microusd:monthHeld,
    balance_microusd:amount(row.balance_microusd),topup_reserved_microusd:amount(row.paid_held),
    held_for_review:held.results.map(r=>({uid:r.uid,at:r.at,
      held_microusd:amount(amount(r.included_microusd)+amount(r.topup_microusd)),
      recorded_cost_microusd:amount(r.recorded_cost_microusd)})) };
}
export async function reserveAiBudget(env:Env,userId:number,quoteMicrousd:number,now=new Date()) {
  amount(quoteMicrousd);
  const report=await loadAiBudget(env,userId,now);
  if (report.held_for_review.length) return {ok:false as const,refusal:'budget_review' as const};
  const uid=crypto.randomUUID(), t=clock(now),expires=clock(new Date(now.getTime()+300000)).at;
  // Compute the split from current counters inside the write transaction, never from a stale read.
  const results=await batch(env,[
    env.DB.prepare(`INSERT INTO ai_budget_reservations(uid,user_id,day_key,month_key,included_microusd,topup_microusd,expires_at)
      SELECT ?,a.user_id,?,?,MIN(?,MAX(0,MIN(?-d.spend_microusd,?-m.spend_microusd))),
        ?-MIN(?,MAX(0,MIN(?-d.spend_microusd,?-m.spend_microusd))),?
      FROM ai_topup_accounts a JOIN ai_included_spend d ON d.user_id=a.user_id AND d.period_kind='day' AND d.period_key=?
        JOIN ai_included_spend m ON m.user_id=a.user_id AND m.period_kind='month' AND m.period_key=?
      WHERE a.user_id=? AND ?<=MAX(0,MIN(?-d.spend_microusd,?-m.spend_microusd))+a.balance_microusd
        AND NOT EXISTS(SELECT 1 FROM ai_budget_reservations WHERE user_id=a.user_id AND status='review')`)
      .bind(uid,t.day,t.month,quoteMicrousd,report.daily_microusd,report.monthly_microusd,
        quoteMicrousd,quoteMicrousd,report.daily_microusd,report.monthly_microusd,expires,t.day,t.month,userId,
        quoteMicrousd,report.daily_microusd,report.monthly_microusd),
    env.DB.prepare(`UPDATE ai_included_spend SET spend_microusd=spend_microusd+(SELECT included_microusd FROM ai_budget_reservations WHERE uid=?),updated_at=datetime('now')
      WHERE user_id=? AND ((period_kind='day' AND period_key=?) OR (period_kind='month' AND period_key=?)) AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=?)`)
      .bind(uid,userId,t.day,t.month,uid),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd=balance_microusd-(SELECT topup_microusd FROM ai_budget_reservations WHERE uid=?),updated_at=datetime('now')
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=?)`).bind(uid,userId,uid),
  ]);
  if (!results[0].meta.changes) {
    const current=await loadAiBudget(env,userId,now);
    if (current.held_for_review.length) return {ok:false as const,refusal:'budget_review' as const};
    const dayRemaining=Math.max(0,current.daily_microusd-current.day_spend_microusd-current.day_reserved_microusd);
    const monthRemaining=Math.max(0,current.monthly_microusd-current.month_spend_microusd-current.month_reserved_microusd);
    return {ok:false as const,refusal:dayRemaining<=monthRemaining?'budget_user_day' as const:'budget_user_month' as const};
  }
  return { ok:true as const,reservation:{uid,userId} };
}
