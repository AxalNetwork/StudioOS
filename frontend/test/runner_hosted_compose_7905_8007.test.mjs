/** #7905 × #8007 composition: S09's executor wiring driving S30's accepted hosted-verification adapter (ab9903c2). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitRunnerJob } from '../../scripts/ci/runner-admission.mjs';
import { requireExecutionBoundary } from '../../scripts/ci/runner-execution.mjs';
import { isolationFor, hostedExecutorDependencies, hostedReaders } from '../../scripts/ci/runners/executor-isolation.mjs';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';
import { createHostedVerification } from '../../scripts/ci/runners/hosted-verification.mjs';

const NOW = 1_800_000_000_000, REPO = 'AxalNetwork/StudioOS', PREFIX = '/repos/' + REPO;
const SHA = 'a'.repeat(40), EXEC = 'e'.repeat(40), MAIN = 'b'.repeat(40), DIGEST = 'sha256:' + '1'.repeat(64);
const copy = v => structuredClone(v);

/** SIMULATED trusted-reader outputs in S30's documented shapes; never live provenance, boundary or billing evidence. */
function world(id) {
  const receipt = { version: 1, requestId: 'compose-7905', repository: REPO, logicalShard: 'worker-1-of-6', event: 'push',
    parentRunId: 101, parentAttempt: 1, parentWorkflowId: 77, sourceSha: SHA, queueBaseSha: null, planDigest: DIGEST,
    planArtifactId: 505, executorSha: EXEC, profile: id, generation: 3, childRunId: 202, childAttempt: 1,
    startDeadline: NOW + 60_000, executionDeadline: NOW + 1_000_000 };
  const repo = { id: 1191713997, full_name: REPO };
  const run = { id: 202, run_attempt: 1, workflow_id: 88, path: '.github/workflows/runner-executor.yml', head_sha: EXEC,
    head_branch: 'main', event: 'workflow_dispatch', status: 'in_progress', conclusion: null, repository: repo, head_repository: repo };
  const job = { id: 909, run_id: 202, run_attempt: 1, head_sha: EXEC, name: 'Admitted Worker shard', status: 'in_progress', conclusion: null,
    started_at: new Date(NOW - 1).toISOString(), check_run_url: `https://api.github.com/repos/${REPO}/check-runs/909`,
    labels: id === 'hosted' ? ['ubuntu-latest'] : ['studioos-bench-linux-8'],
    ...(id === 'github-8' ? { runner_group_id: 6, runner_group_name: 'StudioOS Included Compute' } : {}) };
  const claims = { repository: REPO, repository_id: String(repo.id), run_id: '202', run_attempt: '1', runner_environment: 'github-hosted',
    sha: EXEC, workflow_sha: EXEC, workflow_ref: `${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`,
    event_name: 'workflow_dispatch', ref: 'refs/heads/main', check_run_id: '909' };
  const doc = extra => ({ binding: copy(receipt), observedAt: NOW, ...extra });
  const readers = {
    now: () => NOW,
    readProvenance: async () => doc({ claims, run, job }),
    readBoundary: async () => doc({ kind: 'trusted-native-inspection', policyDigest: DIGEST, jobId: 909, instanceId: 'simulated-boundary',
      scope: 'dependency-install-and-tests', deniesRunnerAgent: true, deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: true }),
    // #8345: admission (before checkout) reads boundary READINESS only; no instance exists yet.
    readBoundaryReadiness: async () => doc({ kind: 'trusted-native-readiness', policyDigest: DIGEST, jobId: 909,
      scope: 'dependency-install-and-tests', deniesRunnerAgent: true, deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: true }),
    readIncludedEligibility: async () => doc({ jobId: 909, runnerGroupId: 6, provider: 'github-hosted', billingLane: 'included-compute',
      reservation: 'active', overageAllowed: false, stopAtLimitVerified: true, validUntil: NOW + 60_000 }),
  };
  const context = { repository: REPO, executorSha: EXEC, childWorkflowSha: EXEC, childWorkflowPath: '.github/workflows/runner-executor.yml', childRunId: '202', childAttempt: '1' };
  const parent = { id: 101, run_attempt: 1, workflow_id: 77, path: '.github/workflows/ci.yml', head_sha: SHA, status: 'completed', conclusion: 'success',
    event: 'push', head_branch: 'main', repository: repo, head_repository: repo };
  const api = new Map([
    [PREFIX + '/actions/runs/101', parent], [PREFIX + '/actions/runs/101/attempts/1', parent], [PREFIX + '/actions/runs/202', run],
    [PREFIX + '/actions/workflows/runner-executor.yml', { id: 88, path: '.github/workflows/runner-executor.yml', state: 'active' }],
    [PREFIX + '/git/ref/heads/main', { ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } }],
    [PREFIX + `/compare/${EXEC}...${MAIN}?per_page=100`, { status: 'ahead', base_commit: { sha: EXEC }, merge_base_commit: { sha: EXEC } }],
    [PREFIX + '/actions/runs/101/artifacts?name=suite-plan&per_page=100', { total_count: 1, artifacts: [
      { id: 505, name: 'suite-plan', expired: false, workflow_run: { id: 101, head_sha: SHA, repository_id: repo.id, head_repository_id: repo.id } }] }],
  ]);
  // The REAL catalog profile, not a hand-built one: the adapter must accept what S09's resolver produces.
  const profile = resolveCatalogProfile(id), missing = [];
  const admit = verifyIsolation => admitRunnerJob({ requestId: receipt.requestId, generation: 3, shard: receipt.logicalShard, profile: id }, {
    context, phase: 'execute', now: () => NOW, readReceipt: async () => ({ active: true, receipt: copy(receipt) }),
    resolveProfile: async pid => resolveCatalogProfile(pid),
    api: async (method, path) => { assert.equal(method, 'GET'); if (!api.has(path)) { missing.push(path); throw new Error('unserved'); } return copy(api.get(path)); }, verifyIsolation });
  return { receipt, context, profile, readers, admit, missing, args: { receipt, context, profile, phase: 'execute' } };
}

test('compose: the real S30 module loads through S09 wiring and, with no trusted readers, every hosted admission refuses', async () => {
  for (const id of ['hosted', 'github-8']) {
    const w = world(id);
    const deps = isolationFor(id);
    assert.deepEqual(Object.keys(deps), ['admissionIsolation']);
    assert.equal(await deps.admissionIsolation(w.args), false, `${id}: default composition has no positive reader`);
    assert.equal((await admitRunnerJob({ requestId: w.receipt.requestId, generation: 3, shard: w.receipt.logicalShard, profile: id }, {
      context: w.context, phase: 'execute', now: () => NOW, readReceipt: async () => ({ active: true, receipt: copy(w.receipt) }),
      resolveProfile: async pid => resolveCatalogProfile(pid), api: async () => { throw new Error('unreached'); }, verifyIsolation: deps.admissionIsolation })).reason,
    'execution_isolation_unverified');
    // The adapter itself names why: the S09 composition supplies no provenance reader.
    assert.deepEqual(await createHostedVerification({ now: () => NOW }).inspect(w.args), { allowed: false, reason: 'hosted_provenance_unconfigured' });
  }
});

test('compose: S09 composes no reader at all, and an absent or throwing adapter fails closed', async () => {
  assert.deepEqual(hostedReaders(), {}, 'no trusted provenance, boundary or eligibility reader exists yet');
  const w = world('hosted');
  for (const loadVerification of [async () => { throw new Error('ERR_MODULE_NOT_FOUND'); }, async () => ({}), async () => ({ createHostedVerification: () => { throw new Error('bad'); } })]) {
    assert.equal(await hostedExecutorDependencies({ loadVerification, readers: () => w.readers }).admissionIsolation(w.args), false);
  }
});

test('compose: S09 catalog profiles satisfy S30 target checks, and the adapter verifies through the real S09 admission', async () => {
  for (const id of ['hosted', 'github-8']) {
    const w = world(id);
    const port = hostedExecutorDependencies({ readers: () => w.readers });
    assert.equal(await port.admissionIsolation(w.args), true, `${id}: simulated trusted evidence`);
    const admitted = await w.admit(port.admissionIsolation);
    assert.equal(admitted.allowed, true, `${id}: ${admitted.reason} ${w.missing.join(' ')}`);
    assert.equal(admitted.profile.id, id);
    // Admission alone never runs anything: there is no hosted execution boundary job yet.
    assert.throws(() => requireExecutionBoundary(port), /execution_boundary_unavailable/);
  }
});

test('compose: missing boundary, self-hosted substitution and stale evidence refuse through the real S09 admission', async () => {
  const cases = [
    ['no boundary readiness reader', r => { delete r.readBoundaryReadiness; }],
    ['tests-only boundary readiness', r => { const b = r.readBoundaryReadiness; r.readBoundaryReadiness = async a => ({ ...await b(a), scope: 'tests-only' }); }],
    ['self-hosted job', r => { const p = r.readProvenance; r.readProvenance = async a => { const d = await p(a); d.job.labels.push('self-hosted'); return d; }; }],
    ['stale provenance', r => { const p = r.readProvenance; r.readProvenance = async a => ({ ...await p(a), observedAt: NOW - 30_001 }); }],
    ['no check-run claim', r => { const p = r.readProvenance; r.readProvenance = async a => { const d = await p(a); delete d.claims.check_run_id; return d; }; }],
  ];
  for (const [name, mutate] of cases) {
    const w = world('hosted'); mutate(w.readers);
    const admitted = await w.admit(hostedExecutorDependencies({ readers: () => w.readers }).admissionIsolation);
    assert.deepEqual([admitted.allowed, admitted.reason], [false, 'execution_isolation_unverified'], name);
  }
  const lane = world('github-8'); const read = lane.readers.readIncludedEligibility;
  lane.readers.readIncludedEligibility = async a => ({ ...await read(a), overageAllowed: true });
  assert.equal((await lane.admit(hostedExecutorDependencies({ readers: () => lane.readers }).admissionIsolation)).allowed, false, 'overage allowed');
});

test('compose: the adapter returns the boundary identity S09 needs for same-instance rechecks, but the boolean port drops it', async () => {
  const w = world('hosted');
  const verification = createHostedVerification(w.readers);
  const inspected = await verification.inspect(w.args);
  assert.deepEqual(inspected.boundary, { instanceId: 'simulated-boundary', policyDigest: DIGEST, jobId: 909, observedAt: NOW });
  // S09's current hosted port exposes only the boolean; a future hosted boundary job must use inspect() and pin
  // boundary.instanceId across the pre-install and pre-test rechecks (integration gate, not an S30 defect).
  assert.deepEqual(Object.keys(hostedExecutorDependencies({ readers: () => w.readers })), ['admissionIsolation']);
});
