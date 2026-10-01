/**
 * Eadwyn's kill switch — one predicate for every door (D203).
 *
 * Originally (Task #5) this module orchestrated a three-phase staged
 * rollout (admin/allowlist + deterministic-hash percentage gate +
 * "new signups after" cutoff). Phase 3 has stuck at 100%, so the
 * staged-rollout machinery has been removed (Task #7).
 *
 * What remains is one kill, with TWO HALVES, consulted by every
 * /api/advisor/* route:
 *
 *   deploy     `ADVISOR_V2_DISABLED` or `ADVISOR_DISABLED` truthy. Logical
 *              OR — a stale `ADVISOR_V2_DISABLED=0` must never silently
 *              override an operator's emergency `ADVISOR_DISABLED=1`.
 *   operator   the `eadwyn_off` row in `platform_switches` (migration 283),
 *              thrown and released from HQ · Platform → Switches without a
 *              deploy (services/operatorSwitches.ts).
 *
 * Eadwyn is off when EITHER half is on. The operator half can release only
 * its own kill: while the deploy half is on, nothing an operator does turns
 * Eadwyn back on.
 *
 * ONE PREDICATE, advisorKillState. The routes refuse through it, the
 * per-user gate in guardrails.ts refuses through it, and HQ Platform reports
 * the switch through it, so the console cannot show Eadwyn on while every
 * request is refused, or the reverse. `isAdvisorDisabled` stays exported as
 * the deploy half alone and is not a gate by itself any more.
 *
 * The per-user `users.advisor_locked` lock is a separate concern and
 * still lives in `guardrails.ts::checkKillSwitch`.
 */
import type { Env } from '../../types';
import { readOperatorSwitches, type OperatorSwitchRead } from '../operatorSwitches';

/**
 * What a refused request is told. True for both halves — a deploy and an
 * operator's kill alike — and in Eadwyn's own voice. It used to call Eadwyn
 * "the Personal Advisor" and say an update was being shipped, which an
 * operator's kill is not.
 */
export const ADVISOR_DISABLED_MESSAGE =
  'Eadwyn is unavailable right now. Please try again later.';

const truthy = (v: string | undefined): boolean => v === '1' || v === 'true';

/**
 * The deploy half: true when an operator has disabled Eadwyn through either
 * Worker variable. Pure — no D1 / KV / fetch — which is why advisorKillState
 * asks it first.
 */
export function isAdvisorDisabled(env: Env): boolean {
  const e = env as unknown as { ADVISOR_V2_DISABLED?: string; ADVISOR_DISABLED?: string };
  return truthy(e.ADVISOR_V2_DISABLED) || truthy(e.ADVISOR_DISABLED);
}

export interface AdvisorKillState {
  /** What the gate does: true refuses every Eadwyn request. */
  off: boolean;
  /** What holds it off. `deploy` wins when both do — only a deployment lifts that one. */
  by: 'deploy' | 'operator' | null;
  /** The deploy half, as isAdvisorDisabled reads it. */
  deploy: boolean;
  /**
   * The operator half as read, or null when the deploy half decided and the
   * store was never asked.
   */
  operator: OperatorSwitchRead | null;
}

/**
 * Is Eadwyn switched off, and by what.
 *
 * DEPLOY FIRST, AND NOTHING ELSE WHEN IT IS ON. The variables are read with no
 * database at all, so the break-glass still works when D1 does not — which is
 * the case it exists for. Only then is the operator store asked, through its
 * thirty-second reading.
 *
 * AN UNREADABLE STORE FAILS OPEN: Eadwyn keeps answering. Failing closed would
 * let a D1 blip switch Eadwyn off for every user with nobody having decided
 * to. A store that has been read once keeps its last good reading through a
 * failure, so a kill that was thrown stays thrown.
 *
 * `inspect` is the console's mode and nobody else's: it reads the store even
 * when the deploy half already decided, and reads it now rather than from the
 * isolate's reading, so an operator sees both halves as stored. The verdict it
 * returns is computed exactly as the gate computes it.
 */
export async function advisorKillState(
  env: Env,
  opts: { now?: number; inspect?: boolean } = {},
): Promise<AdvisorKillState> {
  const deploy = isAdvisorDisabled(env);
  if (deploy && !opts.inspect) return { off: true, by: 'deploy', deploy, operator: null };

  const operator = await readOperatorSwitches(env, { now: opts.now, fresh: opts.inspect });
  const thrown = operator.readable && operator.rows.get('eadwyn_off')?.thrown === true;
  return {
    off: deploy || thrown,
    by: deploy ? 'deploy' : thrown ? 'operator' : null,
    deploy,
    operator,
  };
}
