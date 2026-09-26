/**
 * One table saying which thrown sentence is which HTTP status.
 *
 * WHY IT MOVED OUT OF `index.ts` (D110). There were two places deciding this
 * and they disagreed. `app.onError` read this map; `routes/_t13t14t15_helpers.
 * ts`'s `mapError` — which every route file that calls it reaches inside its own `try/catch`,
 * so the app-level handler never sees their throws — had its own ternary that
 * knew `Unauthorized`, `Forbidden`, `Admin required` and `KYC required`, and
 * did not know `Super admin required`. The whole HQ licence ledger therefore
 * answered **400 Bad Request** to a permission refusal, while this map said
 * 403, and the SPA cannot tell a refusal from a malformed request at 400.
 *
 * That is the same failure the `Super admin required` comment below records,
 * reached from the other side: not a message and a key drifting apart, but two
 * tables of keys. There is one now, and both readers import it.
 *
 * A MESSAGE NOT IN THIS TABLE IS NOT A REFUSAL. `mapError` still answers 400
 * for everything else, and `app.onError` still answers 500 — an unmapped
 * message is a bug or a validation failure, and neither should be dressed as
 * an authorisation decision.
 */
import { BRANCH_ONLY, BRANCH_SUSPENDED, HQ_AUTHORING_ONLY, HQ_ONLY } from './branch';

/** The sentence `requireStepUp` throws. A constant so the two readers below
 *  cannot drift from it the way a typed-in copy would. */
export const STEP_UP_REQUIRED = 'step_up_required';

/**
 * D135 — the sentence `requireAdmin` throws when this admin's licence is frozen
 * by the compliance ladder. 423, not 403, for the reason D107 gives about its
 * branch-side twin: a frozen admin MAY take this decision, and HQ has stopped
 * them from taking it today. The shell renders the two differently, so the
 * status has to tell them apart.
 */
export const ADMIN_FROZEN = 'admin_frozen';

/**
 * D142 — the MACHINE-READABLE half of `BRANCH_SUSPENDED`, and the reason it is
 * a second constant rather than the thrown sentence itself.
 *
 * `ADMIN_FROZEN` above gets to be both, because the sentence it throws is
 * already a slug. `BRANCH_SUSPENDED` (`util/branch.ts`) is a sentence written
 * for a person — *"Branch suspended by HQ"* — and shipping that as `code` would
 * make every client key on prose that anyone is entitled to reword. So the
 * throw keeps its sentence and the body carries this.
 *
 * WHY IT DID NOT EXIST UNTIL NOW, WHICH IS THE DEFECT. D107 gave the branch
 * gate its 423 through `AUTH_ERROR_STATUSES` alone, so a frozen branch's write
 * shipped as `423 {detail}` and **nothing else** — while `api.js` keys strictly
 * on `code === 'admin_frozen'`. The branch 423 therefore fell through to
 * whatever generic error the page happened to print, and three places in the
 * repo said the frozen-branch banner had shipped. It had not, and it could not
 * have: there was nothing on the wire to key it on.
 */
export const BRANCH_SUSPENDED_CODE = 'branch_suspended';

/**
 * Which `admin_notices.status` values hold an account frozen, and therefore
 * which ones a licence's reinstatement has to be clear of (D135).
 *
 * ONE DEFINITION, THREE READERS — `requireAdmin`'s gate, the sweep that sets
 * the first of them, and HQ's review, which lifts the freeze only when none is
 * left. Two copies of this list is how an account comes to be refused by a gate
 * that reads one set while the screen that would explain it reads another.
 *
 * `issued` IS NOT HERE, ON PURPOSE. A notice inside its response window has
 * been delivered and the deadline has not passed: that is the rung BEFORE the
 * freeze, and freezing on it would collapse the ladder's first two steps into
 * one — the opposite of "first admins get notified".
 */
// A FIXED-LENGTH TUPLE, not an array, and that is load-bearing. Every reader
// writes its own `IN (?, ?)` literally, because `check-sql-prepare` refuses any
// `${…}` inside a prepared statement — including a placeholder generator — and
// a guard with a baseline entry for "this one is fine" is a guard people learn
// to baseline (`admin_super_admins.ts` makes the same call for the same
// reason). Typing the length means adding a third status is a COMPILE error at
// every binding site rather than a silent under-bind, and a test counts the
// placeholders against it so the two cannot drift.
export const FREEZING_STATUSES: readonly ['overdue', 'rejected'] = ['overdue', 'rejected'];

export const AUTH_ERROR_STATUSES: Record<string, 401 | 403 | 423> = {
  Unauthorized: 401,
  'Admin required': 403,
  // Migration 199. Without an entry here the throw falls through to the
  // generic 500, so a subsidiary admin trying to franchise would see a
  // server error instead of a refusal — the gate would work and say nothing.
  'Super admin required': 403,
  // D106 — branch mode's two refusals, keyed off the constants they are
  // thrown from (util/branch.ts) rather than off a second copy of the
  // sentence. The failure the entry above records is a message and a map key
  // drifting apart; a shared constant is the shape where they cannot.
  [HQ_ONLY]: 403,
  [HQ_AUTHORING_ONLY]: 403,
  // D112 — the mirror of HQ_ONLY, for a surface that is a branch's own. Added
  // because the escalation lane's first version threw its own wording and
  // `mapError` answered 400: the test caught it, which is the whole reason
  // this table has one home.
  [BRANCH_ONLY]: 403,
  // D107 — 423 Locked, and the only entry in this map that is not 401/403.
  // A frozen queue is not a permission failure: the branch admin may take
  // this decision, and HQ has stopped them from taking it today. The shell
  // renders the two differently, so the status has to tell them apart.
  [BRANCH_SUSPENDED]: 423,
  Forbidden: 403,
  'KYC required': 403,
  'TOTP required': 403,
  // D135 — the HQ half of `BRANCH_SUSPENDED` above, and the same 423 for the
  // same reason. The two are twins, not two mechanisms: one asks whether this
  // DEPLOYMENT may act, the other whether this ADMIN may.
  [ADMIN_FROZEN]: 423,
  // D134 — `step_up_required` was in this table nowhere and in `app.onError`
  // as a special case above the lookup, so the two readers disagreed exactly
  // as they did over `Super admin required` before D110 moved the table here.
  // The consequence was live the moment a route that catches its own throws
  // sat behind a step-up: `mapError` fell through to its 400 default, and the
  // SPA cannot tell a refusal from a malformed request at 400 — least of all
  // one whose remedy is "type a fresh TOTP code and try again".
  [STEP_UP_REQUIRED]: 403,
};

/**
 * The step-up refusal's BODY, shaped once, because the status alone is not the
 * whole answer here: the SPA prompts for a fresh TOTP off `code`, calls
 * `POST /api/auth/step-up`, and retries — so a 403 without the code is a dead
 * end wearing the right number. `app.onError` built this object inline and
 * `mapError` could not, which is why it is a function rather than a second
 * entry in the table above.
 *
 * The TTL comes off the thrown error (`requireStepUp` attaches `ttlMinutes`),
 * falling back to the default so a caller that rethrows a bare Error still
 * gets a usable number rather than `undefined`.
 */
/**
 * D135 — the frozen refusal's body. Same argument as `stepUpRefusalBody` below:
 * a 423 that does not say WHICH notice froze the account is a dead end, and the
 * one thing the holder needs is the route back. The notice rides on the thrown
 * error (`requireAdmin` attaches `notice`), because the gate has the row in hand
 * already — it is what the lookup selected.
 *
 * A FROZEN ADMIN CAN ALWAYS READ THIS AND ALWAYS REPLY. The gate refuses non-GET
 * only, and the response route is `requireAuth` + ownership rather than an admin
 * route, so the freeze structurally cannot lock the addressee out of answering
 * the thing they were asked. That is why the ladder needs no exception list —
 * the thing that rots.
 */
export function adminFrozenBody(err: unknown): {
  detail: string; code: string; notice: unknown;
} {
  const notice = (err as { notice?: unknown } | null)?.notice ?? null;
  return {
    detail: 'This account is frozen until an outstanding compliance notice is answered.',
    code: ADMIN_FROZEN,
    notice,
  };
}

/**
 * D142 — the branch freeze's body, the twin of `adminFrozenBody` above, and
 * shaped by the same argument: a 423 that does not say WHY or SINCE WHEN is the
 * right number and still a dead end.
 *
 * WHAT IT CARRIES AND WHY EACH IS THERE. `since` is the licence copy's
 * `suspended_at` and `reason` is its `suspended_note` — HQ's own words, pushed
 * with the licence (migration 256), not this worker's paraphrase of them. The
 * branch admin reading the refusal is being asked to act on a decision somebody
 * else made, so the sentence they act on has to be that person's.
 *
 * BOTH ARE NULLABLE, AND NULL IS NOT AN ERROR. `suspended_note` is optional on
 * the ledger and a copy pushed before HQ typed one carries none; rendering a
 * stated absence is the shell's job, and inventing a reason here to avoid it
 * would be the worst kind of helpful.
 *
 * THE WAY OUT IS NOT IN THIS BODY, deliberately. The appeal is an escalation
 * (`POST /api/branch/escalations`, kind `other`), that route is NOT
 * suspension-gated, and its own header says why: gating it would freeze the one
 * door out of the freeze. The shell links to it; the refusal does not need to.
 */
export function branchSuspendedBody(err: unknown): {
  detail: string; code: string; since: string | null; reason: string | null;
} {
  const e = err as { since?: unknown; reason?: unknown } | null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    detail: BRANCH_SUSPENDED,
    code: BRANCH_SUSPENDED_CODE,
    since: str(e?.since),
    reason: str(e?.reason),
  };
}

export function stepUpRefusalBody(err: unknown): {
  detail: string; code: string; ttl_minutes: number;
} {
  const ttl = Number((err as { ttlMinutes?: unknown } | null)?.ttlMinutes);
  return {
    detail: 'Recent re-authentication required',
    code: STEP_UP_REQUIRED,
    ttl_minutes: Number.isFinite(ttl) && ttl > 0 ? ttl : 15,
  };
}
