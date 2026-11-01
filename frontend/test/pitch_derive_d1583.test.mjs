/**
 * D1583 (#3830, deck builder v2 F4): ⋯ › This deck › "Teaser, one-pager or
 * memo…" and its proposals in Ask. The client calls the Worker routes
 * `cloudflare-worker/test/deck_derive_d1583.test.ts` holds; the sheet shows
 * the memo's hold before Propose; Ask lists what waits, and Accept keeps it
 * through its own route, never the generic decide.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { deckDeriveApi } from '../src/lib/api/deckDerive.js';
import { deckDeriveApi as viaApi } from '../src/lib/api.js';
import DeriveSheet from '../src/pages/raise/pitch/DeriveSheet.jsx';
import DeckAsk from '../src/pages/raise/pitch/DeckAsk.jsx';
import { MORE_MENU, waitingCount } from '../src/pages/raise/pitch/deckV2Model.js';
import { DERIVE_ASK_OPTIONS, FREE_LINE, deriveHold, derivedProposal } from '../src/pages/raise/pitch/deriveModel.js';
import { RUN_CHIPS, panelChips } from '../src/ui/askPanelModel.js';

const h = React.createElement;
const store = new Map();
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  };
}

async function mount() {
  const restore = installDocument();
  __resetAssistModeForTest();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  return {
    async render(el) { await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/edit?project_id=7'] }, el)); }); await settle(); },
    walk(n = container) { const w = (x) => [x, ...(x.childNodes || []).flatMap(w)]; return w(n); },
    pr: (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {},
    by(id) { return this.walk().find((n) => this.pr(n)['data-testid'] === id); },
    all(id) { return this.walk().filter((n) => this.pr(n)['data-testid'] === id); },
    async press(node) { assert.ok(node, 'no such node'); await act(async () => { await this.pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(node, value) { await act(async () => { await this.pr(node).onChange?.({ target: { checked: value, value } }); }); await settle(); },
    text(n = container) { const t = (x) => (!x ? '' : x.nodeType === 3 ? x.textContent || '' : x.childNodes?.length ? x.childNodes.map(t).join(' ') : x.textContent || ''); return t(n).replace(/\s+/g, ' ').trim(); },
    async close() { await act(async () => root.unmount()); restore(); __resetAssistModeForTest(); },
  };
}

test('the client: each call\'s verb, path and body, and api.js re-exports it (D527); no request names a model', async () => {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push([init.method || 'GET', String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await deckDeriveApi.quote(31, { format: 'memo', blind: true });
    await deckDeriveApi.derive(31, { format: 'teaser' });
    await deckDeriveApi.accept(31, 'u 1');
    await deckDeriveApi.list(31);
    await deckDeriveApi.get('d/1');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(seen, [
    ['POST', '/api/decks/31/derive/quote', { format: 'memo', blind: true }],
    ['POST', '/api/decks/31/derive', { format: 'teaser', blind: false }],
    ['POST', '/api/decks/31/derive/u%201/accept', {}],
    ['GET', '/api/decks/31/derivatives', null],
    ['GET', '/api/decks/derivatives/d%2F1', null],
  ]);
  assert.equal(viaApi, deckDeriveApi);
});

test('⋯ › This deck has the item, as a write and not as an AI item (the teaser and the one-pager are free)', () => {
  const deck = MORE_MENU.find((s) => s.id === 'deck');
  const item = deck.items.find((i) => i.id === 'derive');
  assert.deepEqual(item, { id: 'derive', label: 'Teaser, one-pager or memo…', write: true });
  const editor = readFileSync('frontend/src/pages/raise/pitch/PitchEditor.jsx', 'utf8');
  assert.match(editor, /'remix', 'derive'\]\.includes\(id\)\) setSheet\(id\)/, 'the item opens its sheet');
  // The memo's chip is there for its AIRail pick; the Ask panel never runs it on the generic run route.
  assert.ok(!RUN_CHIPS.includes('derive:memo'));
  assert.deepEqual(panelChips([{ key: 'derive:memo', label: 'Write a memo from this deck' }]), [{ key: 'derive:memo', label: 'Write a memo from this deck', run: false }]);
});

test('a waiting derivative is this version\'s open derive proposal; the hold is the memo\'s, the rest is free', () => {
  const row = (extra = {}) => ({ uid: 'p1', rail_option: 'derive:teaser', record_ref: 'deck:31', status: 'proposed', created_at: 'x', payload: { title: 'Blind teaser · from v3', blind: true, cards: ['Teaser', 'The problem'] }, ...extra });
  assert.deepEqual(derivedProposal(row(), 31), { uid: 'p1', format: 'teaser', blind: true, title: 'Blind teaser · from v3', summary: '2 cards: Teaser · The problem', at: 'x' });
  assert.equal(derivedProposal(row({ record_ref: 'deck:30' }), 31), null, 'another version\'s');
  assert.equal(derivedProposal(row({ status: 'accepted' }), 31), null);
  assert.equal(derivedProposal(row({ rail_option: 'deck:rewrite' }), 31), null);
  const memo = derivedProposal(row({ rail_option: 'derive:memo', payload: { memo: '## Summary\nA tool for finance teams.', blind: false } }), 31);
  assert.equal(memo.summary, 'A tool for finance teams.');
  assert.equal(deriveHold('teaser', null), FREE_LINE);
  assert.equal(deriveHold('memo', { ai: true, hold_microusd: 9000 }), 'Holds up to $0.0090 · you pay what it uses');
  assert.equal(deriveHold('memo', { ai: false }), null, 'no hold is drawn from a refused quote');
  assert.equal(waitingCount({ deck: { status: 'ready', proposal: null }, edits: { status: 'ready', items: [{}], derived: [{}, {}] } }), 3);
});

test('the sheet: the teaser proposes for free; the memo reads its quote first and shows the hold; AI paused greys the memo', async () => {
  const calls = [];
  const source = {
    quote: async (id, b) => { calls.push(['quote', id, b]); return { format: 'memo', ai: true, hold_microusd: 12000, model: '@cf/openai/gpt-oss-120b' }; },
    derive: async (id, b) => { calls.push(['derive', id, b]); return { title: 'Teaser · from v3' }; },
  };
  let proposed = 0;
  const m = await mount();
  try {
    await m.render(h(DeriveSheet, { deckId: 31, version: 3, dirty: true, onProposed: () => { proposed += 1; }, onClose: () => {}, source }));
    assert.ok(m.by('pitch-derive-dirty'), 'unsaved changes are said to be left out');
    assert.match(m.text(m.by('pitch-derive-hold')), /No model · free/);
    await m.press(m.by('pitch-derive-propose'));
    assert.deepEqual(calls, [['derive', 31, { format: 'teaser', blind: false }]], 'a free teaser needs no quote');
    assert.equal(proposed, 1);
    assert.match(m.text(m.by('pitch-derive-proposed')), /waits in Ask/);
    await m.change(m.by('pitch-derive-memo'), true);
    assert.deepEqual(calls.at(-1), ['quote', 31, { format: 'memo', blind: false }], 'the memo is quoted before it can run');
    assert.match(m.text(m.by('pitch-derive-hold')), /Holds up to \$0\.0120 · you pay what it uses/);
    await m.change(m.by('pitch-derive-blind'), true);
    assert.deepEqual(calls.at(-1), ['quote', 31, { format: 'memo', blind: true }]);
    await m.press(m.by('pitch-derive-propose'));
    assert.deepEqual(calls.at(-1), ['derive', 31, { format: 'memo', blind: true }]);
  } finally { await m.close(); }
  // Until its quote is read, the memo cannot be proposed.
  const waiting = await mount();
  try {
    await waiting.render(h(DeriveSheet, { deckId: 31, onClose: () => {}, source: { ...source, quote: () => new Promise(() => {}) } }));
    await waiting.change(waiting.by('pitch-derive-memo'), true);
    assert.equal(waiting.pr(waiting.by('pitch-derive-propose')).disabled, true, 'no hold shown, no Propose');
    assert.equal(waiting.by('pitch-derive-hold'), undefined);
  } finally { await waiting.close(); }
  const off = await mount();
  try {
    await off.render(h(DeriveSheet, { deckId: 31, aiOn: false, onClose: () => {}, source }));
    assert.equal(off.pr(off.by('pitch-derive-memo')).disabled, true);
    assert.match(off.text(), /AI is paused for your studio\./);
    assert.equal(off.pr(off.by('pitch-derive-teaser')).disabled, false, 'the free outputs still work');
  } finally { await off.close(); }
});

test('Ask lists what waits; Accept keeps it through its own route, Accept all keeps each, Discard decides', async () => {
  const VERSIONS = { versions: [{ id: 31, version: 3, is_current: true }] };
  const waiting = [
    { uid: 'p1', rail_option: 'derive:teaser', record_ref: 'deck:31', status: 'proposed', created_at: '1', payload: { title: 'Blind teaser · from v3', blind: true, cards: ['Teaser'] } },
    { uid: 'p2', rail_option: 'derive:memo', record_ref: 'deck:31', status: 'proposed', created_at: '2', payload: { title: 'Memo · from v3', memo: 'Text.' } },
    { uid: 'p3', rail_option: 'derive:one_pager', record_ref: 'deck:31', status: 'proposed', created_at: '3', payload: { title: 'One-pager · from v3', cards: ['x'] } },
  ];
  const calls = [];
  let open = new Set(['p1', 'p2', 'p3']);
  const source = {
    versions: async () => VERSIONS,
    discardDeck: async () => ({}),
    proposals: {
      list: async (q) => { calls.push(['list', q.option]); return { proposals: waiting.filter((r) => r.rail_option === q.option && open.has(r.uid)) }; },
      decide: async (uid, d) => { calls.push(['decide', uid, d]); open.delete(uid); return {}; },
    },
    derive: { accept: async (id, uid) => { calls.push(['accept', id, uid]); open.delete(uid); return { derivative: { uid: `d-${uid}` } }; } },
  };
  const m = await mount();
  try {
    await m.render(h(DeckAsk, { projectId: 7, source }));
    assert.equal(m.pr(m.by('pitch-ask'))['aria-label'], 'Ask Eadwyn, 3 waiting');
    for (const option of DERIVE_ASK_OPTIONS) assert.ok(calls.some((c) => c[0] === 'list' && c[1] === option), option);
    await m.press(m.by('pitch-ask'));
    assert.equal(m.all('pitch-ask-derived-item').length, 3);
    assert.match(m.text(m.by('pitch-ask-derived')), /Blind teaser · from v3/);
    await m.press(m.all('pitch-ask-derived-accept')[0]);
    assert.deepEqual(calls.filter((c) => c[0] !== 'list'), [['accept', 31, 'p1']], 'Accept is the derive route, never the generic decide');
    await m.press(m.all('pitch-ask-derived-discard')[0]);
    assert.deepEqual(calls.filter((c) => c[0] === 'decide'), [['decide', 'p2', 'discard']]);
    open = new Set(['p1', 'p3']); waiting[0].uid = 'p1';
  } finally { await m.close(); }
  // Accept all keeps each in turn.
  const calls2 = [];
  const all = new Set(['p1', 'p3']);
  const source2 = { ...source, proposals: { ...source.proposals, list: async (q) => ({ proposals: waiting.filter((r) => r.rail_option === q.option && all.has(r.uid)) }) },
    derive: { accept: async (id, uid) => { calls2.push(uid); all.delete(uid); return {}; } } };
  const n = await mount();
  try {
    await n.render(h(DeckAsk, { projectId: 7, source: source2 }));
    await n.press(n.by('pitch-ask'));
    await n.press(n.by('pitch-ask-derived-accept-all'));
    assert.deepEqual(calls2, ['p1', 'p3']);
  } finally { await n.close(); }
});
