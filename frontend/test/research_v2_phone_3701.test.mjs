/**
 * D3701 (Research v2, #3701), part 6 — phone (RS-10B): on a phone Ask lists
 * each source as a 44px button, and a tapped source opens a bottom sheet
 * with its page, its availability, its passage and Open in Library. Wider
 * screens keep the inline list (part 3).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_phone_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import { api } from '../src/lib/api.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

const ANSWERED = {
  uid: 'a', question: 'Which rules?', reason: 'answered', answer: 'C5 in Germany [1].', cost_usd: 0.004,
  citations: [
    { n: 1, title: 'BSI C5', document_uid: 'd-1', chunk: 0, page: 4, passage: 'The C5 criteria catalogue applies to cloud providers', passage_truncated: true, cited: true },
    { n: 2, title: 'Removed memo', document_uid: 'd-gone', chunk: 3, page: null },
  ],
};

async function mountAsk(phone) {
  const original = { research: api.research, aiPricing: api.aiPricing, matchMedia: globalThis.matchMedia };
  globalThis.matchMedia = (q) => ({ matches: phone, media: q, addEventListener() {}, removeEventListener() {} });
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 1, items: [{ uid: 'd-1', title: 'BSI C5', index_state: 'indexed', in_ask: true }] }),
    askSessions: async () => ({ session: { uid: 's-1' }, items: [ANSWERED], totals: { asked: 1, answered: 1, no_source: 0, cost_usd: 0 } }),
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  for (let i = 0; i < 4; i += 1) await m.flush();
  return {
    ...m,
    async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; globalThis.matchMedia = original.matchMedia; },
  };
}

test('on a phone each source is a button, and the passage opens in a bottom sheet', async () => {
  const m = await mountAsk(true);
  try {
    // Mutation checked: `phone ?` → `false ?` → the inline list draws and no button exists.
    assert.ok(byTid(m, 'ask-source-buttons-a'), 'the sources are buttons on a phone');
    assert.equal(byTid(m, 'ask-passage-a-0'), null, 'the passage is not inline on a phone');
    assert.equal(byTid(m, 'ask-source-sheet'), null, 'no sheet until a source is tapped');
    await act(async () => { m.props(byTid(m, 'ask-source-open-a-0')).onClick(); });
    const sheet = textOf(byTid(m, 'ask-source-sheet'));
    assert.match(sheet, /BSI C5/);
    assert.match(sheet, /page 4 · passage 1/);
    assert.match(sheet, /✓ Available/);
    assert.equal(textOf(byTid(m, 'ask-source-sheet-passage')).trim(), 'The C5 criteria catalogue applies to cloud providers…');
    assert.equal(m.props(byTid(m, 'ask-source-sheet-open')).href, '/research/library#document-d-1');
  } finally { await m.close(); }
});

test('a removed source opens without Open in Library, and says its passage was not recorded', async () => {
  const m = await mountAsk(true);
  try {
    await act(async () => { m.props(byTid(m, 'ask-source-open-a-1')).onClick(); });
    const sheet = textOf(byTid(m, 'ask-source-sheet'));
    assert.match(sheet, /⊠ No longer available/);
    assert.match(sheet, /Passage not recorded for this answer\./);
    // Mutation checked: drop the `!== 'gone'` test → a link to a document that is not there.
    assert.equal(byTid(m, 'ask-source-sheet-open'), null);
  } finally { await m.close(); }
});

test('wider screens keep the inline list and no source buttons', async () => {
  const m = await mountAsk(false);
  try {
    assert.equal(byTid(m, 'ask-source-buttons-a'), null);
    assert.ok(byTid(m, 'ask-passage-a-0'));
  } finally { await m.close(); }
});
