/** D4485 (#4485): Distribution overview client uses the mounted project-scoped read. UI cases await DS1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetView, KPI_LABELS, metricView, resultsLine, sourceChips, todayKey, weekColumns } from '../src/pages/cycles/distribution/overviewModel.js';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';

test('Distribution overview forwards project and optional ISO week without introducing a write', async () => {
  const calls = [];
  const result = { kpis: { reach: { value: null } } };
  const api = makeCycleWrites(async (...args) => { calls.push(args); return result; }).grow;
  assert.deepEqual(await api.distributionOverview(7), result);
  await api.distributionOverview(7, { week: '2026-W46', project: 99 });
  const urls = calls.map(([url]) => new URL(url, 'https://example.invalid'));
  assert.equal(urls[0].pathname, '/cycles/grow/distribution/overview');
  assert.deepEqual(Object.fromEntries(urls[0].searchParams), { project: '7' });
  assert.deepEqual(Object.fromEntries(urls[1].searchParams), { project: '7', week: '2026-W46' });
  assert.ok(calls.every((call) => call.length === 1), 'reads add no write method or body');
});


test('null figures never render zero; readable blocks remain recorded beside an unreadable one', () => {
  for (const key of Object.keys(KPI_LABELS)) {
    const missing = metricView(key, { value: null, sources: ['manual'], reason: 'Not recorded: no entry' });
    assert.equal(missing.label, 'Not recorded');
    assert.equal(missing.state, 'not_recorded');
    assert.deepEqual(missing.chips, []);
  }
  assert.equal(metricView('leads', { value: 0, sources: ['connector'] }).label, '0', 'a recorded zero is preserved');
  assert.equal(metricView('replies', { value: null, reason: 'Unreadable: replies', sources: [] }).label, 'Unreadable');
  assert.equal(metricView('leads', { value: 2, sources: ['connector'] }).label, '2');
  assert.equal(metricView('leads', { value: 42, sources: [] }).label, 'Not recorded', 'a figure without a source is withheld');
});

test('monetary cents and source chips keep the monthly cost and campaign spend distinct', () => {
  const cost = metricView('cost_per_lead', { value: 1200, sources: ['mercury', 'connector'] });
  assert.equal(cost.label, '$12.00');
  assert.deepEqual(cost.chips.map((c) => c.label), ['Mercury', 'Connector']);
  assert.deepEqual(sourceChips(['manual', 'manual', 'unknown']).map((c) => c.label), ['Manual']);
  assert.equal(metricView('spend_vs_budget', { value: 184000, sources: ['manual'] }).label, '$1,840');
});

test('campaign goals and budgets do not convert missing records into zero or a free budget', () => {
  assert.equal(resultsLine({ goal: 'demos', leads: 18, demos: 5 }), '18 leads · 5 demos');
  assert.equal(resultsLine({ goal: 'signups', leads: 24 }), '24 sign-ups');
  assert.equal(resultsLine({ goal: 'sales', customers: 3 }), '3 customers');
  assert.equal(resultsLine({ goal: 'demos', leads: null, demos: null }), 'Not recorded');
  assert.equal(resultsLine({ goal: 'awareness', leads: 42 }), 'Not recorded');
  assert.equal(budgetView({ budget_cents: null }).label, 'Budget — Not recorded');
  assert.equal(budgetView({ budget_cents: 0 }).label, 'Budget — No paid budget · outreach only');
  assert.equal(budgetView({ budget_cents: 10000, budget_used_pct: null }).percent, null);
  assert.deepEqual(budgetView({ budget_cents: 10000, budget_used_pct: 125 }), { label: 'Budget used', percent: '125%', progress: 100 });
});

test('week columns use the real date, empty-day copy and readable versus unreadable plans', () => {
  const week = { from: '2026-11-09', items: [{ uid: 'post', planned_on: '2026-11-09' }] };
  const data = weekColumns(week, '2026-11-11');
  assert.equal(data.state, 'ready');
  assert.deepEqual(data.days.map((d) => d.name), ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
  assert.equal(data.days[0].items[0].uid, 'post');
  assert.equal(data.days[1].empty, 'Nothing scheduled');
  assert.equal(data.days[2].heading, 'Wed · today');
  assert.equal(data.days[2].today, true);
  assert.equal(data.days[1].today, false);
  assert.equal(weekColumns({ ...week, items: null }).state, 'unreadable');
  assert.equal(weekColumns({ ...week, from: '2026-02-30' }).state, 'unreadable');

});


test('today follows the live local clock across days, rather than the design sample', (t) => {
  const first = new Date(2026, 10, 11, 12).valueOf();
  const second = new Date(2026, 10, 12, 12).valueOf();
  t.mock.timers.enable({ apis: ['Date'], now: first });
  t.after(() => t.mock.timers.reset());
  const week = { from: '2026-11-09', items: [] };
  assert.equal(todayKey(), '2026-11-11');
  assert.equal(weekColumns(week).days[2].today, true);
  t.mock.timers.setTime(second);
  assert.equal(todayKey(), '2026-11-12');
  assert.equal(weekColumns(week).days[2].today, false);
  assert.equal(weekColumns(week).days[3].today, true);
});
