// D1015 (#2432) — the Cap table tool inside the Raise module page: its tab
// words, the blocks four existing reads carry, On record against Modelled, and
// the wiring. Fixtures are worked out by hand from the Worker's shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import {
  BASIS_CHECK, CANNOT_CONVERT, HOME_NOTE, TABS, basisWord, conversionLines, dollars, foundersAfter, harbour, isCapTableTab,
  issuedSafes, modelInstruments, modelPool, money, pct, scenarioCard, scenarioCards, simulatorHref, tabHref, tabSearch,
  variantHref, variantsHref,
} from '../src/pages/raise/captable/capTableModel.js';

const h = React.createElement;
const read = (path) => readFileSync(path, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

// `routes/safe_issuances.ts` GET /project/:id.
const SAFES = { form: 'post_money_cap', sendable: false, safes: [
  { uid: 's1', investor_name: 'Bluefern Capital', form: 'post_money_cap', amount_cents: 50000000, valuation_cap_cents: 1000000000, discount: null, currency: 'USD', status: { key: 'countersigned', label: 'Countersigned' }, created_at: '2026-03-02 10:00:00' },
  { uid: 's2', investor_name: 'Northwind Angels', form: 'post_money_cap', amount_cents: 15000000, valuation_cap_cents: null, discount: null, currency: 'USD', status: { key: 'draft', label: 'Draft · not sent' }, created_at: '2026-10-01 09:00:00' },
] };
// `routes/captable.ts` serialize(): the saved model and one variant.
const CANONICAL = {
  uid: 'm1', name: 'Main', is_variant: 0, updated_at: '2026-10-12T08:00:00Z',
  inputs: {
    founders: [{ name: 'Founder A', shares: 4000000 }, { name: 'Founder B', shares: 4000000 }],
    option_pool_pct: 10,
    safes: [
      { name: 'Harbor Seed Fund', amount: 250000, cap: 8000000, discount: 0.15 },
      { name: 'Bluefern Capital', amount: 500000, cap: 10000000, basis: 'post_money' },
      { name: 'Angel Note', amount: 100000, instrument: 'note', interest_rate: 0.08, issue_date: '2025-08-01' },
    ],
    rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000, post_round_pool_pct: 12 }],
  },
  result: {
    founding: [{ holder: 'Founder A', type: 'founder', shares: 4000000, pct: 45 }, { holder: 'Founder B', type: 'founder', shares: 4000000, pct: 45 }, { holder: 'Option pool', type: 'option_pool', shares: 888889, pct: 10 }],
    rounds: [{ name: 'Seed', events: ['SAFE Harbor Seed Fund converts at the cap', 'Option pool topped up by 312000 shares'], ledger: [
      { holder: 'Founder A', type: 'founder', shares: 4000000, pct: 24.1 }, { holder: 'Founder B', type: 'founder', shares: 4000000, pct: 24.1 }, { holder: 'Seed investors', type: 'preferred', shares: 4000000, pct: 51.8 },
    ] }],
  },
};
const VARIANT = { uid: 'v1', name: 'Seed · base case', is_variant: 1, updated_at: '2026-10-22T08:00:00Z', inputs: { founders: [], rounds: [] }, result: { founding: [{ holder: 'Founder A', type: 'founder', shares: 1, pct: 100 }], rounds: [] } };
const COMPARE = { canonical: CANONICAL, variants: [VARIANT] };
// `routes/captable.ts` GET /409a/:projectId.
const V409A = { ok: true, project_id: 3, as_of: '2026-10-24', current: { valuation_date: '2026-03-03', fmv_per_share: 0.42, provider: 'Carta Valuations', method: null },
  status: { state: 'valid', days_remaining: 130, expires_on: '2027-03-03', invalidated_by: null, reason: 'Safe harbour in force until 2027-03-03.' }, triggers: [], history: [], events: [] };
const MODULE = { module: { slug: 'cap-table', name: 'Cap table', records_title: 'Holders' }, card: { state: 'empty', reason: 'No holders yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function handler(url) {
  if (url.includes('/safe-issuances/project/')) return response(SAFES);
  if (url.includes('/captable/scenarios/by-project/') && url.includes('/compare')) return response(COMPARE);
  if (url.includes('/captable/409a/')) return response(V409A);
  if (/\/records\/[^/?]+\?/.test(url)) return response({ title: 'Founder A', sections: [], actions: [] });
  if (url.includes('/cycles/raise/modules/')) return response(MODULE);
  return response({});
}

async function mounted(url, { phone = false, handle = handler } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push(String(u)); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, flush, text: () => text(container), testIds: ids,
    count: (id) => ids().filter((x) => x === id).length,
    hrefs: () => nodes().filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tabs are the canvas\'s with a read, and only their words are tabs; a row is still a record', () => {
  assert.deepEqual(TABS.map((t) => t.id), ['overview', 'instruments', 'option-pool', 'scenarios']);
  for (const word of ['instruments', 'option-pool', 'scenarios']) assert.ok(isCapTableTab('cap-table', word), word);
  for (const id of ['h-12', 'e-3', 'pool', 'new', 'history', 'access', 'import-export', '']) assert.ok(!isCapTableTab('cap-table', id), id);
  assert.ok(!isCapTableTab('investor-narrative', 'instruments'), 'only Cap table has these words');
  assert.equal(tabSearch('?project=7&mode=workspace#x'), '?project_id=7');
  assert.equal(tabSearch('?project_id=0'), '');
  assert.equal(tabHref(TABS[2], '?project_id=3&version=2'), '/raise/cap-table/option-pool?project_id=3');
  // The two old pages read the venture as ?project= (CapTablePage, CapTableVariantsPage).
  assert.equal(simulatorHref('?project_id=3'), '/raise/capital/cap-table?project=3');
  assert.equal(variantsHref('?project_id=3'), '/raise/cap-table/variants?project=3');
  assert.equal(variantHref('a b'), '/raise/cap-table/variants/a%20b');
});

test('money in its own unit and currency; a missing value is "Not recorded", never zero', () => {
  assert.equal(dollars(500000), '$500,000');
  assert.equal(dollars(null), 'Not recorded');
  assert.equal(dollars(undefined), 'Not recorded');
  assert.equal(money(50000000, 'USD'), '$500,000');
  assert.equal(money(120000, 'EUR'), '€1,200');
  assert.equal(money(null, 'USD'), 'Not recorded');
  assert.equal(pct(61.5432), '61.54%');
  assert.equal(pct(null), 'Not recorded');
});

test('a SAFE sent through StudioOS is on record only once countersigned, with no invented discount', () => {
  const [a, b] = issuedSafes(SAFES);
  assert.deepEqual(a, { uid: 's1', holder: 'Bluefern Capital', amount: '$500,000', cap: '$10,000,000', discount: 'Not recorded', basis: 'Post-money', status: 'Countersigned', onRecord: true, created: '2 Mar 2026' });
  assert.equal(b.onRecord, false);
  assert.equal(b.cap, 'Not recorded');
  assert.deepEqual(issuedSafes(null), []);
});

test('the model\'s instruments: fractions as percentages, the basis check, a note\'s interest, and what cannot convert', () => {
  const [harbor, bluefern, note] = modelInstruments(CANONICAL);
  assert.equal(harbor.discount, '15%');
  assert.equal(harbor.basis, 'Pre-money (not stated)');
  assert.equal(harbor.check, true, 'a basis the model never stated is read as pre-money by the engine');
  assert.equal(bluefern.basis, 'Post-money');
  assert.equal(bluefern.check, false);
  assert.equal(bluefern.discount, 'Not recorded');
  assert.equal(note.type, 'Convertible note');
  assert.equal(note.interest, '8%');
  assert.equal(note.cannotConvert, true, 'no cap and no discount');
  assert.equal(harbor.interest, null, 'a SAFE has no interest column value');
  assert.equal(basisWord({ basis: 'pre_money' }), 'Pre-money');
  assert.match(BASIS_CHECK, /post-money/);
  assert.match(CANNOT_CONVERT, /no cap and no discount/);
  assert.deepEqual(conversionLines(CANONICAL), { round: 'Seed', lines: ['SAFE Harbor Seed Fund converts at the cap', 'Option pool topped up by 312000 shares'] });
  assert.equal(conversionLines({ result: { rounds: [] } }), null);
});

test('the pool, the 409A and the scenarios, each in the Worker\'s own figures', () => {
  assert.deepEqual(modelPool(CANONICAL), { target: '10%', shares: '888,889', pct: '10.00%' });
  assert.equal(modelPool(null), null);
  const hb = harbour(V409A);
  assert.equal(hb.state, 'valid');
  assert.equal(hb.fmv, '$0.42');
  assert.equal(hb.expires, '3 Mar 2027');
  assert.equal(harbour({ ok: false }), null, 'a read that did not answer is never "no 409A"');
  assert.equal(foundersAfter(CANONICAL.result), 48.2);
  assert.equal(foundersAfter({ founding: [{ type: 'founder', pct: 100 }], rounds: [] }), 100, 'no round: the founding table');
  assert.equal(foundersAfter({ rounds: [] }), null);
  const model = scenarioCard(CANONICAL, { model: true });
  assert.equal(model.name, 'Cap table · model');
  assert.equal(model.round, 'Seed · pre-money $12,000,000 · raise $3,000,000 · pool 12% post');
  assert.equal(model.founders, '48.20%');
  assert.equal(scenarioCard(VARIANT).round, 'No round is planned.');
  assert.deepEqual(scenarioCards(COMPARE).map((c) => c.name), ['Cap table · model', 'Seed · base case']);
  assert.deepEqual(scenarioCards({ canonical: null, variants: [] }), []);
});

/* ------------------------------------------------------------------ *
 * The page, mounted under CycleRoute on a stubbed fetch
 * ------------------------------------------------------------------ */

test('Instruments reads the SAFEs and the model, never a record called "instruments"', async () => {
  const v = await mounted('/raise/cap-table/instruments?project_id=3');
  try {
    assert.ok(v.requests.some((u) => u.includes('/safe-issuances/project/3')));
    assert.ok(v.requests.some((u) => u.includes('/captable/scenarios/by-project/3/compare')));
    assert.ok(!v.requests.some((u) => /\/records\/instruments/.test(u)), 'a tab word is not a record');
    const ids = v.testIds();
    assert.ok(ids.includes('captable-instruments-page') && ids.includes('captable-tabs'));
    assert.equal(v.count('captable-issued-row'), 2);
    assert.equal(v.count('tag-on-record'), 1, 'only the countersigned SAFE is on record');
    assert.equal(v.count('captable-model-instrument'), 3);
    assert.equal(v.count('captable-basis-check'), 2, 'the stated post-money SAFE carries no check');
    assert.ok(ids.includes('tag-modelled') && ids.includes('captable-conversion') && ids.includes('captable-cannot-convert'));
    assert.match(v.text(), /Countersigned/);
    assert.match(v.text(), /How they convert in Seed/);
  } finally { await v.close(); }
});

test('Option pool draws the 409A in the Worker\'s words, the model\'s pool, and says grants are not read', async () => {
  const v = await mounted('/raise/cap-table/option-pool?project_id=3');
  try {
    assert.ok(v.requests.some((u) => u.includes('/captable/409a/3')));
    assert.match(v.text(), /Safe harbour in force until 2027-03-03\./);
    assert.match(v.text(), /\$0\.42/);
    assert.match(v.text(), /888,889/);
    assert.ok(v.testIds().includes('captable-grants-wait'));
    assert.ok(!v.requests.some((u) => u.includes('/equity-plan')), 'the per-account plan is never read for one venture');
  } finally { await v.close(); }
});

test('Scenarios lists the model and its variants, each opening where it can be edited today', async () => {
  const v = await mounted('/raise/cap-table/scenarios?project_id=3');
  try {
    assert.equal(v.count('captable-scenario-card'), 2);
    assert.match(v.text(), /Cap table · model/);
    assert.match(v.text(), /Founders after 48\.20%/);
    const hrefs = v.hrefs();
    assert.ok(hrefs.includes('/raise/cap-table/variants/v1'), 'a variant opens its own page');
    assert.ok(hrefs.includes('/raise/capital/cap-table?project=3'), 'the model opens the simulator, with the venture');
  } finally { await v.close(); }
});

test('Overview is the module page with the tabs and the Modelled line; a row is still its record page', async () => {
  const home = await mounted('/raise/cap-table?project_id=3');
  try {
    assert.ok(home.requests.some((u) => u.includes('/cycles/raise/modules/cap-table?project=3')));
    const ids = home.testIds();
    assert.ok(ids.includes('cycle-module') && ids.includes('captable-tabs') && ids.includes('captable-home-note'));
    assert.match(home.text(), new RegExp(HOME_NOTE.slice(0, 40)));
  } finally { await home.close(); }
  const row = await mounted('/raise/cap-table/h-12?project_id=3');
  try {
    assert.ok(row.requests.some((u) => u.includes('/records/h-12?project=3')));
    assert.ok(row.testIds().includes('cycle-record-page') && !row.testIds().includes('captable-tabs'));
  } finally { await row.close(); }
  const other = await mounted('/raise/use-of-funds?project_id=3');
  try {
    assert.ok(!other.testIds().includes('captable-tabs'), 'only Cap table is this tool');
  } finally { await other.close(); }
});

test('each read answers alone: a failed one says so where its block would be', async () => {
  const fail = (match) => (u) => (match(u) ? response({ detail: 'boom' }, 500) : handler(u));
  const a = await mounted('/raise/cap-table/instruments?project_id=3', { handle: fail((u) => u.includes('/safe-issuances/')) });
  try {
    assert.ok(a.testIds().includes('captable-issued-unreadable'));
    assert.equal(a.count('captable-model-instrument'), 3, 'the model still draws');
    assert.match(a.text(), /This is not a claim that none were sent\./);
  } finally { await a.close(); }
  const b = await mounted('/raise/cap-table/option-pool?project_id=3', { handle: fail((u) => u.includes('/compare')) });
  try {
    assert.ok(b.testIds().includes('captable-pool-model-unreadable'));
    assert.match(b.text(), /Safe harbour in force/, 'the 409A still draws');
  } finally { await b.close(); }
  const c = await mounted('/raise/cap-table/scenarios?project_id=3', { handle: (u) => (u.includes('/compare') ? response({ detail: 'Forbidden' }, 403) : handler(u)) });
  try {
    assert.ok(c.testIds().includes('captable-scenarios-refused'));
    assert.ok(!c.testIds().includes('captable-scenarios-none'), 'a refusal is not "no scenarios"');
  } finally { await c.close(); }
});

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

test('the wiring: no route is added, CycleRoute branches on the tab word, and the canvas sits in incoming', () => {
  const app = read('frontend/src/App.jsx');
  assert.doesNotMatch(app, /path="\/raise\/cap-table\/(instruments|option-pool|scenarios)/, 'the module routes carry the tool');
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const capTableTab = record && cycle === 'raise' && isCapTableTab\(slug, recordId\) \? recordId : null;/);
  assert.match(route, /!narrativeTab && !capTableTab && !!projectId/);
  assert.match(route, /slug === CAP_TABLE \? <CapTableHomeNav search=\{q\} \/>/);
  const tool = read('frontend/src/pages/raise/captable/CapTableTool.jsx');
  assert.doesNotMatch(tool, /\b(alert|confirm)\(/);
  assert.doesNotMatch(tool, /equity-plan|getEquityPlan/, 'pools and vesting are per account today');
  for (const f of ['Raise Cap Table Page.dc.html', 'Cap Table · Boards.dc.html']) {
    const src = read(`design/incoming/${f}`);
    assert.match(src, /<script src="\.\/support\.js"><\/script>/, f);
    assert.doesNotMatch(src, /@font-face|__claude_design_branding/, f);
  }
  assert.match(read('design/incoming/Cap Table · Boards.dc.html'), /dc-import name="Raise Cap Table Page"/);
  assert.ok(existsSync('documentation/architecture/decisions/D1015.md'), 'D1015 records the integration');
});
