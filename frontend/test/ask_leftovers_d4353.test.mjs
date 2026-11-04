// D4353 (#4353) — the Ask leftovers: the profile header's "N waiting" chip
// is D1442's per-page read (the adapter's placeholder is gone), and the
// article's writing actions are a page intent in the docked Ask panel, with
// no side panel and the same quotes.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ask_leftovers_d4353.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { __resetEadwynPanelForTest, askPanelEvent, setAskSlot, useAskPanel, useAskRail } from '../src/ui/eadwynPanel.js';
import HeaderAsk from '../src/ui/HeaderAsk.jsx';
import ProfileHeaderAsk from '../src/workspaces/ProfileHeaderAsk.jsx';
import * as profileAsk from '../src/workspaces/profileAskAdapter.js';
import { pageFor } from '../src/lib/railPages.js';
import { railProposalsApi } from '../src/lib/api/railProposals.js';
import { articleAuthoringApi } from '../src/lib/api/articleAuthoring.js';
import ArticleWritingIntent, { ArticleAsk } from '../src/pages/articles/ArticleWritingIntent.jsx';
import { ARTICLE_ACTIONS } from '../src/pages/articles/articleCanvas.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

/** A rail that serves Ask on its page, as `WorkerRail` does; `out.ask` is the store. */
function Rail({ page, out = {}, serves = true }) {
  useAskRail(serves, page, 'Page');
  out.ask = useAskPanel();
  return null;
}

/** Swaps the named methods of an API object for the test's own, and puts them back. */
function stub(obj, fns) {
  const real = Object.fromEntries(Object.keys(fns).map((k) => [k, obj[k]]));
  Object.assign(obj, fns);
  return () => Object.assign(obj, real);
}

async function mount(element) {
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = function focus() { document.activeElement = this; }; n.isConnected = true; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  await act(settle);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (node, id) => walk(node).filter((n) => props(n)['data-testid'] === id);
  const asks = (node = container) => walk(node).filter((n) => n.tagName === 'BUTTON' && /^Ask Eadwyn/.test(props(n)['aria-label'] || ''));
  // React writes a lone string child as the element's textContent, so read both, as `_contracts_dom`'s `textOf` does.
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return {
    container, props, byId, asks, text, walk,
    render: async (el) => { await act(async () => { root.render(el); }); await act(settle); },
    act: async (fn) => { await act(async () => { await fn(); }); await act(settle); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

// ── 1. The profile header's "N waiting" ────────────────────────────────────

test('the adapter\'s placeholder count is gone: no ASK_WAITING, no waitingCount', () => {
  // Mutation checked: restoring `export function waitingCount` (or ASK_WAITING) → red.
  assert.deepEqual(Object.keys(profileAsk).sort(), ['ASK_PANEL', 'askAvailability']);
  assert.doesNotMatch(codeOnly(read('frontend/src/workspaces/profileAskAdapter.js')), /ASK_WAITING|waitingCount|proposals_by_page_unbuilt/);
});

test('the profile header\'s Ask counts D1442\'s proposals on the rail\'s page; a failed or empty read draws no chip, never "0 waiting"', async () => {
  // Mutations checked: ProfileHeaderAsk drawing AskButtonView with no count (no HeaderAsk) → no "3 waiting";
  // askPanelAdapter.waiting dropping `page` → the call is not by page; AskButtonView's two count guards loosened to draw 0 → "0 waiting".
  const path = '/deals/closing';
  const page = pageFor(path, 'investor').key;
  const calls = [];
  let answer = async () => ({ proposals: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }] });
  const restore = stub(railProposalsApi, { list: async (q) => { calls.push(q); return answer(q); } });
  const view = () => h(MemoryRouter, { initialEntries: [path] }, h(Rail, { page }), h(ProfileHeaderAsk, { role: 'investor' }));
  try {
    for (const [label, next, want] of [
      ['three open', async () => ({ proposals: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }] }), 'Ask Eadwyn, 3 waiting'],
      ['a failed read', async () => { throw new Error('503'); }, 'Ask Eadwyn'],
      ['none open', async () => ({ proposals: [] }), 'Ask Eadwyn'],
    ]) {
      __resetEadwynPanelForTest();
      answer = next;
      calls.length = 0;
      const m = await mount(view());
      try {
        assert.equal(m.asks().length, 1, `${label}: one Ask`);
        assert.equal(m.props(m.asks()[0])['data-testid'], 'zone-header-ask');
        assert.equal(m.props(m.asks()[0])['aria-label'], want, label);
        assert.deepEqual(calls, [{ page, status: 'proposed' }], `${label}: read by the rail's page`);
        if (want === 'Ask Eadwyn') assert.doesNotMatch(m.text(m.container), /waiting/, `${label}: no chip`);
      } finally { await m.unmount(); }
    }
  } finally { restore(); }
});

// ── 2. The article's writing actions, in the Ask panel ─────────────────────

const ARTICLE_PAGE = 'Founder · Articles';

test('the article editor has one Ask: its own, which outranks the rail\'s fallback, drawn only while the panel serves', async () => {
  // Mutations checked: ArticleAsk without useHeaderAskClaim → the fallback draws a second Ask;
  // the `ask.available` gate dropped → an Ask with no panel to open.
  __resetEadwynPanelForTest();
  const page = (serves, waiting = null) => h(MemoryRouter, null, h(Rail, { page: ARTICLE_PAGE, serves }), h(HeaderAsk, { fallback: true, testId: 'rail-fallback-ask' }), h(ArticleAsk, { open: false, waiting, onAsk: () => {} }));
  const m = await mount(page(true));
  try {
    assert.equal(m.asks().length, 1, 'one Ask on the article page');
    assert.equal(m.props(m.asks()[0])['data-testid'], 'article-ask', 'and it is the article\'s');
    assert.equal(m.props(m.asks()[0])['aria-label'], 'Ask Eadwyn', 'no count before the intent has read one');
    await m.render(page(true, 2));
    assert.equal(m.props(m.asks()[0])['aria-label'], 'Ask Eadwyn, 2 waiting');
  } finally { await m.unmount(); }
  __resetEadwynPanelForTest();
  const off = await mount(page(false));
  try {
    assert.equal(off.asks().length, 0, 'no panel serves the viewer: no Ask (AK13)');
  } finally { await off.unmount(); }
});

test('the writing actions open in the docked Ask panel\'s slot, each with its hold quoted as before, and closing the panel closes them', async () => {
  // Mutations checked: ArticleWritingIntent not wrapped in AskIntent → nothing opens the panel or reaches its slot;
  // the quote's stand-in inputs changed → the calls differ; holdsLine replaced → the line differs;
  // the panel's close not reaching onClose → closes stays 0.
  __resetEadwynPanelForTest();
  const quotes = [];
  const restore = [
    stub(articleAuthoringApi, { quote: async (id, option, input) => { quotes.push([id, option, input]); return { ai: true, hold_microusd: 6000 }; } }),
    stub(railProposalsApi, { list: async () => ({ proposals: [] }) }),
  ];
  const out = {};
  const waiting = [];
  let closes = 0;
  const intent = h(ArticleWritingIntent, {
    articleId: 7, editable: true, getContext: () => ({ selection: '', cursorContext: '' }),
    onPlace: () => {}, onApplySeo: () => {}, onApplyHeadline: () => {}, onWaiting: (n) => waiting.push(n), onClose: () => { closes += 1; },
  });
  const view = () => h(MemoryRouter, null, h(Rail, { page: ARTICLE_PAGE, out }), intent);
  const m = await mount(view());
  try {
    assert.equal(out.ask.open, true, 'the intent opened the Ask panel');
    assert.ok(out.ask.intent, 'holding the writing intent');
    assert.equal(out.ask.label, 'Write this article');
    const slot = document.createElement('div');
    await m.act(() => setAskSlot(slot));
    await m.render(view());
    assert.equal(m.byId(slot, 'article-writing-intent').length, 1, 'drawn in the panel\'s slot');
    assert.equal(m.byId(m.container, 'article-writing-intent').length, 0, 'and not beside the article');
    assert.equal(m.byId(slot, 'article-action').length, ARTICLE_ACTIONS.length, 'every action is in the intent');
    // The quotes, exactly as the side panel asked for them (D1408): one per action, with its stand-in.
    const stand = {
      'draft:article-outline': { brief: 'The article' }, 'draft:article-section': { heading: 'Section' },
      'rewrite:article': { selection: 'This sentence.', tone: 'shorter' }, 'draft:article-continue': { cursor_context: 'This sentence.' },
    };
    assert.deepEqual(quotes, ARTICLE_ACTIONS.map((a) => [7, a.option, stand[a.option] || {}]));
    for (const line of m.byId(slot, 'article-action-hold')) assert.equal(m.text(line), 'Holds up to $0.006 · you pay what it uses');
    assert.match(m.text(m.byId(slot, 'article-intent-footer')[0]), /^Nothing goes into your article until you press Insert or Replace\. The text and image models are chosen in the AIRail\.$/);
    assert.equal(waiting.at(-1), 0, 'a read with nothing open is a count of none, which draws nothing');
    await m.act(() => askPanelEvent({ type: 'escape' }));
    assert.equal(closes, 1, 'closing the panel closed the intent');
  } finally { await m.unmount(); restore.forEach((r) => r()); }
});

test('a press quotes then runs; its card says what it charged; nothing is placed until Insert, and a failed waiting read is no count', async () => {
  // Mutations checked: the run without its quote first → the order differs; chargedLine dropped from the card → no charge line;
  // Insert placing before the proposal is decided → `placed` before `decide`; a failed read reported as 0 → waiting is 0.
  __resetEadwynPanelForTest();
  const order = [];
  const restore = [
    stub(articleAuthoringApi, {
      quote: async (id, option, input) => { if (option === 'draft:article-continue') order.push(`quote:${input.cursor_context}`); return { ai: true, hold_microusd: 6000 }; },
      assist: async (id, option) => { order.push(`assist:${option}`); return { proposal: { uid: 'p1', rail_option: 'draft:article-continue', payload: { markdown: 'Next paragraph.' } }, cost: { charged_microusd: 4000 } }; },
    }),
    stub(railProposalsApi, {
      list: async () => { throw new Error('503'); },
      decide: async (uid, decision) => { order.push(`decide:${uid}:${decision}`); return { proposal: {} }; },
    }),
  ];
  const waiting = [];
  const intent = h(ArticleWritingIntent, {
    articleId: 7, editable: true, getContext: () => ({ selection: '', cursorContext: 'So far.', end: 7 }),
    onPlace: (item, mode) => order.push(`placed:${item.proposal.uid}:${mode}`), onApplySeo: () => {}, onApplyHeadline: () => {},
    onWaiting: (n) => waiting.push(n), onClose: () => {},
  });
  const m = await mount(h(MemoryRouter, null, h(Rail, { page: ARTICLE_PAGE }), intent));
  try {
    assert.equal(waiting.at(-1), null, 'a failed read with nothing open is not known, never 0');
    assert.match(m.text(m.byId(m.container, 'article-proposals-unread')[0]), /could not be read\. Try again/, 'and it is said, with Try again');
    const button = (node, re) => m.walk(node).find((n) => n.tagName === 'BUTTON' && re.test(m.text(n)));
    const cont = m.byId(m.container, 'article-action').find((li) => /Continue writing/.test(m.text(li)));
    order.length = 0;
    await m.act(() => m.props(button(cont, /Run/)).onClick());
    assert.deepEqual(order, ['quote:So far.', 'assist:draft:article-continue'], 'the quote of what it will send, then the run');
    assert.equal(m.text(m.byId(m.container, 'article-proposal-cost')[0]), 'Charged $0.004 of $0.006 held · the rest is released');
    assert.equal(waiting.at(-1), 1, 'the open proposal is counted');
    order.length = 0;
    await m.act(() => m.props(button(m.container, /^Insert below$/)).onClick());
    assert.deepEqual(order, ['decide:p1:accept', 'placed:p1:below'], 'decided, then placed in the draft for the page\'s save');
  } finally { await m.unmount(); restore.forEach((r) => r()); }
});

test('the article page: no side panel, one Ask in its header, the writing actions as the Ask panel\'s intent', () => {
  // Mutations checked: the old <ArticleWritingPanel> mount restored → red; the toolbar's second Ask restored → red;
  // Publish…'s field Ask offered with no panel → red.
  assert.equal(existsSync(new URL('../src/pages/articles/ArticleWritingPanel.jsx', import.meta.url)), false, 'the side panel is deleted');
  const page = codeOnly(read('frontend/src/pages/ArticleAuthorPage.jsx'));
  assert.doesNotMatch(page, /ArticleWritingPanel|<aside\b/);
  assert.equal((page.match(/<ArticleAsk /g) || []).length, 1, 'one Ask on the article');
  assert.doesNotMatch(page, /<Sparkles[^>]*\/>\s*Ask/, 'no second, hand-drawn Ask');
  assert.match(page, /<ArticleAsk open=\{asking\} waiting=\{waiting\} onAsk=\{\(\) => openAsk\(\)\} \/>/);
  assert.match(page, /\{asking && \(\s*<ArticleWritingIntent\b/);
  assert.match(page, /onAsk=\{canSendForReview && askServed \? openAsk : null\}/);
  assert.match(page, /const \[waiting, setWaiting\] = useState\(null\);/, 'an unread count starts unknown, never 0');
  const intent = codeOnly(read('frontend/src/pages/articles/ArticleWritingIntent.jsx'));
  assert.match(intent, /<AskIntent label="Write this article" eyebrow="Eadwyn · Articles · Writing" title="Writing" footer=\{footer\} onClose=\{onClose\} testId="article-writing-intent">/);
  assert.doesNotMatch(intent, /<aside\b|<select\b|\bmodel\s*[:=]/, 'no side panel and no model control: the models are the AIRail\'s');
  assert.doesNotMatch(intent, /window\.(alert|confirm|prompt)\(/, 'in-page only');
});
