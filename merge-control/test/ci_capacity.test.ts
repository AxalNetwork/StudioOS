/** D7887: deterministic pool, durable recovery, fencing, fallback and full-set authority tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CiCapacity, SqlCapacityStore } from '../src/ciCapacity.ts';
import type { CapacityPorts } from '../src/ciCapacity.ts';
import {
  CI_CAPACITY_BUDGETS, activeAttempt, aggregateCapacity, receiptMatches, selectPools, submissionMatches, validateCapacityPolicy,
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
  shards: ['rest', 'frontend-1-of-2', 'frontend-2-of-2', ...Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`)],
  prerequisites: ['fast', 'test deps', 'api ↔ worker drift'],
});
const policy = (): CapacityPolicy => ({
  version: 1, maxExternalWorkerShards: 2, minimumHostedWorkerShards: 1, approvedGroupId: 77,
  budgets: { ...CI_CAPACITY_BUDGETS },
});
const inventory = (now: number): CapacityInventory => ({ observedAt: now, complete: true, runners: [
  { id: 1, profile: 'macos-arm64', groupId: 77, online: true, busy: false, draining: false },
  { id: 2, profile: 'linux-x64', groupId: 77, online: true, busy: false, draining: false },
  { id: 3, profile: 'linux-x64', groupId: 77, online: true, busy: false, draining: false },
] });
function fixture(t: { after(fn: () => void): void }) {
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
    dispatchDown: false, cancelDown: false, nextId: 100, discovered: null as number | null,
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
  const create = () => new CiCapacity(new SqlCapacityStore(storage), ports, repository, policy(), () => state.now);
  const get = (id = input().requestId) => store.get(id)!;
  const attempt = (name: string) => activeAttempt(get().shards.find(s => s.name === name)!);
  const observation = (a: CiAttempt, patch: Partial<ChildObservation> = {}): ChildObservation => ({
    receipt: structuredClone(a) as ExecutionReceipt,
    workflowPath: '.github/workflows/runner-executor.yml', workflowAttempt: 1, jobId: a.childRunId! + 1000,
    runnerProfile: a.profile, status: 'completed', conclusion: 'success', jobConclusion: 'success',
    testStep: 'success', startedAt: get(a.requestId).acceptedAt + 1, ...patch,
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
  for (const event of ['push', 'merge_group', 'pull_request'] as const) {
    assert.equal(selectPools({ ...s, event }, false, inventory(100), {}, p, 100).every(a => a.profile === 'hosted'), true);
  }
  assert.equal(selectPools({ ...s, event: 'pull_request' }, true, inventory(100), {}, p, 100).every(a => a.profile === 'hosted'), true);
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
  for (const patch of [{ requestId: '../invalid' }, { shards: ['rest', 'rest'] }, { shards: ['shell-command'] },
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
  const a = f.attempt('rest');
  assert.equal((await c.receipt(s.requestId, 'rest', a.childRunId!, 1))?.childRunId, a.childRunId);
  f.state.parentDown = true; assert.equal(await c.receipt(s.requestId, 'rest', a.childRunId!, 1), null);
  f.state.parentDown = false; f.state.live = false;
  assert.equal(await c.receipt(s.requestId, 'rest', a.childRunId!, 1), null);
  await c.tick();
  assert.equal(c.status(s.requestId)?.status, 'cancelled');
  assert.equal(f.cancelled.length, s.shards.length);
});

test('ambiguous dispatch and interrupted durable intent are reconciled without repeating the remote effect', async t => {
  const f = fixture(t), c = f.create(), s = { ...input(), shards: ['rest'] };
  f.state.dispatchDown = true;
  await c.submit(s); await c.tick();
  assert.equal(f.attempt('rest').phase, 'dispatch_unknown');
  const restarted = f.create(); await restarted.tick();
  assert.equal(f.dispatched.length, 1);
  const request = f.get(); activeAttempt(request.shards[0]).phase = 'dispatching'; f.store.save(request);
  await f.create().tick(); assert.equal(f.dispatched.length, 1);
  f.state.discovered = 812;
  await restarted.tick();
  assert.equal(f.attempt('rest').childRunId, 812);
  assert.equal(f.dispatched.length, 1);
  assert.equal(await restarted.receipt(s.requestId, 'rest', 811, 1), null);
  assert.equal(await restarted.receipt(s.requestId, 'rest', 812, 2), null);
  assert.equal((await restarted.receipt(s.requestId, 'rest', 812, 1))?.childRunId, 812);
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
  assert.equal(await c.receipt(s.requestId, 'rest', f.attempt('rest').childRunId!, 1), null);
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
  const a = f.attempt('rest');
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
  assert.equal(f.attempt('rest').phase, 'queued');
  assert.equal(c.status(s.requestId)?.status, 'pending');
});

test('every expected logical shard and prerequisite is required, independent of successful submission and duplicate results', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  for (const shard of f.get().shards.slice(1)) {
    const a = activeAttempt(shard); f.outcomes.set(a.childRunId!, f.observation(a));
  }
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'pending');
  const a = f.attempt('rest'); f.outcomes.set(a.childRunId!, f.observation(a));
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
  const a = f.attempt('rest');
  const replacement = { ...s, requestId: '00000000-0000-4000-8000-000000000002', parentAttempt: 2 };
  await c.submit(replacement);
  assert.equal(c.status(s.requestId)?.status, 'cancelled');
  assert.equal(await c.receipt(s.requestId, 'rest', a.childRunId!, 1), null);
  await c.tick(); assert.equal(f.cancelled.some(r => r.childRunId === a.childRunId), true);
  assert.equal(c.status(replacement.requestId)?.status, 'pending');
});

test('deadline expiry and late success never publish a false pass', async t => {
  const f = fixture(t), c = f.create(), s = { ...input(), shards: ['rest'] }; await c.submit(s); await c.tick();
  const a = f.attempt('rest'); f.state.now = a.executionDeadline;
  f.outcomes.set(a.childRunId!, f.observation(a)); await c.tick();
  assert.notEqual(f.attempt('rest').phase, 'passed');
  f.state.now = f.get().deadline;
  assert.equal(c.status(s.requestId)?.status, 'failure');
});

test('a crash before the old superseded flag commits cannot revive the previous parent attempt', async t => {
  const f = fixture(t), c = f.create(), s = input(); await c.submit(s); await c.tick();
  const a = f.attempt('rest');
  const next = { ...structuredClone(f.get()), submission: { ...s, parentAttempt: 2, requestId: '00000000-0000-4000-8000-000000000002' } };
  f.store.save(next); // Represents the committed new identity, before the old cached flag update.
  assert.equal(f.get().superseded, false);
  assert.equal(await f.create().receipt(s.requestId, 'rest', a.childRunId!, 1), null);
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
  const a = f.attempt('rest');
  f.outcomes.set(a.childRunId!, f.observation(a, { testStep: 'unknown' }));
  await c.reconcileChild(s.requestId, a.childRunId!);
  assert.equal(f.attempt('rest').phase, 'failed');
  const other = f.attempt('frontend-1-of-2');
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
  const last = f.attempt('rest'); f.outcomes.set(last.childRunId!, f.observation(last));
  await c.tick(); assert.equal(c.status(s.requestId)?.status, 'success');
});

test('every immutable receipt field participates in equality', async t => {
  const f = fixture(t), c = f.create(); await c.submit(input()); await c.tick();
  const receipt = f.observation(f.attempt('rest')).receipt;
  assert.equal(receiptMatches(receipt, structuredClone(receipt)), true);
  for (const field of Object.keys(receipt) as (keyof ExecutionReceipt)[]) {
    if (['phase', 'cancelDeadline', 'reason'].includes(field)) continue;
    const changed = { ...receipt, [field]: typeof receipt[field] === 'number' ? Number(receipt[field]) + 1 : `${receipt[field]}-other` };
    assert.equal(receiptMatches(receipt, changed as ExecutionReceipt), false, field);
  }
});
