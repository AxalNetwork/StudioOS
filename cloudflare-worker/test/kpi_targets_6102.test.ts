/** #6102: bound project targets through the shared comparison and actual page adapter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { d1Over } from './_d1_sqlite.mjs';
import { withKpiTargets, targetKey } from '../src/services/growKpiTargets.ts';
import type { KpiRow } from '../src/services/growKpis.ts';
import { adaptRecords } from '../../frontend/src/pages/cycles/adapters/index.js';
import { tableFromBaseline } from './_baseline.mjs';
import { growDb, call as growCall, FOUNDER, PID, TODAY } from './_mercury_grow_fixture.ts';

const kpi = (id = 'mrr', value: number | null = 100, unit: string | null = 'usd'): KpiRow => ({ id, value, unit, kpi: id, source: 'manual', as_of: '2026-11-14', period: '2026-11', change_30d: null, reason: null });
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE metric_targets (project_id INTEGER, metric_key TEXT, target_value REAL, direction TEXT, label TEXT, updated_at TEXT)');
  const insert = (project: number, key: string, value: number, direction = 'up') => db.prepare('INSERT INTO metric_targets VALUES (?, ?, ?, ?, NULL, NULL)').run(project, key, value, direction);
  return { db, env: { DB: d1Over(db) } as any, insert };
}
const cells = (row: unknown) => adaptRecords('grow', 'revenue-and-traction', { cols: ['KPI', 'Value', 'Change · 30 d', 'Source', 'As of', 'Target', 'Vs target'], rows: [row] }).rows[0].cells;

test('targets are scoped to this venture and compare in their recorded direction, including equality and zero', async () => {
  const f = fixture();
  try {
    f.insert(7, 'mrr', 100); f.insert(8, 'mrr', 999999);
    f.insert(7, 'net_burn', 50, 'down'); f.insert(7, 'paying_accounts', 0);
    assert.equal((await withKpiTargets(f.env, 8, [kpi()]))[0].target?.target_value, 999999);
    assert.equal((await withKpiTargets(f.env, 8, [kpi('paying_accounts', 0, 'count')]))[0].target_state, 'not_set');
    for (const [input, expected] of [[kpi('mrr', 100), 'Target met'], [kpi('mrr', 101), 'Target met'], [kpi('mrr', 99), 'Below target'],
      [kpi('net_burn', 49), 'Target met'], [kpi('net_burn', 51), 'Above target'], [kpi('paying_accounts', 0, 'count'), 'Target met']] as const) {
      const result = (await withKpiTargets(f.env, 7, [input]))[0];
      assert.equal(result.target?.target_value, input.id === 'mrr' ? 100 : input.id === 'net_burn' ? 50 : 0);
      assert.equal(cells(result).vs_target, expected);
      assert.equal(cells(result).target.href, '/grow/focus?project_id=7');
      assert.equal(cells(result).target.separateLink, true, 'Focus remains independently clickable in a linked row');
      assert.doesNotMatch(JSON.stringify(result), /999999/);
    }
    assert.equal(cells((await withKpiTargets(f.env, 7, [kpi('paying_accounts', 0, 'count')]))[0]).target.text, '0');
  } finally { f.db.close(); }
});

test('a stored target remains visible without an actual; a missing target is Not set and comparison is blank', async () => {
  const f = fixture();
  try {
    f.insert(7, 'mrr', 0);
    const missing = (await withKpiTargets(f.env, 7, [kpi('mrr', null, null), kpi('net_burn', 12)]));
    assert.equal(cells(missing[0]).target.text, '$0.00'); assert.deepEqual(cells(missing[0]).vs_target, { blank: true });
    assert.equal(cells(missing[1]).target.text, 'Not set'); assert.deepEqual(cells(missing[1]).vs_target, { blank: true });
    assert.equal(missing[0].value, null);
  } finally { f.db.close(); }
});

test('churn money is never compared to a percentage target; custom and computed rows get no invented target', async () => {
  const f = fixture();
  try {
    f.insert(7, 'monthly_churn_pct', 2, 'down');
    const rows = await withKpiTargets(f.env, 7, [kpi('churn', 3, 'pct'), kpi('churn', 5000, 'usd_cents'), kpi('custom-mrr', 99), kpi('new_mrr', 9000, 'usd_cents')]);
    assert.equal(cells(rows[0]).target.text, '2%'); assert.equal(cells(rows[0]).vs_target, 'Above target');
    for (const row of rows.slice(1)) { assert.equal(row.target_state, 'unsupported'); assert.equal(row.target, null); assert.deepEqual(cells(row).vs_target, { blank: true }); assert.equal(cells(row).target.text, 'Not set · not supported in Focus'); }
    assert.equal(targetKey(kpi('mrr', 10000, 'usd_cents')), null);
  } finally { f.db.close(); }
});

test('a failed target read leaves actuals readable and says Unreadable rather than Not set or zero', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE metric_targets');
    const result = (await withKpiTargets(f.env, 7, [kpi()]))[0];
    assert.equal(result.value, 100); assert.equal(result.target_state, 'unreadable');
    assert.equal(cells(result).target.text, 'Unreadable'); assert.deepEqual(cells(result).vs_target, { blank: true });
  } finally { f.db.close(); }
});

test('the mounted revenue records read carries project targets through the adapter and preserves project authorization', async () => {
  const f = await growDb();
  try {
    f.db.exec(tableFromBaseline(readFileSync(new URL('../sql/migrations/173_metrics_board_reporting.sql', import.meta.url), 'utf8'), 'metric_targets'));
    f.db.prepare('INSERT INTO project_metrics (project_id, snapshot_date, source, mrr, paying_accounts, net_burn, monthly_churn_pct) VALUES (?, ?, ?, ?, ?, ?, ?)').run(PID, TODAY, 'manual', 100, 0, 51, 3);
    const insert = f.db.prepare('INSERT INTO metric_targets (project_id, metric_key, target_value, direction) VALUES (?, ?, ?, ?)');
    insert.run(PID, 'mrr', 100, 'up'); insert.run(PID, 'paying_accounts', 0, 'up'); insert.run(PID, 'net_burn', 50, 'down'); insert.run(PID, 'monthly_churn_pct', 2, 'down');
    f.db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (8, 'p-other', 'Other venture', 99)").run();
    insert.run(8, 'mrr', 999999, 'up');
    const response = await growCall(f.env, FOUNDER, 'GET', `/api/cycles/grow/modules/revenue-and-traction?project=${PID}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.records.cols.slice(-2), ['Target', 'Vs target']);
    const rendered = adaptRecords('grow', 'revenue-and-traction', response.body.records);
    const byId = new Map(rendered.rows.map((row: any) => [row.recordId, row.cells]));
    assert.equal((byId.get('mrr') as any).target.text, '$100.00');
    assert.equal((byId.get('mrr') as any).vs_target, 'Target met');
    assert.equal((byId.get('paying_accounts') as any).target.text, '0');
    assert.equal((byId.get('net_burn') as any).vs_target, 'Above target');
    assert.equal((byId.get('churn') as any).target.text, '2%');
    assert.doesNotMatch(JSON.stringify(response.body.records), /999999/);
    assert.equal((await growCall(f.env, FOUNDER, 'GET', '/api/cycles/grow/modules/revenue-and-traction?project=8')).status, 403);
    f.db.exec('DROP TABLE metric_targets');
    const unavailable = await growCall(f.env, FOUNDER, 'GET', `/api/cycles/grow/modules/revenue-and-traction?project=${PID}`);
    assert.equal(unavailable.status, 200);
    const mrr = unavailable.body.records.rows.find((row: any) => row.id === 'mrr');
    assert.equal(mrr.value, 100); assert.equal(mrr.target_state, 'unreadable');
  } finally { f.db.close(); }
});
