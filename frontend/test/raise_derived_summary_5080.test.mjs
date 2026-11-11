/** D5080 (#5080) — derived Raise cards preserve source uncertainty. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { derivedSummary, summarySource } from '../src/lib/derivedSummary.js';

test('a mixed successful and failed read is partial', () => {
  const out = derivedSummary([], [summarySource('prospects', 'ready'), summarySource('commitments', 'unreadable')]);
  assert.equal(out.state, 'partial');
  assert.equal(out.complete, false);
  assert.deepEqual(out.unreadable_sources, ['commitments']);
});

test('a refusal is incomplete and cannot become a measured empty answer', () => {
  const out = derivedSummary([], [summarySource('records', 'refused')]);
  assert.equal(out.state, 'unreadable');
  assert.equal(out.value, null);
});

test('Capital relationships gates categorical copy on completeness', () => {
  const source = readFileSync(new URL('../src/pages/raise/caprel/CapRelOverview.jsx', import.meta.url), 'utf8');
  assert.match(source, /needsSummary\?\.complete && !needs\.length/);
  assert.match(source, /Needs you could not be fully checked\./);
  assert.match(source, /commitment status could not be read/i);
});
