/** D8834 (#5620 items 4 and 5): the owner sign-off route and the T2 merge-group rule, against real SQLite and a fake GitHub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RepoControl } from '../src/repoControl.ts';
import worker from '../src/index.ts';
import { POLICY_VERSION } from '../src/policy.ts';
import { CHECK_NAME, SIGNOFF_PENDING, decide, policyTarget } from '../src/policyCheck.ts';
import type { PolicyResult, PolicyTarget } from '../src/policyCheck.ts';
import { bindCandidate, parseSignoff, signoffKey, signoffRequest } from '../src/signoff.ts';
import type { Delivery, Env, GithubApi } from '../src/types.ts';

const repo = 'AxalNetwork/StudioOS';
const sha = (c: string) => c.repeat(40);
const BASE = sha('a'), H1 = sha('1'), H2 = sha('2'), C1 = sha('c'), C2 = sha('d'), OTHER = sha('e');
const MIG = 'cloudflare-worker/sql/migrations/202611270000_8834_example.sql';
const T2_FILES = [{ filename: MIG, status: 'added', patch: '@@ -0,0 +1 @@\n+SELECT 1;' }];

function storage() {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)');
  return {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      const rows = db.prepare(query).all(...values); return { toArray: () => rows, one: () => rows[0] };
    } },
    failGet: null as RegExp | null,
    async get(key: string) {
      if (this.failGet?.test(key)) throw new Error('storage unavailable');
      const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(String(row.value)) : undefined;
    },
    async put(key: string, value: unknown) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    db,
  };
}
async function controller(switchOn = false) {
  const store = storage(); const env = { REPOSITORY: repo } as Env;
  const control = new RepoControl({ storage: store } as unknown as DurableObjectState, env);
  if (!switchOn) await control.setKillSwitch(false);
  return { store, control };
}

type Tree = Record<string, string>;
/**
 * A fake repository. Base and merge base share a tree unless `mergeBase` is given; each candidate is one commit on
 * its parent with the given tree. Compare of base...candidate returns the T2 file list; base...head names the merge base.
 */
function github(opts: { trees?: Record<string, Tree>; parents?: Record<string, string[]>; mergeBase?: string; fail?: RegExp; truncated?: string } = {}) {
  const baseTree: Tree = { 'README.md': 'r1', 'x.txt': 'x1' };
  const trees: Record<string, Tree> = {
    [BASE]: baseTree,
    [H1]: { ...baseTree, [MIG]: 'm1' }, [H2]: { ...baseTree, [MIG]: 'm2' },
    [C1]: { ...baseTree, [MIG]: 'm1' }, [C2]: { ...baseTree, [MIG]: 'm2' },
    ...opts.trees,
  };
  const parents: Record<string, string[]> = { [C1]: [BASE], [C2]: [BASE], ...opts.parents };
  const posts: Record<string, any>[] = []; const reads: string[] = [];
  const api: GithubApi = async (method, path, body) => {
    if (method === 'POST') { assert.equal(path, 'check-runs'); posts.push(body as Record<string, any>); return { id: posts.length }; }
    reads.push(path);
    if (opts.fail?.test(path)) throw Object.assign(new Error('GitHub HTTP 500'), { status: 500 });
    let m = /^git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(path);
    if (m) {
      const tree = trees[m[1]]; if (!tree) throw Object.assign(new Error('GitHub HTTP 404'), { status: 404 });
      return { truncated: opts.truncated === m[1], tree: [{ path: 'dir', mode: '040000', type: 'tree', sha: sha('9') },
        ...Object.entries(tree).map(([p, blob]) => ({ path: p, mode: '100644', type: 'blob', sha: blob }))] };
    }
    m = /^git\/commits\/([a-f0-9]{40})$/.exec(path);
    if (m) return { sha: m[1], parents: (parents[m[1]] ?? []).map((p) => ({ sha: p })) };
    m = /^compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})$/.exec(path);
    if (m) return { status: 'ahead', merge_base_commit: { sha: opts.mergeBase ?? m[1] }, files: T2_FILES };
    throw new Error(`unexpected read ${path}`);
  };
  return { api, posts, reads };
}

let n = 0;
const prEvent = (headSha: string, over: Partial<Delivery> = {}): Delivery => ({ delivery: `pr-${++n}`, repo, event: 'pull_request', action: 'synchronize',
  reason: null, headSha, headRef: null, at: n, baseSha: BASE, pr: 42, ...over });
const groupEvent = (candidate: string, over: Partial<Delivery> = {}): Delivery => ({ delivery: `mg-${++n}`, repo, event: 'merge_group',
  action: 'checks_requested', reason: null, headSha: candidate, headRef: `refs/heads/gh-readonly-queue/main/pr-42-${BASE}`, at: n, baseSha: BASE, pr: null, ...over });
const sign = (head: string, actor = 'owner-login') => ({ pr: 42, head_sha: head, actor });
const on = (gh: ReturnType<typeof github>, head: string) => gh.posts.filter((p) => p.head_sha === head).map((p) => p.conclusion);
const signoffRows = (store: ReturnType<typeof storage>) => store.sql.exec("SELECT delivery, detail FROM audit WHERE kind = 'signoff' ORDER BY id").toArray()
  .map((r: any) => ({ delivery: r.delivery, ...JSON.parse(String(r.detail)) }));

test('a sign-off re-posts success on its head only, and a T2 merge group built from that head passes', async () => {
  const { control, store } = await controller(); const gh = github();
  await control.process(prEvent(H1), gh.api);
  assert.deepEqual(on(gh, H1), ['action_required']);
  const outcome = await control.signoff(sign(H1), gh.api);
  assert.equal(outcome.status, 200);
  assert.deepEqual(on(gh, H1), ['action_required', 'success']);
  const run = gh.posts[1];
  assert.deepEqual([run.name, run.status, run.external_id, run.output.title], [CHECK_NAME, 'completed', `${POLICY_VERSION}:signoff`, 'T2: signed off by the owner']);
  assert.match(run.output.text, /Signed off by owner-login for pull request #42/);
  assert.equal(gh.posts.length, 2, 'no other SHA gets a check');
  await control.process(groupEvent(C1), gh.api);
  assert.deepEqual(on(gh, C1), ['success']);
  assert.equal(gh.posts[2].output.title, 'T2: signed off by the owner');
  assert.match(gh.posts[2].output.text, new RegExp(`Signed off by owner-login for #42 head ${H1}`));
  assert.ok(gh.reads.includes(`git/commits/${C1}`) && gh.reads.includes(`compare/${BASE}...${H1}`), 'the candidate is bound to the signed head');
  store.db.close();
});

test('a sign-off for SHA A passes A, not B: a new push needs a new sign-off', async () => {
  const { control, store } = await controller(); const gh = github();
  await control.process(prEvent(H1), gh.api);
  await control.signoff(sign(H1), gh.api);
  await control.process(prEvent(H2), gh.api); // a push: the pull request's head is now H2
  assert.deepEqual(on(gh, H2), ['action_required'], 'the new head is not signed off');
  await control.process(groupEvent(C2), gh.api);
  assert.deepEqual(on(gh, C2), ['action_required'], 'a merge group of the unsigned head fails');
  assert.ok(gh.posts.at(-1)!.output.text.includes(`no owner sign-off for #42 head ${H2}`));
  assert.deepEqual(await control.signoff(sign(H1), gh.api), { status: 409, error: 'not_current_head' }, 'an old head cannot be signed');
  assert.deepEqual(on(gh, H1), ['action_required', 'success'], 'A keeps its one sign-off post');
  // Signing B passes B.
  assert.equal((await control.signoff(sign(H2), gh.api)).status, 200);
  assert.deepEqual(on(gh, H2), ['action_required', 'success']);
  // A re-queue is a new candidate; built from the signed B, it passes. C2 keeps its stored decision.
  const requeue = github({ parents: { [OTHER]: [BASE] }, trees: { [OTHER]: { 'README.md': 'r1', 'x.txt': 'x1', [MIG]: 'm2' } } });
  await control.process(groupEvent(OTHER), requeue.api);
  assert.deepEqual(on(requeue, OTHER), ['success']);
  const gh2 = github(); await control.process(groupEvent(C2), gh2.api);
  assert.equal(gh2.posts.length, 0, 'C2 keeps its stored decision under this policy_version');
  store.db.close();
});

test('a T2 merge group without a sign-off stays action_required', async () => {
  const { control, store } = await controller(); const gh = github();
  await control.process(prEvent(H1), gh.api);
  await control.process(groupEvent(C1), gh.api);
  assert.deepEqual(on(gh, C1), ['action_required']);
  assert.ok(gh.posts.at(-1)!.output.text.includes(SIGNOFF_PENDING));
  assert.ok(!gh.reads.includes(`git/commits/${C1}`), 'no sign-off, so nothing is bound');
  // decide itself: only ok evidence for a finished classification passes a T2 merge group.
  const target: PolicyTarget = { kind: 'merge_group', head: C1, base: BASE, pr: 42 };
  const t2: PolicyResult = { conclusion: 'action_required', tier: 'T2', reasons: ['T2: protected path'], policy_version: POLICY_VERSION, base: BASE, head: C1, complete: true };
  assert.equal(decide(t2, target).conclusion, 'action_required');
  assert.equal(decide(t2, target, { ok: false, reasons: ['T2: x'] }).conclusion, 'action_required');
  assert.equal(decide(t2, target, { ok: true, reasons: ['signed'] }).conclusion, 'success');
  assert.equal(decide({ ...t2, complete: false }, target, { ok: true, reasons: ['signed'] }).conclusion, 'action_required', 'an evaluation error is never signed past');
  assert.equal(decide(t2, { ...target, kind: 'pull_request' }, { ok: true, reasons: ['signed'] }).conclusion, 'action_required', 'evidence is the merge group\'s');
  store.db.close();
});

test('the candidate must be built from the signed head: wrong tree, wrong parent, both-sided change and a stale base change fail', async () => {
  const cases: [string, Parameters<typeof github>[0], RegExp][] = [
    ['tree of another head', { trees: { [C1]: { 'README.md': 'r1', 'x.txt': 'x1', [MIG]: 'm2' } } }, /is not built from .*: cloudflare-worker\/sql\/migrations\/.* differs/],
    ['an extra path', { trees: { [C1]: { 'README.md': 'r1', 'x.txt': 'x1', [MIG]: 'm1', 'extra.sh': 'z' } } }, /extra\.sh differs/],
    ['two parents', { parents: { [C1]: [BASE, H1] } }, /is not one commit on the merge group base/],
    ['another parent', { parents: { [C1]: [OTHER] } }, /is not one commit on the merge group base/],
    ['both sides changed', { mergeBase: sha('5'), trees: { [sha('5')]: { 'README.md': 'r0', 'x.txt': 'x1' }, [H1]: { 'README.md': 'r9', 'x.txt': 'x1', [MIG]: 'm1' } } }, /README\.md changed on both sides/],
    ['base change dropped', { mergeBase: sha('5'), trees: { [sha('5')]: { 'README.md': 'r1', 'x.txt': 'x0' }, [H1]: { 'README.md': 'r1', 'x.txt': 'x0', [MIG]: 'm1' },
      [C1]: { 'README.md': 'r1', 'x.txt': 'x0', [MIG]: 'm1' } } }, /x\.txt differs/],
  ];
  for (const [name, opts, reason] of cases) {
    const { control, store } = await controller(); const gh = github(opts);
    await control.process(prEvent(H1), gh.api);
    await control.signoff(sign(H1), gh.api);
    await control.process(groupEvent(C1), gh.api);
    assert.deepEqual(on(gh, C1), ['action_required'], name);
    assert.match(gh.posts.at(-1)!.output.text, reason, name);
    store.db.close();
  }
  // A three-way merge that keeps the base's own change binds.
  const M = sha('5');
  const ok = github({ mergeBase: M, trees: { [M]: { 'README.md': 'r1', 'x.txt': 'x0' }, [H1]: { 'README.md': 'r1', 'x.txt': 'x0', [MIG]: 'm1' } } });
  assert.deepEqual(await bindCandidate(ok.api, { base: BASE, head: H1, candidate: C1 }), []);
});

test('an error in the sign-off lookup never posts success', async () => {
  const cases: [string, Parameters<typeof github>[0], RegExp | null, RegExp][] = [
    ['commit read fails', { fail: /^git\/commits\// }, null, /the sign-off lookup failed/],
    ['head compare fails', { fail: new RegExp(`^compare/${BASE}\\.\\.\\.${H1}$`) }, null, /the sign-off lookup failed/],
    ['head tree truncated', { truncated: H1 }, null, /the sign-off lookup failed/],
    ['storage fails', {}, /^signoff:/, /the sign-off lookup failed/],
    ['recorded head unreadable', {}, /^pr-head:/, /the sign-off lookup failed/],
  ];
  for (const [name, opts, failGet, reason] of cases) {
    const { control, store } = await controller(); const gh = github(opts);
    await control.process(prEvent(H1), gh.api);
    await control.signoff(sign(H1), gh.api);
    store.failGet = failGet;
    await control.process(groupEvent(C1), gh.api);
    assert.deepEqual(on(gh, C1), ['action_required'], name);
    assert.match(gh.posts.at(-1)!.output.text, reason, name);
    store.db.close();
  }
  // A sign-off made under another policy_version does not count.
  const { control, store } = await controller(); const gh = github();
  await control.process(prEvent(H1), gh.api);
  await store.put(signoffKey(42, H1), { pr: 42, head_sha: H1, actor: 'owner-login', policy_version: OTHER, at: 1 });
  await control.process(groupEvent(C1), gh.api);
  assert.deepEqual(on(gh, C1), ['action_required']);
  assert.match(gh.posts.at(-1)!.output.text, /no owner sign-off for #42/);
  await control.process(prEvent(H1, { action: 'reopened' }), gh.api);
  assert.deepEqual(on(gh, H1), ['action_required'], 'and it does not re-post the pull request head');
  // A merge group whose queue branch names no pull request.
  const bare = await controller(); const gh3 = github();
  await bare.control.process(groupEvent(C1, { headRef: 'refs/heads/gh-readonly-queue/main/other' }), gh3.api);
  assert.equal(policyTarget(groupEvent(C1, { headRef: 'refs/heads/gh-readonly-queue/main/other' }))?.pr, null);
  assert.match(gh3.posts[0].output.text, /the queue branch names no pull request/);
  for (const s of [store, bare.store]) s.db.close();
});

test('a label, a comment or an approving review changes nothing', async () => {
  const { control, store } = await controller(); const gh = github();
  await control.process(prEvent(H1), gh.api);
  for (const noise of [
    prEvent(H1, { action: 'labeled' }), prEvent(H1, { action: 'edited' }),
    prEvent(H1, { event: 'issue_comment', action: 'created' }),
    prEvent(H1, { event: 'pull_request_review', action: 'submitted' }),
  ]) await control.process(noise, async () => { throw new Error('noise must call no API'); });
  assert.equal(await store.get(signoffKey(42, H1)), undefined);
  assert.equal(signoffRows(store).length, 0);
  await control.process(groupEvent(C1), gh.api);
  assert.deepEqual([on(gh, H1), on(gh, C1)], [['action_required'], ['action_required']]);
  store.db.close();
});

test('one audit row per sign-off with {pr, head_sha, actor, policy_version, at}; refused calls store nothing', async () => {
  const { control, store } = await controller(); const gh = github();
  assert.deepEqual(await control.signoff(sign(H1), gh.api), { status: 409, error: 'not_current_head' }, 'no head recorded yet');
  await control.process(prEvent(H1), gh.api);
  const first = await control.signoff(sign(H1), gh.api);
  const again = await control.signoff(sign(H1, 'someone-else'), gh.api);
  assert.equal(again.status, 200);
  assert.deepEqual(on(gh, H1), ['action_required', 'success'], 'a repeat posts nothing new');
  const rows = signoffRows(store);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], at: typeof rows[0].at }, { delivery: null, pr: 42, head_sha: H1, actor: 'owner-login', policy_version: POLICY_VERSION, at: 'number' });
  assert.deepEqual(first.status === 200 && first.signoff, { pr: 42, head_sha: H1, actor: 'owner-login', policy_version: POLICY_VERSION, at: rows[0].at });
  assert.throws(() => store.sql.exec("DELETE FROM audit WHERE kind = 'signoff'"), /append-only/);
  // While the kill switch is on, nothing is stored or posted.
  const off = await controller(); const gh2 = github();
  await off.control.process(prEvent(H1), gh2.api);
  await off.control.setKillSwitch(true);
  assert.deepEqual(await off.control.signoff(sign(H1), gh2.api), { status: 409, error: 'kill_switch_on' });
  assert.deepEqual([signoffRows(off.store).length, await off.store.get(signoffKey(42, H1))], [0, undefined]);
  // A merge-group head cannot be signed: it is no pull request head.
  const mg = await controller(); const gh3 = github();
  await mg.control.process(groupEvent(C1), gh3.api);
  await mg.store.put('pr-head:42', { sha: C1, at: 99 });
  assert.deepEqual(await mg.control.signoff(sign(C1), gh3.api), { status: 409, error: 'no_decision' });
  for (const s of [store, off.store, mg.store]) s.db.close();
});

test('POST /signoff: 401 without the owner token, 400 on a bad body, and only the owner reaches the object', async () => {
  const token = randomUUID(); const calls: unknown[] = [];
  const env = { REPOSITORY: repo, OWNER_TOKEN: token,
    REPO_CONTROL: { getByName: () => ({ signoff: async (input: unknown) => { calls.push(input); return { status: 200, signoff: input, posted: true }; } }) } } as unknown as Env;
  const call = (auth: string | null, body: unknown, method = 'POST') => worker.fetch(new Request('https://local/signoff', { method,
    headers: auth ? { authorization: auth } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), env);
  assert.equal((await call(null, sign(H1))).status, 401);
  assert.equal((await call(`Bearer ${randomUUID()}`, sign(H1))).status, 401);
  assert.equal((await call(token, sign(H1))).status, 401, 'the token needs its Bearer scheme');
  assert.equal((await signoffRequest(new Request('https://local/signoff', { method: 'POST', body: JSON.stringify(sign(H1)) }), env)).status, 401, 'the route checks the token itself');
  assert.equal((await worker.fetch(new Request('https://local/signoff', { method: 'POST', body: '{}' }), { ...env, OWNER_TOKEN: undefined } as Env)).status, 401, 'no token configured');
  assert.equal(calls.length, 0);
  for (const bad of [{ ...sign(H1), pr: 0 }, { ...sign(H1), head_sha: 'abc' }, { ...sign(H1), actor: 'not a login' }, [], null]) {
    assert.equal((await call(`Bearer ${token}`, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call(`Bearer ${token}`, null, 'GET')).status, 404);
  const ok = await call(`Bearer ${token}`, sign(H1));
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, [sign(H1)]);
  assert.equal(typeof parseSignoff({ ...sign(H1), pr: 1.5 }), 'string');
});
