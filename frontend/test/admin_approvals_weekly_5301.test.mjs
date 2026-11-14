/** #5301 — a period before decision history is a gap, never a zero. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekChart } from '../src/pages/admin/approvals/inboxModel.js';

test('a weekly period before decision history says Not recorded, never 0', () => {
  const chart = weekChart({
    weeks: [{ week_start: '2026-10-26' }, { week_start: '2026-11-02' }],
    totals: { arrived: [null, 3], decided: [null, 2], arrived_leaves_out: [], decided_leaves_out: [] },
    tile: { decided_this_week: 2, median_wait_hours: 10 }, unreadable: [],
  });
  assert.deepEqual(chart.chart.series.map((s) => s.values[0]), [null, null]);
  assert.match(chart.sum, /Not recorded/);
  assert.doesNotMatch(chart.sum, /from 0/);
});
