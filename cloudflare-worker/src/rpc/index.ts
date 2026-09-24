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
  branchRevenueSummary, applyPromoCeiling, applyEscalationAnswer, applyTemplateCopy,
  applyBenchmarks, openSupportSession,
  moveAccountOut, inviteAccount,
  type SupportSessionRequest, type MoveOutRequest, type InviteRequest,
} from './branchOps';
import {
  recordEscalation, licenceForBranch, reportUsage, promoCeilingForBranch,
  type EscalationInput, type UsageFigure, type EscalationAnswer,
} from './hqOps';

/** Exported by a branch Worker; called by HQ over `BRANCH_<CODE>`. */
export class HqEntrypoint extends WorkerEntrypoint<Env> {
  health() { return branchHealth(this.env); }

  overview() { return branchOverview(this.env); }

  searchAccounts(q: string, limit?: number) { return branchSearchAccounts(this.env, q, limit); }

  applyLicence(record: Record<string, unknown>) { return applyLicenceCopy(this.env, record); }

  revenueSummary(period: string) { return branchRevenueSummary(this.env, period); }

  applyPromoCeiling(c: { period: string; ceiling_cents: number; currency: string; pushed_at: string }) {
    return applyPromoCeiling(this.env, c);
  }

  applyEscalationAnswer(a: EscalationAnswer) { return applyEscalationAnswer(this.env, a); }

  // D147 — HQ's master contract library, pushed whole. THE WHOLE LIBRARY AND
  // NOT ONE TEMPLATE, because a library is a set: a per-template push can add
  // and update but can never say "this one is gone", so a template HQ withdrew
  // would stay offerable on every branch forever. F.5 named this
  // `publishTemplate` and the name is kept; what travels is the set.
  //
  // No secret, for the reason the class header gives: this is an HQ-authored
  // push, where "callable by any Worker in the account" costs at most a stale
  // copy of documents HQ wrote.
  publishTemplate(p: { templates: Array<Record<string, unknown>>; pushed_at: string }) {
    return applyTemplateCopy(this.env, p);
  }

  // D148 — the anonymised platform median. Same category as the two pushes
  // above: HQ-authored, no secret. What travels is a SET of metrics, so a
  // metric HQ withheld below its k-threshold disappears from the branch rather
  // than lingering at its last value.
  applyBenchmarks(p: { rows: Array<Record<string, unknown>>; period: string; pushed_at: string }) {
    return applyBenchmarks(this.env, p);
  }

  // THE ONE METHOD ON THIS CLASS THAT TAKES A SECRET, and the header above says
  // why that is not an inconsistency: everything else here is a read or an
  // HQ-authored push, where "callable by any Worker in the account" costs at
  // most a stale licence copy. This one opens a session as an arbitrary user,
  // so it authenticates its caller (`authenticateHq`) instead of assuming it.
  // The secret is first so a call that forgets it cannot be a call that happens
  // to pass a target id into the secret's place.
  openSupportSession(secret: string, req: SupportSessionRequest) {
    return openSupportSession(this.env, secret, req);
  }

  // D.6 (D121) — the two halves of a cross-branch move. Both take the secret
  // for the same reason `openSupportSession` does: one closes an account and
  // the other creates an invitation to one, so neither can rely on "the
  // account is ours" the way a read or a licence push can.
  moveAccountOut(secret: string, req: MoveOutRequest) {
    return moveAccountOut(this.env, secret, req);
  }

  inviteAccount(secret: string, req: InviteRequest) {
    return inviteAccount(this.env, secret, req);
  }
}

/** Exported by HQ; called by a branch over its `HQ` binding. */
export class BranchEntrypoint extends WorkerEntrypoint<Env> {
  escalate(callerCode: string, item: EscalationInput) {
    return recordEscalation(this.env, callerCode, item);
  }

  // MONEY-ADJACENT SINCE D244: the answer is a licence's fees, revenue share
  // and signatory, so the call carries the branch's own secret as well as its
  // code, verified by `authenticateBranch` before anything is read. The
  // branch's caller is `pullLicenceCopy` in routes/licence.ts.
  licence(callerCode: string, secret: string) {
    return licenceForBranch(this.env, callerCode, secret);
  }

  // MONEY-ADJACENT, so it carries the branch's own secret as well as its
  // code (D.7). See `authenticateBranch` in hqOps.ts for why a code alone is
  // attribution and not authentication.
  reportUsage(callerCode: string, secret: string, period: string, figures: UsageFigure[]) {
    return reportUsage(this.env, callerCode, secret, period, figures);
  }

  promoCeiling(callerCode: string) { return promoCeilingForBranch(this.env, callerCode); }
}
