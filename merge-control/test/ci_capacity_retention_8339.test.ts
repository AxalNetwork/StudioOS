/** D8339: count retention of the capacity request store, against real SQLite and the real publication outbox. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CiCapacity, SqlCapacityStore, CAPACITY_REQUEST_LIMIT, CAPACITY_RETENTION_MS } from '../src/ciCapacity.ts';
import type { CapacityEvictionGuard, CapacityPorts } from '../src/ciCapacity.ts';
import { CapacityOutbox } from '../src/ciCapacityOutbox.ts';
import { publicationSettled } from '../src/ciCapacityRetention.ts';
import { CI_CAPACITY_BUDGETS } from '../src/lib/ciCapacityPolicy.ts';
import type { Aggregate, CapacityPolicy, CapacityRequest, CiSubmission } from '../src/lib/ciCapacityPolicy.ts';

const repository = 'AxalNetwork/StudioOS';
const START = 1_800_000_000_000;
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
type Mode = 'pilot' | 'full-suite';
type Outcome = 'failure' | 'cancelled' | 'success';

const wrap = (db: DatabaseSync) => ({
  sql: { exec(query: string, ...values: (string | number | null)[]) {
    const rows = db.prepare(query).all(...values); return { toArray: () => rows };
  } },
  transactionSync<T>(fn: () => T): T {
    db.exec('BEGIN');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
}) as unknown as DurableObjectStorage;

function fixture(t: { after(fn: () => void): void; mock: { timers: { enable(o: object): void; setTime(n: number): void } } }, guarded = true) {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const storage = wrap(db);
  const state = { now: START, mode: 'pilot' as Mode | null, parentDown: false, patchDown: false, createDown: new Set<string>(), nextCheck: 500, nextChild: 900_000 };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const guard = publicationSettled(storage, () => state.mode);
  const open = (evictable: CapacityEvictionGuard | null = guarded ? guard : null) => new SqlCapacityStore(storage, evictable);
  const store = open();
  const ports = {
    async verify(s: CiSubmission) { return { ...structuredClone(s), parentLive: true, trustedSource: true, executorOnMain: true }; },
    async inventory() { return null; },
    async parent() { return true; },
    async prerequisites() { return null; },
    async dispatch() { return state.nextChild++; },
    async discover() { return null; },
    async observe() { return null; },
    async cancel() { /* nothing to cancel */ },
  } as unknown as CapacityPorts;
  const capacity = (over: SqlCapacityStore = store) => new CiCapacity(over, ports, repository, policy(), () => state.now);
  // Synthetic GitHub: check creation and update, and a parent run that is either live or unreadable.
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === 'POST' && path.endsWith('/check-runs')) {
      if (state.createDown.has((body as { external_id: string }).external_id)) throw new Error('fixture: create outcome unknown');
      return { id: state.nextCheck++ };
    }
    if (method === 'PATCH') { if (state.patchDown) throw new Error('fixture: update not delivered'); return {}; }
    const run = /\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?$/.exec(path);
    if (method === 'GET' && run && !state.parentDown) {
      return { id: Number(run[1]), run_attempt: Number(run[2] ?? 1), workflow_id: 9, path: '.github/workflows/ci.yml', head_sha: 'a'.repeat(40),
        event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success',
        repository: { full_name: repository, id: 7 }, head_repository: { full_name: repository, id: 7 } };
    }
    throw new Error('fixture: unavailable');
  };
  const config = { repository, repositoryId: 7, appId: 23, executorSha: 'b'.repeat(40), approvedGroupId: 5, prerequisiteJobs: ['fast'], fullSuiteJobs: [], selfHostedProfiles: ['linux-x64'] } as unknown as ConstructorParameters<typeof CapacityOutbox>[2];
  const outbox = () => new CapacityOutbox(storage, api, config);
  const publish = (status: (id: string) => Aggregate | null = id => capacity().status(id), mode: Mode = 'pilot') => outbox().publish(store, status, mode);
  /** The outbox visits four records a pass; run passes until it has reached every named request. */
  const deliver = async (...ids: number[]) => {
    const visited = new Set<string>(), wanted = ids.map(uuid);
    const status = (id: string) => { visited.add(id); return wanted.includes(id) ? capacity().status(id) : null; };
    for (let pass = 0; pass < 300 && wanted.some(id => !visited.has(id)); pass++) await publish(status);
    assert.equal(wanted.every(id => visited.has(id)), true, 'the outbox reached every named request');
  };
  let template: CapacityRequest | null = null;
  /** A fully settled request, built from one the coordinator really accepted. */
  const settled = async (n: number, outcome: Outcome, completedAt: number, patch: (r: CapacityRequest) => void = () => {}) => {
    if (!template) {
      const scratch = new DatabaseSync(':memory:'); t.after(() => scratch.close());
      const other = new SqlCapacityStore(wrap(scratch));
      await capacity(other).submit(input(1)); template = other.get(uuid(1))!;
    }
    const r = structuredClone(template); r.submission = input(n); r.completedAt = completedAt;
    r.parentLive = outcome !== 'cancelled';
    r.prerequisites = r.prerequisites.map(p => ({ ...p, conclusion: 'success' }));
    for (const shard of r.shards) for (const a of shard.attempts) {
      a.requestId = r.submission.requestId; a.parentRunId = r.submission.parentRunId;
      a.phase = outcome === 'failure' ? 'failed' : outcome === 'cancelled' ? 'cancelled' : 'passed';
      a.childRunId = n * 10 + Number(shard.name.split('-')[1]);
    }
    patch(r); store.save(r); return r;
  };
  /** The intent the outbox leaves once a final result is on the check. The first test proves the shape. */
  const sent = (n: number, status: Outcome, mode: Mode = 'pilot') => {
    const reason = status === 'failure' ? 'verified_failure' : status === 'cancelled' ? 'parent_inactive' : 'entire_expected_set_verified';
    const intent = { requestId: uuid(n), mode, checkId: 100_000 + n, phase: 'known', sent: JSON.stringify({ status, reason }), failed: status === 'failure',
      createAttempts: 1, lastCreateAt: START };
    storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(n)}:${mode}`, JSON.stringify(intent));
    return intent;
  };
  const intent = (n: number, mode: Mode = 'pilot') => {
    const row = storage.sql.exec<{ state: string }>('SELECT state FROM capacity_publications WHERE id = ?', `${uuid(n)}:${mode}`).toArray()[0];
    return row ? JSON.parse(row.state) as Record<string, unknown> : null;
  };
  outbox();
  const advance = (ms: number) => { state.now += ms; t.mock.timers.setTime(state.now); };
  return { storage, store, state, calls, guard, open, capacity, publish, deliver, settled, sent, intent, advance };
}
/** Past every lease of a request accepted at START, and well inside the seven-day age limit. */
const LEASES_OVER = 6 * 60 * 60_000;

test('D8339 the outbox leaves a final intent, and only a final intent for the configured mode frees a request', async t => {
  const f = fixture(t);
  const failed = await f.settled(2, 'failure', START + 1), passed = await f.settled(3, 'success', START + 2);
  await f.settled(4, 'cancelled', START + 3);
  f.advance(LEASES_OVER);
  for (const r of [failed, passed]) assert.equal(f.guard(r, false), false, 'nothing is published yet');
  await f.publish();
  const real = f.intent(2)!, model = f.sent(2, 'failure');
  assert.deepEqual({ ...real, checkId: model.checkId, lastCreateAt: model.lastCreateAt }, model, 'the test intent has the outbox shape');
  f.storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(2)}:pilot`, JSON.stringify(real));
  assert.equal(JSON.parse(String(f.intent(3)!.sent)).status, 'success');
  assert.equal(JSON.parse(String(f.intent(4)!.sent)).status, 'cancelled');
  for (const n of [2, 3, 4]) assert.equal(f.guard(f.store.get(uuid(n))!, false), true, `request ${n} is published`);
  // Another mode's check says nothing about this one, and an unknown mode says nothing at all.
  f.state.mode = 'full-suite'; assert.equal(f.guard(failed, false), false);
  f.state.mode = null; assert.equal(f.guard(failed, false), false);
  f.state.mode = 'pilot';
  // A final result counts only on a check the outbox has confirmed it created.
  for (const flaw of [{ phase: 'creating' }, { phase: 'new' }, { checkId: null }]) {
    f.storage.sql.exec('INSERT OR REPLACE INTO capacity_publications (id,state) VALUES (?,?)', `${uuid(2)}:pilot`, JSON.stringify({ ...real, ...flaw }));
    assert.equal(f.guard(failed, false), false, JSON.stringify(flaw));
  }
});

test('D8339 more than the cap completed inside seven days is admitted by evicting the oldest published completion', async t => {
  const f = fixture(t);
  // Completion order differs from identity order, with one tie, so the order under test is the stated one.
  const completed = (n: number) => START + (n === 2 ? 5_000 : n === 3 || n === 4 ? 1_000 : 2_000 + n);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, n % 3 === 0 ? 'cancelled' : 'failure', completed(n)); f.sent(n, n % 3 === 0 ? 'cancelled' : 'failure'); }
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);
  f.advance(LEASES_OVER);
  const c = f.capacity(), gone = (n: number) => f.store.get(uuid(n)) === null;
  await c.submit(input(2001));
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT, 'one admission evicts exactly one');
  assert.deepEqual([3, 4, 5, 2].map(gone), [true, false, false, false], 'the earliest completion goes first; a tie goes by identity');
  await c.submit(input(2002)); await c.submit(input(2003));
  assert.deepEqual([4, 5, 6, 2].map(gone), [true, true, false, false]);
  assert.equal(f.store.pending().length, 3, 'admitted work is never a candidate');

  // Restart: a new store over the same storage carries on from the same place.
  const again = f.open(), restarted = f.capacity(again);
  await restarted.submit(input(2004));
  assert.deepEqual([6, 7, 2].map(gone), [true, false, false]);
  assert.equal(again.count(), CAPACITY_REQUEST_LIMIT);

  // Evicted identities stay fenced: no request, parent run or child run can be used again.
  await assert.rejects(restarted.submit(input(3)), /capacity_expired_request/);
  assert.equal(again.count(), CAPACITY_REQUEST_LIMIT, 'a replayed identity is refused before retention runs');
  assert.equal(again.seen(uuid(3)), true); assert.equal(again.newerParent(103, 0), true); assert.equal(again.ownsChild(31), true);
  const replay = structuredClone(f.store.get(uuid(8))!); replay.submission = input(3);
  assert.throws(() => again.save(replay), /capacity_storage_bound/);
  assert.equal(await restarted.receipt(uuid(3), 'worker-1-of-6', 31, 1), null);
  assert.equal(await restarted.reconcileChild(uuid(3), 31), false);
  assert.equal(restarted.status(uuid(3)), null);
  // The coordinator prunes before its later checks, so a submission refused there has opened one place.
  // The store is then below the cap, and further refusals remove nothing.
  await assert.rejects(restarted.submit({ ...input(2005), parentRunId: 103 }), /capacity_parent_conflict/);
  await assert.rejects(restarted.submit({ ...input(2006), parentRunId: 104 }), /capacity_parent_conflict/);
  assert.equal(again.count(), CAPACITY_REQUEST_LIMIT - 1);
  assert.deepEqual([7, 8].map(gone), [true, false]);

  // Below the cap nothing is evicted, and the age limit still removes whatever is older, published or not.
  f.storage.sql.exec('DELETE FROM capacity_publications');
  f.advance(CAPACITY_RETENTION_MS - LEASES_OVER + 5_001);
  again.prune(f.state.now - CAPACITY_RETENTION_MS);
  assert.equal(again.count(), 4, 'every settled request older than seven days is gone');
  assert.equal(again.seen(uuid(500)), true);
  assert.equal(again.pending().length, 4);
});

test('D8339 below the cap count retention removes nothing', async t => {
  const f = fixture(t);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT - 1; n++) { await f.settled(n, 'failure', START + n); f.sent(n, 'failure'); }
  f.advance(LEASES_OVER);
  await f.capacity().submit(input(2001));
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT - 1);
  assert.notEqual(f.store.get(uuid(2)), null);
});

test('D8339 a pending, ambiguous or owed publication outlives newer published history', async t => {
  const f = fixture(t);
  // Oldest first. Each of 2 to 9 has a reason to stay; 10 onward is published history.
  await f.settled(2, 'failure', START + 2);                       // never published
  await f.settled(3, 'failure', START + 3);                       // create outcome unknown
  await f.settled(4, 'success', START + 4);                       // check still in progress: parent unreadable
  await f.settled(5, 'cancelled', START + 5);                     // published cancelled, then a verified failure arrives
  await f.settled(6, 'success', START + 6);                       // published success, then the parent is re-run
  await f.settled(7, 'failure', START + 7, r => { r.deadline = START + 3 * LEASES_OVER; }); // its own deadline is still ahead
  await f.settled(8, 'failure', START + 8, r => { r.shards[0].attempts[0].executionDeadline = START + 3 * LEASES_OVER; }); // a lease is still open
  await f.settled(9, 'failure', START + 9);                       // published under the other mode only
  f.sent(7, 'failure'); f.sent(8, 'failure'); f.sent(9, 'failure', 'full-suite');
  f.state.createDown.add(`${uuid(3)}:pilot`); await f.deliver(3);
  f.state.parentDown = true; await f.deliver(4); f.state.parentDown = false;
  await f.deliver(5, 6);
  const status = (n: number) => JSON.parse(String(f.intent(n)!.sent)).status;
  assert.equal(f.intent(2), null);
  assert.equal(f.intent(3)!.phase, 'creating'); assert.equal(f.intent(3)!.checkId, null);
  assert.deepEqual([4, 5, 6].map(status), ['pending', 'cancelled', 'success']);
  const late = f.store.get(uuid(5))!; late.shards[0].attempts[0].verifiedTestFailure = true; f.store.save(late);
  for (let n = 10; n <= CAPACITY_REQUEST_LIMIT; n++) { await f.settled(n, 'failure', START + n); f.sent(n, 'failure'); }
  const c = f.capacity(), held = [2, 3, 4, 5, 6, 7, 8, 9], kept = (n: number) => f.store.get(uuid(n)) !== null;
  await c.submit({ ...input(2001), parentRunId: 106, parentAttempt: 2 });   // the re-run of request 6's parent
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);

  f.advance(LEASES_OVER);
  await c.submit(input(2002)); await c.submit(input(2003));
  assert.deepEqual(held.map(kept), held.map(() => true), 'every unpublished or unexpired request is kept');
  assert.deepEqual([10, 11, 12].map(kept), [false, false, true], 'newer published history goes instead');

  // The outbox drops intents only for the requests that left, and still owes what it owed.
  const before = f.calls.length;
  await f.publish(() => null);
  assert.equal(f.intent(10), null); assert.equal(f.intent(11), null);
  assert.equal(f.intent(3)!.phase, 'creating'); assert.equal(status(4), 'pending'); assert.notEqual(f.intent(12), null);
  assert.equal(f.calls.length, before);

  // Once its result is on the check, request 4 is ordinary history and the oldest of it.
  await f.deliver(4); assert.equal(status(4), 'success');
  await c.submit(input(2004));
  assert.deepEqual([4, 12].map(kept), [false, true]);
  // A request is history once its own leases have run out.
  f.advance(3 * LEASES_OVER);
  await c.submit(input(2005)); await c.submit(input(2006));
  assert.deepEqual([7, 8, 12].map(kept), [false, false, true]);
  assert.deepEqual([2, 3, 5, 6, 9].map(kept), [true, true, true, true, true]);
});

test('D8339 an owed correction holds a request until the outbox has delivered it', async t => {
  const f = fixture(t);
  const cancelled = await f.settled(5, 'cancelled', START + 5), passed = await f.settled(6, 'success', START + 6);
  const sticky = await f.settled(7, 'cancelled', START + 7);
  await f.deliver(5, 6, 7);
  for (const r of [cancelled, passed, sticky]) assert.equal(f.guard(r, false), true);
  const status = (n: number) => JSON.parse(String(f.intent(n)!.sent)).status;

  // A verified failure arrives for a request already published as cancelled.
  const late = f.store.get(uuid(5))!; late.shards[0].attempts[0].verifiedTestFailure = true; f.store.save(late);
  assert.equal(f.guard(late, false), false);
  // The outbox has recorded a failure it could not yet put on the check.
  f.state.patchDown = true;
  await f.publish(id => id === uuid(7) ? { status: 'failure', reason: 'verified_failure' } : null);
  assert.equal(f.intent(7)!.failed, true); assert.equal(status(7), 'cancelled');
  assert.equal(f.guard(sticky, false), false);
  // The parent of a published success has been run again.
  assert.equal(f.guard(passed, true), false);

  f.state.patchDown = false;
  await f.publish(id => id === uuid(6) ? { status: 'cancelled', reason: 'parent_inactive' } : f.capacity().status(id));
  assert.deepEqual([5, 6, 7].map(status), ['failure', 'cancelled', 'failure']);
  assert.equal(f.guard(late, false), true); assert.equal(f.guard(passed, true), true); assert.equal(f.guard(sticky, false), true);
  // A superseded attempt that never had a check is owed none; any other request without one is.
  const never = await f.settled(8, 'failure', START + 8);
  assert.equal(f.guard(never, true), true); assert.equal(f.guard(never, false), false);
});

test('D8339 a store full of unresolved work refuses, keeps every record and still takes updates', async t => {
  const f = fixture(t);
  const c = f.capacity();
  for (let n = 2; n <= 300; n++) await f.settled(n, 'failure', START + n);                            // never published
  for (let n = 301; n <= 994; n++) { await f.settled(n, 'failure', START + n, r => { r.deadline = START + 30 * LEASES_OVER; }); f.sent(n, 'failure'); } // lease open
  for (let n = 995; n <= 997; n++) {                                                                  // cancellation not confirmed
    await f.settled(n, 'cancelled', START + n, r => { r.shards[0].attempts[0].phase = 'cancellation_unknown'; }); f.sent(n, 'cancelled');
  }
  for (let n = 2001; n <= 2004; n++) await c.submit(input(n));                                        // active
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT); assert.equal(f.store.pending().length, 4 + 3);
  const ids = () => f.store.list().map(r => r.submission.requestId).join();
  const all = ids();

  // Existing records still change at the cap: dispatch of an active request, and a late verified failure on a settled one.
  assert.equal(await c.tick(), f.state.now + CI_CAPACITY_BUDGETS.reconcileMs, 'reconciliation of the active requests continues');
  assert.equal(f.store.get(uuid(2002))!.shards.every(s => s.attempts[0].childRunId !== null), true, 'dispatch is recorded at the cap');
  const old = f.store.get(uuid(2))!; old.shards[0].attempts[0].verifiedTestFailure = true; f.store.save(old);
  assert.equal(f.store.get(uuid(2))!.shards[0].attempts[0].verifiedTestFailure, true);
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);

  f.advance(LEASES_OVER);
  await assert.rejects(c.submit(input(2005)), /capacity_storage_bound/);
  assert.equal(ids(), all, 'a refusal deletes nothing');
  assert.equal(f.store.seen(uuid(2005)), false, 'a refused request leaves no fence and may be submitted again');

  // A guard that cannot read its evidence frees nothing either.
  f.sent(2, 'failure');
  const blind = f.capacity(f.open(() => { throw new Error('fixture: evidence unreadable'); }));
  await assert.rejects(blind.submit(input(2005)), /capacity_storage_bound/);
  assert.equal(ids(), all);

  // One published result is room for exactly one admission.
  await c.submit(input(2005));
  assert.equal(f.store.get(uuid(2)), null);
  await assert.rejects(c.submit(input(2006)), /capacity_storage_bound/);
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);
});

test('D8339 without a guard the store keeps to age alone', async t => {
  const f = fixture(t, false);
  for (let n = 2; n <= CAPACITY_REQUEST_LIMIT + 1; n++) { await f.settled(n, 'failure', START + n); f.sent(n, 'failure'); }
  f.advance(LEASES_OVER);
  await assert.rejects(f.capacity().submit(input(2001)), /capacity_storage_bound/);
  assert.equal(f.store.count(), CAPACITY_REQUEST_LIMIT);
});
