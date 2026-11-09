/**
 * D4586 part 3 (#4586): the Hypotheses table on methodology v2. A claim's Interview support cell counts each
 * interview once and says support, contradiction and unknown fit together; Contested is a status of its own; and a
 * claim moved only by the methodology changing reads "Method changed", never "Moved".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/claim_status_v2_4586.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS, supportCell } from '../src/pages/cycles/adapters/validate.js';

const row = (o) => RECORDS.experiments.row({ id: 1, hypothesis: 'H1 · x', status: 'testing', evidence: 0, strength: null, ...o });

test('the v2 cell counts each interview once, then support, contradiction and unknown fit together', () => {
  // Mutations checked: the cell reading `evidence` (S + C, so an interview in both counts twice) instead of `interviews`;
  // the unknown-fit part dropped.
  assert.equal(supportCell({ evidence: 9, interviews: 8, supporting: 5, contradicting: 4, fit_unrecorded: 0, both: 1, strength: 'pattern' }),
    '8 interviews · 5 for · 4 against · 1 in both · Pattern');
  assert.equal(supportCell({ evidence: 4, interviews: 6, supporting: 4, contradicting: 0, fit_unrecorded: 2, both: 0 }),
    '6 interviews · 4 for · 0 against · 2 fit not recorded');
  assert.equal(supportCell({ evidence: 0, interviews: 0, supporting: 0, contradicting: 0, fit_unrecorded: 0, both: 0, linked_evidence: { signal: 1 } }),
    '0 interviews · 1 other linked, not in status');
  assert.equal(supportCell({ evidence: 0, interviews: 0, supporting: 0, contradicting: 0, fit_unrecorded: 0, both: 0 }), null,
    'nothing at all is Not recorded, never "0"');
});

test('Contested is its own status, in the table and its filter', () => {
  // Mutations checked: CLAIM_WORD without contested (the cell would be empty).
  assert.deepEqual(row({ status: 'contested' }).cells.status, { text: 'Contested', tone: 'warn' });
  const status = RECORDS.experiments.filters.find((f) => f.key === 'status').options.map((o) => o.value);
  assert.ok(status.indexOf('contested') === status.indexOf('supported') + 1, 'listed beside Supported, in the Worker\'s order');
});

test('a claim moved only by the methodology reads "Method changed"; one its evidence moved reads "Moved"', () => {
  // Mutations checked: `method` read as `recent`.
  assert.equal(row({ status: 'contested', moved: 'method' }).cells.status.text, 'Contested · Method changed');
  assert.equal(row({ status: 'supported', moved: 'recent' }).cells.status.text, 'Supported · Moved');
  assert.equal(row({ status: 'supported', moved: null }).cells.status.text, 'Supported');
});
