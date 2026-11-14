/**
 * D788 (#2213) — a member's own monthly AI spend limit, in dollars.
 *
 * WHAT THE LIMIT COUNTS. Everything the member's runs are charged in a UTC
 * month, the plan's allowance included (D783): the limit is on what the member
 * spends, and the allowance is part of it. A month's charge is its holds
 * (`ai_budget_reservations`, keyed by `month_key`): a hold still pending or in
 * review counts at what it holds, a settled or refunded one at what it was
 * charged. No row in `member_ai_spend_limits` means no limit.
 *
 * WHERE IT IS ENFORCED. In the hold's own conditional insert
 * (`aiBudget.reserveAiBudget`), so two holds racing cannot both
 * pass a limit that only one fits: D1 runs one write at a time, and the second
 * insert counts the first hold. A refused hold is `spend_limit`, with the limit
 * and the date the month resets; nothing is held and nothing runs.
 *
 * NOTICES. When a settled run first takes the month past 50%, 80% or 100% of
 * the limit, and that notice is switched on, one in-app notification and one
 * email (`notify`, category `billing`). Each threshold is recorded in
 * `member_ai_spend_notices` once per member and month; a run that passes two at
 * once sends the higher one. The notice names the amount and the reset date,
 * never the run, its prompt or its output.
 */
import type { Env } from '../types';

export const SPEND_LIMIT_MAX_USD = 100_000;
export const SPEND_THRESHOLDS = [50, 80, 100] as const;
export type SpendThreshold = typeof SPEND_THRESHOLDS[number];

/** `YYYY-MM-01` of the UTC month after `now`: the day a monthly limit resets. */
export function resetsOn(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** `$1,234.50`: a limit or a charge, in micro-USD, as the member reads it. */
export function usdText(microusd: number): string {
  return `$${(microusd / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `1 November 2026`: a reset date as the member reads it. */
export function dateText(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface SpendLimitRow {
  monthly_limit_microusd: number;
  notify: Record<SpendThreshold, boolean>;
  updated_at: string;
}

export async function readLimitRow(env: Env, userId: number): Promise<SpendLimitRow | null> {
  const row = await env.DB.prepare(
    'SELECT monthly_limit_microusd, notify_50, notify_80, notify_100, updated_at FROM member_ai_spend_limits WHERE user_id = ?',
  ).bind(userId).first<any>();
  if (!row) return null;
  return {
    monthly_limit_microusd: Number(row.monthly_limit_microusd),
    notify: { 50: row.notify_50 === 1, 80: row.notify_80 === 1, 100: row.notify_100 === 1 },
    updated_at: row.updated_at,
  };
}

/**
 * This UTC month's charge: a hold still pending or in review at what it holds, a
 * settled or refunded one at what it was charged. `settledOnly` counts the
 * closed ones alone, which is what a notice reads. The same expression is the
 * hold's limit clause in `aiBudget.reserveAiBudget`; the SQL is written out in
 * each statement, never interpolated (`check-sql-prepare`).
 */
export async function monthCharged(env: Env, userId: number, month: string, settledOnly = false): Promise<number> {
  const row = settledOnly
    ? await env.DB.prepare(
      `SELECT COALESCE(SUM(COALESCE(actual_included_microusd,0)+COALESCE(actual_topup_microusd,0)),0) AS charged
         FROM ai_budget_reservations WHERE user_id = ? AND month_key = ? AND status IN ('settled','refunded')`,
    ).bind(userId, month).first<{ charged: number }>()
    : await env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('pending','review') THEN included_microusd+topup_microusd
           ELSE COALESCE(actual_included_microusd,0)+COALESCE(actual_topup_microusd,0) END),0) AS charged
         FROM ai_budget_reservations WHERE user_id = ? AND month_key = ?`,
    ).bind(userId, month).first<{ charged: number }>();
  if (!row) throw new Error('AI spend unreadable');
  return Number(row.charged);
}

/** Why a hold the insert refused was refused for the limit, or null when the limit did not refuse it. */
export async function limitRefusal(env: Env, userId: number, quoteMicrousd: number, now: Date) {
  const limit = await readLimitRow(env, userId);
  if (!limit) return null;
  const charged = await monthCharged(env, userId, now.toISOString().slice(0, 7));
  if (charged + quoteMicrousd <= limit.monthly_limit_microusd) return null;
  return { limit_microusd: limit.monthly_limit_microusd, resets_on: resetsOn(now) };
}

/** The member's own words for a refused hold (D788). */
export function spendLimitMessage(detail?: { limit_microusd?: number; resets_on?: string } | null, now = new Date()): string {
  const amount = detail?.limit_microusd != null ? ` of ${usdText(detail.limit_microusd)}` : '';
  return `This run would pass your monthly AI spend limit${amount}. Raise it on Usage › Limits, or wait until ${dateText(detail?.resets_on ?? resetsOn(now))}.`;
}

/** GET /api/ai-budget/limit's body, less the allowance the route adds. */
export async function readSpendLimit(env: Env, userId: number, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const [limit, charged] = await Promise.all([readLimitRow(env, userId), monthCharged(env, userId, month)]);
  return {
    month, resets_on: resetsOn(now), charged_microusd: charged,
    limit_microusd: limit?.monthly_limit_microusd ?? null,
    share_used: limit && limit.monthly_limit_microusd > 0 ? Math.round((charged / limit.monthly_limit_microusd) * 1000) / 10 : null,
    notify: limit?.notify ?? { 50: true, 80: true, 100: true },
    updated_at: limit?.updated_at ?? null,
  };
}

/** A PUT body's limit and notices, or the field it refuses with its message. */
export function parseSpendLimit(body: unknown):
  { ok: true; limit_microusd: number | null; notify: Record<SpendThreshold, boolean> }
  | { ok: false; field: string; message: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!('monthly_limit_usd' in b)) return { ok: false, field: 'monthly_limit_usd', message: 'Give a monthly limit in dollars, or null to remove it.' };
  const raw = b.monthly_limit_usd;
  let limit: number | null = null;
  if (raw !== null) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, field: 'monthly_limit_usd', message: 'The limit must be a number of dollars, or null.' };
    if (raw < 0) return { ok: false, field: 'monthly_limit_usd', message: 'The limit cannot be negative.' };
    if (raw > SPEND_LIMIT_MAX_USD) return { ok: false, field: 'monthly_limit_usd', message: `The limit cannot be more than $${SPEND_LIMIT_MAX_USD.toLocaleString('en-US')}.` };
    const cents = Math.round(raw * 100);
    if (Math.abs(raw * 100 - cents) > 1e-6) return { ok: false, field: 'monthly_limit_usd', message: 'The limit has at most two decimals.' };
    limit = cents * 10_000;
  }
  const notify = { 50: true, 80: true, 100: true } as Record<SpendThreshold, boolean>;
  if (b.notify !== undefined) {
    if (!b.notify || typeof b.notify !== 'object' || Array.isArray(b.notify)) return { ok: false, field: 'notify', message: 'Notices are { "50": true|false, "80": …, "100": … }.' };
    const n = b.notify as Record<string, unknown>;
    for (const key of Object.keys(n)) {
      if (!SPEND_THRESHOLDS.includes(Number(key) as SpendThreshold)) return { ok: false, field: `notify.${key}`, message: 'Notices are at 50, 80 and 100%.' };
      if (typeof n[key] !== 'boolean') return { ok: false, field: `notify.${key}`, message: 'A notice is on (true) or off (false).' };
      notify[Number(key) as SpendThreshold] = n[key] as boolean;
    }
  }
  return { ok: true, limit_microusd: limit, notify };
}

/** Set or remove the member's limit. */
export async function writeSpendLimit(env: Env, userId: number, limitMicrousd: number | null, notify: Record<SpendThreshold, boolean>) {
  if (limitMicrousd === null) {
    await env.DB.prepare('DELETE FROM member_ai_spend_limits WHERE user_id = ?').bind(userId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO member_ai_spend_limits (user_id, monthly_limit_microusd, notify_50, notify_80, notify_100, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET monthly_limit_microusd = excluded.monthly_limit_microusd,
       notify_50 = excluded.notify_50, notify_80 = excluded.notify_80, notify_100 = excluded.notify_100, updated_at = excluded.updated_at`,
  ).bind(userId, limitMicrousd, notify[50] ? 1 : 0, notify[80] ? 1 : 0, notify[100] ? 1 : 0).run();
}

/**
 * After a run settles: send the notice for the highest switched-on threshold
 * this month's settled charge has now passed for the first time. The lower ones
 * it passed with it are recorded, unsent, so they never fire later. Best
 * effort: a notice that fails never fails the settlement (the caller catches).
 */
export async function noteSpendThresholds(env: Env, userId: number, month: string): Promise<SpendThreshold | null> {
  const limit = await readLimitRow(env, userId);
  if (!limit || limit.monthly_limit_microusd <= 0) return null;
  const charged = await monthCharged(env, userId, month, true);
  if (charged <= 0) return null;
  const passed = SPEND_THRESHOLDS.filter((t) => limit.notify[t] && charged * 100 >= limit.monthly_limit_microusd * t);
  const fresh: SpendThreshold[] = [];
  for (const t of passed) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO member_ai_spend_notices (user_id, month, threshold) VALUES (?, ?, ?)')
      .bind(userId, month, t).run();
    if (r.meta?.changes === 1) fresh.push(t);
  }
  const top = fresh.length ? fresh[fresh.length - 1] : null;
  if (top == null) return null;
  const [y, m] = month.split('-').map(Number);
  const reset = resetsOn(new Date(Date.UTC(y, m - 1, 1)));
  const { notify } = await import('./notify');
  const title = top === 100
    ? `You have reached your monthly AI spend limit of ${usdText(limit.monthly_limit_microusd)}`
    : `You have used ${top}% of your monthly AI spend limit of ${usdText(limit.monthly_limit_microusd)}`;
  await notify(env, {
    userId, type: 'ai_spend_limit', category: 'billing', channels: ['in_app', 'email'],
    title,
    body: `${usdText(charged)} of ${usdText(limit.monthly_limit_microusd)} charged this month. The limit resets on ${dateText(reset)}.`,
    link: '/account/usage',
    payload: { threshold: top, month, limit_microusd: limit.monthly_limit_microusd, charged_microusd: charged, resets_on: reset },
  });
  return top;
}
