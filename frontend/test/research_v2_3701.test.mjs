/**
 * D3701 (Research v2, #3701), part 1 — the Library keeps index state and
 * answerability apart (RS-06, RS-10C), and Ask names each exchange's response
 * state without collapsing one into another (RS-07C).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import AskZone from '../src/pages/research/AskZone.jsx';
import LibraryZone from '../src/pages/research/LibraryZone.jsx';
import { api } from '../src/lib/api.js';
import { RailPageProvider } from '../src/ui/railCrumbs.js';
import {
  ASK_STATES, NOT_RECORDED, answerabilityOf, askStateOf, indexStateOf, rowProblem,
} from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const doc = (uid, index_state, extra = {}) => ({
  uid, title: `Doc ${uid}`, kind: 'document', source: 'own', index_state,
  in_ask: ['indexed', 'partial'].includes(index_state), chunk_count: null, ...extra,
});

test('index state is the indexer’s word; an unknown state is Not recorded, never a guess', () => {
  assert.deepEqual(
    ['indexed', 'partial', 'pending', 'unsupported', 'failed'].map((s) => indexStateOf({ index_state: s }).label),
    ['Indexed', 'Partly indexed', 'Queued', 'Unsupported', 'Failed'],
  );
  // Mutation checked: fall back to the raw value → 'uploading' leaks onto the page.
  assert.equal(indexStateOf({ index_state: 'uploading' }).label, NOT_RECORDED);
  assert.equal(indexStateOf(null).label, NOT_RECORDED);
  // No index-state label says "answerable": that is the other column.
  for (const s of Object.values(['indexed', 'partial', 'pending', 'unsupported', 'failed'].map((x) => indexStateOf({ index_state: x })))) {
    assert.doesNotMatch(s.label, /answerable/i);
  }
});

test('answerability is the worker’s in_ask, so an indexed client document is not answerable', () => {
  const shared = answerabilityOf(doc('c', 'indexed', { source: 'client', in_ask: false }));
  assert.equal(shared.label, 'Not answerable');
  assert.equal(shared.why, 'Indexed in their library, not yours.');
  // Mutation checked: derive from index_state again → a payload with no
  // `in_ask` reads as Answerable.
  assert.equal(answerabilityOf({ index_state: 'indexed', source: 'own' }).label, 'Not answerable');
  assert.equal(answerabilityOf(doc('a', 'indexed')).label, 'Answerable');
  assert.equal(answerabilityOf(doc('a', 'indexed')).why, null);
  const part = answerabilityOf(doc('p', 'partial', { index_note: '3 of 9 passages indexed.' }));
  assert.deepEqual([part.label, part.why], ['Partly answerable', '3 of 9 passages indexed.']);
  assert.equal(answerabilityOf(doc('q', 'pending')).why, 'Being read now.');
});

test('a failed row says why and offers Retry; an unsupported one is replaced; a client’s offers nothing', () => {
  assert.deepEqual(rowProblem(doc('a', 'failed', { index_note: 'No text could be extracted.' })),
    { reason: 'No text could be extracted.', action: 'retry', label: 'Retry' });
  assert.equal(rowProblem(doc('a', 'failed')).reason, 'The last read failed.');
  assert.equal(rowProblem(doc('b', 'unsupported')).action, 'replace');
  assert.equal(rowProblem(doc('c', 'failed', { source: 'client' })), null);
  assert.equal(rowProblem(doc('d', 'pending')), null);
});

test('seven response states, kept apart; Insufficient evidence is proposed and never assigned', () => {
  assert.deepEqual(Object.keys(ASK_STATES), [
    'answered', 'no_source', 'no_answerable_documents', 'retrieval_unavailable',
    'model_unavailable', 'insufficient_evidence', 'source_unavailable',
  ]);
  const labels = Object.values(ASK_STATES).map((s) => s.label);
  assert.equal(new Set(labels).size, 7, 'two states share a label');
  assert.equal(ASK_STATES.insufficient_evidence.proposed, true);
  const reasons = ['answered', 'no_source', 'retrieval_unavailable', 'model_unavailable', 'something_new'];
  const got = reasons.map((reason) => askStateOf({ reason, citations: [] }, { libraryUids: new Set() }));
  assert.deepEqual(got, ['answered', 'no_source', 'retrieval_unavailable', 'model_unavailable', null]);
  assert.ok(!got.includes('insufficient_evidence'));
  // Mutation checked: drop the `=== 0` test → every no_source reads as an empty library.
  assert.equal(askStateOf({ reason: 'no_source', indexed_documents: 0 }), 'no_answerable_documents');
  assert.equal(askStateOf({ reason: 'no_source', indexed_documents: 4 }), 'no_source');
  // Amber is reserved for the proposed Insufficient evidence; the recorded states are not amber.
  for (const k of ['no_source', 'retrieval_unavailable', 'model_unavailable', 'source_unavailable']) {
    assert.notEqual(ASK_STATES[k].tone, 'warn', k);
  }
});

test('a citation reads as gone only when the library read succeeded', () => {
  const t = { reason: 'answered', citations: [{ document_uid: 'd-1' }, { document_uid: 'd-gone' }] };
  assert.equal(askStateOf(t, { libraryUids: new Set(['d-1', 'd-gone']) }), 'answered');
  // Mutation checked: `libraryUids &&` removed → an unread library throws or flags every answer.
  assert.equal(askStateOf(t, { libraryUids: new Set(['d-1']) }), 'source_unavailable');
  assert.equal(askStateOf(t, { libraryUids: null }), 'answered', 'an unread library is not evidence a source was removed');
  assert.equal(askStateOf({ reason: 'answered', citations: [{ title: 'old row, no uid' }] }, { libraryUids: new Set() }), 'answered');
});

async function mountAsk(items, library = [doc('d-1', 'indexed')]) {
  const original = { research: api.research, aiPricing: api.aiPricing };
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => ({ indexed: library.filter((d) => d.in_ask).length, items: library }),
    askSessions: async () => ({ session: { uid: 's-1' }, items, totals: { asked: items.length, answered: 0, no_source: 0, cost_usd: 0 } }),
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  for (let i = 0; i < 4; i += 1) await m.flush();
  return { ...m, async close() { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; } };
}
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

test('Ask labels each exchange with its own state, and a removed source is named', async () => {
  const items = [
    { uid: 'a', question: 'Q1', reason: 'answered', answer: 'Yes.', citations: [{ title: 'Doc d-1', document_uid: 'd-1', chunk: 0 }], cost_usd: 0.001 },
    { uid: 'b', question: 'Q2', reason: 'no_source', answer: null, citations: [], cost_usd: 0 },
    { uid: 'c', question: 'Q3', reason: 'retrieval_unavailable', answer: null, citations: [], cost_usd: 0 },
    { uid: 'd', question: 'Q4', reason: 'model_unavailable', answer: null, citations: [{ title: 'Doc d-1', document_uid: 'd-1', chunk: 1 }], cost_usd: 0 },
    { uid: 'e', question: 'Q5', reason: 'answered', answer: 'Was so.', citations: [{ title: 'Removed', document_uid: 'd-gone', chunk: 0 }], cost_usd: 0.001 },
  ];
  const m = await mountAsk(items);
  try {
    const label = (uid) => textOf(byTid(m, `ask-state-${uid}`)).trim();
    assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(label), [
      '✓ Answered', '○ No relevant source found', '⊠ Search temporarily unavailable',
      '✕ Model unavailable', '⊠ Source no longer available',
    ]);
    // Each refusal offers its own next step, not one shared one.
    assert.match(textOf(byTid(m, 'ask-exchange-b')), /Add evidence/);
    assert.match(textOf(byTid(m, 'button-ask-retry-c')), /Ask again/);
    assert.match(textOf(byTid(m, 'button-ask-retry-d')), /Try again/);
    assert.equal(byTid(m, 'button-ask-retry-b'), null, 'no source is not retried: the library is the gap');
    assert.match(textOf(byTid(m, 'ask-exchange-e')), /A cited document was removed after this answer/);
    assert.match(textOf(byTid(m, 'ask-exchange-e')), /Was so\./, 'the answer is kept as written');
  } finally { await m.close(); }
});

test('Ask never calls a source removed when the library could not be read', async () => {
  const original = { research: api.research, aiPricing: api.aiPricing };
  api.aiPricing = async () => null;
  api.research = {
    ...original.research,
    documents: async () => { throw new Error('down'); },
    askSessions: async () => ({ session: { uid: 's-1' }, items: [{ uid: 'e', question: 'Q', reason: 'answered', answer: 'A', citations: [{ title: 'X', document_uid: 'd-x' }], cost_usd: 0 }] }),
  };
  const m = await mountContracts(h(RailPageProvider, { role: 'founder' }, h(AskZone)), '/research/ask');
  try {
    for (let i = 0; i < 4; i += 1) await m.flush();
    assert.doesNotMatch(m.text(), /Source no longer available/);
  } finally { await m.unmount(); api.research = original.research; api.aiPricing = original.aiPricing; }
});

test('the Library draws index state and answerability as two pills, on the table and on the phone cards', async () => {
  const original = { documents: api.research.documents, collections: api.research.collections, askSessions: api.research.askSessions };
  api.research.documents = async () => ({
    items: [doc('a', 'indexed'), doc('c', 'indexed', { source: 'client', in_ask: false, source_label: 'From Verwood' }), doc('f', 'failed', { index_note: 'No text could be extracted.' })],
    indexed: 1, not_indexed: 2, from_clients: 1,
  });
  api.research.collections = async () => ({ items: [] });
  api.research.askSessions = async () => ({ items: [], totals: { asked: 0 } });
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const m = await mountContracts(h(LibraryZone, { role: 'advisor' }), '/research/library', { id: 1, role: 'advisor' });
  try {
    for (let i = 0; i < 4; i += 1) await m.flush();
    const cards = textOf(byTid(m, 'library-cards'));
    // Mutation checked: render `an` in the first pill → the client card reads "Answerable".
    assert.match(cards, /Doc c✓ Indexed⊘ Not answerable/, 'an indexed client document is not answerable');
    assert.match(cards, /Doc f✕ Failed⊘ Not answerable/);
    assert.match(cards, /No text could be extracted\./);
    assert.ok(byTid(m, 'library-card-retry-f'), 'the failed card offers Retry');
    assert.equal(byTid(m, 'library-card-retry-a'), null);
    const table = textOf(byTid(m, 'library-documents'));
    assert.match(table, /Answerable in Ask/);
    assert.match(table, /Indexed in their library, not yours\./);
    assert.match(m.text(), /Evidence Library/);
  } finally {
    await m.unmount(); globalThis.matchMedia = oldMedia; Object.assign(api.research, original);
  }
});
