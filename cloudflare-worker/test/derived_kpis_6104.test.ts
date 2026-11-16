/** D6104 (#6104) — ARR and burn multiple are worked out, never typed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrOf, burnMultipleOf, KPI_KEYS, type KpiRow } from '../src/services/growKpis.ts';

const row = (over: Partial<KpiRow>): KpiRow => ({ id: 'x', kpi: 'x', value: null, unit: 'usd', change_30d: null, source: null, as_of: null, period: null, reason: null, ...over });
const mrr = (value: number | null, change: number | null = null) => row({ id: 'mrr', kpi: 'MRR', value, change_30d: change, source: 'stripe', as_of: '2026-10-31', period: '2026-10' });
const burn = (value: number | null, period = '2026-10') => row({ id: 'net_burn', kpi: 'Burn', value, as_of: `${period}-28`, period });
const movements = (m: Record<string, number>) => (kind: string) => (kind in m ? { amount_cents: m[kind], as_of: '2026-10-31' } : null);

test('ARR is 12 × MRR, keeping its source, date and change; no MRR is Not recorded naming the input', () => {
  const a = arrOf(mrr(1000, 200));
  assert.deepEqual([a.id, a.value, a.change_30d, a.as_of, a.period, a.reason], ['arr', 12000, 2400, '2026-10-31', '2026-10', null]);
  assert.match(a.source!, /12 × MRR/);
  assert.equal(arrOf(mrr(0)).value, 0, 'a measured zero MRR is a zero ARR, not Not recorded');
  const none = arrOf(mrr(null));
  assert.deepEqual([none.value, none.reason], [null, 'Not recorded: needs MRR']);
});

test('burn multiple is burn ÷ 12 × the month\'s net new MRR (new + expansion + unsplit − churned)', () => {
  // Net new MRR = 500 + 200 − 100 = $600 → net new ARR $7,200; burn $18,000 → 2.5.
  const b = burnMultipleOf(burn(18000), true, null, '2026-10', movements({ new: 50000, expansion: 20000, churned: 10000 }));
  assert.deepEqual([b.id, b.value, b.unit, b.period, b.reason], ['burn_multiple', 2.5, 'multiple', '2026-10', null]);
  const unsplit = burnMultipleOf(burn(7200), true, null, '2026-10', movements({ unsplit: 60000 }));
  assert.equal(unsplit.value, 1, 'an unsplit movement counts toward net new');
});

test('burn multiple reads Not recorded with the missing input, never from fewer inputs', () => {
  const mv = movements({ new: 50000 });
  const why = (r: KpiRow) => r.reason;
  assert.equal(burnMultipleOf(burn(1000), false, null, '2026-10', mv).value, null);
  assert.match(why(burnMultipleOf(burn(1000), false, null, '2026-10', mv))!, /2 billings/);
  assert.match(why(burnMultipleOf(burn(1000), true, 'Not recorded: a month is missing', '2026-10', mv))!, /a month is missing/);
  assert.match(why(burnMultipleOf(burn(1000), true, null, null, mv))!, /net new ARR/);
  assert.match(why(burnMultipleOf(burn(null), true, null, '2026-10', mv))!, /needs burn/);
  assert.match(why(burnMultipleOf(burn(1000, '2026-09'), true, null, '2026-10', mv))!, /burn recorded for 2026-10/, 'burn from another month is never paired');
  assert.match(why(burnMultipleOf(burn(0), true, null, '2026-10', mv))!, /zero or negative/);
  assert.match(why(burnMultipleOf(burn(1000), true, null, '2026-10', movements({ new: 10000, churned: 10000 })))!, /net new ARR for 2026-10 is zero or negative/);
  assert.match(why(burnMultipleOf(burn(1000), true, null, '2026-10', movements({})))!, /zero or negative/);
});

test('both keys are KPI keys', () => {
  for (const k of ['arr', 'burn_multiple']) assert.ok((KPI_KEYS as readonly string[]).includes(k), k);
});
