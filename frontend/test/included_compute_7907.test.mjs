/** D7907 (#7907): the github-8 included-compute pool at the catalog, admission and executor boundaries, and the bounded canary.
 *
 * From frontend/test/README.md (moved by #6472): D7907: the github-8 included-compute pool at the
 * catalog, bootstrap, admission and executor boundaries, equal budgets, and the bounded canary's
 * source pin, report and workflow shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
import { EXECUTION_BUDGETS, INCLUDED_TARGET, PROFILES, executionTarget } from '../../scripts/ci/runner-admission.mjs';
import { verifyRuntime } from '../../scripts/ci/runner-execution.mjs';
import { JOB_NAMES, LANES, canaryReport, laneEvidence, main, planDigest, verifySource } from '../../scripts/ci/included-compute-canary.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const catalog = () => JSON.parse(read('scripts/ci/runners/profiles.json'));
const EXECUTOR = read('.github/workflows/runner-executor.yml');
const CANARY = read('.github/workflows/included-compute-canary.yml');
const POLICY = read('merge-control/src/lib/ciCapacityPolicy.ts');

test('the real catalog resolves github-8 to group 6 and its one label, separate from the self-hosted pool', () => {
  const p = resolveCatalogProfile('github-8');
  assert.deepEqual(executionTarget(p), { group: 'StudioOS Included Compute', labels: ['studioos-bench-linux-8'] });
  assert.equal(p.approvedGroupId, 6);
  assert.deepEqual(p.eligibleShards, Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`));
  assert.equal(p.platform, 'linux'); assert.equal(p.arch, 'x64');
  assert.deepEqual(verifyRuntime(p, { platform: 'linux', arch: 'x64', node: p.nodeVersion, sqlite: () => true }), { platform: 'linux', arch: 'x64', node: p.nodeVersion });
  assert.notEqual(catalog().profiles['github-8'].runner_group, catalog().self_hosted_group);
  for (const id of ['linux-x64', 'macos-arm64']) {
    const selfHosted = resolveCatalogProfile(id);
    assert.equal(selfHosted.approvedGroupId, 5);
    assert.equal(executionTarget(selfHosted).group, 'StudioOS Worker Pool');
  }
});

test('included-compute approval does not authorize an unverified self-hosted catalog', () => {
  const c = catalog(); c.self_hosted_group_id = null;
  assert.equal(resolveCatalogProfile('github-8', c).approvedGroupId, 6);
  for (const id of ['linux-x64', 'macos-arm64']) assert.throws(() => resolveCatalogProfile(id, c), /approved_group_unverified/);
});

test('a changed group, label, pool or platform for github-8 is refused at translation and at admission', () => {
  const mutations = [
    [(c) => { c.profiles['github-8'].runner_group_id = 5; }, /invalid_included_target/],
    [(c) => { c.profiles['github-8'].runner_group_id = '6'; }, /included_group_unverified/],
    [(c) => { c.profiles['github-8'].runner_label = 'ubuntu-latest'; }, /invalid_included_target/],
    [(c) => { c.profiles['github-8'].runner_group = c.self_hosted_group; }, /included_group_unverified/],
    [(c) => { c.profiles['github-8'].runner_group = 'StudioOS Linux Workers'; }, /invalid_included_target/],
    [(c) => { c.profiles['github-8'].pool = 'self-hosted'; }, /invalid_profile_pool/],
    [(c) => { c.profiles['github-8'].github_arch = 'ARM64'; }, /profile_platform_mismatch/],
    [(c) => { c.profiles['github-8'].node_version = 'latest'; }, /profile_runtime_not_pinned/],
    [(c) => { c.profiles['github-8'].eligibleShards = ['worker-7-of-6']; }, /invalid_profile_shards/],
    [(c) => { delete c.profiles['github-8']; }, /invalid_profile_shards/],
  ];
  for (const [mutate, reason] of mutations) { const c = catalog(); mutate(c); assert.throws(() => resolveCatalogProfile('github-8', c), reason); }
  const p = resolveCatalogProfile('github-8');
  assert.throws(() => executionTarget({ ...p, target: { group: INCLUDED_TARGET.group, labels: ['studioos-bench-linux-8', 'self-hosted'] } }), /invalid_included_target/);
  assert.throws(() => executionTarget({ ...p, approvedGroupId: null }), /invalid_included_target/);
});

test('bootstrap accepts the four-profile catalog but never registers github-8 as a self-hosted machine', () => {
  const script = fileURLToPath(new URL('../../scripts/ci/runners/bootstrap.sh', import.meta.url));
  const profiles = fileURLToPath(new URL('../../scripts/ci/runners/profiles.json', import.meta.url));
  const python = readFileSync(script, 'utf8').split('# PYTHON_BEGIN\n')[1].split('# PYTHON_END')[0];
  const body = `
import types,json,copy
from pathlib import Path
b=types.ModuleType('fixture_bootstrap')
exec(${JSON.stringify(python)}, b.__dict__)
r=b.load_registry(Path(${JSON.stringify(profiles)}))
def refuses(fn, reason):
  try: fn()
  except b.Refusal as e: assert reason in str(e),str(e)
  else: raise AssertionError('expected refusal: '+reason)
assert r['profiles']['github-8']['runner_group_id']==6
refuses(lambda:b.select_profile(r,'github-8','Linux','x86_64'),'not_a_registration_target')
raw=json.loads(Path(${JSON.stringify(profiles)}).read_text())
for key,value in [('runner_group_id',5),('runner_label','ubuntu-latest'),('pool','self-hosted'),('runner_group',raw['self_hosted_group'])]:
  bad=copy.deepcopy(raw);bad['profiles']['github-8'][key]=value
  path=Path(${JSON.stringify(profiles)}+'.'+key+'.json')
  b.json_file=lambda _p,_bad=bad:_bad
  refuses(lambda:b.load_registry(path),'included_pool_must_remain_separate')
# Choosing group 6 as the self-hosted group would merge the pools, so it is refused too.
bad=copy.deepcopy(raw);bad['self_hosted_group']='StudioOS Included Compute'
b.json_file=lambda _p,_bad=bad:_bad
refuses(lambda:b.load_registry(Path('merged.json')),'included_pool_must_remain_separate')
`;
  const result = spawnSync('python3', ['-c', body], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('the coordinator, admission and executor carry one budget per profile, and the included budget leaves hosted fallback room', () => {
  assert.deepEqual([...PROFILES].sort(), ['github-8', 'hosted', 'linux-x64', 'macos-arm64']);
  const minutes = (pattern) => Number(pattern.exec(POLICY)?.[1]);
  assert.equal(EXECUTION_BUDGETS['github-8'].startMs, minutes(/includedStartMs: (\d+) \* 60_000/) * 60000);
  assert.equal(EXECUTION_BUDGETS['github-8'].executionMs, minutes(/includedExecutionMs: (\d+) \* 60_000/) * 60000);
  assert.ok(EXECUTION_BUDGETS['github-8'].testMinutes * 60000 > EXECUTION_BUDGETS['github-8'].executionMs);
  assert.ok(EXECUTION_BUDGETS['github-8'].jobMinutes > EXECUTION_BUDGETS['github-8'].testMinutes);
  const job = /timeout-minutes: \$\{\{ inputs\.profile == 'hosted' && (\d+) \|\| inputs\.profile == 'github-8' && (\d+) \|\| (\d+) \}\}/g;
  const [jobs, tests] = [...EXECUTOR.matchAll(job)].map((m) => m.slice(1).map(Number));
  assert.deepEqual(jobs, [EXECUTION_BUDGETS.hosted.jobMinutes, EXECUTION_BUDGETS['github-8'].jobMinutes, EXECUTION_BUDGETS['linux-x64'].jobMinutes]);
  assert.deepEqual(tests, [EXECUTION_BUDGETS.hosted.testMinutes, EXECUTION_BUDGETS['github-8'].testMinutes, EXECUTION_BUDGETS['linux-x64'].testMinutes]);
  assert.equal(EXECUTION_BUDGETS['linux-x64'].jobMinutes, EXECUTION_BUDGETS['macos-arm64'].jobMinutes);
  assert.ok(EXECUTOR.includes(`inputs.profile == 'github-8' && '${JSON.stringify(executionTarget(resolveCatalogProfile('github-8')))}'`));
  assert.match(EXECUTOR, /options: \[hosted, github-8, linux-x64, macos-arm64\]/);
});

test('the canary runs only a commit already on main', () => {
  const sha = 'a'.repeat(40);
  assert.equal(verifySource(sha, { status: 'ahead', base_commit: { sha }, merge_base_commit: { sha } }), sha);
  assert.equal(verifySource(sha, { status: 'identical', base_commit: { sha }, merge_base_commit: { sha } }), sha);
  for (const compare of [{ status: 'behind', base_commit: { sha }, merge_base_commit: { sha } },
    { status: 'diverged', base_commit: { sha }, merge_base_commit: { sha: 'b'.repeat(40) } },
    { status: 'ahead', base_commit: { sha }, merge_base_commit: { sha: 'b'.repeat(40) } }, null]) {
    assert.throws(() => verifySource(sha, compare), /source_not_on_main/);
  }
  for (const bad of ['main', 'A'.repeat(40), `${sha}\nx`, '']) assert.throws(() => verifySource(bad, null), /source_sha_invalid/);
});

const SHA = 'c'.repeat(40), PART = 'worker-3-of-6';
const DIGEST = planDigest('{"plan":1}\n');
const evidence = (lane, patch = {}) => ({ ...laneEvidence({ lane, part: PART, sourceSha: SHA, digest: DIGEST,
  env: { RUNNER_NAME: `${lane}-runner`, GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '1' },
  startedAt: 0, finishedAt: lane === 'github-8' ? 900_000 : 1_800_000, exitCode: 0, cpus: lane === 'github-8' ? 8 : 4, memoryBytes: 1 }), ...patch });
const job = (lane, patch = {}) => ({ name: JOB_NAMES[lane], created_at: '2026-11-21T00:00:00Z', started_at: '2026-11-21T00:00:30Z',
  completed_at: '2026-11-21T00:20:30Z', conclusion: 'success', ...patch });

test('the canary report compares the two lanes and says "Not recorded" for anything nobody measured', () => {
  const ok = canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: LANES.map((l) => evidence(l)), jobs: LANES.map((l) => job(l)) });
  assert.equal(ok.ok, true);
  assert.match(ok.markdown, /\| github-8 \| github-8-runner \| 8 \| 30 s \| 1200 s \| 900 s \| 0 \| success \|/);
  assert.match(ok.markdown, /github-8 against hosted: 0\.50×/);
  assert.match(ok.markdown, /overage: Not recorded/);
  const missing = canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: [evidence('hosted')], jobs: [job('hosted')] });
  assert.equal(missing.ok, false);
  assert.match(missing.markdown, /\| github-8 \| Not recorded \| Not recorded \| Not recorded \| Not recorded \| Not recorded \| Not recorded \| Not recorded \|/);
  assert.match(missing.markdown, /against hosted: Not recorded\./);
  assert.doesNotMatch(missing.markdown, /\| 0 s \|/);
});

test('the canary refuses to compare lanes that ran a different source, part or plan, and fails on any lane failure', () => {
  for (const patch of [{ sourceSha: 'd'.repeat(40) }, { part: 'worker-4-of-6' }, { planDigest: planDigest('other') }]) {
    const r = canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: [evidence('github-8', patch), evidence('hosted')], jobs: LANES.map((l) => job(l)) });
    assert.equal(r.ok, false); assert.match(r.markdown, /Refused/);
  }
  assert.equal(canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: [evidence('github-8', { exitCode: 1 }), evidence('hosted')], jobs: LANES.map((l) => job(l)) }).ok, false);
  assert.equal(canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: LANES.map((l) => evidence(l)), jobs: [job('github-8', { conclusion: 'cancelled' }), job('hosted')] }).ok, false);
  assert.equal(canaryReport({ sourceSha: SHA, part: PART, digest: DIGEST, evidence: [...LANES.map((l) => evidence(l)), evidence('hosted')], jobs: LANES.map((l) => job(l)) }).ok, false);
  assert.throws(() => laneEvidence({ lane: 'linux-x64', part: PART, sourceSha: SHA, digest: DIGEST, env: {} }), /evidence_identity_invalid/);
});

test('the canary CLI refuses another repository, an unknown part and a commit off main before anything runs', async () => {
  const env = { GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', PART, SOURCE_SHA: SHA };
  await assert.rejects(main('pin', { ...env, GITHUB_REPOSITORY: 'someone/fork' }, { fetchJson: async () => ({}) }), /wrong_repository/);
  await assert.rejects(main('pin', { ...env, PART: 'rest' }, { fetchJson: async () => ({}) }), /part_invalid/);
  await assert.rejects(main('pin', env, { fetchJson: async () => ({ status: 'diverged' }) }), /source_not_on_main/);
  assert.equal(await main('pin', env, { fetchJson: async (path) => { assert.equal(path, `/compare/${SHA}...main?per_page=1`); return { status: 'ahead', base_commit: { sha: SHA }, merge_base_commit: { sha: SHA } }; } }), 0);
});

test('the canary workflow is operator-dispatched from main, read-only, secret-free and fixed to two targets', () => {
  assert.match(CANARY, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(CANARY, /^ {2}(push|pull_request|pull_request_target|merge_group|schedule|workflow_run|workflow_call):/m);
  assert.match(CANARY, /if: github\.repository == 'AxalNetwork\/StudioOS' && github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(CANARY, /secrets\.|secrets: inherit|: write/);
  assert.equal([...CANARY.matchAll(/persist-credentials: false/g)].length, [...CANARY.matchAll(/actions\/checkout@/g)].length);
  for (const [, ref] of CANARY.matchAll(/uses: [^@\s]+@(\S+)/g)) assert.match(ref, /^[a-f0-9]{40}$/);
  assert.match(CANARY, /lane: \[github-8, hosted\]/);
  assert.ok(CANARY.includes(`runs-on: \${{ fromJSON(matrix.lane == 'github-8' && '${JSON.stringify(executionTarget(resolveCatalogProfile('github-8')))}' || '"ubuntu-latest"') }}`));
  assert.doesNotMatch(CANARY, /runs-on: \$\{\{[^}]*inputs\./);
  // Every job and the test step are bounded; no dispatch value is expanded inside a shell line.
  assert.equal([...CANARY.matchAll(/^ {4}timeout-minutes: \d+$/gm)].length, 3);
  assert.match(CANARY, /- name: Run the pinned Worker shard\n {8}timeout-minutes: 40\n/);
  for (const [, line] of CANARY.matchAll(/^\s+run: (.*)$/gm)) assert.doesNotMatch(line, /\$\{\{/);
  assert.match(CANARY, /cancel-in-progress: false/);
});
