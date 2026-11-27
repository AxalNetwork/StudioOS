/**
 * D4815 DX2 (#5901, board DE02) — Deal flow's table: Venture and My stage stay
 * fixed, the scopes use the shared score, a row opens a quick preview of what
 * the reads carry, the footer pages by number, and the heads carry aria-sort.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_flow_table_5901.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FlowTable } from '../src/pages/investor/dealflow/FlowTable.jsx';
import {
  COLUMNS, DEFAULT_COLUMNS, PREVIEW_NO_CHANGES, flowRows, pageNumbers, previewOf, scoresOf,
} from '../src/pages/investor/dealflow/flowModel.js';

const h = React.createElement;

const entry = (o) => ({
  uid: `u${o.deal_id}`, deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'diligence',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00',
  days_in_stage: 9, ask: 1500000, pass: null, note: 'Ask about churn.', can_open: true, ...o,
});
const FLOW = () => ({ items: [
  entry({ deal_id: 1 }),
  entry({ deal_id: 2, venture: 'Northwind Labs', stage: 'screening', owner: null, days_in_stage: null, entered_at: null, note: null, can_open: false }),
] });
const DEALS = () => [
  { id: 1, project_name: 'Acme Robotics', status: 'active', target_raise: 1500000, currency: 'EUR', instrument: 'SAFE' },
  { id: 2, project_name: 'Northwind Labs', status: 'active', currency: 'EUR' },
  { id: 9, project_name: 'Orchid Analytics', status: 'active', currency: 'EUR' },
];
const BATCH = { items: [{ deal_id: 1, locked: false, scopes: [{ scope: 'team', state: 'scored', band: 'Strong', confidence_word: 'High' }, { scope: 'technical', state: 'not_enough' }] }] };
const rowsOf = () => flowRows('all', { flow: FLOW(), deals: DEALS() }).map((r) => ({ ...r, scores: scoresOf(BATCH, r.id), fit: null }));

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (re) => walk(container).filter((n) => re.test(props(n)['data-testid'] || ''));
  const tags = (tag) => walk(container).filter((n) => n.tagName === tag);
  const click = async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { root, byId, all, tags, text, props, click, close };
}

function Table(over = {}) {
  const [page, setPage] = React.useState(over.page || 1);
  const [sort, setSort] = React.useState(over.sort || { by: 'team', dir: 'desc', mode: 'score' });
  return h(FlowTable, {
    rows: over.rows || rowsOf(), columns: over.columns || [...DEFAULT_COLUMNS], sort, onSort: setSort,
    filters: { min: {} }, onMin() {}, picked: [], onPick() {}, onAdd: over.onAdd || (() => {}), page, onPage: setPage,
    words: true, onWords() {}, onPeek: over.onPeek || null,
  });
}
const mount = async (t, over) => act(async () => t.root.render(h(MemoryRouter, null, h(Table, over))));

// ---------------------------------------------------------------- the model

test('pageNumbers: every page up to seven, else first, last and the current one with its neighbours', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageNumbers(1, 12), [1, 2, '…', 12]);
  assert.deepEqual(pageNumbers(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(pageNumbers(12, 12), [1, '…', 11, 12]);
  assert.deepEqual(pageNumbers(3, 12), [1, 2, 3, 4, '…', 12], 'no gap where the pages touch');
});

test('previewOf: only what the reads carry, and what changed is said to be not recorded', () => {
  const [acme, northwind, orchid] = ['1', '2', '9'].map((id) => rowsOf().find((r) => r.id === id));
  const by = (row) => Object.fromEntries(previewOf(row).map((l) => [l.label, l]));
  assert.equal(by(acme)['My stage'].text, 'Diligence · 9 days in this stage');
  assert.equal(by(acme).Owner.text, 'Nadia Ahmed');
  assert.equal(by(acme)['Entered via'].text, 'Invited by the studio · 2 Oct');
  assert.equal(by(acme)['Your note'].text, 'Ask about churn.');
  assert.equal(by(northwind)['My stage'].text, 'Screening · the stage’s start is not recorded');
  assert.equal(by(northwind).Owner.text, 'Unassigned');
  assert.equal(by(northwind).Owner.muted, true);
  assert.equal(by(northwind)['Your note'], undefined, 'no note line where none is written');
  assert.match(by(orchid)['My stage'].text, /^Not on your deals/);
  assert.equal(by(orchid).Owner, undefined, 'a round not on the deals has no owner line');
  for (const r of [acme, northwind, orchid]) {
    assert.equal(by(r)['What changed'].text, PREVIEW_NO_CHANGES);
    assert.ok(!previewOf(r).some((l) => /\b0\b/.test(l.text)), 'nothing is drawn as 0');
  }
  assert.equal(COLUMNS.find((c) => c.id === 'entered').label, 'Entered via');
});

// ---------------------------------------------------------------- mounted

test('Venture and My stage are the fixed columns; the rest scroll in the canvas order', async () => {
  const t = harness();
  try {
    await mount(t);
    const heads = t.tags('TH');
    const sticky = heads.filter((n) => /\bsticky\b/.test(t.props(n).className || ''));
    assert.deepEqual(sticky.map((n) => t.text(n).trim()), ['Compare', 'Venture', 'My stage']);
    assert.match(t.props(sticky[2]).className, /left-\[232px\]/, 'My stage sits after the tick (32px) and Venture (200px)');
    const scrolling = heads.filter((n) => !sticky.includes(n)).map((n) => t.text(n).replace(/[≥↑↓]/g, '').trim());
    assert.deepEqual(scrolling.slice(0, 3), ['Round', 'Ask', 'Scorecard']);
    assert.deepEqual(scrolling.slice(-4), ['Fit to my thesis', 'Days in stage', 'Owner', 'Entered via']);
    assert.equal(scrolling.length, 3 + 11 + 4, 'the eleven scopes sit between');
    // The stage cell in each row is fixed too, and a round not on the deals still offers Add.
    assert.match(t.props(t.byId('dealflow-cell-1-stage')).className, /sticky/);
    assert.match(t.text(t.byId('dealflow-cell-1-stage')), /Diligence/);
    assert.match(t.text(t.byId('dealflow-cell-9-stage')), /Not on your deals.*Add to my deal flow/);
    // A hidden My stage leaves only Venture fixed.
    await mount(t, { columns: DEFAULT_COLUMNS.filter((c) => c !== 'stage') });
    assert.equal(t.byId('dealflow-head-stage'), undefined);
    assert.equal(t.byId('dealflow-cell-1-stage'), undefined);
  } finally { await t.close(); }
});

test('the scope cells are the shared score: a band and confidence, a missing one a word, never 0', async () => {
  const t = harness();
  try {
    await mount(t);
    const team = t.byId('dealflow-cell-1-team');
    assert.equal(t.props(team)['data-family'], 'value');
    assert.equal(t.props(team)['aria-label'], 'Team: Strong, high confidence');
    assert.equal(t.props(t.byId('dealflow-cell-1-technical'))['data-family'], 'not_recorded');
    for (const n of t.all(/^dealflow-cell-\d+-(team|market|technical)$/)) assert.doesNotMatch(t.text(n), /^0$/);
  } finally { await t.close(); }
});

test('a row opens its quick preview under it, one at a time, with the way into the deal', async () => {
  const t = harness();
  const peeks = [];
  try {
    await mount(t, { onPeek: (r) => peeks.push(r.id) });
    assert.equal(t.all(/^dealflow-preview-\d+$/).length, 0, 'closed until asked');
    const toggle = t.byId('dealflow-preview-toggle-1');
    assert.equal(t.props(toggle)['aria-expanded'], false);
    await t.click('dealflow-preview-toggle-1');
    assert.equal(t.props(t.byId('dealflow-preview-toggle-1'))['aria-expanded'], true);
    assert.equal(t.props(t.byId('dealflow-preview-toggle-1'))['aria-controls'], 'dealflow-preview-cell-1');
    const p = t.byId('dealflow-preview-1');
    assert.match(t.text(p), /Diligence · 9 days in this stage.*Nadia Ahmed.*Invited by the studio · 2 Oct.*Ask about churn\..*Not recorded yet/s);
    assert.equal(t.byId('dealflow-preview-open-1').getAttribute?.('href') ?? t.props(t.byId('dealflow-preview-open-1')).href, '/deals/1', 'Open deal goes to the deal');
    // It spans the whole row: tick, Venture, My stage and every other column.
    const td = t.tags('TD').find((n) => t.props(n).id === 'dealflow-preview-cell-1');
    assert.equal(t.props(td).colSpan, 3 + DEFAULT_COLUMNS.length - 1);
    // Another row's preview replaces it; a deal that cannot open says why instead of linking.
    await t.click('dealflow-preview-toggle-2');
    assert.equal(t.byId('dealflow-preview-1'), undefined);
    assert.ok(t.byId('dealflow-preview-2'));
    assert.equal(t.byId('dealflow-preview-open-2'), undefined);
    assert.match(t.text(t.byId('dealflow-preview-closed-2')), /Opens once you are invited or commit\./);
    // Details opens the peek for that row.
    const details = t.all(/.*/).find((n) => n.tagName === 'BUTTON' && t.text(n) === 'Details' && (() => { let x = n; while (x && t.props(x)['data-testid'] !== 'dealflow-preview-2') x = x.parentNode; return !!x; })());
    await act(async () => { t.props(details).onClick(); });
    assert.deepEqual(peeks, ['2']);
    // Hide closes it.
    await t.click('dealflow-preview-toggle-2');
    assert.equal(t.all(/^dealflow-preview-\d+$/).length, 0);
  } finally { await t.close(); }
});

test('the footer pages by number, marks the current page, and a new page closes the preview', async () => {
  const t = harness();
  const many = Array.from({ length: 80 }, (_, i) => ({ id: String(100 + i), name: `Venture ${i}`, round: 'Raising', inFlow: false, stage: null, scores: { state: 'ok', byScope: {} }, fit: null, canOpen: false }));
  try {
    await mount(t, { rows: many });
    assert.match(t.text(t.byId('dealflow-pages')), /^1–25 of 80$/);
    assert.deepEqual(t.all(/^dealflow-page-\d+$/).map((n) => t.text(n)), ['1', '2', '3', '4']);
    assert.equal(t.props(t.byId('dealflow-page-1'))['aria-current'], 'page');
    assert.equal(t.props(t.byId('dealflow-prev-page')).disabled, true);
    await t.click('dealflow-preview-toggle-100');
    assert.ok(t.byId('dealflow-preview-100'));
    await t.click('dealflow-page-3');
    assert.match(t.text(t.byId('dealflow-pages')), /^51–75 of 80$/);
    assert.equal(t.props(t.byId('dealflow-page-3'))['aria-current'], 'page');
    assert.equal(t.props(t.byId('dealflow-page-1'))['aria-current'], undefined);
    assert.equal(t.all(/^dealflow-preview-\d+$/).length, 0, 'the preview closed with the page');
    await t.click('dealflow-page-1');
    assert.equal(t.byId('dealflow-preview-100'), undefined, 'and stays closed when its page comes back');
    await t.click('dealflow-page-3');
    await t.click('dealflow-next-page');
    assert.match(t.text(t.byId('dealflow-pages')), /^76–80 of 80$/);
    assert.equal(t.props(t.byId('dealflow-next-page')).disabled, true);
    // One page: no numbers at all.
    await mount(t, { rows: many.slice(0, 3) });
    assert.equal(t.all(/^dealflow-page-\d+$/).length, 0);
  } finally { await t.close(); }
});

test('every sorted head says so: aria-sort on the scope, the fit and Venture', async () => {
  const t = harness();
  try {
    await mount(t);
    const th = (id) => { let n = t.byId(`dealflow-head-${id}`); while (n && n.tagName !== 'TH') n = n.parentNode; return n; };
    assert.equal(t.props(th('team'))['aria-sort'], 'descending');
    assert.equal(t.props(th('name'))['aria-sort'], undefined);
    await t.click('dealflow-preview-toggle-1');
    assert.ok(t.byId('dealflow-preview-1'));
    await t.click('dealflow-head-name');
    assert.equal(t.byId('dealflow-preview-1'), undefined, 'a new order closes the preview');
    assert.equal(t.props(th('name'))['aria-sort'], 'ascending');
    assert.match(t.text(t.byId('dealflow-head-name')), /Venture ↑/);
    assert.equal(t.props(th('team'))['aria-sort'], undefined, 'only one head is sorted');
    await t.click('dealflow-head-name');
    assert.equal(t.props(th('name'))['aria-sort'], 'descending');
    await t.click('dealflow-head-fit');
    assert.equal(t.props(th('fit'))['aria-sort'], 'descending');
  } finally { await t.close(); }
});
