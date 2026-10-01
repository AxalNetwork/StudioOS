/**
 * Three queue jobs stop throwing `no such column`.
 *
 * `metrics_snapshots` was two tables under one name. Production's is a DEAL
 * metrics table; `services/queueWorker.ts` read and wrote a GENERIC METRIC SERIES
 * that only `sql/historical/infrastructure.sql` ever declared, and nothing has
 * built from `historical/` since the migration ledger became the build path. The
 * collision was invisible until `check-sqlite-columns.mjs` stopped unioning
 * `historical/` into its harvest.
 *
 * RUN, NOT READ, and against a table built from `schema_baseline.sql` rather than
 * hand-copied — because a fixture is exactly how a test comes to pass against a
 * schema production has not got, and this whole task exists because two schemas
 * disagreed. Every failure worth catching here compiles:
 *
 *   · The old SELECT and INSERT named six columns that do not exist. A test that
 *     wrote its own `metrics_snapshots` with `scope`/`metric_name` would have
 *     passed over the broken code forever.
 *   · `traction_review` writing into `traction_score` would put a 0-10 AI
 *     momentum where `POST /pipeline/decision-gate/review` branches at 70 and 40,
 *     so every reviewed venture would read as "iterate" at the gate that decides
 *     whether it spins out. That is the trap `ai_scoring`'s own comment refuses
 *     and it is asserted against here.
 *   · `liquidity_valuation` threw BEFORE `Listings.updateValuation`, so a listing
 *     kept `ai_valuation_cents` NULL and `LiquidityPage.jsx` rendered "— pending"
 *     forever. The test drives the whole job and asserts the valuation lands.
 *   · A review INSERTed rather than UPDATEd would add a snapshot row with all ten
 *     metrics NULL, which pollutes the series the next review reads and drags
 *     `pipeline.ts`'s "latest snapshot" onto a row carrying no metrics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleJob } from '../src/services/queueWorker.ts';
import {
  metricPointsFrom, recentSnapshots, recordReview, latestMomentum,
  TRACTION_METRIC_COLUMNS,
} from '../src/services/tractionSnapshots.ts';
import { tableFromBaseline as readTable, stripForeignKeys, wordInText } from './_baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const BASELINE = readFileSync(resolve(HERE, '../sql/schema_baseline.sql'), 'utf8');

const PROJECT = 7701;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first(col?: string) {
          const r = db.prepare(sql).get(...b) ?? null;
          return col === undefined ? r : ((r as any)?.[col] ?? null);
        },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

/**
 * A table's DDL out of the baseline, with FK clauses stripped.
 *
 * `node:sqlite` enforces foreign keys by default, so a `REFERENCES` to a table
 * this fixture does not create fails at CREATE rather than at INSERT. What that
 * drops is referential integrity between fixture rows, which no assertion here
 * depends on — and D1 ignores `PRAGMA foreign_keys` inside a batch anyway, so
 * production is not relying on it either.
 */
function tableFromBaseline(table: string): string {
  // THE TABLE NAME IS ANCHORED IMMEDIATELY AFTER `CREATE TABLE`, and the first
  // version of this helper was not — it allowed `[^;]*?` in between, which
  // matched the `REFERENCES projects(id)` inside `activity_logs` and built that
  // table under the name `projects`. It failed loudly here ("no such table:
  // projects"), which was luck: a looser fixture that happened to satisfy the
  // queries would have passed over the wrong schema, which is the exact failure
  // this whole task exists to fix.
  //
  // The anchor now lives in `_baseline.mjs`, shared with the two other fixtures
  // that had copied this function, and `baseline_reader.test.mjs` holds it there
  // with this exact case: `projects` must resolve to its own `CREATE TABLE` and
  // never to a `REFERENCES projects(id)` inside another one.
  return stripForeignKeys(readTable(BASELINE, table));
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['metrics_snapshots', 'system_metrics', 'projects', 'subsidiaries',
    'score_snapshots', 'secondary_listings']) {
    db.exec(tableFromBaseline(t));
  }
  db.prepare('INSERT INTO projects (id, founder_id, name) VALUES (?,?,?)').run(PROJECT, 1, 'Ours');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ DB: makeD1(db) } as any);

/** A snapshot row with whichever of the ten metrics a test cares about. */
function addSnapshot(db: any, opts: {
  date: string; km?: Record<string, unknown>; score?: number | null;
  metrics?: Partial<Record<(typeof TRACTION_METRIC_COLUMNS)[number], number>>;
  project?: number;
}) {
  const metrics = opts.metrics || {};
  const cols = Object.keys(metrics);
  const sql = `INSERT INTO metrics_snapshots (deal_id, snapshot_date, key_metrics, traction_score${
    cols.length ? `, ${cols.join(', ')}` : ''
  }) VALUES (?, ?, ?, ?${cols.map(() => ', ?').join('')})`;
  const r = db.prepare(sql).run(
    opts.project ?? PROJECT, opts.date,
    opts.km ? JSON.stringify(opts.km) : null,
    opts.score ?? null,
    ...cols.map((c) => (metrics as any)[c]),
  );
  return Number(r.lastInsertRowid);
}

/** A stub AI binding, so no test depends on a model being reachable. */
const stubAI = (momentum: number, trend = 'up') => ({
  async run() {
    return { response: JSON.stringify({ momentum, trend, summary: 'Steady growth across the board.' }) };
  },
});

// ── the flattening ────────────────────────────────────────────────────────────

test('one snapshot row becomes one metric point per recorded column', () => {
  const points = metricPointsFrom([{
    id: 1, snapshot_date: '2026-04-04', key_metrics: null, ai_review: null,
    arr: 120000, cac: 900, headcount: 7,
  } as any]);
  assert.deepEqual(points.map((p) => p.metric_name).sort(), ['arr', 'cac', 'headcount']);
  assert.deepEqual(points.map((p) => p.captured_at), ['2026-04-04', '2026-04-04', '2026-04-04']);
  assert.equal(points.find((p) => p.metric_name === 'arr')!.value, 120000);
});

test('a NULL metric is skipped, never sent as zero', () => {
  // THE ABSENT-IS-NOT-EMPTY RULE WHERE IT REACHES A MODEL. `net_burn=0` in a
  // prompt is a statement about the venture that nobody made, and the model
  // cannot tell it from a real zero burn.
  const points = metricPointsFrom([{
    id: 1, snapshot_date: '2026-04-04', key_metrics: null, ai_review: null,
    arr: 0, net_burn: null, cac: undefined,
  } as any]);
  assert.deepEqual(points.map((p) => p.metric_name), ['arr'], 'a NULL or absent metric reached the prompt');
  assert.equal(points[0].value, 0, 'a genuine zero must survive — it is a recorded fact');
});

test('key_metrics contributes points, and non-numbers in it do not', () => {
  const points = metricPointsFrom([{
    id: 1, snapshot_date: '2026-04-04', ai_review: null,
    key_metrics: JSON.stringify({ users: 4200, revenue: 31000, note: 'looking good', growth: null }),
  } as any]);
  const names = points.map((p) => p.metric_name).sort();
  assert.deepEqual(names, ['revenue', 'users'], `a non-numeric entry reached the prompt: ${names}`);
});

test('malformed key_metrics is skipped rather than throwing', () => {
  const points = metricPointsFrom([{
    id: 1, snapshot_date: '2026-04-04', ai_review: null, key_metrics: '{not json',  arr: 5,
  } as any]);
  assert.deepEqual(points.map((p) => p.metric_name), ['arr']);
});

test('the SELECT names exactly the ten columns the flattener reads', () => {
  // The one thing that can drift now that the column list is written out in the
  // SQL rather than interpolated from the array. See `recentSnapshots`.
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/tractionSnapshots.ts'), 'utf8');
  const sel = src.match(/SELECT id, snapshot_date, key_metrics, ai_review,([\s\S]*?)FROM metrics_snapshots/);
  assert.ok(sel, 'recentSnapshots no longer has a SELECT this guard can read');
  const named = sel![1].split(',').map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(named, [...TRACTION_METRIC_COLUMNS].sort(),
    'the SELECT and TRACTION_METRIC_COLUMNS have drifted — a column in one and not the other is read as absent');
});

// ── the store ─────────────────────────────────────────────────────────────────

test('recentSnapshots reads newest first and is scoped to the deal', async () => {
  const db = freshDb();
  const e = env(db);
  addSnapshot(db, { date: '2026-01-01', metrics: { arr: 1 } });
  addSnapshot(db, { date: '2026-05-05', metrics: { arr: 3 } });
  addSnapshot(db, { date: '2026-03-03', metrics: { arr: 2 } });
  addSnapshot(db, { date: '2026-09-09', metrics: { arr: 99 }, project: 9999 });

  const rows = await recentSnapshots(e, PROJECT);
  assert.deepEqual(rows.map((r) => r.snapshot_date), ['2026-05-05', '2026-03-03', '2026-01-01']);
  assert.equal(rows.length, 3, 'another project\'s snapshot reached this deal');
});

test('a review UPDATEs the snapshot it reviewed and adds no row', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addSnapshot(db, { date: '2026-05-05', metrics: { arr: 100 }, score: 62 });

  const ok = await recordReview(e, id, {
    momentum: 8, trend: 'up', summary: 'Good', reviewed_at: '2026-09-13T00:00:00.000Z', points: 1,
  });
  assert.equal(ok, true);
  const rows = db.prepare('SELECT id, traction_score, ai_review, arr FROM metrics_snapshots').all() as any[];
  assert.equal(rows.length, 1, 'the review INSERTed a row — a snapshot with no metrics in the series');
  assert.equal(JSON.parse(rows[0].ai_review).momentum, 8);
  // THE COLUMN IT MUST NOT TOUCH. `traction_score` is a 0-100 rule-based score
  // and `decision-gate/review` branches on it at 70 and 40; a 0-10 momentum
  // there makes every reviewed venture read as "iterate".
  assert.equal(rows[0].traction_score, 62, 'the review overwrote the rule-based traction score');
  assert.equal(rows[0].arr, 100, 'the review clobbered a recorded metric');
});

test('a review of a snapshot that is not there writes nothing and says so', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal(await recordReview(e, 4242, {
    momentum: 5, trend: 'flat', summary: 'x', reviewed_at: 'now', points: 0,
  }), false);
});

test('latestMomentum takes the newest reviewed snapshot, and null when there is none', async () => {
  const db = freshDb();
  const e = env(db);
  assert.equal(await latestMomentum(e, PROJECT), null, 'a project with no snapshots reported a momentum');

  const older = addSnapshot(db, { date: '2026-02-02', metrics: { arr: 1 } });
  const newer = addSnapshot(db, { date: '2026-08-08', metrics: { arr: 2 } });
  assert.equal(await latestMomentum(e, PROJECT), null, 'an unreviewed snapshot reported a momentum');

  await recordReview(e, older, { momentum: 3, trend: 'down', summary: 'a', reviewed_at: 'x', points: 1 });
  assert.equal(await latestMomentum(e, PROJECT), 3, 'the only review on file was not read');
  await recordReview(e, newer, { momentum: 9, trend: 'up', summary: 'b', reviewed_at: 'y', points: 1 });
  assert.equal(await latestMomentum(e, PROJECT), 9, 'an older review outranked a newer one');
});

test('latestMomentum returns null on an unparseable review rather than throwing', async () => {
  const db = freshDb();
  const e = env(db);
  const id = addSnapshot(db, { date: '2026-02-02', metrics: { arr: 1 } });
  db.prepare('UPDATE metrics_snapshots SET ai_review = ? WHERE id = ?').run('not json at all', id);
  // A VALUATION IS THE CALLER. One that dies on a malformed annotation is
  // precisely how a listing came to read "— pending" forever.
  assert.equal(await latestMomentum(e, PROJECT), null);
});

// ── the jobs ──────────────────────────────────────────────────────────────────

test('traction_review reviews the metrics that exist and annotates the latest snapshot', async () => {
  const db = freshDb();
  const e = { ...env(db), AI: stubAI(7) };
  addSnapshot(db, { date: '2026-03-03', metrics: { arr: 90000, headcount: 5 } });
  const latest = addSnapshot(db, {
    date: '2026-06-06', metrics: { arr: 140000, headcount: 8, net_burn: 22000 },
    km: { users: 5100 }, score: 71,
  });

  await handleJob(e, { id: 1, job_type: 'traction_review', payload: JSON.stringify({ project_id: PROJECT }) } as any);

  const row = db.prepare('SELECT ai_review, traction_score FROM metrics_snapshots WHERE id = ?').get(latest) as any;
  const review = JSON.parse(row.ai_review);
  assert.equal(review.momentum, 7);
  assert.equal(review.trend, 'up');
  // SIX POINTS: two from the older snapshot, three metrics plus one key_metric
  // from the newer. The count is stored so a reader can tell a momentum computed
  // from nothing from one computed from real numbers.
  assert.equal(review.points, 6, `the review saw ${review.points} metric points`);
  assert.equal(row.traction_score, 71, 'the rule-based score was overwritten by the AI momentum');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM metrics_snapshots').get() as any).n, 2,
    'the review added a snapshot row',
  );
  // And the older snapshot is untouched: a review annotates one measurement.
  const older = db.prepare('SELECT ai_review FROM metrics_snapshots WHERE id != ?').get(latest) as any;
  assert.equal(older.ai_review, null);
});

test('traction_review on a project with no snapshot writes nothing and does not throw', async () => {
  const db = freshDb();
  const e = { ...env(db), AI: stubAI(5) };
  // A venture nobody has measured has nothing to review. Throwing would put the
  // job back to `pending` to fail again on every retry for as long as it stays
  // un-measured.
  await handleJob(e, { id: 1, job_type: 'traction_review', payload: JSON.stringify({ project_id: PROJECT }) } as any);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM metrics_snapshots').get() as any).n, 0);
});

test('traction_review with no project_id throws rather than reviewing nothing quietly', async () => {
  const db = freshDb();
  const e = { ...env(db), AI: stubAI(5) };
  await assert.rejects(
    () => handleJob(e, { id: 1, job_type: 'traction_review', payload: JSON.stringify({}) } as any),
    /missing project_id/,
  );
});

test('a retried traction_review overwrites one column and doubles nothing', async () => {
  const db = freshDb();
  const e = { ...env(db), AI: stubAI(4) };
  const latest = addSnapshot(db, { date: '2026-06-06', metrics: { arr: 140000 }, score: 55 });
  const job = { id: 1, job_type: 'traction_review', payload: JSON.stringify({ project_id: PROJECT }) } as any;

  await handleJob(e, job);
  await handleJob(e, job);
  await handleJob(e, job);

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM metrics_snapshots').get() as any).n, 1,
    'a retry added snapshot rows');
  const row = db.prepare('SELECT ai_review, traction_score, arr FROM metrics_snapshots WHERE id = ?').get(latest) as any;
  assert.equal(JSON.parse(row.ai_review).momentum, 4);
  assert.equal(row.traction_score, 55);
  assert.equal(row.arr, 140000);
});

test('metrics_aggregation records the counter in system_metrics, not in a deal table', async () => {
  const db = freshDb();
  const e = env(db);
  db.prepare("INSERT INTO projects (id, founder_id, name, created_at) VALUES (?,?,?,datetime('now'))")
    .run(7702, 1, 'Fresh');
  db.prepare("INSERT INTO projects (id, founder_id, name, created_at) VALUES (?,?,?,datetime('now','-3 day'))")
    .run(7703, 1, 'Old');

  await handleJob(e, {
    id: 1, job_type: 'metrics_aggregation',
    payload: JSON.stringify({ trigger: 'spinout_independent' }),
  } as any);

  const rows = db.prepare("SELECT metric_name, value, labels FROM system_metrics WHERE metric_name = 'projects_24h'")
    .all() as any[];
  assert.equal(rows.length, 1, 'the counter did not land in system_metrics');
  // Two within 24h: the fixture's own PROJECT (created_at defaults to now) and
  // 7702. 7703 is three days old.
  assert.equal(rows[0].value, 2, `counted ${rows[0].value} projects in the last 24h`);
  assert.equal(JSON.parse(rows[0].labels).window, '24h', 'the window is not recorded, so the number is unreadable');
  assert.equal(JSON.parse(rows[0].labels).trigger, 'spinout_independent');
  // AND NOTHING IN THE DEAL TABLE. A global figure has no deal_id.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM metrics_snapshots').get() as any).n, 0);
});

/**
 * A valuation stub that records the prompt it was asked.
 *
 * `aiValueAsset` reads `valuation_usd` in DOLLARS and clamps to a $25k floor, so
 * a stub returning `valuation_cents` is silently ignored and every valuation
 * lands on the floor. The first draft of these two tests did exactly that and
 * asserted the floor as if it were the stub's answer — which would have passed
 * with the AI call removed entirely.
 */
function valuationStub(usd: number) {
  const prompts: string[] = [];
  return {
    prompts,
    AI: {
      async run(_model: string, opts: any) {
        prompts.push(String(opts?.messages?.[1]?.content ?? ''));
        return {
          response: JSON.stringify({ valuation_usd: usd, confidence: 'medium', rationale: 'Stubbed.' }),
        };
      },
    },
  };
}

function listingFixture(db: any) {
  db.prepare('INSERT INTO subsidiaries (id, deal_id, subsidiary_name) VALUES (?,?,?)')
    .run(11, PROJECT, 'Spinout Co');
  db.prepare('INSERT INTO secondary_listings (id, user_id, subsidiary_id, shares, asking_price_cents, status) VALUES (?,?,?,?,?,?)')
    .run(31, 1, 11, 100, 5000000, 'open');
}

test('liquidity_valuation completes, and the recorded momentum reaches the model', async () => {
  const db = freshDb();
  // THE WHOLE POINT OF THIS FILE. The momentum read named four columns
  // `metrics_snapshots` does not have and sat BEFORE `Listings.updateValuation`
  // with no catch between, so `ai_valuation_cents` stayed NULL and
  // `LiquidityPage.jsx:562` rendered "— pending" for the listing forever.
  const stub = valuationStub(45_000);
  const e = { ...env(db), AI: stub.AI };
  listingFixture(db);
  const snap = addSnapshot(db, { date: '2026-06-06', metrics: { arr: 140000 } });
  await recordReview(e, snap, {
    momentum: 8, trend: 'up', summary: 'Strong', reviewed_at: '2026-09-13T00:00:00.000Z', points: 1,
  });

  await handleJob(e, {
    id: 1, job_type: 'liquidity_valuation',
    payload: JSON.stringify({ listing_id: 31, subsidiary_id: 11 }),
  } as any);

  const row = db.prepare('SELECT ai_valuation_cents FROM secondary_listings WHERE id = 31').get() as any;
  assert.ok(row.ai_valuation_cents != null, 'the listing still has no valuation — the job threw on the way');
  assert.equal(row.ai_valuation_cents, 4_500_000, '$45,000 did not become 4,500,000 cents');
  // THE CHAIN, END TO END: `traction_review` wrote the momentum, `latestMomentum`
  // read it back out of the review JSON, and it arrived in the valuation prompt.
  // Asserting only the stored valuation would pass with the momentum dropped.
  assert.equal(stub.prompts.length, 1);
  assert.match(stub.prompts[0], /Momentum \(0-10\): 8/,
    'the momentum on file never reached the valuation');
});

test('liquidity_valuation still completes when no review has ever run', async () => {
  const db = freshDb();
  // ABOVE `MIN_VALUATION_CENTS` ($25k), deliberately. The first draft used
  // $12,000 and asserted 1,200,000 cents; `aiValueAsset` clamps up to the floor,
  // so the assertion failed on correct code — and had it been written as
  // `assert.ok(cents > 0)` it would have passed with the whole AI call gone.
  const stub = valuationStub(38_000);
  const e = { ...env(db), AI: stub.AI };
  listingFixture(db);

  // No snapshot and no review at all — the ordinary case for a young venture.
  // The valuation must still land, because a missing momentum is one weaker input
  // and not a reason to leave a listing unpriced.
  await handleJob(e, {
    id: 1, job_type: 'liquidity_valuation',
    payload: JSON.stringify({ listing_id: 31, subsidiary_id: 11 }),
  } as any);

  const row = db.prepare('SELECT ai_valuation_cents FROM secondary_listings WHERE id = 31').get() as any;
  assert.equal(row.ai_valuation_cents, 3_800_000);
  // `n/a` AND NOT `0`. `aiValueAsset` renders an absent momentum as "n/a", and a
  // zero there would tell the model this venture has no momentum rather than that
  // nobody has measured it — the absent-is-not-empty rule where it reaches a
  // price.
  assert.match(stub.prompts[0], /Momentum \(0-10\): n\/a/,
    'an unmeasured venture was reported to the model as zero momentum');
});

test('no handler names the generic-series columns any more', () => {
  // THE COLLISION ITSELF, asserted as gone. These six names are what
  // `sql/historical/infrastructure.sql` declares and production does not have;
  // their six entries have been deleted from `sqlite-columns-baseline.json`, and
  // that guard fails on a NEW entry — so this stops one being re-added by a
  // handler rather than by the ledger.
  const src = readFileSync(resolve(ROOT, 'cloudflare-worker/src/services/queueWorker.ts'), 'utf8');
  const sqlOnly = [...src.matchAll(/`([^`]*metrics_snapshots[^`]*)`/g)].map((m) => m[1]).join('\n');
  for (const col of ['scope', 'scope_id', 'metric_name', 'captured_at', 'extra']) {
    assert.ok(!wordInText(sqlOnly, col),
      `a queueWorker SQL string names metrics_snapshots.${col}, which production does not have`);
  }
  // `value` is too common a word to ban outright, so it is checked as a column
  // reference in a SELECT list or an INSERT column list instead.
  assert.ok(!/SELECT\s+value\s+FROM metrics_snapshots/i.test(sqlOnly), 'the momentum SELECT is back');
});
