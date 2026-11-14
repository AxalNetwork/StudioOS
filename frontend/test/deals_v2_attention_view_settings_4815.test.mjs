/**
 * D4815 part 3 (#5899, canvas DX1, board DE01) — /deals: the Needs your
 * attention strip above the board or table, and View settings holding Sort,
 * Columns, Card scopes and the saved views.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_attention_view_settings_4815.test.mjs
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
import { attentionOf } from '../src/pages/investor/dealflow/flowModel.js';
import { unreadSources } from '../src/pages/investor/dealflow/movesModel.js';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';

const h = React.createElement;
const src = (p) => readFileSync(new URL(`../src/pages/investor/dealflow/${p}`, import.meta.url), 'utf8');

const INBOX = () => ({
  items: [
    { key: 'invitation:1', source: 'invitation', deal_id: 7, venture: 'Harbor AI' },
    { key: 'room:7', source: 'room', deal_id: 7, venture: 'Harbor AI' },
    { key: 'syndicate:3', source: 'syndicate', deal_id: 8, venture: 'Quayside Pay' },
  ],
  sources: { invitation: { available: true }, room: { available: true }, syndicate: { available: true } },
});

// ---------------------------------------------------------------- the model

test('the strip draws only "new", counted in deals from the inbox; stale and waiting on diligence have no field and are left out', () => {
  const a = attentionOf({ kind: 'ok', data: INBOX() }, unreadSources);
  assert.equal(a.kind, 'ok');
  assert.deepEqual(a.items.map((i) => [i.key, i.word, i.label]), [['new', '2 new', '2 deals new for you']], 'two items for one deal count once');
  assert.ok(!a.items.some((i) => /stale|diligence/i.test(i.word)), 'no invented item');
  assert.deepEqual(attentionOf({ kind: 'ok', data: { items: [{ deal_id: 1 }] } }).items[0].label, '1 deal new for you');
  assert.deepEqual(attentionOf({ kind: 'ok', data: { items: [], sources: {} } }, unreadSources), { kind: 'ok', items: [], unread: [] });
});

test('a failed read is unreadable with no count; a way in that failed is named, never folded into 0', () => {
  for (const r of [{ kind: 'unreadable' }, { kind: 'failed' }]) {
    const a = attentionOf(r, unreadSources);
    assert.equal(a.kind, 'unreadable');
    assert.deepEqual(a.items, []);
  }
  assert.equal(attentionOf(null).kind, 'loading');
  assert.equal(attentionOf({ kind: 'loading' }).kind, 'loading');
  const partial = attentionOf({ kind: 'ok', data: { items: [], sources: { invitation: { available: false, unreadable: true } } } }, unreadSources);
  assert.equal(partial.items.length, 0);
  assert.equal(partial.unread.length, 1, 'the source that failed is named');
});

// ---------------------------------------------------------------- mounted

function harness() {
  const restore = installDocument();
  const wasMM = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  const ev = { preventDefault() {}, stopPropagation() {} };
  const click = async (id) => { const n = typeof id === 'string' ? byId(id) : id; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.(ev); }); await settle(); };
  const change = async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); };
  const within = (id, re) => walk(byId(id) || { childNodes: [] }).filter((n) => re.test(props(n)['data-testid'] || ''));
  const close = async () => { await act(async () => root.unmount()); globalThis.matchMedia = wasMM; restore(); };
  return { root, byId, text, props, settle, click, change, within, close };
}

function Root() {
  const l = useLocation();
  const { view, scope } = viewOf(l.search);
  return h(React.Fragment, null, h(DealFlow, { view, scope }), h('span', { 'data-testid': 'probe' }, `${l.pathname}${l.search}`));
}
const page = (url) => h(MemoryRouter, { key: url, initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(Root) })));

function stubs(inbox) {
  const was = { flow: dealFlowApi.flow, inbox: dealFlowApi.inbox, listDeals: api.listDeals, batch: ventureScoresApi.batch, weights: ventureScoresApi.weights, fit: dealViewsApi.fit, list: dealViewsApi.list, screening: api.dealScreening, commitRoom: api.icCommitRoom };
  const calls = [];
  dealFlowApi.flow = async () => ({ scope: 'you', by_stage: {}, items: [{ uid: 'u1', deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'diligence', owner: null, entered_via: 'invited', days_in_stage: 3, ask: 1000000, can_open: true }] });
  dealFlowApi.inbox = async () => { calls.push('inbox'); return inbox(calls.length); };
  api.listDeals = async () => [{ id: 1, project_name: 'Acme Robotics', status: 'active', currency: 'EUR' }];
  api.dealScreening = async () => ({ desk: { available: true, rows: [] } });
  api.icCommitRoom = async () => ({ decisions: { available: true, rows: [] } });
  ventureScoresApi.batch = async () => ({ items: [] });
  ventureScoresApi.weights = async () => ({ weights: null });
  dealViewsApi.fit = async () => ({ items: [] });
  dealViewsApi.list = async () => ({ items: [{ uid: 'v1', name: 'Strong team', mine: true, version: 1, spec: { version: 1, view: 'table', scope: 'mine' } }], default_uid: null });
  return {
    calls,
    restore: () => {
      Object.assign(dealFlowApi, { flow: was.flow, inbox: was.inbox });
      Object.assign(api, { listDeals: was.listDeals, dealScreening: was.screening, icCommitRoom: was.commitRoom });
      Object.assign(ventureScoresApi, { batch: was.batch, weights: was.weights });
      Object.assign(dealViewsApi, { fit: was.fit, list: was.list });
    },
  };
}

test('mounted: the strip sits above the board, says "2 new" and links to New for you', async () => {
  const t = harness();
  const s = stubs(() => INBOX());
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    const strip = t.byId('dealflow-attention');
    assert.ok(strip);
    assert.match(t.text(strip), /^Needs your attention2 new$/);
    assert.equal(t.props(t.byId('dealflow-attention-new')).href, '/deals?scope=new');
    assert.ok(t.byId('dealflow-card-1'), 'the board is drawn under it');
  } finally { s.restore(); await t.close(); }
});

test('mounted: a failed strip read is Unreadable with Try again for the strip alone, never 0; Try again re-reads', async () => {
  const t = harness();
  const s = stubs((n) => { if (n === 1) throw new Error('down'); return INBOX(); });
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    const strip = t.text(t.byId('dealflow-attention'));
    assert.match(strip, /^Needs your attentionUnreadableWhat needs your attention could not be read\. That is not the same as nothing needing it\.Try again$/);
    assert.doesNotMatch(strip, /\b0\b/, 'never 0');
    assert.ok(t.byId('dealflow-table') || t.byId('dealflow-card-1') || t.byId('dealflow-row-1'), 'the deals still show');
    assert.equal(t.byId('dealflow-unreadable'), undefined, 'the flow itself is not marked unreadable');
    assert.ok(t.within('dealflow-attention', /^dealflow-attention-retry$/).length, 'Try again is in the strip');
    await t.click('dealflow-attention-retry');
    assert.equal(s.calls.length, 2);
    assert.match(t.text(t.byId('dealflow-attention')), /2 new/);
  } finally { s.restore(); await t.close(); }
});

test('mounted: nothing new reads as such; New for you itself draws no strip', async () => {
  const t = harness();
  const s = stubs(() => ({ items: [], sources: {} }));
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.equal(t.text(t.byId('dealflow-attention-none')), 'Nothing new for you.');
    await act(async () => t.root.render(page('/deals?scope=new')));
    await t.settle();
    assert.equal(t.byId('dealflow-attention'), undefined);
  } finally { s.restore(); await t.close(); }
});

test('mounted: Sort, Card scopes and saved views live under View settings, and each change is the address', async () => {
  const t = harness();
  const s = stubs(() => INBOX());
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    for (const id of ['dealflow-sort-by', 'dealflow-card-team', 'dealflow-views', 'dealflow-col-risk']) assert.equal(t.byId(id), undefined, `${id} is not on the toolbar`);
    await t.click('dealflow-view-settings');
    const panel = 'dealflow-view-settings-panel';
    assert.ok(t.within(panel, /^dealflow-sort-by$/).length && t.within(panel, /^dealflow-card-team$/).length && t.within(panel, /^dealflow-views-save$/).length);
    assert.equal(t.within(panel, /^dealflow-col-risk$/).length, 0, 'Columns belong to the table');
    await t.change('dealflow-sort-by', 'fit');
    assert.match(t.text(t.byId('probe')), /sort=fit/);
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    await t.click('dealflow-view-settings');
    assert.ok(t.within(panel, /^dealflow-col-risk$/).length, 'the table shows Columns');
    await t.click(t.within(panel, /^dealflow-view-item$/)[0]);
    assert.match(t.text(t.byId('probe')), /v=v1/);
    assert.match(t.text(t.byId('dealflow-view-settings')), /View settings · Strong team/);
  } finally { s.restore(); await t.close(); }
});

test('one primary in the header; toolbar, strip and View settings targets are 44px below md', () => {
  const page = src('DealFlow.jsx');
  const controls = src('FlowControls.jsx');
  assert.equal((page.match(/<ZonePrimary /g) || []).length, 1, 'Set your thesis, only while the flow is empty');
  assert.match(controls, /export const TAP = 'min-h-\[44px\] md:min-h-0'/);
  assert.match(controls, /testId="dealflow-view-settings" wide align="right" tap/);
  assert.match(page, /data-testid=\{`dealflow-attention-\$\{i\.key\}`\}/);
  assert.match(page, /\$\{TAP\}`\} data-testid=\{`dealflow-attention-/);
  assert.match(page, /\$\{TOOL\} \$\{TAP\}`\} onClick=\{\(\) => setDialog\(\{ kind: 'filters' \}\)\}/);
});
