import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleConflictCheckClick, handleConflictEjection, type ConflictActionServices, type ConflictEjection, type ConflictRequest,
} from '../src/manualConflictActions.ts';
import { FIX_CONFLICTS_ACTION, previewConflictCheck } from '../src/lib/manualConflictCheck.ts';
import type { LiveQueuePull, PublishedConflictCheck } from '../src/lib/manualConflictCheck.ts';

const auth = { repository: 'AxalNetwork/StudioOS', repositoryId: 101, appId: 58, installationId: 600 };
const event: ConflictEjection = {
  pr: 420, repositoryId: 101, headRepositoryId: 101, baseRef: 'main', headSha: '2'.repeat(40), baseSha: '4'.repeat(40),
  installationId: 600, removalId: 'R_344', reason: 'MERGE_CONFLICT',
};
const original: LiveQueuePull = {
  repositoryId: 101, headRepositoryId: 101, pr: 420, headSha: event.headSha, baseSha: event.baseSha,
  baseRef: 'main', state: 'OPEN', draft: false, inMergeQueue: false, mergeable: 'CONFLICTING', signedEjection: event,
  latestQueueEvent: { type: 'RemovedFromMergeQueueEvent', id: event.removalId, reason: event.reason, beforeSha: null },
};

function fixture() {
  const checkId = 9064;
  const create = previewConflictCheck(auth, original)!.create;
  const click = {
    action: 'requested_action', requested_action: { identifier: FIX_CONFLICTS_ACTION },
    installation: { id: auth.installationId }, repository: { id: auth.repositoryId, full_name: auth.repository },
    sender: { login: 'maintainer', type: 'User', id: 77 }, check_run: { ...create, id: checkId, app: { id: auth.appId } },
  };
  const model = {
    live: { ...original }, userId: 77, permission: 'write', createAppId: auth.appId,
    saved: null as PublishedConflictCheck | null, requests: [] as ConflictRequest[],
    writes: [] as { method: string; path: string; body: unknown }[], failPatch: false, failEnqueue: false,
  };
  const deps: ConflictActionServices = {
    async loadPull(n) { assert.equal(n, original.pr); return model.live; },
    async api(method, path, body) {
      if (method === 'GET') {
        assert.equal(path, 'collaborators/maintainer/permission');
        return { user: { id: model.userId }, permission: model.permission };
      }
      model.writes.push({ method, path, body });
      if (method === 'POST') {
        assert.equal(path, 'check-runs');
        return { ...create, id: checkId, app: { id: model.createAppId } };
      }
      assert.equal(method, 'PATCH');
      assert.equal(path, 'check-runs/' + checkId);
      if (model.failPatch) throw new Error('GitHub unavailable');
      return {};
    },
    state: {
      async publishOnce(key, target, post) {
        assert.equal(key, create.external_id);
        if (!model.saved) model.saved = { checkRunId: await post(), target };
        return model.saved;
      },
      async lookup(n) { return n === checkId ? model.saved : null; },
      async requestOnce(request) {
        if (model.failEnqueue) throw new Error('storage unavailable');
        if (model.requests.some(r => r.key === request.key)) return 'duplicate';
        model.requests.push(request);
        return 'recorded';
      },
    },
  };
  return { deps, model, click };
}

test('correlates the ejected PR head and base, and creates one check per removal', async () => {
  const { deps, model } = fixture();
  assert.equal(await handleConflictEjection(auth, { ...event, reason: 'CHECKS_FAILED' }, deps), 'ignored');
  for (const change of [{ removalId: 'R_new' }, { headSha: 'a'.repeat(40) }, { baseSha: 'b'.repeat(40) },
    { installationId: 701 }, { baseRef: 'staging' }, { headRepositoryId: 999 }]) {
    assert.equal(await handleConflictEjection(auth, { ...event, ...change }, deps), 'ignored');
  }
  assert.equal(model.writes.length, 0);
  assert.equal(await handleConflictEjection(auth, event, deps), 'published');
  assert.equal(await handleConflictEjection(auth, event, deps), 'published');
  assert.deepEqual(model.writes.map(w => w.method), ['POST']);
});

test('binds the action to its App and current collaborator and rechecks the head, base and ejection', async () => {
  const { deps, model, click } = fixture();
  await handleConflictEjection(auth, event, deps);
  const act = (payload: unknown) => handleConflictCheckClick(auth, 'check_run', payload, deps);
  for (const override of [{ installation: { id: 999 } }, { sender: { ...click.sender, type: 'Bot' } },
    { check_run: { ...click.check_run, app: { id: 2 } } }, { check_run: { ...click.check_run, id: 2 } }]) {
    assert.equal(await act({ ...click, ...override }), 'ignored');
  }
  model.permission = 'read';
  assert.equal(await act(click), 'ignored');
  model.permission = 'write';
  model.userId = 999;
  assert.equal(await act(click), 'ignored');
  model.userId = click.sender.id;
  for (const stale of [{ headSha: '3'.repeat(40) }, { baseSha: '3'.repeat(40) }, { inMergeQueue: true },
    { latestQueueEvent: { ...original.latestQueueEvent!, id: 'R_other' } }]) {
    model.live = { ...original, ...stale };
    assert.equal(await act(click), 'ignored');
  }
  assert.equal(model.requests.length, 0);
  assert.deepEqual(model.writes.map(w => w.method), ['POST']);
});

test('one durable request survives duplicate clicks and a failure updating the GitHub check', async () => {
  const { deps, model, click } = fixture();
  await handleConflictEjection(auth, event, deps);
  const act = () => handleConflictCheckClick(auth, 'check_run', click, deps);
  model.failEnqueue = true;
  await assert.rejects(act, /storage unavailable/);
  assert.deepEqual(model.writes.map(w => w.method), ['POST']);
  model.failEnqueue = false;
  model.failPatch = true;
  await assert.rejects(act, /GitHub unavailable/);
  model.failPatch = false;
  assert.equal(await act(), 'duplicate');
  assert.equal(model.requests.length, 1);
  assert.deepEqual(model.requests[0], {
    target: model.saved!.target, checkRunId: click.check_run.id, installationId: auth.installationId,
    key: click.check_run.external_id, actorId: click.sender.id,
  });
  assert.equal(model.requests[0].target.expectedBaseSha, event.baseSha);
  assert.equal(model.requests[0].target.removalId, event.removalId);
  assert.deepEqual((model.writes.at(-1)!.body as { actions: unknown[] }).actions, []);
});

test('rejects a malformed GitHub create and retries an uncommitted publication', async () => {
  const { deps, model } = fixture();
  model.createAppId = 999;
  await assert.rejects(() => handleConflictEjection(auth, event, deps), /unverified conflict check/);
  assert.equal(model.saved, null);
  model.createAppId = auth.appId;
  assert.equal(await handleConflictEjection(auth, event, deps), 'published');
});
