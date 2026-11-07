// #4737 (S1 audit 2026-11-06) — the Ask panel, the Eadwyn rail and Fill, where they met the rest of the app.
//
//   1. Accepting a `sessions:block` card blocks nothing: it must end on the Sessions page's Block form,
//      and decide the card only once Block has written (D1596 §4).
//   2. "N waiting" counted proposals the panel never lists.
//
// The first two are driven end to end: the real AskPanel and the real SessionsZone in one router, the
// real API clients, and only `fetch` stubbed, so a decide that ran early would be seen as a request.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_block_accept_4737.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { __resetEadwynPanelForTest, useAskRail } from '../src/ui/eadwynPanel.js';
import { RUN_CHIPS, acceptAllLabel, optionCard } from '../src/ui/askPanelModel.js';
import { askPanelAdapter } from '../src/ui/askPanelAdapter.js';
import {
  BLOCK_OPTION, BLOCK_ROUTE, blockDates, blockHref, needsBlockPage, parseBlockQuery,
} from '../src/ui/sessionsBlockHandoff.js';
import AskPanel from '../src/ui/AskPanel.jsx';
import { PageAsk } from '../src/ui/AskButton.jsx';
import SessionsZone from '../src/pages/advisor/practice/SessionsZone.jsx';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const AFTERNOON = { kind: 'free_afternoon', from: '2026-11-10T12:00:00.000Z', until: '2026-11-10T18:00:00.000Z', open_slots: 3, source: 'Your Axal calendar' };
const row = (uid, payload = AFTERNOON) => ({ uid, rail_option: BLOCK_OPTION, status: 'proposed', payload });

// ── The hand-over, pure ─────────────────────────────────────────────────────

test('a card\'s instants become the Block form\'s whole UTC days: the first, and the day after the last', () => {
  assert.deepEqual(blockDates(AFTERNOON), { from: '2026-11-10', until: '2026-11-11' }, 'an afternoon fills one day');
  assert.deepEqual(blockDates({ from: '2026-11-10T00:00:00.000Z', until: '2026-11-12T00:00:00.000Z' }), { from: '2026-11-10', until: '2026-11-12' }, 'midnight to midnight is two days');
  assert.deepEqual(blockDates({ from: '2026-11-10T23:30:00.000Z', until: '2026-11-11T01:00:00.000Z' }), { from: '2026-11-10', until: '2026-11-12' }, 'across midnight is two days');
  for (const bad of [null, {}, { from: 'x', until: 'y' }, { from: AFTERNOON.until, until: AFTERNOON.from }, { from: AFTERNOON.from, until: AFTERNOON.from }]) {
    assert.equal(blockDates(bad), null, JSON.stringify(bad));
  }
});

test('the address carries the card, and reads back only a valid hand-over', () => {
  const href = blockHref('p1', blockDates(AFTERNOON));
  assert.equal(href, `${BLOCK_ROUTE}?block=p1&from=2026-11-10&until=2026-11-11`);
  assert.deepEqual(parseBlockQuery(href.split('?')[1]), { uid: 'p1', from: '2026-11-10', until: '2026-11-11' });
  assert.equal(blockHref('p1', null), `${BLOCK_ROUTE}?block=p1`, 'a card with no dates still carries its uid');
  assert.deepEqual(parseBlockQuery('block=p1'), { uid: 'p1', from: '', until: '' }, 'no dates: the form opens empty for the card');
  assert.equal(parseBlockQuery(''), null, 'no card, no hand-over');
  assert.equal(parseBlockQuery('from=2026-11-10&until=2026-11-11'), null, 'dates without a card are not a hand-over');
  assert.equal(parseBlockQuery('block=a b'), null, 'a uid is a token');
  for (const q of ['from=2026-11-31&until=2026-12-02', 'from=2026-11-12&until=2026-11-10', 'from=2026-11-10&until=2026-11-10', 'from=2026-11-10', 'from=nope&until=nope']) {
    assert.deepEqual(parseBlockQuery(`block=p1&${q}`), { uid: 'p1', from: '', until: '' }, `${q}: bad dates are dropped, not guessed`);
  }
});

test('only a Block card carries dates, and "Accept all" never counts it', () => {
  const block = optionCard(row('p1'), BLOCK_OPTION);
  assert.deepEqual(block.block, { from: '2026-11-10', until: '2026-11-11' });
  assert.equal(needsBlockPage(block), true);
  const other = optionCard({ uid: 'f1', status: 'proposed', payload: { text: 'x', from: AFTERNOON.from, until: AFTERNOON.until } }, 'form:mvp_features');
  assert.equal('block' in other, false);
  assert.equal(needsBlockPage(other), false);
  assert.equal(acceptAllLabel([block, optionCard(row('p2'), BLOCK_OPTION)]), null, 'two Block cards: no Accept all');
  assert.equal(acceptAllLabel([block, other, { ...other, uid: 'f2' }]), 'Accept all (2)', 'the form cards still bulk-accept, the Block card does not');
});

// ── The harness: the real panel and the real page, one router, only fetch stubbed ──

function Where() {
  const l = useLocation();
  return h('span', { 'data-testid': 'where' }, `${l.pathname}${l.search}`);
}

function Both({ closed, options }) {
  const navigate = useNavigate();
  return h(React.Fragment, null,
    h(Where),
    h(AskPanel, { page: 'Advisor · Practice · Sessions', label: 'Sessions', options, onNavigate: navigate, onClose: (why) => closed.push(why) }),
    h(SessionsZone));
}

async function mount(el, answer, entries = ['/practice/sessions']) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u, o = {}) => {
    const url = new URL(String(u), 'http://localhost');
    const call = { method: (o.method || 'GET').toUpperCase(), path: url.pathname, query: url.search, body: o.body ? JSON.parse(o.body) : null };
    calls.push(call);
    return answer(call) ?? json({});
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(document.body);
  const by = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const text = (n = box) => (n.nodeType === 3 ? n.textContent : (n.childNodes || []).map((c) => text(c)).join('') || n.textContent || '');
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: entries }, el)));
  await settle();
  return {
    calls, by, props, text, settle,
    button: (label, within = document.body) => walk(within).find((n) => n.tagName === 'BUTTON' && text(n).trim() === label),
    async press(node) { assert.ok(node, 'a control to press'); await act(async () => props(node).onClick({ preventDefault() {}, stopPropagation() {} })); await settle(); },
    async submit(id) { const f = by(id); assert.ok(f, id); await act(async () => props(f).onSubmit({ preventDefault() {} })); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; restore(); },
  };
}

/** The Worker, as far as this page and panel reach it. */
function worker({ cards = [row('p1')], block = () => json({ blocked: 3, skipped_booked: 0 }), decide = () => json({ proposal: { uid: 'p1', status: 'accepted' } }) } = {}) {
  return (c) => {
    if (c.path === '/api/ai/rail/proposals' && c.method === 'GET') return json({ proposals: cards });
    if (/\/api\/ai\/rail\/proposals\/[^/]+\/decide$/.test(c.path)) return decide(c);
    if (c.path === '/api/advisors/me/slots/block') return block(c);
    if (c.path === '/api/advisors/me/slots') return json({ items: [] });
    if (c.path === '/api/advisors/me/bookings') return json({ items: [] });
    if (c.path === '/api/eadwyn/conversations') return json({ conversations: [] });
    return json({});
  };
}
const OPTIONS = [{ key: BLOCK_OPTION, label: 'Find a free afternoon' }];
const decides = (m) => m.calls.filter((c) => /\/decide$/.test(c.path));
const blocks = (m) => m.calls.filter((c) => c.path === '/api/advisors/me/slots/block');

// ── 1. Accept leads to the Block form, and decides only after Block wrote ────

test('Accept on a Block card decides nothing; Block writes, and only then the card is decided', async () => {
  __resetEadwynPanelForTest();
  const closed = [];
  const m = await mount(h(Both, { closed, options: OPTIONS }), worker());
  try {
    assert.ok(m.by('ask-card-p1'), 'the Block card is in the panel');
    assert.equal(m.by('advisor-block-form'), undefined, 'the form is closed');

    await m.press(m.button('Accept', m.by('ask-card-p1')));
    assert.deepEqual(decides(m), [], 'accepting a Block card must not decide it');
    assert.deepEqual(blocks(m), [], 'and writes no block by itself');
    assert.ok(m.by('advisor-block-form'), 'the Block form is open');
    assert.equal(m.props(m.by('advisor-block-from')).value, '2026-11-10', 'filled with the card\'s first day');
    assert.equal(m.props(m.by('advisor-block-until')).value, '2026-11-11', 'and the day after its last');
    assert.match(m.text(m.by('advisor-block-from-ask')), /Block closes whole days/, 'the form says a block is wider than an afternoon');
    assert.equal(m.text(m.by('where')), '/practice/sessions', 'the hand-over is taken out of the address once read');
    assert.deepEqual(closed, ['route'], 'the panel closes as the advisor is sent to the form');

    await m.submit('advisor-block-form');
    assert.deepEqual(blocks(m).map((c) => c.body), [{ from: '2026-11-10T00:00:00.000Z', until: '2026-11-11T00:00:00.000Z', reason: '' }]);
    assert.deepEqual(decides(m).map((c) => [c.path, c.body]), [['/api/ai/rail/proposals/p1/decide', { decision: 'accept' }]], 'decided after Block');
    assert.ok(m.calls.indexOf(blocks(m)[0]) < m.calls.indexOf(decides(m)[0]), 'Block came first');
    assert.match(m.text(), /Blocked 3 slots\./);
    assert.equal(m.by('advisor-block-form'), undefined, 'the form closes once it has written');
  } finally { await m.close(); }
});

test('a Block that is refused decides nothing, and the card keeps waiting', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(Both, { closed: [], options: OPTIONS }), worker({ block: () => json({ detail: 'the end comes after the start' }, 422) }));
  try {
    await m.press(m.button('Accept', m.by('ask-card-p1')));
    await m.submit('advisor-block-form');
    assert.equal(blocks(m).length, 1, 'Block was tried');
    assert.deepEqual(decides(m), [], 'a refused Block must not decide the card');
    assert.ok(m.by('advisor-block-form'), 'the form stays open for another try');
  } finally { await m.close(); }
});

test('cancelling the form decides nothing either', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(Both, { closed: [], options: OPTIONS }), worker());
  try {
    await m.press(m.button('Accept', m.by('ask-card-p1')));
    await m.press(m.button('Cancel', m.by('advisor-block-form')));
    assert.equal(m.by('advisor-block-form'), undefined);
    assert.deepEqual([blocks(m).length, decides(m).length], [0, 0]);
  } finally { await m.close(); }
});

test('a decide that fails after a good Block says the block stands, and never shows the Worker\'s words', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(Both, { closed: [], options: OPTIONS }), worker({ decide: () => json({ detail: 'WORKER-INTERNAL-TEXT', error: 'not_open' }, 409) }));
  try {
    await m.press(m.button('Accept', m.by('ask-card-p1')));
    await m.submit('advisor-block-form');
    assert.match(m.text(), /Blocked 3 slots\. Its Ask proposal could not be marked accepted, so it is still waiting in Ask\./);
    assert.doesNotMatch(m.text(), /WORKER-INTERNAL-TEXT/);
  } finally { await m.close(); }
});

test('the card\'s Edit link carries the same hand-over as Accept', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(Both, { closed: [], options: OPTIONS }), worker());
  try {
    const card = m.by('ask-card-p1');
    const link = (function find(n) { return [n, ...(n.childNodes || []).flatMap(find)]; })(card).find((n) => n.tagName === 'A');
    assert.ok(link, 'Edit is a link');
    assert.equal(m.props(link).href, '/practice/sessions?block=p1&from=2026-11-10&until=2026-11-11', 'not the bare page');
  } finally { await m.close(); }
});

test('"Accept all" is not offered for Block cards, and decides none of them', async () => {
  __resetEadwynPanelForTest();
  const m = await mount(h(Both, { closed: [], options: OPTIONS }), worker({ cards: [row('p1'), row('p2', { ...AFTERNOON, from: '2026-11-11T12:00:00.000Z', until: '2026-11-11T18:00:00.000Z' })] }));
  try {
    assert.ok(m.by('ask-card-p1') && m.by('ask-card-p2'), 'both cards are listed');
    assert.equal(m.by('ask-accept-all'), undefined, 'no Accept all for cards accepted on their page');
    assert.deepEqual(decides(m), []);
    // Taken one at a time, each through the form.
    await m.press(m.button('Accept', m.by('ask-card-p2')));
    assert.equal(m.props(m.by('advisor-block-from')).value, '2026-11-11', 'the second card fills its own dates');
    assert.deepEqual(decides(m), []);
  } finally { await m.close(); }
});

// ── 2. "N waiting" counts what the panel lists ──────────────────────────────

function Served({ page }) {
  useAskRail(true, page, 'Build · Solution design');
  return h(PageAsk, { testId: 'ask-eadwyn' });
}

test('a page with only form proposals draws no "N waiting"; a listed Block card counts', async () => {
  __resetEadwynPanelForTest();
  const PAGE = 'Founder · Build · Solution design';
  const forms = [
    { uid: 'f1', rail_option: 'form:mvp_features', status: 'proposed', payload: { text: 'a' } },
    { uid: 'f2', rail_option: 'form:icp', status: 'proposed', payload: { text: 'b' } },
    { uid: 'r1', rail_option: 'raise:evidence', status: 'proposed', payload: { text: 'c' } },
  ];
  assert.ok(forms.every((r) => !RUN_CHIPS.includes(r.rail_option)), 'none of these is a run chip: the panel lists none of them');
  const m = await mount(h(Served, { page: PAGE }), (c) => (c.path === '/api/ai/rail/proposals' ? json({ proposals: forms }) : json({})), ['/']);
  try {
    assert.ok(m.by('ask-eadwyn'), 'Ask is drawn');
    assert.equal(m.by('ask-eadwyn-waiting'), undefined, 'three open rows the panel cannot show draw no pill');
    assert.equal(m.props(m.by('ask-eadwyn'))['aria-label'], 'Ask Eadwyn');
  } finally { await m.close(); }

  __resetEadwynPanelForTest();
  const withBlock = await mount(h(Served, { page: PAGE }), (c) => (c.path === '/api/ai/rail/proposals' ? json({ proposals: [...forms, row('p1')] }) : json({})), ['/']);
  try {
    assert.match(withBlock.text(withBlock.by('ask-eadwyn-waiting')), /^1 waiting$/, 'only the card the panel lists is counted');
  } finally { await withBlock.close(); }
});

test('a count that could not be read is still no count, never "0 waiting"', async () => {
  const real = globalThis.fetch;
  const restore = installDocument();
  try {
    globalThis.fetch = async () => json({ detail: 'down' }, 500);
    const w = await askPanelAdapter.waiting('Founder · Build');
    assert.equal(w.available, false);
  } finally { globalThis.fetch = real; restore(); }
});
