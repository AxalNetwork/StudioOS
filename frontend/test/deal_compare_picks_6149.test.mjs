/**
 * D6149 (#6149) — Compare's three dead ends: Remove on each venture, Add a
 * venture that returns to the table with the earlier picks ticked, and an
 * Export CSV that carries every row the table shows, absence in words. Plus
 * the print stylesheet. Every read is a stub: no test reaches the Worker.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_compare_picks_6149.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DealFlow from '../src/pages/investor/dealflow/DealFlow.jsx';
import { CompareView } from '../src/pages/investor/dealflow/Compare.jsx';
import { addVentureHref, compareHref, picksOf, viewOf } from '../src/pages/investor/dealflow/dealFlowModel.js';
import { compareCsv, compareSections } from '../src/pages/investor/dealflow/compareModel.js';
import { COMPARE_PRINT_CSS } from '../src/pages/investor/dealflow/comparePrint.js';
import { scoresOf } from '../src/pages/investor/dealflow/flowModel.js';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';
import { tagHolding } from './_tagHolding.mjs';

const h = React.createElement;
const sc = (scope, band, conf = 'High', state = 'scored') => ({ scope, state, band, confidence_word: conf });
const BATCH = { items: [
  { deal_id: 1, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium')] },
  { deal_id: 2, locked: true },
] };
const TRACTION = { masked: false, history: { state: 'recorded', data: [{ month: '2026-10', state: 'reported', figures: [{ key: 'customers', value: 12, unit: 'count' }] }] } };
const venture = (o) => ({ id: '1', name: 'Acme Robotics', sector: 'Robotics', round: 'Raising', ask: 1500000, currency: 'EUR', instrument: 'SAFE', valuation: 9000000, close: '2026-12-01',
  inFlow: true, stage: 'diligence', daysInStage: 9, scores: scoresOf(BATCH, 1), fit: { state: 'recorded', score: 86, confidence_label: 'High' }, traction: TRACTION, ...o });
const VENTURES = () => [
  venture(),
  venture({ id: '2', name: 'Northwind Labs', ask: null, instrument: null, valuation: null, close: null, inFlow: false, stage: null, daysInStage: null, scores: scoresOf(BATCH, 2), fit: { state: 'unavailable' }, traction: { masked: true } }),
  venture({ id: '3', name: 'Copperline Energy', daysInStage: null, scores: scoresOf('failed', 3), fit: 'failed', traction: 'failed' }),
];
const markup = (props) => renderToStaticMarkup(h(MemoryRouter, null, h(CompareView, props)));
// Tags are removed until none is left and &amp; is decoded last, so no entity is decoded twice (Code Scanning).
const untag = (s) => { for (let prev = null; prev !== s;) { prev = s; s = s.replace(/<[^>]+>/g, ''); } return s; };
const strip = (s) => untag(s).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
/** The table's body rows as on screen: [label, ...cell text], read from the rendered markup. */
const screenRows = (html) => {
  const table = html.slice(html.indexOf('data-testid="dealflow-compare-table"'), html.indexOf('</table>'));
  return [...table.matchAll(/<tr[^>]*>(<th scope="row".*?)<\/tr>/g)].map(([, tr]) => [...tr.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/g)].map(([, cell]) => strip(cell)));
};
/** The href of the link with this test id (React writes `href` after the other props). */
const hrefOf = (html, id) => (tagHolding(html, `data-testid="${id}"`, (t) => t.startsWith('<a')) || null)?.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
const csvRows = (csv) => csv.split('\n').slice(1).map((line) => line.split(','));

test('Remove: each venture card links to the same address without it, keyboard-reachable and 44px on a phone', () => {
  const html = markup({ ventures: VENTURES() });
  for (const [id, rest] of [['1', '2,3'], ['2', '1,3'], ['3', '1,2']]) {
    const link = html.match(new RegExp(`<a[^>]*data-testid="dealflow-compare-remove-${id}"[^>]*>Remove</a>`))?.[0];
    assert.ok(link, `a Remove link on venture ${id}`);
    assert.equal(hrefOf(html, `dealflow-compare-remove-${id}`), `/deals/compare?ids=${rest}`);
    assert.match(link, /min-h-\[44px\]/);
    assert.match(link, /min-w-\[44px\]/);
    assert.match(link, /aria-label="Remove [^"]+ from the comparison"/);
  }
  // With one left, Compare says to pick at least two, and its link to the table keeps that pick.
  assert.equal(compareHref(['2', '3'].filter((x) => x !== '3')), '/deals/compare?ids=2');
  const one = markup({ ventures: VENTURES().slice(1, 2) });
  assert.match(one, /data-testid="dealflow-compare-few"/);
  assert.match(one, /Pick at least two ventures to compare/);
  assert.equal(hrefOf(one, 'dealflow-compare-few-add'), '/deals?view=table&scope=all&pick=2');
  assert.doesNotMatch(one, /dealflow-compare-remove-/);
});

test('Add a venture carries the picks in the address, read by the same rule as ?ids=', () => {
  assert.equal(addVentureHref(['1', '2', '3']), '/deals?view=table&scope=all&pick=1,2,3');
  assert.equal(addVentureHref([]), '/deals?view=table&scope=all');
  assert.deepEqual(picksOf('?view=table&pick=3,1,x,3,0,9,8,7'), ['3', '1', '9', '8'], 'digits only, no repeats, at most four');
  assert.deepEqual(picksOf('?view=table'), []);
  const html = markup({ ventures: VENTURES().slice(0, 2) });
  assert.equal(hrefOf(html, 'dealflow-compare-add'), '/deals?view=table&scope=all&pick=1,2');
  assert.equal(hrefOf(html, 'dealflow-compare-add-slot'), '/deals?view=table&scope=all&pick=1,2');
});

test('mounted: the table opened from Add a venture has the earlier picks ticked and offers Compare', async () => {
  const restoreDom = installDocument();
  const wasMM = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const was = { flow: dealFlowApi.flow, inbox: dealFlowApi.inbox, listDeals: api.listDeals, screening: api.dealScreening, commitRoom: api.icCommitRoom,
    batch: ventureScoresApi.batch, weights: ventureScoresApi.weights, fit: dealViewsApi.fit, list: dealViewsApi.list };
  dealFlowApi.flow = async () => ({ items: [{ deal_id: 1, venture: 'Acme Robotics', stage: 'diligence', can_open: true }] });
  dealFlowApi.inbox = async () => ({ items: [], sources: {} });
  api.listDeals = async () => [1, 2, 3].map((id) => ({ id, project_name: `Venture ${id}`, status: 'active', currency: 'EUR' }));
  api.dealScreening = async () => ({ desk: { available: true, rows: [] } });
  api.icCommitRoom = async () => ({ decisions: { available: true, rows: [] } });
  Object.assign(ventureScoresApi, { batch: async () => ({ items: [] }), weights: async () => ({ weights: null, equal: true }) });
  Object.assign(dealViewsApi, { fit: async () => ({ items: [] }), list: async () => ({ items: [], default_uid: null }) });
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  function Root() {
    const l = useLocation();
    return h(DealFlow, viewOf(l.search));
  }
  try {
    await act(async () => root.render(h(MemoryRouter, { initialEntries: [addVentureHref(['3', '1'])] }, h(Routes, null, h(Route, { path: '*', element: h(Root) })))));
    for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); });
    assert.equal(props(byId('dealflow-tick-1')).checked, true);
    assert.equal(props(byId('dealflow-tick-3')).checked, true);
    assert.equal(props(byId('dealflow-tick-2')).checked, false);
    assert.equal(props(byId('dealflow-compare')).href, '/deals/compare?ids=3,1', 'Compare keeps the pick order');
  } finally {
    await act(async () => root.unmount());
    Object.assign(dealFlowApi, { flow: was.flow, inbox: was.inbox });
    Object.assign(api, { listDeals: was.listDeals, dealScreening: was.screening, icCommitRoom: was.commitRoom });
    Object.assign(ventureScoresApi, { batch: was.batch, weights: was.weights });
    Object.assign(dealViewsApi, { fit: was.fit, list: was.list });
    globalThis.matchMedia = wasMM;
    restoreDom();
  }
});

test('Export CSV: its rows are the table’s rows, in order, every absence a word', () => {
  for (const flowUnknown of [false, true]) {
    const ventures = VENTURES();
    const screen = screenRows(markup({ ventures, flowUnknown }));
    const csv = csvRows(compareCsv(ventures, { flowUnknown }));
    assert.ok(screen.length > 20, 'the six sections are on screen');
    assert.deepEqual(csv.map((r) => r[1]), screen.map((r) => r[0]), 'the same rows, in the same order');
    for (const [i, row] of screen.entries()) {
      for (const [j, cell] of row.slice(1).entries()) {
        const out = csv[i][2 + j];
        assert.notEqual(out, '', `${row[0]}: no blank cell`);
        // A dash on screen (no days, fit not shared) is a word in the file; everything else is the same words.
        if (cell === '—') assert.match(out, /^(Not recorded|Not on your deals|Not shared|Unreadable)$/, `${row[0]}: ${out}`);
        else assert.equal(out, cell, `${row[0]}, venture ${j + 1}`);
      }
    }
  }
  const csv = compareCsv(VENTURES());
  const line = (label) => csv.split('\n').find((l) => l.split(',')[1] === label);
  assert.equal(csv.split('\n')[0], 'Section,Comparison,Acme Robotics,Northwind Labs,Copperline Energy');
  for (const [section, n] of [['Investment case', 6], ['Scorecard', 11], ['Fit to thesis', 1], ['Traction', compareSections([]).find((s) => s.key === 'traction').rows.length], ['Risk', 1]]) {
    assert.equal(csv.split('\n').filter((l) => l.startsWith(`${section},`)).length, n, section);
  }
  assert.equal(line('Ask'), 'Investment case,Ask,€1.5M · SAFE,Ask not recorded,€1.5M · SAFE');
  assert.equal(line('Days in stage'), 'Investment case,Days in stage,9 days,Not on your deals,Not recorded');
  assert.equal(line('Team'), 'Scorecard,Team,Strong · High,Locked,Unreadable');
  assert.equal(line('Fit to my thesis'), 'Fit to thesis,Fit to my thesis,86 · High,Not shared,Unreadable');
  assert.equal(line('Reporting period'), 'Traction,Reporting period,Oct 2026,Locked,Unreadable');
  assert.equal(line('Material risks'), 'Risk,Material risks,Not recorded,Not recorded,Not recorded');
  assert.match(compareCsv(VENTURES(), { flowUnknown: true }), /^Investment case,Your stage,Unreadable,Unreadable,Unreadable$/m);
  // A name a spreadsheet would run is written as text, and quoted where it holds a comma.
  assert.equal(compareCsv([venture({ name: '=HYPERLINK("x"),1' })]).split('\n')[0], 'Section,Comparison,"\'=HYPERLINK(""x""),1"');
});

test('print: only the comparison prints, the chart gives way to the table, the header repeats, the controls do not print', () => {
  assert.match(COMPARE_PRINT_CSS, /@media print/);
  assert.match(COMPARE_PRINT_CSS, /body \* \{ visibility: hidden; \}/);
  assert.match(COMPARE_PRINT_CSS, /\[data-print="hide"\][^{]*\{ display: none !important; \}/);
  assert.match(COMPARE_PRINT_CSS, /thead \{ position: static !important; display: table-header-group; \}/);
  assert.match(COMPARE_PRINT_CSS, /#compare-table \{ max-height: none !important; overflow: visible !important; \}/);
  const html = markup({ ventures: VENTURES() });
  assert.match(html, /data-testid="dealflow-compare-page" data-compare-print=""/);
  assert.match(html, /<style>[^<]*@media print/);
  // D6151: the chart is desktop-only (the phone stacks the sections), and still never prints.
  assert.match(html, /<div class="hidden md:block" data-print="hide"><ul[^>]*data-testid="dealflow-compare-chart"/, 'the chart does not print; the table holds its bands');
  assert.match(html, /<div class="hidden md:block print:block"><div class="max-h-\[65vh\] overflow-auto" id="compare-table"/, 'the table prints at any width');
  assert.match(html, /<div class="[^"]*" data-print="hide">(?:(?!<\/div>).)*dealflow-compare-add(?:(?!<\/div>).)*dealflow-compare-csv(?:(?!<\/div>).)*dealflow-compare-print/, 'the toolbar does not print');
  assert.match(html, /data-print="hide" data-testid="dealflow-compare-remove-1"/, 'Remove does not print');
  assert.match(html, /data-print="cards"/);
});
