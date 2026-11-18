/** Manual repair is admitted by a verified queue ejection; GitHub's check carries the request. */
import {
  authorizeConflictClick, conflictCheckUpdate, CONFLICT_CHECK_NAME, FIX_CONFLICTS_ACTION, previewConflictCheck,
} from './lib/manualConflictCheck.ts';
import type { CheckAuthority, ConflictTarget, LiveQueuePull, PublishedConflictCheck, SignedQueueEjection } from './lib/manualConflictCheck.ts';

import type { GithubApi } from './types.ts';

export interface ConflictEjection extends SignedQueueEjection {
  installationId: number;
  reason: string;
}
export interface ConflictRequest {
  key: string;
  target: ConflictTarget;
  installationId: number;
  checkRunId: number;
  actorId: number;
}
export interface ConflictActionServices {
  api: GithubApi;
  /** Query GitHub for the current base/head and latest queue transition, including additions. */
  loadPull(pr: number): Promise<LiveQueuePull>;
  state: {
    /** Serialize per key. On an ambiguous POST or storage failure, reconcile by App, external_id
     * and check SHA before creating again. A redelivery must preserve a consumed check. */
    publishOnce(key: string, target: ConflictTarget, create: () => Promise<number>): Promise<PublishedConflictCheck>;
    lookup(checkRunId: number): Promise<PublishedConflictCheck | null>;
    /** One transaction reserves the key and writes the guarded-workflow outbox entry.
     * The consumer must revalidate its pins before spending and pushing. */
    requestOnce(request: ConflictRequest): Promise<'recorded' | 'duplicate'>;
  };
}

const fullSha = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The caller has verified the webhook signature and correlated its dequeue to this timeline event. */
export async function handleConflictEjection(
  authority: CheckAuthority, event: ConflictEjection, deps: ConflictActionServices,
): Promise<'published' | 'ignored'> {
  if (event.reason !== 'MERGE_CONFLICT' || event.baseRef !== 'main' || event.headRepositoryId !== authority.repositoryId ||
      event.repositoryId !== authority.repositoryId ||
      event.installationId !== authority.installationId || !positive(event.pr) || !fullSha(event.headSha) ||
      !fullSha(event.baseSha)) return 'ignored';

  const pull = await deps.loadPull(event.pr);
  const preview = previewConflictCheck(authority, { ...pull, signedEjection: event });
  if (!preview || preview.target.pr !== event.pr || preview.target.removalId !== event.removalId ||
      preview.target.headSha !== event.headSha || pull.baseSha !== event.baseSha) return 'ignored';

  await deps.state.publishOnce(preview.create.external_id, preview.target, async () => {
    const created = obj(await deps.api('POST', 'check-runs', preview.create));
    if (!positive(created.id) || obj(created.app).id !== authority.appId ||
        created.head_sha !== event.headSha || created.external_id !== preview.create.external_id) {
      throw new Error('GitHub returned an unverified conflict check');
    }
    return created.id;
  });
  return 'published';
}

/** Call after verifying the signature over the exact webhook bytes. Errors propagate for retry. */
export async function handleConflictCheckClick(
  authority: CheckAuthority, eventName: string, verifiedPayload: unknown, deps: ConflictActionServices,
): Promise<'ignored' | 'recorded' | 'duplicate'> {
  const body = obj(verifiedPayload), check = obj(body.check_run), sender = obj(body.sender);
  const repository = obj(body.repository);
  if (eventName !== 'check_run' || body.action !== 'requested_action' ||
      obj(body.requested_action).identifier !== FIX_CONFLICTS_ACTION || check.name !== CONFLICT_CHECK_NAME ||
      repository.id !== authority.repositoryId || repository.full_name !== authority.repository ||
      obj(body.installation).id !== authority.installationId || obj(check.app).id !== authority.appId ||
      sender.type !== 'User' || !positive(sender.id) || !positive(check.id) ||
      typeof sender.login !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(sender.login)) return 'ignored';

  const published = await deps.state.lookup(check.id);
  if (!published || published.checkRunId !== check.id || published.target.repositoryId !== authority.repositoryId ||
      !fullSha(published.target.expectedBaseSha)) return 'ignored';
  const live = await deps.loadPull(published.target.pr);
  if (live.baseSha !== published.target.expectedBaseSha || live.headSha !== published.target.headSha) return 'ignored';

  let permission;
  try {
    permission = obj(await deps.api('GET', 'collaborators/' + sender.login + '/permission'));
  } catch (err) {
    if (obj(err).status === 404) return 'ignored';
    throw err;
  }
  const user = obj(permission.user);
  if (typeof permission.permission !== 'string' || !positive(user.id)) return 'ignored';
  const authorized = authorizeConflictClick(eventName, body, authority, published, live, {
    repositoryId: authority.repositoryId, userId: user.id, permission: permission.permission,
  });
  if (!authorized) return 'ignored';
  const outcome = await deps.state.requestOnce({
    key: authorized.key, target: published.target, installationId: authority.installationId,
    checkRunId: published.checkRunId, actorId: sender.id,
  });
  // A repeated click also repairs the presentation if the original PATCH failed after requestOnce committed.
  await deps.api('PATCH', 'check-runs/' + published.checkRunId, conflictCheckUpdate(published.target, 'requested'));
  return outcome;
}
