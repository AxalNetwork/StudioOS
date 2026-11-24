/** D8378: the bounded read of failed compact records, against real SQLite and the real store. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SqlCapacityStore } from '../src/ciCapacity.ts';
import { CAPACITY_COMPACT_PAGE, CapacityCompactTable, compactReceipt } from '../src/ciCapacityCompact.ts';
import type { CapacityCompactFailedStore, CompactRecord } from '../src/ciCapacityCompact.ts';

const START = 1_800_000_000_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shards = Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`);
const record = (n: number): CompactRecord => ({
  version: 1, publicationMode: 'pilot',
  submission: { version: 1, requestId: uuid(n), repository: 'AxalNetwork/StudioOS', parentRunId: 100 + n, parentAttempt: 1,
    parentWorkflowId: 9, event: 'push', sourceSha: 'a'.repeat(40), queueBaseSha: null, executorSha: 'b'.repeat(40),
    planDigest: `sha256:${'c'.repeat(64)}`, planArtifactId: 45, shards, prerequisites: ['fast'] },
  acceptedAt: START, completedAt: START + n, deadline: START + 60_000,
  attempts: shards.map((logicalShard, i) => ({ logicalShard, generation: 1, profile: 'hosted' as const, childRunId: n * 10 + i + 1,
    childAttempt: 1 as const, startDeadline: START + 1_000, executionDeadline: START + 2_000, current: true })),
});

function fixture(t: { after(fn: () => void): void }) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const queries: { query: string; values: (string | number | null)[] }[] = [];
  const storage = {
    sql: { exec(query: string, ...values: (string | number | null)[]) {
      queries.push({ query, values });
      const rows = db.prepare(query).all(...values); return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } as unknown as DurableObjectStorage;
  const store = new SqlCapacityStore(storage);
  const table = new CapacityCompactTable(storage);
  const add = (n: number) => table.insert(record(n));
  const fail = (n: number, jobId = 7_000 + n) => store.compactFailure(compactReceipt(record(n), shards[0], 1)!, jobId);
  const ids = (after: string, limit: number) => store.compactFailedPage(after, limit).map(r => r.submission.requestId);
  const dump = () => JSON.stringify([db.prepare('SELECT * FROM ci_capacity_compact ORDER BY id').all(),
    db.prepare('SELECT * FROM ci_capacity_compact_cursor').all()]);
  return { db, storage, store, table, add, fail, ids, dump, queries };
}

test('D8378 only failed records are returned, in identity order, strictly after the cursor', t => {
  const f = fixture(t);
  assert.deepEqual(f.ids('', 5), [], 'an empty table has no failed record');
  for (let n = 1; n <= 12; n++) f.add(n);
  assert.deepEqual(f.ids('', 5), [], 'twelve passes, none failed');
  for (const n of [9, 2, 11, 5]) assert.equal(f.fail(n), true);
  assert.deepEqual(f.ids('', 100), [2, 5, 9, 11].map(uuid));
  assert.deepEqual(f.ids('', 2), [2, 5].map(uuid));
  assert.deepEqual(f.ids(uuid(5), 2), [9, 11].map(uuid), 'the cursor record itself is not repeated');
  assert.deepEqual(f.ids(uuid(4), 1), [uuid(5)], 'a cursor need not name a failed record, or any record');
  assert.deepEqual(f.ids(uuid(11), 100), []);
  const first = f.store.compactFailedPage('', 1)[0];
  assert.equal(first.failed, true);
  assert.deepEqual(first.failure, { logicalShard: shards[0], generation: 1, childRunId: 21, jobId: 7_002 });
  // The whole-table page is unchanged beside it: passes and failures, all twelve.
  assert.equal(f.store.compactPage('', 100).length, 12);
});

test('D8378 the limit is validated and clamped exactly as compactPage does it', t => {
  const f = fixture(t);
  const total = 2 * CAPACITY_COMPACT_PAGE + 30;
  for (let n = 1; n <= total; n++) { f.add(n); f.fail(n); }
  assert.equal(f.ids('', 1_000_000).length, CAPACITY_COMPACT_PAGE);
  assert.equal(f.ids('', CAPACITY_COMPACT_PAGE + 1).length, CAPACITY_COMPACT_PAGE);
  assert.equal(f.ids('', 7).length, 7);
  const seen: string[] = [];
  for (let after = '', pages = 0; ; pages++) {
    assert.ok(pages <= 3, 'the walk ends');
    const page = f.ids(after, 1_000);
    if (page.length === 0) break;
    seen.push(...page); after = page.at(-1)!;
  }
  assert.deepEqual(seen, Array.from({ length: total }, (_, i) => uuid(i + 1)), 'every failed record once, in order');
  for (const limit of [0, -1, 1.5, Number.NaN, Infinity, '5' as unknown as number, null as unknown as number]) {
    assert.throws(() => f.store.compactFailedPage('', limit), /capacity_compact_page/);
    assert.throws(() => f.store.compactPage('', limit), /capacity_compact_page/, 'the same rule as compactPage');
  }
  assert.throws(() => f.store.compactFailedPage(null as unknown as string, 5), /capacity_compact_page/);
});

test('D8378 the read uses the failed-record index and is one statement, whatever the table holds', t => {
  const f = fixture(t);
  for (let n = 1; n <= 400; n++) f.add(n);
  f.fail(399);
  f.queries.length = 0;
  assert.deepEqual(f.ids('', 100), [uuid(399)]);
  assert.equal(f.queries.length, 1, 'one statement per call');
  const { query, values } = f.queries[0];
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values).map(row => String((row as { detail: string }).detail));
  assert.ok(plan.some(step => step.includes('ci_capacity_compact_failed')), `expected the partial index, got: ${plan.join(' | ')}`);
  assert.ok(!plan.some(step => /\bSCAN\b/.test(step) && !step.includes('ci_capacity_compact_failed')), `no table scan: ${plan.join(' | ')}`);
  assert.ok(!plan.some(step => step.includes('TEMP B-TREE')), `no sort step: ${plan.join(' | ')}`);
  // The index holds failed records only: 400 rows, one entry.
  const partial = f.db.prepare("SELECT partial FROM pragma_index_list('ci_capacity_compact') WHERE name = 'ci_capacity_compact_failed'").all();
  assert.deepEqual(partial.map(row => (row as { partial: number }).partial), [1]);
});

test('D8378 a failure written before the index existed, or straight to the table, is still found', t => {
  const f = fixture(t);
  for (let n = 1; n <= 6; n++) f.add(n);
  // A store from before this change: no index, and a failure already recorded.
  f.db.exec('DROP INDEX ci_capacity_compact_failed');
  f.db.prepare('UPDATE ci_capacity_compact SET failed = 1, failure = ? WHERE id = ?')
    .run(JSON.stringify({ logicalShard: shards[1], generation: 1, childRunId: 32, jobId: 99 }), uuid(3));
  const reopened = new SqlCapacityStore(f.storage);
  assert.deepEqual(reopened.compactFailedPage('', 100).map(r => r.submission.requestId), [uuid(3)]);
  // The table's own sticky update, without the store.
  assert.equal(f.table.fail(compactReceipt(record(5), shards[2], 1)!, 55), true);
  assert.deepEqual(reopened.compactFailedPage('', 100).map(r => r.submission.requestId), [uuid(3), uuid(5)]);
  assert.equal(reopened.compactFailedPage(uuid(3), 100)[0].failure!.jobId, 55);
});

test('D8378 the read changes nothing, and follows records that fail or leave between pages', t => {
  const f = fixture(t);
  for (let n = 1; n <= 10; n++) f.add(n);
  for (const n of [2, 4, 6]) f.fail(n);
  // A cursor left by expiry must survive the read untouched.
  f.db.prepare("INSERT INTO ci_capacity_compact_cursor (name, completed_at, id) VALUES ('expiry', ?, ?)").run(START + 3, uuid(3));
  const before = f.dump();
  f.queries.length = 0;
  assert.deepEqual(f.ids('', 2), [2, 4].map(uuid));
  assert.deepEqual(f.ids(uuid(4), 2), [uuid(6)]);
  assert.equal(f.dump(), before, 'no record, failure or cursor changed');
  assert.ok(f.queries.every(q => /^\s*SELECT\b/.test(q.query)), 'reads only');
  // Between two pages: a later identity fails, an earlier one fails, and a failed record leaves.
  assert.deepEqual(f.ids('', 2), [2, 4].map(uuid));
  f.fail(8); f.fail(1);
  f.db.prepare('DELETE FROM ci_capacity_compact WHERE id = ?').run(uuid(6));
  assert.deepEqual(f.ids(uuid(4), 100), [uuid(8)], 'after the cursor: the new failure is seen, the removed record is not');
  assert.deepEqual(f.ids('', 100), [1, 2, 4, 8].map(uuid), 'a fresh walk sees the failure recorded behind the old cursor');
  // A failure is never cleared, so a record does not leave the read by being reported again.
  assert.equal(f.fail(2), true);
  assert.deepEqual(f.ids('', 1), [uuid(1)]);
});

test('D8378 the port is separate: the compact store contract is not widened', t => {
  const f = fixture(t);
  const port: CapacityCompactFailedStore = f.store;
  f.add(1); f.fail(1);
  assert.deepEqual(port.compactFailedPage('', 1).map(r => r.submission.requestId), [uuid(1)]);
});
