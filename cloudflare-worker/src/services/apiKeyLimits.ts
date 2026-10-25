/**
 * D849 (#2472) part 2 — a member API key's own monthly cap, and the two key
 * alerts, on the one AI token ledger. No migration.
 *
 * WHICH HOLDS ARE A KEY'S. A metered call through a key (`meteredCall` with
 * `apiKeyUid`) takes its hold under `key:<uid>:exec:<execution>:<component>`
 * (`keyHoldKey`), so a key's month spend is a sum over its own holds in
 * `ai_budget_reservations`: pending and in-review holds at what they hold (or
 * the recorded cost in review, if higher), settled ones at what they charged,
 * refunded ones at nothing. The same rows D788's member limit counts.
 *
 * THE CAP (`key_limit_reached`). Checked immediately before the hold and again
 * right after it, counting the new hold: when the re-check fails the hold is
 * released and the call refused, so two calls racing past the cap together
 * are both refused rather than both charged. A key with no cap is not checked.
 * A cap or spend that cannot be read refuses (fails closed).
 *
 * THE ALERTS, on D788's `notify()` path (in-app and email, category billing):
 *   api_key_limit     once per key, month and threshold, at 80% and 100% of
 *                     the key's cap, after a settled charge passes it;
 *   api_key_failures  once per key and hour, when at least 50 calls on the key
 *                     in the last hour and more than 20% of them failed.
 * Each is sent at most once per window, deduplicated in `RATE_LIMITS`; a notice
 * that fails never fails the call. No secret, hash or amount of anyone else's
 * is in a notice: the key's own name and public prefix, and the member's own
 * figures.
 */
import type { Env } from '../types';
import { KEY_PREFIX } from './apiKeys';

/** The hold key of a metered call made through API key `uid`. */
export const keyHoldPrefix = (uid: string) => `key:${uid}:`;
export const keyHoldKey = (uid: string, executionId: string, component: string) => `${keyHoldPrefix(uid)}exec:${executionId}:${component}`;

export const KEY_LIMIT_THRESHOLDS = [80, 100] as const;
export const FAILURE_WINDOW_CALLS = 50;
/** More than this share of the window's calls failed (20%). */
export const FAILURE_SHARE = 0.2;

export const KEY_LIMIT_SENTENCE = 'This API key has reached its monthly AI token limit. Raise the key\'s limit in Developer settings, or wait for next month.';

const monthOf = (now: Date) => now.toISOString().slice(0, 7);
const integer = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** The key's monthly cap in micro-USD, or null when the member set none. Throws when the key cannot be read. */
export async function keyMonthlyLimit(env: Env, userId: number, uid: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT monthly_limit_microusd FROM member_api_keys WHERE uid = ? AND user_id = ?')
    .bind(uid, userId).first<{ monthly_limit_microusd: number | null }>();
  if (!row) throw new Error('API key unreadable');
  if (row.monthly_limit_microusd == null) return null;
  if (!integer(row.monthly_limit_microusd)) throw new Error('API key limit unreadable');
  return row.monthly_limit_microusd;
}

/**
 * What the key's own holds have taken this month, in micro-USD, leaving out
 * the hold under `exceptKey` (a call's own, on its replay). Throws when it
 * cannot be read.
 */
export async function keyMonthSpend(env: Env, userId: number, uid: string, now = new Date(), exceptKey: string | null = null): Promise<number> {
  const prefix = keyHoldPrefix(uid);
  const row = await env.DB.prepare(`SELECT COALESCE(SUM(CASE
        WHEN status = 'pending' THEN included_microusd + topup_microusd
        WHEN status = 'review' THEN MAX(included_microusd + topup_microusd, COALESCE(recorded_cost_microusd, 0))
        ELSE COALESCE(actual_included_microusd, 0) + COALESCE(actual_topup_microusd, 0) END), 0) AS used
      FROM ai_budget_reservations
      WHERE user_id = ? AND month_key = ? AND substr(idempotency_key, 1, ?) = ? AND idempotency_key IS NOT ?`)
    .bind(userId, monthOf(now), prefix.length, prefix, exceptKey).first<{ used: number }>();
  if (!row || !integer(Number(row.used))) throw new Error('API key spend unreadable');
  return Number(row.used);
}

/** Each live key's spend this month, for the limits read. A key whose spend cannot be read is null. */
export async function keysMonthSpend(env: Env, userId: number, uids: string[], now = new Date()): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const uid of uids) {
    try { out.set(uid, await keyMonthSpend(env, userId, uid, now)); } catch { out.set(uid, null); }
  }
  return out;
}

/** True when `quote` more would pass the cap. */
export const overCap = (used: number, quote: number, limit: number) => used + quote > limit;

async function onceIn(env: Env, key: string, ttlSeconds: number): Promise<boolean> {
  if (await env.RATE_LIMITS.get(key)) return false;
  await env.RATE_LIMITS.put(key, '1', { expirationTtl: ttlSeconds });
  return true;
}

async function keyLabel(env: Env, userId: number, uid: string): Promise<string> {
  const row = await env.DB.prepare('SELECT name, key_id FROM member_api_keys WHERE uid = ? AND user_id = ?')
    .bind(uid, userId).first<{ name: string; key_id: string }>();
  return row ? `"${row.name}" (${KEY_PREFIX}${row.key_id}…)` : 'one of your API keys';
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(2)}`;

/**
 * After a settled charge on a key with a cap: the highest threshold its spend
 * has now passed, notified once per key and month. Returns the threshold
 * notified, or null. Best effort: the caller catches.
 */
export async function noteKeyLimitThresholds(env: Env, userId: number, uid: string, now = new Date()): Promise<number | null> {
  const limit = await keyMonthlyLimit(env, userId, uid);
  if (limit == null || limit <= 0) return null;
  const used = await keyMonthSpend(env, userId, uid, now);
  const passed = KEY_LIMIT_THRESHOLDS.filter((t) => used * 100 >= limit * t);
  const top = passed.length ? passed[passed.length - 1] : null;
  if (top == null) return null;
  const month = monthOf(now);
  // A key's charges in a month only grow, so once the top threshold is sent no lower one can come after it.
  if (!(await onceIn(env, `api_key_notice:${uid}:${month}:${top}`, 40 * 86_400))) return null;
  const label = await keyLabel(env, userId, uid);
  const { notify } = await import('./notify');
  await notify(env, {
    userId, type: 'api_key_limit', category: 'billing', channels: ['in_app', 'email'],
    title: top === 100 ? `Your API key ${label} has reached its monthly limit` : `Your API key ${label} has used ${top}% of its monthly limit`,
    body: `${usd(used)} of ${usd(limit)} used this month. Calls through this key that use AI tokens are refused at the limit.`,
    link: '/developer/keys',
    payload: { key_uid: uid, threshold: top, month, limit_microusd: limit, used_microusd: used },
  });
  return top;
}

/**
 * After a failed call through a key: when the key made at least 50 calls in
 * the last hour and more than 20% failed, notify once per key and hour.
 * Returns true when it notified. Best effort: the caller catches.
 */
export async function noteKeyFailures(env: Env, userId: number, uid: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - 3_600_000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await env.DB.prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0) AS failed
      FROM api_usage_events WHERE user_id = ? AND api_key_uid = ? AND created_at >= ?`)
    .bind(userId, uid, since).first<{ calls: number; failed: number }>();
  const calls = Number(row?.calls ?? 0), failed = Number(row?.failed ?? 0);
  if (calls < FAILURE_WINDOW_CALLS || !(failed > calls * FAILURE_SHARE)) return false;
  if (!(await onceIn(env, `api_key_fail_notice:${uid}:${Math.floor(now.getTime() / 3_600_000)}`, 7_200))) return false;
  const label = await keyLabel(env, userId, uid);
  const { notify } = await import('./notify');
  await notify(env, {
    userId, type: 'api_key_failures', category: 'billing', channels: ['in_app', 'email'],
    title: `Calls through your API key ${label} are failing`,
    body: `${failed} of the last ${calls} calls in the past hour failed. Check the key's usage in Developer settings.`,
    link: '/developer/usage',
    payload: { key_uid: uid, calls, failed, window_minutes: 60 },
  });
  return true;
}
