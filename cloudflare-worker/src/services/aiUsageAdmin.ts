/**
 * D791 (#2216; part of D785, #2210) — HQ › AI usage: who uses AI and how,
 * platform-wide, the members who look like abuse, Pause AI and one member's
 * lower monthly cap.
 *
 * WHAT IS SUMMED. `ai_usage_logs` rows in the range, as D776's consumption read
 * sums them (`aiConsumption.ts`):
 *   - `runs` counts runs that ran: no refusal, and not a Llama Guard row
 *     (`guard_for` set), which is a check inside a run;
 *   - `cost_microusd` is every row's `est_cost_usd`, guard rows included;
 *   - `charged_microusd` is every row's `charged_microusd` (D762). A NULL
 *     charge (a row from before migration 493, or a run held for review) is
 *     never a zero: it is counted in `not_recorded`, and its cost is left out
 *     of `margin_microusd`, which is the charge less the cost of the rows that
 *     recorded one.
 * By role and by plan come from each member's `users` row at read time, the
 * plan being the AI licence (`aiLicenceKey`). Rows with no member (a system
 * run, `user_id` NULL or 0) read `system`.
 *
 * WHAT NEVER LEAVES. A member is `{ id, name }`, the name HQ already shows. No
 * email, no prompt and no output: `ai_usage_logs` holds neither of the last
 * two, and no query here selects an email.
 *
 * THE FLAGS (`AI_USAGE_FLAGS`, one block so they are tested and tuned in one
 * place). Each says why and since when. They read their own windows from the
 * read's clock, not the range: a flag is about now.
 */
import type { Env } from '../types';
import { AI_PAUSED_MESSAGE, AI_USD_SCALE, aiLicenceKey } from './aiBudget';
export { AI_PAUSED_MESSAGE, aiPaused, memberAiCap } from './aiBudget';

export const AI_USAGE_RANGES = ['7d', '30d', 'mtd'] as const;
export type AiUsageRange = (typeof AI_USAGE_RANGES)[number];

/** The flag thresholds. Money is micro-USD. */
export const AI_USAGE_FLAGS = {
  /** `spike`: today's charge is more than this many times the member's 7-day daily average… */
  spikeMultiple: 5,
  /** …and at least this much. */
  spikeMinMicrousd: 5 * AI_USD_SCALE,
  /** The days the spike's average is taken over, before today. */
  spikeAverageDays: 7,
  /** `refusals`: this many refused runs or more… */
  refusalsMin: 20,
  /** …in this many hours. */
  refusalsHours: 24,
  /** `held`: this many runs held for review or more. */
  heldMin: 3,
  /** `refund_after_spend`: a refund or dispute of a pack after more than this share of it was spent (percent)… */
  refundSpentPercent: 80,
  /** …looked for over this many days. */
  refundWindowDays: 30,
  /** `new_heavy`: an account younger than this many days… */
  newAccountDays: 7,
  /** …that topped up and was charged more than this… */
  newHeavyMicrousd: 20 * AI_USD_SCALE,
  /** …within this many hours of its first top-up. */
  newHeavyHours: 24,
} as const;

export const TOP_MEMBERS = 20;
/**
 * Velocity is today's charge over the member's 7-day daily average, the average
 * counted as at least this much: a member who spent a few cents (or nothing)
 * before today is measured against $1, so thirty first-day members spending
 * ten cents do not outrank one who went from $2 a day to $20.
 */
export const VELOCITY_FLOOR_MICROUSD = 1 * AI_USD_SCALE;
/** The most a member's own cap can be set to, in USD: a cap only narrows an allowance. */
export const MEMBER_CAP_MAX_USD = 100_000;

export type AiUsageFlag = 'spike' | 'refusals' | 'held' | 'refund_after_spend' | 'new_heavy';

const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const dayStart = (d: Date) => `${d.toISOString().slice(0, 10)} 00:00:00`;
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);
const usd = (micro: number) => `$${(micro / AI_USD_SCALE).toFixed(2)}`;
const micro = (costUsd: unknown) => Math.round(Number(costUsd || 0) * AI_USD_SCALE);
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

/** The range's bounds as `created_at` compares them (UTC), from the read's clock. Null for an unknown range. */
export function rangeBounds(range: string, now: Date): { from: string; to: string } | null {
  const to = `${daysBefore(now, -1).toISOString().slice(0, 10)} 00:00:00`;
  if (range === '7d') return { from: dayStart(daysBefore(now, 6)), to };
  if (range === '30d') return { from: dayStart(daysBefore(now, 29)), to };
  if (range === 'mtd') return { from: `${now.toISOString().slice(0, 7)}-01 00:00:00`, to };
  return null;
}

interface Sums { runs: number; refused: number; cost_microusd: number; charged_microusd: number; margin_microusd: number; not_recorded: number }
function sums(row: any): Sums {
  const charged = int(row.charged);
  return {
    runs: int(row.runs), refused: int(row.refused), cost_microusd: micro(row.cost_usd),
    charged_microusd: charged, margin_microusd: charged - micro(row.recorded_cost_usd), not_recorded: int(row.not_recorded),
  };
}
function add(a: Sums, b: Sums): Sums {
  return {
    runs: a.runs + b.runs, refused: a.refused + b.refused, cost_microusd: a.cost_microusd + b.cost_microusd,
    charged_microusd: a.charged_microusd + b.charged_microusd, margin_microusd: a.margin_microusd + b.margin_microusd,
    not_recorded: a.not_recorded + b.not_recorded,
  };
}
const ZERO: Sums = { runs: 0, refused: 0, cost_microusd: 0, charged_microusd: 0, margin_microusd: 0, not_recorded: 0 };

// Each query is written out whole, so the schema guards read every column it names.
const BY_DAY = `SELECT substr(created_at, 1, 10) AS day,
       SUM(CASE WHEN guard_for IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS runs,
       SUM(CASE WHEN refusal IS NOT NULL THEN 1 ELSE 0 END) AS refused,
       COALESCE(SUM(est_cost_usd), 0) AS cost_usd,
       COALESCE(SUM(charged_microusd), 0) AS charged,
       COALESCE(SUM(CASE WHEN charged_microusd IS NOT NULL THEN est_cost_usd END), 0) AS recorded_cost_usd,
       SUM(CASE WHEN charged_microusd IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS not_recorded
  FROM ai_usage_logs WHERE created_at >= ? AND created_at < ?
 GROUP BY substr(created_at, 1, 10) ORDER BY day`;
const BY_MODEL = `SELECT model,
       SUM(CASE WHEN guard_for IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS runs,
       SUM(CASE WHEN refusal IS NOT NULL THEN 1 ELSE 0 END) AS refused,
       COALESCE(SUM(est_cost_usd), 0) AS cost_usd,
       COALESCE(SUM(charged_microusd), 0) AS charged,
       COALESCE(SUM(CASE WHEN charged_microusd IS NOT NULL THEN est_cost_usd END), 0) AS recorded_cost_usd,
       SUM(CASE WHEN charged_microusd IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS not_recorded
  FROM ai_usage_logs WHERE created_at >= ? AND created_at < ?
 GROUP BY model ORDER BY charged DESC, model`;
// The member's licence columns only (`aiLicenceKey`), and the name HQ shows. Never `u.*`: no email is read.
const BY_MEMBER = `SELECT a.user_id, COALESCE(u.display_name, u.name) AS name, u.role, u.subscription_tier, u.subscription_status,
       u.subscription_renews_at, u.investor_tier, u.investor_subscription_status, u.investor_subscription_renews_at,
       a.runs, a.refused, a.cost_usd, a.charged, a.recorded_cost_usd, a.not_recorded
  FROM (SELECT user_id,
          SUM(CASE WHEN guard_for IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS runs,
          SUM(CASE WHEN refusal IS NOT NULL THEN 1 ELSE 0 END) AS refused,
          COALESCE(SUM(est_cost_usd), 0) AS cost_usd,
          COALESCE(SUM(charged_microusd), 0) AS charged,
          COALESCE(SUM(CASE WHEN charged_microusd IS NOT NULL THEN est_cost_usd END), 0) AS recorded_cost_usd,
          SUM(CASE WHEN charged_microusd IS NULL AND refusal IS NULL THEN 1 ELSE 0 END) AS not_recorded
        FROM ai_usage_logs WHERE created_at >= ? AND created_at < ? GROUP BY user_id) a
  LEFT JOIN users u ON u.id = a.user_id`;
const VELOCITY = `SELECT v.user_id, COALESCE(u.display_name, u.name) AS name, v.today, v.prior
  FROM (SELECT user_id,
          COALESCE(SUM(CASE WHEN created_at >= ? THEN charged_microusd END), 0) AS today,
          COALESCE(SUM(CASE WHEN created_at < ? THEN charged_microusd END), 0) AS prior
        FROM ai_usage_logs WHERE user_id > 0 AND created_at >= ? GROUP BY user_id) v
  LEFT JOIN users u ON u.id = v.user_id`;
const REFUSALS = `SELECT l.user_id, COALESCE(u.display_name, u.name) AS name, COUNT(*) AS n, MIN(l.created_at) AS since
  FROM ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
 WHERE l.user_id > 0 AND l.refusal IS NOT NULL AND l.created_at >= ?
 GROUP BY l.user_id HAVING COUNT(*) >= ?`;
const HELD = `SELECT r.user_id, COALESCE(u.display_name, u.name) AS name, COUNT(*) AS n, MIN(r.created_at) AS since
  FROM ai_budget_reservations r LEFT JOIN users u ON u.id = r.user_id
 WHERE r.status = 'review' GROUP BY r.user_id HAVING COUNT(*) >= ?`;
// A reversal's shortfall is the share of the refunded tokens the member had already used (D755 §8).
const REFUNDS = `SELECT l.user_id, COALESCE(u.display_name, u.name) AS name, l.kind, l.created_at, l.delta_microusd, l.shortfall_microusd
  FROM ai_credit_ledger l LEFT JOIN users u ON u.id = l.user_id
 WHERE l.kind IN ('refund', 'dispute') AND l.created_at >= ?
   AND l.shortfall_microusd * 100 > ? * (l.shortfall_microusd - l.delta_microusd)
 ORDER BY l.created_at, l.uid`;
const NEW_HEAVY = `SELECT n.id AS user_id, n.name, n.created_at, n.first_topup, n.charged FROM (
  SELECT u.id, COALESCE(u.display_name, u.name) AS name, u.created_at, p.first_topup,
         (SELECT COALESCE(SUM(l.charged_microusd), 0) FROM ai_usage_logs l
           WHERE l.user_id = u.id AND l.created_at >= p.first_topup AND l.created_at < datetime(p.first_topup, ?)) AS charged
    FROM users u
    JOIN (SELECT user_id, MIN(credited_at) AS first_topup FROM ai_topup_purchases WHERE credited_at IS NOT NULL GROUP BY user_id) p
      ON p.user_id = u.id
   WHERE u.created_at >= ?) n
 WHERE n.charged > ? ORDER BY n.first_topup`;
const PAUSED = `SELECT p.user_id, COALESCE(u.display_name, u.name) AS name, p.reason, p.paused_at, p.paused_by,
       COALESCE(b.display_name, b.name) AS paused_by_name
  FROM member_ai_pauses p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN users b ON b.id = p.paused_by
 ORDER BY p.paused_at, p.user_id`;
const CAPS = `SELECT c.user_id, COALESCE(u.display_name, u.name) AS name, c.monthly_microusd, c.set_at, c.set_by,
       COALESCE(b.display_name, b.name) AS set_by_name
  FROM member_ai_caps c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users b ON b.id = c.set_by
 ORDER BY c.set_at, c.user_id`;

async function all<T = any>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  const r = await env.DB.prepare(sql).bind(...binds).all<T>();
  if (r.success !== true) throw new Error('AI usage unreadable');
  return r.results ?? [];
}
const member = (id: unknown, name: unknown) => ({ id: int(id), name: typeof name === 'string' && name ? name : null });

/** The flag sentences, from the figures that raised them. */
export function flagWhy(flag: AiUsageFlag, f: Record<string, number>): string {
  switch (flag) {
    case 'spike':
      return f.average > 0
        ? `Charged ${usd(f.today)} today, ${(f.today / f.average).toFixed(1)}× the ${AI_USAGE_FLAGS.spikeAverageDays}-day daily average of ${usd(f.average)}.`
        : `Charged ${usd(f.today)} today, with nothing charged in the ${AI_USAGE_FLAGS.spikeAverageDays} days before.`;
    case 'refusals':
      return `${f.count} refused runs in the last ${AI_USAGE_FLAGS.refusalsHours} hours.`;
    case 'held':
      return `${f.count} runs held for review.`;
    case 'refund_after_spend':
      return `${f.count === 1 ? 'A refund or dispute' : `${f.count} refunds or disputes`} of a token pack after ${f.spent}% of it was spent.`;
    case 'new_heavy':
      return `Account ${f.ageDays} day${f.ageDays === 1 ? '' : 's'} old; charged ${usd(f.charged)} within ${AI_USAGE_FLAGS.newHeavyHours} hours of its first top-up.`;
  }
}

/** The five flags, from the read's clock. */
export async function aiUsageFlags(env: Env, now: Date) {
  const F = AI_USAGE_FLAGS;
  const today = dayStart(now);
  const flags: { member: { id: number; name: string | null }; flag: AiUsageFlag; why: string; since: string }[] = [];

  for (const r of await all(env, VELOCITY, today, today, dayStart(daysBefore(now, F.spikeAverageDays)))) {
    const t = int(r.today), prior = int(r.prior);
    // today > multiple × (prior ÷ days), in integers.
    if (t >= F.spikeMinMicrousd && t * F.spikeAverageDays > F.spikeMultiple * prior) {
      flags.push({ member: member(r.user_id, r.name), flag: 'spike', since: today,
        why: flagWhy('spike', { today: t, average: prior / F.spikeAverageDays }) });
    }
  }
  for (const r of await all(env, REFUSALS, sqlTime(new Date(now.getTime() - F.refusalsHours * 3_600_000)), F.refusalsMin)) {
    flags.push({ member: member(r.user_id, r.name), flag: 'refusals', since: r.since, why: flagWhy('refusals', { count: int(r.n) }) });
  }
  for (const r of await all(env, HELD, F.heldMin)) {
    flags.push({ member: member(r.user_id, r.name), flag: 'held', since: r.since, why: flagWhy('held', { count: int(r.n) }) });
  }
  const refunds = new Map<number, { name: unknown; since: string; count: number; spent: number }>();
  for (const r of await all(env, REFUNDS, sqlTime(daysBefore(now, F.refundWindowDays)), F.refundSpentPercent)) {
    const target = int(r.shortfall_microusd) - int(r.delta_microusd);
    const spent = target > 0 ? Math.floor((100 * int(r.shortfall_microusd)) / target) : 0;
    const seen = refunds.get(int(r.user_id));
    if (seen) { seen.count += 1; seen.spent = Math.max(seen.spent, spent); }
    else refunds.set(int(r.user_id), { name: r.name, since: r.created_at, count: 1, spent });
  }
  for (const [id, r] of refunds) {
    flags.push({ member: member(id, r.name), flag: 'refund_after_spend', since: r.since, why: flagWhy('refund_after_spend', { count: r.count, spent: r.spent }) });
  }
  for (const r of await all(env, NEW_HEAVY, `+${F.newHeavyHours} hours`, sqlTime(daysBefore(now, F.newAccountDays)), F.newHeavyMicrousd)) {
    const created = Date.parse(`${String(r.created_at).replace(' ', 'T')}Z`);
    const ageDays = Number.isFinite(created) ? Math.max(0, Math.floor((now.getTime() - created) / 86_400_000)) : 0;
    flags.push({ member: member(r.user_id, r.name), flag: 'new_heavy', since: r.first_topup,
      why: flagWhy('new_heavy', { ageDays, charged: int(r.charged) }) });
  }
  return flags;
}

/** `GET /api/admin/ai-usage`: the platform's AI use over the range, the top members, the flags, and who is paused or capped. */
export async function platformAiUsage(env: Env, range: AiUsageRange, now = new Date()) {
  const bounds = rangeBounds(range, now)!;
  const byDay = (await all(env, BY_DAY, bounds.from, bounds.to)).map((r) => ({ day: r.day, ...sums(r) }));
  const byModel = (await all(env, BY_MODEL, bounds.from, bounds.to)).map((r) => ({ model: r.model, ...sums(r) }));
  const members = await all(env, BY_MEMBER, bounds.from, bounds.to);
  const byRole = new Map<string, Sums>(), byPlan = new Map<string, Sums>();
  const top: { member: { id: number; name: string | null }; s: Sums }[] = [];
  for (const r of members) {
    const s = sums(r);
    const isMember = int(r.user_id) > 0 && r.role != null;
    const role = isMember ? String(r.role) : 'system';
    const plan = isMember ? aiLicenceKey(r) : 'system';
    byRole.set(role, add(byRole.get(role) ?? ZERO, s));
    byPlan.set(plan, add(byPlan.get(plan) ?? ZERO, s));
    if (int(r.user_id) > 0) top.push({ member: member(r.user_id, r.name), s });
  }
  const totals = byDay.reduce((t, d) => add(t, d), ZERO);
  const split = (m: Map<string, Sums>, key: string) => [...m].map(([k, s]) => ({ [key]: k, ...s }))
    .sort((a: any, b: any) => b.charged_microusd - a.charged_microusd || String(a[key]).localeCompare(String(b[key])));

  const today = dayStart(now);
  const F = AI_USAGE_FLAGS;
  const velocity = (await all(env, VELOCITY, today, today, dayStart(daysBefore(now, F.spikeAverageDays))))
    .map((r) => {
      const t = int(r.today), prior = int(r.prior), average = Math.round(prior / F.spikeAverageDays);
      return { member: member(r.user_id, r.name), today_microusd: t, daily_average_microusd: average,
        ratio: Math.round((t * 100) / Math.max(prior / F.spikeAverageDays, VELOCITY_FLOOR_MICROUSD)) / 100 };
    })
    .filter((v) => v.today_microusd > 0)
    .sort((a, b) => b.ratio - a.ratio || b.today_microusd - a.today_microusd || a.member.id - b.member.id)
    .slice(0, TOP_MEMBERS);

  return {
    range, from: bounds.from, to: bounds.to, generated_at: sqlTime(now),
    totals, by_day: byDay, by_model: byModel, by_role: split(byRole, 'role'), by_plan: split(byPlan, 'plan'),
    top_charged: top.sort((a, b) => b.s.charged_microusd - a.s.charged_microusd || a.member.id - b.member.id).slice(0, TOP_MEMBERS)
      .map(({ member: m, s }) => ({ member: m, runs: s.runs, charged_microusd: s.charged_microusd, cost_microusd: s.cost_microusd, not_recorded: s.not_recorded })),
    top_velocity: velocity,
    flags: await aiUsageFlags(env, now),
    thresholds: AI_USAGE_FLAGS,
    paused: (await all(env, PAUSED)).map((r) => ({ member: member(r.user_id, r.name), reason: r.reason, paused_at: r.paused_at,
      paused_by: member(r.paused_by, r.paused_by_name) })),
    caps: (await all(env, CAPS)).map((r) => ({ member: member(r.user_id, r.name), monthly_microusd: int(r.monthly_microusd), set_at: r.set_at,
      set_by: member(r.set_by, r.set_by_name) })),
  };
}

// ---------------------------------------------------------------------------
// Pause AI, and a member's cap. Each change and its audit line are one batch.
// ---------------------------------------------------------------------------

async function batch(env: Env, statements: D1PreparedStatement[]) {
  const results = await env.DB.batch(statements);
  if (results.length !== statements.length || results.some((r) => r.success !== true)) throw new Error('AI usage action not recorded');
  return results;
}

export type PauseOutcome = { ok: true } | { ok: false; error: 'already_paused' | 'not_paused' };

/**
 * Pause the member's AI, with the reason, audited in the same batch. The member
 * is told once, in the app, when the pause is new: a second press changes and
 * tells nothing.
 */
export async function pauseMemberAi(env: Env, input: { memberId: number; actorId: number; reason: string }): Promise<PauseOutcome> {
  const details = JSON.stringify({ member_id: input.memberId, actor_id: input.actorId, reason: input.reason });
  const results = await batch(env, [
    env.DB.prepare('INSERT OR IGNORE INTO member_ai_pauses(user_id, reason, paused_by) VALUES(?, ?, ?)').bind(input.memberId, input.reason, input.actorId),
    env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id) SELECT 'ai_member_paused', ?, ?, ? WHERE changes() = 1`)
      .bind(details, String(input.actorId), input.memberId),
  ]);
  if (Number(results[0].meta.changes) !== 1) return { ok: false, error: 'already_paused' };
  try {
    const { notify } = await import('./notify');
    await notify(env, { userId: input.memberId, type: 'ai_paused', category: 'billing', title: 'AI is paused on your account',
      body: AI_PAUSED_MESSAGE, link: '/account/usage', payload: {}, channels: ['in_app'] });
  } catch { /* best-effort: the pause holds whether or not the notice was written */ }
  return { ok: true };
}

/** Restore the member's AI, with the reason, audited in the same batch, naming the pause it ends. */
export async function unpauseMemberAi(env: Env, input: { memberId: number; actorId: number; reason: string }): Promise<PauseOutcome> {
  const results = await batch(env, [
    env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id)
      SELECT 'ai_member_unpaused', json_object('member_id', user_id, 'actor_id', ?, 'reason', ?, 'paused_reason', reason, 'paused_at', paused_at, 'paused_by', paused_by), ?, user_id
        FROM member_ai_pauses WHERE user_id = ?`).bind(input.actorId, input.reason, String(input.actorId), input.memberId),
    env.DB.prepare('DELETE FROM member_ai_pauses WHERE user_id = ?').bind(input.memberId),
  ]);
  return Number(results[1].meta.changes) === 1 ? { ok: true } : { ok: false, error: 'not_paused' };
}

/** Set (or, with null, clear) the member's own monthly cap, audited with the cap before and after. */
export async function setMemberAiCap(env: Env, input: { memberId: number; actorId: number; reason: string; monthlyMicrousd: number | null }) {
  const log = env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id)
    SELECT ?, json_object('member_id', ?, 'actor_id', ?, 'reason', ?, 'before_microusd', (SELECT monthly_microusd FROM member_ai_caps WHERE user_id = ?), 'after_microusd', ?), ?, ?`)
    .bind(input.monthlyMicrousd === null ? 'ai_member_cap_cleared' : 'ai_member_cap_set', input.memberId, input.actorId, input.reason,
      input.memberId, input.monthlyMicrousd, String(input.actorId), input.memberId);
  const write = input.monthlyMicrousd === null
    ? env.DB.prepare('DELETE FROM member_ai_caps WHERE user_id = ?').bind(input.memberId)
    : env.DB.prepare(`INSERT INTO member_ai_caps(user_id, monthly_microusd, set_by) VALUES(?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET monthly_microusd = excluded.monthly_microusd, set_by = excluded.set_by, set_at = datetime('now')`)
      .bind(input.memberId, input.monthlyMicrousd, input.actorId);
  await batch(env, [log, write]);
}
