/** D8348: compact records of passing requests, against real SQLite, the real coordinator and the real outbox. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CiCapacity, SqlCapacityStore, CAPACITY_REQUEST_LIMIT, CAPACITY_RETENTION_MS } from '../src/ciCapacity.ts';
import type { CapacityPorts } from '../src/ciCapacity.ts';
import {
  CAPACITY_COMPACT_ATTEMPTS, CAPACITY_COMPACT_BYTES, CAPACITY_COMPACT_EXPIRY_PAGE, CAPACITY_COMPACT_LIMIT, CAPACITY_COMPACT_PAGE,
  compactAggregate, compactDecode, compactEncode, compactProject, compactReceipt,
} from '../src/ciCapacityCompact.ts';
import type { CapacityCompactConsumer, CompactMode } from '../src/ciCapacityCompact.ts';
import { CapacityOutbox } from '../src/ciCapacityOutbox.ts';
import { publicationConsumer, publicationSettled } from '../src/ciCapacityRetention.ts';
import { CI_CAPACITY_BUDGETS, receiptMatches } from '../src/lib/ciCapacityPolicy.ts';
import type { CapacityPolicy, CapacityRequest, CiAttempt, CiSubmission, ExecutionReceipt } from '../src/lib/ciCapacityPolicy.ts';

const repository = 'AxalNetwork/StudioOS';
const START = 1_800_000_000_000;
const LEASES_OVER = 6 * 60 * 60_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = (n: number): CiSubmission => ({
  version: 1, requestId: uuid(n), repository,
  parentRunId: 100 + n, parentAttempt: 1, parentWorkflowId: 9, event: 'push',
  sourceSha: 'a'.repeat(40), queueBaseSha: null, executorSha: 'b'.repeat(40), planDigest: `sha256:${'c'.repeat(64)}`, planArtifactId: 45,
  shards: Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`),
  prerequisites: ['fast'],
});
const policy = (): CapacityPolicy => ({
  version: 1, maxExternalWorkerShards: 2, maxIncludedWorkerShards: 0, minimumHostedWorkerShards: 1, approvedGroupId: 77,
  budgets: { ...CI_CAPACITY_BUDGETS },
});
const bound = (a: CiAttempt): ExecutionReceipt => {
  const { phase: _p, cancelDeadline: _c, reason: _r, verifiedTestFailure: _f, rejectedWorkflowSha: _w, ...receipt } = a;
  return { ...receipt, childRunId: a.childRunId! };
};
type Sent = 'failure' | 'cancelled' | 'success';

function fixture(t: { after(fn: () => void): void; mock: { timers: { enable(o: object): void; setTime(n: number): void } } }) {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const state = { now: START, mode: 'pilot' as CompactMode | null, breakOn: null as string | null, compactReads: 0 };
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      if (state.breakOn && query.startsWith(state.breakOn)) throw new Error('fixture: storage failed');
      if (query.includes('FROM ci_capacity_compact\n') && query.includes('completed_at <= ?')) state.compactReads++;
      const rows = db.prepare(query).all(...values); return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as DurableObjectStorage;
  const guard = publicationSettled(storage, () => state.mode);
  const consumer = publicationConsumer(storage, () => state.mode);
  const open = (with_: CapacityCompactConsumer | null = consumer) => new SqlCapacityStore(storage, guard, with_);
  const store = open();
  const ports = {
    async verify(s: CiSubmission) { return { ...structuredClone(s), parentLive: true, trustedSource: true, executorOnMain: true }; },
    async inventory() { return null; }, async parent() { return true; }, async prerequisites() { return null; },
    async dispatch() { return 900_000; }, async discover() { return null; }, async observe() { return null; }, async cancel() { /* none */ },
  } as unknown as CapacityPorts;
  const capacity = (over: SqlCapacityStore = store) => new CiCapacity(over, ports, repository, policy(), () => state.now);
  storage.sql.exec('CREATE TABLE IF NOT EXISTS capacity_publications (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
  let template: CapacityRequest | null = null;
  /** A settled request built from one the coordinator really accepted. `fallback` shards carry a fenced first attempt. */
  const request = async (n: number, outcome: Sent, completedAt: number, fallback = 0): Promise<CapacityRequest> => {
    if (!template) {
      const scratch = new DatabaseSync(':memory:'); t.after(() => scratch.close());
      const other = new SqlCapacityStore({ sql: { exec: (q: string, ...v: (string | number | null)[]) => { const rows = scratch.prepare(q).all(...v); return { toArray: () => rows }; } },
        transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage);
      await capacity(other).submit(input(1)); template = other.get(uuid(1))!;
    }
    const r = structuredClone(template); r.submission = input(n); r.completedAt = completedAt;
    r.parentLive = outcome !== 'cancelled';
    r.prerequisites = r.prerequisites.map(p => ({ ...p, conclusion: 'success' }));
    for (const shard of r.shards) {
      const a = shard.attempts[0], index = Number(shard.name.split('-')[1]);
      a.requestId = r.submission.requestId; a.parentRunId = r.submission.parentRunId;
      a.phase = outcome === 'failure' ? 'failed' : outcome === 'cancelled' ? 'cancelled' : 'passed';
      a.childRunId = n * 100 + index;
      if (index <= fallback) {
        shard.attempts.push({ ...structuredClone(a), generation: 2, profile: 'hosted', childRunId: n * 100 + 50 + index });
        a.phase = 'cancelled'; shard.generation = 2;
      }
    }
    return r;
  };
  const settled = async (n: number, outcome: Sent, completedAt: number, patch: (r: CapacityRequest) => void = () => {}) => {
    const r = await request(n, outcome, completedAt); patch(r); store.save(r); return r;
  };
  /** The intent the outbox leaves once a concluded result is on the check (shape proven in the D8339 tests). */
  const sent = (n: number, status: Sent, patch: object = {}) => {
    const reason = status === 'failure' ? 'verified_failure' : status === 'cancelled' ? 'parent_inactive' : 'entire_expected_set_verified';
    storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(n)}:pilot`, JSON.stringify({
      requestId: uuid(n), mode: 'pilot', checkId: 100_000 + n, phase: 'known', sent: JSON.stringify({ status, reason }), failed: status === 'failure',
      createAttempts: 1, lastCreateAt: START, ...patch }));
  };
  /** A compact record placed directly, for tests that are about the table and not the handoff. */
  const place = async (n: number, completedAt: number) => {
    const r = await request(n, 'success', completedAt); r.deadline = Math.max(r.deadline, completedAt + 1);
    const record = compactProject(r, 'pilot', false)!;
    storage.sql.exec('INSERT INTO ci_capacity_compact (id, completed_at, failed, failure, state) VALUES (?, ?, 0, NULL, ?)', uuid(n), completedAt, compactEncode(record));
    return record;
  };
  const advance = (ms: number) => { state.now += ms; t.mock.timers.setTime(state.now); };
  const sweep = (over: SqlCapacityStore = store) => { const from = state.compactReads; over.prune(state.now - CAPACITY_RETENTION_MS); return state.compactReads - from; };
  const cursor = () => storage.sql.exec<{ id: string }>('SELECT id FROM ci_capacity_compact_cursor').toArray()[0]?.id ?? null;
  const fences = () => ['ci_capacity_seen', 'ci_capacity_parents', 'ci_capacity_children'].map(table =>
    JSON.stringify(storage.sql.exec(`SELECT * FROM ${table} ORDER BY 1`).toArray()));
  return { db, storage, store, state, guard, consumer, open, capacity, request, settled, sent, place, advance, sweep, cursor, fences };
}

test('D8348 the projection rebuilds every receipt exactly and refuses what it cannot carry', async t => {
  const f = fixture(t);
  const r = await f.request(2, 'success', START + 2, 2);
  const record = compactProject(r, 'pilot', false)!;
  assert.deepEqual(Object.keys(record), ['version', 'publicationMode', 'submission', 'acceptedAt', 'completedAt', 'deadline', 'attempts']);
  assert.deepEqual(record.submission, r.submission); assert.equal(record.publicationMode, 'pilot');
  assert.deepEqual([record.acceptedAt, record.completedAt, record.deadline], [r.acceptedAt, r.completedAt, r.deadline]);
  const owned = r.shards.flatMap(s => s.attempts);
  assert.equal(record.attempts.length, 8);
  for (const a of owned) {
    const rebuilt = compactReceipt(record, a.logicalShard, a.generation)!;
    assert.deepEqual(rebuilt, bound(a)); assert.equal(receiptMatches(rebuilt, bound(a)), true);
  }
  assert.deepEqual(record.attempts.filter(a => a.current).map(a => `${a.logicalShard}:${a.generation}`),
    ['worker-1-of-6:2', 'worker-2-of-6:2', 'worker-3-of-6:1', 'worker-4-of-6:1', 'worker-5-of-6:1', 'worker-6-of-6:1']);
  assert.equal(compactReceipt(record, 'worker-3-of-6', 2), null);
  assert.equal(compactProject(r, 'full-suite', false)!.publicationMode, 'full-suite');
  // The child workflow revision stays its own field, present or absent, exactly as submitted.
  const pinned = structuredClone(r); pinned.submission.childWorkflowSha = 'e'.repeat(40);
  for (const s of pinned.shards) for (const a of s.attempts) a.childWorkflowSha = 'e'.repeat(40);
  assert.equal(compactReceipt(compactProject(pinned, 'pilot', false)!, 'worker-1-of-6', 1)!.childWorkflowSha, 'e'.repeat(40));
  assert.equal('childWorkflowSha' in compactReceipt(record, 'worker-1-of-6', 1)!, false);

  const refused = (name: string, change: (x: CapacityRequest) => void, mode: unknown = 'pilot', superseded = false) => {
    const x = structuredClone(r); change(x); assert.equal(compactProject(x, mode, superseded), null, name);
  };
  for (const mode of [null, 'both', 1, '']) refused(`mode ${String(mode)}`, () => {}, mode);
  assert.equal(compactProject(r, undefined, false), null);
  refused('a newer parent attempt exists', () => {}, 'pilot', true);
  refused('not completed', x => { x.completedAt = null; });
  refused('completed past its deadline', x => { x.completedAt = x.deadline; });
  refused('parent not live', x => { x.parentLive = false; });
  refused('superseded flag', x => { x.superseded = true; });
  refused('evidence conflict', x => { x.evidenceConflict = true; });
  refused('a prerequisite not passed', x => { x.prerequisites[0].conclusion = 'pending'; });
  refused('a failed attempt', x => { x.shards[3].attempts[0].phase = 'failed'; });
  refused('a verified failure on a fenced attempt', x => { x.shards[0].attempts[0].verifiedTestFailure = true; });
  refused('a current attempt not passed', x => { x.shards[3].attempts[0].phase = 'cancelled'; });
  refused('rejected workflow on the current attempt', x => { x.shards[3].attempts[0].rejectedWorkflowSha = 'd'.repeat(40); });
  refused('rejected workflow on a fenced attempt', x => { x.shards[0].attempts[0].rejectedWorkflowSha = 'd'.repeat(40); });
  refused('rejected workflow on an attempt that never owned a run', x => { x.shards[0].attempts.unshift({ ...x.shards[0].attempts[0], generation: 0, childRunId: null, rejectedWorkflowSha: 'd'.repeat(40) }); });
  refused('a current attempt that owns no run', x => { x.shards[3].attempts[0].childRunId = null; });
  refused('one child run owned twice', x => { x.shards[3].attempts[0].childRunId = x.shards[4].attempts[0].childRunId; });
  refused('one generation twice', x => { x.shards[0].attempts[1].generation = 1; });
  refused('a child run id that is not a positive integer', x => { x.shards[3].attempts[0].childRunId = 0; });
  refused('a missing shard', x => { x.shards.pop(); });
  for (const [name, change] of [
    ['source', (a: CiAttempt) => { a.sourceSha = 'f'.repeat(40); }], ['plan', (a: CiAttempt) => { a.planDigest = `sha256:${'d'.repeat(64)}`; }],
    ['plan artifact', (a: CiAttempt) => { a.planArtifactId = 46; }], ['executor', (a: CiAttempt) => { a.executorSha = 'f'.repeat(40); }],
    ['queue base', (a: CiAttempt) => { a.queueBaseSha = 'f'.repeat(40); }], ['parent run', (a: CiAttempt) => { a.parentRunId = 1; }],
    ['parent attempt', (a: CiAttempt) => { a.parentAttempt = 2; }], ['parent workflow', (a: CiAttempt) => { a.parentWorkflowId = 10; }],
    ['request', (a: CiAttempt) => { a.requestId = uuid(3); }], ['event', (a: CiAttempt) => { a.event = 'merge_group'; }],
    ['child workflow added', (a: CiAttempt) => { a.childWorkflowSha = 'e'.repeat(40); }],
    ['child workflow equal to the executor', (a: CiAttempt) => { a.childWorkflowSha = a.executorSha; }],
  ] as const) refused(`an attempt whose ${name} is not the submission's`, x => change(x.shards[0].attempts[0]));

  // Bounds: eighteen owned attempts, and 4,096 bytes of UTF-8 state. A larger request simply stays whole.
  const many = (count: number) => { const x = structuredClone(r); for (const s of x.shards) { s.attempts = Array.from({ length: count / 6 }, (_, g) => ({ ...structuredClone(s.attempts.at(-1)!), generation: g + 1, childRunId: s.attempts[0].childRunId! * 10 + g, phase: 'passed' as const })); s.generation = count / 6; } return x; };
  assert.equal(compactProject(many(CAPACITY_COMPACT_ATTEMPTS), 'pilot', false)!.attempts.length, 18);
  assert.equal(compactProject(many(CAPACITY_COMPACT_ATTEMPTS + 6), 'pilot', false), null);
  const bytes = (x: CapacityRequest) => new TextEncoder().encode(compactEncode(compactProject(x, 'pilot', false)!)).length;
  assert.deepEqual(compactDecode(compactEncode(record)), record);
  for (const bad of ['{}', '{"v":2}', '[]', 'null']) assert.throws(() => compactDecode(bad), /capacity_compact_unreadable/, bad);
  for (const change of [{ v: 2 }, { m: 'both' }, { a: null }, { t: null }]) assert.throws(() => compactDecode(JSON.stringify({ ...JSON.parse(compactEncode(record)), ...change })), /capacity_compact_unreadable/, JSON.stringify(change));
  const wide = (repeat: number) => { const x = structuredClone(r); x.submission.prerequisites = ['↔'.repeat(repeat)]; x.prerequisites = [{ name: '↔'.repeat(repeat), conclusion: 'success' }]; return x; };
  const fits = wide(900), over = wide(1100);
  assert.equal(bytes(fits) <= CAPACITY_COMPACT_BYTES, true);
  assert.equal(JSON.stringify(over.submission).length < CAPACITY_COMPACT_BYTES, true, 'the bound is bytes, not characters');
  assert.equal(compactProject(over, 'pilot', false), null);
  // Measured state sizes, recorded in D8348: six attempts, eight, and the eighteen the record can hold.
  assert.deepEqual([bytes(await f.request(3, 'success', START)), bytes(r), bytes(many(18))], [1011, 1141, 1809]);
  assert.equal(JSON.stringify(r).length, 6137, 'the full request the eight-attempt record replaces');
  // The same with identifiers of production size: a merge-queue request, eleven-digit run ids, a pinned child workflow.
  const real = (x: CapacityRequest) => {
    const y = structuredClone(x), s = y.submission;
    Object.assign(s, { event: 'merge_group', parentRunId: 45_170_575_747, parentWorkflowId: 123_456_789, queueBaseSha: 'd'.repeat(40), childWorkflowSha: 'e'.repeat(40),
      planArtifactId: 4_512_345_678, prerequisites: ['fast', 'test deps', 'api ↔ worker drift'] });
    y.prerequisites = s.prerequisites.map(name => ({ name, conclusion: 'success' as const }));
    for (const shard of y.shards) for (const a of shard.attempts) Object.assign(a, { event: s.event, parentRunId: s.parentRunId, parentWorkflowId: s.parentWorkflowId,
      queueBaseSha: s.queueBaseSha, childWorkflowSha: s.childWorkflowSha, planArtifactId: s.planArtifactId, childRunId: 45_186_000_000 + a.childRunId! });
    return y;
  };
  assert.deepEqual([bytes(real(r)), JSON.stringify(real(r)).length, bytes(real(many(18)))], [1371, 7510, 2101]);
});

test('D8348 passes beyond the cap inside seven days are admitted by handing each to a compact record', async t => {
  const f = fixture(t);
  await f.settled(2, 'failure', START + 2); f.sent(2, 'failure');
  for (let n = 3; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, 'success', START + n); f.sent(n, 'success'); }
  const originals = new Map([3, 4, 5].map(n => [n, f.store.get(uuid(n))!]));
  f.advance(LEASES_OVER);
  const before = f.fences(), c = f.capacity();
  await c.submit(input(2001));
  assert.equal(f.store.get(uuid(2)), null); assert.equal(f.store.compact(uuid(2)), null, 'a delivered failure leaves with no compact record');
  await c.submit(input(2002)); await c.submit(input(2003));
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT); assert.equal(f.store.compactCount(), 2);
  assert.deepEqual([3, 4, 5].map(n => [f.store.get(uuid(n)) !== null, f.store.compact(uuid(n)) !== null]), [[false, true], [false, true], [true, false]]);
  for (const n of [3, 4]) {
    const view = f.store.compact(uuid(n))!, original = originals.get(n)!;
    assert.deepEqual({ ...view, failed: undefined, failure: undefined }, { ...compactProject(original, 'pilot', false)!, failed: undefined, failure: undefined });
    assert.deepEqual([view.failed, view.failure, view.publicationMode], [false, null, 'pilot']);
    for (const a of original.shards.flatMap(s => s.attempts)) assert.deepEqual(compactReceipt(view, a.logicalShard, a.generation), bound(a));
    assert.deepEqual(compactAggregate(view, false), c.status(uuid(5)));
  }
  // Fences are exactly what they were, plus the three admissions; a compacted identity cannot be reused.
  const after = f.fences();
  for (const n of [2, 3, 4]) { assert.equal(f.store.seen(uuid(n)), true); assert.equal(f.store.newerParent(100 + n, 0), true); assert.equal(f.store.ownsChild(n * 100 + 1), true); }
  assert.equal(JSON.parse(after[0]).length, JSON.parse(before[0]).length + 3);
  await assert.rejects(c.submit(input(3)), /capacity_expired_request/);
  await assert.rejects(c.submit({ ...input(2004), parentRunId: 103 }), /capacity_parent_conflict/);
  assert.deepEqual(c.status(uuid(3)), compactAggregate(f.store.compact(uuid(3))!, false)); assert.equal(await c.receipt(uuid(3), 'worker-1-of-6', 301, 1), null);

  // Restart: a new store over the same storage finds each request in exactly one place and carries on.
  const again = f.open();
  assert.equal(again.compactCount(), 3, 'the refused submission above still freed one place, by handoff');
  assert.deepEqual([5, 6].map(n => [again.get(uuid(n)) !== null, again.compact(uuid(n)) !== null]), [[false, true], [true, false]]);
  await f.capacity(again).submit(input(2004));
  assert.equal(again.count(), CAPACITY_REQUEST_LIMIT);

  // Without the consumer nothing is compacted: the store is #8343's, and it refuses.
  const plain = new SqlCapacityStore(f.storage, f.guard);
  await assert.rejects(f.capacity(plain).submit(input(2005)), /capacity_storage_bound/);
  assert.equal(plain.count(), CAPACITY_REQUEST_LIMIT); assert.equal(plain.compactCount(), 3);
  assert.notEqual(plain.compact(uuid(3)), null, 'existing records stay readable');
});

test('D8348 nothing is handed off while a result is owed, the mode is unknown or a lease is open', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) await f.settled(n, 'success', START + n, r => { if (n === 6) r.deadline = START + 3 * LEASES_OVER; });
  f.sent(3, 'success', { phase: 'creating', checkId: null, sent: null });          // create outcome unknown
  f.sent(4, 'success', { sent: JSON.stringify({ status: 'pending', reason: 'parent_evidence_unavailable' }) }); // check in progress
  f.sent(5, 'success', { failed: true });                                          // a failure recorded, not yet on the check
  f.sent(6, 'success');                                                            // its own deadline is still ahead
  f.advance(LEASES_OVER);
  const c = f.capacity();
  await assert.rejects(c.submit(input(2001)), /capacity_storage_bound/);
  assert.equal(f.store.compactCount(), 0); assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);

  // A publishable pass exists from here on; the consumer's mode decides.
  f.sent(7, 'success');
  for (const mode of [() => null, () => 'both', () => { throw new Error('fixture: configuration unread'); }]) {
    const blind = f.open({ mode: mode as () => CompactMode | null, evidence: f.consumer.evidence });
    await assert.rejects(f.capacity(blind).submit(input(2001)), /capacity_storage_bound/);
    assert.equal(blind.compactCount(), 0);
  }
  f.state.mode = null;
  await assert.rejects(c.submit(input(2001)), /capacity_storage_bound/);
  f.state.mode = 'pilot';
  // Whatever a guard says, the handoff itself refuses a pass whose parent has a newer attempt.
  f.storage.sql.exec('UPDATE ci_capacity_parents SET attempt = 2 WHERE parent = 102');   // the fence a re-run of request 2's parent leaves
  assert.equal(f.store.newerParent(102, 1), true);
  const trusting = new SqlCapacityStore(f.storage, () => 'revisable', f.consumer);
  await f.capacity(trusting).submit(input(2001));
  assert.deepEqual([2, 3, 4].map(n => [trusting.get(uuid(n)) !== null, trusting.compact(uuid(n)) !== null]), [[true, false], [false, true], [true, false]],
    'the superseded pass stays whole; the next one is handed off');
  // Under the real guard that superseded request, never published, is owed no check and simply leaves.
  await c.submit(input(2002));
  assert.deepEqual([f.store.get(uuid(2)), f.store.compact(uuid(2))], [null, null]);
  // Then the one pass with a delivered result is handed off; every owed one is still whole.
  await c.submit(input(2003));
  assert.deepEqual([4, 5, 6, 7, 8].map(n => f.store.get(uuid(n)) !== null), [true, true, true, false, true]);
  assert.equal(f.store.compactCount(), 2);
});

test('D8348 the handoff is all or nothing, and an identity already compacted is never overwritten', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, 'success', START + n); f.sent(n, 'success'); }
  f.advance(LEASES_OVER);
  const c = f.capacity(), fences = f.fences();
  for (const failing of ['DELETE FROM ci_capacity_requests WHERE id', 'DELETE FROM ci_capacity_index WHERE id', 'INSERT INTO ci_capacity_compact (']) {
    f.state.breakOn = failing;
    await assert.rejects(c.submit(input(2001)), /fixture: storage failed/);
    f.state.breakOn = null;
    assert.notEqual(f.store.get(uuid(2)), null, failing); assert.equal(f.store.compact(uuid(2)), null, failing);
    assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT); assert.equal(f.store.compactCount(), 0); assert.deepEqual(f.fences(), fences);
    assert.equal(f.open().get(uuid(2)) !== null, true, 'a restart finds the full request');
  }
  await c.submit(input(2001));
  assert.equal(f.open().get(uuid(2)), null); assert.notEqual(f.open().compact(uuid(2)), null);

  // Both representations of request 3 exist: inconsistent state. The handoff refuses it and takes request 4.
  const stale = await f.place(3, START + 3);
  const receipt = compactReceipt(stale, 'worker-1-of-6', 1)!;
  assert.equal(f.store.compactFailure(receipt, 77), true);
  const kept = JSON.stringify(f.store.compact(uuid(3)));
  await c.submit(input(2002));
  assert.deepEqual([3, 4].map(n => [f.store.get(uuid(n)) !== null, f.store.compact(uuid(n)) !== null]), [[true, true], [false, true]]);
  assert.equal(JSON.stringify(f.store.compact(uuid(3))), kept, 'the existing record and its failure are untouched');
});

test('D8348 an identity held both whole and compact loses neither side on any removal path', async t => {
  const f = fixture(t);
  // 2: a published pass, also compact, with a verified failure recorded on the compact side.
  // 3: a delivered failure, also compact. 4: an unsettled request, also compact. 5: an ordinary published pass.
  await f.settled(2, 'success', START + 2); const two = await f.place(2, START + 2); f.sent(2, 'success');
  assert.equal(f.store.compactFailure(compactReceipt(two, 'worker-1-of-6', 1)!, 77), true);
  await f.settled(3, 'failure', START + 3); await f.place(3, START + 3); f.sent(3, 'failure');
  await f.settled(4, 'success', START + 4, r => { r.completedAt = null; r.shards[0].attempts[0].phase = 'running'; }); await f.place(4, START + 4); f.sent(4, 'success');
  await f.settled(5, 'success', START + 5); f.sent(5, 'success');
  for (let n = 6; n <= CAPACITY_REQUEST_LIMIT + 1; n++) await f.settled(n, 'success', START + n);   // unpublished: nothing else may leave
  const both = () => [2, 3, 4].map(n => [f.store.get(uuid(n)) !== null, f.store.compact(uuid(n)) !== null]);
  const whole = [[true, true], [true, true], [true, true]];

  // At the cap, inside seven days: the final request 3 is not deleted and request 2 is not handed off again.
  f.advance(LEASES_OVER);
  const c = f.capacity();
  await c.submit(input(2001));
  assert.deepEqual(both(), whole); assert.equal(f.store.compact(uuid(5)) !== null, true, 'the ordinary pass is the one handed off');
  await assert.rejects(c.submit(input(2002)), /capacity_storage_bound/);
  assert.deepEqual(both(), whole);

  // Past seven days: age removes neither the full side nor the compact side, across a restart.
  f.advance(CAPACITY_RETENTION_MS);
  for (let i = 0; i < 3; i++) f.sweep();
  f.sweep(f.open());
  assert.deepEqual(both(), whole);
  assert.equal(f.store.compact(uuid(5)), null, 'a record with no full twin still expires');
  assert.deepEqual([f.store.compact(uuid(2))!.failed, f.store.compact(uuid(2))!.failure!.jobId], [true, 77], 'the verified failure is still there');
  assert.equal(f.store.compact(uuid(3))!.failed, false);
  // The store without a guard, which removes by age alone, keeps them as well; so does one without a consumer.
  new SqlCapacityStore(f.storage).prune(f.state.now - CAPACITY_RETENTION_MS);
  assert.deepEqual(both(), whole);
  assert.equal(f.store.get(uuid(6)), null, 'the same pass removes an ordinary aged request');
  assert.equal(f.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM ci_capacity_index WHERE id IN (?, ?, ?)', uuid(2), uuid(3), uuid(4)).toArray()[0].n, 3, 'and their index rows, before any reopen could rebuild them');
  new SqlCapacityStore(f.storage, f.guard).prune(f.state.now - CAPACITY_RETENTION_MS);
  assert.deepEqual(both(), whole);
  // Both sides answering is the signal; nothing here resolves it.
  assert.equal(f.store.count(), 4); assert.equal(f.store.compactCount(), 3);
});

test('D8348 at 32,768 compact records a pass stays whole and the store refuses', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, 'success', START + n); f.sent(n, 'success'); }
  const state = compactEncode(compactProject(await f.request(5000, 'success', START), 'pilot', false)!);
  const insert = f.db.prepare('INSERT INTO ci_capacity_compact (id, completed_at, failed, failure, state) VALUES (?, ?, 0, NULL, ?)');
  f.db.exec('BEGIN'); for (let n = 1; n <= CAPACITY_COMPACT_LIMIT - 1; n++) insert.run(uuid(100_000 + n), START + n, state); f.db.exec('COMMIT');
  f.advance(LEASES_OVER);
  const c = f.capacity();
  await c.submit(input(2001));
  assert.equal(f.store.compactCount(), CAPACITY_COMPACT_LIMIT); assert.equal(f.store.get(uuid(2)), null);
  await assert.rejects(c.submit(input(2002)), /capacity_storage_bound/);
  assert.equal(f.store.compactCount(), CAPACITY_COMPACT_LIMIT); assert.notEqual(f.store.get(uuid(3)), null);
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);
  // An overdue record that is still owed counts toward the cap; one that leaves makes room for one handoff.
  f.db.prepare('DELETE FROM ci_capacity_compact WHERE id = ?').run(uuid(100_001));
  await c.submit(input(2002));
  assert.equal(f.store.compactCount(), CAPACITY_COMPACT_LIMIT); assert.equal(f.store.get(uuid(3)), null);
  await assert.rejects(c.submit(input(2003)), /capacity_storage_bound/);
});

test('D8348 a parent re-run before, during and after the handoff still lowers the check', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT; n++) { await f.settled(n, 'success', START + n); f.sent(n, 'success'); }
  f.advance(LEASES_OVER);
  const c = f.capacity();
  // Before: request 2's parent is re-run while the store has room. Request 2 is owed a correction and stays whole.
  await c.submit({ ...input(2001), parentRunId: 102, parentAttempt: 2 });
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);
  // During: the re-run of request 3's parent is itself the admission that hands request 3 off.
  await c.submit({ ...input(2002), parentRunId: 103, parentAttempt: 2 });
  assert.deepEqual([2, 3].map(n => [f.store.get(uuid(n)) !== null, f.store.compact(uuid(n)) !== null]), [[true, false], [false, true]]);
  // After: request 4 is handed off, and its parent is re-run later.
  await c.submit(input(2003));
  await c.submit({ ...input(2004), parentRunId: 104, parentAttempt: 2 });
  assert.deepEqual([4, 5].map(n => f.store.compact(uuid(n)) !== null), [true, true]);

  const evidence = (n: number) => { const view = f.store.compact(uuid(n))!; return f.consumer.evidence(view, f.store.newerParent(view.submission.parentRunId, view.submission.parentAttempt)); };
  assert.deepEqual([3, 4, 5].map(evidence), ['owed', 'owed', 'revisable']);
  assert.deepEqual([3, 5].map(n => compactAggregate(f.store.compact(uuid(n))!, f.store.newerParent(100 + n, 1)).status), ['cancelled', 'success']);
  // Past seven days the two owed records stay; the untouched pass leaves.
  f.advance(CAPACITY_RETENTION_MS);
  f.sweep();
  assert.deepEqual([3, 4, 5].map(n => f.store.compact(uuid(n)) !== null), [true, true, false]);
  assert.notEqual(f.store.get(uuid(2)), null, 'the full request owed a correction is kept past seven days too');
  // Once the lowered result is on each check, they leave.
  for (const n of [2, 3, 4]) f.sent(n, 'cancelled');
  f.sweep();
  assert.deepEqual([3, 4].map(n => f.store.compact(uuid(n)) !== null), [false, false]);
  assert.equal(f.store.get(uuid(2)), null);
});

test('D8348 a late verified failure is recorded once, only against its exact attempt, and never cleared', async t => {
  const f = fixture(t);
  const original = await f.request(2, 'success', START + 2, 2), record = await f.place(2, START + 2);
  await f.place(3, START + 3); f.sent(2, 'success'); f.sent(3, 'success');
  const fenced = compactReceipt(record, 'worker-1-of-6', 1)!, current = compactReceipt(record, 'worker-3-of-6', 1)!;
  assert.deepEqual(fenced, bound(original.shards[0].attempts[0]));
  const row = () => JSON.stringify(f.storage.sql.exec('SELECT * FROM ci_capacity_compact ORDER BY id').toArray());
  const untouched = row();

  // Wrong identities change nothing and create nothing.
  const wrong: [string, ExecutionReceipt][] = [
    ['another request', { ...fenced, requestId: uuid(9) }], ['a shard with no such generation', { ...fenced, logicalShard: 'worker-3-of-6', generation: 2 }],
    ['another child run', { ...fenced, childRunId: fenced.childRunId + 1 }], ['another source', { ...fenced, sourceSha: 'f'.repeat(40) }],
    ['another plan', { ...fenced, planDigest: `sha256:${'d'.repeat(64)}` }], ['another executor', { ...fenced, executorSha: 'f'.repeat(40) }],
    ['another profile', { ...fenced, profile: 'github-8' }], ['another lease', { ...fenced, executionDeadline: fenced.executionDeadline + 1 }],
    ['another parent attempt', { ...fenced, parentAttempt: 2 }], ['a compact record of another request', { ...fenced, requestId: uuid(3) }],
  ];
  for (const [name, receipt] of wrong) { assert.equal(f.store.compactFailure(receipt, 77), false, name); assert.equal(row(), untouched, name); }
  for (const job of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '77' as unknown as number]) { assert.equal(f.store.compactFailure(fenced, job), false, String(job)); assert.equal(row(), untouched); }
  assert.equal(f.store.compactFailure(null as unknown as ExecutionReceipt, 77), false);
  assert.equal(f.store.compact(uuid(9)), null);

  // The consumer reads a compact record's intent as strictly as a full request's.
  const other = f.store.compact(uuid(3))!;
  for (const flaw of [{ phase: 'creating' }, { phase: 'new' }, { checkId: null }, { sent: null }, { failed: true },
    { sent: JSON.stringify({ status: 'pending', reason: 'parent_evidence_unavailable' }) }]) {
    f.sent(3, 'success', flaw); assert.equal(f.consumer.evidence(other, false), 'owed', JSON.stringify(flaw));
  }
  f.sent(3, 'failure'); assert.equal(f.consumer.evidence(other, false), 'final', 'a failure the outbox recorded and delivered');
  f.storage.sql.exec('DELETE FROM capacity_publications WHERE id = ?', `${uuid(3)}:pilot`); assert.equal(f.consumer.evidence(other, false), 'owed');
  f.sent(3, 'success'); assert.equal(f.consumer.evidence(other, false), 'revisable');
  assert.equal(f.consumer.evidence(other, true), 'owed'); f.sent(3, 'cancelled'); assert.equal(f.consumer.evidence(other, true), 'final');
  f.sent(3, 'success');

  // The exact fenced attempt: recorded, and the record is owed a correction from then on.
  assert.equal(f.consumer.evidence(f.store.compact(uuid(2))!, false), 'revisable');
  assert.equal(f.store.compactFailure(fenced, 77), true);
  const failed = f.store.compact(uuid(2))!;
  assert.deepEqual([failed.failed, failed.failure], [true, { logicalShard: 'worker-1-of-6', generation: 1, childRunId: fenced.childRunId, jobId: 77 }]);
  assert.deepEqual(compactAggregate(failed, false), { status: 'failure', reason: 'verified_failure' });
  assert.equal(f.consumer.evidence(failed, false), 'owed');
  const recorded = row();
  // A repeat is idempotent. The one stored failure shows a different job only for the attempt it names.
  assert.equal(f.store.compactFailure(fenced, 77), true); assert.equal(row(), recorded);
  assert.throws(() => f.store.compactFailure(fenced, 78), /capacity_compact_conflict/); assert.equal(row(), recorded);
  // Another owned attempt is accepted and the first failure kept. The store keeps no detail of that second
  // attempt, so it cannot tell a later job for it apart; refusing that conflict is the result layer's work.
  assert.equal(f.store.compactFailure(current, 80), true); assert.equal(f.store.compactFailure(current, 81), true); assert.equal(row(), recorded);
  assert.equal(f.store.compact(uuid(3))!.failed, false);

  // Owed past seven days; it leaves once the failure is on the check. Nothing has cleared it meanwhile.
  f.advance(CAPACITY_RETENTION_MS + LEASES_OVER);
  f.sweep(); f.sweep(f.open());
  assert.deepEqual([2, 3].map(n => f.store.compact(uuid(n)) !== null), [true, false]);
  assert.equal(f.store.compact(uuid(2))!.failed, true);
  f.sent(2, 'failure'); f.sweep();
  assert.equal(f.store.compactCount(), 0);
  // A full request is not reachable through the compact update.
  const whole = await f.settled(4, 'success', START + 4);
  assert.equal(f.store.compactFailure(bound(whole.shards[0].attempts[0]), 77), false);
});

test('D8348 expiry visits one bounded page behind a durable cursor and removes only delivered records', async t => {
  const f = fixture(t);
  const total = 2 * CAPACITY_COMPACT_EXPIRY_PAGE;
  for (let n = 1; n <= total; n++) await f.place(n, START + n);
  await f.place(900, START + 3 * CAPACITY_RETENTION_MS); f.sent(900, 'success');           // not yet seven days old
  f.advance(CAPACITY_RETENTION_MS + LEASES_OVER);
  // Nothing has an intent: every record is owed. Each visit reads one page and changes nothing.
  assert.equal(f.sweep(), 1); assert.equal(f.cursor(), uuid(64)); assert.equal(f.store.compactCount(), total + 1);
  f.db.prepare('DELETE FROM ci_capacity_compact WHERE id = ?').run(uuid(64)); await f.place(64, START + 64);   // the cursor's own record goes and returns
  assert.equal(f.sweep(f.open()), 1); assert.equal(f.cursor(), uuid(128), 'the cursor survives a restart and the loss of its record');
  f.sweep(); assert.equal(f.cursor(), null, 'an exact multiple of the page ends with an empty visit, then wraps');
  assert.equal(f.store.compactCount(), total + 1);
  // A record behind owed ones is reached, and one placed behind the cursor is reached after the wrap.
  f.sent(100, 'success'); f.sent(3, 'success', { sent: JSON.stringify({ status: 'pending', reason: 'parent_evidence_unavailable' }) });
  f.sweep(); assert.equal(f.store.compact(uuid(100)) !== null, true); assert.equal(f.store.compact(uuid(3)) !== null, true, 'a check still in progress keeps its record');
  f.sweep(); assert.equal(f.store.compact(uuid(100)), null); assert.notEqual(f.store.compact(uuid(3)), null);
  await f.place(950, START); f.sent(950, 'success');
  f.sweep(); f.sweep(); assert.equal(f.store.compact(uuid(950)), null);
  assert.notEqual(f.store.compact(uuid(900)), null, 'a record inside the age limit is never visited');

  // Only the exact answers remove a record. No consumer means no expiry at all.
  f.sent(5, 'success');
  for (const answer of [() => true, () => 'published', () => Promise.resolve('final'), () => { throw new Error('fixture: unreadable'); }, () => 'owed']) {
    const odd = f.open({ mode: () => 'pilot', evidence: answer as unknown as CapacityCompactConsumer['evidence'] });
    for (let i = 0; i < 4; i++) f.sweep(odd);
    assert.notEqual(f.store.compact(uuid(5)), null);
  }
  const before = f.store.compactCount(), plain = f.open(null);
  for (let i = 0; i < 4; i++) assert.equal(f.sweep(plain), 0);
  assert.equal(plain.compactCount(), before); assert.notEqual(plain.compact(uuid(5)), null);
  // A changed or unknown mode reads every record as owed: a pilot record is not full-suite authority.
  f.storage.sql.exec('INSERT INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(5)}:full-suite`,
    JSON.stringify({ requestId: uuid(5), mode: 'full-suite', checkId: 7, phase: 'known', sent: JSON.stringify({ status: 'success', reason: 'x' }), failed: false }));
  for (const mode of ['full-suite', null] as const) { f.state.mode = mode; for (let i = 0; i < 4; i++) f.sweep(); assert.notEqual(f.store.compact(uuid(5)), null, String(mode)); }
  f.state.mode = 'pilot';
  for (let i = 0; i < 4; i++) f.sweep();
  assert.equal(f.store.compact(uuid(5)), null);
  assert.throws(() => f.storage.sql.exec("INSERT INTO ci_capacity_compact_cursor (name, completed_at, id) VALUES ('other', 1, 'x')"), /CHECK/);
});

test('D8348 compact reads are paged by identity, at most a hundred at a time', async t => {
  const f = fixture(t);
  for (let n = 1; n <= 250; n++) await f.place(n, START + 1000 - n);
  const ids = (after: string, limit: number) => f.store.compactPage(after, limit).map(r => r.submission.requestId);
  assert.deepEqual(ids('', 3), [uuid(1), uuid(2), uuid(3)]);
  assert.deepEqual(ids(uuid(3), 2), [uuid(4), uuid(5)]);
  for (const limit of [CAPACITY_COMPACT_PAGE, CAPACITY_COMPACT_PAGE + 1, 5_000, Number.MAX_SAFE_INTEGER]) assert.equal(ids('', limit).length, CAPACITY_COMPACT_PAGE);
  assert.deepEqual(ids(uuid(249), 100), [uuid(250)]); assert.deepEqual(ids(uuid(250), 100), []);
  for (const limit of [0, -1, 1.5, Number.NaN, Infinity, '5' as unknown as number, null as unknown as number]) assert.throws(() => f.store.compactPage('', limit), /capacity_compact_page/, String(limit));
  assert.throws(() => f.store.compactPage(null as unknown as string, 5), /capacity_compact_page/);
  // A walk resumes from the last identity it held, whatever was deleted behind or ahead of it.
  const walked: string[] = []; let after = '';
  for (;;) {
    const page = ids(after, 70); if (!page.length) break;
    walked.push(...page); after = page.at(-1)!;
    f.db.prepare('DELETE FROM ci_capacity_compact WHERE id IN (?, ?)').run(page[0], uuid(240));
  }
  assert.equal(walked.length, 249); assert.equal(new Set(walked).size, 249); assert.equal(walked.includes(uuid(240)), false);
  assert.equal(f.store.compactPage('', 1)[0].failed, false);
});

test('D8348 composed outbox retains a compact pass intent until the original expiry', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, 'success', START + n); f.sent(n, 'success'); }
  f.advance(LEASES_OVER);
  await f.capacity().submit(input(2001));
  assert.equal(f.consumer.evidence(f.store.compact(uuid(2))!, false), 'revisable');
  // The composed publisher retains the known intent; no replacement check is created.
  const config = { repository, repositoryId: 7, appId: 23, executorSha: 'b'.repeat(40), approvedGroupId: 5, prerequisiteJobs: ['fast'], fullSuiteJobs: [], selfHostedProfiles: ['linux-x64'] } as unknown as ConstructorParameters<typeof CapacityOutbox>[2];
  await new CapacityOutbox(f.storage, async () => { throw new Error('fixture: no network'); }, config).publish(f.store, () => null, 'pilot');
  assert.equal(f.storage.sql.exec('SELECT state FROM capacity_publications WHERE id = ?', `${uuid(2)}:pilot`).toArray().length, 1);
  assert.equal(f.consumer.evidence(f.store.compact(uuid(2))!, false), 'revisable');
  const expiry = f.store.compact(uuid(2))!.completedAt + CAPACITY_RETENTION_MS;
  f.advance(expiry - f.state.now - 1); f.sweep();
  assert.notEqual(f.store.compact(uuid(2)), null, 'the original seven-day window has not ended');
  f.advance(1);
  for (let i = 0; i < 3; i++) f.sweep();
  assert.equal(f.store.compact(uuid(2)), null, 'the delivered pass leaves at its original expiry');
});
