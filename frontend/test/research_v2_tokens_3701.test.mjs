/**
 * D3701 (Research v2, #3701), part 4 — RS-11's "You're out of AI tokens".
 * The Worker answers a budget stop on Ask with 402 in the budget's words and
 * stores nothing; Ask and the founder desk draw it as its own card with Add
 * tokens, and any other failure keeps its own message.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_tokens_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import FounderResearchDesk from '../src/pages/founder/FounderResearchDesk.jsx';
import { api } from '../src/lib/api.js';
import { ADD_TOKENS_EVENT } from '../src/lib/aiTokens.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { tokensRefusal } from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const refusal = (status, message, code) => Object.assign(new Error(message), { status, code });
const WORDS = 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.';

test('only a 402 is a budget stop, in the budget\'s own words', () => {
  const stop = tokensRefusal(refusal(402, WORDS, 'budget_user_month'));
  assert.equal(stop.title, 'You’re out of AI tokens');
  assert.equal(stop.body, WORDS);
  assert.match(stop.note, /history stays readable/);
  // Mutation checked: `err.status !== 402` dropped → a 503 reads as out of tokens.
  assert.equal(tokensRefusal(refusal(503, 'down')), null);
  assert.equal(tokensRefusal(refusal(403, 'off', 'assist_off')), null);
  assert.equal(tokensRefusal(null), null);
});

/** The test DOM's window has no event methods; record what `openAddTokens` dispatches. Call after mounting. */
function listen() {
  const seen = [];
  const had = Object.prototype.hasOwnProperty.call(window, 'dispatchEvent');
  const prev = window.dispatchEvent;
  window.dispatchEvent = (e) => { if (e.type === ADD_TOKENS_EVENT) seen.push(e.detail); return true; };
  return { seen, off: () => { if (had) window.dispatchEvent = prev; else delete window.dispatchEvent; } };
}

async function mountAsk(askImpl) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 1, items: [{ uid: 'd-1', title: 'Doc', index_state: 'indexed', in_ask: true }] }),
    askSessions: async () => ({ session: { uid: 's-1' }, items: [], totals: { asked: 0, answered: 0, no_source: 0, cost_usd: 0 } }),
    ask: askImpl,
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  return {
    ...m, settle,
    async ask(q) {
      const area = m.nodes().find((n) => n.tagName === 'TEXTAREA');
      await act(async () => { m.props(area).onChange({ target: { value: q } }); });
      const form = m.nodes().find((n) => n.tagName === 'FORM');
      await act(async () => { await m.props(form).onSubmit({ preventDefault() {} }); });
      await settle();
    },
    async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; },
  };
}

test('Ask: a budget stop is its own card, and Add tokens opens the sheet from Ask', async () => {
  const m = await mountAsk(async () => { throw refusal(402, WORDS, 'budget_user_month'); });
  let l = { off() {} };
  try {
    await m.ask('What need recurs?');
    const card = byTid(m, 'ask-out-of-tokens');
    // Mutation checked: the 402 sent to setError → no card.
    assert.ok(card, 'the out-of-tokens card is drawn');
    assert.match(textOf(card), /You’re out of AI tokens/);
    assert.match(textOf(card), /Add tokens to continue\./);
    l = listen();
    await act(async () => { m.props(byTid(m, 'ask-add-tokens')).onClick(); });
    assert.deepEqual(l.seen, [{ from: 'Research › Ask', pack_uid: null }]);
  } finally { l.off(); await m.close(); }
});

test('Ask: any other failure keeps its own message and draws no tokens card', async () => {
  const m = await mountAsk(async () => { throw refusal(503, 'The AI check could not run. Nothing was charged.', 'guard_unavailable'); });
  try {
    await m.ask('What need recurs?');
    assert.equal(byTid(m, 'ask-out-of-tokens'), null);
    assert.match(m.text(), /The AI check could not run\. Nothing was charged\./);
  } finally { await m.close(); }
});

test('the founder desk: a budget stop is the same card, with Add tokens', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  const realAsk = api.research.ask;
  api.research.ask = async () => { throw refusal(402, WORDS, 'kill_switch'); };
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  let l = { off() {} };
  const m = await mountContracts(h(FounderResearchDesk), '/research', { id: 1, role: 'founder' });
  try {
    for (let i = 0; i < 4; i += 1) await m.flush();
    await act(async () => { m.props(byTid(m, 'input-research-question')).onChange({ target: { value: 'What need recurs?' } }); });
    const form = m.nodes().find((n) => n.tagName === 'FORM');
    await act(async () => { await m.props(form).onSubmit({ preventDefault() {} }); });
    for (let i = 0; i < 4; i += 1) await m.flush();
    // Mutation checked: the desk's 402 sent to setAskError → no card, only a red line.
    assert.match(textOf(byTid(m, 'status-research-out-of-tokens')), /You’re out of AI tokens/);
    assert.equal(byTid(m, 'status-research-ask-error'), null);
    l = listen();
    await act(async () => { m.props(byTid(m, 'button-research-add-tokens')).onClick(); });
    assert.deepEqual(l.seen, [{ from: 'Research', pack_uid: null }]);
  } finally {
    l.off(); await m.unmount(); globalThis.fetch = realFetch; api.research.ask = realAsk; globalThis.matchMedia = oldMedia;
  }
});
