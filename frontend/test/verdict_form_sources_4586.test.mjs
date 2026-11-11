/**
 * D4586 part 2 (#4586) — Record a decision's evidence note counts as the Worker's bar does
 * (`decisionEvidenceV2`): each source once, only the chosen hypothesis's evidence, and an
 * experiment only with an observed result. The Worker gives each option its `source`, its
 * `hypothesis_id` and, for an experiment, `observed`; the note only draws, the Worker decides.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/verdict_form_sources_4586.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countedEvidence, evidenceNote } from '../src/pages/cycles/verdictForm.js';

const opt = (value, source, hypothesis_id = 1, extra = {}) => ({ value, label: value, source, hypothesis_id, ...extra });

test('five links to one interview are five checks and one counted source, and the note says so', () => {
  // Mutations checked: counting checks instead of sources; the explaining sentence dropped.
  const options = [1, 2, 3, 4, 5].map((n) => opt(`pain-${n}-12`, 'interview:12'));
  const values = { for: 'h-1', evidence: options.map((o) => o.value) };
  assert.deepEqual(countedEvidence(values, options), { links: 5, counted: 1 });
  assert.equal(evidenceNote(values, { options }),
    "1 of 5 needed before a verdict is given. Below that it is withheld. 5 checked: a source counts once, and only this hypothesis's evidence and observed results count.");
});

test('genuinely distinct sources count one each, and the note reads as before', () => {
  const options = [1, 2, 3, 4, 5].map((n) => opt(`evidence-${n}`, `interview:${n}`));
  const values = { for: 'h-1', evidence: options.map((o) => o.value) };
  assert.deepEqual(countedEvidence(values, options), { links: 5, counted: 5 });
  assert.equal(evidenceNote(values, { options }), '5 of 5 needed before a verdict is given. Below that it is withheld.');
});

test('another hypothesis\'s evidence counts only on a venture decision; an experiment without a result never counts', () => {
  // Mutations checked: the hypothesis match removed; `observed: false` ignored.
  const options = [
    opt('evidence-1', 'interview:1', 1), opt('evidence-2', 'interview:2', 2),
    opt('evidence-3', 'experiment:3', 1, { observed: false }), opt('evidence-4', 'experiment:4', 1, { observed: true }),
  ];
  const evidence = options.map((o) => o.value);
  assert.deepEqual(countedEvidence({ for: 'h-1', evidence }, options), { links: 4, counted: 2 });
  assert.deepEqual(countedEvidence({ for: 'venture', evidence }, options), { links: 4, counted: 3 });
});

test('without the Worker\'s options each check is its own source, as before', () => {
  assert.equal(evidenceNote({ evidence: ['a', 'b'] }), '2 of 5 needed before a verdict is given. Below that it is withheld.');
  assert.equal(evidenceNote({}), '0 of 5 needed before a verdict is given. Below that it is withheld.');
});
