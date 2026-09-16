/**
 * One table saying which thrown sentence is which HTTP status.
 *
 * WHY IT MOVED OUT OF `index.ts` (D110). There were two places deciding this
 * and they disagreed. `app.onError` read this map; `routes/_t13t14t15_helpers.
 * ts`'s `mapError` — which 31 route files call inside their own `try/catch`,
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
