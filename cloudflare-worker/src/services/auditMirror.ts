/**
 * D163 — HQ's own branch-targeting acts, in a store that is not the branch.
 *
 * THE DEFECT THIS CLOSES. Every HQ→branch push reports whether it LANDED as
 * its own field and never throws — the D111 rule `licencePush.ts:13-19` states
 * outright, and it is right. But that report is per-call and ephemeral: it
 * reaches the operator who made the call, in that one response, and NOTHING
 * KEEPS IT. HQ's D1 records the transition; it does not record that the branch
 * refused the copy, or that no Worker answered. So the question an outage
 * post-mortem actually asks — which branch was unreachable, and which of HQ's
 * own acts against it failed while it was — has no store to answer it.
 *
 * WHY ANALYTICS ENGINE, AND WHY THE WRITE IS HERE RATHER THAN IN THE RPC
 * HANDLER. `HqEntrypoint` is the class HQ calls, and it is EXPORTED BY THE
 * BRANCH — it runs on the branch's own `env` (`rpc/index.ts:41`). A data point
 * written inside those handlers is therefore lost in exactly the case this
 * exists to survive. The write belongs at HQ's call site, in HQ's isolate,
 * recording what HQ OBSERVED rather than what the branch managed to say. AE is
 * the one store that satisfies both halves: every deployment already writes to
 * it (D105's shared dataset, D161's branch dimension), and it does not live on
 * the branch whose silence is the thing being recorded.
 *
 * WHAT IS DELIBERATELY NOT WRITTEN, and it is most of what you might expect.
 * No actor id, no email, no free-text reason or note. HQ's own D1 already holds
 * the actor authoritatively (`admin_audit_log.admin_user_id`,
 * `licence_events.actor_user_id`) and is always readable, because it is HQ's
 * own database — the mirror is not a second copy of the audit trail and must
 * not become one. It exists for the one dimension D1 cannot give: which branch,
 * and whether it answered. Identity in a shared analytics store would add
 * exposure and no information. `logAdminAction` hashes the actor email before
 * it reaches even `activity_logs` (`adminAudit.ts:96`); this carries none at
 * all.
 *
 * A LICENCE WITH NO DEPLOYMENT IS NOT MIRRORED. It has no branch, so there is
 * no branch this act concerns, and a row with an empty branch would put a
 * non-branch in the per-branch grouping. That state is already recorded at HQ
 * as the push's own reason. `not_deployed` here means something narrower and
 * real: a deployment row exists and no Worker is bound to it.
 */
import type { Env } from '../types';
import { BRANCH_CODE_RE } from '../util/branch';

/**
 * What HQ observed when it reached for the branch.
 *
 * `failed` DELIBERATELY COLLAPSES "the branch refused" and "the branch did not
 * answer", because every call site collapses them too: `licencePush.ts:180-182`
 * catches both in one block, and so do the four others. Splitting them here
 * would be this file claiming a distinction its own inputs cannot make.
 */
export type MirrorOutcome = 'ok' | 'failed' | 'not_deployed';

/**
 * The sentinel in blob1.
 *
 * It is what the two existing AE readers filter on to keep these rows out of
 * their arithmetic (`analyticsReports.ts`, both queries, `WHERE blob1 LIKE
 * '/%'`). It can never collide with an HTTP path: `shouldMeter` only ever
 * meters a path starting `/api/` (`middleware/observability.ts:26`).
 */
export const MIRROR_KIND = 'hq:branch_action';

/**
 * Record one HQ act against one branch. Never throws, never awaits.
 *
 * `writeDataPoint` is fire-and-forget in the Workers runtime, so this costs the
 * request nothing and needs no `waitUntil`. The try/catch is
 * `observability.ts:131-134`'s, for its stated reason: AE writes can fail under
 * load (token bucket), and a recorded act must never be undone by its own
 * telemetry.
 */
export function mirrorBranchAction(
  env: Env,
  action: string,
  outcome: MirrorOutcome,
  code: string | null | undefined,
): void {
  // No branch, nothing to mirror — see the header. Also the one guard that
  // keeps a malformed code out of a query-text-only store: the AE SQL API
  // takes text/plain and has no binding mechanism, so every value a reader
  // interpolates has to be one that could never have carried a quote.
  if (!code || !BRANCH_CODE_RE.test(code)) return;

  try {
    const ae = env.ANALYTICS;
    if (!ae || typeof ae.writeDataPoint !== 'function') return;
    ae.writeDataPoint({
      // A constant index, so these rows form their own sampling bucket rather
      // than competing with per-request telemetry for one. Privileged acts are
      // rare, so there is little here to sample away.
      indexes: [MIRROR_KIND],
      // Blobs, in slot order. blob1 is the sentinel the readers exclude on;
      // blob6 is the branch, THE SAME SLOT the per-request row uses
      // (`observability.ts:126`) so a future reader learns one layout rather
      // than two. Slots 4 and 5 are empty on purpose — two empty strings are
      // cheaper than a second slot convention.
      blobs: [MIRROR_KIND, action, outcome, '', '', code],
    });
  } catch (e) {
    console.warn('[auditMirror] analytics engine write failed', action, (e as Error).message);
  }
}
