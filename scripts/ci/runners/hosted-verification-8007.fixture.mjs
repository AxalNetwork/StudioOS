/** D8007: local behavioral fixtures; ALL GitHub/provider/native facts are simulated, never live hosted-child evidence. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHostedVerification } from './hosted-verification.mjs';
const EXECUTOR_HEAD = '77345b391da7455737fb20c0d4d9a3c181eb4092';
const COORDINATOR_HEAD = '007df4b0f61c037094c7c5de2dc970bbe261c413';
const root = new URL('../../../', import.meta.url);
// Execute exact published sources, not copied reimplementations. No checkout modification or network read.
const source = (head, path) => execFileSync('git', ['show', `${head}:${path}`], { cwd: root, encoding: 'utf8' });
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const admission = await import(moduleUrl(source(EXECUTOR_HEAD, 'scripts/ci/runner-admission.mjs')));
// Load the selected main's exact plan helper; its three unchanged local dependencies were diff-checked.
const planHelperUrl = moduleUrl(source(EXECUTOR_HEAD, 'scripts/test-drift-parts.mjs')
  .replace("from './lib/shardPlan.mjs'", `from '${new URL('../../lib/shardPlan.mjs', import.meta.url).href}'`)
  .replace("from './build-generated.mjs'", `from '${new URL('../../build-generated.mjs', import.meta.url).href}'`)
  .replace("from './lib/flakyTests.mjs'", `from '${new URL('../../lib/flakyTests.mjs', import.meta.url).href}'`)
  .replace("from './lib/ciFailures.mjs'", `from '${moduleUrl(source(EXECUTOR_HEAD, 'scripts/lib/ciFailures.mjs'))}'`)
  .replaceAll('import.meta.url', JSON.stringify(new URL('../../test-drift-parts.mjs', import.meta.url).href)));
const { buildPlan } = await import(planHelperUrl);
const execution = await import(moduleUrl(source(EXECUTOR_HEAD, 'scripts/ci/runner-execution.mjs')
  .replace("from './runner-admission.mjs'", `from '${moduleUrl(source(EXECUTOR_HEAD, 'scripts/ci/runner-admission.mjs'))}'`)
  .replace("from '../test-drift-parts.mjs'", `from '${planHelperUrl}'`)));
const policyUrl = moduleUrl(stripTypeScriptTypes(source(COORDINATOR_HEAD, 'merge-control/src/lib/ciCapacityPolicy.ts')));
const policyModule = await import(policyUrl);
const { CiCapacity, SqlCapacityStore } = await import(moduleUrl(stripTypeScriptTypes(source(COORDINATOR_HEAD, 'merge-control/src/ciCapacity.ts'))
  .replace("'./lib/ciCapacityPolicy.ts'", JSON.stringify(policyUrl))));
const NOW = 1_800_000_000_000, REPO = 'AxalNetwork/StudioOS', PREFIX = '/repos/' + REPO;
const SHA = 'a'.repeat(40), EXEC = 'e'.repeat(40), MAIN = 'b'.repeat(40), DIGEST = 'sha256:' + '1'.repeat(64);
const copy = v => structuredClone(v);
function fixture(id = 'hosted') {
  const receipt = { version: 1, requestId: 'fixture-8007', repository: REPO, logicalShard: 'worker-1-of-6', event: 'push',
    parentRunId: 101, parentAttempt: 1, parentWorkflowId: 77, sourceSha: SHA, queueBaseSha: null,
    planDigest: DIGEST, planArtifactId: 505, executorSha: EXEC, profile: id, generation: 3,
    childRunId: 202, childAttempt: 1, startDeadline: NOW + 60_000, executionDeadline: NOW + 1_000_000 };
  const context = { repository: REPO, executorSha: EXEC, childRunId: 202, childAttempt: 1 };
  const profile = { id, platform: 'linux', arch: 'x64', nodeVersion: '22.23.3', pythonVersion: '3.11.18',
    eligibleShards: ['worker-1-of-6'], ...(id === 'hosted' ? { target: 'ubuntu-latest' }
      : { approvedGroupId: 6, target: { group: 'StudioOS Included Compute', labels: ['studioos-bench-linux-8'] } }) };
  const repo = { id: 1191713997, full_name: REPO };
  const run = { id: 202, run_attempt: 1, workflow_id: 88, path: '.github/workflows/runner-executor.yml', head_sha: EXEC,
    head_branch: 'main', event: 'workflow_dispatch', status: 'in_progress', conclusion: null, repository: repo, head_repository: repo };
  const job = { id: 909, run_id: 202, run_attempt: 1, head_sha: EXEC, name: 'Admitted Worker shard',
    status: 'in_progress', conclusion: null, started_at: new Date(NOW - 1).toISOString(),
    check_run_url: `https://api.github.com/repos/${REPO}/check-runs/909`,
    labels: id === 'hosted' ? ['ubuntu-latest'] : ['studioos-bench-linux-8'],
    ...(id === 'github-8' ? { runner_group_id: 6, runner_group_name: 'StudioOS Included Compute' } : {}) };
  const claims = { repository: REPO, repository_id: String(repo.id), run_id: '202', run_attempt: '1', runner_environment: 'github-hosted',
    sha: EXEC, workflow_sha: EXEC, workflow_ref: `${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`,
    event_name: 'workflow_dispatch', ref: 'refs/heads/main', check_run_id: '909' };
  const common = () => ({ binding: copy(receipt), observedAt: NOW });
  // These are simulated successful trusted-reader outputs, NOT a real JWT, provider assertion or native canary.
  const proof = { ...common(), claims, run, job };
  const boundary = { ...common(), kind: 'trusted-native-inspection', policyDigest: DIGEST, jobId: 909,
    instanceId: 'fixture-only-boundary', scope: 'dependency-install-and-tests', deniesRunnerAgent: true,
    deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: true };
  const lane = { ...common(), jobId: 909, runnerGroupId: 6, provider: 'github-hosted', billingLane: 'included-compute',
    reservation: 'active', overageAllowed: false, stopAtLimitVerified: true, validUntil: NOW + 60_000 };
  const readers = { now: () => NOW, readProvenance: async () => copy(proof), readBoundary: async () => copy(boundary),
    readIncludedEligibility: async () => copy(lane) };
  const args = { receipt, context, profile, phase: 'execute' };
  return { receipt, context, profile, args, proof, boundary, lane, readers,
    inspect: () => createHostedVerification(readers).inspect(args) };
}

test('simulated native boundary plus exact target-job provenance passes both hosted profiles, with no execution or dispatch', async () => {
  for (const id of ['hosted', 'github-8']) {
    const f = fixture(id);
    assert.deepEqual(await f.inspect(), { allowed: true, reason: 'trusted_hosted_evidence_verified',
      boundary: { instanceId: f.boundary.instanceId, policyDigest: f.boundary.policyDigest, jobId: f.boundary.jobId, observedAt: f.boundary.observedAt } });
    assert.equal(await createHostedVerification(f.readers).verifyIsolation(f.args), true);
  }
});
test('unconfigured readers, request flags and valid hosted provenance without a boundary explicitly refuse', async () => {
  const f = fixture();
  f.args.isolationVerified = true; f.args.runner_environment = 'github-hosted';
  assert.equal((await createHostedVerification().inspect(f.args)).reason, 'hosted_provenance_unconfigured');
  delete f.readers.readBoundary;
  assert.equal((await f.inspect()).reason, 'hosted_credential_boundary_unproven');
  f.readers.readBoundary = async () => ({ ...f.boundary, kind: 'fresh-github-vm' });
  assert.equal((await f.inspect()).allowed, false);
});
test('every source/plan/generation/attempt receipt binding is checked against independent evidence', async () => {
  for (const field of Object.keys(fixture().receipt)) {
    const f = fixture(); f.proof.binding[field] = field === 'generation' ? 4 : 'wrong';
    assert.equal((await f.inspect()).reason, 'hosted_evidence_binding_mismatch', field);
  }
  for (const [key, value] of [['executorSha', SHA], ['childRunId', 203], ['childAttempt', 2]]) {
    const f = fixture(); f.context[key] = value; assert.equal((await f.inspect()).reason, 'hosted_binding_invalid', key);
  }
});
test('wrong workflow/source, run attempt, JWT job or repository and self-hosted substitution deny', async () => {
  for (const patch of [{ workflow_sha: SHA }, { sha: SHA }, { run_id: '203' }, { run_attempt: '2' },
    { check_run_id: '910' }, { repository_id: '1' }, { ref: 'refs/heads/topic' }, { runner_environment: 'self-hosted' }]) {
    const f = fixture(); Object.assign(f.proof.claims, patch); assert.equal((await f.inspect()).allowed, false, JSON.stringify(patch));
  }
  for (const patch of [{ run_attempt: 2 }, { status: 'completed' }, { head_sha: SHA }, { event: 'pull_request' }]) {
    const f = fixture(); Object.assign(f.proof.run, patch); assert.equal((await f.inspect()).allowed, false);
  }
  const self = fixture(); self.proof.job.labels.push('SELF-HOSTED'); assert.equal((await self.inspect()).reason, 'hosted_self_hosted_substitution');
});
test('each credential denial covers dependency scripts AND tests; missing, stale, future or thrown evidence is not a pass', async () => {
  for (const field of ['deniesRunnerAgent', 'deniesJobCredentials', 'deniesOidc', 'deniesAppCapabilities', 'deniesHostControl']) {
    const f = fixture(); f.boundary[field] = false; assert.equal((await f.inspect()).reason, 'hosted_credential_boundary_unproven', field);
  }
  const f = fixture(); f.boundary.scope = 'tests-only'; assert.equal((await f.inspect()).allowed, false);
  for (const reader of ['readProvenance', 'readBoundary', 'readIncludedEligibility']) {
    for (const observedAt of [NOW - 30_001, NOW + 1, null]) {
      const c = fixture('github-8'); const original = c.readers[reader];
      c.readers[reader] = async () => ({ ...await original(), observedAt });
      assert.equal((await c.inspect()).reason, 'hosted_evidence_stale');
    }
    const c = fixture('github-8'); c.readers[reader] = async () => { throw new Error('private evidence detail'); };
    assert.deepEqual(await c.inspect(), { allowed: false, reason: 'hosted_evidence_unavailable' });
  }
});
test('included group names/labels never replace independently verified lane, reservation and no-overage proof', async () => {
  for (const patch of [{ billingLane: 'paid' }, { overageAllowed: true }, { stopAtLimitVerified: false },
    { reservation: 'unknown' }, { provider: 'self-hosted' }, { jobId: 999 }, { runnerGroupId: 5 }, { validUntil: NOW }]) {
    const f = fixture('github-8'); Object.assign(f.lane, patch); assert.equal((await f.inspect()).reason, 'included_lane_unverified');
  }
  const f = fixture('github-8'); delete f.readers.readIncludedEligibility;
  assert.equal((await f.inspect()).reason, 'included_eligibility_unconfigured');
  f.proof.job.runner_group_id = 5; assert.equal((await f.inspect()).reason, 'included_target_mismatch');
});
test('start loss, lease expiry and cancellation across a reader cannot authorize execution', async () => {
  const f = fixture(); f.readers.now = () => f.receipt.executionDeadline; assert.equal((await f.inspect()).reason, 'hosted_lease_expired');
  const late = fixture(); late.proof.job.started_at = new Date(late.receipt.startDeadline + 1).toISOString();
  assert.equal((await late.inspect()).reason, 'hosted_job_identity_mismatch');
  const controller = new AbortController(), cancelled = fixture(); cancelled.args.signal = controller.signal;
  cancelled.readers.readBoundary = async () => { controller.abort(); return cancelled.boundary; };
  assert.equal((await cancelled.inspect()).reason, 'hosted_verification_cancelled');
});

function admissionFixture(f) {
  const repo = f.proof.run.repository;
  const parent = { id: 101, run_attempt: 1, workflow_id: 77, path: '.github/workflows/ci.yml', head_sha: SHA,
    status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', repository: repo, head_repository: repo };
  const map = new Map([
    [PREFIX + '/actions/runs/101', parent], [PREFIX + '/actions/runs/101/attempts/1', parent], [PREFIX + '/actions/runs/202', f.proof.run],
    [PREFIX + '/actions/workflows/runner-executor.yml', { id: 88, path: '.github/workflows/runner-executor.yml', state: 'active' }],
    [PREFIX + '/git/ref/heads/main', { ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } }],
    [PREFIX + `/compare/${EXEC}...${MAIN}?per_page=100`, { status: 'ahead', base_commit: { sha: EXEC }, merge_base_commit: { sha: EXEC } }],
    [PREFIX + '/actions/runs/101/artifacts?name=suite-plan&per_page=100', { total_count: 1, artifacts: [
      { id: 505, name: 'suite-plan', expired: false, workflow_run: { id: 101, head_sha: SHA, repository_id: repo.id, head_repository_id: repo.id } }] }],
  ]);
  return { context: f.context, phase: 'execute', now: () => NOW,
    readReceipt: async () => ({ active: true, receipt: copy(f.receipt) }), resolveProfile: async () => f.profile,
    api: async (method, path) => { assert.equal(method, 'GET'); assert.ok(map.has(path), path); return copy(map.get(path)); },
    verifyIsolation: createHostedVerification(f.readers).verifyIsolation };
}
test('exact #7972 admission accepts the simulated port, still rejects missing boundary and independent parent mismatch', async () => {
  for (const id of ['hosted', 'github-8']) {
    const f = fixture(id), request = { requestId: f.receipt.requestId, generation: 3, shard: f.receipt.logicalShard, profile: id };
    const deps = admissionFixture(f);
    assert.equal((await admission.admitRunnerJob(request, deps)).allowed, true);
    f.receipt.sourceSha = 'c'.repeat(40); f.proof.binding.sourceSha = f.receipt.sourceSha; f.boundary.binding.sourceSha = f.receipt.sourceSha; f.lane.binding.sourceSha = f.receipt.sourceSha;
    assert.equal((await admission.admitRunnerJob(request, deps)).reason, 'parent_workflow_or_source_mismatch');
    delete f.readers.readBoundary; deps.verifyIsolation = createHostedVerification(f.readers).verifyIsolation;
    assert.equal((await admission.admitRunnerJob(request, deps)).reason, 'execution_isolation_unverified');
  }
});

const temp = mkdtempSync(join(tmpdir(), 's30-8007-tests-')); after(() => rmSync(temp, { recursive: true, force: true }));
async function runActual(t, body, cancel = false) {
  const base = mkdtempSync(join(temp, 'process-')), paths = { source: join(base, 'source'), temp: join(base, 'temp') };
  mkdirSync(join(paths.source, 'scripts'), { recursive: true }); mkdirSync(paths.temp);
  const driver = join(paths.source, 'scripts/test-drift-parts.mjs'); writeFileSync(driver, body);
  const controller = new AbortController(), f = fixture();
  const admitted = { allowed: true, identity: f.receipt, sourceSha: SHA, shard: f.receipt.logicalShard, originalEvent: 'push', sourceRef: 'refs/heads/main',
    originalRunId: 101, originalAttempt: 1, executionDeadline: NOW + 60_000 };
  return execution.executeShard({ admitted, paths, testDriver: driver, planPath: join(base, 'plan.json'),
    readReceipt: async () => admitted, now: () => NOW, signal: controller.signal, gitHead: () => SHA, gitClean: () => true,
    run: (command, args, options) => {
      const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
      if (cancel) child.stdout.once('data', () => controller.abort());
      return child;
    } });
}
test('actual local failing subprocess remains nonzero; cancellation waits for readiness then interrupts the real process group', async t => {
  assert.equal((await runActual(t, 'process.exit(9)')).code, 9);
  const stopped = await runActual(t, 'console.log("READY"); setInterval(() => {}, 1000);', true);
  assert.equal(stopped.code, 130); assert.equal(stopped.cancelled, true);
});
test('exact executor result rejects skipped/unknown tests and preserves actual test failure', () => {
  const f = fixture(); const run = { ...f.proof.run, status: 'completed', conclusion: 'success' };
  const job = { ...f.proof.job, status: 'completed', conclusion: 'success', steps: [{ name: 'Run admitted Worker shard', status: 'completed', conclusion: 'success' }] };
  assert.equal(execution.childResult({ run, jobs: [job] }, f.context).outcome, 'success');
  job.steps[0].conclusion = 'failure'; assert.equal(execution.childResult({ run, jobs: [job] }, f.context).outcome, 'test_failure');
  job.steps[0].conclusion = 'skipped'; assert.equal(execution.childResult({ run, jobs: [job] }, f.context).outcome, 'unknown');
});

function coordinatorFixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const storage = { sql: { exec(query, ...values) { const rows = db.prepare(query).all(...values); return { toArray: () => rows }; } },
    transactionSync(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  const store = new SqlCapacityStore(storage), observations = new Map(), dispatched = [], cancelled = [];
  const state = { now: NOW, next: 100, live: true };
  const policy = { version: 1, maxExternalWorkerShards: 0, maxIncludedWorkerShards: 1,
    minimumHostedWorkerShards: 1, approvedGroupId: 5, budgets: { ...policyModule.CI_CAPACITY_BUDGETS } };
  const input = { version: 1, requestId: '00000000-0000-4000-8000-000000008007', repository: REPO,
    parentRunId: 101, parentAttempt: 1, parentWorkflowId: 77, event: 'push', sourceSha: SHA,
    queueBaseSha: null, executorSha: EXEC, planDigest: DIGEST, planArtifactId: 505,
    shards: Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`), prerequisites: ['fast'] };
  // Remote provider behavior is a fixture. Storage/state transitions are the real published coordinator using real SQLite.
  const ports = { verify: async s => ({ ...copy(s), parentLive: state.live, trustedSource: true, executorOnMain: true }),
    inventory: async () => null, parent: async () => state.live, prerequisites: async () => [{ name: 'fast', conclusion: 'success' }],
    dispatch: async a => { dispatched.push(copy(a)); return state.next++; }, discover: async () => null,
    observe: async r => observations.get(r.childRunId) ?? null,
    cancel: async r => { cancelled.push(copy(r)); } };
  const c = new CiCapacity(store, ports, REPO, policy, () => state.now);
  const get = () => store.get(input.requestId);
  const active = shard => policyModule.activeAttempt(shard);
  const observation = (a, patch = {}) => ({ receipt: copy(a), workflowPath: '.github/workflows/runner-executor.yml', workflowAttempt: 1,
    jobId: a.childRunId + 1000, runnerProfile: a.profile, status: 'completed', conclusion: 'success', jobConclusion: 'success',
    testStep: 'success', startedAt: NOW + 1, ...patch });
  const tick = () => c.tick();
  return { c, store, state, policy, input, observations, dispatched, cancelled, get, active, observation, tick };
}
test('published coordinator preserves the free-hosted floor and one included reservation; no adapter changes routing or budgets', async t => {
  const f = coordinatorFixture(t); await f.c.submit(f.input); await f.tick();
  const attempts = f.get().shards.map(f.active);
  assert.equal(attempts.filter(a => a.profile === 'github-8').length, 1);
  assert.equal(attempts.filter(a => a.profile === 'hosted').length, 5);
  await f.c.submit({ ...f.input, parentRunId: 102, requestId: '00000000-0000-4000-8000-000000008008' });
  const second = f.store.get('00000000-0000-4000-8000-000000008008');
  assert.ok(second.shards.every(s => f.active(s).profile === 'hosted'));
  assert.throws(() => policyModule.validateCapacityPolicy({ ...f.policy, minimumHostedWorkerShards: 0 }));
  assert.throws(() => policyModule.validateCapacityPolicy({ ...f.policy, budgets: { ...f.policy.budgets, queueMs: 1 } }));
});
test('start loss fences the old receipt, waits for observed termination and makes only one bounded hosted fallback generation', async t => {
  const f = coordinatorFixture(t); await f.c.submit(f.input); await f.tick();
  const shard = f.get().shards.find(s => f.active(s).profile === 'github-8'), initial = f.active(shard);
  f.state.now = initial.startDeadline + 1; await f.tick();
  assert.equal(f.active(f.get().shards[0]).phase, 'cancelling');
  assert.equal(await f.c.receipt(f.input.requestId, shard.name, initial.childRunId, 1), null);
  assert.equal(f.dispatched.filter(a => a.logicalShard === shard.name).length, 1);
  f.observations.set(initial.childRunId, f.observation(initial, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
  await f.tick();
  let current = f.active(f.get().shards.find(s => s.name === shard.name));
  assert.equal(current.profile, 'hosted'); assert.equal(current.generation, 2);
  assert.equal(current.sourceSha, initial.sourceSha); assert.equal(current.planDigest, initial.planDigest);
  assert.equal(current.executionDeadline - current.startDeadline, f.policy.budgets.hostedExecutionMs);
  await f.tick(); current = f.active(f.get().shards.find(s => s.name === shard.name));
  assert.equal(f.dispatched.filter(a => a.logicalShard === shard.name).length, 2);
  f.state.now = current.executionDeadline + 1; await f.tick();
  f.observations.set(current.childRunId, f.observation(current, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
  await f.tick(); await f.tick();
  assert.equal(f.get().shards.find(s => s.name === shard.name).generation, 2);
  assert.equal(f.dispatched.filter(a => a.logicalShard === shard.name).length, 2);
});
test('unknown cancellation or test truth cannot create replacement success; real failure is sticky and never retried as infrastructure', async t => {
  const f = coordinatorFixture(t); await f.c.submit(f.input); await f.tick();
  const shard = f.get().shards.find(s => f.active(s).profile === 'github-8'), a = f.active(shard);
  f.state.now = a.startDeadline + 1; await f.tick();
  f.observations.set(a.childRunId, f.observation(a, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'unknown', startedAt: null }));
  await f.tick(); assert.equal(f.get().shards.find(s => s.name === shard.name).generation, 1);
  assert.notEqual(policyModule.aggregateCapacity(f.get(), f.state.now).status, 'success');
  f.observations.set(a.childRunId, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure' }));
  await f.tick();
  assert.equal(policyModule.aggregateCapacity(f.get(), f.state.now).status, 'failure');
  assert.equal(f.get().shards.find(s => s.name === shard.name).generation, 1);
});


test('a reader that ignores cancellation still cannot leave verification pending or return success', async () => {
  const f = fixture(), controller = new AbortController();
  f.args.signal = controller.signal;
  f.readers.readBoundary = () => { queueMicrotask(() => controller.abort()); return new Promise(() => {}); };
  assert.deepEqual(await f.inspect(), { allowed: false, reason: 'hosted_verification_cancelled' });
});


test('published verify-plan logic preserves exact artifact bytes and deterministic queue digest', () => {
  const sourceRoot = mkdtempSync(join(temp, 'plan-'));
  for (const [folder, count] of [['frontend/test', 2], ['cloudflare-worker/test', 6]]) {
    mkdirSync(join(sourceRoot, folder), { recursive: true });
    for (let i = 1; i <= count; i++) writeFileSync(join(sourceRoot, folder, `${i}.test.mjs`), '// simulated suite member\n');
  }
  const scripts = { 'test:frontend': "node --test 'frontend/test/*.test.mjs'", 'test:worker': "node --test 'cloudflare-worker/test/*.test.mjs'",
    'test:drift': 'npm run test:frontend && npm run test:worker' };
  const bytes = Buffer.from(JSON.stringify(buildPlan(scripts, {}, sourceRoot), null, 2) + '\n');
  const args = { event: 'push', part: 'worker-1-of-6', expectedDigest: execution.planDigest(bytes), artifactBytes: bytes, scripts, sourceRoot };
  assert.deepEqual(execution.verifiedPlan(args), bytes);
  assert.throws(() => execution.verifiedPlan({ ...args, artifactBytes: Buffer.concat([bytes, Buffer.from(' ')]) }), /plan_digest_mismatch/);
  assert.deepEqual(execution.verifiedPlan({ ...args, event: 'merge_group', artifactBytes: null }), bytes);
});


test('evidence and included eligibility must remain fresh until all readers finish', async () => {
  const stale = fixture(); let time = NOW;
  stale.readers.now = () => time;
  stale.proof.observedAt = NOW - 30_000;
  stale.readers.readBoundary = async () => { time++; return { ...stale.boundary, observedAt: time }; };
  assert.equal((await stale.inspect()).reason, 'hosted_evidence_stale');
  const lane = fixture('github-8'); time = NOW;
  lane.readers.now = () => time; lane.lane.validUntil = NOW + 1;
  lane.readers.readBoundary = async () => { time += 2; return lane.boundary; };
  assert.equal((await lane.inspect()).reason, 'included_lane_unverified');
});

test('stale provenance refuses before invoking any boundary inspector', async () => {
  const f = fixture(); let inspections = 0;
  f.proof.observedAt = NOW - 30_001;
  f.readers.readBoundary = async () => { inspections++; return f.boundary; };
  assert.equal((await f.inspect()).reason, 'hosted_evidence_stale');
  assert.equal(inspections, 0);
});

for (const profile of ['hosted', 'github-8']) {
  test(`clock rollback refuses previously collected future evidence on ${profile}`, async () => {
    const f = fixture(profile); let time = NOW;
    f.readers.now = () => time;
    f.readers.readBoundary = async () => {
      time = NOW - 1;
      return { ...f.boundary, observedAt: time };
    };
    assert.deepEqual(await f.inspect(), { allowed: false, reason: 'hosted_evidence_stale' }, profile);
  });
}


test('missing target-job check-run claim gives an explicit refusal instead of guessing job identity', async () => {
  for (const profile of ['hosted', 'github-8']) {
    const f = fixture(profile); delete f.proof.claims.check_run_id;
    assert.deepEqual(await f.inspect(), { allowed: false, reason: 'hosted_job_claim_unavailable' });
  }
});

test('a concrete refusal retains its diagnostic when a late abort is also observed', async () => {
  const f = fixture(), controller = new AbortController();
  f.args.signal = controller.signal;
  f.readers.now = () => { controller.abort(); return f.receipt.executionDeadline; };
  assert.deepEqual(await f.inspect(), { allowed: false, reason: 'hosted_lease_expired' });
});
