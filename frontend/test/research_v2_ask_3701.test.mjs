/**
 * D3701 (Research v2, #3701), part 3 — Ask (RS-07): each source shows its
 * exact passage and whether its document is still in the library, history is
 * This session / All / Saved answers / Archived, an answer copies with its
 * citations, and Evidence scope is collapsed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_ask_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import { api } from '../src/lib/api.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import { HISTORY_TABS, answerWithCitations, citationAvailability } from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

test('a citation is available or gone only against a library that was read', () => {
  const lib = new Set(['d-1']);
  assert.equal(citationAvailability({ document_uid: 'd-1' }, lib), 'available');
  assert.equal(citationAvailability({ document_uid: 'd-2' }, lib), 'gone');
  // Mutation checked: drop the `!libraryUids` guard → an unread library throws.
  assert.equal(citationAvailability({ document_uid: 'd-2' }, null), null, 'unknown is not gone');
  assert.equal(citationAvailability({ title: 'old row' }, lib), null);
});

test('Copy with citations carries the answer, each numbered source, its page and its passage as recorded', () => {
  const text = answerWithCitations({
    answer: 'C5 in Germany [1].',
    citations: [
      { n: 1, title: 'BSI C5', page: 4, chunk: 0, passage: 'The C5 criteria', passage_truncated: true },
      { n: 2, title: 'Old answer source', chunk: 2 },
    ],
  });
  assert.equal(text, [
    'C5 in Germany [1].', '', 'Sources',
    '[1] BSI C5 (page 4, passage 1)', '    “The C5 criteria…”',
    '[2] Old answer source (passage 3)', '    Passage not recorded for this answer.',
  ].join('\n'));
  assert.equal(answerWithCitations({ answer: 'No sources.', citations: [] }), 'No sources.');
});

test('history is This session, All, Saved answers and Archived (the discarded disposition)', () => {
  assert.deepEqual(HISTORY_TABS.map((t) => [t.view, t.label]), [
    ['session', 'This session'], ['all', 'All'], ['saved', 'Saved answers'], ['discarded', 'Archived'],
  ]);
});

async function mountAsk(items) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  const scopes = [];
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: 1, items: [{ uid: 'd-1', title: 'BSI C5', index_state: 'indexed', in_ask: true }] }),
    askSessions: async (scope) => { scopes.push(scope); return { session: { uid: 's-1' }, items, totals: { asked: items.length, answered: 0, no_source: 0, cost_usd: 0 } }; },
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  await settle();
  return { ...m, scopes, settle, async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; } };
}

const ANSWERED = {
  uid: 'a', question: 'Which rules?', reason: 'answered', answer: 'C5 in Germany [1].', cost_usd: 0.004,
  citations: [
    { n: 1, title: 'BSI C5', document_uid: 'd-1', chunk: 0, page: 4, passage: 'The C5 criteria catalogue applies to cloud providers', passage_truncated: false },
    { n: 2, title: 'Removed memo', document_uid: 'd-gone', chunk: 3, page: null },
  ],
};

test('each source shows its passage, or says it was not recorded, and whether its document is still there', async () => {
  const m = await mountAsk([ANSWERED]);
  try {
    // Mutation checked: render `ct.title` in place of `ct.passage` → the passage is gone.
    assert.equal(textOf(byTid(m, 'ask-passage-a-0')).trim(), 'The C5 criteria catalogue applies to cloud providers');
    const sources = textOf(byTid(m, 'ask-sources-a'));
    assert.match(sources, /Sources used · 2/);
    assert.match(sources, /\[1\] BSI C5 · passage 1page 4✓ Available/);
    assert.match(sources, /\[2\] Removed memo · passage 4⊠ No longer available/);
    assert.match(sources, /Passage not recorded for this answer\./);
    assert.equal(byTid(m, 'ask-passage-a-1'), null);
  } finally { await m.close(); }
});

test('the tabs change the read; Archived is its own read, not a filter over All', async () => {
  const m = await mountAsk([ANSWERED]);
  try {
    assert.deepEqual(m.scopes, ['session']);
    for (const view of ['all', 'saved', 'discarded']) {
      await act(async () => { m.props(byTid(m, `ask-tab-${view}`)).onClick(); });
      await m.settle();
    }
    // Mutation checked: tabs wired to a no-op → the scopes never change.
    //
    // #4610 — ARCHIVED ASKS FOR `discarded`, WHICH IT USED TO SPELL `all`.
    // As a narrowing over `scope=all` it searched only the rows that read
    // returned — the newest two hundred — so an answer archived and then
    // followed by two hundred questions was unreachable from the one tab whose
    // whole purpose is finding archived answers. It is a server scope now,
    // with its own statement, its own cursor and its own totals.
    assert.deepEqual(m.scopes, ['session', 'all', 'saved', 'discarded']);
    assert.equal(m.props(byTid(m, 'ask-tab-discarded'))['aria-selected'], true);
    // The old assertion was `/No discarded answers\./`, and it only held
    // because Archived filtered the rows this mock returns for every scope.
    // Now the tab ASKS for the discarded scope and renders what comes back, so
    // what is pinned is the request — above — and the tab's own selection. The
    // empty-scope sentence is covered where an empty scope can be arranged:
    // `research_shared_history_4610.test.ts` drives the real route.
    assert.equal(m.scopes[m.scopes.length - 1], 'discarded');
  } finally { await m.close(); }
});

test('Copy with citations writes the answer and its sources; Evidence scope starts collapsed', async () => {
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const written = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { written.push(t); } } } });
  const m = await mountAsk([ANSWERED, { uid: 'b', question: 'Q', reason: 'no_source', answer: null, citations: [], cost_usd: 0 }]);
  try {
    await act(async () => { await m.props(byTid(m, 'button-ask-copy-a')).onClick(); });
    assert.equal(written.length, 1);
    assert.match(written[0], /^C5 in Germany \[1\]\.\n\nSources\n\[1\] BSI C5 \(page 4, passage 1\)/);
    assert.match(textOf(byTid(m, 'button-ask-copy-a')), /Copied/);
    assert.equal(byTid(m, 'button-ask-copy-b'), null, 'an unanswered question has nothing to copy');
    const scope = byTid(m, 'ask-evidence-scope');
    assert.equal(scope?.tagName, 'DETAILS');
    assert.equal(m.props(scope).open, undefined, 'collapsed by default');
  } finally {
    await m.close();
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete globalThis.navigator;
  }
});
