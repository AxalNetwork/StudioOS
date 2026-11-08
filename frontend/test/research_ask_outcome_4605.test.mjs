/**
 * D4605 — the three surfaces that show an Ask outcome say "could not search"
 * for `retrieval_unavailable`, never "nothing in your library answers this",
 * and a partly indexed document reads as partly answerable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETRIEVAL_UNAVAILABLE, isAnswerable } from '../src/pages/research/askOutcome.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the sentence says the library could not be searched and that documents are not the gap', () => {
  assert.match(RETRIEVAL_UNAVAILABLE, /could not be searched/);
  assert.match(RETRIEVAL_UNAVAILABLE, /not a gap in your documents/);
  assert.doesNotMatch(RETRIEVAL_UNAVAILABLE, /nothing in your library/i);
  assert.deepEqual(['indexed', 'partial', 'pending', 'failed', 'unsupported'].map(isAnswerable), [true, true, false, false, false]);
});

test('Ask, the founder desk and the investor workspace each branch on retrieval_unavailable before no_source', () => {
  for (const file of ['../src/pages/research/AskZone.jsx', '../src/pages/founder/FounderResearchDesk.jsx', '../src/pages/investor/InvestorResearchWorkspace.jsx']) {
    const src = read(file);
    // Mutation checked: remove the branch in any one → that file falls through to the no-source or model sentence.
    assert.match(src, /reason === 'retrieval_unavailable' \? RETRIEVAL_UNAVAILABLE/, file);
  }
  assert.match(read('../src/pages/research/AskZone.jsx'), /Ask again/);
  const lib = read('../src/pages/research/LibraryZone.jsx');
  assert.match(lib, /partial: 'Partly answerable'/);
});
