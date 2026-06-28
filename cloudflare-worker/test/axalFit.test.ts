/**
 * Task #19 — Axal Fit scoring-engine unit tests.
 *
 * Pure-helper tests only (no auth, no D1): the rubric totals, band thresholds,
 * red-flag detection, signal quality, the 5 Axal values, and the narrative.
 * Mirrors the style of venture_risk.test.ts (part A).
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/axalFit.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AXAL_VALUES,
  VALUE_SPECS,
  RED_FLAGS,
  RED_FLAG_SPECS,
  RUBRICS,
  FIT_PERSONAS,
  isFitPersona,
  BAND_LABEL,
  bandFromScore,
  scoreRubric,
  signalQuality,
  detectRedFlags,
  narrativeFit,
  type FitPersona,
} from '../src/services/axalFit.ts';

// ---------------------------------------------------------------------------
// The 5 Axal behavioral values.
// ---------------------------------------------------------------------------
test('AXAL_VALUES: exactly the 5 named values, each with a spec', () => {
  assert.deepEqual([...AXAL_VALUES], [
    'integrity', 'stewardship', 'curiosity', 'resilience', 'collaboration',
  ]);
  for (const k of AXAL_VALUES) {
    assert.equal(VALUE_SPECS[k].key, k);
    assert.ok(VALUE_SPECS[k].label.length > 0);
    assert.ok(VALUE_SPECS[k].description.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Red flags.
// ---------------------------------------------------------------------------
test('RED_FLAGS: exactly the 7 named flags, each with a spec', () => {
  assert.equal(RED_FLAGS.length, 7);
  assert.deepEqual([...RED_FLAGS], [
    'overconfidence', 'blame_shifting', 'inconsistent_stories',
    'poor_follow_through', 'ego_over_collaboration', 'transactional', 'weak_ethics',
  ]);
  for (const k of RED_FLAGS) assert.equal(RED_FLAG_SPECS[k].key, k);
});

// ---------------------------------------------------------------------------
// Rubrics — exact categories + weights from the spec.
// ---------------------------------------------------------------------------
test('RUBRICS: five fit personas; mentor and coach share one rubric', () => {
  assert.deepEqual(FIT_PERSONAS.sort(), ['coach', 'founder', 'investor', 'mentor', 'partner']);
  assert.deepEqual(RUBRICS.mentor, RUBRICS.coach);
  for (const p of FIT_PERSONAS) assert.ok(isFitPersona(p));
  assert.equal(isFitPersona('admin'), false);
});

test('RUBRICS: founder rubric matches the spec weights exactly', () => {
  assert.deepEqual(RUBRICS.founder, {
    vision_clarity: 15, execution_ability: 20, domain_insight: 15, coachability: 15,
    resilience: 15, communication: 10, team_dynamics: 10, values_fit: 10,
  });
});

test('RUBRICS: investor / partner / mentor rubrics match the spec weights', () => {
  assert.deepEqual(RUBRICS.investor, {
    thesis_fit: 20, capital_quality: 15, governance_style: 15,
    reputation: 20, decision_quality: 15, values_fit: 15,
  });
  assert.deepEqual(RUBRICS.partner, {
    strategic_alignment: 20, trustworthiness: 20, network_quality: 15,
    execution_support: 15, collaboration_style: 15, reputation: 15,
  });
  assert.deepEqual(RUBRICS.mentor, {
    domain_expertise: 25, teaching_ability: 20, listening: 15,
    founder_empathy: 15, reliability: 15, values_alignment: 10,
  });
  // Investor/partner/mentor sum to 100; founder is relative (110) → normalized at score time.
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  assert.equal(sum(RUBRICS.investor), 100);
  assert.equal(sum(RUBRICS.partner), 100);
  assert.equal(sum(RUBRICS.mentor), 100);
});

// ---------------------------------------------------------------------------
// Bands.
// ---------------------------------------------------------------------------
test('bandFromScore: thresholds inclusive at the floor', () => {
  assert.equal(bandFromScore(100), 'strong_yes');
  assert.equal(bandFromScore(85), 'strong_yes');
  assert.equal(bandFromScore(84.9), 'yes_caution');
  assert.equal(bandFromScore(70), 'yes_caution');
  assert.equal(bandFromScore(69.9), 'hold');
  assert.equal(bandFromScore(55), 'hold');
  assert.equal(bandFromScore(54.9), 'no');
  assert.equal(bandFromScore(0), 'no');
  for (const b of Object.keys(BAND_LABEL)) assert.ok(BAND_LABEL[b as keyof typeof BAND_LABEL].length > 0);
});

// ---------------------------------------------------------------------------
// scoreRubric — the core decision rule.
// ---------------------------------------------------------------------------
test('scoreRubric: all categories at 5 → 100, full coverage', () => {
  const all5 = Object.fromEntries(Object.keys(RUBRICS.founder).map((k) => [k, 5]));
  const r = scoreRubric('founder', all5);
  assert.equal(Math.round(r.total_score), 100);
  assert.equal(r.coverage, 1);
  assert.equal(r.answered_weight, r.total_weight);
});

test('scoreRubric: all categories at 3 → 60 (3/5)', () => {
  const all3 = Object.fromEntries(Object.keys(RUBRICS.investor).map((k) => [k, 3]));
  const r = scoreRubric('investor', all3);
  assert.equal(Math.round(r.total_score), 60);
  assert.equal(bandFromScore(r.total_score), 'hold');
});

test('scoreRubric: partial answers normalize by answered weight, coverage reflects gaps', () => {
  // Only one founder category answered, at full marks.
  const r = scoreRubric('founder', { execution_ability: 5 });
  assert.equal(Math.round(r.total_score), 100); // answered-only normalization
  assert.ok(r.coverage > 0 && r.coverage < 1);
  assert.equal(r.per_category.execution_ability.answered, true);
  assert.equal(r.per_category.vision_clarity.answered, false);
});

test('scoreRubric: no answers → 0 score, 0 coverage (no NaN)', () => {
  const r = scoreRubric('partner', {});
  assert.equal(r.total_score, 0);
  assert.equal(r.coverage, 0);
  assert.equal(bandFromScore(r.total_score), 'no');
});

test('scoreRubric: out-of-range raw scores are clamped to 0..5', () => {
  const r = scoreRubric('mentor', { domain_expertise: 9, teaching_ability: -3 });
  assert.equal(r.per_category.domain_expertise.score, 5);
  assert.equal(r.per_category.teaching_ability.score, 0);
});

// ---------------------------------------------------------------------------
// signalQuality.
// ---------------------------------------------------------------------------
test('signalQuality: 0.6×coverage + 0.4×confidence, clamped', () => {
  assert.equal(signalQuality(1, 1), 1);
  assert.equal(signalQuality(0, 0), 0);
  assert.ok(Math.abs(signalQuality(0.5, 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(signalQuality(1, 0) - 0.6) < 1e-9);
  assert.ok(Math.abs(signalQuality(0, 1) - 0.4) < 1e-9);
  assert.equal(signalQuality(2, 2), 1); // clamps inputs
});

// ---------------------------------------------------------------------------
// detectRedFlags.
// ---------------------------------------------------------------------------
test('detectRedFlags: fires at or below threshold, dedups, stable order', () => {
  const flags = detectRedFlags([
    { key: 'blame_shifting', score: 1, at_or_below: 2 },     // fires
    { key: 'overconfidence', score: 3, at_or_below: 2 },     // no
    { key: 'blame_shifting', score: 0, at_or_below: 2 },     // dup → still one
    { key: 'weak_ethics', score: 2, at_or_below: 2 },        // fires (inclusive)
  ]);
  assert.deepEqual(flags, ['blame_shifting', 'weak_ethics']); // RED_FLAGS order
});

test('detectRedFlags: empty probes → no flags', () => {
  assert.deepEqual(detectRedFlags([]), []);
});

// ---------------------------------------------------------------------------
// narrativeFit.
// ---------------------------------------------------------------------------
test('narrativeFit: includes band label; degrades gracefully with no signal', () => {
  const empty = scoreRubric('founder', {});
  const none = narrativeFit('founder', empty, bandFromScore(empty.total_score), []);
  assert.match(none, /Not enough signal/i);

  const all5 = Object.fromEntries(Object.keys(RUBRICS.founder).map((k) => [k, 5]));
  const strong = scoreRubric('founder', all5);
  const band = bandFromScore(strong.total_score);
  const text = narrativeFit('founder', strong, band, []);
  assert.ok(text.includes(BAND_LABEL[band]));
});

test('narrativeFit: surfaces red flags when present', () => {
  const r = scoreRubric('founder', { coachability: 1, vision_clarity: 4 });
  const text = narrativeFit('founder', r, bandFromScore(r.total_score), ['overconfidence']);
  assert.match(text, /red flags/i);
  assert.match(text, /overconfidence/);
});

// Type-level guard: FIT_PERSONAS is the FitPersona union.
const _persona: FitPersona = FIT_PERSONAS[0];
void _persona;
