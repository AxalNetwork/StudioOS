/**
 * One AI quota gate, over one ledger.
 *
 * pipeline, networkfx and legalcap each carried a private `checkAiQuota`
 * counting rows in `shared_services_log`. All three used the same 60/hour
 * limit and all three behaved differently when the count could not be read:
 *
 *   legalcap   caught the error and returned "under the limit", so every AI
 *              call on that router was unmetered.
 *   pipeline   did not catch it, so the request 500'd.
 *   networkfx  did not catch it either.
 *
 * That divergence was not a design; it was three people writing the same
 * function on three days. It mattered because the table they all counted did
 * not exist until migration 177 — so in production the limiter was either
 * absent or fatal, never a limiter.
 *
 * The posture here matches `middleware/rateLimit.ts`: a bucket that cannot
 * read its own store answers 503, not 200 and not 429. "I can't tell" is a
 * distinct answer from "you're under" and from "you're over", and collapsing
 * the first into the second is what turns an outage into a bypass.
 */
import type { Env } from '../types';

/** Shared ceiling. Was duplicated as REVIEW_RATE_LIMIT / AI_RATE_LIMIT / 60. */
export const AI_CALLS_PER_HOUR = 60;

export type AiQuotaGate =
  | { ok: true; used: number }
  | { ok: false; status: 429 | 503; error: string };

/**
 * Count this user's model calls in the trailing hour and decide.
 *
 * `note` is appended to the 429 message where a route has route-specific
 * advice (legalcap's equity split offers an explicit-allocation escape).
 */
export async function aiQuotaGate(
  env: Env,
  userId: number,
  opts: { limit?: number; note?: string } = {},
): Promise<AiQuotaGate> {
  const limit = opts.limit ?? AI_CALLS_PER_HOUR;
  let used: number;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM shared_services_log
        WHERE performed_by = ?
          AND action_type = 'ai_call'
          AND created_at > datetime('now', '-1 hour')`,
    ).bind(userId).first<{ n: number }>();
    used = Number(row?.n ?? 0);
  } catch (e: any) {
    console.error('aiQuotaGate: ledger unreadable —', e?.message);
    return { ok: false, status: 503, error: 'Rate limiter unavailable, try again shortly' };
  }
  if (used >= limit) {
    const base = `Rate limit (${limit} AI calls/hour)`;
    return { ok: false, status: 429, error: opts.note ? `${base}. ${opts.note}` : base };
  }
  return { ok: true, used };
}

/**
 * Append to the shared-services ledger. Best-effort by design: the action has
 * already happened, and failing the caller's request because the audit row
 * would not write helps nobody. It is logged rather than swallowed silently
 * so a broken ledger is visible in tail — quietly dropping these is how the
 * missing table stayed hidden.
 */
export async function recordSharedServiceAction(
  env: Env,
  actionType: string,
  performedBy: number | null,
  details: unknown = {},
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by)
       VALUES (NULL, ?, ?, ?)`,
    ).bind(actionType, JSON.stringify(details), performedBy).run();
  } catch (e: any) {
    console.error('recordSharedServiceAction:', e?.message);
  }
}
