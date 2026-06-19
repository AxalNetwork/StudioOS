// Axal Fit scorecard — unit tests for the pure rubric math + thresholds.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RUBRICS, AXAL_VALUE_KEYS, bandFromScore, scoreRubric,
} from '../src/services/axalFit.ts';

test('bandFromScore matches the recommended thresholds', () => {
  assert.equal(bandFromScore(100), 'strong_yes');
  assert.equal(bandFromScore(85), 'strong_yes');
  assert.equal(bandFromScore(84), 'yes_caution');
  assert.equal(bandFromScore(70), 'yes_caution');
  assert.equal(bandFromScore(69), 'hold');
  assert.equal(bandFromScore(55), 'hold');
  assert.equal(bandFromScore(54), 'no');
  assert.equal(bandFromScore(0), 'no');
});

test('coach shares the mentor rubric; the 5 Axal values are present', () => {
  assert.equal(RUBRICS.coach, RUBRICS.mentor);
  assert.equal(AXAL_VALUE_KEYS.length, 5);
  assert.deepEqual(AXAL_VALUE_KEYS, ['integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration']);
});

test('all-5s yields 100 / strong_yes with full coverage', () => {
  const allFive = Object.fromEntries(RUBRICS.founder.map((c) => [c.key, 5]));
  const r = scoreRubric('founder', allFive);
  assert.equal(r.total_score, 100);
  assert.equal(r.band, 'strong_yes');
  assert.equal(r.coverage, 1);
  // Normalized weights sum to ~100.
  const sumW = r.breakdown.reduce((s, b) => s + b.weight, 0);
  assert.ok(Math.abs(sumW - 100) < 0.5, `weights sum ~100, got ${sumW}`);
});

test('partial answers score on answered weight and report coverage', () => {
  // execution_ability (w20) = 5, vision_clarity (w15) = 0, rest unanswered.
  const r = scoreRubric('founder', { execution_ability: 5, vision_clarity: 0 });
  // earned = 20*1 + 15*0 = 20; answeredWeight = 35 → 57.
  assert.equal(r.total_score, 57);
  assert.equal(r.band, 'hold');
  assert.equal(Math.round(r.coverage * 100) / 100, Math.round((2 / 8) * 100) / 100);
  // Unanswered categories carry a null score and 0 contribution.
  const coach = r.breakdown.find((b) => b.key === 'coachability');
  assert.equal(coach?.score, null);
  assert.equal(coach?.contribution, 0);
});

test('weighting favors heavier categories', () => {
  // Strong on the 20-weight execution, weak on a 10-weight category.
  const heavy = scoreRubric('founder', { execution_ability: 5, communication: 1 });
  // earned = 20 + 10*0.2 = 22; answeredWeight = 30 → round(22/30*100)=73.
  assert.equal(heavy.total_score, 73);
});

test('every persona rubric is non-empty and weights are positive', () => {
  for (const persona of ['founder', 'investor', 'partner', 'mentor', 'coach'] as const) {
    const rubric = RUBRICS[persona];
    assert.ok(rubric.length >= 5, `${persona} has categories`);
    assert.ok(rubric.every((c) => c.weight > 0), `${persona} weights positive`);
  }
});
