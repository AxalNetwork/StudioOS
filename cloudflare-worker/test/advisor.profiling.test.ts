/**
 * Task #40 — "Profiling completion" scope.
 *
 * The Profile & Fit "Profiling completion" card must measure ONLY the
 * conversational fit.* profiling bank per persona (Skills / Work values / Axal
 * Fit & values), NOT the whole persona dashboard bank. These unit tests pin the
 * pure helpers in services/advisor/questionBank.ts so a future bank edit can't
 * silently reintroduce the "denominator = whole bank" bug.
 *
 * Run via the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor.profiling.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  profilingBankFor,
  profilingSectionsForBank,
  profilingSectionForQuestion,
  FIT_ID_RE,
  bankFor,
  type Persona,
} from '../src/services/advisor/questionBank.ts';

// Expected fit.* bank sizes (founder 20 + investor 13 + partner 12 + mentor 12
// + coach 12, each persona also carrying the 5 shared Axal values).
const EXPECTED: Record<string, number> = {
  founder: 25,
  investor: 18,
  partner: 17,
  mentor: 34, // mentor (12+5) + coach (12+5)
};

test('profilingBankFor returns the fit.* bank sized per persona', () => {
  for (const [persona, size] of Object.entries(EXPECTED)) {
    const bank = profilingBankFor(persona as Persona);
    assert.equal(bank.length, size, `${persona} profiling bank size`);
    // Every question in a profiling bank is a fit.* question.
    for (const q of bank) {
      assert.ok(FIT_ID_RE.test(q.id), `${q.id} should be a fit.* id`);
    }
  }
});

test('admin / unknown personas have no profiling bank (not applicable)', () => {
  assert.equal(profilingBankFor('admin' as Persona).length, 0);
  assert.equal(profilingBankFor('unknown' as Persona).length, 0);
});

test('profiling bank is far smaller than the full working bank', () => {
  // The bug counted the whole persona bank as the denominator; the profiling
  // bank must be a strict, much smaller subset.
  for (const persona of Object.keys(EXPECTED)) {
    const full = bankFor(persona as Persona).length;
    const prof = profilingBankFor(persona as Persona).length;
    assert.ok(prof < full, `${persona}: profiling (${prof}) < full (${full})`);
  }
});

test('sections partition the bank exactly (no overlap, no loss)', () => {
  for (const persona of Object.keys(EXPECTED)) {
    const bank = profilingBankFor(persona as Persona);
    const sections = profilingSectionsForBank(bank);
    const ids = sections.flatMap((s) => s.ids);
    // No duplicates across sections.
    assert.equal(new Set(ids).size, ids.length, `${persona}: sections overlap`);
    // Union equals the whole bank.
    assert.equal(ids.length, bank.length, `${persona}: sections drop questions`);
    // Section keys are stable and labelled.
    for (const s of sections) {
      assert.ok(s.ids.length > 0, `${persona}: empty section leaked`);
      assert.ok(typeof s.label === 'string' && s.label.length > 0);
    }
  }
});

test('section assignment follows skill_axis → value_dim → axal_fit priority', () => {
  const founder = profilingBankFor('founder' as Persona);
  const byId = new Map(founder.map((q) => [q.id, q]));
  // exec_ship_rate carries rubric_category AND skill_axis → Skills wins.
  assert.equal(profilingSectionForQuestion(byId.get('fit.founder.exec_ship_rate')!), 'skills');
  // values_mission carries rubric_category AND value_dim (no skill_axis) → Work values.
  assert.equal(profilingSectionForQuestion(byId.get('fit.founder.values_mission')!), 'work_values');
  // vision_north_star is rubric-only → Axal Fit & values.
  assert.equal(profilingSectionForQuestion(byId.get('fit.founder.vision_north_star')!), 'axal_fit');
  // An Axal value row → Axal Fit & values.
  assert.equal(profilingSectionForQuestion(byId.get('fit.founder.axal_integrity')!), 'axal_fit');
});
