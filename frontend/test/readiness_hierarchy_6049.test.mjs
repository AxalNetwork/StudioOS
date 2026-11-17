// D6049 (#6049, Raise v2 RA-16) — Fundraising readiness in one order: the
// header's coverage line, at most three priorities, every area in one table,
// Product-market fit apart, then Detail and AI gap analysis collapsed. Each
// gap still opens the workflow the Worker names (D5071), and PMF's below-floor
// and Unreadable states are drawn as before.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/readiness_hierarchy_6049.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { ReadinessBands } from '../src/pages/cycles/ReadinessHome.jsx';
import { NO_TARGET, areasOf, coverageLine, priorities, summaryLine } from '../src/pages/cycles/readinessModel.js';
import { cycleRouteText } from './_cycleBands.mjs';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const cell = (item, o = {}) => ({ item, score: null, evidence: null, missing: '', updated: '2026-11-01', freshness: 'Current', fix_href: null, ...o });
/** The Worker's rows (`readinessRecords`), score-sorted as it sends them. */
const RECORDS = () => ({ linkable: true, cols: [], total: 8, page: 1, page_size: 25, rows: [
  { id: 'cap_table', cells: cell('Cap table', { score: 10, evidence: 'measured', fix_href: '/raise/cap-table?project=3' }) },
  { id: 'use_of_funds', cells: cell('Use of funds', { score: 10, evidence: 'measured', freshness: 'Stale · its inputs changed', fix_href: '/raise/use-of-funds?project=3' }) },
  { id: 'traction', cells: cell('Traction proof', { score: 5, evidence: 'stated', missing: 'Connect Stripe or Mercury, or attach a proof document, to raise this above a stated figure.', fix_href: '/raise/metrics?project=3' }) },
  { id: 'data_room', cells: cell('Data room', { score: 0, evidence: 'measured', missing: '12 checklist items have no file.', fix_href: '/raise/data-room/checklist?project=3' }) },
  { id: 'deck', cells: cell('Pitch deck', { score: 0, evidence: 'measured', missing: 'Build the pitch deck.', fix_href: '/raise/pitch?project=3' }) },
  { id: 'narrative', cells: cell('Investor narrative', { missing: 'Not enough recorded · save an investor narrative version.', freshness: null, fix_href: '/raise/investor-narrative/new?project=3' }) },
  { id: 'team', cells: cell('Team', { updated: null, missing: null, freshness: null, fix_href: '/build/founding-team?project=3' }) },
  { id: 'pmf', cells: cell('Product-market fit', { score: 6.4, evidence: 'pattern', missing: 'See the gaps above.', fix_href: '/raise/fundraising-readiness?project=3' }) },
] });
const CARD = { state: 'ok', series: [
  { kind: 'hbar', items: [{ label: 'Investor narrative', value: null }, { label: 'Pitch deck', value: 0 }, { label: 'Data room', value: 0 }, { label: 'Cap table', value: 10 },
    { label: 'Use of funds', value: 10 }, { label: 'Traction proof', value: 5 }, { label: 'Team', value: null }] },
], next: { text: 'Build the pitch deck.', href: '/raise/pitch?project=3' } };
const PMF_NOT_ENOUGH = { model: '1.0', state: 'not_enough', value: null, band: null, confidence: 0.1, confidence_word: null, coverage: { present: 0, applies: 9 }, inputs: [], steps: [], id: 4, inputs_hash: null, computed_at: '2026-11-01T09:00:00Z', trigger: 'module_read', verdict: null, pivot_at: null };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the areas: Product-market fit left out, the Worker\'s order, one state each, and no target is invented', () => {
  const a = areasOf(RECORDS());
  assert.equal(a.state, 'ready');
  assert.deepEqual(a.rows.map((r) => r.key), ['narrative', 'deck', 'data_room', 'cap_table', 'use_of_funds', 'traction', 'team'], 'PMF is its own section, never an area');
  assert.deepEqual(a.rows.map((r) => r.status), ['Missing', 'Missing', 'Missing', 'Ready', 'Stale', 'Needs attention', 'Not recorded']);
  for (const r of a.rows) assert.equal(r.target, NO_TARGET);
  assert.equal(NO_TARGET, 'Not recorded · no target set');
  const byKey = Object.fromEntries(a.rows.map((r) => [r.key, r]));
  assert.equal(byKey.team.evidence, 'Not recorded · not assessed yet', 'nobody assessed it: Not recorded, never 0');
  assert.equal(byKey.deck.evidence, 'Build the pitch deck.');
  assert.equal(byKey.deck.evidenceSub, '0 of 10 · Measured · as of 1 Nov 2026', 'a measured 0 is a 0');
  assert.equal(byKey.cap_table.action, null, 'Ready needs no action');
  assert.equal(byKey.cap_table.why, null);
  assert.equal(byKey.data_room.why, 'Diligence stalls without it.');
  // D5071: the action is the Worker's address for that item, never this page's.
  assert.deepEqual(byKey.narrative.action, { text: 'Open the narrative', href: '/raise/investor-narrative/new?project=3' });
  assert.equal(byKey.deck.action.href, '/raise/pitch?project=3');
  const bad = areasOf({ rows: [{ id: 'deck', cells: cell('Pitch deck', { score: 0, missing: 'Build it.', fix_href: '//evil.example/x' }) }] });
  assert.equal(bad.rows[0].action, null, 'an address outside the app is never linked');
  const unavailable = areasOf({ rows: [{ id: 'cap_table', cells: cell('Cap table', { missing: 'Unavailable · the cap table could not be read.' }) }] });
  assert.equal(unavailable.rows[0].status, 'Unavailable');
  assert.equal(areasOf(null, 'unreadable').state, 'unreadable');
  assert.equal(areasOf({ state: 'unreadable' }).state, 'unreadable');
  assert.equal(areasOf(null, 'loading').state, 'loading');
});

test('at most three priorities, the largest gain first, never Team, never a Ready or unassessed area', () => {
  const p = priorities(areasOf(RECORDS()).rows);
  assert.equal(p.length, 3);
  // Scored now: 0, 0, 10, 10, 5 (mean 50). At 10: Pitch +20, Data room +20, Traction +10, Narrative +8, Use of funds 0.
  assert.deepEqual(p.map((x) => x.key), ['deck', 'data_room', 'traction'], 'the largest gain first; a tie keeps the Worker\'s order');
  assert.ok(!p.some((x) => x.key === 'team' || x.key === 'cap_table' || x.key === 'pmf'));
  assert.equal(p[0].reason, 'Build the pitch deck.');
  assert.equal(p[0].action.href, '/raise/pitch?project=3');
  const narrative = priorities(areasOf({ rows: [RECORDS().rows[5], RECORDS().rows[0]] }).rows);
  assert.deepEqual([narrative[0].key, narrative[0].reason], ['narrative', 'Not enough recorded · save an investor narrative version.']);
  const stale = priorities(areasOf({ rows: [RECORDS().rows[1]] }).rows);
  assert.equal(stale[0].reason, 'Its inputs changed since it was scored.');
  assert.deepEqual(priorities(areasOf({ rows: [RECORDS().rows[0], RECORDS().rows[6]] }).rows), [], 'nothing needs attention');
  const team = { id: 'team', cells: cell('Team', { score: 2, evidence: 'stated', missing: 'No vesting recorded.', fix_href: '/build/founding-team?project=3' }) };
  assert.equal(areasOf({ rows: [team] }).rows[0].status, 'Needs attention');
  assert.deepEqual(priorities(areasOf({ rows: [team, RECORDS().rows[0]] }).rows), [], 'Team is assessed by a person and is never a priority');
});

test('the header line names coverage and freshness, and claims nothing it did not read', () => {
  assert.equal(coverageLine(RECORDS()), '6 of 7 areas assessed · 5 need attention · last assessed 1 Nov 2026');
  assert.equal(coverageLine({ state: 'unreadable' }), null);
  assert.equal(coverageLine(null), null);
  assert.equal(coverageLine({ rows: [] }), null);
  assert.equal(summaryLine(areasOf(RECORDS()).rows), '7 fundraising areas: 1 ready, 1 needs attention, 3 missing, 1 stale, 1 not recorded');
  assert.equal(summaryLine([]), 'No area is assessed yet.');
});

/* ------------------------------------------------------------------ *
 * Mounted, through the route
 * ------------------------------------------------------------------ */

const MODULE = (o = {}) => ({ module: { slug: 'fundraising-readiness', name: 'Fundraising readiness', records_title: 'Readiness items' }, card: CARD, records: RECORDS(), parts: { pmf: PMF_NOT_ENOUGH }, ...o });

async function mounted(body, { phone = false } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const url = String(u);
    if (url.includes('/cycles/raise/pmf/history')) return response({ items: [], has_more: false, next_cursor: null });
    if (url.includes('/cycles/raise/modules/fundraising-readiness')) return typeof body === 'function' ? body() : response(body);
    return response({});
  };
  globalThis.matchMedia = (q) => ({ matches: phone && /max-width/.test(q), addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/raise/fundraising-readiness?project_id=3'] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
  ))));
  await act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(container);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const all = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  const order = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    props, all, one: (id) => all(id)[0], order,
    count: (id) => all(id).length,
    textOf: (id) => text(all(id)[0]),
    text: () => text(container),
    within: (id, inner) => walk(all(id)[0] || { childNodes: [] }).filter((n) => props(n)['data-testid'] === inner),
    hrefsIn: (id) => walk(all(id)[0] || { childNodes: [] }).filter((n) => String(n.tagName).toUpperCase() === 'A').map((n) => props(n).href || props(n).to).filter(Boolean),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('desktop: one order, no generic chart or table, and every gap opens its own workflow', async () => {
  const t = await mounted(MODULE());
  try {
    assert.equal(t.count('cycle-module-chart'), 0, 'the generic "at a glance" chart is gone');
    assert.equal(t.count('cycle-records'), 0, 'the generic records table is gone; the areas table replaces it');
    const seq = t.order();
    const at = (id) => seq.indexOf(id);
    for (const id of ['readiness-priorities', 'readiness-areas', 'pmf-part', 'readiness-detail', 'readiness-ai']) assert.ok(at(id) >= 0, `${id} is drawn`);
    assert.ok(at('readiness-priorities') < at('readiness-areas') && at('readiness-areas') < at('pmf-part') && at('pmf-part') < at('readiness-detail') && at('readiness-detail') < at('readiness-ai'),
      `priorities → areas → PMF → Detail → AI gap analysis, got ${seq.filter((x) => x.startsWith('readiness') || x === 'pmf-part').join(', ')}`);
    assert.match(t.text(), /6 of 7 areas assessed · 5 need attention · last assessed 1 Nov 2026/, 'the header names coverage and freshness');
    assert.equal(t.count('readiness-priority'), 3);
    assert.deepEqual(t.hrefsIn('readiness-priorities'), ['/raise/pitch?project=3', '/raise/data-room/checklist?project=3', '/raise/metrics?project=3']);
    assert.equal(t.count('readiness-area'), 7, 'all areas in one table, PMF not among them');
    assert.ok(t.hrefsIn('readiness-areas').includes('/raise/metrics?project=3'), 'Traction opens Metrics (D5071)');
    assert.ok(t.hrefsIn('readiness-areas').includes('/raise/fundraising-readiness/team?project_id=3'), 'an area opens its record where the read links it');
    assert.equal(t.within('readiness-areas', 'readiness-area-action').length, 6, 'every area but the Ready one has its one action');
    assert.equal(t.within('readiness-areas', 'readiness-target').length, 7);
    assert.match(t.textOf('readiness-areas'), /Target: Not recorded · no target set/);
    assert.equal(t.within('readiness-areas', 'records-add').length, 1, 'Re-score stays with the table');
    assert.match(t.textOf('records-add'), /Re-score/);
    // PMF apart, and its below-floor state as before.
    assert.match(t.textOf('pmf-apart'), /not averaged into readiness/);
    assert.equal(t.count('pmf-not-enough'), 1);
    assert.equal(t.count('pmf-value'), 0);
    assert.equal(t.count('pmf-gaps-kit'), 0, 'a raise kit gap is now its area\'s action');
    // Detail and AI gap analysis are collapsed disclosures.
    for (const id of ['readiness-history', 'readiness-kit', 'readiness-ai']) {
      assert.equal(String(t.one(id).tagName).toUpperCase(), 'DETAILS', `${id} is a disclosure`);
      assert.ok(!t.props(t.one(id)).open, `${id} starts collapsed`);
    }
    assert.equal(t.within('readiness-history', 'pmf-history').length, 1);
    assert.equal(t.within('readiness-kit', 'kit-tile').length, 1);
    assert.equal(t.within('readiness-ai', 'zone-draft-raise-data-room').length, 1, 'Read the room sits in AI gap analysis');
    assert.equal(t.within('readiness-ai', 'zone-draft-raise-legal').length, 1, 'Explain the clauses sits in AI gap analysis');
    // The chart view keeps the table.
    await act(async () => t.props(t.one('readiness-view-chart')).onClick());
    assert.equal(t.count('readiness-chart'), 1);
    assert.equal(t.count('readiness-area'), 7, 'Chart keeps the table');
    assert.equal(t.within('readiness-chart', 'readiness-chart-hatched').length, 2, 'unscored areas are hatched, never a 0 bar');
  } finally { await t.close(); }
});

test('Unreadable states are said, never drawn as nothing to do', async () => {
  let t = await mounted(MODULE({ records: { state: 'unreadable', reason: 'The readiness items could not be read' }, parts: { pmf: { state: 'unreadable' } } }));
  try {
    assert.equal(t.count('readiness-priorities-unreadable'), 1);
    assert.equal(t.count('readiness-priority'), 0);
    assert.equal(t.count('readiness-area'), 0);
    assert.match(t.textOf('readiness-areas'), /could not be read/i);
    assert.equal(t.count('pmf-unreadable'), 1, 'PMF\'s Unreadable is unchanged');
    assert.equal(t.count('pmf-retry'), 1);
    assert.ok(!/areas assessed/.test(t.text()), 'no coverage is claimed for a read that failed');
  } finally { await t.close(); }
  t = await mounted(() => response({ detail: 'The module could not be read' }, 503));
  try {
    assert.equal(t.count('readiness-home'), 0, 'a failed module read draws the page\'s own Unreadable, not the home');
    assert.equal(t.count('cycle-module-unreadable'), 1);
  } finally { await t.close(); }
});

test('phone: the same home in place of One next thing, the chart and the rows', async () => {
  const t = await mounted(MODULE(), { phone: true });
  try {
    assert.equal(t.count('phone-module'), 1);
    assert.equal(t.props(t.one('phone-module'))['data-owned'], 'true');
    for (const id of ['phone-module-next', 'phone-module-chart', 'phone-module-records']) assert.equal(t.count(id), 0, `${id} is not drawn`);
    assert.equal(t.count('readiness-home'), 1);
    assert.equal(t.count('readiness-priority'), 3);
    assert.equal(t.count('readiness-area'), 7);
    assert.match(t.text(), /6 of 7 areas assessed/, 'the bar names coverage');
  } finally { await t.close(); }
  const src = read('frontend/src/pages/cycles/ReadinessHome.jsx');
  assert.match(src, /const ACTION = '[^']*max-lg:min-h-\[44px\]/, 'actions are 44px targets below 1024px');
  assert.match(src, /const SUMMARY = '[^']*min-h-\[44px\]/, 'every disclosure is a 44px target');
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the wiring: the def owns the page, the bands fold, no header action, no Worker write', () => {
  const route = cycleRouteText();
  assert.match(route, /const home = fnOf\(def\.homes, slug\)\?\.\(module, /);
  assert.match(route, /home=\{home\?\.body \?\? null\}/);
  assert.match(route, /<Bands>\s*\{fillsOn && projectId \? drafts\.map/, 'the bands draw inside the page\'s fold');
  assert.match(route, /<PmfExplain [^\n]*\/>\}\s*<\/Bands>/, 'the PMF reading sits in AI gap analysis too');
  assert.match(route, /action: \(q\) => \(\{ label: 'Build your deck', href: `\/raise\/pitch\$\{q\}` \}\)/, 'the header action is #5081\'s, unchanged');
  const page = read('frontend/src/pages/cycles/ReadinessHome.jsx') + read('frontend/src/pages/cycles/readinessModel.js');
  // D5081 part 5 (#5081, RA-14): the header's action is the page's own Fix next priority (`nextPriorityAction`,
  // through `homes`); the page itself draws no second one.
  assert.ok(!/Fix next priority/.test(read('frontend/src/pages/cycles/ReadinessHome.jsx')), 'no second header action');
  assert.match(read('frontend/src/pages/cycles/defs/raise.jsx'), /action: nextPriorityAction\(data\?\.records\)/);
  assert.ok(!/cyclesWrite|fetch\(|method: '(POST|PUT)'/.test(page), 'the home writes nothing');
  assert.ok(!/\b(advisor|advice|recommend\w*|fiduciary)\b/i.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'Eadwyn voice');
  assert.equal(renderToStaticMarkup(h(ReadinessBands, null, null, false)), '', 'nothing to fold, nothing drawn');
  assert.match(renderToStaticMarkup(h(ReadinessBands, null, h('p', null, 'band'))), /^<details[^>]*data-testid="readiness-ai"/);
  // RA-16 draws no founder-set target per area, so the Worker gains no write next to PUT /readiness/:key.
  const worker = read('cloudflare-worker/src/routes/cycle_raise.ts');
  assert.ok(!/cycleRaise\.(put|post|patch)\('\/readiness\/:key\/target'/.test(worker));
  assert.ok(read('design/incoming/Raise v2 · Boards.dc.html').includes("'RA-16', 'Fundraising readiness'"));
  assert.ok(read('documentation/architecture/decisions/D6049.md').startsWith('## D6049 — '));
});
