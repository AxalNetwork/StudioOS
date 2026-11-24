/**
 * #7905 / #8345: S09's hosted execution seams for S39's trusted readers.
 * - The child workflow revision (`childWorkflowSha ?? executorSha`) binds job, run and OIDC; `executorSha` stays the
 *   control revision.
 * - Separate admission (readiness, no instance) and execution (the live instance, pinned to the trusted job) ports.
 * - The read-only JobContainer boundary inspection, which keeps refusing while host control is not denied.
 * Every reader output here is SIMULATED in S30's documented shapes. Nothing is live provenance, boundary or billing
 * evidence, and no engine, image or hosted runner is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedVerification } from '../../scripts/ci/runners/hosted-verification.mjs';
import { hostedBoundaryJob, hostedExecutorDependencies, hostedReaders, isolationFor } from '../../scripts/ci/runners/executor-isolation.mjs';
import { JobContainer, containerIsolationAdapter, containerPolicyDigest } from '../../scripts/ci/runners/job-container.mjs';
import { requireExecutionBoundary, runInContainer } from '../../scripts/ci/runner-execution.mjs';
import { resolveCatalogProfile } from '../../scripts/ci/runners/catalog.mjs';

const NOW = 1_800_000_000_000, REPO = 'AxalNetwork/StudioOS';
const EXEC = 'e'.repeat(40), CHILD = 'c'.repeat(40), SRC = 'a'.repeat(40), DIGEST = 'sha256:' + '1'.repeat(64);
const POLICY = { version: 1, image: 'sha256:' + 'd'.repeat(64), nodeVersion: '22.23.3', pythonVersion: '3.11.18' };
const POLICY_DIGEST = containerPolicyDigest(POLICY), CID = 'f'.repeat(64);
const copy = v => structuredClone(v);

/** A hosted world; `child` pins the child workflow to its own revision, as the coordinator does with childWorkflowSha. */
function world(id = 'hosted', { child = null } = {}) {
  const childSha = child ?? EXEC;
  const receipt = { version: 1, requestId: 'hosted-8345-0001', repository: REPO, logicalShard: 'worker-1-of-6', event: 'push',
    parentRunId: 101, parentAttempt: 1, parentWorkflowId: 77, sourceSha: SRC, queueBaseSha: null, planDigest: DIGEST,
    planArtifactId: 505, executorSha: EXEC, ...(child ? { childWorkflowSha: child } : {}), profile: id, generation: 3,
    childRunId: 202, childAttempt: 1, startDeadline: NOW + 60_000, executionDeadline: NOW + 1_000_000 };
  const repo = { id: 1191713997, full_name: REPO };
  const run = { id: 202, run_attempt: 1, path: '.github/workflows/runner-executor.yml', head_sha: childSha, head_branch: 'main',
    event: 'workflow_dispatch', status: 'in_progress', conclusion: null, repository: repo, head_repository: repo };
  const job = { id: 909, run_id: 202, run_attempt: 1, head_sha: childSha, name: 'Admitted Worker shard', status: 'in_progress', conclusion: null,
    started_at: new Date(NOW - 1).toISOString(), check_run_url: `https://api.github.com/repos/${REPO}/check-runs/909`,
    labels: id === 'hosted' ? ['ubuntu-latest'] : ['studioos-bench-linux-8'],
    ...(id === 'github-8' ? { runner_group_id: 6, runner_group_name: 'StudioOS Included Compute' } : {}) };
  const claims = { repository: REPO, repository_id: String(repo.id), run_id: '202', run_attempt: '1', runner_environment: 'github-hosted',
    sha: childSha, workflow_sha: childSha, workflow_ref: `${REPO}/.github/workflows/runner-executor.yml@refs/heads/main`,
    event_name: 'workflow_dispatch', ref: 'refs/heads/main', check_run_id: '909' };
  const doc = extra => ({ binding: copy(receipt), observedAt: NOW, ...extra });
  const denials = { deniesRunnerAgent: true, deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: true };
  const calls = { readiness: 0, live: 0 };
  const readers = {
    now: () => NOW,
    readProvenance: async () => doc({ claims: copy(claims), run: copy(run), job: copy(job) }),
    readBoundaryReadiness: async () => { calls.readiness++; return doc({ kind: 'trusted-native-readiness', policyDigest: POLICY_DIGEST, jobId: 909, scope: 'dependency-install-and-tests', ...denials }); },
    readBoundary: async () => { calls.live++; return doc({ kind: 'trusted-native-inspection', policyDigest: POLICY_DIGEST, jobId: 909, instanceId: CID, scope: 'dependency-install-and-tests', ...denials }); },
    readIncludedEligibility: async () => doc({ jobId: 909, runnerGroupId: 6, provider: 'github-hosted', billingLane: 'included-compute',
      reservation: 'active', overageAllowed: false, stopAtLimitVerified: true, validUntil: NOW + 60_000 }),
  };
  const context = { repository: REPO, executorSha: EXEC, childWorkflowSha: childSha, childRunId: '202', childAttempt: '1' };
  const profile = resolveCatalogProfile(id);
  return { receipt, context, profile, readers, calls, claims, run, job,
    args: { receipt, context, profile, phase: 'execute' }, live: { instanceId: CID, policyDigest: POLICY_DIGEST } };
}
const swap = (readers, name, patch) => { const read = readers[name]; readers[name] = async a => patch(await read(a)); };

test('#8345 child/control: a pinned child workflow binds job, run and OIDC; executorSha stays the control revision', async () => {
  for (const id of ['hosted', 'github-8']) {
    const w = world(id, { child: CHILD });
    const v = createHostedVerification(w.readers);
    assert.deepEqual(await v.inspectAdmission(w.args), { allowed: true, reason: 'trusted_hosted_evidence_verified', boundary: { policyDigest: POLICY_DIGEST, jobId: 909, observedAt: NOW } }, id);
    assert.equal(await v.verifyExecution({ ...w.args, boundary: w.live }), true, id);
    assert.equal(await v.verifyIsolation(w.args), true, `${id}: the accepted #8007 port takes the same rule`);
  }
  // Unpinned receipts keep the old behaviour: the child runs at executorSha.
  const plain = world();
  assert.equal(await createHostedVerification(plain.readers).verifyAdmission(plain.args), true);
});

test('#8345 child/control: the job, run and OIDC are never checked against the control revision of a pinned child', async () => {
  const cases = [
    ['claims.workflow_sha', w => swap(w.readers, 'readProvenance', d => { d.claims.workflow_sha = EXEC; return d; }), 'hosted_oidc_identity_mismatch'],
    ['claims.sha', w => swap(w.readers, 'readProvenance', d => { d.claims.sha = EXEC; return d; }), 'hosted_oidc_identity_mismatch'],
    ['run.head_sha', w => swap(w.readers, 'readProvenance', d => { d.run.head_sha = EXEC; return d; }), 'hosted_run_identity_mismatch'],
    ['job.head_sha', w => swap(w.readers, 'readProvenance', d => { d.job.head_sha = EXEC; return d; }), 'hosted_job_identity_mismatch'],
    ['context.childWorkflowSha', w => { w.context.childWorkflowSha = EXEC; }, 'hosted_binding_invalid'],
    ['context.executorSha', w => { w.context.executorSha = CHILD; }, 'hosted_binding_invalid'],
    ['receipt.childWorkflowSha format', w => { w.receipt.childWorkflowSha = 'not-a-sha'; }, 'hosted_binding_invalid'],
    ['binding without childWorkflowSha', w => swap(w.readers, 'readProvenance', d => { delete d.binding.childWorkflowSha; return d; }), 'hosted_evidence_binding_mismatch'],
    ['binding with another child', w => swap(w.readers, 'readProvenance', d => { d.binding.childWorkflowSha = 'b'.repeat(40); return d; }), 'hosted_evidence_binding_mismatch'],
  ];
  for (const [name, mutate, reason] of cases) {
    const w = world('hosted', { child: CHILD }); mutate(w);
    const v = createHostedVerification(w.readers);
    assert.equal((await v.inspectAdmission(w.args)).reason, reason, `admission: ${name}`);
    assert.equal((await v.inspectExecution({ ...w.args, boundary: w.live })).reason, reason, `execution: ${name}`);
  }
  // An unpinned receipt whose binding carries a child revision is not the same receipt either.
  const plain = world(); swap(plain.readers, 'readProvenance', d => { d.binding.childWorkflowSha = EXEC; return d; });
  assert.equal((await createHostedVerification(plain.readers).inspectAdmission(plain.args)).reason, 'hosted_evidence_binding_mismatch');
});

test('#8345 admission: readiness only; it never reads or accepts a live instance', async () => {
  const w = world();
  assert.equal(await createHostedVerification(w.readers).verifyAdmission(w.args), true);
  assert.deepEqual(w.calls, { readiness: 1, live: 0 }, 'admission must not read the live boundary');
  const cases = [
    ['no readiness reader', r => { delete r.readBoundaryReadiness; }],
    ['readiness names an instance', r => swap(r, 'readBoundaryReadiness', d => ({ ...d, instanceId: CID }))],
    ['a live document offered as readiness', r => { r.readBoundaryReadiness = r.readBoundary; }],
    ['host control not denied', r => swap(r, 'readBoundaryReadiness', d => ({ ...d, deniesHostControl: false }))],
    ['tests-only scope', r => swap(r, 'readBoundaryReadiness', d => ({ ...d, scope: 'tests-only' }))],
    ['another job', r => swap(r, 'readBoundaryReadiness', d => ({ ...d, jobId: 910 }))],
    ['no policy digest', r => swap(r, 'readBoundaryReadiness', d => { delete d.policyDigest; return d; })],
    ['stale readiness', r => swap(r, 'readBoundaryReadiness', d => ({ ...d, observedAt: NOW - 30_001 }))],
  ];
  for (const [name, mutate] of cases) {
    const c = world(); mutate(c.readers);
    const result = await createHostedVerification(c.readers).inspectAdmission(c.args);
    assert.equal(result.allowed, false, name);
    assert.match(result.reason, /hosted_boundary_readiness_unproven|hosted_evidence_stale/, name);
  }
});

test('#8345 execution: the live instance must be the trusted job\'s own, unchanged, and readiness is never live', async () => {
  const w = world();
  const v = createHostedVerification(w.readers);
  assert.equal((await v.inspectExecution(w.args)).reason, 'hosted_boundary_instance_unbound', 'no boundary from the job');
  assert.equal((await v.inspectExecution({ ...w.args, boundary: { instanceId: CID } })).reason, 'hosted_boundary_instance_unbound', 'no policy digest');
  assert.equal((await v.inspectExecution({ ...w.args, boundary: { instanceId: '', policyDigest: POLICY_DIGEST } })).reason, 'hosted_boundary_instance_unbound');
  assert.equal((await v.inspectExecution({ ...w.args, boundary: { ...w.live, instanceId: 'other-instance' } })).reason, 'hosted_boundary_instance_changed');
  assert.equal((await v.inspectExecution({ ...w.args, boundary: { ...w.live, policyDigest: DIGEST } })).reason, 'hosted_boundary_instance_changed');
  const readiness = world(); readiness.readers.readBoundary = readiness.readers.readBoundaryReadiness;
  assert.equal((await createHostedVerification(readiness.readers).inspectExecution({ ...readiness.args, boundary: readiness.live })).reason, 'hosted_credential_boundary_unproven');
  for (const key of ['deniesRunnerAgent', 'deniesJobCredentials', 'deniesOidc', 'deniesAppCapabilities', 'deniesHostControl']) {
    const c = world(); swap(c.readers, 'readBoundary', d => ({ ...d, [key]: false }));
    assert.equal((await createHostedVerification(c.readers).inspectExecution({ ...c.args, boundary: c.live })).reason, 'hosted_credential_boundary_unproven', key);
  }
  assert.deepEqual(await v.inspectExecution({ ...w.args, boundary: w.live }),
    { allowed: true, reason: 'trusted_hosted_evidence_verified', boundary: { instanceId: CID, policyDigest: POLICY_DIGEST, jobId: 909, observedAt: NOW } });
});

test('#8345 composition: no reader and no boundary job exist, so admission and run both refuse by default', async () => {
  assert.deepEqual(hostedReaders(), {});
  assert.equal(hostedBoundaryJob(), null, 'missing: hosted policy/image, verified egress rule, native proof');
  for (const id of ['hosted', 'github-8']) {
    const w = world(id);
    const deps = isolationFor(id);
    assert.deepEqual(Object.keys(deps), ['admissionIsolation']);
    assert.equal(await deps.admissionIsolation(w.args), false);
    assert.throws(() => requireExecutionBoundary(deps), /execution_boundary_unavailable/);
  }
  // Even with positive simulated readers, admission alone never composes an execution port.
  const w = world(); let seen = null;
  const deps = hostedExecutorDependencies({ readers: ({ job }) => { seen = job; return w.readers; } });
  assert.equal(await deps.admissionIsolation(w.args), true);
  assert.equal(seen, null, 'the readers factory is given the (absent) trusted job');
  assert.throws(() => requireExecutionBoundary(deps), /execution_boundary_unavailable/);
});

test('#8345 composition: only a trusted JobContainer for the same hosted profile becomes the execution boundary', async () => {
  const w = world();
  for (const boundaryJob of [() => ({ boundaryIdentity: () => ({ instanceId: CID, policyDigest: POLICY_DIGEST }) }), () => new JobContainer(POLICY),
    () => new JobContainer(POLICY, { profileId: 'github-8' }), () => { throw new Error('unavailable'); }]) {
    const deps = hostedExecutorDependencies({ readers: () => w.readers, boundaryJob });
    assert.deepEqual(Object.keys(deps), ['admissionIsolation'], String(boundaryJob));
  }
  const job = new JobContainer(POLICY, { profileId: 'hosted' });
  const deps = hostedExecutorDependencies({ readers: () => w.readers, boundaryJob: () => job });
  assert.deepEqual(Object.keys(deps).sort(), ['admissionIsolation', 'executionIsolation', 'job']);
  assert.deepEqual(Object.keys(hostedExecutorDependencies({ profileId: 'github-8', readers: () => w.readers, boundaryJob: () => job })), ['admissionIsolation'], 'a hosted job never serves github-8');
  assert.deepEqual(Object.keys(isolationFor('github-8', { readers: () => w.readers, boundaryJob: () => new JobContainer(POLICY, { profileId: 'github-8' }) })).sort(), ['admissionIsolation', 'executionIsolation', 'job']);
  assert.equal(requireExecutionBoundary(deps), job);
  assert.equal(await deps.executionIsolation(w.args), false, 'no container has been created: no live instance to pin');
  job.boundaryIdentity = () => ({ kind: 'linux-container', instanceId: CID, owner: '202-1-3', policyDigest: POLICY_DIGEST });
  assert.equal(await deps.executionIsolation(w.args), true, 'simulated live document matches the trusted job');
  assert.equal(await deps.executionIsolation({ ...w.args, profile: resolveCatalogProfile('github-8') }), false, 'profile mismatch');
  // A complete, consistent github-8 request (receipt, profile and readers all github-8) still never runs in the hosted job.
  const lane = world('github-8');
  const crossed = hostedExecutorDependencies({ profileId: 'hosted', readers: () => lane.readers, boundaryJob: () => job });
  assert.equal(await createHostedVerification(lane.readers).verifyExecution({ ...lane.args, boundary: lane.live }), true, 'the github-8 evidence itself is consistent');
  assert.equal(await crossed.executionIsolation(lane.args), false, 'only the executor binds the job to its profile');
  job.boundaryIdentity = () => ({ kind: 'linux-container', instanceId: 'e'.repeat(64), owner: '202-1-3', policyDigest: POLICY_DIGEST });
  assert.equal(await deps.executionIsolation(w.args), false, 'the reader cannot nominate a different instance');
});

/** A fake engine that answers like a running container created with exactly the arguments the JobContainer sent. */
function engineFixture() {
  let info = null; const calls = [];
  const engine = async args => {
    calls.push(args[0]);
    const value = k => args[args.indexOf(k) + 1], all = k => args.flatMap((v, i) => v === k ? [args[i + 1]] : []);
    if (args[0] === 'version') return '27.0.0\n';
    if (args[0] === 'create') {
      const owner = value('--label').split('=')[1];
      info = { Id: CID, Name: '/studioos-job-' + owner, Image: POLICY.image, State: { Running: true, Pid: 123 },
        Config: { User: value('--user'), Labels: { 'vc.axal.studioos.job': owner }, Entrypoint: [value('--entrypoint')], Cmd: args.slice(-2), Env: all('--env') },
        HostConfig: { Privileged: false, Init: true, ReadonlyRootfs: true, CapDrop: ['ALL'], CapAdd: null, SecurityOpt: ['no-new-privileges'], PidMode: '', IpcMode: 'private',
          CgroupnsMode: 'private', NetworkMode: 'bridge', PortBindings: {}, Devices: [], DeviceRequests: null, VolumesFrom: null, ExtraHosts: null, Links: null,
          PidsLimit: 256, Memory: 4294967296, NanoCpus: 2e9, Tmpfs: Object.fromEntries(all('--tmpfs').map(v => [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)])) },
        Mounts: all('--mount').map(v => ({ Type: 'bind', Source: /src=([^,]+)/.exec(v)[1], Destination: /dst=([^,]+)/.exec(v)[1], RW: false, Propagation: 'rprivate' })) };
      return CID + '\n';
    }
    if (args[0] === 'inspect') return JSON.stringify([info]);
    if (args[0] === 'exec' && args.includes('-e')) return 'readable';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/node')) return '22.23.3\n';
    if (args[0] === 'exec' && args.includes('/usr/local/bin/python3')) return '3.11.18\n';
    return '';
  };
  return { engine, calls, info: () => info };
}
function inputs(t) {
  const root = mkdtempSync(join(tmpdir(), 'hosted-8345-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(source, 'package.json'), '{}');
  const plan = join(root, 'plan.json'); writeFileSync(plan, '{}');
  return { source, plan };
}
/** Mocked clock: JobContainer.create checks the deadline against Date.now(), so tests pin it at NOW. */
const fixedClock = t => t.mock.timers.enable({ apis: ['Date'], now: NOW });
const containerReceipt = (profile, now = NOW) => ({ version: 1, repository: REPO, profile, requestId: '00000000-0000-4000-8000-000000000345',
  logicalShard: 'worker-1-of-6', childRunId: 202, childAttempt: 1, generation: 3, executionDeadline: now + 1_000_000, event: 'push', sourceSha: SRC });

test('#8345 JobContainer: one profile per container, and receipts for any other profile are refused', async t => {
  fixedClock(t);
  assert.throws(() => new JobContainer(POLICY, { profileId: 'macos-arm64' }), /unsupported_container_profile/);
  assert.equal(new JobContainer(POLICY).profileId, 'linux-x64', 'linux-x64 is unchanged by default');
  const io = inputs(t);
  const linux = new JobContainer(POLICY, { engine: engineFixture().engine, stage: async () => {}, namespace: () => true });
  await assert.rejects(linux.create(containerReceipt('hosted'), io), /invalid_isolation_receipt/);
  const hosted = new JobContainer(POLICY, { profileId: 'hosted', engine: engineFixture().engine, stage: async () => {}, namespace: () => true });
  await assert.rejects(hosted.create(containerReceipt('linux-x64'), io), /invalid_isolation_receipt/);
  const receipt = containerReceipt('hosted');
  assert.equal(await hosted.create(receipt, io), CID);
  assert.equal(await hosted.verifyIsolation({ receipt, profile: { id: 'hosted' } }), true);
  assert.equal(await hosted.verifyIsolation({ receipt, profile: { id: 'linux-x64' } }), false);
  const adapter = containerIsolationAdapter(hosted), context = { repository: REPO, childRunId: '202', childAttempt: '1' };
  assert.equal(await adapter({ receipt, context, profile: { id: 'hosted' } }), true);
  assert.equal(await adapter({ receipt, context, profile: { id: 'linux-x64' } }), false);
});

test('#8345 inspectBoundary and inspectReadiness are read-only and report host control as NOT denied', async t => {
  fixedClock(t);
  const io = inputs(t), fake = engineFixture();
  const job = new JobContainer(POLICY, { profileId: 'hosted', engine: fake.engine, stage: async () => {}, namespace: () => true });
  const receipt = containerReceipt('hosted');
  assert.equal(await job.inspectBoundary({ receipt }), null, 'no container yet');
  const ready = await job.inspectReadiness();
  assert.equal(ready.kind, 'trusted-native-readiness');
  assert.equal(Object.hasOwn(ready, 'instanceId'), false, 'readiness never names an instance');
  assert.equal(ready.deniesHostControl, false);
  assert.deepEqual(fake.calls, ['version']);
  assert.equal(await new JobContainer(POLICY, { engine: async () => { throw new Error('down'); } }).inspectReadiness(), null);
  await job.create(receipt, io);
  fake.calls.length = 0;
  const doc = await job.inspectBoundary({ receipt });
  assert.deepEqual({ ...doc, observedAt: 0 }, { kind: 'trusted-native-inspection', policyDigest: POLICY_DIGEST, instanceId: CID, scope: 'dependency-install-and-tests',
    deniesRunnerAgent: true, deniesJobCredentials: true, deniesOidc: true, deniesAppCapabilities: true, deniesHostControl: false, observedAt: 0 });
  assert.equal(fake.calls.every(c => c === 'inspect' || c === 'exec'), true, `read-only: ${fake.calls}`);
  assert.equal(job.boundaryIdentity().policyDigest, POLICY_DIGEST);
  assert.equal(containerPolicyDigest({ pythonVersion: '3.11.18', nodeVersion: '22.23.3', image: POLICY.image, version: 1 }), POLICY_DIGEST, 'key order does not change the digest');
  // A container that no longer matches the verified boundary yields no document at all.
  fake.info().HostConfig.Privileged = true;
  assert.equal(await job.inspectBoundary({ receipt }), null);
  // The real S09 port, wrapped by a reader into S30's shape, is still refused: host control is not denied.
  fake.info().HostConfig.Privileged = false;
  const w = world();
  w.readers.readBoundary = async () => ({ ...await job.inspectBoundary({ receipt }), binding: copy(w.receipt), jobId: 909, observedAt: NOW });
  assert.equal((await createHostedVerification(w.readers).inspectExecution({ ...w.args, boundary: w.live })).reason, 'hosted_credential_boundary_unproven');
});

test('#8345 run step: hosted profiles run only in a trusted JobContainer serving that same profile', async () => {
  const base = { executionIsolation: async () => true, admit: async () => ({ allowed: true }), store: { write() {}, remove() {}, list: () => [] },
    paths: {}, planPath: '/nonexistent', signal: new AbortController().signal };
  const current = id => ({ profile: { id }, identity: { executionDeadline: NOW + 1_000_000 } });
  for (const [id, job] of [['hosted', { boundaryIdentity: () => null }], ['hosted', new JobContainer(POLICY)], ['hosted', new JobContainer(POLICY, { profileId: 'github-8' })],
    ['github-8', new JobContainer(POLICY, { profileId: 'hosted' })], ['macos-arm64', new JobContainer(POLICY)]]) {
    await assert.rejects(runInContainer({ ...base, job, current: current(id) }), /container_profile_mismatch/, `${id} with ${job?.profileId ?? 'fake job'}`);
  }
});
