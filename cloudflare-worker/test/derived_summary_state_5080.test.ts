/** D5080 (#5080) — a failed source cannot authorize a categorical summary. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { derivedSummary } from '../src/services/derivedSummaryState.ts';

test('one failed required source makes an otherwise answered summary partial', () => {
  const out = derivedSummary([], [
    { key: 'prospects', state: 'recorded' },
    { key: 'commitments', state: 'unreadable' },
  ]);
  assert.equal(out.state, 'partial');
  assert.equal(out.complete, false);
  assert.deepEqual(out.value, []);
  assert.deepEqual(out.unreadable_sources, ['commitments']);
});

test('all failed required sources make the value unreadable, never empty', () => {
  const out = derivedSummary([], [
    { key: 'room', state: 'unavailable' },
    { key: 'evidence', state: 'unreadable' },
  ]);
  assert.equal(out.state, 'unreadable');
  assert.equal(out.value, null);
  assert.equal(out.complete, false);
});

test('an answered empty value stays a complete measured answer', () => {
  const out = derivedSummary([], [
    { key: 'room', state: 'not_recorded' },
    { key: 'requests', state: 'recorded' },
  ]);
  assert.equal(out.state, 'recorded');
  assert.equal(out.complete, true);
  assert.deepEqual(out.value, []);
});
