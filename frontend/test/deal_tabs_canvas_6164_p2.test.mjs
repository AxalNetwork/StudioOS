// D6164 part 2 (#6164) — the deal page's Team, Market and Traction tabs to the
// Deals v2 Evidence addendum (DE23 to DE25, phone DE30b to DE30d).
//
//   · each tab's scorecard rows head it (the canvas's scope head);
//   · Team lists who published, says what each did not, and links to Diligence;
//   · Market counts its blocks, searches and sorts the competitors in the
//     browser, and draws company markets with their four readings;
//   · Traction lists the months newest first: a month not reported says so and
//     draws no figure, a recorded 0 stays 0.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_tabs_canvas_6164_p2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DealMarket, DealTeam, DealTraction } from '../src/pages/deal/DealInsightTabs.jsx';
import {
  NOT_IN_UPDATE, NOT_RECORDED, NOT_REPORTED, NO_UPDATE, TEAM_WORDS, competitorsView, monthRows, monthsLine, peopleLine, tractionView,
} from '../src/pages/deal/dealInsightsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const TEAM = {
  masked: false,
  people: { state: 'recorded', data: [
    { uid: 'u1', name: 'Ana Ruiz', role: 'founder', prior_roles: [{ title: 'Head of operations', company: 'Robo Co', start: '2019', end: '2024' }], archetype: { slug: 'builder', label: 'Builder' }, full_time_since: '2024-03-01', founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' },
    { uid: 'u3', name: 'Cy', role: 'member', prior_roles: [], archetype: null, full_time_since: null, full_time_reason: 'Not in the team read', founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' },
  ] },
  coverage: { state: 'recorded', data: [{ slug: 'product', label: 'Product', coverage_band: 'covered', reason: null }] },
  advisors: { state: 'recorded', data: { count: 2, roles: [{ role: 'Advisor', count: 2 }], source: 'Accepted project memberships' } },
  founder_market_fit: { state: 'recorded', data: { groups: [], partial: false } },
  values_band: { value: null, state: 'not_recorded', reason: 'No consent to share a team values band' },
};

const COMPETITORS = [
  { name: 'Pickwell', why_it_matters: 'Rents robots by the month', price_position: 'Lower', depth_position: 'Shallower' },
  { name: 'autostow', why_it_matters: 'Same buyer, sells full automation', price_position: 'Higher', depth_position: 'Deeper' },
  { name: 'Gridline Robotics', why_it_matters: 'Picking arms for retail; moving into 3PL', price_position: null, depth_position: 'About the same' },
];
const MARKET = {
  masked: false,
  sizing: { state: 'recorded', data: { tam: { value: 4200000000, source: null }, sam: { value: null, reason: 'Not recorded' }, som: { value: null, reason: 'Not recorded' } } },
  sources: { state: 'recorded', data: [{ title: 'Outlook 2026', url: 'https://example.org/a', kind: 'Report' }, { title: 'Survey', url: 'https://example.net/b', kind: 'Dataset' }] },
  who_pays: { state: 'recorded', data: [{ name: 'Mid-size 3PL warehouses', description: '20–80 pickers', source: 'Interviews' }, { name: 'Fulfilment centres', description: 'Seasonal peaks', source: null }] },
  company_markets: { state: 'recorded', data: [
    { name: 'Portugal', decision: 'served', decided_on: '2026-03-03', demand_score: 7, demand_source: 'Interviews', regulation_score: 0, regulation_source: 'typed', partners_score: null, cost_score: 8, cost_source: 'typed' },
  ] },
  competitors: { state: 'recorded', data: COMPETITORS },
  geography: { state: 'not_recorded', reason: 'Company markets are recorded; where customers are and the geographic risk are not' },
};

/** Six months to Oct 2026: Aug not reported; Sep reported without customers; Jul growth a recorded 0. */
const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const fig = (key, value, unit, source = 'stripe') => ({ key, value, unit, source, as_of: null });
const TRACTION = {
  masked: false,
  history: { state: 'recorded', data: MONTHS.map((month) => {
    if (month === '2026-08') return { month, state: 'not_reported', figures: [] };
    const figures = [fig('mrr', { '2026-05': 29000, '2026-06': 31000, '2026-07': 31000, '2026-09': 38000, '2026-10': 42000 }[month], 'usd')];
    if (month !== '2026-09') figures.push(fig('customers', 3, 'count'));
    figures.push(fig('growth', month === '2026-07' ? 0 : 6.9, 'pct', 'typed'));
    return { month, state: 'reported', figures };
  }) },
  arr: { value: null, state: 'not_recorded', reason: 'No founder-shared ARR recorded; MRR is not annualised' },
  nrr: { value: null, state: 'not_recorded', reason: 'No founder-shared NRR recorded' },
};

/* ------------------------------------------------------------------ the model */

test('DE23: the people line counts who published and says who is not listed', () => {
  assert.equal(peopleLine(3), '3 published · anyone with a private profile is not listed');
  assert.equal(peopleLine(-1), '0 published · anyone with a private profile is not listed', 'never a negative count');
  assert.equal(TEAM_WORDS.noArchetype, 'No archetype published');
  assert.equal(TEAM_WORDS.noRoles, 'No prior roles published');
});

test('DE24: competitors sort by name either way and search the name and why it matters, in the browser', () => {
  const names = (v) => v.shown.map((r) => r.name);
  assert.deepEqual(names(competitorsView(COMPETITORS)), ['autostow', 'Gridline Robotics', 'Pickwell'], 'A–Z ignores case');
  assert.deepEqual(names(competitorsView(COMPETITORS, { sort: 'name_desc' })), ['Pickwell', 'Gridline Robotics', 'autostow']);
  const byWhy = competitorsView(COMPETITORS, { query: '  RETAIL ' });
  assert.deepEqual(names(byWhy), ['Gridline Robotics'], 'the search reads why it matters, any case, trimmed');
  assert.equal(byWhy.line, '1 of 3 match “RETAIL”');
  const none = competitorsView(COMPETITORS, { query: 'zzz' });
  assert.deepEqual([none.shown.length, none.none], [0, 'No competitor matches “zzz”.']);
  assert.equal(competitorsView(COMPETITORS).line, null, 'no search, no match line');
  assert.deepEqual(COMPETITORS.map((r) => r.name), ['Pickwell', 'autostow', 'Gridline Robotics'], 'the read is not reordered');
  assert.deepEqual(competitorsView(null).shown, []);
});

test('DE25: the months newest first; a month not reported is a gap, never 0; a recorded 0 stays 0', () => {
  const v = tractionView(TRACTION);
  assert.equal(monthsLine(v), '5 months reported, 1 not reported. A month not reported is a gap, never 0.');
  const rows = monthRows(v);
  assert.deepEqual(rows.map((r) => r.month), ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05'], 'newest first');
  assert.deepEqual(rows[2], { month: '2026-08', label: 'Aug 2026', reported: false }, 'a gap carries no figure at all');
  assert.equal(rows[3].growth, '0%', 'July’s recorded 0 is a value');
  assert.deepEqual([rows[1].mrr, rows[1].customers], ['$38,000', null], 'a figure missing from a reported month is not drawn as 0');
  assert.equal(rows[0].source, 'From stripe');
  assert.equal(monthsLine({ state: 'recorded', months: ['2026-10'], reportedMonths: ['2026-10'] }), '1 month reported, 0 not reported. A month not reported is a gap, never 0.');
  assert.deepEqual([monthRows({ state: 'unreadable' }), monthsLine({ state: 'unreadable' })], [[], null]);
});

/* ------------------------------------------------------------------ mounted */

async function mounted(Tab, section, body) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u) => (new RegExp(`/api/deals/4/${section}$`).test(String(u)) ? response(body) : response({}));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(Tab, { deal: { id: 4, project_id: 7 }, userId: 21 }))));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  return {
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    textOf: (id) => text(all(id)[0]),
    textsOf: (id) => all(id).map(text),
    hrefOf: (id) => props(all(id)[0]).href,
    async change(id, value) { await act(async () => props(all(id)[0]).onChange({ target: { value } })); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('Team (DE23): the Team row first, who published, what each did not publish, and the way to Diligence', async () => {
  const v = await mounted(DealTeam, 'team', TEAM);
  try {
    const ids = v.ids();
    assert.ok(ids.indexOf('deal-team-scorecard') > -1 && ids.indexOf('deal-team-scorecard') < ids.indexOf('deal-team-people-head'), 'the scope row heads the tab');
    assert.equal(v.textOf('deal-team-people-head'), `${TEAM_WORDS.people}2 published · anyone with a private profile is not listed`);
    assert.equal(v.textOf('deal-team-person-u3-archetype'), 'No archetype published');
    assert.ok(v.textOf('deal-team-person-u3').includes('No prior roles published'));
    assert.doesNotMatch(v.textOf('deal-team-person-u1'), /Full-time since|Founder–market fit/, 'unsupported per-person fields are absent');
    assert.ok(v.textOf('deal-team-coverage').startsWith(TEAM_WORDS.coverageTitle));
    assert.match(v.textOf('deal-team-advisors'), /2 accepted advisors.*Advisor.*2.*Accepted project memberships/);
    assert.equal(v.hrefOf('deal-team-next'), '/deals/4/diligence');
  } finally { await v.close(); }
});

test('Market (DE24, DE30c): counts, company markets with four readings, competitors searched and sorted', async () => {
  const v = await mounted(DealMarket, 'market', MARKET);
  try {
    const ids = v.ids();
    assert.ok(ids.indexOf('deal-market-scorecard') > -1 && ids.indexOf('deal-market-scorecard') < ids.indexOf('deal-market-tam'), 'the scope rows head the tab');
    assert.deepEqual([v.textOf('deal-market-sources-count'), v.textOf('deal-market-who-count'), v.textOf('deal-market-competitors-count')], ['2', '2 segments', '3']);
    assert.ok(v.textOf('deal-market-who').includes('Source · Interviews') && v.textOf('deal-market-who').includes(NOT_RECORDED), 'a segment with no source says so');
    const row = v.textOf('deal-market-where-row');
    assert.equal(row, `PortugalServed3 Mar 20267/10From Interviews0/10Typed · the founder’s own figure${NOT_RECORDED}8/10Typed · the founder’s own figure`, 'a recorded 0 is 0/10, a missing part is Not recorded');
    assert.equal(v.textsOf('deal-market-readiness').length, 1, 'the phone card keeps one readiness line a market');
    assert.ok(v.textOf('deal-market-geography').includes('where customers are and the geographic risk are not'));
    assert.deepEqual(v.textsOf('deal-market-competitor-row').map((t) => t.slice(0, 8)), ['autostow', 'Gridline', 'Pickwell']);
    await v.change('deal-market-competitors-sort', 'name_desc');
    assert.deepEqual(v.textsOf('deal-market-competitor-row').map((t) => t.slice(0, 8)), ['Pickwell', 'Gridline', 'autostow']);
    await v.change('deal-market-competitors-search', 'rents');
    assert.deepEqual(v.textsOf('deal-market-competitor-row').map((t) => t.slice(0, 8)), ['Pickwell']);
    assert.equal(v.textOf('deal-market-competitors-matches'), '1 of 3 match “rents”');
    await v.change('deal-market-competitors-search', 'nobody');
    assert.equal(v.textOf('deal-market-competitors-none'), 'No competitor matches “nobody”.');
    assert.equal(v.textsOf('deal-market-competitor-row').length, 0);
  } finally { await v.close(); }
});

test('Traction (DE25, DE30d): the rows first, then the months newest first with the gap said and no figure', async () => {
  const v = await mounted(DealTraction, 'traction', TRACTION);
  try {
    const ids = v.ids();
    assert.ok(ids.indexOf('deal-traction-scorecard') > -1 && ids.indexOf('deal-traction-scorecard') < ids.indexOf('deal-traction-months'), 'the scope rows head the tab');
    assert.equal(v.textOf('deal-traction-months-line'), '5 months reported, 1 not reported. A month not reported is a gap, never 0.');
    const rows = ids.filter((id) => /^deal-traction-month-\d{4}-\d{2}$/.test(id));
    assert.deepEqual(rows, MONTHS.map((m) => `deal-traction-month-${m}`).reverse(), 'newest first');
    assert.equal(v.textOf('deal-traction-month-2026-08'), `Aug 2026${NOT_REPORTED}${NO_UPDATE}`, 'a gap draws no figure');
    assert.equal(v.textOf('deal-traction-month-2026-07'), 'Jul 2026$31,00030%From stripe', 'a recorded 0 stays 0');
    assert.equal(v.textOf('deal-traction-month-2026-09'), `Sep 2026$38,000${NOT_IN_UPDATE}6.9%From stripe`, 'a figure missing from an update says so');
    assert.ok(v.textOf('deal-traction-month-cards').includes(NO_UPDATE), 'the phone list says the gap too');
  } finally { await v.close(); }
});
