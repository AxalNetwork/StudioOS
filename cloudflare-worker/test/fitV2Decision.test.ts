/**
 * Task #19 — Axal VC Fit & Values v2 decision engine unit tests.
 *
 * Pure-core tests only (no auth, no D1): the 6 weighted outcomes, band mapping,
 * partial-coverage normalization, red-flag penalties, contradiction validation,
 * and confidence. Mirrors the style of axalFit.test.ts.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fitV2Decision.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOME_SPECS,
  computeFitV2Decision,
  type FitV2DecisionInput,
} from '../src/services/fitV2Decision.ts';
import { FIT_V2_VALUES, type FitV2ValueRow } from '../src/services/axalFit.ts';

function values(overrides: Partial<Record<string, number>> = {}, confidence = 0.9): FitV2ValueRow[] {
  return FIT_V2_VALUES.map((key) => ({
    value_key: key,
    label: key,
    score: overrides[key] ?? 0.8,
    confidence,
  }));
}

const base = (over: Partial<FitV2DecisionInput> = {}): FitV2DecisionInput => ({
  persona: 'founder',
  values: values(),
  fitScore: 80,
  redFlags: [],
  archetype: {
    slug: 'builder', label: 'The Builder', tagline: 't',
    distance: 0.5, runner_up_slug: 'scout', margin: 0.4,
    traits_covered: 4, confidence: 0.7, trait_scores: {},
  },
  computed_at: '2026-07-13T00:00:00.000Z',
  ...over,
});

test('OUTCOME_SPECS: six outcomes with positive weights', () => {
  assert.equal(OUTCOME_SPECS.length, 6);
  const keys = OUTCOME_SPECS.map((o) => o.key).sort();
  assert.deepEqual(keys, [
    'archetype_clarity', 'capability', 'collaboration',
    'drive_ambition', 'integrity_trust', 'values_alignment',
  ]);
  for (const o of OUTCOME_SPECS) assert.ok(o.weight > 0, `${o.key} weight`);
});

test('FIT_V2_VALUES: exactly six values incl. ambition', () => {
  assert.equal(FIT_V2_VALUES.length, 6);
  assert.ok(FIT_V2_VALUES.includes('ambition'));
});

test('strong profile → high score + strong band, full coverage', () => {
  const d = computeFitV2Decision(base());
  assert.equal(d.outcomes.length, 6);
  assert.ok(d.outcomes.every((o) => o.answered));
  assert.equal(d.coverage, 1);
  assert.ok(d.overall_score >= 70, `overall ${d.overall_score}`);
  assert.ok(['strong_yes', 'yes_caution'].includes(d.band));
  assert.ok(d.confidence > 0.5);
  assert.equal(d.archetype?.slug, 'builder');
});

test('no signal at all → zero score, band "no", answered:false', () => {
  const d = computeFitV2Decision(base({
    values: values({}, 0), // confidence 0 everywhere = no signal
    fitScore: null,
    archetype: null,
  }));
  assert.equal(d.overall_score, 0);
  assert.equal(d.band, 'no');
  assert.equal(d.coverage, 0);
  assert.ok(d.outcomes.every((o) => !o.answered));
  assert.ok(d.validation.some((v) => v.key === 'thin_signal'));
});

test('partial coverage: missing outcomes excluded from denominator, not scored as 0', () => {
  // Only capability has signal; everything else absent.
  const d = computeFitV2Decision(base({
    values: values({}, 0),
    fitScore: 90,
    archetype: null,
  }));
  const capability = d.outcomes.find((o) => o.key === 'capability')!;
  assert.ok(capability.answered);
  assert.equal(capability.score, 90);
  // Overall reflects only the answered outcome, not dragged to ~15 by zeros.
  assert.equal(d.overall_score, 90);
  assert.ok(d.coverage < 1 && d.coverage > 0);
});

test('red flags reduce integrity & trust and surface as flag validations', () => {
  const clean = computeFitV2Decision(base());
  const flagged = computeFitV2Decision(base({ redFlags: ['ego_over_collaboration', 'shortcuts_over_integrity'] }));
  const cleanIt = clean.outcomes.find((o) => o.key === 'integrity_trust')!.score;
  const flaggedIt = flagged.outcomes.find((o) => o.key === 'integrity_trust')!.score;
  assert.ok(flaggedIt < cleanIt, `flagged ${flaggedIt} < clean ${cleanIt}`);
  const flagNotes = flagged.validation.filter((v) => v.severity === 'flag');
  assert.equal(flagNotes.length, 2);
});

test('red flags WITHOUT integrity value signal do not manufacture positive trust', () => {
  // No integrity/stewardship signal (confidence 0), but red flags fired.
  const d = computeFitV2Decision(base({
    values: values({}, 0),
    fitScore: null,
    archetype: null,
    redFlags: ['shortcuts_over_integrity'],
  }));
  const it = d.outcomes.find((o) => o.key === 'integrity_trust')!;
  // Stays unanswered (score 0, not a high fabricated baseline like 0.85*100).
  assert.equal(it.answered, false);
  assert.equal(it.score, 0);
  // Flag still surfaces as a validation note.
  assert.ok(d.validation.some((v) => v.severity === 'flag'));
  // And overall isn't inflated by a phantom trust reading.
  assert.equal(d.overall_score, 0);
});

test('validation: high ambition + low integrity is warned', () => {
  const d = computeFitV2Decision(base({
    values: values({ ambition: 0.95, integrity: 0.2 }),
  }));
  assert.ok(d.validation.some((v) => v.key === 'ambition_vs_integrity' && v.severity === 'warn'));
});

test('deterministic: same input → identical output', () => {
  const a = computeFitV2Decision(base());
  const b = computeFitV2Decision(base());
  assert.deepEqual(a, b);
});
