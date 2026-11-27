/**
 * Task #4 — Confirm the cron run history still records every run during DB overload.
 *
 * Task #1 hardened the hourly cron against transient "D1 DB is overloaded"
 * blips with three pieces that had no automated coverage. This pins all three
 * so a future change can't silently regress them:
 *
 *   1. `withD1Retry` retries ONLY on transient D1 signatures and rethrows any
 *      other error immediately (never masking a real bug behind backoff).
 *   2. `Jobs.enqueueMany` issues a single batched D1 write and is a no-op on
 *      an empty list (no per-row INSERT storm; no empty batch).
 *   3. `enqueueReembedChunks` (the extracted re-embed watermark loop) advances
 *      the watermark only to the last *successfully* enqueued chunk when a
 *      later chunk fails — so the next tick retries the tail, never drops rows.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cron_reembed_reliability.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withD1Retry, isTransientD1Error } from '../src/util/d1Retry.ts';
import { Jobs } from '../src/models/jobs.ts';
import { enqueueReembedChunks } from '../src/util/reembedSweep.ts';

// ── 1. withD1Retry ─────────────────────────────────────────────────────────

test('isTransientD1Error matches only known transient signatures', () => {
  assert.equal(isTransientD1Error(new Error('D1 DB is overloaded. Requests queued for too long.')), true);
  assert.equal(isTransientD1Error(new Error('Network connection lost')), true);
  assert.equal(isTransientD1Error(new Error('storage caused object to be reset')), true);
  // A real SQL error must NOT look transient.
  assert.equal(isTransientD1Error(new Error('no such column: foo')), false);
  assert.equal(isTransientD1Error(new Error('UNIQUE constraint failed')), false);
});

test('withD1Retry retries a transient overload then succeeds', async () => {
  let calls = 0;
  const out = await withD1Retry(async () => {
    calls++;
    if (calls < 3) throw new Error('D1 DB is overloaded. Requests queued for too long.');
    return 'ok';
  }, { retries: 3, baseDelayMs: 1 });
  assert.equal(out, 'ok');
  assert.equal(calls, 3, 'should have retried twice before succeeding on the third call');
});

test('withD1Retry rethrows a non-transient error immediately without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    () => withD1Retry(async () => {
      calls++;
      throw new Error('no such table: cron_run_history');
    }, { retries: 5, baseDelayMs: 1 }),
    /no such table/,
  );
  assert.equal(calls, 1, 'a non-transient error must not be retried');
});

test('withD1Retry gives up after exhausting retries on a persistent transient error', async () => {
  let calls = 0;
  await assert.rejects(
    () => withD1Retry(async () => {
      calls++;
      throw new Error('D1 DB is overloaded');
    }, { retries: 2, baseDelayMs: 1 }),
    /overloaded/,
  );
  // initial attempt + 2 retries == 3 calls
  assert.equal(calls, 3, 'should attempt exactly retries+1 times then rethrow');
});

// ── 2. Jobs.enqueueMany ────────────────────────────────────────────────────

/** A D1 stub that records batch() calls and the SQL/binds of each statement. */
function makeBatchSpyDb() {
  const batches: any[][] = [];
  const prepare = (sql: string) => {
    const stmt: any = {
      sql,
      binds: [] as any[],
      bind(...a: any[]) { this.binds = a; return this; },
    };
    return stmt;
  };
  const db: any = {
    prepareCalls: 0,
    batches,
    prepare(sql: string) { db.prepareCalls++; return prepare(sql); },
    async batch(stmts: any[]) { batches.push(stmts); return stmts.map(() => ({ results: [] })); },
  };
  return db;
}

test('Jobs.enqueueMany issues exactly one batched write for N payloads', async () => {
  const db = makeBatchSpyDb();
  const env: any = { DB: db };
  await Jobs.enqueueMany(env, 'embed_entity', [
    { type: 'project', id: 1 },
    { type: 'project', id: 2 },
    { type: 'project', id: 3 },
  ]);
  assert.equal(db.batches.length, 1, 'all rows must go through a single DB.batch() round-trip');
  assert.equal(db.batches[0].length, 3, 'batch should contain one statement per payload');
  // Each statement is a parameterised INSERT (no string-interpolated values).
  for (const stmt of db.batches[0]) {
    assert.match(stmt.sql, /INSERT INTO queue_jobs/i);
    assert.equal(stmt.binds[0], 'embed_entity');
  }
});

test('Jobs.enqueueMany is a no-op on an empty list', async () => {
  const db = makeBatchSpyDb();
  const env: any = { DB: db };
  const r = await Jobs.enqueueMany(env, 'embed_entity', []);
  assert.equal(r, undefined);
  assert.equal(db.batches.length, 0, 'no batch should be issued');
  assert.equal(db.prepareCalls, 0, 'no statements should be prepared for an empty list');
});

// ── 3. enqueueReembedChunks watermark invariant ────────────────────────────

/**
 * Job-model stub whose enqueueMany throws on a chosen chunk so we can assert
 * the watermark stops at the last good chunk. We monkeypatch Jobs.enqueueMany
 * for the duration of each test and restore it after.
 */
function withFailingEnqueue(failOnCallIndex: number | null, body: (calls: any[][]) => Promise<void>) {
  const original = Jobs.enqueueMany;
  const calls: any[][] = [];
  (Jobs as any).enqueueMany = async (_env: any, _type: string, payloads: any[]) => {
    const idx = calls.length;
    calls.push(payloads);
    if (failOnCallIndex !== null && idx === failOnCallIndex) {
      throw new Error('D1 DB is overloaded. Requests queued for too long.');
    }
  };
  return body(calls).finally(() => { (Jobs as any).enqueueMany = original; });
}

test('enqueueReembedChunks advances watermark to the last id on full success', async () => {
  await withFailingEnqueue(null, async (calls) => {
    const ids = [10, 11, 12, 13, 14]; // chunkSize 2 -> [10,11],[12,13],[14]
    const r = await enqueueReembedChunks({} as any, 'project', ids, 9, 2);
    assert.equal(r.lastOk, 14, 'watermark advances to the highest enqueued id');
    assert.equal(r.okCount, 5);
    assert.equal(r.failed, 0);
    assert.equal(calls.length, 3, 'three chunks enqueued');
  });
});

test('enqueueReembedChunks stops at the last successful chunk when a later chunk fails', async () => {
  // Fail on the 2nd chunk (index 1). chunkSize 2 over [10..15]:
  //   chunk0 [10,11] ok  -> lastOk 11
  //   chunk1 [12,13] FAIL -> stop, no further chunks attempted
  await withFailingEnqueue(1, async (calls) => {
    const ids = [10, 11, 12, 13, 14, 15];
    const r = await enqueueReembedChunks({} as any, 'project', ids, 9, 2);
    assert.equal(r.lastOk, 11, 'watermark must NOT advance past the last successfully enqueued chunk');
    assert.equal(r.okCount, 2, 'only the first chunk counted as enqueued');
    assert.equal(r.failed, 2, 'the failed chunk size is reported as failed');
    assert.equal(calls.length, 2, 'must stop after the failing chunk — the tail is left for the next tick');
  });
});

test('enqueueReembedChunks keeps the watermark at `since` when the very first chunk fails', async () => {
  await withFailingEnqueue(0, async () => {
    const ids = [10, 11, 12];
    const r = await enqueueReembedChunks({} as any, 'project', ids, 9, 2);
    assert.equal(r.lastOk, 9, 'no rows enqueued -> watermark unchanged so the next tick retries everything');
    assert.equal(r.okCount, 0);
    assert.equal(r.failed, 2);
  });
});
