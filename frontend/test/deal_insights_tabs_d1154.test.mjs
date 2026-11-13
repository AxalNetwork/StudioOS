// D1154 (#3059, part 6 of #2421) — the reading tabs Team (DL4), Market (DL5)
// and Traction (DL6) on D1151's reads, with the sibling canvases' slots (DL24).
//
//   · no total score is drawn: coverage is a band per axis, never a number,
//     and the scorecard rows are SCORING's slots;
//   · a month not reported is a gap, never 0, and a recorded 0 stays 0;
//   · a slot that fails to read says so in its own frame, and one failed
//     block leaves the rest of the tab standing;
//   · before the NDA only the company's basics show, with the way to the NDA.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_insights_tabs_d1154.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { WAITS } from '../src/pages/dealPageModel.js';
import {
  NOT_RECORDED, NOT_REPORTED, SLOTS, chartSummary, coverageView, figureText, insightState, personView, safeUrl, sizingView, slotOf, sourceText, tractionView,
} from '../src/pages/deal/dealInsightsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ready = (data) => ({ status: 'ready', data });

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000 };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };

const MASKED_READ = { masked: true, reason: 'no_pairwise_nda', project: { name: 'Harbor Ledger', sector: 'Fintech', stage: 'Seed', headline: 'Ledgers for ports' } };

const TEAM = {
  masked: false,
  people: { state: 'recorded', data: [
    { uid: 'u1', name: 'Ana Ruiz', role: 'founder', prior_roles: [{ title: 'Head of operations', company: 'Robo Co', start: '2019', end: '2024' }], archetype: { slug: 'builder', label: 'Builder' }, full_time_since: null, full_time_reason: 'Not recorded', founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' },
    { uid: 'u2', name: 'Ben Kim', role: 'cofounder', prior_roles: null, prior_roles_state: 'unreadable', archetype: null, full_time_since: null, full_time_reason: 'Not recorded', founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' },
    { uid: 'u3', name: 'Cy', role: 'member', prior_roles: [], archetype: null, full_time_since: null, full_time_reason: 'Not recorded', founder_market_fit: null, founder_market_fit_reason: 'No published evidence recorded' },
  ] },
  coverage: { state: 'recorded', data: [
    { slug: 'product', label: 'Product', coverage_band: 'covered', reason: null },
    { slug: 'sales', label: 'Sales', coverage_band: 'partial', reason: null },
    { slug: 'finance', label: 'Finance', coverage_band: 'gap', reason: null },
    { slug: 'legal', label: 'Legal and IP', coverage_band: null, reason: 'Not recorded for at least two published team members' },
  ] },
  values_band: { value: null, state: 'not_recorded', reason: 'No recorded consent to share a team values band' },
};

const MARKET = {
  masked: false,
  sizing: { state: 'recorded', data: {
    tam: { value: 4200000000, source: null, reason: 'No source recorded for this figure' },
    sam: { value: 0, source: null, reason: 'No source recorded for this figure' },
    som: { value: null, source: null, reason: 'Not recorded' },
  } },
  sources: { state: 'recorded', data: [{ title: 'Port study 2026', url: 'https://example.com/study', kind: 'report' }, { title: 'Bad link', url: 'javascript:alert(1)', kind: null }] },
  who_pays: { state: 'recorded', data: [{ name: 'Port operators', description: 'Mid-size terminals', source: 'interviews' }] },
  company_markets: { state: 'unreadable', reason: 'Unreadable. Try again.' },
  competitors: { state: 'recorded', data: [{ name: 'Old Ledger', why_it_matters: 'Incumbent', price_position: null, depth_position: 'deep' }] },
  geography: { state: 'not_recorded', reason: 'Company markets are recorded; customer geographic distribution and geographic risk are not recorded here' },
  evidence: { state: 'unreadable', reason: 'Unreadable. Try again.' },
};

/** Twelve months to Oct 2026: January not reported, MRR rising, a recorded zero burn in March. */
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const fig = (key, value, unit, as_of) => ({ key, label: key, value, unit, source: key === 'customers' ? 'typed' : 'stripe', as_of, reason: null });
const TRACTION = {
  masked: false,
  history: { state: 'recorded', data: MONTHS.map((month, i) => (month === '2026-01'
    ? { month, state: 'not_reported', figures: [], reason: 'Not reported' }
    : { month, state: 'reported', reason: null, figures: [
      fig('mrr', 10000 + i * 1000, 'usd', `${month}-28`),
      ...(month === '2026-03' ? [fig('burn', 0, 'usd', `${month}-28`)] : [fig('burn', 30000, 'usd', `${month}-28`)]),
      ...(i >= 6 ? [fig('customers', 10 + i, 'count', `${month}-28`)] : []),
    ] })) },
  arr: { value: null, state: 'not_recorded', reason: 'No founder-shared ARR recorded; MRR is not annualised' },
  nrr: { value: null, state: 'not_recorded', reason: 'No founder-shared NRR recorded' },
  evidence: { state: 'not_recorded', reason: 'Shared evidence is not available in this view yet' },
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a read is masked, unreadable or open; a masked read shows only the basics', () => {
  assert.deepEqual(insightState({ status: 'loading' }), { state: 'loading' });
  assert.deepEqual(insightState({ status: 'unreadable' }), { state: 'unreadable' });
  assert.deepEqual(insightState(ready(MASKED_READ)), { state: 'masked', project: MASKED_READ.project });
  assert.equal(insightState(ready(TEAM)).state, 'open');
  assert.equal(insightState(ready({})).state, 'unreadable', 'an answer that is neither is not drawn as open');
});

test('a person as published: unreadable roles said, unpublished ones said, nothing invented', () => {
  const [a, b, c] = TEAM.people.data.map(personView);
  assert.deepEqual([a.name, a.initials, a.role, a.archetype, a.roles], ['Ana Ruiz', 'AR', 'Founder', 'Builder', { state: 'recorded', rows: ['Head of operations at Robo Co, 2019–2024'] }]);
  assert.deepEqual([a.fullTime, a.fullTimeReason, a.fit, a.fitReason], [null, 'Not recorded', null, 'No published evidence recorded']);
  assert.deepEqual([b.role, b.roles.state, b.archetype], ['Co-founder', 'unreadable', null]);
  assert.deepEqual([c.role, c.roles.state], ['Team member', 'not_published']);
});

test('coverage is a band per axis, never a number; an axis without two members says why; gaps by name', () => {
  const v = coverageView(TEAM.coverage);
  assert.deepEqual(v.axes.map((a) => [a.label, a.word]), [['Product', 'Covered'], ['Sales', 'Partial'], ['Finance', 'Gap'], ['Legal and IP', NOT_RECORDED]]);
  assert.equal(v.axes[3].reason, 'Not recorded for at least two published team members');
  assert.deepEqual(v.gaps, ['Finance']);
  assert.equal(v.summary, 'Gaps: Finance.');
  assert.ok(!/\d/.test(JSON.stringify(v.axes.map((a) => a.word))), 'no axis is drawn as a number');
  assert.deepEqual(coverageView({ state: 'unreadable', reason: 'x' }), { state: 'unreadable' });
});

test('market sizing: a figure with its source or why none, a recorded zero stays zero, a missing one is Not recorded', () => {
  const v = sizingView(MARKET.sizing);
  assert.deepEqual(v.tiles.map((t) => [t.label, t.value, t.source, t.reason]), [
    ['TAM', '$4,200,000,000', null, 'No source recorded for this figure'],
    ['SAM', '$0', null, 'No source recorded for this figure'],
    ['SOM', null, null, 'Not recorded'],
  ]);
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://example.com/study'), 'https://example.com/study');
  assert.equal(sourceText('typed'), 'Typed · the founder’s own figure');
  assert.equal(sourceText('stripe'), 'From stripe');
  assert.equal(sourceText(''), null);
});

test('traction: a month not reported is a gap in every series, never 0; a recorded 0 stays 0; tiles take the latest reported', () => {
  const v = tractionView(TRACTION);
  assert.equal(v.months.length, 12);
  assert.equal(v.reported, 11);
  const jan = v.series.mrr.find((p) => p.month === '2026-01');
  assert.equal(jan.value, null, 'January is a gap');
  assert.equal(v.series.burn.find((p) => p.month === '2026-03').value, 0, 'a recorded zero burn stays zero');
  assert.equal(v.series.customers.filter((p) => p.value == null).length, 6, 'months without the figure are gaps, never 0');
  const tile = Object.fromEntries(v.tiles.map((t) => [t.key, t]));
  assert.deepEqual([tile.mrr.value, tile.mrr.source, tile.mrr.asOf], ['$21,000', 'From stripe', 'As of 28 Oct 2026']);
  assert.deepEqual([tile.customers.value, tile.customers.source], ['21', 'Typed · the founder’s own figure']);
  assert.deepEqual([tile.growth.value, tile.growth.reason], [null, 'Not shared in the last twelve months']);
  assert.deepEqual([tile.arr.value, tile.arr.reason], [null, 'No founder-shared ARR recorded; MRR is not annualised']);
  assert.deepEqual([tile.nrr.value, tile.nrr.reason], [null, 'No founder-shared NRR recorded']);
  assert.equal(figureText(null, 'usd'), null);
  assert.equal(figureText(0, 'usd'), '$0');
  assert.equal(chartSummary('MRR by month', v.series.mrr).text, 'MRR by month: $10,000 in Nov 2025, $21,000 in Oct 2026. Jan 2026 was not reported.');
  assert.equal(tractionView({ history: { state: 'unreadable' } }).state, 'unreadable');
  // A month the read calls not reported is a gap, whatever it carries.
  const odd = tractionView({ history: { state: 'recorded', data: [{ month: '2026-10', state: 'not_reported', figures: [fig('mrr', 5, 'usd', '2026-10-01')] }] } });
  assert.equal(odd.series.mrr[0].value, null);
});

test('the sibling slots: each says its source; a slot fed by a failed read says so; none is a score', () => {
  assert.equal(slotOf(SLOTS.evidence, { state: 'unreadable' }).state, 'unreadable');
  assert.match(slotOf(SLOTS.evidence, { state: 'unreadable' }).line, /could not be read/);
  assert.match(slotOf(SLOTS.evidence, TRACTION.evidence).line, /^Shared evidence is not available in this view yet\. /);
  for (const s of [SLOTS.teamRow, SLOTS.marketRows, SLOTS.tractionRows]) {
    assert.match(s.line, /This is not a score of zero\./);
    assert.ok(!/\d/.test(s.line.replace(/#\d+/g, '')), 'a slot draws no number');
  }
  assert.deepEqual(Object.keys(WAITS), ['scorecard', 'evidence'], 'Team, Market and Traction no longer wait');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handler(reads) {
  return (url) => {
    for (const [section, r] of Object.entries(reads)) {
      if (new RegExp(`/api/deals/4/${section}$`).test(url)) return typeof r === 'function' ? r() : r;
    }
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    if (/\/api\/deals\/4\/stage/.test(url)) return response({});
    return response({});
  };
}

async function mounted(url, reads) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  const answer = handler(reads);
  globalThis.fetch = async (u) => { requests.push(String(u)); return answer(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(INVESTOR));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) }))))));
  await settle();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, settle,
    ids: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    textOf: (id) => text(byId(id)),
    hrefOf: (id) => props(byId(id)).href,
    gaps: (id) => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(byId(id)).map((n) => props(n)['data-gap']).filter(Boolean); },
    async click(label, within) {
      const scope = within ? byId(within) : container;
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const b = walk(scope).find((n) => n.tagName === 'BUTTON' && text(n).includes(label));
      await act(async () => props(b).onClick?.({ preventDefault() {} }));
      await settle();
    },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('Team: each person as published, coverage as bands with the gap named, values Not recorded, the Team row a slot', async () => {
  const v = await mounted('/deals/4/team', { team: response(TEAM) });
  try {
    assert.ok(v.requests.some((u) => /\/api\/deals\/4\/team$/.test(u)));
    assert.ok(v.textOf('deal-team-person-u1').includes('Head of operations at Robo Co, 2019–2024'));
    assert.ok(v.textOf('deal-team-person-u1').includes('Builder'));
    assert.match(v.textOf('deal-team-person-u2'), /could not be read\. That is not the same as none\./);
    assert.ok(v.textOf('deal-team-person-u3').includes('Not published'));
    const coverage = v.textOf('deal-team-coverage');
    assert.ok(coverage.includes('Gaps: Finance.'));
    assert.ok(coverage.includes('Not recorded for at least two published team members'));
    assert.ok(!/\d/.test(coverage), 'coverage draws no number');
    assert.ok(v.textOf('deal-team-values').includes('No recorded consent to share a team values band'));
    assert.ok(v.textOf('deal-slot-team-row').includes('This is not a score of zero.'));
    assert.ok(!v.ids().some((id) => id.startsWith('deal-wait-')));
  } finally { await v.close(); }
});

test('a failed coverage block, and unreadable publication choices, are said; the people still stand', async () => {
  const people = { ...TEAM.people, publication_state: 'unreadable', publication_reason: 'Some profile publication preferences are unreadable. Try again.' };
  const v = await mounted('/deals/4/team', { team: response({ ...TEAM, people, coverage: { state: 'unreadable', reason: 'Team publication is unreadable. Try again.' } }) });
  try {
    assert.match(v.textOf('deal-team-coverage'), /could not be read/);
    assert.match(v.textOf('deal-team-publication'), /are not shown\. That is not the same as none\./);
    assert.ok(v.ids().includes('deal-team-person-u1'));
  } finally { await v.close(); }
});

test('before the NDA: the basics and the way to the NDA, and no section is drawn', async () => {
  const v = await mounted('/deals/4/market', { market: response(MASKED_READ) });
  try {
    const t = v.textOf('deal-market-masked');
    for (const s of ['This opens once you sign the NDA', 'Harbor Ledger', 'Fintech', 'Seed', 'Ledgers for ports']) assert.ok(t.includes(s), s);
    assert.equal(v.hrefOf('deal-market-nda'), '/deals/4/documents');
    assert.ok(!v.ids().includes('deal-market'));
  } finally { await v.close(); }
});

test('Market: figures with their sources or why none, a recorded zero as $0, one failed block and a failed slot said in place', async () => {
  const v = await mounted('/deals/4/market', { market: response(MARKET) });
  try {
    assert.ok(v.textOf('deal-market-tam').includes('$4,200,000,000'));
    assert.ok(v.textOf('deal-market-tam').includes('No source recorded for this figure'));
    assert.ok(v.textOf('deal-market-sam').includes('$0'), 'a recorded zero stays zero');
    assert.ok(v.textOf('deal-market-som').includes(NOT_RECORDED));
    assert.ok(v.ids().includes('deal-market-where-unreadable'), 'the failed block says so');
    assert.ok(v.textOf('deal-market-who').includes('Port operators'), 'the rest of the tab stands');
    assert.ok(v.textOf('deal-market-competitors').includes('Old Ledger'));
    assert.match(v.textOf('deal-slot-market-evidence'), /could not be read/, 'a slot that fails to read says so in its frame');
    assert.ok(v.textOf('deal-market-geography').includes('customer geographic distribution'));
    assert.ok(v.textOf('deal-market-sources').includes('Bad link'));
  } finally { await v.close(); }
});

test('Traction: the gap month drawn as a gap and tabled as Not reported, never $0; a recorded zero burn stays $0', async () => {
  const v = await mounted('/deals/4/traction', { traction: response(TRACTION) });
  try {
    assert.ok(v.textOf('deal-traction-reported').includes('11 of the last twelve months'));
    assert.ok(v.textOf('deal-traction-tile-mrr').includes('$21,000'));
    assert.ok(v.textOf('deal-traction-tile-arr').includes('MRR is not annualised'));
    assert.deepEqual(v.gaps('deal-traction-chart-mrr'), ['2026-01'], 'January is bridged as a gap on the MRR line');
    assert.deepEqual(v.gaps('deal-traction-chart-burn'), ['2026-01'], 'and left empty among the bars');
    const jan = v.textOf('deal-traction-row-mrr-2026-01');
    assert.ok(jan.includes(NOT_REPORTED) && !jan.includes('$0'));
    assert.ok(v.textOf('deal-traction-row-burn-2026-03').includes('$0'), 'a recorded zero is a zero');
    assert.ok(v.textOf('deal-traction-row-customers-2025-11').includes(NOT_REPORTED));
    assert.ok(v.textOf('deal-slot-traction-evidence').includes('Shared evidence is not available in this view yet'));
    assert.ok(v.textOf('deal-slot-traction-rows').includes('This is not a score of zero.'));
  } finally { await v.close(); }
});

test('a failed read says Unreadable with Try again, and Try again reads again', async () => {
  let n = 0;
  const v = await mounted('/deals/4/traction', { traction: () => (n++ ? response(TRACTION) : response({ error: 'unreadable' }, 503)) });
  try {
    assert.ok(v.ids().includes('deal-traction-unreadable'));
    await v.click('Retry', 'deal-traction-unreadable');
    assert.ok(v.ids().includes('deal-traction'), 'the second read draws the tab');
    assert.equal(v.requests.filter((u) => /\/traction$/.test(u)).length, 2);
  } finally { await v.close(); }
});

test('the history failing leaves the evidence slot and the scorecard rows standing', async () => {
  const v = await mounted('/deals/4/traction', { traction: response({ ...TRACTION, history: { state: 'unreadable', reason: 'Unreadable. Try again.' } }) });
  try {
    assert.ok(v.ids().includes('deal-traction-history-unreadable'));
    assert.ok(v.ids().includes('deal-slot-traction-evidence') && v.ids().includes('deal-slot-traction-rows'));
    assert.ok(!v.ids().some((id) => id.startsWith('deal-traction-tile-')));
  } finally { await v.close(); }
});

test('the wiring: the three tabs drawn from their own file, the reads through dealInsightsApi, no hex colours', () => {
  const page = readFileSync(new URL('../src/pages/DealRoomPage.jsx', import.meta.url), 'utf8');
  for (const t of ['Team', 'Market', 'Traction']) assert.match(page, new RegExp(`\\{tab === '${t.toLowerCase()}' && <Deal${t} deal=\\{deal\\} />\\}`));
  const tabs = readFileSync(new URL('../src/pages/deal/DealInsightTabs.jsx', import.meta.url), 'utf8');
  assert.ok(!/['"`]#[0-9a-f]{3,8}['"`]|\[#[0-9a-f]{3,8}\]/i.test(tabs), 'colours come from the tokens');
  assert.match(tabs, /dealInsightsApi\.team/);
});
