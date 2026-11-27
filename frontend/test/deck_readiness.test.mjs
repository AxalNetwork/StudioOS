// Task #42 — guards the Spin-Out deck pre-flight readiness decision.
//
// Regression target: a deck with NO gaps but draft===true (e.g. program_day < 28)
// must NOT render as "ready". The state must come from the backend `draft` flag,
// never from gaps.length alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deckReadinessState } from '../src/lib/deckReadiness.js';

test('nothing loaded yet => hidden', () => {
  assert.equal(deckReadinessState({}), 'hidden');
  assert.equal(deckReadinessState({ previewLoading: false, deckPreview: null }), 'hidden');
});

test('preview in flight => loading', () => {
  assert.equal(deckReadinessState({ previewLoading: true, deckPreview: null }), 'loading');
});

test('gaps present => gaps (regardless of draft flag)', () => {
  assert.equal(
    deckReadinessState({ deckPreview: { gaps: ['Add founder profile'], draft: true, programDay: 16 } }),
    'gaps',
  );
});

test('no gaps but draft===true (mid-program) => draft, NOT ready', () => {
  const state = deckReadinessState({ deckPreview: { gaps: [], draft: true, programDay: 20 } });
  assert.equal(state, 'draft', 'a complete-but-mid-program deck must stay a draft');
  assert.notEqual(state, 'ready');
});

test('no gaps and draft===false => ready', () => {
  assert.equal(
    deckReadinessState({ deckPreview: { gaps: [], draft: false, programDay: 28 } }),
    'ready',
  );
});

test('loaded preview wins over previewLoading flag', () => {
  assert.equal(
    deckReadinessState({ previewLoading: true, deckPreview: { gaps: [], draft: false, programDay: 28 } }),
    'ready',
  );
});
