/**
 * D7109: the signed-event adapters for the manual "Fix conflicts" check, through the real webhook and the real
 * repository object on SQLite-backed storage, against a fake GitHub (GraphQL pull read, Checks, permission, dispatch).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RepoControl } from '../src/repoControl.ts';
import { webhook } from '../src/webhook.ts';
import { CONFLICT_WORKFLOW, conflictIngress, MAX_PENDING, requestId } from '../src/manualConflictIngress.ts';
import { CONFLICT_CHECK_NAME, FIX_CONFLICTS_ACTION } from '../src/lib/manualConflictCheck.ts';
import type { ConflictClickPayload, Delivery, Env, GithubApi } from '../src/types.ts';

const repo = 'AxalNetwork/StudioOS';
const head = '2'.repeat(40), base = '4'.repeat(40), moved = '6'.repeat(40);
const IDS = { repositoryId: 101, appId: 58, installationId: 600 };
const removalId = 'RFMQE_kwDO344';
const configured = { REPOSITORY: repo, MANUAL_CONFLICT_ENABLED: 'true', GITHUB_REPOSITORY_ID: '101', GITHUB_APP_ID: '58', GITHUB_INSTALLATION_ID: '600' };

function storage() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
  const set = db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  return {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      const rows = db.prepare(query).all(...values); return { toArray: () => rows, one: () => rows[0] };
    } },
    async get(key: string) { const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(String(row.value)) : undefined; },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      const entries = typeof key === 'string' ? { [key]: value } : key;
      db.exec('BEGIN'); for (const [k, v] of Object.entries(entries)) set.run(k, JSON.stringify(v)); db.exec('COMMIT');
    },
    db,
  };
}
async function controller(env: Record<string, string> = configured) {
  const store = storage();
  const control = new RepoControl({ storage: store } as unknown as DurableObjectState, env as unknown as Env);
  await control.setKillSwitch(false);
  return { store, control };
}

/** A fake GitHub: the live pull request is `gh.live`; every write is recorded. */
function github() {
  const gh = {
    live: { headRefOid: head, baseRefOid: base, state: 'OPEN', isDraft: false, isInMergeQueue: false, mergeable: 'CONFLICTING',
      last: { __typename: 'RemovedFromMergeQueueEvent', id: removalId, reason: 'MERGE_CONFLICT', beforeCommit: { oid: head } } as Record<string, unknown> | null },
    permission: 'write', userId: 77, listed: [] as unknown[], failDispatch: 0,
    writes: [] as { method: string; path: string; body: any }[], reads: [] as string[], checkId: 9064,
  };
  const api: GithubApi = async (method, path, body) => {
    if (method === 'POST' && path === 'graphql') {
      gh.reads.push('graphql');
      const l = gh.live;
      return { data: { repository: { databaseId: IDS.repositoryId, pullRequest: { number: 420, state: l.state, isDraft: l.isDraft,
        isInMergeQueue: l.isInMergeQueue, mergeable: l.mergeable, baseRefName: 'main', baseRefOid: l.baseRefOid, headRefOid: l.headRefOid,
        headRepository: { databaseId: IDS.repositoryId }, timelineItems: { nodes: l.last ? [l.last] : [] } } } } };
    }
    if (method === 'GET') {
      gh.reads.push(path);
      if (path.startsWith(`commits/${head}/check-runs?`)) return { check_runs: gh.listed };
      if (path === 'collaborators/maintainer/permission') return { user: { id: gh.userId }, permission: gh.permission };
      throw new Error(`unexpected read ${path}`);
    }
    gh.writes.push({ method, path, body });
    if (method === 'POST' && path === 'check-runs') return { ...(body as object), id: gh.checkId, app: { id: IDS.appId } };
    if (method === 'POST' && path === `actions/workflows/${CONFLICT_WORKFLOW}/dispatches`) {
      if (gh.failDispatch-- > 0) throw Object.assign(new Error('GitHub HTTP 502'), { status: 502 });
      return null;
    }
    if (method === 'PATCH' && path === `check-runs/${gh.checkId}`) return {};
    throw new Error(`unexpected write ${method} ${path}`);
  };
  return { gh, api };
}

let n = 0;
const ejection = (over: Record<string, unknown> = {}): Delivery => ({ delivery: `ej-${++n}`, repo, event: 'pull_request', action: 'dequeued',
  reason: null, headSha: null, headRef: null, at: 1, baseSha: null, pr: null,
  conflict: { kind: 'ejection', repositoryId: IDS.repositoryId, headRepositoryId: IDS.repositoryId, installationId: IDS.installationId,
    pr: 420, headSha: head, baseRef: 'main', baseSha: base, reason: 'MERGE_CONFLICT', ...over } as Delivery['conflict'] });
function clickPayload(created: any, over: Partial<ConflictClickPayload> = {}): ConflictClickPayload {
  return { action: 'requested_action', requested_action: { identifier: FIX_CONFLICTS_ACTION }, installation: { id: IDS.installationId },
    repository: { id: IDS.repositoryId, full_name: repo }, sender: { id: 77, login: 'maintainer', type: 'User' },
    check_run: { id: 9064, name: created.name, status: created.status, conclusion: created.conclusion, head_sha: created.head_sha,
      external_id: created.external_id, app: { id: IDS.appId } }, ...over };
}
const click = (payload: ConflictClickPayload): Delivery => ({ delivery: `cl-${++n}`, repo, event: 'check_run', action: 'requested_action',
  reason: null, headSha: null, headRef: null, at: 1, conflict: { kind: 'click', payload } });
const movedEvent = (action: string): Delivery => ({ delivery: `mv-${++n}`, repo, event: 'pull_request', action, reason: null,
  headSha: null, headRef: null, at: 1, conflict: { kind: 'moved', pr: 420 } });
const dispatches = (gh: ReturnType<typeof github>['gh']) => gh.writes.filter((w) => w.path.endsWith('/dispatches'));
const conflictAudit = (store: ReturnType<typeof storage>) => store.sql.exec("SELECT detail FROM audit WHERE kind = 'conflict' ORDER BY id")
  .toArray().map((r: any) => JSON.parse(String(r.detail)).outcome);

// Mutation checked: the MANUAL_CONFLICT_ENABLED test inverted (the off case posts: fails); the kill-switch guard on the
// hook removed (the kill-switch case posts: fails).
test('off by default: no switch, no configuration or the kill switch means no GitHub call at all', async () => {
  for (const env of [{ REPOSITORY: repo }, { ...configured, MANUAL_CONFLICT_ENABLED: 'false' }, { ...configured, GITHUB_REPOSITORY_ID: '' }]) {
    const { control, store } = await controller(env as Record<string, string>); const { gh, api } = github();
    await control.process(ejection(), api);
    assert.deepEqual([gh.reads, gh.writes], [[], []]);
    assert.deepEqual(conflictAudit(store), [env.MANUAL_CONFLICT_ENABLED === 'true' ? 'not_configured' : 'off']);
  }
  const { control, store } = await controller(); const { gh, api } = github();
  await control.setKillSwitch(true);
  await control.process(ejection(), api);
  assert.deepEqual([gh.reads, gh.writes, conflictAudit(store)], [[], [], []]);
});

// Mutation checked: publishOnce's stored-check return removed (redelivery posts twice: fails); the adoption search
// removed (the ambiguous POST case posts again: fails); the UNKNOWN throw removed (no rejection: fails).
test('a conflict ejection publishes one check on that head; a redelivery or an earlier POST is reused, never posted twice', async () => {
  const { control, store } = await controller(); const { gh, api } = github();
  for (const other of [{ reason: 'CI_FAILURE' }, { headSha: moved }, { baseSha: moved }, { installationId: 1 }, { headRepositoryId: null }]) {
    await control.process(ejection(other), api);
  }
  gh.live.last = { __typename: 'AddedToMergeQueueEvent', id: 'AMQE_1' };
  await control.process(ejection(), api);
  assert.deepEqual(gh.writes, [], 'a later queue entry, or another removal, publishes nothing');
  gh.live.last = { __typename: 'RemovedFromMergeQueueEvent', id: removalId, reason: 'Merge conflict', beforeCommit: { oid: head } };
  gh.live.mergeable = 'UNKNOWN';
  await assert.rejects(control.process(ejection(), api), /mergeability not computed/);
  gh.live.mergeable = 'CONFLICTING';
  const first = ejection();
  await control.process(first, api);
  await control.process({ ...first, delivery: 'ej-redelivered' }, api);
  assert.deepEqual(gh.writes.map((w) => [w.method, w.path]), [['POST', 'check-runs']]);
  const created = gh.writes[0].body;
  assert.deepEqual([created.name, created.head_sha, created.conclusion, created.actions.map((a: any) => a.identifier)],
    [CONFLICT_CHECK_NAME, head, 'neutral', [FIX_CONFLICTS_ACTION]]);
  assert.equal(created.external_id, `queue-conflict:101:420:${head}:${base}:${removalId}`);
  assert.deepEqual(conflictAudit(store).slice(-2), ['published', 'published']);

  // A POST that GitHub accepted before storage failed: the next delivery adopts that check instead of posting again.
  const again = await controller(); const second = github();
  second.gh.listed = [{ id: 9064, external_id: created.external_id, head_sha: head, app: { id: IDS.appId } }];
  await again.control.process(ejection(), second.api);
  assert.deepEqual(second.gh.writes, []);
  assert.equal(await again.store.get('conflict-check-id:9064'), created.external_id);
});

// Mutation checked: requestOnce's duplicate test removed (a second dispatch: fails); requestId of another value (the
// input: fails); the signed ejection snapshot not attached to the click's read (nothing recorded: fails).
test('an authorized click dispatches the conflict-only resolver once, with its pins, through a failed dispatch and repeats', async () => {
  const { control, store } = await controller(); const { gh, api } = github();
  await control.process(ejection(), api);
  const created = gh.writes[0].body;
  gh.failDispatch = 1;
  const first = click(clickPayload(created));
  await assert.rejects(control.process(first, api), /502/);
  assert.equal(dispatches(gh).length, 1, 'the failed attempt');
  await control.process(first, api); // the Queue's retry of the same delivery
  await control.process({ ...first, delivery: 'cl-again' }, api); // a second click
  const sent = dispatches(gh);
  assert.equal(sent.length, 2, 'one failed and one successful dispatch, none for the repeat');
  assert.deepEqual(sent[1].body, { ref: 'main', inputs: { pr: '420', expected_head: head, expected_base: base, request: requestId(created.external_id) } });
  assert.match(sent[1].body.inputs.request, /^[a-f0-9]{16}$/);
  const patches = gh.writes.filter((w) => w.method === 'PATCH');
  assert.ok(patches.length >= 1);
  assert.deepEqual(patches.at(-1)!.body.actions, [], 'the button is gone once requested');
  assert.deepEqual(await store.get('conflict-outbox'), []);
  // The request was recorded before the failed dispatch; the retry and the second click find it and only drain the outbox.
  assert.deepEqual(conflictAudit(store).slice(-2), ['duplicate', 'duplicate']);
  assert.equal((await store.get(`conflict-request:${created.external_id}`)).dispatched, true);
});

// Mutation checked: stillOffered's head comparison removed (the stale click is not expired: fails).
test('an unauthorized click changes nothing; a click on a button the pull request has moved past removes it', async () => {
  const { control, store } = await controller(); const { gh, api } = github();
  await control.process(ejection(), api);
  const created = gh.writes[0].body;
  gh.permission = 'read';
  await control.process(click(clickPayload(created)), api);
  await control.process(click(clickPayload(created, { sender: { id: 77, login: 'maintainer', type: 'Bot' } })), api);
  assert.deepEqual(gh.writes.map((w) => w.method), ['POST']);
  gh.permission = 'write';
  gh.live.headRefOid = moved;
  await control.process(click(clickPayload(created)), api);
  assert.deepEqual(gh.writes.map((w) => w.method), ['POST', 'PATCH']);
  assert.match(gh.writes[1].body.output.summary, /no longer offers repair/);
  assert.equal(dispatches(gh).length, 0);
  assert.deepEqual(conflictAudit(store).slice(-3), ['ignored', 'ignored', 'stale_expired']);
});

// Mutation checked: the stillOffered skip removed from the moved path (the title edit expires: fails).
test('a push or a re-queue expires the offered button; a title edit leaves it', async () => {
  const { control, store } = await controller(); const { gh, api } = github();
  await control.process(ejection(), api);
  await control.process(movedEvent('edited'), api);
  assert.deepEqual(gh.writes.map((w) => w.method), ['POST']);
  gh.live.isInMergeQueue = true;
  await control.process(movedEvent('enqueued'), api);
  await control.process(movedEvent('synchronize'), api);
  assert.deepEqual(gh.writes.map((w) => w.method), ['POST', 'PATCH'], 'expired once');
  assert.deepEqual(conflictAudit(store).slice(-3), ['ignored', 'expired', 'ignored']);
});

test('a full outbox refuses a new request for the Queue to retry, rather than drop one', async () => {
  const { control, store } = await controller(); const { gh, api } = github();
  await control.process(ejection(), api);
  await store.put('conflict-outbox', Array.from({ length: MAX_PENDING }, (_, i) => `other-${i}`));
  await assert.rejects(control.process(click(clickPayload(gh.writes[0].body)), api), /outbox is full/);
  assert.equal(dispatches(gh).length, 0);
});

// Mutation checked: the 'ignore' return for other check_run actions (enqueued: fails); the sender login check
// dropped from the reducer (the malformed case returns 200: fails).
test('webhook: keeps only the verified fields of a dequeue, a requested action and a moved pull request', async () => {
  const secret = randomBytes(32).toString('hex'); const queued: Delivery[] = [];
  const env = { REPOSITORY: repo, WEBHOOK_SECRET: secret, EVENTS: { send: async (v: Delivery) => { queued.push(v); } } } as unknown as Env;
  const send = (event: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    return webhook(new Request('https://local/webhook', { method: 'POST', body, headers: { 'x-github-event': event, 'x-github-delivery': `d-${++n}`,
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') } }), env);
  };
  const dequeued = { action: 'dequeued', reason: 'MERGE_CONFLICT', repository: { id: 101, full_name: repo }, installation: { id: 600 },
    pull_request: { number: 420, title: 'private title', head: { sha: head, ref: 'feature', repo: { id: 101 } }, base: { sha: base, ref: 'main' } } };
  assert.equal((await send('pull_request', dequeued)).status, 200);
  assert.deepEqual(queued[0].conflict, { kind: 'ejection', repositoryId: 101, headRepositoryId: 101, installationId: 600, pr: 420,
    headSha: head, baseRef: 'main', baseSha: base, reason: 'MERGE_CONFLICT' });
  assert.equal(JSON.stringify(queued[0]).includes('private title'), false);
  assert.equal((await send('pull_request', { ...dequeued, pull_request: { ...dequeued.pull_request, head: { sha: 'x' } } })).status, 400);
  const check = { id: 9064, name: CONFLICT_CHECK_NAME, status: 'completed', conclusion: 'neutral', head_sha: head, external_id: 'k',
    app: { id: 58 }, output: { summary: 'private' } };
  const requested = { action: 'requested_action', requested_action: { identifier: FIX_CONFLICTS_ACTION }, installation: { id: 600 },
    repository: { id: 101, full_name: repo }, sender: { id: 77, login: 'maintainer', type: 'User', email: 'private@example.com' }, check_run: check };
  assert.equal((await send('check_run', requested)).status, 200);
  const { output: _dropped, ...kept } = check;
  assert.deepEqual(queued[1].conflict, { kind: 'click', payload: { ...requested, sender: { id: 77, login: 'maintainer', type: 'User' }, check_run: kept } });
  assert.equal((await send('check_run', { ...requested, sender: { id: 77, type: 'User' } })).status, 400);
  const completed = await send('check_run', { ...requested, action: 'completed' });
  assert.deepEqual([completed.status, await completed.json(), queued.length], [200, { accepted: false }, 2]);
  assert.equal((await send('pull_request', { action: 'enqueued', repository: { full_name: repo }, pull_request: { number: 420 } })).status, 200);
  assert.deepEqual(queued[2].conflict, { kind: 'moved', pr: 420 });
  assert.equal((await send('pull_request', { action: 'labeled', repository: { full_name: repo }, pull_request: { number: 420 } })).status, 200);
  assert.equal(queued[3].conflict, undefined);
  assert.equal(conflictIngress('push', {}), null);
});
