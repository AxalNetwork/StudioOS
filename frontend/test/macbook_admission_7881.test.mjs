/** D7881 (#7881): metadata-only Mac admission rejects stale, forked, incomplete and mismatched delegation evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitMacbookJob, githubReadApi } from '../../scripts/ci/macbook-admission.mjs';

const REPO = 'AxalNetwork/StudioOS';
const PREFIX = `/repos/${REPO}`;
const BASE = 'a'.repeat(40);
const PRIOR = 'b'.repeat(40);
const SOURCE = 'c'.repeat(40);
const PR_HEAD = 'd'.repeat(40);
const OTHER = 'e'.repeat(40);
const RUN = `${PREFIX}/actions/runs/500`;
const ATTEMPT = `${RUN}/attempts/2`;
const JOBS = `${ATTEMPT}/jobs?per_page=100`;
const ARTIFACTS = `${RUN}/artifacts?name=suite-plan&per_page=100`;
const repo = () => ({ id: 7, full_name: REPO });
const input = () => ({ repo: REPO, sourceSha: SOURCE, parentRunId: '500', parentRunAttempt: '2', part: 'worker-1-of-6', queueBaseSha: '' });
const run = (overrides = {}) => ({
  id: 500, run_attempt: 2, path: '.github/workflows/ci.yml', event: 'push', status: 'in_progress', conclusion: null,
  head_sha: SOURCE, head_branch: 'main', repository: repo(), head_repository: repo(), ...overrides,
});
const delegatingJob = (overrides = {}) => ({
  id: 900, run_id: 500, run_attempt: 2, head_sha: SOURCE, name: 'suite (worker-1-of-6)',
  status: 'in_progress', conclusion: null,
  steps: [{ name: 'Try the MacBook for one Worker shard', status: 'in_progress', conclusion: null }],
  ...overrides,
});
const artifact = (overrides = {}) => ({
  id: 800, name: 'suite-plan', expired: false, created_at: '2026-11-19T00:00:00Z',
  workflow_run: { id: 500, head_sha: SOURCE, repository_id: 7, head_repository_id: 7 }, ...overrides,
});
const pr = (number, overrides = {}) => ({
  number, state: 'open', base: { ref: 'main', repo: repo() }, head: { sha: PR_HEAD, repo: repo() }, ...overrides,
});
const ref = (name, sha) => ({ ref: `refs/heads/${name}`, object: { type: 'commit', sha } });
const commit = (sha, ...parents) => ({ sha, parents: parents.map((sha) => ({ sha })) });
const compare = (commits) => ({
  status: 'ahead', ahead_by: commits.length, behind_by: 0, total_commits: commits.length,
  base_commit: { sha: BASE }, merge_base_commit: { sha: BASE }, commits,
});

function fixture(event = 'push', entries = 1) {
  const request = input();
  const parent = run();
  const routes = new Map([
    [RUN, parent], [ATTEMPT, parent], [JOBS, { total_count: 1, jobs: [delegatingJob()] }],
    [ARTIFACTS, { total_count: 1, artifacts: [artifact()] }],
  ]);
  let queueRef;
  if (event === 'merge_group') {
    request.queueBaseSha = BASE;
    parent.event = event;
    parent.head_branch = `gh-readonly-queue/main/pr-${entries === 2 ? 102 : 101}-${entries === 2 ? PRIOR : BASE}`;
    queueRef = `${PREFIX}/git/ref/heads/${parent.head_branch}`;
    routes.set(`${PREFIX}/git/ref/heads/main`, ref('main', BASE));
    routes.set(queueRef, ref(parent.head_branch, SOURCE));
    routes.set(`${PREFIX}/compare/${BASE}...${SOURCE}?per_page=100`, compare(entries === 2
      ? [commit(PRIOR, BASE), commit(SOURCE, PRIOR)] : [commit(SOURCE, BASE)]));
    routes.set(`${PREFIX}/pulls/101`, pr(101));
    if (entries === 2) {
      routes.set(`${PREFIX}/pulls/102`, pr(102));
      routes.set(`${PREFIX}/actions/runs?event=merge_group&head_sha=${PRIOR}&per_page=100`, {
        total_count: 1,
        workflow_runs: [run({ id: 499, event: 'merge_group', head_sha: PRIOR, head_branch: `gh-readonly-queue/main/pr-101-${BASE}` })],
      });
    }
  }
  const calls = [];
  const api = async (method, path, body, options) => {
    calls.push({ method, path, body, signal: options?.signal });
    assert.equal(method, 'GET', 'admission may only read GitHub metadata');
    assert.equal(body, undefined, 'admission never sends mutation bodies');
    assert.ok(routes.has(path), `unexpected metadata request: ${path}`);
    const value = routes.get(path);
    if (value instanceof Error) throw value;
    return structuredClone(typeof value === 'function' ? value(calls) : value);
  };
  return { request, parent, routes, calls, api, queueRef, check: (options = {}) => admitMacbookJob(request, { api, ...options }) };
}

test('a trusted main push is bound to source, active attempt and immutable exact parent plan', async () => {
  const f = fixture();
  const result = await f.check();
  assert.deepEqual(result, {
    allowed: true, reason: 'trusted_main_push', source_sha: SOURCE, parent_event: 'push', source_ref: 'refs/heads/main',
    parent_run_id: '500', parent_run_attempt: '2', queue_base_sha: '', plan_mode: 'parent-artifact', plan_artifact_id: '800',
  });
  assert.equal(f.calls.filter((call) => call.path === RUN).length, 2, 'recheck parent immediately before allowing');
  assert.equal(f.calls.filter((call) => call.path === JOBS).length, 2, 'the exact delegating step must remain active');
  assert.ok(f.calls.some((call) => call.path === ATTEMPT));
  assert.ok(f.calls.some((call) => call.path === ARTIFACTS));
});

test('malformed IDs, SHA, repository and part are denied before any API call', async () => {
  for (const patch of [
    { sourceSha: `${SOURCE}\nallowed=true` }, { sourceSha: 'HEAD' }, { sourceSha: SOURCE.toUpperCase() },
    { parentRunId: '../500' }, { parentRunId: '0' }, { parentRunAttempt: '2.0' }, { parentRunAttempt: '' },
    { repo: 'outsider/StudioOS' }, { part: 'rest' }, { part: 'worker-2-of-6' }, { queueBaseSha: 'main' },
  ]) {
    const f = fixture();
    Object.assign(f.request, patch);
    const result = await f.check();
    assert.equal(result.allowed, false, JSON.stringify(patch));
    assert.equal(f.calls.length, 0, JSON.stringify(patch));
    assert.ok(Object.values(result).every((value) => !String(value).includes('\n')), 'rejected input cannot inject step outputs');
  }
});

test('unknown or mismatched attempts fail closed', async () => {
  for (const attempt of [new Error('404 missing attempt'), run({ run_attempt: 1 }), run({ head_sha: OTHER }), run({ head_branch: 'other' })]) {
    const f = fixture();
    f.routes.set(ATTEMPT, attempt);
    assert.equal((await f.check()).allowed, false);
  }
  const f = fixture();
  f.parent.run_attempt = 3;
  assert.equal((await f.check()).reason, 'parent_attempt_mismatch');
});

test('wrong source, path, repository, ref and terminal parent cannot delegate', async () => {
  for (const patch of [
    { head_sha: OTHER }, { path: '.github/workflows/not-ci.yml' },
    { path: '.github/workflows/ci.yml@refs/heads/main' }, { head_branch: 'ci/fake' },
    { repository: { id: 8, full_name: 'outsider/StudioOS' } },
    { head_repository: { id: 8, full_name: 'outsider/StudioOS' } },
    { head_repository: null }, { status: 'completed', conclusion: 'success' },
  ]) {
    const f = fixture();
    Object.assign(f.parent, patch);
    assert.equal((await f.check()).allowed, false, JSON.stringify(patch));
  }
});

test('all pull-request events stay hosted, including same-repository PRs', async () => {
  for (const event of ['pull_request', 'pull_request_target', 'workflow_dispatch']) {
    const f = fixture();
    f.parent.event = event;
    assert.equal((await f.check()).reason, 'parent_event_not_allowed');
  }
});

test('an unrelated active workflow job cannot admit a manual or late Mac dispatch', async () => {
  for (const jobs of [
    [], [delegatingJob({ name: 'suite (worker-2-of-6)' })],
    [delegatingJob(), delegatingJob({ id: 901 })],
    [delegatingJob({ run_id: 501 })], [delegatingJob({ run_attempt: 1 })],
    [delegatingJob({ head_sha: OTHER })],
    [delegatingJob({ status: 'completed', conclusion: 'success' })],
  ]) {
    const f = fixture();
    f.routes.set(JOBS, { total_count: jobs.length, jobs });
    assert.equal((await f.check()).allowed, false);
    assert.ok(!f.calls.some((call) => call.path === ARTIFACTS), 'deny before more expensive admission work');
  }
});

test('the exact Mac delegation step must exist once and still be in progress', async () => {
  for (const steps of [
    [], [{ name: 'Run normal hosted shard', status: 'in_progress', conclusion: null }],
    [{ name: 'Try the MacBook for one Worker shard', status: 'completed', conclusion: 'success' }],
    [{ name: 'Try the MacBook for one Worker shard', status: 'completed', conclusion: 'cancelled' }],
    [{ name: 'Try the MacBook for one Worker shard', status: 'pending', conclusion: null }],
    [...delegatingJob().steps, ...delegatingJob().steps],
  ]) {
    const f = fixture();
    f.routes.set(JOBS, { total_count: 1, jobs: [delegatingJob({ steps })] });
    assert.equal((await f.check()).allowed, false);
  }
});

test('missing, incomplete or unavailable attempt job evidence fails closed', async () => {
  for (const page of [
    { total_count: 2, jobs: [delegatingJob()] }, { total_count: 101, jobs: [delegatingJob()] },
    { total_count: 1 }, new Error('attempt jobs unavailable'),
  ]) {
    const f = fixture();
    f.routes.set(JOBS, page);
    assert.equal((await f.check()).allowed, false);
  }
});

test('a completed or replaced delegation step at the final read denies admission', async () => {
  for (const replacement of [
    delegatingJob({ steps: [{ name: 'Try the MacBook for one Worker shard', status: 'completed', conclusion: 'success' }] }),
    delegatingJob({ status: 'completed', conclusion: 'cancelled' }),
    delegatingJob({ id: 901 }), delegatingJob({ run_attempt: 3 }),
  ]) {
    const f = fixture('merge_group');
    f.routes.set(JOBS, (calls) => ({
      total_count: 1,
      jobs: [calls.filter((call) => call.path === JOBS).length === 1 ? delegatingJob() : replacement],
    }));
    assert.equal((await f.check()).allowed, false);
    assert.equal(f.calls.filter((call) => call.path === JOBS).length, 2);
    assert.ok(f.calls.some((call) => call.path === `${PREFIX}/pulls/101`), 'the first check passed and provenance was read');
  }
});

test('push plan must be unique, nonexpired, and tied to the same repository/run/head', async () => {
  for (const artifacts of [
    [], [artifact({ expired: true })], [artifact(), artifact({ id: 801 })],
    [artifact({ workflow_run: { id: 501, head_sha: SOURCE, repository_id: 7, head_repository_id: 7 } })],
    [artifact({ workflow_run: { id: 500, head_sha: OTHER, repository_id: 7, head_repository_id: 7 } })],
    [artifact({ workflow_run: { id: 500, head_sha: SOURCE, repository_id: 7, head_repository_id: 8 } })],
  ]) {
    const f = fixture();
    f.routes.set(ARTIFACTS, { total_count: artifacts.length, artifacts });
    assert.equal((await f.check()).allowed, false);
  }
  const f = fixture();
  f.routes.set(ARTIFACTS, { total_count: 101, artifacts: [artifact()] });
  assert.equal((await f.check()).reason, 'incomplete_parent_artifacts');
});

test('a parent finishing or rerunning during admission is rejected', async () => {
  for (const patch of [{ status: 'completed', conclusion: 'cancelled' }, { run_attempt: 3 }]) {
    const f = fixture();
    f.routes.set(RUN, (calls) => calls.filter((call) => call.path === RUN).length === 1 ? f.parent : { ...f.parent, ...patch });
    assert.equal((await f.check()).allowed, false);
  }
});

test('one authenticated squash queue entry uses equal weights without downloading a parent plan', async () => {
  const f = fixture('merge_group');
  const result = await f.check();
  assert.equal(result.allowed, true);
  assert.equal(result.parent_event, 'merge_group');
  assert.equal(result.source_ref, `refs/heads/${f.parent.head_branch}`);
  assert.equal(result.queue_base_sha, BASE);
  assert.equal(result.plan_mode, 'equal-weights');
  assert.equal(result.plan_artifact_id, '');
  assert.ok(!f.calls.some((call) => call.path.includes('/artifacts')));
});

test('every earlier squash entry is authenticated; a fork in the first PR rejects the entire group', async () => {
  const f = fixture('merge_group', 2);
  assert.equal((await f.check()).allowed, true);
  assert.ok(f.calls.some((call) => call.path === `${PREFIX}/pulls/101`));
  assert.ok(f.calls.some((call) => call.path === `${PREFIX}/pulls/102`));
  f.routes.set(`${PREFIX}/pulls/101`, pr(101, { head: { sha: PR_HEAD, repo: { id: 8, full_name: 'outsider/StudioOS' } } }));
  const result = await f.check();
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'queue_pull_request_not_same_repository');
});

test('missing/deleted head repository or a non-main base rejects queue provenance', async () => {
  for (const patch of [
    { head: { sha: PR_HEAD, repo: null } }, { base: { ref: 'staging', repo: repo() } },
    { base: { ref: 'main', repo: { id: 8, full_name: 'outsider/StudioOS' } } }, { state: 'closed' },
  ]) {
    const f = fixture('merge_group');
    f.routes.set(`${PREFIX}/pulls/101`, pr(101, patch));
    assert.equal((await f.check()).reason, 'queue_pull_request_not_same_repository');
  }
});

test('a queue branch alone is not evidence for an earlier constituent', async () => {
  const path = `${PREFIX}/actions/runs?event=merge_group&head_sha=${PRIOR}&per_page=100`;
  for (const page of [
    { total_count: 0, workflow_runs: [] },
    { total_count: 1, workflow_runs: [run({ event: 'push', head_sha: PRIOR })] },
    { total_count: 1, workflow_runs: [run({ event: 'merge_group', path: '.github/workflows/gitleaks.yml', head_sha: PRIOR })] },
    { total_count: 101, workflow_runs: [] },
  ]) {
    const f = fixture('merge_group', 2);
    f.routes.set(path, page);
    assert.equal((await f.check()).allowed, false);
  }
});

test('authenticated run branch must bind the actual first parent, and cannot ambiguously name two PRs', async () => {
  const f = fixture('merge_group', 2);
  const path = `${PREFIX}/actions/runs?event=merge_group&head_sha=${PRIOR}&per_page=100`;
  f.routes.set(path, { total_count: 1, workflow_runs: [run({ event: 'merge_group', head_sha: PRIOR, head_branch: `gh-readonly-queue/main/pr-101-${OTHER}` })] });
  assert.equal((await f.check()).reason, 'queue_run_parent_mismatch');
  f.routes.set(path, { total_count: 2, workflow_runs: [101, 103].map((number) => run({ event: 'merge_group', head_sha: PRIOR, head_branch: `gh-readonly-queue/main/pr-${number}-${BASE}` })) });
  assert.equal((await f.check()).reason, 'ambiguous_queue_entry');
});

test('comparison must be complete, bounded, and descend from the exact current main', async () => {
  for (const patch of [
    { status: 'diverged', behind_by: 1 }, { merge_base_commit: { sha: OTHER } }, { base_commit: { sha: OTHER } },
    { total_commits: 2 }, { total_commits: 101 }, { ahead_by: 2 }, { commits: [] },
    { commits: [commit(SOURCE, BASE), commit(SOURCE, BASE)], total_commits: 2, ahead_by: 2 },
  ]) {
    const f = fixture('merge_group');
    f.routes.set(`${PREFIX}/compare/${BASE}...${SOURCE}?per_page=100`, { ...compare([commit(SOURCE, BASE)]), ...patch });
    assert.equal((await f.check()).allowed, false, JSON.stringify(patch));
  }
});

test('uncovered graph nodes and a first-parent chain that misses main are rejected', async () => {
  for (const commits of [[commit(OTHER, BASE), commit(SOURCE, BASE)], [commit(SOURCE, OTHER)]]) {
    const f = fixture('merge_group');
    if (commits.length === 1) {
      f.parent.head_branch = `gh-readonly-queue/main/pr-101-${OTHER}`;
      f.routes.set(`${PREFIX}/git/ref/heads/${f.parent.head_branch}`, ref(f.parent.head_branch, SOURCE));
    }
    f.routes.set(`${PREFIX}/compare/${BASE}...${SOURCE}?per_page=100`, compare(commits));
    assert.equal((await f.check()).allowed, false);
  }
});

test('merge-style queue entries verify the actual PR head and account for its branch history', async () => {
  const f = fixture('merge_group');
  f.routes.set(`${PREFIX}/compare/${BASE}...${SOURCE}?per_page=100`, compare([commit(PR_HEAD, BASE), commit(SOURCE, BASE, PR_HEAD)]));
  assert.equal((await f.check()).allowed, true);
  f.routes.set(`${PREFIX}/pulls/101`, pr(101, { head: { sha: OTHER, repo: repo() } }));
  assert.equal((await f.check()).reason, 'queue_pull_request_head_changed');
});

test('original queue event base must be a proved first-parent chain node, not an arbitrary SHA', async () => {
  const f = fixture('merge_group', 2);
  f.request.queueBaseSha = PRIOR;
  assert.equal((await f.check()).allowed, true);
  f.request.queueBaseSha = OTHER;
  assert.equal((await f.check()).reason, 'queue_event_base_not_proven');
  f.request.queueBaseSha = '';
  assert.equal((await f.check()).reason, 'missing_queue_base_sha');
  const push = fixture();
  push.request.queueBaseSha = BASE;
  assert.equal((await push.check()).reason, 'unexpected_queue_base_sha');
});

test('live source ref and main are rechecked after provenance reads', async () => {
  for (const changeMain of [false, true]) {
    const f = fixture('merge_group');
    const path = changeMain ? `${PREFIX}/git/ref/heads/main` : f.queueRef;
    const name = changeMain ? 'main' : f.parent.head_branch;
    f.routes.set(path, (calls) => ref(name, calls.filter((call) => call.path === path).length > 1 ? OTHER : changeMain ? BASE : SOURCE));
    const result = await f.check();
    assert.equal(result.allowed, false);
    assert.equal(result.reason, changeMain ? 'main_changed_during_admission' : 'queue_ref_changed');
  }
});

test('API failures and cancellation never admit a job or expose API error bodies', async () => {
  const f = fixture();
  f.routes.set(ARTIFACTS, new Error('private credential should not be logged'));
  const denied = await f.check();
  assert.equal(denied.reason, 'github_api_unavailable');
  assert.ok(!JSON.stringify(denied).includes('credential'));
  const controller = new AbortController();
  controller.abort();
  const cancelled = fixture();
  assert.equal((await cancelled.check({ signal: controller.signal })).reason, 'admission_cancelled');
  assert.equal(cancelled.calls.length, 0);
});

test('HTTP adapter permits only metadata GETs to this repository, including triple-dot comparison', async () => {
  const calls = [];
  const api = githubReadApi('test-only-token', async (...args) => {
    calls.push(args);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const path = `${PREFIX}/compare/${BASE}...${SOURCE}?per_page=100`;
  assert.deepEqual(await api('GET', path), { ok: true });
  assert.equal(calls[0][0], `https://api.github.com${path}`);
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].method, 'GET');
  await assert.rejects(api('POST', RUN));
  await assert.rejects(api('GET', '/repos/outsider/StudioOS/actions/runs/500'));
  await assert.rejects(api('GET', `${PREFIX}/../other`));
  await assert.rejects(githubReadApi('', async () => { throw new Error('must not fetch'); })('GET', RUN));
  assert.equal(calls.length, 1);
});
