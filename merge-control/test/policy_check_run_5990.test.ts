/** D5990: the `merge-control/policy` check run on pull_request and merge_group heads, against a fake GitHub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { RepoControl } from '../src/repoControl.ts';
import { webhook } from '../src/webhook.ts';
import { githubClient, POLICY_PERMISSIONS } from '../src/github.ts';
import { POLICY_VERSION } from '../src/policy.ts';
import { CHECK_NAME, EVALUATE_TIMEOUT_MS, SIGNOFF_PENDING, policyTarget } from '../src/policyCheck.ts';
import type { Delivery, Env, GithubApi } from '../src/types.ts';

const repo = 'AxalNetwork/StudioOS';
const base = 'a'.repeat(40), head = 'b'.repeat(40), groupHead = 'c'.repeat(40);
const hunk = (...lines: string[]) => ['@@ -1 +1 @@', ...lines].join('\n');
const T0 = [{ filename: 'documentation/operations/guide.md', status: 'modified', patch: hunk('-old', '+new') }];
const T1 = [{ filename: 'frontend/src/pages/Example.jsx', status: 'modified', patch: hunk('-old', '+new') }];
const T2 = [{ filename: 'cloudflare-worker/sql/migrations/202611230000_5990_example.sql', status: 'added', patch: hunk('+SELECT 1;') }];

function storage() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
  return {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      const rows = db.prepare(query).all(...values); return { toArray: () => rows, one: () => rows[0] };
    } },
    async get(key: string) { const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(String(row.value)) : undefined; },
    async put(key: string, value: unknown) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    db,
  };
}
async function controller(switchOn = false) {
  const store = storage(); const env = { REPOSITORY: repo } as Env;
  const ctx = { storage: store } as unknown as DurableObjectState;
  const control = new RepoControl(ctx, env);
  if (!switchOn) await control.setKillSwitch(false);
  return { store, env, ctx, control };
}
const prEvent = (over: Partial<Delivery> = {}): Delivery => ({ delivery: 'pr-1', repo, event: 'pull_request', action: 'synchronize', reason: null,
  headSha: head, headRef: null, at: 1, baseSha: base, pr: 42, ...over });
const groupEvent = (over: Partial<Delivery> = {}): Delivery => ({ delivery: 'mg-1', repo, event: 'merge_group', action: 'checks_requested', reason: null,
  headSha: groupHead, headRef: 'refs/heads/gh-readonly-queue/main/pr-42-' + 'd'.repeat(40), at: 1, baseSha: base, pr: null, ...over });

/** A fake GitHub: answers the compare and tree for any head with `files`, and records every check run posted. */
function github(files: unknown[], opts: { failPosts?: number; compareError?: boolean } = {}) {
  const posts: Record<string, any>[] = []; const reads: string[] = []; let failures = opts.failPosts ?? 0;
  const api: GithubApi = async (method, path, body) => {
    if (method === 'POST') {
      assert.equal(path, 'check-runs');
      if (failures-- > 0) throw Object.assign(new Error('GitHub HTTP 502'), { status: 502 });
      posts.push(body as Record<string, any>); return { id: posts.length };
    }
    reads.push(path);
    if (path.startsWith('git/trees/')) {
      return { truncated: false, tree: (files as { filename: string }[]).map((f) => ({ path: f.filename, mode: '100644', type: 'blob' })) };
    }
    if (opts.compareError) throw Object.assign(new Error('GitHub HTTP 500'), { status: 500 });
    return { status: 'ahead', files };
  };
  return { api, posts, reads, set files(next: unknown[]) { files = next; } };
}
const policyRows = (store: ReturnType<typeof storage>) => store.sql.exec("SELECT delivery, detail FROM audit WHERE kind = 'policy' ORDER BY id").toArray()
  .map((r: any) => ({ delivery: r.delivery, ...JSON.parse(String(r.detail)) }));

test('a pull request head gets one completed check run: T0 and T1 succeed with tier and policy_version', async () => {
  for (const [files, tier] of [[T0, 'T0'], [T1, 'T1']] as const) {
    const { control, store } = await controller(); const gh = github(files);
    await control.process(prEvent(), gh.api);
    assert.equal(gh.posts.length, 1, tier);
    const run = gh.posts[0];
    assert.deepEqual([run.name, run.head_sha, run.status, run.conclusion], [CHECK_NAME, head, 'completed', 'success']);
    assert.match(run.output.summary, new RegExp(`Tier ${tier}, success\\. policy_version ${POLICY_VERSION}`));
    assert.match(run.output.text, new RegExp(`Base: ${base}`));
    assert.equal(run.external_id, `${POLICY_VERSION}:pull_request`);
    assert.deepEqual(gh.reads.sort(), [`compare/${base}...${head}`, `git/trees/${head}?recursive=1`]);
    const [row] = policyRows(store);
    assert.deepEqual({ ...row, at: typeof row.at }, { delivery: 'pr-1', sha: head, base, event: 'pull_request', pr: 42, tier, conclusion: 'success', policy_version: POLICY_VERSION, at: 'number' });
    store.db.close();
  }
});

test('a T2 pull request is action_required with its reasons in the output', async () => {
  const { control, store } = await controller(); const gh = github(T2);
  await control.process(prEvent(), gh.api);
  assert.equal(gh.posts[0].conclusion, 'action_required');
  assert.equal(gh.posts[0].output.title, 'T2: action required');
  assert.match(gh.posts[0].output.text, /protected path: cloudflare-worker\/sql\//);
  assert.doesNotMatch(gh.posts[0].output.text, /sign-off/, 'the sign-off rule is the merge group\'s');
  assert.equal(policyRows(store)[0].conclusion, 'action_required');
  store.db.close();
});

test('a merge group head is checked against base_sha; a T2 head stays action_required until sign-off exists', async () => {
  const { control, store } = await controller(); const gh = github(T1);
  await control.process(groupEvent(), gh.api);
  assert.deepEqual(gh.reads.sort(), [`compare/${base}...${groupHead}`, `git/trees/${groupHead}?recursive=1`]);
  assert.deepEqual([gh.posts[0].head_sha, gh.posts[0].conclusion], [groupHead, 'success']);
  const t2 = await controller(); const gh2 = github(T2);
  await t2.control.process(groupEvent(), gh2.api);
  assert.equal(gh2.posts[0].conclusion, 'action_required');
  assert.ok(gh2.posts[0].output.text.includes(SIGNOFF_PENDING), 'the T2 merge-group rule names the missing sign-off');
  assert.equal(policyRows(t2.store)[0].event, 'merge_group');
  // destroyed is not a checks request: no evaluation, no check.
  const gone = await controller(); const gh3 = github(T0);
  await gone.control.process(groupEvent({ delivery: 'mg-2', action: 'destroyed', reason: 'merged' }), gh3.api);
  assert.deepEqual([gh3.posts.length, gh3.reads.length, policyRows(gone.store).length], [0, 0, 0]);
  for (const s of [store, t2.store, gone.store]) s.db.close();
});

test('fail closed: an API error and a timeout post no success; a posting error posts nothing and retries the same conclusion', async () => {
  const { control, store } = await controller(); const gh = github(T0, { compareError: true });
  await control.process(prEvent(), gh.api);
  assert.equal(gh.posts[0].conclusion, 'action_required');
  assert.match(gh.posts[0].output.text, /GitHub compare unavailable \(HTTP 500\)/);
  store.db.close();

  // A posting error: nothing is marked posted, the delivery throws for the Queue to retry, and the retry posts
  // the stored decision even though GitHub now answers a passing list.
  const second = await controller(); const failing = github(T2, { failPosts: 1 });
  await assert.rejects(second.control.process(prEvent(), failing.api), /GitHub HTTP 502/);
  assert.equal(failing.posts.length, 0);
  failing.files = T0;
  await second.control.process(prEvent(), failing.api);
  assert.deepEqual(failing.posts.map((p) => p.conclusion), ['action_required']);
  assert.equal(failing.reads.filter((p) => p.startsWith('compare/')).length, 1, 'the retry does not re-evaluate');
  assert.equal(policyRows(second.store).length, 1, 'one decision, one audit row');
  second.store.db.close();
});

test('a timeout is action_required', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { control, store } = await controller();
  const posts: Record<string, any>[] = [];
  const api: GithubApi = async (method, _path, body) => {
    if (method === 'POST') { posts.push(body as Record<string, any>); return {}; }
    return new Promise(() => {});
  };
  const done = control.process(prEvent(), api);
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(EVALUATE_TIMEOUT_MS);
  await done;
  assert.equal(posts[0].conclusion, 'action_required');
  assert.match(posts[0].output.text, /evaluation exceeded 15000 ms/);
  store.db.close();
});

test('a redelivery never posts a second, different conclusion for the same SHA and policy_version', async () => {
  const { control, store, ctx, env } = await controller(); const gh = github(T2);
  await control.process(prEvent(), gh.api);
  gh.files = T0;
  await control.process(prEvent(), gh.api); // the same delivery id
  await control.process(prEvent({ delivery: 'pr-2', action: 'reopened' }), gh.api); // a new delivery for the same head
  await new RepoControl(ctx, env).process(prEvent({ delivery: 'pr-3' }), gh.api); // after a restart
  assert.deepEqual(gh.posts.map((p) => p.conclusion), ['action_required']);
  assert.equal(policyRows(store).length, 1);
  // A new head is a new decision.
  await control.process(prEvent({ delivery: 'pr-4', headSha: 'e'.repeat(40) }), gh.api);
  assert.deepEqual(gh.posts.map((p) => [p.head_sha, p.conclusion]), [[head, 'action_required'], ['e'.repeat(40), 'success']]);
  store.db.close();
});

test('with the kill switch on, no check is posted and GitHub is not called', async () => {
  const { control, store } = await controller(true); const gh = github(T0);
  await control.process(prEvent(), gh.api);
  await control.process(groupEvent(), gh.api);
  assert.deepEqual([gh.posts.length, gh.reads.length, policyRows(store).length], [0, 0, 0]);
  store.db.close();
});

test('a label, a comment or an approving review changes nothing', async () => {
  const { control, store } = await controller(); const gh = github(T2);
  await control.process(prEvent(), gh.api);
  const noise: Delivery[] = [
    prEvent({ delivery: 'n-1', action: 'labeled' }),
    prEvent({ delivery: 'n-2', action: 'unlabeled' }),
    prEvent({ delivery: 'n-3', event: 'issue_comment', action: 'created' }),
    prEvent({ delivery: 'n-4', event: 'pull_request_review', action: 'submitted' }),
    prEvent({ delivery: 'n-5', action: 'edited' }),
  ];
  for (const n of noise) {
    assert.equal(policyTarget(n), null, `${n.event} ${n.action}`);
    await control.process(n, async () => { throw new Error(`${n.event} ${n.action} must call no API`); });
  }
  assert.deepEqual(gh.posts.map((p) => p.conclusion), ['action_required']);
  assert.equal(policyRows(store).length, 1);
  store.db.close();
});

test('the audit is append-only: an update or a delete of any row is refused', async () => {
  const { control, store } = await controller(); const gh = github(T0);
  await control.process(prEvent(), gh.api);
  assert.throws(() => store.sql.exec("UPDATE audit SET detail = '{}' WHERE kind = 'policy'"), /append-only/);
  assert.throws(() => store.sql.exec('DELETE FROM audit'), /append-only/);
  assert.equal(policyRows(store)[0].conclusion, 'success');
  store.db.close();
});

test('webhook: pull_request and checks_requested carry head, base and number; other actions carry none', async () => {
  const secret = randomBytes(32).toString('hex'); const queued: Delivery[] = [];
  const env = { REPOSITORY: repo, WEBHOOK_SECRET: secret, EVENTS: { send: async (v: Delivery) => { queued.push(v); } } } as unknown as Env;
  const send = (event: string, payload: unknown) => {
    const body = JSON.stringify(payload);
    return webhook(new Request('https://local/webhook', { method: 'POST', body, headers: { 'x-github-event': event, 'x-github-delivery': `d-${queued.length}-${event.replace(/_/g, '-')}`,
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') } }), env);
  };
  const pr = (action: string, over: Record<string, unknown> = {}) => ({ action, repository: { full_name: repo },
    pull_request: { number: 42, head: { sha: head, ref: 'feature', repo: { full_name: 'someone/fork' } }, base: { sha: base, ref: 'main' }, title: 'private title', ...over } });
  assert.equal((await send('pull_request', pr('opened'))).status, 200);
  assert.deepEqual([queued[0].headSha, queued[0].baseSha, queued[0].pr], [head, base, 42]);
  assert.equal(JSON.stringify(queued[0]).includes('private title'), false, 'no PR text is queued');
  assert.equal((await send('pull_request', pr('labeled'))).status, 200);
  assert.deepEqual([queued[1].headSha, queued[1].baseSha, queued[1].pr], [null, null, null]);
  assert.equal((await send('pull_request', pr('synchronize', { head: { sha: 'not-a-sha' } }))).status, 400);
  assert.equal((await send('pull_request', pr('reopened', { number: 0 }))).status, 400);
  const group = (over: Record<string, unknown> = {}) => ({ action: 'checks_requested', repository: { full_name: repo },
    merge_group: { head_sha: groupHead, head_ref: 'refs/heads/gh-readonly-queue/main/pr-42-x', base_sha: base, ...over } });
  assert.equal((await send('merge_group', group({ base_sha: undefined }))).status, 400);
  assert.equal((await send('merge_group', group())).status, 200);
  const last = queued[queued.length - 1];
  assert.deepEqual([last.headSha, last.baseSha, last.pr], [groupHead, base, null]);
  assert.equal(queued.length, 3);
});

test('the policy check asks for its own checks-write token; cancellation keeps the D5618 scope', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { REPOSITORY: repo, GITHUB_APP_ID: '123', GITHUB_INSTALLATION_ID: '456',
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() } as Env;
  const asked: unknown[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    asked.push(JSON.parse(String(init?.body)).permissions); return Response.json({ token: 't' });
  }) as typeof fetch;
  await githubClient(env, fetcher);
  await githubClient(env, fetcher, POLICY_PERMISSIONS);
  assert.deepEqual(asked, [{ actions: 'write', contents: 'read' }, { checks: 'write', contents: 'read' }]);
  // The policy path asks for that scope; cancellation and reconciliation keep the default.
  const source = readFileSync('merge-control/src/repoControl.ts', 'utf8');
  assert.match(source, /const api = await this\.client\(injectedApi, POLICY_PERMISSIONS\);/);
  assert.equal((source.match(/POLICY_PERMISSIONS/g) || []).length, 2, 'imported once, used once');
});
