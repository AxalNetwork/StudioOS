/** GitHub Checks adapter for a confirmed queue conflict. Holds no credentials and makes no writes. */
export const CONFLICT_CHECK_NAME = 'Merge queue conflict';
export const FIX_CONFLICTS_ACTION = 'fix_queue_conflict';

export interface CheckAuthority {
  repository: string;
  repositoryId: number;
  installationId: number;
  appId: number;
}

/** Supplied by trusted ingress only, after validating the signed ejection delivery
 * and correlating it to exactly one GitHub removal event. A webhook head/base pair
 * from a different entry, or a timeline entry alone, cannot establish this snapshot. */
export interface SignedQueueEjection {
  repositoryId: number;
  headRepositoryId: number;
  pr: number;
  headSha: string;
  baseRef: string;
  baseSha: string;
  removalId: string;
}

/** Read from GitHub at publication and again on click. Fetch the latest queue transition,
 * including additions, rather than searching backwards for the last matching removal. */
export interface LiveQueuePull {
  repositoryId: number;
  headRepositoryId: number | null;
  pr: number;
  headSha: string;
  baseRef: string;
  baseSha: string;
  state: string;
  draft: boolean;
  inMergeQueue: boolean;
  mergeable: string;
  latestQueueEvent: {
    type: string;
    id: string;
    reason: string | null;
    beforeSha?: string | null;
  } | null;
  signedEjection: SignedQueueEjection | null;
}

export interface ConflictTarget {
  repositoryId: number;
  pr: number;
  headSha: string;
  expectedBaseSha: string;
  removalId: string;
}

/** Store the check-run ID returned by GitHub against the target used to create it. */
export interface PublishedConflictCheck {
  checkRunId: number;
  target: ConflictTarget;
}

/** Obtain effective access from the repository collaborator permission API for this sender. */
export interface ActorAccess {
  repositoryId: number;
  userId: number;
  permission: string;
}

const positiveId = (n: number) => Number.isSafeInteger(n) && n > 0;

function currentTarget(authority: CheckAuthority, pull: LiveQueuePull): ConflictTarget | null {
  const removal = pull.latestQueueEvent;
  const snapshot = pull.signedEjection;
  if (authority.repository !== 'AxalNetwork/StudioOS' || !positiveId(authority.repositoryId) ||
      !positiveId(authority.appId) || !positiveId(authority.installationId) ||
      !positiveId(pull.pr) || pull.repositoryId !== authority.repositoryId ||
      pull.headRepositoryId !== authority.repositoryId || pull.baseRef !== 'main' ||
      pull.state !== 'OPEN' || pull.draft !== false || pull.inMergeQueue !== false ||
      pull.mergeable !== 'CONFLICTING' || !/^[0-9a-f]{40}$/.test(pull.headSha) || !/^[0-9a-f]{40}$/.test(pull.baseSha) ||
      removal?.type !== 'RemovedFromMergeQueueEvent' || removal.reason !== 'MERGE_CONFLICT' ||
      typeof removal.id !== 'string' ||
      !/^[A-Za-z0-9_+/=-]{1,128}$/.test(removal.id)) return null;
  // GraphQL's beforeCommit belongs to the removal event. It does not attest the PR head.
  if (!snapshot || snapshot.removalId !== removal.id || snapshot.repositoryId !== pull.repositoryId ||
      snapshot.headRepositoryId !== pull.headRepositoryId || snapshot.pr !== pull.pr ||
      snapshot.headSha !== pull.headSha || snapshot.baseRef !== pull.baseRef || snapshot.baseSha !== pull.baseSha) return null;
  return {
    repositoryId: pull.repositoryId, pr: pull.pr, headSha: pull.headSha, expectedBaseSha: pull.baseSha, removalId: removal.id,
  };
}

function targetKey(target: ConflictTarget): string {
  return `queue-conflict:${target.repositoryId}:${target.pr}:${target.headSha}:${target.expectedBaseSha}:${target.removalId}`;
}

export function conflictCheckUpdate(target: ConflictTarget, state: 'available' | 'requested' | 'expired') {
  const summary = {
    available: 'GitHub removed this PR from the merge queue for a conflict on this head. Request a repair on the PR branch.',
    requested: 'A repair request has been recorded for this queue conflict. Review the resulting PR changes before re-entering the queue.',
    expired: 'This check no longer offers repair for this queue conflict.',
  };
  return {
    name: CONFLICT_CHECK_NAME,
    external_id: targetKey(target),
    status: 'completed' as const,
    conclusion: 'neutral' as const,
    output: { title: `Queue conflict repair for PR #${target.pr}`, summary: summary[state] },
    actions: state === 'available'
      ? [{ label: 'Fix conflicts', description: 'Request repair for this queue conflict', identifier: FIX_CONFLICTS_ACTION }]
      : [],
  };
}

/** POST /repos/{owner}/{repo}/check-runs. GitHub's PATCH operation omits head_sha. */
export function previewConflictCheck(authority: CheckAuthority, livePull: LiveQueuePull) {
  const target = currentTarget(authority, livePull);
  if (!target) return null;
  return { target, create: { head_sha: target.headSha, ...conflictCheckUpdate(target, 'available') } };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Call only after verifying the original webhook bytes. An empty webhook pull_requests array
 * is valid; the saved installation check ID and target bind the action to exactly one PR.
 * Atomically reserve the returned key before dispatch. Recheck the head and removal at execution. */
export function authorizeConflictClick(
  eventName: string, payload: unknown, authority: CheckAuthority, published: PublishedConflictCheck,
  livePull: LiveQueuePull, actorAccess: ActorAccess,
) {
  const body = record(payload);
  const check = record(body.check_run);
  const repo = record(body.repository);
  const sender = record(body.sender);
  const target = currentTarget(authority, livePull);
  if (!target || eventName !== 'check_run' || body.action !== 'requested_action' ||
      record(body.requested_action).identifier !== FIX_CONFLICTS_ACTION ||
      repo.full_name !== authority.repository || repo.id !== authority.repositoryId ||
      record(body.installation).id !== authority.installationId || record(check.app).id !== authority.appId ||
      !positiveId(published.checkRunId) || check.id !== published.checkRunId || check.name !== CONFLICT_CHECK_NAME ||
      check.status !== 'completed' || check.conclusion !== 'neutral' || check.head_sha !== target.headSha ||
      sender.type !== 'User' || !positiveId(actorAccess.userId) || sender.id !== actorAccess.userId ||
      actorAccess.repositoryId !== authority.repositoryId || !['admin','maintain','write'].includes(actorAccess.permission))
    return null;
  const key = targetKey(target);
  if (check.external_id !== key || targetKey(published.target) !== key) return null;
  return { ...target, key };
}
