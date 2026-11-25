/** D7887: deterministic pool, durable recovery, fencing, fallback and full-set authority tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CiCapacity, SqlCapacityStore, CAPACITY_RETENTION_MS } from '../src/ciCapacity.ts';
import type { CapacityPorts } from '../src/ciCapacity.ts';
import {
  CI_CAPACITY_BUDGETS, CapacityDispatchRefused, activeAttempt, aggregateCapacity, receiptMatches, selectPools, submissionMatches, validateCapacityPolicy,
} from '../src/lib/ciCapacityPolicy.ts';
import type {
  CapacityInventory, CapacityPolicy, ChildObservation, CiAttempt,
  CiSubmission, ExecutionReceipt, PrerequisiteResult,
} from '../src/lib/ciCapacityPolicy.ts';

const repository = 'AxalNetwork/StudioOS';
const input = (): CiSubmission => ({
  version: 1, requestId: '00000000-0000-4000-8000-000000000001', repository,
  parentRunId: 12, parentAttempt: 1, parentWorkflowId: 9, event: 'push',
  sourceSha: 'a'.repeat(40), queueBaseSha: null, executorSha: 'b'.repeat(40), planDigest: `sha256:${'c'.repeat(64)}`, planArtifactId: 45,
  shards: Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`),
  prerequisites: ['fast', 'test deps', 'api ↔ worker drift'],
});
const policy = (): CapacityPolicy => ({
  version: 1, maxExternalWorkerShards: 2, maxIncludedWorkerShards: 0, minimumHostedWorkerShards: 1, approvedGroupId: 77,
  budgets: { ...CI_CAPACITY_BUDGETS },
});
const inventory = (now: number): CapacityInventory => ({ observedAt: now, complete: true, runners: [
  { id: 1, profile: 'macos-arm64', groupId: 77, online: true, busy: false, draining: false },
  { id: 2, profile: 'linux-x64', groupId: 77, online: true, busy: false, draining: false },
  { id: 3, profile: 'linux-x64', groupId: 77, online: true, busy: false, draining: false },
] });
function fixture(t: { after(fn: () => void): void }, patch: Partial<CapacityPolicy> = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      const rows = db.prepare(query).all(...values); return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as Pick<DurableObjectStorage, 'sql' | 'transactionSync'>;
  const store = new SqlCapacityStore(storage);
  const state = { now: 1_000_000, live: true, trusted: true, inventoryDown: false, parentDown: false,
    dispatchDown: false, cancelDown: false, nextId: 100, discovered: null as Awaited<ReturnType<CapacityPorts['discover']>>,
    prerequisites: null as PrerequisiteResult[] | null };
  const dispatched: CiAttempt[] = [], cancelled: ExecutionReceipt[] = [], observed: number[] = [];
  const outcomes = new Map<number, ChildObservation>();
  const ports: CapacityPorts = {
    async verify(s) { return { ...structuredClone(s), parentLive: state.live, trustedSource: state.trusted, executorOnMain: true }; },
    async inventory() { if (state.inventoryDown) throw new Error('unavailable'); return inventory(state.now); },
    async parent() { if (state.parentDown) throw new Error('unavailable'); return state.live; },
    async prerequisites() { return state.prerequisites; },
    async dispatch(a) {
      const persisted = store.get(a.requestId)!;
      assert.equal(activeAttempt(persisted.shards.find(s => s.name === a.logicalShard)!).phase, 'dispatching');
      dispatched.push(structuredClone(a));
      if (state.dispatchDown) throw new Error('unknown after network send');
      return state.nextId++;
    },
    async discover() { return state.discovered; },
    async observe(r) {
      assert.equal(store.get(r.requestId)!.shards.flatMap(s => s.attempts).some(a => a.childRunId === r.childRunId), true);
      observed.push(r.childRunId); return outcomes.get(r.childRunId) ?? null;
    },
    async cancel(r) {
      assert.equal(activeAttempt(store.get(r.requestId)!.shards.find(s => s.name === r.logicalShard)!).phase.startsWith('cancel'), true);
      cancelled.push(structuredClone(r)); if (state.cancelDown) throw new Error('unavailable');
    },
  };
  const create = () => new CiCapacity(new SqlCapacityStore(storage), ports, repository, { ...policy(), ...patch }, () => state.now);
  const get = (id = input().requestId) => store.get(id)!;
  const attempt = (name: string) => activeAttempt(get().shards.find(s => s.name === name)!);
  const observation = (a: CiAttempt, patch: Partial<ChildObservation> = {}): ChildObservation => ({
    receipt: structuredClone(a) as ExecutionReceipt,
    workflowPath: '.github/workflows/runner-executor.yml', workflowAttempt: 1, jobId: a.childRunId! + 1000,
    runnerProfile: a.profile, status: 'completed', conclusion: 'success', jobConclusion: 'success',
    testStep: 'success', startedAt: get(a.requestId).acceptedAt, completedAt: state.now, cleanupConfirmed: true, ...patch,
  });
  return { db, storage, store, state, ports, dispatched, cancelled, observed, outcomes, create, get, attempt, observation };
}

test('pool selection reserves free hosted work, delegates at most two, and auto-discovers compatible machines', () => {
  const s = input(), p = policy(), i = inventory(100);
  const selected = selectPools(s, true, i, {}, p, 100);
  assert.deepEqual(selected.filter(a => a.profile !== 'hosted'), [
    { shard: 'worker-1-of-6', profile: 'macos-arm64' }, { shard: 'worker-2-of-6', profile: 'linux-x64' },
  ]);
  assert.equal(selected.filter(a => a.shard.startsWith('worker-') && a.profile === 'hosted').length, 4);
  assert.equal(selected.filter(a => !a.shard.startsWith('worker-')).every(a => a.profile === 'hosted'), true);
  const single = selectPools({ ...s, shards: ['worker-1-of-6'] }, true, i, {}, p, 100);
  assert.equal(single[0].profile, 'hosted');
  i.runners = i.runners.map(r => ({ ...r, id: r.id + 100 }));
  assert.deepEqual(selectPools(s, true, i, {}, p, 100), selected);
  p.maxExternalWorkerShards = 0;
  assert.equal(selectPools(s, true, i, {}, p, 100).every(a => a.profile === 'hosted'), true);
});

test('unknown, stale, offline, busy, draining and unapproved inventory all select hosted before dispatch', () => {
  const s = input(), p = policy();
  const cases: (CapacityInventory | null)[] = [null, { ...inventory(100), complete: false }, inventory(-30_000), inventory(100_001),
    { ...inventory(100), runners: inventory(100).runners.map(r => ({ ...r, online: false })) },
    { ...inventory(100), runners: inventory(100).runners.map(r => ({ ...r, busy: true })) },
    { ...inventory(100), runners: inventory(100).runners.map(r => ({ ...r, draining: true })) },
    { ...inventory(100), runners: inventory(100).runners.map(r => ({ ...r, groupId: 78 })) },
    { ...inventory(100), runners: [inventory(100).runners[0], inventory(100).runners[0]] },
  ];
  for (const inv of cases) assert.equal(selectPools(s, true, inv, {}, p, 100).every(a => a.profile === 'hosted'), true);
  for (const event of ['push', 'merge_group'] as const) {
    assert.equal(selectPools({ ...s, event }, false, inventory(100), {}, p, 100).every(a => a.profile === 'hosted'), true);
  }
  assert.equal(selectPools({ ...s, event: 'pull_request' as CiSubmission['event'] }, true, inventory(100), {}, p, 100).every(a => a.profile === 'hosted'), true);
  assert.equal(selectPools(s, true, inventory(100), { 'linux-x64': 2, 'macos-arm64': 1 }, p, 100).every(a => a.profile === 'hosted'), true);
});

test('hosted share and fallback budgets cannot be configured away', () => {
  validateCapacityPolicy(policy());
  for (const patch of [{ minimumHostedWorkerShards: 0 }, { maxExternalWorkerShards: 3 }, { approvedGroupId: 0 }]) {
    assert.throws(() => validateCapacityPolicy({ ...policy(), ...patch }));
  }
  for (const budgets of [{ ...CI_CAPACITY_BUDGETS, externalStartMs: 30 * 60_000 },
    { ...CI_CAPACITY_BUDGETS, queueMs: 91 * 60_000 }, { ...CI_CAPACITY_BUDGETS, cancellationMs: 0 }]) {
    assert.throws(() => validateCapacityPolicy({ ...policy(), budgets }));
  }
  validateCapacityPolicy({ ...policy(), budgets: { ...CI_CAPACITY_BUDGETS, externalStartMs: 120_000 } });
});

test('submission binds provenance, artifact and the exact expected set', () => {
  const s = input(), proof = { ...s, parentLive: true, trustedSource: true, executorOnMain: true };
  assert.equal(submissionMatches(s, proof, repository), true);
  for (const patch of [
    { repository: 'outsider/repo' }, { sourceSha: 'd'.repeat(40) }, { parentRunId: 13 }, { parentAttempt: 2 },
    { parentWorkflowId: 10 }, { executorSha: 'd'.repeat(40) }, { planDigest: `sha256:${'d'.repeat(64)}` },
    { planArtifactId: 99 }, { shards: s.shards.slice(1) }, { prerequisites: ['fast'] }, { event: 'merge_group' as const },
  ]) assert.equal(submissionMatches({ ...s, ...patch }, proof, repository), false);
  for (const patch of [{ executorOnMain: false }, { parentLive: false }]) {
    assert.equal(submissionMatches(s, { ...proof, ...patch }, repository), false);
  }
  for (const patch of [{ requestId: '../invalid' }, { shards: ['worker-3-of-6', 'worker-3-of-6'] }, { shards: ['shell-command'] },
    { prerequisites: [] }, { planArtifactId: null }]) assert.equal(submissionMatches({ ...s, ...patch }, proof, repository), false);
  const merge = { ...s, event: 'merge_group' as const, planArtifactId: null, queueBaseSha: 'e'.repeat(40) };
  assert.equal(submissionMatches(merge, { ...proof, ...merge }, repository), true);
  assert.equal(submissionMatches({ ...merge, queueBaseSha: null }, { ...proof, ...merge }, repository), false);
  assert.equal(submissionMatches({ ...merge, queueBaseSha: 'f'.repeat(40) }, { ...proof, ...merge }, repository), false);
});

test('acceptance commits before any remote execution, survives restart, dedupes and rejects conflicting ownership', async t => {
  const f = fixture(t), c = f.create(), s = input();
  assert.deepEqual(await c.submit(s), { accepted: true, requestId: s.requestId });
  assert.equal(f.dispatched.length, 0);
  assert.equal(c.status(s.requestId)?.status, 'pending');
  const restarted = f.create();
  await restarted.submit({ ...s, shards: [...s.shards].reverse() });
  assert.equal(f.store.list().length, 1);
  await assert.rejects(restarted.submit({ ...s, planArtifactId: 46 }), /conflict/);
  await assert.rejects(restarted.submit({ ...s, requestId: '00000000-0000-4000-8000-000000000002' }), /parent_conflict/);
  await restarted.tick();
  assert.equal(f.dispatched.length, s.shards.length);
  assert.equal(f.get().shards.every(shard => activeAttempt(shard).childRunId !== null), true);
  assert.equal(f.observed.length, 0);
  await restarted.tick();
  assert.equal(f.observed.length, s.shards.length);
  assert.equal(f.dispatched.length, s.shards.length);
});

test('simultaneous submissions subtract durable reservations from the same idle snapshot', async t => {
  const f = fixture(t), c = f.create(), s = input();
  await Promise.all([c.submit(s), c.submit({ ...s, parentRunId: 13, requestId: '00000000-0000-4000-8000-000000000002' })]);
  const requests = f.store.list();
  assert.equal(requests.flatMap(r => r.shards).filter(shard => activeAttempt(shard).profile === 'macos-arm64').length, 1);
  assert.equal(requests.flatMap(r => r.shards).filter(shard => activeAttempt(shard).profile === 'linux-x64').length, 2);
  assert.equal(requests[1].shards.filter(shard => activeAttempt(shard).profile !== 'hosted').length, 1);
});

test('inventory outage chooses hosted and unreadable parent blocks dispatch and receipt admission', async t => {
  const f = fixture(t), c = f.create(), s = input(); f.state.inventoryDown = true;
  await c.submit(s);
  assert.equal(f.get().shards.every(shard => activeAttempt(shard).profile === 'hosted'), true);
  f.state.parentDown = true; await c.tick(); assert.equal(f.dispatched.length, 0);
  f.state.parentDown = false; await c.tick();
  const a = f.attempt('worker-3-of-6');
  assert.equal((await c.receipt(s.requestId, 'worker-3-of-6', a.childRunId!, 1))?.childRunId, a.childRunId);
  f.state.parentDown = true; assert.equal(await c.receipt(s.requestId, 'worker-3-of-6', a.childRunId!, 1), null);
  f.state.parentDown = false; f.state.live = false;
  assert.equal(await c.receipt(s.requestId, 'worker-3-of-6', a.childRunId!, 1), null);
  await c.tick();
  assert.equal(c.status(s.requestId)?.status, 'cancelled');
  assert.equal(f.cancelled.length, s.shards.length);
});

test('ambiguous dispatch and interrupted durable intent are reconciled without repeating the remote effect', async t => {
  const f = fixture(t), c = f.create(), s = { ...input(), shards: ['worker-3-of-6'] };
  f.state.dispatchDown = true;
  await c.submit(s); await c.tick();
  assert.equal(f.attempt('worker-3-of-6').phase, 'dispatch_unknown');
  const restarted = f.create(); await restarted.tick();
  assert.equal(f.dispatched.length, 1);
  const request = f.get(); activeAttempt(request.shards[0]).phase = 'dispatching'; f.store.save(request);
  await f.create().tick(); assert.equal(f.dispatched.length, 1);
  f.state.discovered = 812;
  await restarted.tick();
  assert.equal(f.attempt('worker-3-of-6').childRunId, 812);
  assert.equal(f.dispatched.length, 1);
  assert.equal(await restarted.receipt(s.requestId, 'worker-3-of-6', 811, 1), null);
  assert.equal(await restarted.receipt(s.requestId, 'worker-3-of-6', 812, 2), null);
  assert.equal((await restarted.receipt(s.requestId, 'worker-3-of-6', 812, 1))?.childRunId, 812);
});

test('external start timeout fences only its child and waits for verified terminal cancellation before hosted fallback', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const original = f.attempt('worker-1-of-6'); f.state.now = original.startDeadline;
  await c.tick();
  assert.equal(f.cancelled.some(r => r.childRunId === original.childRunId), true);
  assert.equal(f.cancelled.every(r => f.dispatched.some(d => d.logicalShard === r.logicalShard && d.profile !== 'hosted')), true);
  assert.equal(await c.receipt(s.requestId, original.logicalShard, original.childRunId!, 1), null);
  assert.equal(f.attempt(original.logicalShard).generation, 1);
  f.outcomes.set(original.childRunId!, f.observation(original, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
  await f.create().tick();
  const fallback = f.attempt(original.logicalShard);
  assert.equal(fallback.generation, 2); assert.equal(fallback.profile, 'hosted');
  assert.notEqual(fallback.childRunId, original.childRunId);
  for (const field of ['sourceSha', 'queueBaseSha', 'planDigest', 'planArtifactId', 'executorSha', 'parentAttempt'] as const) {
    assert.equal(fallback[field], original[field]);
  }
  assert.equal(await c.receipt(s.requestId, original.logicalShard, original.childRunId!, 1), null);
  assert.equal((await c.receipt(s.requestId, original.logicalShard, fallback.childRunId!, 1))?.generation, 2);
});

test('node loss, unknown tests and cancellation outage never manufacture a replacement or success', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const original = f.attempt('worker-1-of-6'); f.state.cancelDown = true;
  f.state.now = original.startDeadline; await c.tick();
  f.state.now += policy().budgets.cancellationMs; await c.tick();
  assert.equal(f.attempt(original.logicalShard).phase, 'cancellation_unknown');
  f.outcomes.set(original.childRunId!, f.observation(original, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'unknown' }));
  await c.tick(); assert.equal(f.attempt(original.logicalShard).generation, 1);
  assert.equal(c.status(s.requestId)?.status, 'pending');
  f.state.now = f.get().deadline;
  assert.equal(f.create().status(s.requestId)?.status, 'failure');
  await c.tick(); assert.equal(f.attempt(original.logicalShard).generation, 1);
});

test('running node execution deadline is bounded and does not move on duplicate or out-of-order observations', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-1-of-6');
  const running = f.observation(a, { status: 'in_progress', conclusion: null, jobConclusion: null, testStep: 'unknown' });
  f.outcomes.set(a.childRunId!, running); await c.tick();
  assert.equal(f.attempt(a.logicalShard).phase, 'running');
  f.state.now = a.startDeadline + 1; await c.tick();
  assert.equal(f.attempt(a.logicalShard).phase, 'running');
  f.outcomes.set(a.childRunId!, { ...running, status: 'queued' }); await c.tick();
  assert.equal(f.attempt(a.logicalShard).phase, 'running');
  assert.equal(f.attempt(a.logicalShard).executionDeadline, a.executionDeadline);
  f.state.now = a.executionDeadline; await c.tick();
  assert.equal(f.cancelled.some(r => r.childRunId === a.childRunId), true);
});

test('verified test failure cannot become infrastructure fallback or be overwritten by a successful report', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-1-of-6');
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure' }));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'failure');
  f.outcomes.set(a.childRunId!, f.observation(a)); await c.tick();
  assert.equal(f.attempt(a.logicalShard).phase, 'failed');
  assert.equal(f.attempt(a.logicalShard).generation, 1);
  assert.equal(await c.receipt(s.requestId, 'worker-3-of-6', f.attempt('worker-3-of-6').childRunId!, 1), null);
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('late old-generation success cannot satisfy a replacement, and contradictory old test failure is sticky', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-1-of-6'); f.state.now = a.startDeadline;
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run' }));
  await c.tick();
  assert.equal(f.attempt(a.logicalShard).generation, 2);
  f.outcomes.set(a.childRunId!, f.observation(a));
  assert.equal(await c.reconcileChild(s.requestId, a.childRunId!), false);
  assert.equal(f.attempt(a.logicalShard).phase, 'queued');
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure' }));
  assert.equal(await c.reconcileChild(s.requestId, a.childRunId!), true);
  assert.equal(f.get().evidenceConflict, true);
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('unowned events, wrong workflow, child attempt, profile and altered receipt are rejected', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-3-of-6');
  assert.equal(await c.reconcileChild(s.requestId, 999999), false);
  for (const patch of [{ workflowPath: '.github/workflows/deploy.yml' }, { workflowAttempt: 2 },
    { runnerProfile: 'linux-x64' as const }, { jobId: 0 },
    { receipt: { ...f.observation(a).receipt, sourceSha: 'd'.repeat(40) } },
    { receipt: { ...f.observation(a).receipt, generation: 2 } },
    { receipt: { ...f.observation(a).receipt, executionDeadline: a.executionDeadline + 1 } },
  ]) {
    f.outcomes.set(a.childRunId!, f.observation(a, patch));
    assert.equal(await c.reconcileChild(s.requestId, a.childRunId!), false);
  }
  assert.equal(f.attempt('worker-3-of-6').phase, 'queued');
  assert.equal(c.status(s.requestId)?.status, 'pending');
});

test('every expected logical shard and prerequisite is required, independent of successful submission and duplicate results', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  for (const shard of f.get().shards.slice(1)) {
    const a = activeAttempt(shard); f.outcomes.set(a.childRunId!, f.observation(a));
  }
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'pending');
  const a = f.attempt('worker-1-of-6'); f.outcomes.set(a.childRunId!, f.observation(a));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'pending');
  f.state.prerequisites = s.prerequisites.map(name => ({ name, conclusion: 'success' as const }));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'success');
  const beforeDeadline = f.state.now;
  f.state.now = f.get().deadline + 1;
  assert.equal(f.create().status(s.requestId)?.status, 'success');
  f.state.now = beforeDeadline;
  assert.equal(await c.reconcileChild(s.requestId, a.childRunId!), false);
  assert.equal(f.get().shards.every(shard => shard.attempts.filter(attempt => attempt.phase === 'passed').length === 1), true);
  const damaged = f.get(); damaged.shards.push({ ...structuredClone(damaged.shards[0]), name: 'unexpected' });
  assert.equal(aggregateCapacity(damaged, f.state.now).status, 'failure');
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure' }));
  await c.reconcileChild(s.requestId, a.childRunId!);
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('later parent attempt supersedes durable ownership and fences older receipt', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-3-of-6');
  const replacement = { ...s, requestId: '00000000-0000-4000-8000-000000000002', parentAttempt: 2 };
  await c.submit(replacement);
  assert.equal(c.status(s.requestId)?.status, 'cancelled');
  assert.equal(await c.receipt(s.requestId, 'worker-3-of-6', a.childRunId!, 1), null);
  await c.tick(); assert.equal(f.cancelled.some(r => r.childRunId === a.childRunId), true);
  assert.equal(c.status(replacement.requestId)?.status, 'pending');
});

test('deadline expiry and late success never publish a false pass', async t => {
  const f = fixture(t), c = f.create(), s = { ...input(), shards: ['worker-3-of-6'] }; await c.submit(s); await c.tick();
  const a = f.attempt('worker-3-of-6'); f.state.now = a.executionDeadline;
  f.outcomes.set(a.childRunId!, f.observation(a)); await c.tick();
  assert.notEqual(f.attempt('worker-3-of-6').phase, 'passed');
  f.state.now = f.get().deadline;
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('a crash before the old superseded flag commits cannot revive the previous parent attempt', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-3-of-6');
  const next = { ...structuredClone(f.get()), submission: { ...s, parentAttempt: 2, requestId: '00000000-0000-4000-8000-000000000002' } };
  for (const shard of next.shards) for (const attempt of shard.attempts) attempt.childRunId = null;
  f.store.save(next); // Represents the committed new identity, before the old cached flag update.
  assert.equal(f.get().superseded, false);
  assert.equal(await f.create().receipt(s.requestId, 'worker-3-of-6', a.childRunId!, 1), null);
  assert.equal(f.create().status(s.requestId)?.status, 'cancelled');
});

test('duplicate returned child identity cannot own two logical shards', async t => {
  const f = fixture(t), s = input(); f.ports.dispatch = async () => 888;
  const c = f.create(); await c.submit(s); await c.tick();
  assert.equal(f.get().shards.flatMap(shard => shard.attempts).filter(a => a.childRunId === 888).length, 1);
  assert.equal(f.get().shards.filter(shard => activeAttempt(shard).phase === 'dispatch_unknown').length, s.shards.length - 1);
  assert.equal(c.status(s.requestId)?.status, 'pending');
});

test('bad inventory types and incomplete budgets fail closed', () => {
  const i = inventory(100);
  i.runners[0].online = 'true' as unknown as boolean;
  assert.equal(selectPools(input(), true, i, {}, policy(), 100).every(a => a.profile === 'hosted'), true);
  const p = policy(); delete (p.budgets as Partial<typeof p.budgets>).queueMs;
  assert.throws(() => validateCapacityPolicy(p));
});

test('failed or incomplete prerequisites do not clear the aggregate', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  for (const shard of f.get().shards) {
    const a = activeAttempt(shard); f.outcomes.set(a.childRunId!, f.observation(a));
  }
  f.state.prerequisites = [{ name: 'fast', conclusion: 'success' }];
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'pending');
  f.state.prerequisites = s.prerequisites.map(name => ({ name, conclusion: name === 'fast' ? 'failure' : 'success' }));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'failure');
  f.state.prerequisites = s.prerequisites.map(name => ({ name, conclusion: 'success' }));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('late-starting or job-only success is insufficient verified test evidence', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('worker-3-of-6');
  f.outcomes.set(a.childRunId!, f.observation(a, { testStep: 'unknown' }));
  await c.reconcileChild(s.requestId, a.childRunId!);
  assert.equal(f.attempt('worker-3-of-6').phase, 'cancellation_unknown');
  const other = f.attempt('worker-4-of-6');
  f.outcomes.set(other.childRunId!, f.observation(other, { startedAt: other.startDeadline + 1 }));
  await c.reconcileChild(s.requestId, other.childRunId!);
  assert.notEqual(f.attempt(other.logicalShard).phase, 'passed');
});


test('successful prerequisites cannot substitute for a missing logical shard', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  f.state.prerequisites = s.prerequisites.map(name => ({ name, conclusion: 'success' }));
  for (const shard of f.get().shards.slice(1)) {
    const a = activeAttempt(shard); f.outcomes.set(a.childRunId!, f.observation(a));
  }
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'pending');
  const last = f.attempt('worker-1-of-6'); f.outcomes.set(last.childRunId!, f.observation(last));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'success');
});

test('every immutable receipt field participates in equality', async t => {
  const f = fixture(t), c = f.create(); await c.submit(input()); await c.tick();
  const receipt = f.observation(f.attempt('worker-3-of-6')).receipt;
  assert.equal(receiptMatches(receipt, structuredClone(receipt)), true);
  for (const field of Object.keys(receipt) as (keyof ExecutionReceipt)[]) {
    if (['phase', 'cancelDeadline', 'reason'].includes(field)) continue;
    const changed = { ...receipt, [field]: typeof receipt[field] === 'number' ? Number(receipt[field]) + 1 : `${receipt[field]}-other` };
    assert.equal(receiptMatches(receipt, changed as ExecutionReceipt), false, field);
  }
});


test('D7903 terminal infrastructure failure gets one hosted fallback while unknown test truth stays fenced', async t => {
  const f = fixture(t), c = f.create(); await c.submit(input()); await c.tick();
  const a = f.attempt('worker-1-of-6'), unknown = f.attempt('worker-2-of-6');
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'not_run' }));
  f.outcomes.set(unknown.childRunId!, f.observation(unknown, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'unknown' }));
  await c.tick();
  const current = f.attempt(a.logicalShard);
  assert.equal(current.generation, 2); assert.equal(current.profile, 'hosted');
  assert.equal(f.get().shards[0].attempts[0].reason, 'infrastructure_failed');
  assert.equal(f.attempt(unknown.logicalShard).generation, 1);
  assert.equal(f.cancelled.some(r => r.childRunId === unknown.childRunId), true);
  assert.equal(c.status(input().requestId)?.status, 'pending');
  f.outcomes.set(current.childRunId!, f.observation(current, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'not_run' }));
  await c.tick(); assert.equal(f.attempt(a.logicalShard).generation, 2);
  assert.equal(c.status(input().requestId)?.status, 'failure');
});

test('D7903 running attempts are represented by busy inventory, not subtracted twice', async t => {
  const f = fixture(t), c = f.create();
  f.ports.inventory = async () => ({observedAt:f.state.now,complete:true,runners:[
    {id:1,profile:'linux-x64',groupId:77,online:true,busy:false,draining:false},
    {id:2,profile:'linux-x64',groupId:77,online:true,busy:false,draining:false},
  ]});
  await c.submit(input()); const first=f.get();
  for (const shard of first.shards) { const a=activeAttempt(shard); if(a.profile==='linux-x64') a.phase='running'; }
  f.store.save(first);
  f.ports.inventory = async () => ({observedAt:f.state.now,complete:true,runners:[
    {id:1,profile:'linux-x64',groupId:77,online:true,busy:true,draining:false},
    {id:2,profile:'linux-x64',groupId:77,online:true,busy:false,draining:false},
  ]});
  const second={...input(),requestId:'00000000-0000-4000-8000-000000000002',parentRunId:13};
  await c.submit(second);
  assert.equal(f.get(second.requestId).shards.filter(s=>activeAttempt(s).profile==='linux-x64').length,1);
});

test('D7903 only the six agreed Worker shards on push or merge_group enter the coordinator', () => {
  for(const patch of [{shards:['rest']},{shards:['frontend-1-of-2']},{shards:['worker-7-of-6']},
    {shards:['worker-1-of-7']},{event:'pull_request' as CiSubmission['event']}]) {
    const s={...input(),...patch};
    assert.equal(submissionMatches(s,{...s,parentLive:true,trustedSource:true,executorOnMain:true},repository),false);
  }
});

test('D7903 full retained storage refuses admission but continues active reconciliation and retains identity fences after pruning', async t => {
  const f=fixture(t),c=new CiCapacity(f.store,f.ports,repository,policy(),()=>f.state.now); await c.submit(input());
  const base=f.get();
  for(let i=2;i<=1000;i++) {
    const old=structuredClone(base);old.submission.requestId=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    old.submission.parentRunId=i+100;old.completedAt=f.state.now;
    for(const shard of old.shards) for(const a of shard.attempts) {
      a.requestId=old.submission.requestId;a.parentRunId=old.submission.parentRunId;a.phase='passed';a.childRunId=i*10+Number(shard.name.split('-')[1]);
    }
    f.store.save(old);
  }
  const next={...input(),requestId:'00000000-0000-4000-8000-000000001001',parentRunId:9999};
  const overflow=structuredClone(base); overflow.submission=next;
  assert.throws(()=>f.store.save(overflow),/capacity_storage_bound/);
  await assert.rejects(c.submit(next),/capacity_storage_bound/);
  assert.equal(f.store.count(),1000);
  // A full history cannot halt a currently owned child, nor trigger historical table scans.
  f.store.list=()=>{throw Error('unexpected full scan');};
  await c.tick(); assert.equal(f.dispatched.length,6);
  assert.equal(f.store.pending().length,1);
  f.state.now += CAPACITY_RETENTION_MS+1;
  await c.submit(next);
  assert.equal(f.store.count(),2);
  assert.equal(f.store.get('00000000-0000-4000-8000-000000000002'),null);
  assert.equal(f.store.ownsChild(21),true);
  assert.equal(f.store.newerParent(102,0),true);
  await assert.rejects(c.submit({...next,requestId:'00000000-0000-4000-8000-000000000002',parentRunId:9998}),/expired_request/);
  await assert.rejects(c.submit({...next,requestId:'00000000-0000-4000-8000-000000001002',parentRunId:102}),/parent_conflict/);
});

test('D7903 child uniqueness is transactional and old receipts acquire durable indexes on upgrade', async t=>{
  const f=fixture(t),c=f.create(); await c.submit(input()); await c.tick();
  const before=f.get(),bad=structuredClone(before);
  activeAttempt(bad.shards[1]).childRunId=activeAttempt(bad.shards[0]).childRunId;
  assert.throws(()=>f.store.save(bad),/child_conflict/);
  assert.deepEqual(f.get(),before);
  f.db.exec('DELETE FROM ci_capacity_index; DELETE FROM ci_capacity_children; DELETE FROM ci_capacity_parents; DELETE FROM ci_capacity_seen');
  const upgraded=new SqlCapacityStore(f.storage);
  assert.equal(upgraded.pending().length,1);
  assert.equal(upgraded.ownsChild(activeAttempt(before.shards[0]).childRunId!),true);
  assert.equal(upgraded.newerParent(12,0),true);
});

test('D7907 github-8 is a third pool: capped in flight, ahead of persistent Linux, and never below the hosted floor', () => {
  const s = input(), p = { ...policy(), maxIncludedWorkerShards: 1 }, i = inventory(100);
  assert.deepEqual(selectPools(s, true, i, {}, p, 100).filter(a => a.profile !== 'hosted'), [
    { shard: 'worker-1-of-6', profile: 'macos-arm64' }, { shard: 'worker-2-of-6', profile: 'github-8' },
    { shard: 'worker-3-of-6', profile: 'linux-x64' },
  ]);
  // One included attempt already in flight anywhere (queued or running) closes the pool for this request.
  assert.equal(selectPools(s, true, i, { 'github-8': 1 }, p, 100).some(a => a.profile === 'github-8'), false);
  // With the self-hosted pools closed, only included compute delegates, and hosted keeps the floor.
  assert.deepEqual(selectPools(s, true, null, {}, p, 100).filter(a => a.profile !== 'hosted'), [{ shard: 'worker-1-of-6', profile: 'github-8' }]);
  const two = { ...s, shards: ['worker-1-of-6', 'worker-2-of-6'] };
  assert.deepEqual(selectPools(two, true, null, {}, { ...p, minimumHostedWorkerShards: 1 }, 100).map(a => a.profile), ['github-8', 'hosted']);
  assert.deepEqual(selectPools({ ...s, shards: ['worker-1-of-6'] }, true, null, {}, p, 100).map(a => a.profile), ['hosted']);
  // A self-hosted cap of zero does not close included compute, and an included cap of zero does not close self-hosted.
  assert.equal(selectPools(s, true, i, {}, { ...p, maxExternalWorkerShards: 0 }, 100).filter(a => a.profile !== 'hosted').map(a => a.profile).join(), 'github-8');
  assert.equal(selectPools(s, true, i, {}, policy(), 100).some(a => a.profile === 'github-8'), false);
  // Untrusted source and other events never leave hosted.
  assert.equal(selectPools(s, false, i, {}, p, 100).every(a => a.profile === 'hosted'), true);
  assert.equal(selectPools({ ...s, event: 'pull_request' as CiSubmission['event'] }, true, i, {}, p, 100).every(a => a.profile === 'hosted'), true);
});

test('D7907 the included cap and budget leave a full hosted fallback inside the request deadline', () => {
  validateCapacityPolicy({ ...policy(), maxIncludedWorkerShards: 1 });
  for (const maxIncludedWorkerShards of [-1, 2, 0.5, Number.NaN]) {
    assert.throws(() => validateCapacityPolicy({ ...policy(), maxIncludedWorkerShards }), /capacity_policy_refused/);
  }
  const { maxIncludedWorkerShards: _drop, ...missing } = policy();
  assert.throws(() => validateCapacityPolicy(missing as CapacityPolicy), /capacity_policy_refused/);
  assert.throws(() => validateCapacityPolicy({ ...policy(), budgets: { ...CI_CAPACITY_BUDGETS, includedExecutionMs: 40 * 60_000 } }), /capacity_budget_refused/);
  const { includedStartMs: _gone, ...short } = CI_CAPACITY_BUDGETS;
  assert.throws(() => validateCapacityPolicy({ ...policy(), budgets: short as typeof CI_CAPACITY_BUDGETS }), /capacity_budget_refused/);
});

test('D7907 a github-8 attempt that never starts is fenced, then falls back to hosted under a new generation', async t => {
  const f = fixture(t, { maxIncludedWorkerShards: 1 }), c = f.create(), s = input();
  f.state.inventoryDown = true; // Included compute has no inventory; the self-hosted pools stay closed.
  await c.submit(s); await c.tick();
  const included = f.attempt('worker-1-of-6');
  assert.equal(included.profile, 'github-8');
  assert.equal(included.startDeadline, f.get().acceptedAt + CI_CAPACITY_BUDGETS.includedStartMs);
  assert.equal(included.executionDeadline - included.startDeadline, CI_CAPACITY_BUDGETS.includedExecutionMs);
  // A queued job on that label never moves to ubuntu-latest by itself: the coordinator fences it first.
  f.state.now = included.startDeadline; await c.tick();
  assert.equal(f.cancelled.some(r => r.childRunId === included.childRunId), true);
  assert.equal(f.attempt('worker-1-of-6').generation, 1);
  assert.equal(await c.receipt(s.requestId, 'worker-1-of-6', included.childRunId!, 1), null);
  f.outcomes.set(included.childRunId!, f.observation(included, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
  await c.tick();
  const fallback = f.attempt('worker-1-of-6');
  assert.equal(fallback.profile, 'hosted'); assert.equal(fallback.generation, 2);
  assert.equal(f.dispatched.filter(d => d.logicalShard === 'worker-1-of-6').map(d => d.profile).join(), 'github-8,hosted');
});

test('D7907 a running github-8 attempt keeps its slot, so a second request stays on hosted', async t => {
  const f = fixture(t, { maxIncludedWorkerShards: 1 }), c = f.create();
  f.state.inventoryDown = true;
  await c.submit(input()); await c.tick();
  const first = f.attempt('worker-1-of-6');
  f.outcomes.set(first.childRunId!, f.observation(first, { status: 'in_progress', conclusion: null, jobConclusion: null, testStep: 'unknown' }));
  await c.tick();
  assert.equal(f.attempt('worker-1-of-6').phase, 'running');
  const second = { ...input(), requestId: '00000000-0000-4000-8000-000000000002', parentRunId: 13 };
  await c.submit(second);
  assert.equal(f.get(second.requestId).shards.every(sh => activeAttempt(sh).profile === 'hosted'), true);
});

test('D7907 a verified test failure on github-8 is a real failure, never an infrastructure fallback', async t => {
  const f = fixture(t, { maxIncludedWorkerShards: 1 }), c = f.create(), s = input();
  f.state.inventoryDown = true;
  await c.submit(s); await c.tick();
  const included = f.attempt('worker-1-of-6');
  f.outcomes.set(included.childRunId!, f.observation(included, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure' }));
  await c.tick();
  assert.equal(f.attempt('worker-1-of-6').phase, 'failed'); assert.equal(f.attempt('worker-1-of-6').generation, 1);
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('D8009 hosted lease fits the existing 45 minute job and late pickup cannot extend it', async t => {
  const f = fixture(t, { maxExternalWorkerShards: 0 }), c = f.create();
  await c.submit(input()); await c.tick();
  const a = f.attempt('worker-1-of-6'), original = structuredClone(a);
  assert.equal(a.executionDeadline - f.get().acceptedAt, 45 * 60_000);
  assert.equal(a.executionDeadline - a.startDeadline, 35 * 60_000);
  f.state.now = a.startDeadline;
  f.outcomes.set(a.childRunId!, f.observation(a, { status: 'in_progress', conclusion: null, jobConclusion: null, startedAt: a.startDeadline }));
  await c.tick();
  assert.equal(f.attempt(a.logicalShard).executionDeadline, original.executionDeadline);
  assert.equal((await c.receipt(input().requestId, a.logicalShard, a.childRunId!, 1))?.executionDeadline, original.executionDeadline);
});

test('D8009 late success needs verified whole-job completion within the immutable lease', async t => {
  for (const finish of ['in-time', 'missing', 'expired', 'future', 'future-early', 'before-start'] as const) {
    const f = fixture(t, { maxExternalWorkerShards: 0 }), c = f.create();
    await c.submit(input()); await c.tick(); const a = f.attempt('worker-1-of-6');
    f.state.now = finish === 'future-early' ? f.get().acceptedAt : a.executionDeadline + 1;
    const completedAt = finish === 'in-time' ? a.executionDeadline - 1 : finish === 'expired' ? a.executionDeadline
      : finish.startsWith('future') ? f.state.now + 1 : finish === 'before-start' ? f.get().acceptedAt : null;
    f.outcomes.set(a.childRunId!, f.observation(a, { completedAt, startedAt: finish === 'before-start' ? f.get().acceptedAt + 1 : f.get().acceptedAt }));
    await c.tick();
    assert.equal(f.attempt(a.logicalShard).phase === 'passed', finish === 'in-time', finish);
    assert.equal(f.attempt(a.logicalShard).executionDeadline, a.executionDeadline);
  }
});

test('D8009 verified completion timestamps cannot revive fenced or older generations', async t => {
  const f = fixture(t), c = f.create(); await c.submit(input()); await c.tick();
  const a = f.attempt('worker-1-of-6');
  f.state.now = a.startDeadline; await c.tick();
  f.outcomes.set(a.childRunId!, f.observation(a, { completedAt: a.startDeadline - 1 }));
  await c.tick();
  assert.equal(f.attempt(a.logicalShard).generation, 2);
  assert.equal(f.attempt(a.logicalShard).profile, 'hosted');
  await c.tick();
  assert.notEqual(f.attempt(a.logicalShard).phase, 'passed');
  assert.equal(f.get().shards[0].attempts[0].reason, 'completed_after_fence');
});

test('D8009 sticky test failure holds included reservation until independent cleanup confirmation across restart', async t => {
  const f = fixture(t, { maxIncludedWorkerShards: 1 }), c = f.create(), s = input();
  f.state.inventoryDown = true; await c.submit(s); await c.tick();
  const a = f.attempt('worker-1-of-6'), sibling = f.attempt('worker-2-of-6');
  f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure', cleanupConfirmed: false, executionOutcome: 'cleanup_failure' }));
  await c.reconcileChild(s.requestId, a.childRunId!);
  assert.equal(c.status(s.requestId)?.status, 'failure');
  assert.equal(f.attempt(a.logicalShard).verifiedTestFailure, true);
  assert.equal(await c.receipt(s.requestId, sibling.logicalShard, sibling.childRunId!, 1), null);
  const restarted = f.create();
  const second = { ...s, parentRunId: 13, requestId: '00000000-0000-4000-8000-000000000002' };
  await restarted.submit(second);
  assert.equal(f.get(second.requestId).shards.every(sh => activeAttempt(sh).profile === 'hosted'), true);
  f.outcomes.set(a.childRunId!, f.observation(a, { testStep: 'success', cleanupConfirmed: true }));
  await restarted.tick();
  assert.equal(f.attempt(a.logicalShard).phase, 'failed');
  assert.equal(f.attempt(a.logicalShard).generation, 1);
  assert.equal(restarted.status(s.requestId)?.status, 'failure');
  const third = { ...s, parentRunId: 14, requestId: '00000000-0000-4000-8000-000000000003' };
  await restarted.submit(third);
  assert.equal(activeAttempt(f.get(third.requestId).shards[0]).profile, 'github-8');
});

test('D8009 wrapper timeout and cleanup uncertainty never create fallback or success', async t => {
  for (const executionOutcome of ['timed_out', 'cleanup_failure'] as const) for (const testStep of ['unknown', 'not_run', 'success'] as const) {
    const f = fixture(t, { maxIncludedWorkerShards: 1 }), c = f.create(); f.state.inventoryDown = true;
    await c.submit(input()); await c.tick(); const a = f.attempt('worker-1-of-6');
    f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'failure', jobConclusion: 'failure', testStep, cleanupConfirmed: false, executionOutcome }));
    await c.tick(); await f.create().tick();
    assert.equal(f.attempt(a.logicalShard).generation, 1);
    assert.notEqual(c.status(input().requestId)?.status, 'success');
    assert.notEqual(f.attempt(a.logicalShard).phase, 'failed');
    assert.equal(await c.receipt(input().requestId, a.logicalShard, a.childRunId!, 1), null);
  }
});

test('D8009 fallback waits for confirmed cancellation and fits the latest full budget boundary exactly', async t => {
  for (const offset of [0, 1]) {
    const f = fixture(t), c = f.create(); await c.submit(input()); await c.tick();
    const a = f.attempt('worker-1-of-6');
    f.state.now = a.startDeadline; await c.tick();
    const latest = f.get().deadline - CI_CAPACITY_BUDGETS.hostedStartMs - CI_CAPACITY_BUDGETS.hostedExecutionMs - CI_CAPACITY_BUDGETS.controlMarginMs;
    f.state.now = latest + offset;
    await c.tick();
    assert.equal(f.attempt(a.logicalShard).generation, 1, 'absence is not termination');
    f.outcomes.set(a.childRunId!, f.observation(a, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
    await c.tick();
    assert.equal(f.attempt(a.logicalShard).generation, offset === 0 ? 2 : 1);
    assert.equal(f.dispatched.filter(d => d.logicalShard === a.logicalShard).length, offset === 0 ? 2 : 1);
    if (offset === 0) {
      const fallback = f.attempt(a.logicalShard);
      assert.equal(fallback.executionDeadline - latest, 45 * 60_000);
      assert.equal(fallback.sourceSha, a.sourceSha); assert.equal(fallback.planDigest, a.planDigest);
    }
  }
});

test('D7909 pilot admits one request globally until every owned execution is independently ended',async t=>{
 const f=fixture(t,{maxActiveRequests:1,maxIncludedWorkerShards:0}),c=f.create(),s=input();
 await c.submit(s);await c.tick();
 const second={...s,parentRunId:13,requestId:'00000000-0000-4000-8000-000000000002'};
 await assert.rejects(c.submit(second),/active_bound/);
 const attempts=f.get().shards.map(activeAttempt),failed=attempts[0];
 f.outcomes.set(failed.childRunId!,f.observation(failed,{testStep:'failure',conclusion:'failure',jobConclusion:'failure',cleanupConfirmed:false}));
 await c.tick();
 assert.equal(c.status(s.requestId)?.status,'failure');
 await assert.rejects(f.create().submit(second),/active_bound/);
 for(const a of attempts)f.outcomes.set(a.childRunId!,f.observation(a,{testStep:a===failed?'failure':'not_run',conclusion:a===failed?'failure':'cancelled',jobConclusion:a===failed?'failure':'cancelled',cleanupConfirmed:true}));
 await c.tick();
 assert.equal((await f.create().submit(second)).accepted,true);
 for(const maxActiveRequests of [0,9])assert.throws(()=>validateCapacityPolicy({...policy(),maxActiveRequests}),/policy_refused/);
});

test('D7909 discovered moving-main child is quarantined, persisted before cancellation and never admitted',async t=>{
 const f=fixture(t),c=f.create(),s=input();f.state.dispatchDown=true;
 await c.submit(s);await c.tick();f.state.dispatchDown=false;
 const unexpected='d'.repeat(40);f.state.discovered={childRunId:999,rejectedWorkflowSha:unexpected};
 const cancel=f.ports.cancel;f.ports.cancel=async(receipt,sha)=>{
  assert.equal(sha,unexpected);assert.equal(f.attempt(receipt.logicalShard).rejectedWorkflowSha,unexpected);
  assert.equal('rejectedWorkflowSha' in receipt,false);await cancel(receipt);
 };
 await c.tick();
 const a=f.attempt('worker-1-of-6');assert.equal(a.childRunId,999);assert.equal(a.reason,'unreviewed_child_revision');
 assert.equal(f.cancelled.length,1);assert.equal(await c.receipt(s.requestId,a.logicalShard,999,1),null);
 await f.create().tick();assert.equal(f.attempt(a.logicalShard).generation,1);
 assert.equal(f.dispatched.filter(row=>row.logicalShard===a.logicalShard).length,1);
});

test('D7909 definitive unsent dispatch ends safely while ambiguous send never redispatches',async t=>{
 for(const definitive of [true,false]){
  const f=fixture(t,{maxExternalWorkerShards:0,maxIncludedWorkerShards:0}),c=f.create();let calls=0;
  f.ports.dispatch=async()=>{calls++;throw definitive?new CapacityDispatchRefused('preflight'):Error('ambiguous send');};
  await c.submit(input());await c.tick();
  assert.equal(calls,definitive?1:6);assert.equal(f.attempt('worker-1-of-6').phase,definitive?'failed':'dispatch_unknown');
  if(definitive)assert.equal(f.get().shards.slice(1).every(s=>activeAttempt(s).childRunId===null),true);
  await f.create().tick();assert.equal(calls,definitive?1:6);
 }
});

test('D7909 quarantined revision supplies no test truth; independent no-test cleanup can end it',async t=>{
 const f=fixture(t),c=f.create();f.state.dispatchDown=true;await c.submit(input());await c.tick();
 f.state.dispatchDown=false;f.state.discovered={childRunId:999,rejectedWorkflowSha:'d'.repeat(40)};await c.tick();
 const a=f.attempt('worker-1-of-6');
 f.outcomes.set(999,f.observation(a,{testStep:'failure',conclusion:'failure',jobConclusion:'failure',cleanupConfirmed:true}));
 assert.equal(await c.reconcileChild(input().requestId,999),false);assert.notEqual(c.status(input().requestId)?.status,'failure');
 f.outcomes.set(999,f.observation(a,{testStep:'not_run',conclusion:'cancelled',jobConclusion:'cancelled',cleanupConfirmed:true,startedAt:null}));
 assert.equal(await c.reconcileChild(input().requestId,999),true);assert.equal(f.attempt(a.logicalShard).phase,'cancelled');
 assert.equal(f.attempt(a.logicalShard).verifiedTestFailure,undefined);
});

test('D7909 Linux receipts reserve result delivery inside the existing 26-minute Run wrapper',async t=>{
 const f=fixture(t),c=f.create();await c.submit(input());await c.tick();const a=f.attempt('worker-2-of-6'),accepted=f.get().acceptedAt;
 assert.equal(a.profile,'linux-x64');assert.equal(a.executionDeadline,accepted+26*60_000-20_000);
 assert.ok(a.executionDeadline-a.startDeadline<=CI_CAPACITY_BUDGETS.externalExecutionMs);
 f.state.now=accepted+1_589_999;f.outcomes.set(a.childRunId!,f.observation(a,{startedAt:accepted+1,completedAt:f.state.now,cleanupConfirmed:true,exportComplete:true,executionOutcome:'completed'}));
 await c.tick();assert.notEqual(f.attempt(a.logicalShard).phase,'passed');assert.notEqual(c.status(input().requestId)?.status,'success');
});

// #8626: cross-candidate pickup. A merge candidate keeps at most maxExternalWorkerShards first-attempt Worker
// shards unstarted for a busy Linux runner, for at most mergePickupHoldMs; hosted dispatch is never limited.
const HOLD = 4 * 60_000;
const merge = (n: number): CiSubmission => ({ ...input(), event: 'merge_group', planArtifactId: null, queueBaseSha: 'd'.repeat(40),
  requestId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, parentRunId: 100 + n, sourceSha: n.toString(16).padStart(40, '0') });
type Fixture = ReturnType<typeof fixture>;
function linuxPool(f: Fixture, ids = [2, 3]) {
  const runners = ids.map(id => ({ id, profile: 'linux-x64' as const, groupId: 77, online: true, busy: false, draining: false }));
  const pool = { runners, reads: 0, down: false, stale: false };
  f.ports.inventory = async () => {
    pool.reads++; if (pool.down) throw new Error('unavailable');
    return { observedAt: pool.stale ? f.state.now - CI_CAPACITY_BUDGETS.inventoryMaxAgeMs - 1 : f.state.now, complete: true, runners: structuredClone(runners) };
  };
  return pool;
}
const actives = (f: Fixture, s: CiSubmission) => f.get(s.requestId).shards.map(activeAttempt);
const sent = (f: Fixture, s: CiSubmission) => f.dispatched.filter(a => a.requestId === s.requestId);
const started = (f: Fixture, a: CiAttempt) => f.outcomes.set(a.childRunId!, f.observation(a, { status: 'in_progress', conclusion: null,
  jobConclusion: null, testStep: 'unknown', completedAt: null, cleanupConfirmed: false, startedAt: f.state.now }));
const passed = (f: Fixture, a: CiAttempt) => f.outcomes.set(a.childRunId!, f.observation(a, { startedAt: Math.min(f.state.now, a.startDeadline), completedAt: f.state.now }));
/** A is admitted on idle runners, takes both, and is seen running; the inventory then shows both runners busy. */
async function linuxBusyWithA(f: Fixture, pool: ReturnType<typeof linuxPool>, c: CiCapacity) {
  const a = merge(1);
  await c.submit(a); await c.tick();
  assert.deepEqual(sent(f, a).map(x => x.profile).sort(), ['hosted', 'hosted', 'hosted', 'hosted', 'linux-x64', 'linux-x64']);
  for (const x of actives(f, a)) started(f, x);
  for (const r of pool.runners) r.busy = true;
  await c.tick();
  assert.equal(actives(f, a).every(x => x.phase === 'running'), true);
  return a;
}
/** Everything that was sent passes; a Linux runner is idle again once its attempt has ended. */
async function finishAll(f: Fixture, pool: ReturnType<typeof linuxPool>, c: CiCapacity, rounds = 6) {
  f.state.prerequisites = input().prerequisites.map(name => ({ name, conclusion: 'success' as const }));
  for (let round = 0; round < rounds; round++) {
    for (const request of f.store.list()) for (const x of request.shards.map(activeAttempt)) {
      if (x.childRunId !== null && !['passed', 'failed', 'cancelled'].includes(x.phase)) passed(f, x);
    }
    for (const r of pool.runners) r.busy = false;
    f.state.now += 1000; await c.tick();
  }
}

test('#8626 a freed Linux runner starts a waiting shard of an already-admitted candidate, after a restart, with no new submission', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const first = f.create(), a = await linuxBusyWithA(f, pool, first), b = merge(2);
  await first.submit(b); await first.tick();
  // B starts its hosted work at once and keeps two shards unstarted for the two busy runners.
  assert.deepEqual(sent(f, b).map(x => `${x.logicalShard}:${x.profile}`), ['worker-3-of-6:hosted', 'worker-4-of-6:hosted', 'worker-5-of-6:hosted', 'worker-6-of-6:hosted']);
  assert.deepEqual(actives(f, b).filter(x => x.phase === 'reserved').map(x => x.logicalShard), ['worker-1-of-6', 'worker-2-of-6']);
  const submissions = f.store.list().length;
  // One of A's Linux shards finishes: its runner is idle.
  const done = actives(f, a).find(x => x.profile === 'linux-x64')!;
  passed(f, done); pool.runners[0].busy = false;
  await first.reconcileChild(a.requestId, done.childRunId!);
  const restarted = f.create();
  await restarted.tick();
  assert.deepEqual(sent(f, b).slice(4).map(x => `${x.logicalShard}:${x.profile}`), ['worker-1-of-6:linux-x64']);
  assert.equal(sent(f, b)[4].sourceSha, b.sourceSha);
  assert.equal(sent(f, b)[4].queueBaseSha, b.queueBaseSha);
  assert.equal(f.store.list().length, submissions, 'no new submission');
  // The other runner is still busy: the same tick repeated sends nothing more and cancels nothing.
  await restarted.tick(); await f.create().tick();
  assert.equal(sent(f, b).length, 5);
  assert.equal(f.cancelled.length, 0);
  await finishAll(f, pool, restarted);
  for (const s of [a, b]) {
    assert.equal(restarted.status(s.requestId)?.status, 'success');
    // One authoritative result per logical shard, on the candidate's own SHA.
    assert.deepEqual(sent(f, s).map(x => x.logicalShard).sort(), [...s.shards].sort());
    assert.equal(sent(f, s).every(x => x.sourceSha === s.sourceSha && x.generation === 1), true);
    assert.equal(actives(f, s).every(x => x.phase === 'passed' && x.sourceSha === s.sourceSha), true);
  }
  assert.equal(actives(f, b).filter(x => x.profile === 'linux-x64').length, 2);
});

test('#8626 a waiting shard goes to hosted with a fresh lease when its hold ends, and a coordinator outage cannot cancel it', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(); await linuxBusyWithA(f, pool, c);
  const b = merge(2); await c.submit(b); await c.tick();
  const accepted = f.get(b.requestId).acceptedAt;
  for (const x of actives(f, b).filter(x => x.childRunId !== null)) started(f, x);
  f.state.now = accepted + HOLD - 1; await c.tick();
  assert.equal(sent(f, b).length, 4, 'still inside the hold: Linux stays busy and the two shards wait');
  f.state.now = accepted + HOLD; await c.tick();
  const late = sent(f, b).slice(4);
  assert.deepEqual(late.map(x => `${x.logicalShard}:${x.profile}`), ['worker-1-of-6:hosted', 'worker-2-of-6:hosted']);
  // The lease is issued when the shard is sent, so it has the whole hosted start budget, not what the wait left.
  assert.equal(late.every(x => x.startDeadline === accepted + HOLD + CI_CAPACITY_BUDGETS.hostedStartMs), true);
  assert.equal(actives(f, b).every(x => x.phase !== 'cancelled'), true);
  // A second candidate whose coordinator is away for longer than the hosted start budget while it waits.
  const d = merge(3); await c.submit(d); await c.tick();
  assert.equal(actives(f, d).filter(x => x.phase === 'reserved').length, 2);
  f.state.now = f.get(d.requestId).acceptedAt + CI_CAPACITY_BUDGETS.hostedStartMs + 60_000;
  await f.create().tick();
  const afterOutage = actives(f, d).filter(x => ['worker-1-of-6', 'worker-2-of-6'].includes(x.logicalShard));
  assert.deepEqual(afterOutage.map(x => `${x.profile}:${x.phase}`), ['hosted:queued', 'hosted:queued']);
  assert.equal(afterOutage.every(x => x.startDeadline === f.state.now + CI_CAPACITY_BUDGETS.hostedStartMs), true);
});

test('#8626 hosted work is never held when Linux is offline, draining, unreadable, stale or absent', async t => {
  const cases: [string, (pool: ReturnType<typeof linuxPool>) => void][] = [
    ['offline', pool => { for (const r of pool.runners) r.online = false; }],
    ['draining', pool => { for (const r of pool.runners) r.draining = true; }],
    ['unreadable', pool => { pool.down = true; }],
    ['stale', pool => { pool.stale = true; }],
    ['absent', pool => { pool.runners.length = 0; }],
  ];
  for (const [name, change] of cases) {
    const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f); change(pool);
    const c = f.create();
    for (const n of [1, 2, 3]) { await c.submit(merge(n)); await c.tick(); }
    assert.equal(f.dispatched.length, 18, `${name}: every shard of three candidates is sent on its first tick`);
    assert.equal(f.dispatched.every(x => x.profile === 'hosted'), true, name);
  }
});

test('#8626 a slow Linux pool delays at most two shards per candidate, and at most one per runner across candidates', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(); await linuxBusyWithA(f, pool, c);
  // Admitted a second apart, oldest first; the oldest has the highest request id, so age decides, not the id.
  const later = [4, 3, 2].map(merge);
  for (const s of later) { f.state.now += 1000; await c.submit(s); }
  await c.tick();
  // Two busy runners: the oldest waiting candidate keeps two shards back, the others send everything.
  assert.deepEqual(later.map(s => sent(f, s).length), [4, 6, 6]);
  assert.equal(f.dispatched.filter(x => x.requestId !== merge(1).requestId).every(x => x.profile === 'hosted'), true);
  // One runner frees: exactly one waiting shard starts there, the oldest candidate's first.
  pool.runners[1].busy = false;
  passed(f, actives(f, merge(1)).filter(x => x.profile === 'linux-x64')[1]);
  await c.tick(); await c.tick();
  const linux = f.dispatched.filter(x => x.profile === 'linux-x64' && x.requestId !== merge(1).requestId);
  assert.deepEqual(linux.map(x => `${x.requestId.slice(-1)}:${x.logicalShard}`), ['4:worker-1-of-6']);
});

test('#8626 work whose dispatch outcome is unknown is never reassigned, and its runner stays reserved', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(), a = await linuxBusyWithA(f, pool, c), b = merge(2);
  await c.submit(b); await c.tick();
  // Both runners free at once, but the first Linux dispatch for B is sent with an unknown outcome.
  for (const r of pool.runners) r.busy = false;
  for (const x of actives(f, a).filter(x => x.profile === 'linux-x64')) passed(f, x);
  f.state.dispatchDown = true; await c.tick(); f.state.dispatchDown = false;
  const unknown = actives(f, b).filter(x => x.phase === 'dispatch_unknown');
  assert.deepEqual(unknown.map(x => `${x.logicalShard}:${x.profile}`), ['worker-1-of-6:linux-x64', 'worker-2-of-6:linux-x64']);
  const before = f.dispatched.length;
  await c.tick(); await f.create().tick();
  assert.equal(f.dispatched.length, before, 'neither shard is sent again, to Linux or to hosted');
  // A third candidate finds both runners still reserved by the unknown dispatches: it waits or runs hosted, never Linux.
  const d = merge(3); await c.submit(d); await c.tick();
  assert.equal(sent(f, d).every(x => x.profile === 'hosted'), true);
  // A hosted dispatch with an unknown outcome is not moved to an idle runner either.
  const g = fixture(t, { mergePickupHoldMs: HOLD }), poolG = linuxPool(g);
  for (const r of poolG.runners) r.busy = true;
  const cg = g.create(), e = merge(4);
  g.state.dispatchDown = true; await cg.submit(e); await cg.tick(); g.state.dispatchDown = false;
  for (const r of poolG.runners) r.busy = false;
  const sentBefore = g.dispatched.length; await cg.tick(); await cg.tick();
  assert.equal(g.dispatched.slice(sentBefore).some(x => ['worker-3-of-6', 'worker-4-of-6', 'worker-5-of-6', 'worker-6-of-6'].includes(x.logicalShard)), false);
  assert.equal(actives(g, e).filter(x => x.phase === 'dispatch_unknown').every(x => x.profile === 'hosted'), true);
});

test('#8626 a removed candidate gives up its waiting shards, and a Linux pickup that never starts falls back to hosted', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(), a = await linuxBusyWithA(f, pool, c), b = merge(2);
  await c.submit(b); await c.tick();
  // B's merge group is replaced by a newer attempt of the same parent run: B is superseded.
  const b2 = { ...b, requestId: '00000000-0000-4000-8000-000000000022', parentAttempt: 2 };
  await c.submit(b2); await c.tick();
  assert.deepEqual(actives(f, b).filter(x => x.childRunId === null).map(x => `${x.phase}:${x.reason}`), ['cancelled:request_stopped', 'cancelled:request_stopped']);
  pool.runners[0].busy = false; passed(f, actives(f, a).find(x => x.profile === 'linux-x64')!);
  await c.tick();
  assert.equal(f.dispatched.some(x => x.requestId === b.requestId && x.profile === 'linux-x64'), false, 'a stale candidate never reaches a runner');
  const picked = actives(f, b2).find(x => x.profile === 'linux-x64')!;
  assert.equal(picked.logicalShard, 'worker-1-of-6');
  // The runner never starts it: fenced, observed cancelled, then one hosted attempt of a new generation.
  f.state.now = picked.startDeadline; await c.tick();
  assert.equal(f.cancelled.some(x => x.childRunId === picked.childRunId), true);
  f.outcomes.set(picked.childRunId!, f.observation(picked, { conclusion: 'cancelled', jobConclusion: 'cancelled', testStep: 'not_run', startedAt: null }));
  // The parent is unreadable just as the fallback is about to be sent, so the fallback waits a tick unsent.
  const parent = f.ports.parent; let calls = 0;
  f.ports.parent = async s => { if (s.requestId === b2.requestId && ++calls > 1) throw new Error('unavailable'); return true; };
  await c.tick(); f.ports.parent = parent;
  let fallback = actives(f, b2).find(x => x.logicalShard === 'worker-1-of-6')!;
  assert.deepEqual([fallback.profile, fallback.generation, fallback.phase], ['hosted', 2, 'reserved']);
  // The runner is idle again, but a fallback is never sent back to Linux and never waits for it.
  await c.tick();
  fallback = actives(f, b2).find(x => x.logicalShard === 'worker-1-of-6')!;
  assert.deepEqual([fallback.profile, fallback.generation, fallback.phase], ['hosted', 2, 'queued']);
  await finishAll(f, pool, c);
  assert.equal(c.status(b2.requestId)?.status, 'success');
  assert.equal(c.status(b.requestId)?.status, 'cancelled');
});

test('#8626 a genuine test failure on a picked-up shard fails its candidate and no other', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(), a = await linuxBusyWithA(f, pool, c), b = merge(2);
  await c.submit(b); await c.tick();
  pool.runners[0].busy = false; passed(f, actives(f, a).find(x => x.profile === 'linux-x64')!);
  await c.tick();
  const picked = actives(f, b).find(x => x.profile === 'linux-x64')!;
  f.outcomes.set(picked.childRunId!, f.observation(picked, { conclusion: 'failure', jobConclusion: 'failure', testStep: 'failure', completedAt: f.state.now }));
  await c.tick();
  assert.deepEqual(c.status(b.requestId), { status: 'failure', reason: 'verified_failure' });
  await finishAll(f, pool, c);
  assert.equal(c.status(a.requestId)?.status, 'success');
  assert.equal(c.status(b.requestId)?.status, 'failure');
  assert.equal(f.dispatched.filter(x => x.requestId === b.requestId && x.logicalShard === picked.logicalShard).length, 1, 'a failed shard is not rerun elsewhere');
});

test('#8626 the hold reads the inventory at most once per tick, applies to trusted merge candidates only, and is off unless configured', async t => {
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f);
  const c = f.create(); await linuxBusyWithA(f, pool, c);
  for (const n of [2, 3]) await c.submit(merge(n));
  pool.reads = 0; await c.tick();
  assert.equal(pool.reads, 1);
  pool.reads = 0; await c.tick();
  assert.equal(pool.reads, 1, 'one read while a shard is waiting');
  f.state.now += HOLD; await c.tick(); pool.reads = 0; await c.tick();
  assert.equal(pool.reads, 0, 'none when nothing is waiting');
  // A push request and an untrusted merge candidate send everything at once.
  const g = fixture(t, { mergePickupHoldMs: HOLD }), poolG = linuxPool(g);
  for (const r of poolG.runners) r.busy = true;
  const cg = g.create();
  await cg.submit({ ...input(), requestId: '00000000-0000-4000-8000-000000000031', parentRunId: 131 }); await cg.tick();
  assert.equal(g.dispatched.length, 6);
  g.state.trusted = false; await cg.submit(merge(5)); await cg.tick();
  assert.equal(g.dispatched.length, 12);
  // Unset, the coordinator behaves as before: B is sent whole on its first tick, and a freed runner changes nothing.
  const h = fixture(t), poolH = linuxPool(h);
  const ch = h.create(), a = await linuxBusyWithA(h, poolH, ch), b = merge(2);
  await ch.submit(b); await ch.tick();
  assert.equal(sent(h, b).length, 6);
  poolH.runners[0].busy = false; passed(h, actives(h, a).find(x => x.profile === 'linux-x64')!);
  await ch.tick();
  assert.equal(sent(h, b).every(x => x.profile === 'hosted'), true);
});

test('#8626 the hold must be a positive whole number that leaves the fenced Linux attempt and a hosted fallback inside the queue budget', () => {
  const b = CI_CAPACITY_BUDGETS;
  const most = b.queueMs - (b.externalStartMs + b.externalExecutionMs + b.cancellationMs + b.hostedStartMs + b.hostedExecutionMs + b.controlMarginMs);
  assert.equal(most, 6.5 * 60_000);
  validateCapacityPolicy({ ...policy(), mergePickupHoldMs: most });
  validateCapacityPolicy({ ...policy(), mergePickupHoldMs: 1 });
  for (const mergePickupHoldMs of [0, -1, 1.5, Infinity, most + 1]) {
    assert.throws(() => validateCapacityPolicy({ ...policy(), mergePickupHoldMs }), /capacity_budget_refused/);
  }
});

test('#8626 per-candidate limits hold with a larger pool: two waiting shards at most, one hosted shard always, and no late Linux start', async t => {
  // Four busy runners: each candidate still keeps at most two shards back, oldest first, four in all.
  const f = fixture(t, { mergePickupHoldMs: HOLD }), pool = linuxPool(f, [2, 3, 4, 5]);
  for (const r of pool.runners) r.busy = true;
  const c = f.create(), three = [1, 2, 3].map(merge);
  for (const s of three) { await c.submit(s); await c.tick(); }
  assert.deepEqual(three.map(s => actives(f, s).filter(x => x.phase === 'reserved').length), [2, 2, 0]);
  // A two-shard candidate keeps one on hosted whatever the pool offers.
  const g = fixture(t, { mergePickupHoldMs: HOLD }), poolG = linuxPool(g, [2, 3, 4, 5]);
  for (const r of poolG.runners) r.busy = true;
  const cg = g.create(), small = { ...merge(4), shards: ['worker-1-of-6', 'worker-2-of-6'] };
  await cg.submit(small); await cg.tick();
  assert.deepEqual(actives(g, small).map(x => `${x.logicalShard}:${x.phase}`), ['worker-1-of-6:reserved', 'worker-2-of-6:queued']);
  for (const r of poolG.runners) r.busy = false;
  await cg.tick(); await cg.tick();
  assert.deepEqual(actives(g, small).map(x => x.profile), ['linux-x64', 'hosted']);
  // After an outage longer than the hold, an idle runner is no longer used: a fenced Linux attempt plus a
  // full hosted fallback would not fit the candidate's deadline, so the shard goes to hosted.
  const h = fixture(t, { mergePickupHoldMs: HOLD }), poolH = linuxPool(h);
  for (const r of poolH.runners) r.busy = true;
  const ch = h.create(), late = merge(5);
  await ch.submit(late); await ch.tick();
  const b = CI_CAPACITY_BUDGETS;
  h.state.now = h.get(late.requestId).deadline - (b.externalStartMs + b.externalExecutionMs + b.cancellationMs + b.hostedStartMs + b.hostedExecutionMs + b.controlMarginMs) + 1;
  for (const r of poolH.runners) r.busy = false;
  await h.create().tick();
  assert.equal(sent(h, late).every(x => x.profile === 'hosted'), true);
  assert.equal(sent(h, late).length, 6);
});
