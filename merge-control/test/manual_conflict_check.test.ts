import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeConflictClick, CONFLICT_CHECK_NAME, conflictCheckUpdate, FIX_CONFLICTS_ACTION, previewConflictCheck,
  type ActorAccess, type LiveQueuePull,
} from '../src/lib/manualConflictCheck.ts';

const authority = { repository: 'AxalNetwork/StudioOS', repositoryId: 101, installationId: 22, appId: 33 };
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const removal = { type: 'RemovedFromMergeQueueEvent', id: 'RMQ_123', reason: 'MERGE_CONFLICT', beforeSha: 'd'.repeat(40) };
const signedEjection = { repositoryId: 101, headRepositoryId: 101, pr: 42, headSha, baseRef: 'main', baseSha, removalId: removal.id };
const pull: LiveQueuePull = {
  repositoryId: 101, headRepositoryId: 101, pr: 42, headSha, baseRef: 'main', baseSha, state: 'OPEN',
  draft: false, inMergeQueue: false, mergeable: 'CONFLICTING', latestQueueEvent: removal, signedEjection,
};
const access: ActorAccess = { repositoryId: 101, userId: 71, permission: 'write' };
const preview = previewConflictCheck(authority, pull)!;
const published = { checkRunId: 510, target: preview.target };
const body = {
  action: 'requested_action', requested_action: { identifier: FIX_CONFLICTS_ACTION },
  installation: { id: 22 }, repository: { id: 101, full_name: 'AxalNetwork/StudioOS' },
  sender: { id: 71, type: 'User' },
  check_run: { ...preview.create, id: 510, app: { id: 33 }, pull_requests: [] },
};

test('a completed advisory check offers repair only for a current conflict ejection', () => {
  assert.equal(preview.create.name, CONFLICT_CHECK_NAME);
  assert.equal(preview.create.head_sha, headSha);
  assert.equal(preview.create.conclusion, 'neutral');
  assert.equal(preview.create.status, 'completed');
  assert.deepEqual(preview.create.actions.map(a => a.label), ['Fix conflicts']);
  for (const state of ['requested', 'expired'] as const) {
    const update = conflictCheckUpdate(preview.target, state);
    assert.deepEqual(update.actions, []);
    assert.equal(update.external_id, preview.create.external_id);
    assert.ok(!('head_sha' in update));
  }
});

test('only the same open, unqueued, same-repository PR with matching current removal is eligible', () => {
  const changes: Partial<LiveQueuePull>[] = [
    { draft: true }, { state: 'CLOSED' }, { inMergeQueue: true }, { baseRef: 'staging' }, { headRepositoryId: 102 },
    { repositoryId: 102 }, { headRepositoryId: null }, { mergeable: 'UNKNOWN' }, { mergeable: 'MERGEABLE' },
    { latestQueueEvent: null }, { latestQueueEvent: { ...removal, type: 'AddedToMergeQueueEvent' } },
    { latestQueueEvent: { ...removal, reason: 'CI_TIMEOUT' } },
    { latestQueueEvent: { ...removal, reason: 'not a conflict' } }, { latestQueueEvent: { ...removal, id: '' } },
    { headSha: 'b'.repeat(40) }, { pr: 0 }, { baseSha: '1'.repeat(40) }, { signedEjection: null },
    { signedEjection: { ...signedEjection, repositoryId: 202 } }, { signedEjection: { ...signedEjection, headRepositoryId: 202 } },
    { signedEjection: { ...signedEjection, pr: 43 } }, { signedEjection: { ...signedEjection, removalId: 'RMQ_other' } },
    { signedEjection: { ...signedEjection, baseRef: 'staging' } },
  ];
  for (const change of changes) {
    const latest = { ...pull, ...change };
    assert.equal(previewConflictCheck(authority, latest), null, JSON.stringify(change));
    assert.equal(authorizeConflictClick('check_run', body, authority, published, latest, access), null);
  }
});

test('uses signed queue head and base even if the timeline beforeCommit differs or is unavailable', () => {
  assert.notEqual(removal.beforeSha, headSha);
  for (const beforeSha of [null, removal.beforeSha]) {
    const latest = { ...pull, latestQueueEvent: { ...removal, beforeSha } };
    assert.equal(previewConflictCheck(authority, latest)?.target.expectedBaseSha, baseSha);
    assert.equal(authorizeConflictClick('check_run', body, authority, published, latest, access)?.headSha, headSha);
  }
  const withoutSnapshot = { ...pull, latestQueueEvent: { ...removal, beforeSha: headSha }, signedEjection: null };
  assert.equal(previewConflictCheck(authority, withoutSnapshot), null);
});

test('an exact request returns the same idempotency key across redeliveries and different maintainers', () => {
  const accepted = authorizeConflictClick('check_run', body, authority, published, pull, access);
  assert.deepEqual(accepted, { ...preview.target, key: preview.create.external_id });
  for (const permission of ['admin', 'maintain']) {
    assert.deepEqual(authorizeConflictClick('check_run', { ...body, sender: { type: 'User', id: 72 } }, authority,
      published, pull, { ...access, userId: 72, permission }), accepted);
  }
});

test('ignores foreign or malformed actions even if the payload claims write access', () => {
  for (const altered of [
    null, [], { ...body, action: 'rerequested' }, { ...body, requested_action: { identifier: 'other' } },
    { ...body, installation: { id: 23 } }, { ...body, repository: { ...body.repository, full_name: 'other/StudioOS' } },
    { ...body, repository: { ...body.repository, id: 102 } }, { ...body, sender: { type: 'Bot', id: 71 } },
    { ...body, sender: { type: 'User', id: 72, permission: 'admin' } },
  ]) assert.equal(authorizeConflictClick('check_run', altered, authority, published, pull, access), null);
  for (const change of [{ id: 15 }, { head_sha: 'f'.repeat(40) }, { app: { id: 34 } },
    { name: 'merge-control/policy' }, { status: 'in_progress' }, { conclusion: 'success' }, { external_id: 'other' }]) {
    assert.equal(authorizeConflictClick('check_run', { ...body, check_run: { ...body.check_run, ...change } },
      authority, published, pull, access), null);
  }
  assert.equal(authorizeConflictClick('check_suite', body, authority, published, pull, access), null);
  for (const change of [{ permission: 'triage' }, { permission: 'read' }, { permission: 'none' }, { repositoryId: 102 }]) {
    assert.equal(authorizeConflictClick('check_run', body, authority, published, pull, { ...access, ...change }), null);
  }
});

test('old buttons cannot select another PR sharing a SHA or act on a later ejection', () => {
  const next = { ...pull, latestQueueEvent: { ...removal, id: 'RMQ_later' }, signedEjection: { ...signedEjection, removalId: 'RMQ_later' } };
  const other = { ...pull, pr: 43, signedEjection: { ...signedEjection, pr: 43 } };
  for (const live of [next, other]) {
    assert.ok(previewConflictCheck(authority, live));
    assert.equal(authorizeConflictClick('check_run', body, authority, published, live, access), null);
  }
  const forged = { ...published, target: { ...published.target, pr: 43 } };
  assert.equal(authorizeConflictClick('check_run', body, authority, forged, pull, access), null);
});
