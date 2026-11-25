/**
 * D8333 (#8333): the capacity sizing model, held to the source it describes. The recorded ceilings are probed
 * against the real validators and coordinator, the per-pass cost is measured on the real `CiCapacity` loop, and
 * receipt admission waiting behind a pass is reproduced. Every provider fact here is synthetic: this measures the
 * coordinator's own behaviour, never a live runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../merge-control/test/runtime-loader.mjs';
import { CiCapacity } from '../../merge-control/src/ciCapacity.ts';
import { CI_CAPACITY_BUDGETS, validateCapacityPolicy } from '../../merge-control/src/lib/ciCapacityPolicy.ts';
import { validateScaleConfig } from '../../merge-control/src/lib/runnerScalePolicy.ts';
import {
  ENFORCED_CEILINGS, MEASURED, PORT_API_CALLS, SLOT_RESOURCES, WINDOWS, coordinatorLoad, erlangC, main, passIntervalForBudget,
  policyCeiling, queueWait, scenario, sizeFor, steadyCallsPerPass,
} from '../../scripts/ci/capacity-scale-model.mjs';

const REPO = 'AxalNetwork/StudioOS';
const SHARDS = Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`);
const policy = (over = {}) => ({ version: 1, maxExternalWorkerShards: 2, maxIncludedWorkerShards: 1, minimumHostedWorkerShards: 1, approvedGroupId: 5, budgets: { ...CI_CAPACITY_BUDGETS }, ...over });
const submission = (n, over = {}) => ({
  version: 1, requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, repository: REPO, parentRunId: 1000 + n, parentAttempt: 1,
  parentWorkflowId: 9, sourceSha: 'a'.repeat(40), queueBaseSha: 'c'.repeat(40), event: 'merge_group', executorSha: 'b'.repeat(40),
  planDigest: 'sha256:' + 'd'.repeat(64), planArtifactId: null, shards: [...SHARDS], prerequisites: ['fast'], ...over,
});

/** The store contract in memory: the coordinator under test is the real one. */
function memoryStore() {
  const rows = new Map(), seen = new Set(), parents = new Map(), children = new Set();
  const settled = (r) => r.completedAt !== null && r.shards.every((s) => s.attempts.every((a) => ['passed', 'failed', 'cancelled'].includes(a.phase)));
  return {
    get: (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null),
    list: () => [...rows.values()].map((r) => structuredClone(r)),
    pending: () => [...rows.values()].filter((r) => !settled(r)).map((r) => structuredClone(r)),
    count: () => rows.size,
    seen: (id) => seen.has(id),
    newerParent: (parent, attempt) => (parents.get(parent) ?? 0) > attempt,
    ownsChild: (child) => children.has(child),
    prune() {},
    save(request) {
      const s = request.submission;
      rows.set(s.requestId, structuredClone(request)); seen.add(s.requestId);
      parents.set(s.parentRunId, Math.max(parents.get(s.parentRunId) ?? 0, s.parentAttempt));
      for (const shard of request.shards) for (const a of shard.attempts) if (a.childRunId !== null) children.add(a.childRunId);
    },
  };
}

/** Counting ports over a fixed clock. Every child is reported running; nothing here is provider truth. */
function harness({ now = 1_800_000_000_000, policyOver = {}, observeGate = null } = {}) {
  const calls = { verify: 0, inventory: 0, parent: 0, prerequisites: 0, dispatch: 0, discover: 0, observe: 0, cancel: 0 };
  let nextChild = 5000;
  const ports = {
    async verify(input) { calls.verify++; return { ...structuredClone(input), parentLive: true, trustedSource: true, executorOnMain: true }; },
    async inventory() { calls.inventory++; return null; },
    async parent() { calls.parent++; return true; },
    async prerequisites(input) { calls.prerequisites++; return input.prerequisites.map((name) => ({ name, conclusion: 'pending' })); },
    async dispatch() { calls.dispatch++; return nextChild++; },
    async discover() { calls.discover++; return null; },
    async observe(receipt) {
      calls.observe++;
      if (observeGate) await observeGate.promise;
      return { receipt, workflowPath: '.github/workflows/runner-executor.yml', workflowAttempt: 1, jobId: 1, runnerProfile: receipt.profile,
        status: 'in_progress', conclusion: null, testStep: 'not_run', jobConclusion: null, startedAt: now };
    },
    async cancel() { calls.cancel++; },
  };
  const store = memoryStore();
  const capacity = new CiCapacity(store, ports, REPO, policy(policyOver), () => now);
  const since = () => { const snapshot = { ...calls }; for (const key of Object.keys(calls)) calls[key] = 0; return snapshot; };
  return { capacity, store, calls, since };
}

test('the recorded ceilings are the limits the validators enforce', async () => {
  // Mutations checked: each recorded ceiling raised by one, and lowered by one, fails its probe below.
  const c = ENFORCED_CEILINGS;
  validateCapacityPolicy(policy({ maxActiveRequests: c.maxActiveRequests, maxExternalWorkerShards: c.maxExternalPerRequest, maxIncludedWorkerShards: c.maxIncludedInFlight }));
  assert.throws(() => validateCapacityPolicy(policy({ maxActiveRequests: c.maxActiveRequests + 1 })), /capacity_policy_refused/);
  assert.throws(() => validateCapacityPolicy(policy({ maxExternalWorkerShards: c.maxExternalPerRequest + 1 })), /capacity_policy_refused/);
  assert.throws(() => validateCapacityPolicy(policy({ maxIncludedWorkerShards: c.maxIncludedInFlight + 1 })), /capacity_policy_refused/);

  // The coordinator admits exactly maxActiveRequests and refuses the next one; it keeps no backlog.
  const h = harness();
  for (let n = 1; n <= c.maxActiveRequests; n++) assert.equal((await h.capacity.submit(submission(n))).accepted, true);
  await assert.rejects(h.capacity.submit(submission(c.maxActiveRequests + 1)), /capacity_active_bound/);
  assert.equal(h.store.count(), c.maxActiveRequests, 'the refused request is not retained anywhere');

  // Six parts named worker-N-of-6: a seventh, or a twelve-part name, is refused.
  const shape = harness();
  assert.equal(SHARDS.length, c.maxShardsPerRequest);
  await assert.rejects(shape.capacity.submit(submission(1, { shards: [...SHARDS, 'worker-7-of-6'] })), /capacity_submission_refused/);
  await assert.rejects(shape.capacity.submit(submission(1, { shards: ['worker-1-of-12'] })), /capacity_submission_refused/);

  const image = { approved: true, version: 'v1', digest: 'sha256:' + 'e'.repeat(64), os: 'linux', arch: 'x64', runnerVersion: '2.300.0', runnerDigest: 'f'.repeat(64), nodeVersion: '22.1.0', pythonVersion: '3.11.1' };
  const fleet = (over = {}) => ({ enabled: false, approvedCap: c.fleetStageMax, stage: c.fleetStageMax, minHostedShards: 1, maxExternalPerRun: 2, perRunPerProfile: 1, maxNewPerInterval: 1,
    intervalMs: 1, cooldownMs: 0, warmupMs: 1, heartbeatMs: 1, idleMs: 1, lifetimeMs: 1, maxRetries: 0, profiles: { 'linux-x64': { min: 0, max: c.fleetStageMax, image } },
    budget: { approved: false, meterVerified: false, remainingUnits: null, unitsPerNodeMinute: null, expiresAt: null, maxJobMs: 1, terminationMs: 1, billingLagMs: 0 }, ...over });
  validateScaleConfig(fleet());
  assert.throws(() => validateScaleConfig(fleet({ stage: c.fleetStageMax * 2, approvedCap: c.fleetStageMax * 2 })), /invalid_scale_config/);
  assert.throws(() => validateScaleConfig(fleet({ approvedCap: c.fleetStageMax + 1 })), /invalid_scale_config/);
});

test('the recorded windows and slot resources are the source\'s', () => {
  for (const key of Object.keys(WINDOWS)) assert.equal(WINDOWS[key], CI_CAPACITY_BUDGETS[key], key);
  const container = readFileSync(new URL('../../scripts/ci/runners/job-container.mjs', import.meta.url), 'utf8');
  assert.ok(container.includes(`'--pids-limit','${SLOT_RESOURCES.pids}','--memory','${SLOT_RESOURCES.memoryGiB * 2 ** 30}','--cpus','${SLOT_RESOURCES.cpus}'`));
  assert.ok(container.includes(`'--tmpfs','/work:rw,nosuid,nodev,size=${SLOT_RESOURCES.workTmpfsGiB * 2 ** 30},`));
});

test('measured: a steady pass costs one parent, one prerequisites and one observe per shard, for every active request', async () => {
  // Mutation checked: a request left out of the pass, or an observe skipped, changes these counts.
  for (const active of [1, 4, 8]) {
    const h = harness();
    for (let n = 1; n <= active; n++) await h.capacity.submit(submission(n));
    h.since();
    await h.capacity.tick();
    const dispatchPass = h.since();
    assert.equal(dispatchPass.dispatch, active * 6, 'every shard is dispatched on the first pass');
    await h.capacity.tick();
    const steady = h.since();
    assert.deepEqual({ parent: steady.parent, prerequisites: steady.prerequisites, observe: steady.observe }, { parent: active, prerequisites: active, observe: active * 6 });
    assert.equal(steady.dispatch + steady.discover + steady.cancel, 0, 'a steady pass changes nothing');
    // The model's per-pass REST figure is these port counts priced by the adapter's measured calls per port.
    const priced = steady.parent * PORT_API_CALLS.parent.merge_group + steady.prerequisites * PORT_API_CALLS.prerequisites + steady.observe * PORT_API_CALLS.observe;
    assert.equal(priced, active * steadyCallsPerPass({ shards: 6, event: 'merge_group' }));
  }
  assert.equal(steadyCallsPerPass({ shards: 6, event: 'push' }), 15, 'the 15 calls measured at 8c11 with the push fixture');
});

test('measured: an executor\'s receipt admission waits for the whole pass in front of it', async () => {
  // Mutation checked: with the gate already open the receipt resolves before the pass is released.
  let release; const gate = { promise: new Promise((resolve) => { release = resolve; }) };
  const h = harness({ observeGate: gate });
  await h.capacity.submit(submission(1));
  release(); await h.capacity.tick(); // dispatch: children 5000..5005 now exist
  let hold; gate.promise = new Promise((resolve) => { hold = resolve; });
  const pass = h.capacity.tick();
  let admitted = false;
  const receipt = h.capacity.receipt(submission(1).requestId, 'worker-1-of-6', 5000, 1).then((value) => { admitted = true; return value; });
  for (let i = 0; i < 200; i++) await Promise.resolve();
  assert.equal(admitted, false, 'the receipt lookup is queued behind the pass, however long its API calls take');
  hold(); await pass;
  const value = await receipt;
  assert.equal(admitted, true);
  assert.equal(value?.childRunId, 5000);
});

test('the model: ceilings, coordinator load, queueing and sizing', () => {
  assert.deepEqual(policyCeiling(), { logicalAssignments: 48, externalRunning: 17, selfHostedRunning: 16, binding: 'maxActiveRequests x maxExternalPerRequest' });
  assert.equal(policyCeiling({ ...ENFORCED_CEILINGS, maxActiveRequests: 80 }).binding, 'fleetStageMax x slotsPerFleetNode');

  // Eight merge-queue requests: 8 x 16 calls a pass. At 150 ms a call the pass lasts 19.2 s, already longer than
  // the 15 s cadence, so the loop saturates at one call per 150 ms: 24,000 an hour against a 15,000 budget.
  const eight = coordinatorLoad({ activeRequests: 8, apiBudgetPerHour: 15_000 });
  assert.equal(eight.callsPerPass, 128);
  assert.equal(eight.passDurationMs, 19_200);
  assert.equal(eight.callsPerHour, 24_000);
  assert.equal(eight.budgetUse, 1.6);
  assert.equal(eight.maxRequestsWithinBudget, 3);
  // Three requests fit: 48 calls a pass, 240 passes an hour.
  assert.equal(coordinatorLoad({ activeRequests: 3, apiBudgetPerHour: 15_000 }).callsPerHour, 11_520);
  assert.equal(coordinatorLoad({ activeRequests: 1, apiBudgetPerHour: 5_000 }).maxRequestsWithinBudget, 1);
  // A pass longer than the cadence slows the cadence; it never overlaps itself.
  const eighty = coordinatorLoad({ activeRequests: 80, apiBudgetPerHour: 15_000 });
  assert.equal(eighty.passDurationMs, 80 * 16 * 150);
  assert.equal(eighty.callsPerHour, Math.round(1280 * (3_600_000 / eighty.passDurationMs)));
  assert.equal(eighty.maxRequestsWithinStartWindow, 37);
  assert.equal(passIntervalForBudget({ activeRequests: 80, apiBudgetPerHour: 15_000 }), 307_200);
  assert.equal(passIntervalForBudget({ activeRequests: 80, apiBudgetPerHour: 15_000, callsPerRequestPerPass: 1 }), 19_200);

  assert.equal(erlangC(1, 0.5), 0.5);
  assert.ok(Math.abs(erlangC(2, 1) - 1 / 3) < 1e-12);
  assert.equal(erlangC(10, 10), 1);
  const steady = queueWait({ arrivalsPerHour: 120, serviceMinutes: 25, slots: 60 });
  assert.equal(steady.offered, 50);
  assert.ok(steady.stable && steady.meanWaitMinutes > 0 && steady.meanWaitMinutes < 1);
  assert.equal(queueWait({ arrivalsPerHour: 240, serviceMinutes: 25, slots: 60 }).stable, false);
  // Today's busiest measured hour, Worker shards only, on 120 slots.
  const busiest = queueWait({ arrivalsPerHour: MEASURED.workerShardsCompletedPerHour.busiest, serviceMinutes: MEASURED.workerShardMinutes.p50, slots: 120 });
  assert.ok(busiest.stable && busiest.utilisation < 0.65 && busiest.meanWaitMinutes < 0.01);

  assert.deepEqual(sizeFor({ targetRunning: 120, slotsPerMachine: 4 }), { slots: 150, machines: 39, perMachine: { cpus: 10, memoryGiB: 20, pids: 1024 }, total: { cpus: 300, memoryGiB: 600 } });
  assert.throws(() => sizeFor({ targetRunning: 120, slotsPerMachine: 0 }), /invalid_size_input/);

  for (const target of [120, 240, 480]) {
    const row = scenario({ targetRunning: target });
    assert.equal(row.activeRequests, target / 6);
    assert.ok(row.blockers.some((b) => b.startsWith('policy allows 17 external running jobs')), `${target}: the policy ceiling is reported`);
    assert.ok(row.blockers.some((b) => b.startsWith('polling needs')), `${target}: the API budget is reported`);
  }
  assert.deepEqual(scenario({ targetRunning: 12, slotsPerMachine: 4, apiBudgetPerHour: 15_000 }).blockers, [], 'two requests fit every enforced limit and the budget');
  // The measured median Worker shard does not fit the external execution lease.
  assert.ok(MEASURED.workerShardMinutes.p50 * 60_000 > WINDOWS.externalExecutionMs);
});

test('the CLI prints the planning rows and refuses a bad target', () => {
  const lines = [];
  assert.equal(main([], (line) => lines.push(line)), 0);
  assert.match(lines[0], /^Enforced today: 48 logical assignments, 17 external running jobs/);
  assert.equal(lines.filter((l) => /^(120|240|480) running: /.test(l)).length, 3);
  assert.ok(lines.some((l) => l.startsWith('  blocked: ')));
  assert.throws(() => main(['0'], () => {}), /usage/);
});
