/** Types for `securityContract.js` (D4708), so the Worker's typecheck can import it. */
export type Absent = { available: false; reason: string };
export function absent(reason: string): Absent;
export function isUnavailable(part: unknown): boolean;

export const USER_SESSION_STATUSES: readonly ['active', 'expired', 'revoked', 'signed_out', 'unknown'];
export type UserSessionStatus = (typeof USER_SESSION_STATUSES)[number];
export const SUPPORT_SESSION_STATUSES: readonly ['live', 'not_closed', 'ended', 'unknown'];
export type SupportSessionStatus = (typeof SUPPORT_SESSION_STATUSES)[number];

export const FEED_OUTCOMES: readonly ['ok', 'refused', 'live', 'ended', 'not_closed'];
export type FeedOutcome = (typeof FEED_OUTCOMES)[number];

export const SESSION_REVOKE_OUTCOMES: readonly ['revoked', 'already_revoked', 'not_found'];
export type SessionRevokeOutcome = (typeof SESSION_REVOKE_OUTCOMES)[number];
export const DEPLOYMENT_OUTCOMES: readonly ['done', 'failed', 'unreachable', 'not_reached', 'unknown'];
export type DeploymentOutcomeWord = (typeof DEPLOYMENT_OUTCOMES)[number];
export const ACT_OUTCOMES: readonly ['done', 'partial', 'failed'];
export type ActOutcome = (typeof ACT_OUTCOMES)[number];
export const DSR_CLOSE_STATUSES: readonly ['closed', 'stale', 'not_open', 'key_conflict', 'unconfirmed'];
export type DsrCloseStatus = (typeof DSR_CLOSE_STATUSES)[number];

export const MUTATION_RESULTS: readonly [
  'done', 'partial', 'already_revoked', 'not_found', 'expired', 'refused', 'failed', 'unknown',
  'unconfirmed', 'changed', 'stale',
];
export type MutationResult = (typeof MUTATION_RESULTS)[number];
