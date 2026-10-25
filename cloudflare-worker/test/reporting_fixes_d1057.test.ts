/**
 * D1057 (#2927) — Reporting part 1, the fixes for #2427's findings 3 and 4 on
 * stubbed D1 (node:sqlite, the baseline's tables and migration 437's columns).
 * Findings 6, 7 and 8 are held where their routes' harnesses already are:
 * `portfolio_chase.test.ts`, `raise_pipeline.test.ts` and
 * `investor_company_scope.test.ts`.
 *
 *   3. Quarterly compliance counts a Grow update's `YYYY-MM` for the quarter
 *      it falls in; monthly compliance compares months.
 *   4. An investor's update rows carry Share an update's figures from
 *      `metrics_json`, each with its source, keyed by METRIC_KEYS.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/reporting_fixes_d1057.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import positions from '../src/routes/positions.ts';
import updates, { updateFigures } from '../src/routes/portfolio_updates.ts';
import { periodCounts } from '../src/services/portfolioMetrics.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const M437 = readFileSync(new URL('../sql/migrations/437_share_an_update.sql', import.meta.url), 'utf8');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'projects', 'portfolio_positions', 'portfolio_updates']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(M437.split(/;\s*\n/).map((x) => x.replace(/^\s*--.*$/gm, '').trim())
    .filter((x) => /^(ALTER TABLE portfolio_updates|CREATE TABLE IF NOT EXISTS update_recipients)/i.test(x)).map((x) => `${x};`).join('\n'));
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Ada Admin', 'ada@example.test', 1)").run(ADMIN);
  const p = db.prepare('INSERT INTO projects (id, uid, name, founder_id) VALUES (?, ?, ?, 9)');
  for (const [id, name] of [[1, 'Monthly in Q3'], [2, 'Quarter Q3'], [3, 'Month in Q2'], [4, 'Draft in Q3'], [5, 'Free text']] as const) p.run(id, `p-${id}`, name);
  const pos = db.prepare("INSERT INTO portfolio_positions (uid, project_id, round_name, invested_amount) VALUES (?, ?, 'Seed', 100)");
  for (const id of [1, 2, 3, 4, 5]) pos.run(`pos-${id}`, id);
  return db;
}

const env = (db: DatabaseSync): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
async function get(router: any, db: DatabaseSync, path: string) {
  const t = await new SignJWT({ user_id: ADMIN, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await router.request(path, { headers: { Authorization: `Bearer ${t}` } }, env(db));
  return { status: res.status, body: await res.json() as any };
}
const update = (db: DatabaseSync, o: Record<string, unknown>) => {
  const row = { uid: `u-${Math.random().toString(36).slice(2)}`, author_user_id: 9, title: 'An update', status: 'submitted', submitted_at: '2026-09-01T10:00:00.000Z', ...o };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO portfolio_updates (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(Object.values(row) as any[]));
};

// ── Finding 3 ────────────────────────────────────────────────────────────────

test('a month inside the quarter counts for the quarter; a quarter counts only for itself; anything else counts for nothing', () => {
  // Mutations checked: the month-to-quarter mapping off by one; a quarter counted for a month; free text accepted.
  assert.equal(periodCounts('quarterly', '2026-Q3', '2026-07'), true);
  assert.equal(periodCounts('quarterly', '2026-Q3', '2026-09'), true);
  assert.equal(periodCounts('quarterly', '2026-Q3', '2026-06'), false, 'June is Q2');
  assert.equal(periodCounts('quarterly', '2026-Q3', '2026-10'), false, 'October is Q4');
  assert.equal(periodCounts('quarterly', '2026-Q1', '2026-03'), true);
  assert.equal(periodCounts('quarterly', '2026-Q3', '2025-08'), false, 'the year must match');
  assert.equal(periodCounts('quarterly', '2026-Q3', '2026-Q3'), true);
  assert.equal(periodCounts('quarterly', '2026-Q3', ' 2026-Q3 '), true, 'surrounding spaces are not a different period');
  assert.equal(periodCounts('monthly', '2026-08', '2026-08'), true);
  assert.equal(periodCounts('monthly', '2026-08', '2026-Q3'), false, 'a quarter does not say which month it reports');
  assert.equal(periodCounts('monthly', '2026-08', '2026-07'), false);
  for (const bad of ['', null, undefined, 'Q3 2026', '2026-13', '2026-Q5', 'Sept']) {
    assert.equal(periodCounts('quarterly', '2026-Q3', bad as any), false, String(bad));
    assert.equal(periodCounts('monthly', '2026-09', bad as any), false, String(bad));
  }
  assert.equal(periodCounts('quarterly', null, '2026-07'), false);
});

test('quarterly compliance reads Grow\'s monthly periods: a submitted September update is reported for Q3', async () => {
  // Mutation checked: the route back on string equality (finding 3 reopened).
  const db = fixture();
  update(db, { project_id: 1, period: '2026-08' });          // Share an update stores the start month
  update(db, { project_id: 2, period: '2026-Q3' });          // the KPI form's quarter
  update(db, { project_id: 3, period: '2026-06' });          // last quarter
  update(db, { project_id: 4, period: '2026-09', status: 'draft' });
  update(db, { project_id: 5, period: 'Q3 2026' });
  const q = await get(positions, db, '/kpi-compliance?as_of=2026-09-15');
  assert.equal(q.status, 200);
  assert.equal(q.body.period, '2026-Q3');
  const reported = Object.fromEntries(q.body.companies.map((x: any) => [x.project_id, x.reported]));
  assert.deepEqual(reported, { 1: true, 2: true, 3: false, 4: false, 5: false });
  assert.equal(q.body.reported_count, 2);
  const m = await get(positions, db, '/kpi-compliance?as_of=2026-08-20&cadence=monthly');
  assert.equal(m.body.period, '2026-08');
  assert.deepEqual(m.body.companies.filter((x: any) => x.reported).map((x: any) => x.project_id), [1], 'monthly compares months');
});

// ── Finding 4 ────────────────────────────────────────────────────────────────

const METRICS = JSON.stringify([
  { key: 'mrr', label: 'MRR', unit: 'usd', value: 38400, source: 'stripe', as_of: '2026-09-12', reason: null },
  { key: 'growth', label: 'Growth', unit: 'pct', value: null, source: null, as_of: null, reason: 'Not recorded: growth needs MRR recorded in this period and the month before' },
  { key: 'burn', label: 'Burn', unit: 'usd', value: 12000, source: 'typed', as_of: '2026-09-30', reason: null },
  { key: 'runway', label: 'Runway', unit: 'months', value: 9, source: null, as_of: null, reason: null },
  { key: 'invented', label: 'X', unit: 'usd', value: 1, source: 'x', as_of: null, reason: null },
]);

test('an update\'s figures come from metrics_json with their sources, keyed as Share an update keys them; nothing recorded stays null', () => {
  // Mutations checked: sources relabelled "typed"; a sourceless figure kept; a null read as 0.
  const { figures, kpis } = updateFigures({ metrics_json: METRICS, kpis_json: null });
  assert.deepEqual(figures.map((f) => [f.key, f.value, f.source, f.as_of]), [
    ['mrr', 38400, 'stripe', '2026-09-12'],
    ['growth', null, null, null],
    ['burn', 12000, 'typed', '2026-09-30'],
  ], 'the stored sources are kept; a recorded figure with no source and an unknown key are dropped');
  assert.match(figures[1].reason!, /^Not recorded: growth needs/);
  assert.deepEqual(kpis, { mrr: 38400, burn: 12000 }, 'the flat map the pages read carries the recorded figures, never a 0 for growth');
  const legacy = updateFigures({ kpis_json: JSON.stringify({ mrr: 1, runway_months: 6 }), metrics_json: null });
  assert.deepEqual([legacy.figures, legacy.kpis], [[], { mrr: 1, runway_months: 6 }], 'a KPI-form row reads as before');
  assert.deepEqual(updateFigures({ kpis_json: JSON.stringify({ mrr: 1 }), metrics_json: METRICS }).kpis.mrr, 1, 'a typed KPI-form value is not overwritten');
  assert.deepEqual(updateFigures({ kpis_json: 'not json', metrics_json: 'not json' }), { figures: [], kpis: {} });
});

test('the inbox and the detail read return a Share an update row\'s figures, so it never reads "No KPI values recorded"', async () => {
  const db = fixture();
  update(db, { uid: 'share-1', project_id: 1, period: '2026-09', metrics_json: METRICS, sent_at: '2026-10-01T10:00:00.000Z' });
  const list = await get(updates, db, '/?project_id=1');
  assert.equal(list.status, 200);
  const row = list.body.items.find((x: any) => x.uid === 'share-1');
  assert.deepEqual(row.kpis, { mrr: 38400, burn: 12000 });
  assert.deepEqual(row.figures.map((f: any) => [f.key, f.source]), [['mrr', 'stripe'], ['growth', null], ['burn', 'typed']]);
  const one = await get(updates, db, '/share-1');
  assert.equal(one.status, 200);
  assert.equal(one.body.figures[0].source, 'stripe');
});
