/** D4485 (#4485): Distribution overview client uses the mounted project-scoped read. DS1 rendering and scoped write states. */
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


import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import OverviewTab, { OverviewView } from '../src/pages/cycles/distribution/OverviewTab.jsx';
import { mountContracts } from './_contracts_dom.mjs';
const h = React.createElement;
const fixture = () => ({
  kpis: Object.fromEntries(Object.keys(KPI_LABELS).map((key) => [key, { value: null, sources: [], reason: 'Not recorded: no source' }])),
  campaigns: { items: [], total: 0 }, week: { from: '2026-11-09', items: [] },
  channels: { items: [{ name: 'X', status: 'Not offered yet' }] },
  update_asks: { items: [], can_add: true },
});
const render = (data, props = {}) => renderToStaticMarkup(h(MemoryRouter, null, h(OverviewView, { data, today: '2026-11-11', search: '?project_id=7', ...props })));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('DS1 renders missing KPIs without zero, real source chips, seven days and independent failed blocks', () => {
  const data = fixture();
  let out = render(data);
  assert.match(out.split('data-testid="overview-kpi-reach"')[1].split('</section>')[0], /class="ds-not-recorded">Not recorded/);
  assert.doesNotMatch(out, /ds-overview-value[^>]*>0/);
  assert.match(out, /Nothing scheduled/);
  assert.match(out, /ds-overview-day is-today[^]*?Wed · today/);
  assert.match(out, /No campaigns yet\. A campaign groups/);
  assert.match(out, /campaigns\/new\?project_id=7/);
  data.kpis.cost_per_lead = { value: 1200, sources: ['mercury', 'connector'] };
  data.kpis.replies = { value: null, sources: [], reason: 'Unreadable: replies' };
  data.week.items = [{ uid: 'post', planned_on: '2026-11-09', title: 'Real post', channel: 'Email' }];
  out = render(data);
  assert.match(text(out), /Cost per lead \$12\.00 This month’s spend ÷ leads Mercury Connector/);
  assert.match(text(out), /Unreadable Couldn’t be read\. This is not a claim that there are none\. Try again/);
  assert.match(text(out), /POST Real post Email/);
  assert.match(out, /Not offered yet/);
});

test('campaign cards, replies and loading distinguish real zero budget, draft-only and unknown reads', () => {
  const data = fixture();
  data.campaigns = { total: 1, items: [{ uid: 'campaign', name: 'Recorded campaign', goal: 'demos', budget_cents: 0, leads: 2, demos: 1, channels: [{ uid: 'email', name: 'Email', spend_months: [{ source: 'mercury' }] }] }] };
  data.update_asks.items = [{ uid: 'reply', name: 'Synthetic reply', ask_text: 'A recorded ask', email: 'reply@example.invalid' }];
  let out = render(data, { onAdd() {} });
  assert.match(text(out), /Recorded campaign Active Goal · Demos Email Budget — No paid budget · outreach only 2 leads · 1 demos/);
  assert.match(text(out), /2 leads · 1 demos Connector Manual Mercury/);
  assert.match(text(out), /Synthetic reply A recorded ask Add to Prospects Lead/);
  data.update_asks.can_add = false;
  assert.doesNotMatch(render(data, { onAdd() {} }), /Add to Prospects/);
  data.campaigns.items = [];
  assert.match(render(data), /No active campaigns/);
  data.week.items = null; data.channels.items = null; data.update_asks.items = null;
  out = render(data);
  assert.equal((out.match(/This is not a claim/g) || []).length, 3);
  assert.doesNotMatch(text(out), /Nothing scheduled|No replies from/);
  const loading = render(data, { loading: true });
  assert.match(loading, /Loading Distribution overview/);
  assert.doesNotMatch(loading, /No active campaigns/);
});

test('Overview read failure retries, preserves legacy tools, and a real Add to Prospects writes the existing contact contract', async () => {
  const data = fixture();
  data.update_asks.items = [{ uid: 'reply', name: 'Synthetic reply', email: 'reply@example.invalid', ask_text: 'A recorded ask' }];
  const calls = []; let reads = 0; let failWrite = true;
  const app = await mountContracts(h(OverviewTab, { projectId: 7, read: async (id) => { assert.equal(id, 7); if (++reads === 1) throw Error('private read failure'); return data; }, create: async (body) => { calls.push(body); if (failWrite) throw Error('private write failure'); } }, h('p', null, 'Legacy channel tools')));
  try {
    assert.match(app.text(), /Unreadable/);
    const nodeText = (node) => node?.childNodes?.length ? node.childNodes.map(nodeText).join('') : node?.textContent || '';
    assert.ok(Object.keys(KPI_LABELS).every((key) => nodeText(app.nodes().find((node) => app.props(node)?.['data-testid'] === `overview-kpi-${key}`)).includes('Unreadable')), 'every KPI is unreadable when the request fails');
    assert.match(app.text(), /Legacy channel tools/);
    assert.doesNotMatch(app.text(), /private read failure/);
    await app.click('Try again');
    assert.match(app.text(), /Synthetic reply/);
    await app.click('Add to Prospects');
    assert.match(app.text(), /Couldn’t add this prospect\. Try again/);
    failWrite = false;
    await app.click('Add to Prospects');
    assert.deepEqual(calls, Array(2).fill({ project_id: 7, name: 'Synthetic reply', email: 'reply@example.invalid', audience: 'customer', source: 'update ask' }));
    assert.match(app.text(), /Added to Prospects/);
  } finally { await app.unmount(); }
});
