import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { plan, MODEL_V1, SECTION_KEYS, type PlanInputs, type Fact } from '../src/services/useOfFunds/plan.ts';

// This engine cannot call a provider. A Mercury/other network regression fails closed.
let originalFetch: typeof fetch;
beforeEach(() => { originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External provider forbidden in synthetic fixture'); }; });
afterEach(() => { globalThis.fetch = originalFetch; });
const typed = (value: number | null): Fact<number> => ({ value, source: 'Typed' });
function inputs(): PlanInputs {
  return {
    startMonth: '2026-10', horizonMonths: 6, targetMonths: 3, currency: 'usd',
    raiseCents: typed(12000), cashCents: { value: 6000, source: 'Connector', ref: 'synthetic-mercury', asOf: '2026-10-01' }, raiseMonth: '2026-11',
    lines: SECTION_KEYS.map((key, i) => ({ key, sharePct: typed(i === 0 ? 100 : 0) })), hires: [], milestones: [],
  };
}
test('v1 has reproducible assumptions and all derived blocks carry the complete input snapshot', () => {
  const input = inputs(); const before = structuredClone(input); const p = plan(input);
  assert.equal(MODEL_V1.version, 1);
  assert.equal(Object.isFrozen(MODEL_V1), true);
  assert.deepEqual(input, before);
  assert.deepEqual(p, plan(input));
  for (const block of [p.spend, p.burn, p.cashPath, p.cashOut, p.runway, p.milestones, ...p.sections.flatMap(s => [s.allocation, s.payroll, s.spend, s.overBudget])]) {
    assert.equal(block.source, 'Modelled'); assert.equal(block.modelVersion, 1);
    assert.deepEqual(block.inputs, before); assert.notEqual(block.inputs, input);
    assert.equal(block.reason, null);
  }
  input.cashCents.value = 1;
  assert.equal(p.cashPath.inputs.cashCents.value, 6000);
});
test('missing inputs stay Not recorded, while known independent section allocations survive', () => {
  for (const field of ['raiseCents', 'cashCents'] as const) {
    const input = inputs(); input[field].value = null; const p = plan(input);
    assert.equal(p.cashPath.state, 'not_recorded'); assert.equal(p.cashPath.value, null); assert.match(p.cashPath.reason!, /Not recorded/);
    assert.equal(p.runway.value, null);
    assert.equal(p.spend.value, field === 'raiseCents' ? null : 12000);
  }
  for (const patch of [{ lines: null }, { hires: null }, { startMonth: null }, { targetMonths: null }, { horizonMonths: null }]) {
    const p = plan({ ...inputs(), ...patch });
    assert.equal(p.burn.value, null); assert.equal(p.spend.value, null); assert.equal(p.cashOut.value, null);
  }
  const input = inputs(); input.hires = [{ id: 'missing-cost', key: 'product', startMonth: '2026-10', annualCents: typed(null), currency: 'usd' }];
  const p = plan(input);
  assert.equal(p.sections[0].allocation.value, 12000); assert.equal(p.sections[0].spend.value, null);
  assert.deepEqual(p.sections[1].spend.value, [0, 0, 0, 0, 0, 0]); assert.equal(p.burn.value, null);
});
test('recorded zero remains zero, including zero payroll, spend and opening cash', () => {
  const input = inputs(); input.raiseCents.value = 0; input.cashCents.value = 0; input.raiseMonth = null;
  input.hires = [{ id: 'zero-cost', key: 'product', startMonth: '2026-10', annualCents: typed(0), currency: 'usd' }];
  const p = plan(input);
  assert.equal(p.spend.value, 0); assert.equal(p.spend.state, 'recorded');
  assert.deepEqual(p.sections[0].payroll.value, [0, 0, 0, 0, 0, 0]);
  assert.equal(p.cashPath.value![0].closingCents, 0); assert.deepEqual(p.runway.value, { months: 0, relation: 'exact' });
});
test('hires start in their recorded month, recur after target, and remaining spend is spread once', () => {
  const input = inputs(); input.hires = [{ id: 'hire', key: 'product', startMonth: '2026-11', annualCents: typed(12000), currency: 'usd' }];
  const p = plan(input);
  assert.deepEqual(p.sections[0].payroll.value, [0, 1000, 1000, 1000, 1000, 1000]);
  assert.deepEqual(p.sections[0].spend.value, [3334, 4333, 4333, 1000, 1000, 1000]);
  assert.equal(p.spend.value, 15000); assert.equal(p.sections[0].overBudget.value, false);
  input.raiseCents.value = 1000;
  const over = plan(input);
  assert.equal(over.sections[0].overBudget.value, true); assert.deepEqual(over.sections[0].spend.value, [0, 1000, 1000, 1000, 1000, 1000]);
});
test('rounding conserves integer cents and a pre-plan hire retains its cumulative payroll phase', () => {
  const input = inputs(); input.raiseCents.value = 7; input.targetMonths = 1;
  input.lines = SECTION_KEYS.map(key => ({ key, sharePct: typed(20) }));
  let p = plan(input);
  assert.deepEqual(p.sections.map(s => s.allocation.value), [2, 2, 1, 1, 1]); assert.equal(p.spend.value, 7);
  input.raiseCents.value = 0; input.hires = [{ id: 'penny-hire', key: 'product', startMonth: '2026-09', annualCents: typed(7), currency: 'usd' }];
  p = plan(input);
  assert.deepEqual(p.sections[0].payroll.value, [0, 1, 0, 1, 1, 0]);
  assert.equal(p.sections[0].payroll.value!.every(Number.isSafeInteger), true);
});
test('cash receives the raise in its own month and never clamps a deficit or hides earlier cash out', () => {
  const input = inputs(); input.cashCents.value = 3000;
  let p = plan(input);
  assert.deepEqual(p.cashPath.value!.slice(0, 3).map(x => [x.openingCents, x.raisedCents, x.closingCents]), [[3000, 0, -1000], [-1000, 12000, 7000], [7000, 0, 3000]]);
  assert.deepEqual(p.cashOut.value, { months: 0.75, withinHorizon: true });
  input.raiseMonth = null; assert.equal(plan(input).cashPath.value, null);
  input.raiseMonth = '2026-10'; input.cashCents.value = 0; p = plan(input);
  assert.deepEqual(p.cashOut.value, { months: 3, withinHorizon: true }); assert.equal(p.cashPath.value![0].raisedCents, 12000);
  input.cashCents.value = 9000; p = plan(input);
  assert.deepEqual(p.cashOut.value, { months: null, withinHorizon: false }); assert.deepEqual(p.runway.value, { months: 6, relation: 'at_least' });
  input.cashCents.value = -1; input.raiseMonth = '2026-11'; assert.equal(plan(input).cashOut.value!.months, 0);
});
test('invalid/duplicate shares, invalid dates, missing hires, currency mismatch and unsafe arithmetic do not invent burn', () => {
  const invalid: PlanInputs[] = [];
  let i = inputs(); i.lines![0].sharePct.value = 99; invalid.push(i);
  i = inputs(); i.lines![4] = structuredClone(i.lines![0]); invalid.push(i);
  i = inputs(); i.startMonth = '2026-13'; invalid.push(i);
  i = inputs(); i.hires = [{ id: 'hire', key: 'product', startMonth: null, annualCents: typed(12000), currency: 'usd' }]; invalid.push(i);
  i = inputs(); i.hires = [{ id: 'hire', key: 'product', startMonth: '2026-10', annualCents: typed(12000), currency: 'eur' }]; invalid.push(i);
  i = inputs(); i.hires = [{ id: 'hire', key: 'product', startMonth: '2026-10', annualCents: typed(Number.MAX_SAFE_INTEGER), currency: 'usd' }]; i.horizonMonths = 120; i.targetMonths = 120; invalid.push(i);
  for (const input of invalid) { const p = plan(input); assert.equal(p.burn.value, null); assert.equal(p.runway.value, null); }
});
test('milestones consume their section once in due order, distinguish unknown from zero and never assert actual completion', () => {
  const input = inputs(); input.milestones = [
    { id: 'late', key: 'product', costCents: typed(5000), dueMonth: '2026-12' },
    { id: 'early', key: 'product', costCents: typed(8000), dueMonth: '2026-10' },
    { id: 'unpriced', key: 'product', costCents: typed(null), dueMonth: '2026-11' },
    { id: 'free', key: 'reserve', costCents: typed(0), dueMonth: '2026-11' },
    { id: 'undated', key: 'product', costCents: typed(1), dueMonth: null },
    { id: 'unmapped', key: null, costCents: typed(0), dueMonth: '2026-11' },
  ];
  const p = plan(input); const byId = new Map(p.milestones.value!.map(m => [m.id, m]));
  assert.equal(byId.get('early')!.state, 'Funded'); assert.equal(byId.get('late')!.state, 'At risk');
  assert.equal(byId.get('unpriced')!.state, 'Not costed'); assert.equal(byId.get('unpriced')!.funded.value, null);
  assert.equal(byId.get('free')!.funded.value, true); assert.equal(byId.get('free')!.reached.value, true);
  assert.equal(byId.get('undated')!.reached.value, null); assert.equal(byId.get('unmapped')!.state, 'Not recorded');
  input.cashCents.value = 0;
  assert.equal(plan(input).milestones.value!.find(m => m.id === 'early')!.reached.value, false);
  input.milestones = null; assert.equal(plan(input).milestones.value, null);
});
