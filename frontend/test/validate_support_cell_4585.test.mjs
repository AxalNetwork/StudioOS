/**
 * D4585 (#4585): the Experiments table's Interview support cell names the population the claim's status counts
 * (interviews, through pain links) and says the claim's other linked evidence apart, never as part of it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_support_cell_4585.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS, supportCell } from '../src/pages/cycles/adapters/validate.js';

test('interviews are named as interviews, with their strength', () => {
  assert.equal(supportCell({ evidence: 1, strength: 'anecdote' }), '1 interview · Anecdote');
  assert.equal(supportCell({ evidence: 4, strength: 'pattern', linked_evidence: { interview: 0, signal: 0, metric: 0, experiment: 0 } }), '4 interviews · Pattern');
});

test('other linked evidence is said apart, as not counted in the status', () => {
  assert.equal(supportCell({ evidence: 2, strength: 'pattern', linked_evidence: { interview: 1, signal: 2, metric: 1, experiment: 1 } }),
    '2 interviews · Pattern · 5 other linked, not in status');
  assert.equal(supportCell({ evidence: 0, linked_evidence: { signal: 1 } }), '0 interviews · 1 other linked, not in status',
    'a claim with a pre-sale and no interview does not read as having no evidence');
});

test('nothing at all is null (Not recorded), never "0"', () => {
  assert.equal(supportCell({ evidence: 0, linked_evidence: { interview: 0, signal: 0, metric: 0, experiment: 0 } }), null);
  assert.equal(supportCell({}), null);
  assert.equal(supportCell({ evidence: null, linked_evidence: { signal: null } }), null);
});

test('the experiments row uses it', () => {
  const row = RECORDS.experiments.row({ id: 1, hypothesis: 'H1 · x', status: 'testing', evidence: 1, strength: null, linked_evidence: { metric: 1 } });
  assert.equal(row.cells.evidence, '1 interview · 1 other linked, not in status');
});
