/**
 * D6145 (#6145) — a deal's owner set from the page: the peek's Owner picker
 * (Me, a colleague, Unassigned), "Assign to me" on the board's card and the
 * table's row, Unreadable with Try again when the owners cannot be read, and
 * a refusal that leaves the row as it was in the Worker's words. Every read
 * is a stub: no test reaches the Worker.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_owner_6145.test.mjs
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
import { assignable, meOf, ownerOptions } from '../src/pages/investor/dealflow/OwnerControls.jsx';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;

// ---------------------------------------------------------------- fixtures, in the Worker's shapes

const entry = (o) => ({
  uid: `u${o.deal_id}`, deal_id: 1, venture: 'Acme Robotics', sector: 'Robotics', round_status: 'active', stage: 'diligence',
  owner: { user_id: 5, name: 'Nadia Ahmed' }, entered_via: 'invited', entered_at: '2026-10-02 10:00:00', stage_changed_at: '2026-10-20',
  days_in_stage: 9, ask: 1500000, pass: null, note: null, can_open: true, ...o,
});
const FLOW = () => ({ scope: 'firm', by_stage: {}, items: [
  entry({ deal_id: 1 }),
  entry({ deal_id: 2, venture: 'Northwind Labs', stage: 'screening', owner: null }),
  entry({ deal_id: 3, venture: 'Copperline Energy', stage: 'sourcing', owner: { user_id: 1, name: 'Ivy Park' } }),
] });
const DEALS = () => [
  { id: 1, project_name: 'Acme Robotics', status: 'active', currency: 'EUR' },
  { id: 2, project_name: 'Northwind Labs', status: 'active', currency: 'EUR' },
  { id: 3, project_name: 'Copperline Energy', status: 'active', currency: 'EUR' },
  { id: 9, project_name: 'Orchid Analytics', status: 'active', currency: 'EUR' },
];
const FIRM = () => ({ scope: 'firm', can_unassign: true, owners: [{ user_id: 1, name: 'Ivy Park', you: true }, { user_id: 5, name: 'Nadia Ahmed', you: false }, { user_id: 6, name: 'Omar Diaz', you: false }] });
const SOLO = () => ({ scope: 'you', can_unassign: false, owners: [{ user_id: 1, name: 'Ivy Park', you: true }] });
const NAMES = { 1: 'Ivy Park', 5: 'Nadia Ahmed', 6: 'Omar Diaz' };

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
  const all = (re) => walk(container).filter((n) => re.test(props(n)['data-testid'] || ''));
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  const ev = { preventDefault() {}, stopPropagation() {} };
  const click = async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.(ev); }); await settle(); };
  const change = async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value } }); }); await settle(); };
  const close = async () => { await act(async () => root.unmount()); globalThis.matchMedia = wasMM; restore(); };
  return { root, byId, all, text, props, settle, click, change, close };
}

function Root() {
  const l = useLocation();
  const { view, scope } = viewOf(l.search);
  return h(DealFlow, { view, scope });
}
const page = (url) => h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: '*', element: h(Root) })));

/** Stubs the page's reads. `owners` and `update` may be replaced per test; `update` answers like the Worker's PATCH. */
function stubs({ owners = async () => FIRM(), update = null } = {}) {
  const names = ['flow', 'update', 'owners', 'inbox'];
  const was = { ...Object.fromEntries(names.map((n) => [n, dealFlowApi[n]])), listDeals: api.listDeals, screening: api.dealScreening, commitRoom: api.icCommitRoom,
    batch: ventureScoresApi.batch, weights: ventureScoresApi.weights, fit: dealViewsApi.fit, list: dealViewsApi.list };
  const calls = [];
  const rec = (name, fn) => async (...a) => { calls.push([name, ...a]); return fn(...a); };
  const flow = FLOW();
  const patch = async (id, b) => {
    const row = flow.items.find((x) => String(x.deal_id) === String(id));
    const owner = b.owner_user_id == null ? null : { user_id: b.owner_user_id, name: NAMES[b.owner_user_id] };
    Object.assign(row, { owner });
    return { ...row };
  };
  Object.assign(dealFlowApi, {
    flow: rec('flow', async () => flow), update: rec('update', update || patch), owners: rec('owners', owners),
    inbox: rec('inbox', async () => ({ items: [], sources: {} })),
  });
  api.listDeals = rec('listDeals', async () => DEALS());
  api.dealScreening = async () => ({ desk: { available: true, rows: [] } });
  api.icCommitRoom = async () => ({ decisions: { available: true, rows: [] } });
  Object.assign(ventureScoresApi, { batch: async () => ({ items: [] }), weights: async () => ({ weights: null, equal: true }) });
  Object.assign(dealViewsApi, { fit: async () => ({ items: [] }), list: async () => ({ items: [], default_uid: null }) });
  return { calls, of: (n) => calls.filter((c) => c[0] === n), restore: () => {
    for (const n of names) dealFlowApi[n] = was[n];
    api.listDeals = was.listDeals; api.dealScreening = was.screening; api.icCommitRoom = was.commitRoom;
    Object.assign(ventureScoresApi, { batch: was.batch, weights: was.weights });
    Object.assign(dealViewsApi, { fit: was.fit, list: was.list });
  } };
}
const optionValues = (t, id) => (t.byId(id)?.childNodes || []).map((o) => [t.props(o).value, t.text(o), !!t.props(o).disabled]);

// ---------------------------------------------------------------- the rules, pure

test('the picker offers Me first, then colleagues, then Unassigned only where the Worker allows it; a removed seat stays named', () => {
  // Mutation checked: Unassigned offered without can_unassign → the solo list grows; the removed owner dropped → it is misnamed.
  const row = { inFlow: true, owner: { id: 9, name: 'Lee Gone' } };
  assert.deepEqual(ownerOptions(FIRM(), row).map((o) => [o.value, o.label, !!o.disabled]), [
    ['1', 'Me · Ivy Park', false], ['5', 'Nadia Ahmed', false], ['6', 'Omar Diaz', false], ['9', 'Lee Gone (not in your firm now)', true], ['', 'Unassigned', false]]);
  assert.deepEqual(ownerOptions(SOLO(), { inFlow: true, owner: { id: 1 } }).map((o) => o.value), ['1']);
  assert.equal(meOf({ kind: 'ok', data: FIRM() }), 1);
  assert.equal(meOf({ kind: 'unreadable', data: null }), null, 'no investor known while the owners are unreadable');
  assert.equal(assignable({ inFlow: true, owner: null }, 1), true);
  assert.equal(assignable({ inFlow: true, owner: { id: 1 } }, 1), false, 'already theirs');
  assert.equal(assignable({ inFlow: false, owner: null }, 1), false, 'not in the flow');
  assert.equal(assignable({ inFlow: true, owner: null }, null), false, 'no investor known');
});

// ---------------------------------------------------------------- mounted

test('the peek: a colleague, then Unassigned; the table follows without a reload, with Undo', async () => {
  // Mutation checked: replaceEntry skipped after the change → the table row never offers Assign to me; null sent as the caller's id → the call reads 1.
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    await t.click('dealflow-peek-1');
    const picker = t.byId('dealflow-peek-owner');
    assert.equal(picker.tagName, 'SELECT');
    assert.equal(t.props(picker).value, '5');
    assert.match(t.props(picker).className, /max-sm:min-h-\[44px\]/, 'a phone target is 44px');
    assert.deepEqual(optionValues(t, 'dealflow-peek-owner').map((o) => o[1]), ['Me · Ivy Park', 'Nadia Ahmed', 'Omar Diaz', 'Unassigned']);
    await t.change('dealflow-peek-owner', '6');
    assert.deepEqual(s.of('update').at(-1), ['update', '1', { owner_user_id: 6 }]);
    assert.match(t.text(t.byId('dealflow-toast')), /Omar Diaz owns Acme Robotics now\./);
    assert.equal(t.props(t.byId('dealflow-peek-owner')).value, '6');
    await t.change('dealflow-peek-owner', '');
    assert.deepEqual(s.of('update').at(-1), ['update', '1', { owner_user_id: null }]);
    assert.match(t.text(t.byId('dealflow-toast')), /Acme Robotics is unassigned\./);
    assert.equal(t.props(t.byId('dealflow-peek-owner')).value, '');
    assert.ok(t.byId('dealflow-cell-1-assign'), 'the table row now offers Assign to me');
    await t.click('dealflow-undo');
    assert.deepEqual(s.of('update').at(-1), ['update', '1', { owner_user_id: 6 }], 'Undo gives it back to the owner before');
    assert.equal(t.byId('dealflow-undo') == null, true, 'an undo is not itself undone');
    assert.equal(s.of('flow').length, 1, 'no reload: the flow was read once');
  } finally { s.restore(); await t.close(); }
});

test('a refused change leaves the row as it was and says why in the Worker\'s words', async () => {
  // Mutation checked: the picker swallows the refusal → no alert; the row replaced before the answer → the select reads 6.
  const t = harness();
  const s = stubs({ update: async () => { const e = new Error('Choose someone from your firm.'); e.code = 'invalid_owner'; throw e; } });
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    await t.click('dealflow-peek-1');
    await t.change('dealflow-peek-owner', '6');
    assert.equal(s.of('update').length, 1);
    assert.equal(t.text(t.byId('dealflow-peek-owner-error')), 'Choose someone from your firm.');
    assert.equal(t.props(t.byId('dealflow-peek-owner')).value, '5', 'the row keeps Nadia');
    assert.equal(t.byId('dealflow-cell-1-assign') != null, true, 'and the table row is unchanged');
  } finally { s.restore(); await t.close(); }
  // The board's shortcut: refused in a toast, and the card keeps its owner.
  const u = harness();
  const s2 = stubs({ update: async () => { throw new Error('Return to HQ to make this change.'); } });
  try {
    await act(async () => u.root.render(page('/deals')));
    await u.settle();
    await u.click('dealflow-card-2-assign');
    assert.equal(u.text(u.byId('dealflow-toast')).startsWith('Return to HQ to make this change.'), true);
    assert.ok(u.byId('dealflow-card-2-flag-unassigned'), 'the card is still Unassigned');
  } finally { s2.restore(); await u.close(); }
});

test('an owners list that cannot be read says Unreadable with Try again, never an empty picker, and no shortcut is offered', async () => {
  // Mutation checked: the unreadable branch drawn as the picker → a SELECT with no options; Try again not wired → owners read once.
  const t = harness();
  let fail = true;
  const s = stubs({ owners: async () => { if (fail) throw new Error('offline'); return FIRM(); } });
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    assert.equal(t.all(/-assign$/).length, 0, 'no Assign to me while the investor is not known');
    await t.click('dealflow-peek-1');
    assert.notEqual(t.byId('dealflow-peek-owner').tagName, 'SELECT');
    assert.match(t.text(t.byId('dealflow-peek-owner')), /Nadia Ahmed/, 'the current owner is still said');
    assert.match(t.text(t.byId('dealflow-peek-owner-unreadable')), /could not be read\. That is not the same as no one\./);
    fail = false;
    await t.click('dealflow-peek-owner-retry');
    assert.equal(s.of('owners').length, 2);
    assert.equal(t.byId('dealflow-peek-owner').tagName, 'SELECT');
    assert.ok(t.byId('dealflow-cell-2-assign'), 'the shortcut comes with the read');
  } finally { s.restore(); await t.close(); }
});

test('Assign to me on the board\'s card and the table\'s row: only on rows in the flow that are not already the investor\'s, 44px on a phone, and the Unassigned filter follows', async () => {
  // Mutation checked: assignable ignores the current owner → deal 3 offers it; ignores inFlow → deal 9 offers it.
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    assert.deepEqual(t.all(/^dealflow-card-\d+-assign$/).map((n) => t.props(n)['data-testid']).sort(), ['dealflow-card-1-assign', 'dealflow-card-2-assign']);
    assert.match(t.props(t.byId('dealflow-card-2-assign')).className, /max-sm:min-h-\[44px\]/);
    await t.click('dealflow-card-2-assign');
    assert.deepEqual(s.of('update').at(-1), ['update', '2', { owner_user_id: 1 }]);
    assert.match(t.text(t.byId('dealflow-toast')), /You own Northwind Labs now\./);
    assert.equal(t.byId('dealflow-card-2-assign') == null, true, 'it is theirs now');
    assert.equal(t.byId('dealflow-card-2-flag-unassigned') == null, true, 'and no longer Unassigned');
  } finally { s.restore(); await t.close(); }
  const u = harness();
  const s2 = stubs();
  try {
    await act(async () => u.root.render(page('/deals?view=table&scope=all')));
    await u.settle();
    assert.ok(u.byId('dealflow-row-9'), 'a round not in the flow is listed');
    assert.deepEqual(u.all(/^dealflow-cell-\d+-assign$/).map((n) => u.props(n)['data-testid']).sort(), ['dealflow-cell-1-assign', 'dealflow-cell-2-assign']);
  } finally { s2.restore(); await u.close(); }
  // The Unassigned filter follows the change at once.
  const v = harness();
  const s3 = stubs();
  try {
    await act(async () => v.root.render(page('/deals?view=table&owner=none')));
    await v.settle();
    assert.ok(v.byId('dealflow-row-2'), 'the unassigned row matches the filter');
    assert.equal(v.byId('dealflow-row-1') == null, true, 'Nadia\'s row does not');
    await v.click('dealflow-cell-2-assign');
    assert.equal(v.byId('dealflow-row-2') == null, true, 'assigned, it leaves the Unassigned filter');
    assert.ok(v.byId('dealflow-nomatch'));
    assert.equal(s3.of('flow').length, 1, 'no reload');
  } finally { s3.restore(); await v.close(); }
});

test('with no firm: no picker and no shortcut, only the investor', async () => {
  // Mutation checked: the shortcut not gated on the firm → deal 1 offers it; the picker drawn for scope "you" → a SELECT.
  const t = harness();
  const s = stubs({ owners: async () => SOLO() });
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    assert.equal(t.all(/-assign$/).length, 0);
    await t.click('dealflow-peek-3');
    assert.notEqual(t.byId('dealflow-peek-owner').tagName, 'SELECT');
    assert.equal(t.text(t.byId('dealflow-peek-owner')), 'Ivy Park');
  } finally { s.restore(); await t.close(); }
});

test('wiring: the client names the Worker route, the decision file cites its issue, and no email is drawn', () => {
  assert.match(read('frontend/src/lib/api/dealFlow.js'), /owners: \(\) => request\('\/deals\/flow\/owners'\)/);
  assert.match(read('cloudflare-worker/src/routes/deal_flow.ts'), /routes\.get\('\/owners'/);
  assert.match(read('documentation/architecture/decisions/D6145.md'), /^## D6145 — .+ \(#6145\)$/m);
  const src = read('frontend/src/pages/investor/dealflow/OwnerControls.jsx');
  assert.doesNotMatch(src, /\bemail\b/, 'no email is drawn');
});
