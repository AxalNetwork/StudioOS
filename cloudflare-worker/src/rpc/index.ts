/**
 * The two RPC entrypoints, as thin as they can be (D.7, D108).
 *
 * WHY THESE CLASSES CONTAIN NO LOGIC. `WorkerEntrypoint` comes from
 * `cloudflare:workers`, which exists only inside the Workers runtime, so this
 * file cannot be imported by a `node --test` process at all. Anything written
 * here would be verifiable only by deploying — for calls that cross the tier
 * boundary, the worst possible place to learn something is wrong. The
 * behaviour lives in `branchOps.ts` and `hqOps.ts`, which are plain modules
 * with real tests; each method below is a delegation and nothing else.
 *
 * WHICH CLASS LIVES WHERE, because the names read backwards until you see it:
 *   - `HqEntrypoint` is exported by a BRANCH and is what HQ calls. It is named
 *     for its caller.
 *   - `BranchEntrypoint` is exported by HQ and is what a branch calls.
 * Both are exported by every deploy, because there is one codebase; each
 * method refuses on the wrong tier (the `requireBranch`/`requireHq` checks in
 * the ops modules), so an entrypoint bound to the wrong script fails loudly
 * instead of answering with the other tier's data.
 *
 * A BINDING DOES NOT IDENTIFY ITS CALLER. That is why every method on
 * `BranchEntrypoint` takes the caller's code as an argument and validates it
 * against `licence_deployments`. See the header of `hqOps.ts` for what that
 * does and does not establish.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from '../types';
import {
  branchHealth, branchOverview, branchSearchAccounts, applyLicenceCopy,
} from './branchOps';
import { recordEscalation, licenceForBranch, type EscalationInput } from './hqOps';

/** Exported by a branch Worker; called by HQ over `BRANCH_<CODE>`. */
export class HqEntrypoint extends WorkerEntrypoint<Env> {
  health() { return branchHealth(this.env); }

  overview() { return branchOverview(this.env); }

  searchAccounts(q: string, limit?: number) { return branchSearchAccounts(this.env, q, limit); }

  applyLicence(record: Record<string, unknown>) { return applyLicenceCopy(this.env, record); }
}

/** Exported by HQ; called by a branch over its `HQ` binding. */
export class BranchEntrypoint extends WorkerEntrypoint<Env> {
  escalate(callerCode: string, item: EscalationInput) {
    return recordEscalation(this.env, callerCode, item);
  }

  licence(callerCode: string) { return licenceForBranch(this.env, callerCode); }
}
