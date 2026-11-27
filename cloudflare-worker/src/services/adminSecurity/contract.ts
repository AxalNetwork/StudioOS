/**
 * D4708 (#4708) — the Worker's door to the Security desk's shared contract (`frontend/src/lib/securityContract.js`),
 * and the typecheck that holds the services which still spell their own words to it.
 *
 * The Security modules import availability (`absent`, `Absent`) and the ledger's outcome list from here, so
 * one relative path reaches the SPA's file. The `CONTRACT_HOLDS` tuple below only typechecks while each union a
 * service declares is exactly the contract's list: a word added on one side and not the other fails
 * `npm run test:types`, before any test runs.
 */
import type { SupportSessionStatus as ServiceSupportStatus, UserSessionStatus as ServiceUserStatus } from '../sessionStatus';
import type { RevokeOutcome } from '../userSessions';
import type { DeploymentOutcome, BranchSignOutResult } from '../emergencyScope';
import type { DsrCloseResult } from '../dsrRequests';
import type {
  SupportSessionStatus, UserSessionStatus, SessionRevokeOutcome, DeploymentOutcomeWord, ActOutcome, DsrCloseStatus,
} from '../../../../frontend/src/lib/securityContract.js';

export {
  absent, isUnavailable, FEED_OUTCOMES, USER_SESSION_STATUSES, SUPPORT_SESSION_STATUSES, SESSION_REVOKE_OUTCOMES,
  DEPLOYMENT_OUTCOMES, ACT_OUTCOMES, DSR_CLOSE_STATUSES, MUTATION_RESULTS,
} from '../../../../frontend/src/lib/securityContract.js';
export type { Absent, FeedOutcome } from '../../../../frontend/src/lib/securityContract.js';

/** `true` only when A and B are the same set of words. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const CONTRACT_HOLDS: [
  Same<ServiceUserStatus, UserSessionStatus>,
  Same<ServiceSupportStatus, SupportSessionStatus>,
  Same<RevokeOutcome['outcome'], SessionRevokeOutcome>,
  Same<DeploymentOutcome['outcome'], DeploymentOutcomeWord>,
  Same<BranchSignOutResult['outcome'], ActOutcome>,
  Same<DsrCloseResult['status'], DsrCloseStatus>,
] = [true, true, true, true, true, true];
