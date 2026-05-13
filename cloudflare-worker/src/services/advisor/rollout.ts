/**
 * Personal Advisor kill switch.
 *
 * Originally (Task #5) this module orchestrated a three-phase staged
 * rollout (admin/allowlist + deterministic-hash percentage gate +
 * "new signups after" cutoff). Phase 3 has stuck at 100%, so the
 * staged-rollout machinery has been removed (Task #7).
 *
 * What remains is a single hard kill switch consulted by every
 * /api/advisor/* route: when either `ADVISOR_V2_DISABLED` or
 * `ADVISOR_DISABLED` is truthy, the route returns 503 with the
 * canonical "temporarily unavailable while we ship an update"
 * message. Both names are honoured (logical OR — a stale
 * `ADVISOR_V2_DISABLED=0` must never silently override an operator's
 * emergency `ADVISOR_DISABLED=1`).
 *
 * The per-user `users.advisor_locked` lock is a separate concern and
 * still lives in `guardrails.ts::checkKillSwitch`.
 */
import type { Env } from '../../types';

export const ADVISOR_DISABLED_MESSAGE =
  'The Personal Advisor is temporarily unavailable while we ship an update. ' +
  'Please try again in a few minutes.';

const truthy = (v: string | undefined): boolean => v === '1' || v === 'true';

/**
 * Returns true when an operator has explicitly disabled the advisor
 * via either env flag. Pure — no D1 / KV / fetch — so the route layer
 * can call it on every request without latency cost.
 */
export function isAdvisorDisabled(env: Env): boolean {
  const e = env as unknown as { ADVISOR_V2_DISABLED?: string; ADVISOR_DISABLED?: string };
  return truthy(e.ADVISOR_V2_DISABLED) || truthy(e.ADVISOR_DISABLED);
}
