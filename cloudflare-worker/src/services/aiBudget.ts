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
/** CAS settlement token makes all following updates harmless on replay. */
export async function settleAiReservation(env:Env, reservation:AiReservation, costMicrousd:number, refund=false) {
  amount(costMicrousd);
  const row=await env.DB.prepare('SELECT * FROM ai_budget_reservations WHERE uid = ? AND user_id = ?').bind(reservation.uid,reservation.userId).first<any>();
  if (!row) throw new Error('AI reservation unreadable');
  if (row.status !== 'pending') return;
  if (costMicrousd > row.included_microusd + row.topup_microusd) {
    // Unexpected provider usage cannot be silently capped or refunded. Preserve the hold for review.
    await env.DB.prepare("UPDATE ai_budget_reservations SET status='review', updated_at=datetime('now') WHERE uid=? AND user_id=? AND status='pending'").bind(reservation.uid,reservation.userId).run();
    throw new Error('AI usage exceeds reservation');
  }
  const included=Math.min(costMicrousd,amount(row.included_microusd));
  const paid=costMicrousd-included;
  const token=crypto.randomUUID();
  await batch(env,[
    env.DB.prepare(`UPDATE ai_budget_reservations SET status=?, settlement_uid=?, actual_included_microusd=?, actual_topup_microusd=?, updated_at=datetime('now')
      WHERE uid=? AND user_id=? AND status='pending'`).bind(refund?'refunded':'settled',token,included,paid,reservation.uid,reservation.userId),
    env.DB.prepare(`UPDATE ai_included_spend SET spend_microusd=spend_microusd-?,updated_at=datetime('now')
      WHERE user_id=? AND period_kind='day' AND period_key=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.included_microusd-included,reservation.userId,row.day_key,reservation.uid,token),
    env.DB.prepare(`UPDATE ai_included_spend SET spend_microusd=spend_microusd-?,updated_at=datetime('now')
      WHERE user_id=? AND period_kind='month' AND period_key=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.included_microusd-included,reservation.userId,row.month_key,reservation.uid,token),
    env.DB.prepare(`UPDATE ai_topup_accounts SET balance_microusd=balance_microusd+?,updated_at=datetime('now')
      WHERE user_id=? AND EXISTS(SELECT 1 FROM ai_budget_reservations WHERE uid=? AND settlement_uid=?)`)
      .bind(row.topup_microusd-paid,reservation.userId,reservation.uid,token),
    env.DB.prepare(`INSERT INTO ai_topup_ledger(uid,user_id,kind,amount_microusd,reservation_uid,actor)
      SELECT ?,user_id,'draw',actual_topup_microusd,uid,CAST(user_id AS TEXT) FROM ai_budget_reservations
      WHERE uid=? AND settlement_uid=? AND actual_topup_microusd>0`).bind(token,reservation.uid,token),
  ]);
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
      (SELECT COALESCE(SUM(topup_microusd),0) FROM ai_budget_reservations WHERE user_id=a.user_id AND status IN ('pending','review')) AS paid_held,
      (SELECT COUNT(*) FROM ai_budget_reservations WHERE user_id=a.user_id AND status='review') AS reviews
    FROM ai_topup_accounts a JOIN ai_included_spend d ON d.user_id=a.user_id AND d.period_kind='day' AND d.period_key=?
      JOIN ai_included_spend m ON m.user_id=a.user_id AND m.period_kind='month' AND m.period_key=? WHERE a.user_id=?`)
    .bind(t.day,t.month,t.day,t.month,userId).first<any>();
  if (!row || row.reviews) throw new Error('AI budget unreadable');
  const daily=amount(row.daily),monthly=amount(row.monthly),dayHeld=amount(row.day_held),monthHeld=amount(row.month_held);
  return { ...caps, day_key:t.day,month_key:t.month,
    day_spend_microusd:amount(daily-dayHeld),month_spend_microusd:amount(monthly-monthHeld),
    day_reserved_microusd:dayHeld,month_reserved_microusd:monthHeld,
    balance_microusd:amount(row.balance_microusd),topup_reserved_microusd:amount(row.paid_held) };
}
export async function reserveAiBudget(env:Env,userId:number,quoteMicrousd:number,now=new Date()) {
  amount(quoteMicrousd);
  const report=await loadAiBudget(env,userId,now);
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
    const dayRemaining=Math.max(0,current.daily_microusd-current.day_spend_microusd-current.day_reserved_microusd);
    const monthRemaining=Math.max(0,current.monthly_microusd-current.month_spend_microusd-current.month_reserved_microusd);
    return {ok:false as const,refusal:dayRemaining<=monthRemaining?'budget_user_day' as const:'budget_user_month' as const};
  }
  return { ok:true as const,reservation:{uid,userId} };
}
