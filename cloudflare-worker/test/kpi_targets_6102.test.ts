/** #6102: bound project targets through the shared comparison and actual page adapter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { withKpiTargets, targetKey } from '../src/services/growKpiTargets.ts';
import type { KpiRow } from '../src/services/growKpis.ts';
import { adaptRecords } from '../../frontend/src/pages/cycles/adapters/index.js';

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
    assert.equal(cells(missing[0]).target.text, '$0.00'); assert.equal(cells(missing[0]).vs_target, null);
    assert.equal(cells(missing[1]).target.text, 'Not set'); assert.equal(cells(missing[1]).vs_target, null);
    assert.equal(missing[0].value, null);
  } finally { f.db.close(); }
});

test('churn money is never compared to a percentage target; custom and computed rows get no invented target', async () => {
  const f = fixture();
  try {
    f.insert(7, 'monthly_churn_pct', 2, 'down');
    const rows = await withKpiTargets(f.env, 7, [kpi('churn', 3, 'pct'), kpi('churn', 5000, 'usd_cents'), kpi('custom-mrr', 99), kpi('new_mrr', 9000, 'usd_cents')]);
    assert.equal(cells(rows[0]).target.text, '2%'); assert.equal(cells(rows[0]).vs_target, 'Above target');
    for (const row of rows.slice(1)) { assert.equal(row.target_state, 'unsupported'); assert.equal(row.target, null); assert.equal(cells(row).vs_target, null); assert.equal(cells(row).target.text, 'Not set · not supported in Focus'); }
    assert.equal(targetKey(kpi('mrr', 10000, 'usd_cents')), null);
  } finally { f.db.close(); }
});

test('a failed target read leaves actuals readable and says Unreadable rather than Not set or zero', async () => {
  const f = fixture();
  try {
    f.db.exec('DROP TABLE metric_targets');
    const result = (await withKpiTargets(f.env, 7, [kpi()]))[0];
    assert.equal(result.value, 100); assert.equal(result.target_state, 'unreadable');
    assert.equal(cells(result).target.text, 'Unreadable'); assert.equal(cells(result).vs_target, null);
  } finally { f.db.close(); }
});
