/**
 * D4708 (#4708) — the HQ Security desk's shared contract: availability, session state and mutation results.
 *
 * One plain module that both sides import, the way `money.js` is shared (D5029): the Worker's
 * `services/adminSecurity/*` and `routes/admin_security.ts` import it by relative path, and the Security
 * page's models under `pages/hq/security/` import it as any other `lib/` file. `securityContract.d.ts`
 * types it for the Worker's typecheck. Pure data and two helpers; no imports, no I/O.
 *
 *   absent(reason)            `{ available: false, reason }`, the one shape a part that could not be read takes
 *   isUnavailable(part)       whether a part says it could not be read (`available === false`); null is not that
 *   USER_SESSION_STATUSES     an account session's status words (services/sessionStatus.ts)
 *   SUPPORT_SESSION_STATUSES  a support session's status words (services/sessionStatus.ts)
 *   FEED_OUTCOMES             the ledger's outcome filter values (`/governance?outcome=`)
 *   SESSION_REVOKE_OUTCOMES   one session revoke's per-row outcome (`/sessions/revoke` `results[].outcome`)
 *   DEPLOYMENT_OUTCOMES       one deployment's answer to an emergency act (`outcomes[].outcome`)
 *   ACT_OUTCOMES              a multi-deployment act's overall outcome (`/branch-sign-out` `outcome`)
 *   DSR_CLOSE_STATUSES        what a data-subject close recorded (services/dsrRequests.ts `status`)
 *   MUTATION_RESULTS          the page's words for what a write answered (accessModel, privacyModel, trustModel)
 *
 * The lists are the values already on the wire; this file names them once. Where a Worker service still
 * declares its own copy (sessionStatus.ts, emergencyScope.ts, dsrRequests.ts), a test pins the two equal
 * (`cloudflare-worker/test/admin_security_contract_d4708.test.ts`).
 */

/** A part of a reply that could not be read, with the sentence the page shows. Never a zero or an empty list. */
export const absent = (reason) => ({ available: false, reason });

/** True only when the part says it could not be read. A missing part is not an unreadable one. */
export const isUnavailable = (part) => part != null && part.available === false;

export const USER_SESSION_STATUSES = Object.freeze(['active', 'expired', 'revoked', 'signed_out', 'unknown']);
export const SUPPORT_SESSION_STATUSES = Object.freeze(['live', 'not_closed', 'ended', 'unknown']);

export const FEED_OUTCOMES = Object.freeze(['ok', 'refused', 'live', 'ended', 'not_closed']);

export const SESSION_REVOKE_OUTCOMES = Object.freeze(['revoked', 'already_revoked', 'not_found']);
export const DEPLOYMENT_OUTCOMES = Object.freeze(['done', 'failed', 'unreachable', 'not_reached', 'unknown']);
export const ACT_OUTCOMES = Object.freeze(['done', 'partial', 'failed']);
export const DSR_CLOSE_STATUSES = Object.freeze(['closed', 'stale', 'not_open', 'key_conflict', 'unconfirmed', 'erasure_failed']);

export const MUTATION_RESULTS = Object.freeze([
  'done', 'partial', 'already_revoked', 'not_found', 'expired', 'refused', 'failed', 'unknown',
  'unconfirmed', 'changed', 'stale',
]);
