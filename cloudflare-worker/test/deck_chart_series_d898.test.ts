/**
 * D898 group C (#2676) — the series a pitch-deck chart plots:
 * `GET /api/decks/chart-series` and the chart series in `POST /api/decks/:id/refresh`.
 *
 *  1. Stripe's snapshots and the typed ones are two series, each with its own
 *     Source and grade; one point per month, the newest of that month; a month
 *     with no snapshot is left out, never a 0.
 *  2. Interviews per week: from the first week to the last, a week between with
 *     none is a real 0; Measured only when every interview was recorded.
 *  3. The library's fits: how many series each type can draw, and the reason
 *     for a type with none; never another venture's records.
 *  4. Refresh compares a chart series by its own snapshot: a new month is stale.
 *
 * On the baseline and every migration, as production builds it. Every person,
 * venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_chart_series_d898.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckSources from '../src/routes/deck_sources.ts';
import decks from '../src/routes/decks.ts';
import { CHART_SERIES, chartFits, isSeriesKey } from '../src/services/decks/chartSeries.ts';
import { CHART_TYPES } from '../src/services/decks/slideModel.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FOUNDER = 10, OTHER = 20;
const P = 1, P_OTHER = 2;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${P_OTHER}, 'Beta Works', 1002)`);
  return db;
}

const app = new Hono<any>();
app.route('/api/decks', deckSources);
app.route('/api/decks', decks);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string) {
  const token = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, { method, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const series = (body: any, key: string) => body.series.find((s: any) => s.key === key);

test('1. Stripe and typed snapshots are two series, each with its Source and grade; one point per month, the newest; no month is a 0', async () => {
  const db = fixture();
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, mrr, paying_accounts, source) VALUES
    (1, ${P}, '2026-07-31', 12000, 30, 'stripe'),
    (2, ${P}, '2026-08-15', 13000, 31, 'stripe'),
    (3, ${P}, '2026-08-31', 14100, 33, 'stripe'),
    (4, ${P}, '2026-10-31', 16950, 38, 'stripe'),
    (5, ${P}, '2026-10-20', 18400, NULL, NULL),
    (6, ${P_OTHER}, '2026-10-31', 99999, 99, 'stripe')`);
  const r = await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`);
  assert.equal(r.status, 200);
  const mrr = series(r.body, 'grow.mrr.monthly');
  assert.deepEqual(mrr.points, [{ x: '2026-07', y: 12000 }, { x: '2026-08', y: 14100 }, { x: '2026-10', y: 16950 }], 'September has no snapshot: left out, never 0');
  assert.deepEqual([mrr.state, mrr.source, mrr.grade, mrr.as_of, mrr.record_ref], ['recorded', 'Connector', 'Measured', '2026-10-31', 'project_metrics:4']);
  assert.match(mrr.snapshot_hash, /^[0-9a-f]{24}$/);
  const typed = series(r.body, 'grow.mrr.typed');
  assert.deepEqual([typed.points, typed.source, typed.grade], [[{ x: '2026-10', y: 18400 }], 'Typed', 'Stated'], 'never blended with Stripe');
  const typedCustomers = series(r.body, 'grow.paying_customers.typed');
  assert.deepEqual([typedCustomers.state, typedCustomers.points, typedCustomers.grade], ['not_recorded', [], 'Not recorded'], 'a null column is no point');
  assert.equal(series(r.body, 'grow.arr.monthly').state, 'not_recorded');
  assert.ok(!JSON.stringify(r.body).includes('99999'), 'never another venture\'s records');
  // Not the founder's venture: refused.
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/chart-series?project_id=${P}`)).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/chart-series')).status, 400);
});

test('2. interviews per week: first week to last, a week between with none is a real 0; Sourced when one was logged by hand', async () => {
  const db = fixture();
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, stage, created_at) VALUES
    (1, ${P}, 'A', '2026-10-05', 'done', '2026-10-05'),
    (2, ${P}, 'B', '2026-10-07', 'done', '2026-10-07'),
    (3, ${P}, 'C', '2026-10-21', NULL, '2026-10-21'),
    (4, ${P}, 'D', NULL, 'invited', '2026-10-22')`);
  db.exec(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
    VALUES ('s1', 1, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given')`);
  const r = await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`);
  const w = series(r.body, 'validate.interviews.weekly');
  assert.deepEqual(w.points, [{ x: '2026-10-05', y: 2 }, { x: '2026-10-12', y: 0 }, { x: '2026-10-19', y: 1 }], 'the week of 12 Oct held none, a real 0; an invitation is not held');
  assert.deepEqual([w.source, w.grade, w.as_of], ['Recorded', 'Sourced', '2026-10-21']);
  db.exec(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status) VALUES
    ('s2', 2, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given'), ('s3', 3, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given')`);
  assert.equal(series((await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`)).body, 'validate.interviews.weekly').grade, 'Measured');
});

test('3. the library\'s fits: how many series each type draws, and the reason for a type with none', async () => {
  const db = fixture();
  let r = await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`);
  assert.deepEqual(r.body.types.map((t: any) => t.type), [...CHART_TYPES]);
  assert.ok(r.body.types.every((t: any) => t.fits === 0 && t.reason), 'nothing recorded: every type greyed, each with its reason');
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, mrr, arr, paying_accounts, source) VALUES
    (1, ${P}, '2026-08-31', 14100, 169200, 33, 'stripe'), (2, ${P}, '2026-09-30', 16950, 203400, 38, 'stripe')`);
  r = await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`);
  const fit = Object.fromEntries(r.body.types.map((t: any) => [t.type, t]));
  assert.equal(fit.line.fits, 3, 'MRR, ARR and paying customers each have two points');
  assert.equal(fit.line.label, 'Line');
  assert.equal(fit.stacked.fits, 2, 'MRR and ARR share a unit');
  assert.equal(fit.metric_tiles.fits, 3);
  assert.equal(fit.waterfall.fits, 3);
  assert.equal(fit.cohort_heatmap.fits, 0);
  assert.equal(fit.cohort_heatmap.reason, 'Needs churn by month joined, not recorded on StudioOS yet.');
  assert.equal(fit.line.reason, null);
  // The pure rule: one point is no trend; two series in different units do not stack.
  const one = chartFits([{ key: 'a', unit: 'usd', state: 'recorded', points: [{ x: '2026-09', y: 1 }] } as any, { key: 'b', unit: 'count', state: 'recorded', points: [{ x: '2026-09', y: 1 }, { x: '2026-10', y: 2 }] } as any]);
  const f = Object.fromEntries(one.map((t) => [t.type, t]));
  assert.deepEqual([f.line.fits, f.stacked.fits, f.metric_tiles.fits], [1, 0, 2]);
  assert.equal(f.stacked.reason, 'Needs two series in the same unit.');
  assert.ok(CHART_SERIES.every((d) => isSeriesKey(d.key)) && !isSeriesKey('grow.mrr'), 'a series key is never a source slot key');
});

test('4. refresh compares a chart series by its own snapshot: a new month marks it stale; writes nothing', async () => {
  const db = fixture();
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, mrr, source) VALUES (1, ${P}, '2026-08-31', 14100, 'stripe'), (2, ${P}, '2026-09-30', 16950, 'stripe')`);
  const now = series((await call(db, FOUNDER, 'GET', `/api/decks/chart-series?project_id=${P}`)).body, 'grow.mrr.monthly');
  const binding = { source_key: now.key, record_ref: now.record_ref, as_of: now.as_of, grade: now.grade, snapshot_hash: now.snapshot_hash };
  const slides = [{ title: 'Traction', layout: 'chart_text', blocks: [{ id: 'b1', kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, chart_type: 'line', range: 'all', series: [{ label: 'MRR', binding }] }] }];
  db.exec(`CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, title TEXT, slides TEXT, is_current INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (?, ?, ?, ?)').run(70, P, 3, JSON.stringify(slides));
  const before = await call(db, FOUNDER, 'POST', '/api/decks/70/refresh');
  assert.equal(before.status, 200);
  assert.deepEqual([before.body.checked, before.body.stale, before.body.rows[0].state, before.body.rows[0].field], [1, 0, 'fresh', 'block:0:series:0']);
  db.exec(`INSERT INTO project_metrics (id, project_id, snapshot_date, mrr, source) VALUES (3, ${P}, '2026-10-31', 18200, 'stripe')`);
  const after = await call(db, FOUNDER, 'POST', '/api/decks/70/refresh');
  assert.equal(after.body.stale, 1);
  assert.deepEqual([after.body.rows[0].state, after.body.rows[0].current.value, after.body.rows[0].current.as_of], ['stale', 18200, '2026-10-31']);
  assert.equal(JSON.parse((db.prepare('SELECT slides FROM pitch_decks WHERE id = 70').get() as any).slides)[0].blocks[0].series[0].binding.as_of, '2026-09-30');
  // Every snapshot gone: the series is gone, not fresh.
  db.exec(`DELETE FROM project_metrics WHERE project_id = ${P}`);
  assert.equal((await call(db, FOUNDER, 'POST', '/api/decks/70/refresh')).body.rows[0].state, 'gone');
});
