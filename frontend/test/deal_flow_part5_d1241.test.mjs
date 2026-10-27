/**
 * D1241 (#3254, part 5 of #2423) — Deal flow DLS6–DLS10: New for you with
 * every way in, Add, Pass and Not for me; the peek and its scoring breakdown;
 * Compare's bars and table from SCORING's bands, light and dark, with
 * Eadwyn's note saved only on press; and the stage-move dialogs. A pass needs
 * a reason; Eadwyn never changes a score; every change opens a dialog or an
 * undo toast. Every read is a stub: no test reaches the Worker.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_flow_part5_d1241.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DealFlow, { DealCompare } from '../src/pages/investor/dealflow/DealFlow.jsx';
import { viewOf } from '../src/pages/investor/dealflow/dealFlowModel.js';
import { scoresOf } from '../src/pages/investor/dealflow/flowModel.js';
import {
  COMMIT_LINE, MOVE_BACK_LINE, PASS_NOTE_BOX, PASS_REASONS, inboxActions, inboxChip, inboxIntro, inboxLine, moveKind, passBody, thesisLine, unreadSources,
} from '../src/pages/investor/dealflow/movesModel.js';
import { barShare, compareCsv, compareRow, compareSummary } from '../src/pages/investor/dealflow/compareModel.js';
import { api } from '../src/lib/api.js';
import { dealFlowApi } from '../src/lib/api/dealFlow.js';
import { dealViewsApi } from '../src/lib/api/dealViews.js';
import { ventureScoresApi } from '../src/lib/api/ventureScores.js';

const read = (p) => readFileSync(p, 'utf8');
const h = React.createElement;

// ---------------------------------------------------------------- fixtures (as D1240's)

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

const INBOX = () => ({
  items: [
    { key: 'invitation:7', source: 'invitation', entered_via: 'invited', deal_id: 9, venture: 'Orchid Analytics', sector: 'AI infrastructure', round_status: 'active', at: '2026-10-25 10:00:00', message: 'Thought this fits your climate thesis.', can_open: true },
    { key: 'room:12', source: 'room', entered_via: 'requested', deal_id: 12, venture: 'Harbor AI', sector: 'Logistics', round_status: 'active', at: '2026-10-03 10:00:00', message: null, can_open: false },
    { key: 'syndicate:2', source: 'syndicate', entered_via: 'syndicate', deal_id: 13, venture: 'Quayside Pay', sector: 'Fintech', round_status: 'active', at: '2026-10-01 10:00:00', message: null, can_open: false },
  ],
  sources: { invitation: { available: true }, room: { available: true }, syndicate: { available: true }, watchlist: { available: false, unreadable: true, reason: 'x' },
    thesis: { recorded: false, reason: 'Matches to your thesis are not recorded yet: they come with your thesis fit.' } },
});

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
  const names = ['flow', 'update', 'add', 'pass', 'inbox', 'dismiss', 'compareNotes', 'draftCompareNote', 'keepCompareNote'];
  const was = { ...Object.fromEntries(names.map((n) => [n, dealFlowApi[n]])), listDeals: api.listDeals, batch: ventureScoresApi.batch, weights: ventureScoresApi.weights, deal: ventureScoresApi.deal, fit: dealViewsApi.fit, list: dealViewsApi.list };
  const calls = [];
  const rec = (name, out) => async (...a) => { calls.push([name, ...a]); return typeof out === 'function' ? out(...a) : out; };
  const flow = FLOW();
  Object.assign(dealFlowApi, {
    flow: rec('flow', flow),
    update: rec('update', (id, b) => ({ ...flow.items.find((x) => String(x.deal_id) === String(id)), ...b, days_in_stage: 0 })),
    add: rec('add', (b) => entry({ deal_id: b.deal_id, venture: 'Orchid Analytics', stage: b.stage, entered_via: 'invited', can_open: true })),
    pass: rec('pass', (id, b) => ({ ...(flow.items.find((x) => String(x.deal_id) === String(id)) || entry({ deal_id: Number(id) })), stage: 'passed', pass: { reason: b.reason } })),
    inbox: rec('inbox', INBOX()),
    dismiss: rec('dismiss', (key) => ({ ok: true, key })),
    compareNotes: rec('compareNotes', { items: [], unreadable: 0 }),
    draftCompareNote: rec('draftCompareNote', { note: { text: 'Acme Robotics has the stronger band on Team.', deal_ids: [1, 2] }, receipt: { payload: 'p', signature: 's' } }),
    keepCompareNote: rec('keepCompareNote', { saved: { uid: 'n1', text: 'Acme Robotics has the stronger band on Team.' } }),
  });
  api.listDeals = rec('listDeals', DEALS());
  Object.assign(ventureScoresApi, { batch: rec('batch', BATCH()), weights: rec('weights', { weights: null, equal: true }), deal: rec('deal', { locked: true }) });
  Object.assign(dealViewsApi, { fit: rec('fit', FIT()), list: rec('views', { items: [], default_uid: null }) });
  for (const [k, v] of Object.entries(over)) {
    const [obj, name] = k.split('.');
    ({ dealFlowApi, api, ventureScoresApi, dealViewsApi })[obj][name] = v;
  }
  return { calls, restore: () => {
    for (const n of names) dealFlowApi[n] = was[n];
    api.listDeals = was.listDeals;
    Object.assign(ventureScoresApi, { batch: was.batch, weights: was.weights, deal: was.deal });
    Object.assign(dealViewsApi, { fit: was.fit, list: was.list });
  } };
}
const DIGIT = /\d/;

// ---------------------------------------------------------------- the rules

test('the moves: forward is immediate, back and Commit are said first, Passed only by the pass', () => {
  assert.equal(moveKind('sourcing', 'screening'), 'direct');
  assert.equal(moveKind('screening', 'diligence'), 'direct');
  assert.equal(moveKind('diligence', 'closing'), 'direct', 'Closing is the Worker’s to refuse without a commitment');
  assert.equal(moveKind('diligence', 'sourcing'), 'back');
  assert.equal(moveKind('commit', 'diligence'), 'back');
  assert.equal(moveKind('diligence', 'commit'), 'commit');
  assert.equal(moveKind('closing', 'commit'), 'back', 'back to Commit is a move back');
  assert.equal(moveKind('passed', 'screening'), 'direct', 'off Passed onto the board');
  assert.equal(moveKind('screening', 'passed'), 'pass');
  assert.match(MOVE_BACK_LINE, /It keeps its history\./);
  assert.match(COMMIT_LINE, /This does not open a vote\./);
});

test('a pass needs one of the Worker’s five reasons; a date after today; a note is optional', () => {
  const worker = [...read('cloudflare-worker/src/services/dealPassTaxonomy.ts').matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(PASS_REASONS.map((r) => r.key), worker);
  assert.deepEqual(PASS_REASONS.map((r) => r.label), ['Too early', 'Valuation', 'Outside thesis', 'Team', 'Competitive dynamics']);
  const now = new Date('2026-10-27T12:00:00Z');
  assert.deepEqual(passBody({ reason: '' }, now), { error: 'Choose why you are passing.' });
  assert.deepEqual(passBody({ reason: 'overall' }, now), { error: 'Choose why you are passing.' });
  assert.deepEqual(passBody({ reason: 'team', revisit: 'date', revisitAt: '2026-10-27' }, now), { error: 'Choose a date after today.' });
  assert.deepEqual(passBody({ reason: 'team', revisit: 'date', revisitAt: '2026-10-28' }, now), { body: { reason: 'team', revisit: 'date', revisit_at: '2026-10-28' } });
  assert.deepEqual(passBody({ reason: 'early', note: '  later  ', viaKey: 'room:1' }, now), { body: { reason: 'early', revisit: 'next_round', note: 'later', via_key: 'room:1' } });
  assert.deepEqual(passBody({ reason: 'early', note: '   ' }, now), { body: { reason: 'early', revisit: 'next_round' } });
  assert.match(PASS_NOTE_BOX, /The round stays open for other investors\./);
});

test('New for you’s words: the count, each way in, an invitation requested only opens, and what could not be read', () => {
  assert.match(inboxIntro(3), /^3 new, newest first\. Ventures already in Mine are not listed\./);
  assert.match(inboxIntro(1), /^1 new,/);
  const [inv, room, syn] = INBOX().items;
  assert.equal(inboxChip(inv), 'Invited by the studio');
  assert.equal(inboxChip(room), 'Invitation requested');
  assert.equal(inboxLine(inv), 'The studio: “Thought this fits your climate thesis.”');
  assert.equal(inboxLine(room), 'You joined this room on 3 Oct and asked to be invited. The studio decides.');
  assert.equal(inboxLine(syn), 'A syndicate is open on this round.');
  assert.equal(inboxLine({ source: 'watchlist', at: '2026-10-09' }), 'Converted on 9 Oct.');
  assert.deepEqual(inboxActions(room), { add: false, pass: false, dismiss: false, open: false });
  assert.deepEqual(inboxActions(inv), { add: true, pass: true, dismiss: true, open: true });
  assert.deepEqual(inboxActions(syn), { add: true, pass: true, dismiss: true, open: false }, 'Open only where the investor may read the deal');
  assert.equal(moveKind(null, 'screening'), 'direct');
  assert.deepEqual(unreadSources(INBOX().sources), ['your watchlist']);
  assert.match(thesisLine(INBOX().sources), /not recorded yet/);
  assert.equal(thesisLine({}), null);
});

test('Compare’s rules: a bar is a band’s rank; the strongest alone is marked, a tie is not; the summary and CSV hold no score', () => {
  const v = (id, name) => ({ id: String(id), name, scores: scoresOf(BATCH(), id) });
  const vs = [v(1, 'Acme Robotics'), v(2, 'Northwind Labs'), v(3, 'Copperline Energy')];
  assert.deepEqual([barShare('Strong'), barShare('Fair'), barShare('Weak'), barShare(null)], [1, 2 / 3, 1 / 3, 0]);
  assert.deepEqual(compareRow(vs, 'team').cells.map((c) => c.best), [true, false, false]);
  assert.deepEqual(compareRow(vs, 'market').cells.map((c) => c.best), [false, true, false]);
  assert.deepEqual(compareRow([v(1, 'A'), v(1, 'B')], 'team').cells.map((c) => c.best), [false, false], 'a tie marks no one');
  assert.equal(compareRow(vs, 'geographic').cells[0].low, true);
  assert.equal(compareRow(vs, 'team').cells[2].word, 'Locked');
  const sum = compareSummary(vs);
  assert.match(sum, /Acme Robotics has the strongest band alone on 3 of 11 scopes; Northwind Labs has the strongest band alone on 1 of 11 scopes\./);
  assert.match(sum, /Copperline Energy has not shared its scorecard\./);
  assert.match(sum, /Northwind Labs has 9 scopes without a score\./);
  const csv = compareCsv(vs);
  assert.match(csv.split('\n')[1], /^Team,Strong · High,Fair · Low,Locked$/);
  assert.doesNotMatch(csv.split('\n').slice(1).join('\n'), DIGIT, 'no score is a number');
});

// ---------------------------------------------------------------- mounted

test('mounted New for you (DLS6): every way in from the inbox; Add with its way in; a pass needs a reason; Not for me hides the row', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?scope=new')));
    await t.settle();
    assert.equal(s.calls.filter((c) => c[0] === 'inbox').length, 1);
    assert.match(t.text(t.byId('dealflow-new-intro')), /^3 new, newest first\./);
    assert.match(t.text(t.byId('dealflow-new-unread')), /your watchlist could not be read\. The rest are listed\./);
    assert.match(t.text(t.byId('dealflow-new-thesis')), /not recorded yet/);
    assert.match(t.text(t.byId('dealflow-new-invitation:7')), /Invited by the studio25 OctOrchid Analytics · AI infrastructure · Raising/);
    assert.ok(t.byId('dealflow-new-open-invitation:7') && !t.byId('dealflow-new-open-room:12'), 'Open only where the investor may read it');
    assert.ok(!t.byId('dealflow-new-add-room:12') && !t.byId('dealflow-new-pass-room:12'), 'an invitation requested waits on the studio');
    // Add: nothing is added before the press; the way in goes with it.
    assert.equal(s.calls.filter((c) => c[0] === 'add').length, 0);
    await t.click('dealflow-new-add-invitation:7');
    await t.change('dealflow-add-stage', 'screening');
    await t.click('dealflow-add-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'add').at(-1), ['add', { deal_id: 9, stage: 'screening', via_key: 'invitation:7' }]);
    assert.equal(t.byId('dealflow-new-invitation:7'), undefined);
    assert.match(t.text(t.byId('dealflow-toast')), /Added Orchid Analytics to your deal flow at Screening\./);
    // Pass: refused without a reason, then sent with it.
    await t.click('dealflow-new-pass-syndicate:2');
    assert.match(t.text(t.byId('dealflow-pass-box')), /The round stays open for other investors\./);
    assert.doesNotMatch(t.text(t.byId('dealflow-pass-box')), /is told you passed/, 'only an invitation tells the studio');
    await t.click('dealflow-pass-go');
    assert.match(t.text(t.byId('dealflow-pass-refused')), /Choose why you are passing\./);
    assert.equal(s.calls.filter((c) => c[0] === 'pass').length, 0, 'a pass needs a reason');
    await t.change('dealflow-pass-reason-valuation', true, 'checked');
    await t.click('dealflow-pass-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'pass').at(-1), ['pass', '13', { reason: 'valuation', revisit: 'next_round', via_key: 'syndicate:2' }]);
    assert.match(t.text(t.byId('dealflow-toast')), /You passed on Quayside Pay\. The round stays open for other investors\./);
    // Not for me, with its optional reason.
    s.calls.length = 0;
    dealFlowApi.inbox = async () => ({ items: [INBOX().items[0]], sources: {} });
    await act(async () => t.root.render(page('/deals?scope=new&again=1')));
    await t.settle();
    await t.click('dealflow-new-pass-invitation:7');
    assert.match(t.text(t.byId('dealflow-pass-box')), /The studio that invited you is told you passed\./);
  } finally { s.restore(); await t.close(); }
});

test('mounted Not for me: it says what it changes, sends the reason, and the row leaves', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?scope=new')));
    await t.settle();
    await t.click('dealflow-new-dismiss-syndicate:2');
    assert.ok(t.byId('dealflow-notforme'));
    assert.equal(s.calls.filter((c) => c[0] === 'dismiss').length, 0, 'nothing hidden before the press');
    await t.change('dealflow-notforme-reason', 'Ticket too large');
    await t.click('dealflow-notforme-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'dismiss').at(-1), ['dismiss', 'syndicate:2', 'Ticket too large']);
    assert.equal(t.byId('dealflow-new-syndicate:2'), undefined);
    assert.match(t.text(t.byId('dealflow-toast')), /Quayside Pay is hidden from New for you\./);
  } finally { s.restore(); await t.close(); }
});

test('mounted stage dialogs (DLS10): back and Commit are said first; Closing without a commitment is refused in the Worker’s words', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals')));
    await t.settle();
    await t.change('dealflow-move-1', 'sourcing');
    assert.equal(s.calls.filter((c) => c[0] === 'update').length, 0, 'a move back waits for its dialog');
    assert.match(t.text(t.byId('dealflow-back')), /Move Acme Robotics back to Sourced\?/);
    assert.match(t.text(t.byId('dealflow-back-line')), /It keeps its history\./);
    await t.click('dealflow-back-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '1', { stage: 'sourcing' }]);
    assert.equal(t.byId('dealflow-back'), undefined);
    await t.change('dealflow-move-3', 'commit');
    assert.match(t.text(t.byId('dealflow-commit')), /Move Copperline Energy to Commit\?/);
    assert.match(t.text(t.byId('dealflow-commit-line')), /This does not open a vote\./);
    dealFlowApi.update = async () => { const e = new Error('Closing follows a commitment. Commit on the deal page first.'); e.code = 'closing_needs_commitment'; throw e; };
    await t.click('dealflow-commit-go');
    assert.match(t.text(t.byId('dealflow-commit-refused')), /Closing follows a commitment|Commit on the deal page first/, 'a refusal stays in the dialog');
    assert.ok(t.byId('dealflow-commit'), 'the dialog stays open, nothing moved');
  } finally { s.restore(); await t.close(); }
});

test('mounted peek (DLS7): bands not numbers, the breakdown on a readable deal, Move to, Pass with a reason, Add to compare and the note', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/deals?view=table')));
    await t.settle();
    await t.click('dealflow-peek-1');
    assert.ok(t.byId('dealflow-peek'));
    for (const k of ['team', 'market', 'geographic', 'technical']) assert.doesNotMatch(t.text(t.byId(`dealflow-peek-scope-${k}`)), DIGIT, k);
    assert.match(t.text(t.byId('dealflow-peek-scope-team')), /^TeamStrong· High$/);
    assert.equal(t.props(t.byId('dealflow-peek-open')).href, '/deals/1');
    await t.click('dealflow-peek-scope-team');
    assert.ok(t.byId('dealflow-peek-breakdown'), 'a score opens SCORING’s breakdown panel');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'deal').at(-1), ['deal', '1']);
    // The note: saved only on Save note, through the flow's own note.
    await t.click('dealflow-peek-note-edit');
    await t.change('dealflow-peek-note-field', 'Wait for the second pilot.');
    assert.equal(s.calls.filter((c) => c[0] === 'update').length, 0);
    await t.click('dealflow-peek-note-save');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'update').at(-1), ['update', '1', { note: 'Wait for the second pilot.' }]);
    await t.click('dealflow-peek-compare');
    assert.match(t.text(t.byId('dealflow-peek-compare')), /Remove from compare/);
    await t.click('dealflow-peek-pass');
    await t.change('dealflow-pass-reason-team', true, 'checked');
    await t.change('dealflow-pass-on-date', true, 'checked');
    await t.change('dealflow-pass-date', '2099-01-15');
    await t.click('dealflow-pass-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'pass').at(-1), ['pass', '1', { reason: 'team', revisit: 'date', revisit_at: '2099-01-15' }]);
    assert.match(t.text(t.byId('dealflow-pass-box') || t.byId('dealflow-toast')), /You passed on Acme Robotics|round stays open/);
  } finally { s.restore(); await t.close(); }
  const u = harness();
  const s2 = stubs();
  try {
    await act(async () => u.root.render(page('/deals?view=table')));
    await u.settle();
    await u.click('dealflow-peek-2');
    assert.equal(u.props(u.byId('dealflow-peek-scope-team')).disabled, true, 'no breakdown on a deal the investor may not read');
    assert.equal(u.byId('dealflow-peek-open'), undefined);
  } finally { s2.restore(); await u.close(); }
});

test('mounted Compare (DLS8, DLS9): one colour each, bars by band, the table with the strongest alone in 800, and Eadwyn’s note saved only on press', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(h(MemoryRouter, null, h(DealCompare, { ids: ['1', '2', '3'] }))));
    await t.settle();
    assert.match(t.text(t.byId('dealflow-compare-page')), /Compare · 3 ventures/);
    assert.deepEqual(s.calls.find((c) => c[0] === 'batch'), ['batch', [1, 2, 3]]);
    assert.equal(t.props(t.byId('dealflow-compare-bar-team-0'))['data-band'], 'Strong');
    assert.equal(t.props(t.byId('dealflow-compare-bar-team-1'))['data-band'], 'Fair');
    assert.equal(t.props(t.byId('dealflow-compare-bar-team-2'))['data-band'], 'none', 'a locked scorecard draws no bar');
    assert.equal(t.props(t.byId('dealflow-compare-bar-geographic-0'))['data-low'], '1');
    assert.equal(t.props(t.byId('dealflow-compare-cell-team-0'))['data-best'], '1');
    assert.match(t.props(t.byId('dealflow-compare-cell-team-0')).className, /font-extrabold/);
    assert.equal(t.props(t.byId('dealflow-compare-cell-team-1'))['data-best'], '0');
    assert.doesNotMatch(t.text(t.byId('dealflow-compare-chart')), DIGIT, 'the chart holds no number');
    for (const k of ['team', 'market', 'risk']) for (const i of [0, 1, 2]) assert.doesNotMatch(t.text(t.byId(`dealflow-compare-cell-${k}-${i}`)), DIGIT);
    assert.match(t.text(t.byId('dealflow-compare-summary')), /strongest band alone on/);
    // The note.
    assert.deepEqual(s.calls.find((c) => c[0] === 'compareNotes'), ['compareNotes', ['1', '2', '3']]);
    assert.equal(s.calls.filter((c) => c[0] === 'draftCompareNote').length, 0, 'nothing is drafted before the press');
    await t.click('dealflow-compare-note-draft');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'draftCompareNote').at(-1), ['draftCompareNote', ['1', '2', '3']]);
    assert.match(t.text(t.byId('dealflow-compare-note-text')), /stronger band on Team/);
    assert.equal(s.calls.filter((c) => c[0] === 'keepCompareNote').length, 0, 'a draft is not saved');
    await t.click('dealflow-compare-note-discard');
    assert.equal(t.byId('dealflow-compare-note-text'), undefined);
    assert.equal(s.calls.filter((c) => c[0] === 'keepCompareNote').length, 0, 'Discard writes nothing');
    await t.click('dealflow-compare-note-draft');
    await t.click('dealflow-compare-note-save');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'keepCompareNote').at(-1), ['keepCompareNote', { payload: 'p', signature: 's' }]);
    assert.match(t.text(t.byId('dealflow-compare-notes')), /stronger band on Team/);
    // A refused draft says why and saves nothing.
    dealFlowApi.draftCompareNote = async () => { throw new Error('Not enough ventures here have a score to compare. Eadwyn drafts from scores only.'); };
    await t.click('dealflow-compare-note-draft');
    assert.match(t.text(t.byId('dealflow-compare-note-refused')), /Eadwyn drafts from scores only\./);
  } finally { s.restore(); await t.close(); }
});

// ---------------------------------------------------------------- the wiring

test('wiring: the waits retired, no browser pop-up, dark pairs, the clients on Worker routes, the README', () => {
  const dir = 'frontend/src/pages/investor/dealflow/';
  const model = read(`${dir}dealFlowModel.js`);
  assert.doesNotMatch(model, /NOT_YET|WAITS|inviteRow/, 'no block waits on a read');
  for (const f of ['NewForYou.jsx', 'PeekDrawer.jsx', 'Compare.jsx', 'StageDialogs.jsx', 'movesModel.js', 'compareModel.js', 'DealFlow.jsx']) {
    const src = read(dir + f);
    assert.doesNotMatch(src, /window\.(alert|confirm|prompt|open)|\balert\(|\bconfirm\(|dangerouslySetInnerHTML/, f);
    for (const m of src.matchAll(/'([^']*\bhover:[^']*)'/g)) if (/\bhover:(bg|text|border)-/.test(m[1])) assert.match(m[1], /dark:hover:|dark:disabled:hover:/, `${f}: ${m[1]}`);
    for (const m of src.matchAll(/'([^']*\bbg-white\b[^']*)'/g)) assert.match(m[1], /dark:bg-/, `${f}: ${m[1]}`);
  }
  assert.doesNotMatch(read(`${dir}compareModel.js`), /\.value\b/, 'Compare never reads a score’s value');
  const client = read('frontend/src/lib/api/dealFlow.js');
  const worker = read('cloudflare-worker/src/routes/deal_flow.ts');
  for (const [m, route] of [['compareNotes', "routes.get('/compare-note'"], ['draftCompareNote', "routes.post('/compare-note'"], ['keepCompareNote', "routes.post('/compare-note/keep'"]]) {
    assert.ok(client.includes(`${m}:`), m);
    assert.ok(worker.includes(route), route);
  }
  const readme = read(`${dir}README.md`);
  for (const f of ['NewForYou.jsx', 'PeekDrawer.jsx', 'Compare.jsx', 'StageDialogs.jsx', 'movesModel.js', 'compareModel.js']) assert.ok(readme.includes(f), f);
});
