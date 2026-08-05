// Spin-Out deck MANUAL OVERRIDE layer — precedence + safety contract.
//
// The deck renders from live Lab data, and the slide editor used to "edit" it
// by writing back into the project's canonical columns — so a wording change
// made for one investor deck rewrote the Solution module every other surface
// reads. `applySpinoutOverrides` is the layer that fixes that. What it must
// guarantee, and what this file pins:
//
//   1. An override WINS over canonical module data (precedence 1 > 2 > 3).
//   2. It does NOT mutate the bundle it was handed — the assembler's output is
//      shared with the print/share path.
//   3. Only allowlisted narrative scalars are overridable. Chart series, funnel
//      counts and cap-table segments are not: a hand-typed funnel number would
//      let the deck assert a figure the data does not support, which is the
//      exact failure the gaps/DRAFT machinery exists to catch.
//   4. An override RETIRES the gap it answers ("add a one-line thesis" is a
//      false alarm the moment a thesis exists) and can therefore un-DRAFT a
//      Day-28 deck — but never a Day-16 one.
//   5. An empty value is a REVERT, not a blank slide.
//
// Pure node:test — no D1. The D1 shell (load/save) is a thin wrapper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapToSpinoutDeckData } from '../src/services/decks/spinoutDeckData.ts';
import {
  SPINOUT_OVERRIDABLE_KEYS,
  MAX_OVERRIDE_LEN,
  applySpinoutOverrides,
  isOverridableKey,
  sanitizeSpinoutOverrides,
} from '../src/services/decks/spinoutDeckOverrides.ts';
import type { SpinoutDemoDayData } from '../src/services/decks/axalSpinoutDemoDay.ts';

/** An empty project at Day 28 — every module unfilled, so every gap fires. */
const emptySrc = (daysRemaining = 0): SpinoutDemoDayData =>
  ({ meta: { days_remaining: daysRemaining } } as unknown as SpinoutDemoDayData);

/** A project whose Brand module DOES carry a tagline (canonical thesis). */
const withTagline = (tagline: string): SpinoutDemoDayData =>
  ({ meta: { days_remaining: 0 }, brand: { tagline } } as unknown as SpinoutDemoDayData);

const readPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj);

test('every allowlisted key resolves to a real string leaf on the deck data', () => {
  const { data } = mapToSpinoutDeckData(emptySrc());
  for (const key of SPINOUT_OVERRIDABLE_KEYS) {
    const v = readPath(data, key);
    assert.equal(
      typeof v,
      'string',
      `${key} must be a string leaf on SpinoutDeckData — the allowlist has drifted from the shape`,
    );
  }
});

test('the allowlist carries no structured (_json) or chart-bearing field', () => {
  for (const key of SPINOUT_OVERRIDABLE_KEYS) {
    assert.ok(!key.endsWith('_json'), `${key}: structured viz data is never hand-overridable`);
    assert.ok(
      !/\b(stages|segments|funds|kpis|rings|pains|nodes|advisors|founders|items|steps|ready|why|meta|signalX|signalY)$/.test(key),
      `${key}: chart/roster data is derived from the modules, not typed by hand`,
    );
  }
});

test('an override beats canonical module data', () => {
  const base = mapToSpinoutDeckData(withTagline('Canonical tagline from the Brand module.'));
  assert.equal(base.data.cover.thesis, 'Canonical tagline from the Brand module.');

  const out = applySpinoutOverrides(base, { 'cover.thesis': 'Deck-only wording.' });
  assert.equal(out.data.cover.thesis, 'Deck-only wording.', 'precedence: manual > canonical');
  assert.equal(out.fields['cover.thesis'], 'Deck-only wording.', 'the flat field map must follow');
  assert.deepEqual(out.overriddenKeys, ['cover.thesis']);
});

test('applying overrides does not mutate the bundle it was given', () => {
  const base = mapToSpinoutDeckData(withTagline('Canonical.'));
  const before = JSON.stringify(base.data);
  applySpinoutOverrides(base, { 'cover.thesis': 'Overridden.' });
  assert.equal(JSON.stringify(base.data), before, 'the shared assembler output must be untouched');
});

test('an override retires the gap it answers and can un-DRAFT a Day-28 deck', () => {
  const base = mapToSpinoutDeckData(emptySrc(0));
  assert.equal(base.programDay, 28);
  assert.ok(base.gaps.some((g) => g.startsWith('Cover: add a one-line thesis')), 'gap fires when unwritten');
  assert.equal(base.draft, true);

  const out = applySpinoutOverrides(base, { 'cover.thesis': 'A written thesis.' });
  assert.ok(
    !out.gaps.some((g) => g.startsWith('Cover: add a one-line thesis')),
    'once a thesis exists, "add a thesis" is a false alarm',
  );
  assert.equal(out.gaps.length, base.gaps.length - 1, 'exactly one gap retired');
  assert.equal(out.gapFields!.length, out.gaps.length, 'gapFields stays index-aligned with gaps');
  assert.equal(out.draft, true, 'the other 13 gaps still hold it in draft');

  // Clear every field-answerable gap AND the untagged ones, and it flips.
  const noGaps = applySpinoutOverrides({ ...base, gaps: [], gapFields: [] }, { 'cover.thesis': 'x' });
  assert.equal(noGaps.draft, false, 'Day 28 + zero gaps => ready');
});

test('overrides never un-DRAFT a deck that is only part-way through the program', () => {
  const base = mapToSpinoutDeckData(emptySrc(12)); // Day 16 of 28
  assert.equal(base.programDay, 16);
  const out = applySpinoutOverrides({ ...base, gaps: [], gapFields: [] }, { 'cover.thesis': 'x' });
  assert.equal(out.draft, true, 'copy edits do not advance the founder through the program');
  assert.equal(out.programDay, 16, 'programDay is never rewritten by an override');
});

test('unknown, structured and prototype-polluting keys are rejected, not silently dropped', () => {
  const { overrides, rejected } = sanitizeSpinoutOverrides({
    'cover.thesis': 'ok',
    'validation.stages_json': '[["Interviewed",99]]',
    'cover.nope': 'x',
    // COMPUTED key on purpose. Written as a plain `__proto__: 'x'` this is the
    // object-literal prototype SETTER, not an own property — and a string is
    // not a valid prototype, so the engine discards it and the sanitizer never
    // sees the key at all. The computed form creates a real own property, which
    // is what `JSON.parse` on a hostile request body produces and therefore
    // what this test needs to hand over.
    ['__proto__']: 'x',
    'constructor.prototype.polluted': 'x',
  });
  assert.deepEqual(Object.keys(overrides), ['cover.thesis']);
  assert.ok(rejected.includes('validation.stages_json'), 'chart data is not overridable');
  assert.ok(rejected.includes('cover.nope'));
  assert.ok(rejected.includes('__proto__'), 'the __proto__ key must actually reach the sanitizer and be refused');
  assert.equal(({} as any).polluted, undefined, 'no prototype pollution');
  assert.equal(Object.getPrototypeOf(overrides), null, 'the returned map has a null prototype');
  assert.equal(isOverridableKey('validation.stages'), false);
  assert.equal(isOverridableKey('cover.thesis'), true);
});

test('an empty value is a revert, and long values are capped', () => {
  const { overrides } = sanitizeSpinoutOverrides({
    'cover.thesis': '   ',
    'problem.title': null,
    'deal.closingLine': 'x'.repeat(MAX_OVERRIDE_LEN + 200),
  });
  assert.equal('cover.thesis' in overrides, false, 'blank => revert to canonical, not a blank slide');
  assert.equal('problem.title' in overrides, false, 'null => revert');
  assert.equal(overrides['deal.closingLine'].length, MAX_OVERRIDE_LEN);
});

test('no overrides is an exact identity transform', () => {
  const base = mapToSpinoutDeckData(withTagline('Canonical.'));
  const out = applySpinoutOverrides(base, {});
  assert.deepEqual(out.data, base.data);
  assert.deepEqual(out.fields, base.fields);
  assert.deepEqual(out.gaps, base.gaps);
  assert.equal(out.draft, base.draft);
  assert.deepEqual(out.overriddenKeys, []);
});
