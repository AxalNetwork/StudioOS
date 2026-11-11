/**
 * D4612 — the library watches its own indexing, Re-index is a batch that
 * reports each document's outcome, and a failed Ask read is Unreadable.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import LibraryZone from '../src/pages/research/LibraryZone.jsx';
import { api } from '../src/lib/api.js';
import { MAX_POLLS, batchSummary, hasPending, pollDelay, reindexTargets, runBatch } from '../src/pages/research/libraryIndexing.js';
import { rowProblem } from '../src/pages/research/researchStates.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const doc = (uid, index_state, extra = {}) => ({ uid, title: `Doc ${uid}`, kind: 'document', source: 'own', index_state, in_ask: ['indexed', 'partial'].includes(index_state), chunk_count: null, ...extra });
const lib = (items) => ({ items, indexed: items.filter((d) => d.in_ask).length, not_indexed: items.filter((d) => !d.in_ask).length, from_clients: 0 });

test('the schedule is bounded and slows down; pending counts only own documents', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 19].map(pollDelay), [2000, 3000, 5000, 8000, 13000, 15000, 15000]);
  assert.equal(pollDelay(MAX_POLLS), null, 'the schedule ends');
  assert.equal(hasPending([doc('a', 'indexed'), doc('b', 'pending', { source: 'client' })]), false);
  assert.equal(hasPending([doc('a', 'pending')]), true);
});

test('Re-index targets what Ask cannot fully read and is not already being read', () => {
  const items = [doc('a', 'indexed'), doc('b', 'pending'), doc('c', 'failed'), doc('d', 'partial'), doc('e', 'unsupported'), doc('f', 'failed', { source: 'client' })];
  // Mutation checked: keep pending documents in the set → b is resubmitted.
  assert.deepEqual(reindexTargets(items).map((d) => d.uid), ['c', 'd', 'e']);
});

test('the batch runs at most two at once, waits for all, and reports each outcome', async () => {
  let live = 0; let peak = 0;
  const fn = async (uid) => {
    live += 1; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    if (uid === 'q') throw Object.assign(new Error('queued'), { code: 'already_queued' });
    if (uid === 'x') throw Object.assign(new Error('nope'), { code: 'storage_unavailable' });
  };
  const results = await runBatch(['a', 'q', 'x', 'b'], fn, 2);
  assert.equal(peak, 2);
  assert.deepEqual(results.map((r) => [r.uid, r.ok]), [['a', true], ['q', false], ['x', false], ['b', true]]);
  const summary = batchSummary(results, (uid) => `Doc ${uid}`);
  assert.equal(summary.ok, false);
  assert.equal(summary.text, 'Reading 2 again; 1 already being read; 1 could not be re-indexed: Doc x. The states below update when Ask can use them.');
});

test('a failed read offers a retry, an unreadable file a replacement; both say the recorded reason', () => {
  assert.deepEqual(rowProblem(doc('a', 'failed', { index_note: 'Conversion is unavailable.' })), { reason: 'Conversion is unavailable.', action: 'retry', label: 'Retry' });
  assert.equal(rowProblem(doc('a', 'unsupported')).action, 'replace');
  assert.equal(rowProblem(doc('a', 'indexed')), null);
  assert.equal(rowProblem(doc('a', 'failed', { source: 'client' })), null);
});

function stubs(reads) {
  const real = { documents: api.research.documents, collections: api.research.collections, askSessions: api.research.askSessions, reindex: api.research.reindex };
  const calls = { documents: 0, reindex: [] };
  api.research.documents = async () => { const r = reads[Math.min(calls.documents, reads.length - 1)]; calls.documents += 1; if (r instanceof Error) throw r; return r; };
  api.research.collections = async () => ({ items: [] });
  api.research.askSessions = async () => { throw new Error('ask down'); };
  api.research.reindex = async (uid) => { calls.reindex.push(uid); return {}; };
  return { calls, restore() { Object.assign(api.research, real); } };
}

async function mountLibrary() {
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const ui = await mountContracts(h(LibraryZone, { role: 'founder' }), '/research/library', { id: 1, role: 'founder' });
  await settle();
  return { ui, close: async () => { await ui.unmount(); globalThis.matchMedia = oldMedia; } };
}
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
/** Lets every pending promise run without a timer, so it works with mocked timers too. */
const settle = async () => { await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }); };
const tick = async (_ui, ms) => { await act(async () => { mock.timers.tick(ms); }); await settle(); };

test('a pending document reaches indexed on the still-open page, and the watching stops', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = stubs([lib([doc('a', 'pending')]), lib([doc('a', 'pending')]), lib([doc('a', 'indexed')])]);
  const m = await mountLibrary();
  try {
    assert.match(m.ui.text(), /Being read now/);
    // Mutation checked: no watching → this stays "Being read now" with one read.
    await tick(m.ui, 2000);
    await tick(m.ui, 3000);
    assert.equal(s.calls.documents, 3);
    assert.match(m.ui.text(), /✓ Indexed/);
    await tick(m.ui, 60000);
    assert.equal(s.calls.documents, 3, 'nothing pending, so nothing more is read');
  } finally { await m.close(); s.restore(); mock.timers.reset(); }
});

test('unmounting stops the watching', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = stubs([lib([doc('a', 'pending')])]);
  const m = await mountLibrary();
  try {
    await m.close();
    await act(async () => { mock.timers.tick(60000); await Promise.resolve(); });
    assert.equal(s.calls.documents, 1, 'a page that has left reads nothing');
  } finally { s.restore(); mock.timers.reset(); }
});

test('a failed Ask history read is Unreadable, never 0 questions asked', async () => {
  const s = stubs([lib([doc('a', 'indexed')])]);
  const m = await mountLibrary();
  try {
    // Mutation checked: `ask?.asked ?? 0` again → the tile reads 0.
    assert.match(m.ui.text(), /Questions askedUnreadable/);
    assert.match(m.ui.text(), /The Ask figures could not be read/);
  } finally { await m.close(); s.restore(); }
});

test('the failed row names its recorded reason and the next step', async () => {
  const s = stubs([lib([doc('a', 'failed', { index_note: 'Conversion is unavailable right now.' }), doc('b', 'unsupported')])]);
  const m = await mountLibrary();
  try {
    // D3701 RS-06: the reason sits under the name and the row offers Retry.
    assert.match(m.ui.text(), /Conversion is unavailable right now\./);
    // Mutation checked: `problem?.action === 'retry'` → `false` drops the button.
    assert.ok(byTid(m.ui, 'library-retry-a'), 'the failed row offers Retry');
    assert.equal(byTid(m.ui, 'library-retry-b'), null, 'an unsupported file is replaced, not retried');
    assert.match(m.ui.text(), /Remove it and add a version with readable text\./);
  } finally { await m.close(); s.restore(); }
});
