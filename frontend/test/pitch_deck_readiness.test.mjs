/**
 * Pitch Deck Builder — per-slide readiness must reflect the founder's actual work.
 *
 * THE BUG THIS EXISTS TO PREVENT. Readiness used to be computed by walking the
 * live `fields` map and counting how many keys under a slide's prefix were
 * non-empty. That looks obviously correct and is obviously wrong here: the
 * worker's `flattenSpinoutDeckData` SKIPS empty scalars, so an unfilled field is
 * absent from the map rather than present-and-empty. Every key that exists is
 * non-empty by construction, so `filled` always equalled `total`, and every
 * slide reported "ready".
 *
 * The user-visible result: a founder who had done no Lab work opened the
 * builder and saw eleven green ticks and "Data populated from your work" under
 * eleven slides of TEMPLATE FALLBACK content, with export unlocked. The deck was
 * showing the sample and calling it theirs.
 *
 * Readiness now comes from the worker's `gaps` + `gap_sections`, which have
 * always known the truth — each time a module is empty the worker substitutes
 * template figures AND raises a gap naming the slide. These tests pin that
 * signal, both directions, and the empty/unknown edges around it.
 *
 * Run with:  node --test frontend/test/pitch_deck_readiness.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLIDE_META, EXPORT_MIN_READY, buildPitchDeckViewModel, slideStatus, statusTextFor,
} from '../src/lib/pitchDeckViewModel.js';

/** A field map shaped like the worker's: only non-empty keys are present. */
const FIELDS = Object.fromEntries(
  SLIDE_META.flatMap((m) => [[`${m.prefix}.title`, 'Something'], [`${m.prefix}.idx`, '01']]),
);

const gapsFor = (...sections) => ({
  gaps: sections.map((s) => `${s}: go and fill in the module.`),
  gapSections: [...sections],
});

const cover = SLIDE_META[0];
const problem = SLIDE_META[1];

/* -------------------------------------------------- the regression itself */

test('a field map with no empty entries does NOT mean the slide is ready', () => {
  // Exactly the payload shape the worker sends for a founder who has done
  // nothing: every key present, every value non-empty (they are fallbacks).
  const gaps = gapsFor(...SLIDE_META.map((m) => m.prefix));
  const vm = buildPitchDeckViewModel({ fields: FIELDS, gaps });
  assert.equal(vm.readyCount, 0, 'no slide may be counted ready while its module is empty');
  assert.equal(vm.readyLabel, `0 of ${SLIDE_META.length} slides ready`);
  assert.equal(vm.exportDisabled, true, 'export must stay locked on an empty project');
  for (const s of vm.slides) {
    assert.equal(s.complete, false, `${s.title} must not be marked complete`);
    assert.notEqual(
      s.statusText,
      'Data populated from your work',
      `${s.title} is showing fallback content and must not claim otherwise`,
    );
  }
});

test('a slide with no gaps is ready; one with a gap is not', () => {
  const gaps = gapsFor('problem');
  assert.equal(slideStatus(cover, FIELDS, gaps).state, 'ready');
  assert.equal(slideStatus(problem, FIELDS, gaps).state, 'partial');
});

test('finishing a module flips exactly its slide, and nothing else', () => {
  const before = buildPitchDeckViewModel({ fields: FIELDS, gaps: gapsFor('cover', 'problem') });
  const after = buildPitchDeckViewModel({ fields: FIELDS, gaps: gapsFor('problem') });
  assert.equal(before.readyCount + 1, after.readyCount, 'exactly one slide became ready');
  assert.equal(after.slides[0].complete, true, 'cover — the module that was completed');
  assert.equal(after.slides[1].complete, false, 'problem — untouched, still open');
});

test('an empty gap list means every slide is genuinely ready', () => {
  const vm = buildPitchDeckViewModel({ fields: FIELDS, gaps: { gaps: [], gapSections: [] } });
  assert.equal(vm.readyCount, SLIDE_META.length);
  assert.equal(vm.exportDisabled, false, `export unlocks at ${EXPORT_MIN_READY} ready slides`);
  assert.equal(vm.slides[0].statusText, 'Data populated from your work');
});

/* ------------------------------------------------------ the unknown edges */

test('no bundle at all reads as sample data, never as complete', () => {
  for (const [label, args] of [
    ['no fields', { fields: null, gaps: gapsFor() }],
    ['fields but no gap list', { fields: FIELDS, gaps: null }],
    ['fields but sections omitted', { fields: FIELDS, gaps: { gaps: [], gapSections: null } }],
  ]) {
    const vm = buildPitchDeckViewModel(args);
    assert.equal(vm.readyCount, 0, `${label}: nothing may be claimed ready`);
    assert.equal(vm.exportDisabled, true, `${label}: export stays locked`);
    assert.equal(vm.slides[0].statusText, 'Sample data shown', `${label}: says so plainly`);
  }
});

test('a worker that stops sending gap_sections degrades to "sample", not to "ready"', () => {
  // Forward-compatibility guard: an older/rolled-back worker must never be able
  // to make the builder claim the deck is complete.
  const vm = buildPitchDeckViewModel({ fields: FIELDS, gaps: { gaps: ['something'] } });
  assert.equal(vm.readyCount, 0);
  assert.equal(vm.slides[0].status.state, 'unknown');
});

/* ------------------------------------------------------------ week pills */

test('a week pill never reads "0 items missing"', () => {
  // The reported screenshot showed "Build — Week 3, 0 items missing": the warn
  // branch was reachable with a zero count. A pill either names a real count or
  // is not a warning.
  for (const gaps of [
    { gaps: [], gapSections: [] },
    gapsFor('cover'),
    gapsFor('roadmap', 'productDemo'),
    gapsFor(...SLIDE_META.map((m) => m.prefix)),
  ]) {
    for (const pill of buildPitchDeckViewModel({ fields: FIELDS, gaps }).weekPills) {
      assert.doesNotMatch(pill.note, /\b0 items?\b/, `${pill.label}: "${pill.note}"`);
      if (pill.state === 'warn') assert.match(pill.note, /\d+ items? missing/);
      else assert.equal(pill.note, '', `${pill.label}: only a warning carries a note`);
    }
  }
});

test('with nothing loaded, no week claims to be done', () => {
  const vm = buildPitchDeckViewModel({ fields: null, gaps: null });
  for (const pill of vm.weekPills) assert.equal(pill.state, 'pending', pill.label);
});

/* -------------------------------------------------------------- the copy */

test('an open slide names the next thing to do, not a field count', () => {
  const status = slideStatus(problem, FIELDS, {
    gaps: ['Problem: cluster discovery pains in the Customer Discovery module.'],
    gapSections: ['problem'],
  });
  assert.equal(
    statusTextFor(status),
    'Problem: cluster discovery pains in the Customer Discovery module.',
    'the gap text is already an instruction naming the module — surface it verbatim',
  );
});

test('every slide prefix is one a gap can actually be tagged with', () => {
  // The worker tags gaps with a SpinoutDeckData section key. If a prefix here
  // drifted from those keys, that slide could never receive a gap and would be
  // permanently, silently "ready" — the original bug in a new disguise.
  const WORKER_SECTIONS = new Set([
    'cover', 'problem', 'validation', 'market', 'solution',
    'productDemo', 'roadmap', 'team', 'captable', 'ask', 'deal',
  ]);
  for (const m of SLIDE_META) {
    assert.ok(WORKER_SECTIONS.has(m.prefix), `${m.spec}: prefix '${m.prefix}' is not a worker section`);
  }
  assert.equal(new Set(SLIDE_META.map((m) => m.prefix)).size, SLIDE_META.length, 'prefixes are unique');
});
