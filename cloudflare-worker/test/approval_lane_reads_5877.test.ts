/**
 * D5877 (#5877, part of #4716): the Inbox reads its lanes a few at a time.
 *
 * `approvalBoard` and `countLanes` used to await each lane in turn. They now
 * read `LANE_READ_CONCURRENCY` lanes at once. That must change nothing the
 * page sees, so this file holds three things:
 *
 *   1. The board and the counts are identical to the old one-at-a-time read
 *      over the same data, with one lane failing. The fake D1 settles the
 *      lanes in the reverse of their order, so an answer folded in settle
 *      order would come out in the wrong order and fail here.
 *   2. No more than the limit is ever in flight, and the limit is reached
 *      (so the reads really are parallel).
 *   3. One failing lane leaves every other lane read.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/approval_lane_reads_5877.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVAL_SOURCES,
  LANE_READ_CONCURRENCY,
  ageHours,
  approvalBoard,
  countLanes,
  mapBounded,
  slaFor,
  type ApprovalBoard,
  type ApprovalSource,
} from '../src/services/approvalSources.ts';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Lane i answers rows whose stamps repeat across lanes (so the stable sort's
 * tie order is tested), one unparseable stamp, and lane 3 holds none.
 */
function rowsFor(i: number) {
  if (i === 3) return [];
  return [
    { id: i * 10 + 1, who: `who-${i}`, what: `what-${i}`, created_at: '2026-11-10 08:00:00' },
    { id: i * 10 + 2, who: `who-${i}`, what: `what-${i}`, created_at: `2026-11-1${i % 8} 0${i % 10}:00:00` },
    ...(i === 5 ? [{ id: 59, who: 'x', what: 'y', created_at: 'not a stamp' }] : []),
  ];
}

/**
 * A D1 stand-in. Every query is mapped back to its lane by its SQL text.
 * Lane `failing` rejects. Lane i waits (n - i) ticks, so later lanes settle
 * first. `inFlight` counts reads started and not yet settled.
 */
function fakeDb(sources: readonly ApprovalSource[], failing: number | null) {
  const laneOf = new Map<string, number>();
  sources.forEach((s, i) => {
    for (const sql of [s.rowsSql, s.countSql, s.subSql, s.sub?.countSql]) {
      if (!sql) continue;
      assert.ok(!laneOf.has(sql) || laneOf.get(sql) === i, `two lanes share one query: ${s.key}`);
      laneOf.set(sql, i);
    }
  });
  const stats = { inFlight: 0, maxInFlight: 0, reads: 0 };
  const settle = async <T>(sql: string, answer: (i: number) => T): Promise<T> => {
    const i = laneOf.get(sql);
    assert.ok(i !== undefined, 'a query no lane owns');
    stats.inFlight++;
    stats.reads++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      for (let t = 0; t < sources.length - i; t++) await tick();
      if (i === failing) throw new Error('D1_ERROR: no such table');
      return answer(i);
    } finally {
      stats.inFlight--;
    }
  };
  const DB = {
    prepare(sql: string) {
      const api: any = {
        bind: () => api,
        all: () => settle(sql, (i) => ({ results: rowsFor(i) })),
        first: () => settle(sql, (i) => {
          if (sql === sources[i].countSql) {
            const rows = rowsFor(i);
            return { n: rows.length, oldest: rows[0]?.created_at ?? null };
          }
          if (sql === sources[i].subSql) return { a: i, b: '2' };
          return { n: i + 100 };
        }),
      };
      return api;
    },
  };
  return { env: { DB } as any, stats };
}

/** The board as the one-at-a-time loop built it before D5877, line for line. */
async function sequentialBoard(env: any, limit: number, now: number, sources: readonly ApprovalSource[]) {
  const items: ApprovalBoard['items'] = [];
  const lanes: ApprovalBoard['lanes'] = [];
  const unreadable: string[] = [];
  for (const src of sources) {
    try {
      const rows = await env.DB.prepare(src.rowsSql)
        .bind(...(src.bindings?.(env) || []), Math.max(1, Math.trunc(Number(limit) || 100)))
        .all();
      const got = rows.results || [];
      for (const r of got) {
        const age = ageHours(r.created_at, now);
        items.push({
          lane: src.key, lane_label: src.label, id: Number(r.id), who: String(r.who ?? ''), what: String(r.what ?? ''),
          created_at: String(r.created_at ?? ''), age_hours: age === null ? null : Math.round(age * 10) / 10, sla: slaFor(age),
        });
      }
      lanes.push({ key: src.key, label: src.label, count: got.length });
    } catch {
      lanes.push({ key: src.key, label: src.label, count: null });
      unreadable.push(src.label);
    }
  }
  items.sort((a, b) => {
    if (a.age_hours === null) return b.age_hours === null ? 0 : 1;
    if (b.age_hours === null) return -1;
    return b.age_hours - a.age_hours;
  });
  return { items, lanes, unreadable };
}

/** The count read as the one-at-a-time loop did it, reduced to what it measured. */
async function sequentialCounts(env: any, sources: readonly ApprovalSource[]) {
  const out: unknown[] = [];
  for (const s of sources) {
    try {
      const row = await env.DB.prepare(s.countSql).bind(...(s.bindings?.(env) || [])).first();
      let sub: unknown;
      if (s.subSql) {
        try {
          const r = await env.DB.prepare(s.subSql).first();
          sub = r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v) || 0])) : null;
        } catch { sub = null; }
      } else if (s.sub) {
        try {
          const r = await env.DB.prepare(s.sub.countSql).first();
          sub = { label: s.sub.label, count: Number(r?.n) || 0 };
        } catch { sub = { label: s.sub.label, count: null }; }
      }
      out.push({ key: s.key, count: Number(row?.n) || 0, oldest_at: row?.oldest ?? null, ...(sub === undefined ? {} : { sub }) });
    } catch {
      out.push({ key: s.key, count: null, oldest_at: null });
    }
  }
  return out;
}

const FAILING = 2;
const failingLabel = APPROVAL_SOURCES[FAILING].label;

test('the setup is a real fan-out: more lanes than the limit, and a limit above one', () => {
  assert.ok(APPROVAL_SOURCES.length > LANE_READ_CONCURRENCY * 2);
  assert.ok(LANE_READ_CONCURRENCY > 1);
});

test('the board is identical to the one-at-a-time read, one lane failing', async () => {
  const want = await sequentialBoard(fakeDb(APPROVAL_SOURCES, FAILING).env, 100, NOW, APPROVAL_SOURCES);
  const got = await approvalBoard(fakeDb(APPROVAL_SOURCES, FAILING).env, 100, NOW, APPROVAL_SOURCES);
  assert.deepEqual(got.items, want.items);
  assert.deepEqual(got.lanes, want.lanes);
  assert.deepEqual(got.unreadable, want.unreadable);
  assert.deepEqual(got.unreadable, [failingLabel]);
  assert.match(got.reason ?? '', new RegExp(failingLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // The unparseable stamp sorts last, and ties keep lane order.
  assert.equal(got.items.at(-1)?.age_hours, null);
  const tied = got.items.filter((x) => x.created_at === '2026-11-10 08:00:00' && x.id % 10 === 1).map((x) => x.lane);
  assert.deepEqual(tied, APPROVAL_SOURCES.filter((_, i) => i !== FAILING && i !== 3).map((s) => s.key));
});

test('the counts are identical to the one-at-a-time read, one lane failing', async () => {
  const want = await sequentialCounts(fakeDb(APPROVAL_SOURCES, FAILING).env, APPROVAL_SOURCES);
  const got = await countLanes(fakeDb(APPROVAL_SOURCES, FAILING).env, APPROVAL_SOURCES);
  assert.deepEqual(
    got.map(({ key, count, oldest_at, sub }) => ({ key, count, oldest_at, ...(sub === undefined ? {} : { sub }) })),
    want,
  );
  assert.deepEqual(got.map((l) => l.key), APPROVAL_SOURCES.map((s) => s.key));
  assert.deepEqual(got.map((l) => l.notifies), APPROVAL_SOURCES.map((s) => s.notifies));
});

test('no more than LANE_READ_CONCURRENCY reads are in flight, and that many are', async () => {
  const board = fakeDb(APPROVAL_SOURCES, null);
  await approvalBoard(board.env, 100, NOW, APPROVAL_SOURCES);
  assert.equal(board.stats.reads, APPROVAL_SOURCES.length);
  assert.equal(board.stats.maxInFlight, LANE_READ_CONCURRENCY);
  assert.equal(board.stats.inFlight, 0);

  const counts = fakeDb(APPROVAL_SOURCES, FAILING);
  await countLanes(counts.env, APPROVAL_SOURCES);
  assert.ok(counts.stats.reads >= APPROVAL_SOURCES.length);
  assert.equal(counts.stats.maxInFlight, LANE_READ_CONCURRENCY);
  assert.equal(counts.stats.inFlight, 0);
});

test('one failing lane does not fail the others', async () => {
  const board = await approvalBoard(fakeDb(APPROVAL_SOURCES, FAILING).env, 100, NOW, APPROVAL_SOURCES);
  board.lanes.forEach((l, i) => {
    if (i === FAILING) assert.equal(l.count, null, 'the failed lane shows no count, never 0');
    else assert.equal(l.count, rowsFor(i).length, `${l.key} was read`);
  });
  const counts = await countLanes(fakeDb(APPROVAL_SOURCES, FAILING).env, APPROVAL_SOURCES);
  counts.forEach((l, i) => {
    if (i === FAILING) assert.equal(l.count, null);
    else assert.equal(l.count, rowsFor(i).length, `${l.key} was counted`);
  });
});

test('mapBounded keeps input order and respects its limit', async () => {
  let live = 0;
  let peak = 0;
  const got = await mapBounded([5, 1, 4, 2, 3, 0], 2, async (n, i) => {
    live++;
    peak = Math.max(peak, live);
    for (let t = 0; t < n; t++) await tick();
    live--;
    return `${i}:${n}`;
  });
  assert.deepEqual(got, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0']);
  assert.equal(peak, 2);
  assert.deepEqual(await mapBounded([], 4, async () => 1), []);
});
