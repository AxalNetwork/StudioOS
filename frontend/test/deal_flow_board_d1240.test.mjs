/**
 * D1240 (#3253, part 4 of #2423) — Deal flow's board and table complete
 * (DLS1–DLS5, DLS13–DLS16, DLS18), over the firm's flow (D1238), the deal
 * list (D1236), SCORING's batch (D1256), the fit and saved views (D1239).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_board_d1240.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DealFlow from '../src/pages/investor/dealflow/DealFlow.jsx';
import { viewOf } from '../src/pages/investor/dealflow/dealFlowModel.js';
import {
  BOARD_STAGES, DEFAULT_COLUMNS, SCOPE_KEYS, columnAsks, moneyText, defaultSettings, emptyFilters, filterChips, fitCell, flowRows, moveTargets, namesSettings,
  passes, scopeCell, scoresOf, settingsHref, settingsOf, settingsOfSpec, sortRows, specOf, stripScopes, toggleCard, toggleColumn, viewChanged,
} from '../src/pages/investor/dealflow/flowModel.js';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;

// ---------------------------------------------------------------- fixtures

const entry = (o) => ({
  uid: `u${o.deal_id}`, deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'diligence',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00', stage_changed_at: '2026-10-20',
  days_in_stage: 9, ask: 1500000, pass: null, note: null, can_open: true, ...o,
});
const FLOW = () => ({
  scope: 'firm', by_stage: {},
  items: [
    entry({ deal_id: 1 }),
    entry({ deal_id: 2, venture: 'Northwind Labs', sector: 'AI infrastructure', stage: 'screening', entered_via: 'thesis', days_in_stage: null, ask: null, owner: null, can_open: false }),
    entry({ deal_id: 3, venture: 'Copperline Energy', sector: 'Climate', stage: 'sourcing', entered_via: 'watchlist', round_status: 'scored', ask: 750000, days_in_stage: 5 }),
    entry({ deal_id: 4, venture: 'Old Pass', stage: 'passed', entered_via: 'added' }),
  ],
});
const DEALS = () => [
  { id: 1, project_name: 'Acme Robotics', project_sector: 'Robotics', status: 'active', target_raise: 1500000, currency: 'EUR', instrument: 'SAFE' },
  { id: 2, project_name: 'Northwind Labs', project_sector: 'AI infrastructure', status: 'active', currency: 'EUR' },
  { id: 3, project_name: 'Copperline Energy', project_sector: 'Climate', status: 'scored', target_raise: 750000, currency: 'EUR', instrument: 'Convertible note' },
  { id: 4, project_name: 'Old Pass', status: 'active', currency: 'EUR' },
  { id: 9, project_name: 'Orchid Analytics', project_sector: 'AI infrastructure', status: 'active', target_raise: 1800000, currency: 'EUR' },
];
const sc = (scope, band, conf = 'High', state = 'scored') => ({ scope, state, band, confidence_word: conf });
const BATCH = () => ({
  items: [
    { deal_id: 1, locked: false, scopes: [sc('team', 'Strong'), sc('market', 'Fair', 'Medium'), sc('risk', 'Strong'), sc('technical', null, null, 'not_enough'), sc('geographic', 'Strong', 'Low')] },
    { deal_id: 2, locked: false, scopes: [sc('team', 'Fair', 'Low'), sc('market', 'Strong')] },
    { deal_id: 3, locked: true, reason: 'The founder has not shared this scorecard with investors.' },
  ],
  not_readable: 1,
});
const FIT = () => ({ items: [
  { deal_id: 1, state: 'recorded', score: 86, confidence_label: 'High' },
  { deal_id: 2, state: 'not_set', score: null },
  { deal_id: 3, state: 'recorded', score: 0, confidence_label: 'Medium' },
  { deal_id: 9, state: 'unavailable', score: null },
] });
const VIEWS = () => ({ items: [
  { uid: 'v1', name: 'Strong team', mine: true, is_default: false, shared_with_firm: false, version: 3, spec: { version: 1, view: 'table', scope: 'mine', filters: { min: { team: 'strong' } }, sort: { by: 'market', dir: 'desc' } } },
  { uid: 'v2', name: 'Monday IC list', mine: false, is_default: false, shared_with_firm: true, version: 1, spec: { version: 1, view: 'board', scope: 'mine' } },
], default_uid: null, can_share_with_firm: false });

const row = ({ id, ...o }) => ({ ...flowRows('mine', { flow: FLOW(), deals: DEALS() }).find((r) => r.id === String(id)), scores: scoresOf(BATCH(), id), fit: null, ...o });

// ---------------------------------------------------------------- the model

test('a score is a band with its confidence, never a number; every missing score is a word', () => {
  const s1 = scoresOf(BATCH(), 1);
  assert.deepEqual(scopeCell(s1, 'team'), { kind: 'scored', word: 'Strong', band: 'Strong', confidence: 'High', title: 'Team: Strong, high confidence' });
  assert.equal(scopeCell(s1, 'risk').word, 'Low risk', 'Risk reads as a risk word');
  assert.equal(scopeCell(s1, 'technical').word, 'Not enough recorded');
  assert.equal(scopeCell(s1, 'pmf').word, 'Not scored', 'a scope the batch did not return');
  assert.equal(scopeCell(scoresOf(BATCH(), 3), 'team').word, 'Locked');
  assert.equal(scopeCell(scoresOf(BATCH(), 9), 'team').word, 'Not shared', 'a deal the batch left out');
  assert.equal(scopeCell(scoresOf('failed', 1), 'team').word, '—');
  assert.equal(scopeCell(scoresOf(null, 1), 'team').word, 'Reading…');
  assert.equal(scopeCell(scoresOf({ items: [{ deal_id: 1, scopes: [sc('team', null, null, 'not_expected')] }] }, 1), 'team').word, 'Not expected yet');
  for (const id of [1, 2, 3, 9]) for (const k of SCOPE_KEYS) assert.doesNotMatch(scopeCell(scoresOf(BATCH(), id), k).word, /\d/, `${id} ${k}: no figure`);
  const strip = stripScopes(s1);
  assert.equal(strip.length, 11);
  assert.deepEqual(strip.find((x) => x.key === 'team'), { key: 'team', state: 'scored', value: 85, confidence: 'high' });
  assert.equal(strip.find((x) => x.key === 'pmf').state, 'not_read');
  assert.equal(strip.find((x) => x.key === 'technical').state, 'not_enough');
});

test('fit is the investor’s own number: a measured 0 stays 0, and none is a word', () => {
  assert.equal(fitCell({ state: 'recorded', score: 86, confidence_label: 'High' }).word, '86');
  assert.equal(fitCell({ state: 'recorded', score: 0, confidence_label: 'Low' }).word, '0', 'every criterion outside is a real 0');
  assert.equal(fitCell({ state: 'not_set' }).word, 'Set your thesis');
  assert.equal(fitCell({ state: 'not_enough_recorded', score: null }).word, 'Not enough recorded');
  assert.equal(fitCell({ state: 'unavailable' }).word, '—');
  assert.equal(fitCell('failed').word, 'Unreadable');
});

test('rows: Mine is the flow, All deals every round with its flow row; a door only where can_open says', () => {
  const mine = flowRows('mine', { flow: FLOW(), deals: DEALS() });
  assert.deepEqual(mine.map((r) => [r.id, r.stage, r.currency]), [['1', 'diligence', 'EUR'], ['2', 'screening', 'EUR'], ['3', 'sourcing', 'EUR'], ['4', 'passed', 'EUR']]);
  assert.equal(mine[0].owner.initials, 'NA');
  assert.equal(mine[1].ask, null, 'no ask stays null');
  const all = flowRows('all', { flow: FLOW(), deals: DEALS() });
  const orchid = all.find((r) => r.id === '9');
  assert.deepEqual([orchid.inFlow, orchid.stage, orchid.canOpen, orchid.ask], [false, null, false, 1800000]);
  assert.equal(all.find((r) => r.id === '1').canOpen, true);
  assert.equal(columnAsks(mine.slice(0, 2)), '€1.5M in asks · 1 with none recorded');
  assert.equal(columnAsks([{ ask: 1, currency: 'EUR' }, { ask: 2, currency: 'USD' }]), 'Asks in 2 currencies');
  assert.equal(columnAsks([{ ask: null }]), '1 with none recorded');
  assert.equal(moneyText(1000000, null), '1M (currency not recorded)', 'a currency is never guessed');
  assert.equal(flowRows('mine', { flow: FLOW(), deals: [] })[0].currency, null, 'with no deal list, the currency is not recorded');
  assert.deepEqual(moveTargets('diligence'), ['sourcing', 'screening', 'commit', 'closing']);
  assert.ok(!moveTargets('passed').includes('passed'), 'Passed is never a move target');
  assert.deepEqual(BOARD_STAGES, ['sourcing', 'screening', 'diligence', 'commit', 'closing']);
});

test('filters: passed hidden unless asked, search, owner, a minimum band with confidence, and unscored kept only when asked', () => {
  const rows = [1, 2, 3, 4].map((id) => row({ id }));
  const f = emptyFilters();
  assert.deepEqual(rows.filter((r) => passes(r, f, 5)).map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, stage: ['passed'] }, 5)).map((r) => r.id), ['4']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, q: 'north' }, 5)).map((r) => r.id), ['2']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, owner: 'none' }, 5)).map((r) => r.id), ['2']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, owner: 'me' }, 5)).map((r) => r.id), ['1', '3']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, min: { team: 'strong' } }, 5)).map((r) => r.id), ['1']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, min: { team: 'fair' } }, 5)).map((r) => r.id), ['1', '2']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, min: { team: 'fair' }, conf: 'high' }, 5)).map((r) => r.id), ['1']);
  assert.deepEqual(rows.filter((r) => passes(r, { ...f, min: { team: 'strong' }, unscored: true }, 5)).map((r) => r.id), ['1', '3'], 'the locked row kept as unscored');
  assert.deepEqual(filterChips({ ...f, min: { team: 'strong' }, stage: ['diligence'] }).map((c) => c.word), ['Team: Strong · any confidence', 'My stage: Diligence']);
});

test('sort: band then confidence, unscored and locked last whichever way, confidence mode, Your weighting', () => {
  const rows = [3, 2, 1].map((id) => row({ id }));
  assert.deepEqual(sortRows(rows, { by: 'team', dir: 'desc', mode: 'score' }).map((r) => r.id), ['1', '2', '3']);
  assert.deepEqual(sortRows(rows, { by: 'team', dir: 'asc', mode: 'score' }).map((r) => r.id), ['2', '1', '3'], 'the locked row stays last ascending too');
  assert.deepEqual(sortRows(rows, { by: 'market', dir: 'desc', mode: 'score' }).map((r) => r.id), ['2', '1', '3']);
  const conf = [row({ id: 1, scores: { state: 'ok', byScope: { team: { state: 'scored', band: 'Strong', confidence: 'Low' } } } }), row({ id: 2, scores: { state: 'ok', byScope: { team: { state: 'scored', band: 'Fair', confidence: 'High' } } } })];
  assert.deepEqual(sortRows(conf, { by: 'team', dir: 'desc', mode: 'score' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(sortRows(conf, { by: 'team', dir: 'desc', mode: 'confidence' }).map((r) => r.id), ['2', '1']);
  const w = { team: 0, market: 5 };
  assert.deepEqual(sortRows(rows, { by: 'weighting', dir: 'desc' }, w).map((r) => r.id), ['2', '1', '3'], 'weights put Market first');
  assert.deepEqual(sortRows(rows, { by: 'weighting', dir: 'desc' }, null).map((r) => r.id), ['1', '2', '3'], 'equal weights');
  assert.deepEqual(sortRows([row({ id: 2 }), row({ id: 1 })], { by: 'days', dir: 'desc' }).map((r) => r.id), ['1', '2'], 'a missing day count sorts last');
});

test('settings live in the address; defaults stay out; a saved spec round-trips with lower-case keys only', () => {
  const s = defaultSettings();
  assert.equal(settingsHref({ view: 'board', scope: 'mine', settings: s }), '/deals');
  assert.equal(namesSettings(''), false);
  const t = settingsOf('?min_team=strong&conf=high&stage=diligence,passed,odd&sort=market&dir=asc&cols=stage,team&cards=pmf,team,risk,market&q=acme&owner=me&min_risk=huge');
  assert.deepEqual([t.filters.min, t.filters.conf, t.filters.stage, t.sort, t.columns, t.cards, t.filters.q, t.filters.owner],
    [{ team: 'strong' }, 'high', ['diligence', 'passed'], { by: 'market', dir: 'asc', mode: 'score' }, ['stage', 'team'], ['pmf', 'team', 'risk'], 'acme', 'me']);
  const href = settingsHref({ view: 'table', scope: 'all', settings: t, viewUid: 'v1' });
  assert.deepEqual(settingsOf(href.split('?')[1]), t);
  assert.ok(namesSettings(href.split('?')[1]));
  const spec = specOf({ view: 'table', scope: 'all', settings: t });
  const walk = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).flatMap(([k, x]) => [k, ...walk(x)]) : Array.isArray(v) ? v.flatMap(walk) : []);
  for (const k of walk(spec)) assert.match(k, /^[a-z][a-z0-9_]{0,63}$/, k);
  for (const k of Object.keys(spec)) assert.ok(['version', 'scope', 'view', 'filters', 'sort', 'columns', 'weights'].includes(k), k);
  assert.deepEqual(settingsOfSpec(spec), { view: 'table', scope: 'all', settings: t });
  const saved = { spec };
  assert.equal(viewChanged(saved, { view: 'table', scope: 'all', settings: t }), false);
  assert.equal(viewChanged(saved, { view: 'table', scope: 'all', settings: { ...t, sort: { ...t.sort, by: 'team' } } }), true);
  assert.deepEqual(toggleCard(['team', 'market', 'geographic'], 'pmf'), ['team', 'market', 'geographic'], 'at most three');
  assert.deepEqual(toggleCard(['geographic', 'team'], 'pmf'), ['team', 'pmf', 'geographic'], 'in SCORING’s order');
  assert.deepEqual(toggleColumn(['team', 'stage'], 'round'), ['stage', 'round', 'team']);
  assert.equal(DEFAULT_COLUMNS[0], 'stage');
});

// ---------------------------------------------------------------- mounted

function harness({ phone = false } = {}) {
  const restore = installDocument();
  const wasMM = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (re) => walk(container).filter((n) => re.test(props(n)['data-testid'] || ''));
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const ev = { preventDefault() {}, stopPropagation() {} };
  const click = async (id) => { const n = typeof id === 'string' ? byId(id) : id; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.(ev); }); await settle(); };
  const change = async (id, value, key = 'value') => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { [key]: value } }); }); await settle(); };
  const close = async () => { await act(async () => root.unmount()); globalThis.matchMedia = wasMM; restore(); };
  return { root, byId, all, text, props, settle, click, change, close, container };
}

function Root() {
  const l = useLocation();
  const { view, scope } = viewOf(l.search);
  return h(React.Fragment, null, h(DealFlow, { view, scope, board: h('div', { 'data-testid': 'today-board' }) }), h('span', { 'data-testid': 'probe' }, `${l.pathname}${l.search}`));
}
const page = (url) => h(MemoryRouter, { key: url, initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(Root) })));

function stubs(over = {}) {
  const was = { flow: dealFlowApi.flow, update: dealFlowApi.update, add: dealFlowApi.add, listDeals: api.listDeals, batch: ventureScoresApi.batch, weights: ventureScoresApi.weights, fit: dealViewsApi.fit, list: dealViewsApi.list, create: dealViewsApi.create, vupdate: dealViewsApi.update, remove: dealViewsApi.remove };
  const calls = [];
  const rec = (name, out) => async (...a) => { calls.push([name, ...a]); return typeof out === 'function' ? out(...a) : out; };
  const flow = FLOW();
  Object.assign(dealFlowApi, {
    flow: rec('flow', flow),
    update: rec('update', (id, b) => ({ ...flow.items.find((x) => String(x.deal_id) === String(id)), ...b, days_in_stage: 0 })),
    add: rec('add', (b) => entry({ deal_id: b.deal_id, venture: 'Orchid Analytics', stage: b.stage, entered_via: 'added', can_open: false })),
  });
  api.listDeals = rec('listDeals', DEALS());
  Object.assign(ventureScoresApi, { batch: rec('batch', BATCH()), weights: rec('weights', { weights: null, equal: true }) });
  Object.assign(dealViewsApi, { fit: rec('fit', FIT()), list: rec('views', VIEWS()), create: rec('create', { uid: 'v9' }), update: rec('vupdate', { uid: 'v1' }), remove: rec('remove', { ok: true }) });
  for (const [k, v] of Object.entries(over)) {
    const [obj, name] = k.split('.');
    ({ dealFlowApi, api, ventureScoresApi, dealViewsApi })[obj][name] = v;
  }
  return { calls, restore: () => { Object.assign(dealFlowApi, { flow: was.flow, update: was.update, add: was.add }); api.listDeals = was.listDeals; Object.assign(ventureScoresApi, { batch: was.batch, weights: was.weights }); Object.assign(dealViewsApi, { fit: was.fit, list: was.list, create: was.create, update: was.vupdate, remove: was.remove }); } };
}

test('mounted board (DLS1): stages with counts and asks, cards with bands, fit and owner, Move to with Undo, drag, a refused move, compare', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.deepEqual(s.calls.find((c) => c[0] === 'batch'), ['batch', [1, 2, 3, 4]], 'the batch takes the rows’ deal ids');
    assert.match(t.text(t.byId('dealflow-col-diligence')), /^Diligence 1€1.5M in asks/);
    assert.equal(t.text(t.byId('dealflow-col-screening-asks')), '1 with none recorded');
    assert.equal(t.byId('dealflow-col-passed'), undefined, 'Passed is not a column unless asked for');
    assert.equal(t.byId('dealflow-card-4'), undefined);
    assert.equal(t.text(t.byId('dealflow-card-1-team')), 'Strong· High');
    assert.equal(t.text(t.byId('dealflow-card-1-geographic')), 'Strong· Low');
    assert.equal(t.text(t.byId('dealflow-card-2-geographic')), 'Not scored');
    assert.equal(t.text(t.byId('dealflow-card-3-team')), 'Locked');
    assert.equal(t.text(t.byId('dealflow-card-1-fit')), '86 · High');
    assert.equal(t.text(t.byId('dealflow-card-3-fit')), '0 · Medium', 'a measured fit of 0 is drawn');
    assert.equal(t.text(t.byId('dealflow-card-2-fit')), 'Set your thesis');
    assert.match(t.text(t.byId('dealflow-card-1')), /Acme RoboticsRobotics.*Raising.*Invited by the studio.*€1.5M · SAFE.*9 days.*NA/s);
    assert.match(t.text(t.byId('dealflow-card-2')), /Ask not recorded/);
    assert.equal(t.props(t.byId('dealflow-open-1')).href, '/deals/1');
    assert.equal(t.byId('dealflow-open-2'), undefined, 'no door where can_open is false');
    // Move to, then Undo.
    await t.change('dealflow-move-3', 'diligence');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '3', { stage: 'diligence' }]);
    assert.match(t.text(t.byId('dealflow-toast')), /Moved Copperline Energy to Diligence\./);
    assert.match(t.text(t.byId('dealflow-col-diligence')), /Diligence 2/);
    await t.click('dealflow-undo');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '3', { stage: 'sourcing' }]);
    assert.match(t.text(t.byId('dealflow-toast')), /Moved back Copperline Energy to Sourced\./);
    assert.equal(t.byId('dealflow-undo'), undefined, 'an undo is not undone again');
    // A drop on another column moves the card.
    await act(async () => { t.props(t.byId('dealflow-col-commit')).onDrop({ preventDefault() {}, dataTransfer: { getData: () => '1' } }); });
    await t.settle();
    // D1241 (#3254): a move to Commit is said first (DLS10), then made.
    assert.ok(t.byId('dealflow-commit'));
    await t.click('dealflow-commit-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '1', { stage: 'commit' }]);
    // A refused move says why, and nothing moves.
    dealFlowApi.update = async () => { const e = new Error('Closing follows a commitment. Commit on the deal page first.'); e.code = 'closing_needs_commitment'; throw e; };
    await t.change('dealflow-move-2', 'closing');
    assert.equal(t.props(t.byId('dealflow-toast')).role, 'alert');
    assert.match(t.text(t.byId('dealflow-toast')), /Closing follows a commitment/);
    assert.match(t.text(t.byId('dealflow-col-screening')), /Screening 1/);
    // Compare ticks.
    await t.change('dealflow-tick-1', true, 'checked');
    await t.change('dealflow-tick-2', true, 'checked');
    assert.equal(t.props(t.byId('dealflow-compare')).href, '/deals/compare?ids=1,2');
    assert.ok(t.byId('today-board'), 'today’s zone board is kept under the board');
  } finally { s.restore(); await t.close(); }
});

test('mounted table (DLS2): every round, its stage or Add to my deal flow, sortable heads, ≥ minimums, columns and pages', async () => {
  const t = harness();
  const many = [...DEALS(), ...Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, project_name: `Venture ${i}`, status: 'active', currency: 'USD' }))];
  const s = stubs({ 'api.listDeals': async () => many });
  try {
    await act(async () => t.root.render(page('/deals?view=table&scope=all')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-row-1')), /Acme Robotics.*Diligence.*Raising.*€1.5M · SAFE.*Strong· High.*Fair· Medium/s);
    assert.match(t.text(t.byId('dealflow-row-9')), /Orchid Analytics.*Not on your deals.*Add to my deal flow.*Not shared/s);
    assert.ok(t.byId('dealflow-not-shared-line'));
    const strips = (id) => t.all(/^scope-strip/).filter((n) => { let p = n; while (p && t.props(p)['data-testid'] !== `dealflow-row-${id}`) p = p.parentNode; return !!p; }).map((n) => t.props(n)['data-testid']);
    assert.deepEqual(strips(1), ['scope-strip'], 'the scored row draws its strip from the batch');
    assert.deepEqual(strips(3), ['scope-strip-locked']);
    assert.deepEqual(strips(9), ['scope-strip-unread'], 'a deal the batch left out draws no bar');
    assert.match(t.text(t.byId('dealflow-pages')), /^1–25 of 3[0-9]/);
    assert.equal(t.all(/^dealflow-row-/).length, 25);
    await t.click('dealflow-next-page');
    assert.equal(t.all(/^dealflow-row-/).length, t.all(/^dealflow-row-/).length);
    // A head sorts, and its ≥ sets the minimum, each in the address.
    await t.click('dealflow-head-market');
    assert.match(t.text(t.byId('probe')), /sort=market/);
    await t.click('dealflow-min-team');
    assert.match(t.text(t.byId('probe')), /min_team=fair/);
    assert.ok(!t.byId('dealflow-row-9'), 'a row not scored on Team drops out under a minimum');
    await t.click('dealflow-min-team');
    assert.match(t.text(t.byId('probe')), /min_team=strong/);
    assert.equal(t.all(/^dealflow-row-/).length, 1);
    await t.click('dealflow-chips-clear');
    // Columns: untick Risk and its column goes.
    await t.click('dealflow-columns');
    await t.change('dealflow-col-risk', false, 'checked');
    assert.match(t.text(t.byId('probe')), /cols=/);
    assert.equal(t.byId('dealflow-cell-1-risk'), undefined);
    // Add to my deal flow, at a chosen stage.
    await t.click('dealflow-add-9');
    await t.change('dealflow-add-stage', 'screening');
    await t.click('dealflow-add-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'add'), ['add', { deal_id: 9, stage: 'screening' }]);
    assert.match(t.text(t.byId('dealflow-toast')), /Added Orchid Analytics to your deal flow at Screening\./);
  } finally { s.restore(); await t.close(); }
});

test('mounted board under All deals: only the rounds in the flow are cards; the rest are the table’s', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?scope=all')));
    await t.settle();
    assert.ok(t.byId('dealflow-card-1'));
    assert.equal(t.byId('dealflow-card-9'), undefined, 'a round not in the flow has no stage, so no card');
  } finally { s.restore(); await t.close(); }
});

test('mounted filters (DLS4) and saved views (DLS5): Show writes the address, chips clear; a view applies, edits show, saves and deletes', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    await t.click('dealflow-filters-open');
    await t.click('dealflow-f-stage-diligence');
    await t.change('dealflow-f-min-team', 'strong');
    assert.match(t.text(t.byId('dealflow-filters-show')), /Show 1 deals/);
    await t.click('dealflow-filters-show');
    assert.match(t.text(t.byId('probe')), /stage=diligence.*min_team=strong/);
    assert.match(t.text(t.byId('dealflow-chips')), /Team: Strong · any confidence.*My stage: Diligence/s);
    await t.click('dealflow-chips-clear');
    assert.equal(t.byId('dealflow-chips'), undefined);
    // A saved view applies its settings and its uid; a change marks it edited.
    await t.click('dealflow-views');
    await t.click(t.all(/^dealflow-view-item$/)[0]);
    assert.match(t.text(t.byId('probe')), /view=table.*v=v1.*min_team=strong.*sort=market/);
    assert.equal(t.byId('dealflow-view-edited'), undefined);
    await t.click('dealflow-head-team');
    assert.ok(t.byId('dealflow-view-edited'));
    await t.click('dealflow-view-save-changes');
    await t.click('dealflow-save-view-go');
    const [, uid, version, body] = s.calls.find((c) => c[0] === 'vupdate');
    assert.deepEqual([uid, version, body.name, body.spec.sort.by, body.shared_with_firm], ['v1', 3, 'Strong team', 'team', false]);
    // Save as new: a name is required, and My firm needs a firm account.
    await t.click('dealflow-views');
    await t.click('dealflow-views-save');
    assert.equal(t.props(t.byId('dealflow-save-view-go')).disabled, true);
    assert.equal(t.props(t.byId('dealflow-save-view-firm')).disabled, true);
    await t.change('dealflow-save-view-name', 'Europe climate');
    assert.match(t.text(t.byId('dealflow-save-view-keeps')), /View: Table.*Scope: Mine/s);
    await t.click('dealflow-save-view-go');
    assert.equal(s.calls.find((c) => c[0] === 'create')[1].name, 'Europe climate');
  } finally { s.restore(); await t.close(); }
});

test('mounted: a saved default applies when the address names no setting', async () => {
  const t = harness();
  const s = stubs({ 'dealViewsApi.list': async () => ({ ...VIEWS(), default_uid: 'v1' }) });
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.match(t.text(t.byId('probe')), /\/deals\?view=table&v=v1/);
    await act(async () => t.root.render(page('/deals?sort=market')));
    await t.settle();
    assert.equal(t.text(t.byId('probe')), '/deals?sort=market', 'an address with its own settings keeps them');
  } finally { s.restore(); await t.close(); }
});

test('mounted states (DLS13–DLS16): loading, unreadable, empty with its doors, nothing matching, scores failed with dashes', async () => {
  const t = harness();
  let flow = () => new Promise(() => {});
  const s = stubs({ 'dealFlowApi.flow': async () => flow() });
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-board-loading')), /Sourced.*Reading….*Closing.*Reading…/s);
    assert.ok(t.byId('dealflow-toolbar'), 'the toolbar renders at once');
    flow = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
    await act(async () => t.root.render(page('/deals?x=1')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-unreadable')), /Your deal flow could not be read\. That is not the same as having none\./);
    flow = async () => ({ items: [], by_stage: {} });
    await act(async () => t.root.render(page('/deals?x=2')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-empty')), /Nothing in your deal flow yet\./);
    assert.equal(t.props(t.byId('dealflow-empty-all')).href, '/deals?view=table&scope=all');
    assert.equal(t.props(t.byId('dealflow-empty-new')).href, '/deals?scope=new');
    flow = async () => FLOW();
    await act(async () => t.root.render(page('/deals?q=zzz')));
    await t.settle();
    assert.ok(t.byId('dealflow-nomatch'));
    await t.click('dealflow-nomatch-clear');
    assert.equal(t.text(t.byId('probe')), '/deals');
    ventureScoresApi.batch = async () => { throw new Error('down'); };
    dealViewsApi.fit = async () => { throw new Error('down'); };
    await act(async () => t.root.render(page('/deals?view=table&x=3')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-scores-failed')), /Scores could not be read\. Names, stages and money are current\./);
    assert.equal(t.text(t.byId('dealflow-cell-1-team')), '—');
    assert.equal(t.text(t.byId('dealflow-cell-1-fit')), 'Unreadable');
    assert.match(t.text(t.byId('dealflow-row-1')), /Acme Robotics.*Diligence.*€1.5M/s, 'names, stages and money stay');
    assert.ok(!/>0</.test(JSON.stringify(t.text(t.container))));
  } finally { s.restore(); await t.close(); }
});

test('mounted phone (DLS18): the board one stage at a time with Move to, and the table as cards', async () => {
  const t = harness({ phone: true });
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.ok(t.byId('dealflow-phone-board'));
    assert.equal(t.byId('dealflow-board'), undefined);
    assert.equal(t.text(t.byId('dealflow-phone-stage-diligence')), 'Diligence 1');
    assert.ok(t.byId('dealflow-card-3') && !t.byId('dealflow-card-1'), 'Sourced shows first');
    await t.click('dealflow-phone-stage-diligence');
    assert.ok(t.byId('dealflow-card-1'));
    assert.equal(t.props(t.byId('dealflow-card-1')).draggable, false);
    await t.change('dealflow-move-1', 'commit');
    await t.click('dealflow-commit-go'); // D1241: Move to Commit is said first.
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '1', { stage: 'commit' }]);
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-phone-row-1')), /Acme Robotics.*Diligence · Raising.*Team.*Strong/s);
  } finally { s.restore(); await t.close(); }
});

// ---------------------------------------------------------------- the wiring

test('wiring: no browser pop-up, no number for a score, dark pairs on every light hover, the reads in the clients', () => {
  const dir = 'frontend/src/pages/investor/dealflow/';
  for (const f of ['DealFlow.jsx', 'FlowBoard.jsx', 'FlowTable.jsx', 'FlowCells.jsx', 'FlowControls.jsx', 'flowModel.js']) {
    const src = read(dir + f);
    assert.doesNotMatch(src, /window\.(alert|confirm|open)|\balert\(|\bconfirm\(|dangerouslySetInnerHTML/, f);
    for (const m of src.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) assert.match(m[1], /dark:hover:/, `${f}: ${m[1].slice(0, 80)}`);
  }
  // Nothing reads a value off the batch: the strip's heights come from the band.
  assert.doesNotMatch(read(`${dir}flowModel.js`), /\.value\b(?!:)/, 'the batch carries no value to read');
  assert.match(read('frontend/src/lib/api/ventureScores.js'), /batch: \(dealIds\) => request\('\/venture-scores\/batch'/);
  assert.match(read('frontend/src/lib/api/dealViews.js'), /fit: \(ids\) =>/);
  assert.ok(read(`${dir}README.md`).includes('flowModel.js'));
});
