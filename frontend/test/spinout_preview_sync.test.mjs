/**
 * Spin-Out deck builder — single live preview follows the selected slide.
 *
 * Task #26 made the in-builder preview a single card that tracks whichever
 * slide is picked in the SLIDES list (and the prev/next arrows): the rendered
 * <Thumbnail> is clipped to `slideIndex = activeIdx`, and a per-slide header
 * label + caption adapt to the selection (cover validation-signal copy, the
 * slide-2 pain-frequency nudge, and a neutral "Slide N preview — {title}"
 * form for everything else).
 *
 * Task #27 (this suite) guards that sync so a future refactor of the preview
 * wiring can't silently break it (preview stuck on the cover, wrong label /
 * caption) without a test failing. Two halves:
 *
 *   1. Label + caption — assert spinoutPreviewMeta() (the pure helper the
 *      page's useMemo delegates to) returns the right per-slide label, and
 *      that slide 2's caption flips between the empty-data nudge and the
 *      real-data copy based on problem.pains_json.
 *   2. Clip offset — assert the actual <Thumbnail> the preview renders shifts
 *      the inner content up by `slideIndex * 1080 * scale`, so each selected
 *      slide lands in the 16:9 window. slideIndex 0 (cover) sits at the top;
 *      higher indices shift further up.
 *
 * SSR note: renderToStaticMarkup runs no effects, and IntersectionObserver is
 * absent in node, so Thumbnail mounts immediately at its default 0.18 scale —
 * making the clip offset deterministic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/spinout_preview_sync.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { spinoutPreviewMeta, spinoutHasRealPains } from '../src/pages/spinoutPreview.js';
import { Thumbnail } from '../src/decks/Thumbnail.tsx';
import { TEMPLATES } from '../src/decks/templates/index.ts';

const SPINOUT = TEMPLATES.axal_spinout_demoday;

// Must mirror Thumbnail.tsx's INNER_H + default scale so the expected clip
// offset stays in lockstep with the component.
const INNER_H = 1080;
const DEFAULT_SCALE = 0.18;

// Slide ids/order are locked by spinout_demoday_deck.test.mjs; ask = index 9
// (validation merged into Problem, cap table merged into Ask, Competitive +
// Traction added).
const COVER_IDX = 0;
const PROBLEM_IDX = 1;
const ASK_IDX = 9;

// Placeholder pains: count column is the em-dash DASH sentinel.
const PLACEHOLDER_PAINS = {
  'problem.pains_json': JSON.stringify([
    ['Pain placeholder one', 0, '—'],
    ['Pain placeholder two', 0, '—'],
  ]),
};
// Real pains: count column carries a numeric "n / total".
const REAL_PAINS = {
  'problem.pains_json': JSON.stringify([
    ['Stale data at decision time', 90, '40 / 44'],
    ['Manual reconciliation', 60, '26 / 44'],
  ]),
};

// Pull the inner clip wrapper's `top` offset out of the rendered markup. The
// clip div is uniquely identified by `position:absolute;top:…` (the outer
// frame is position:relative). React drops the "px" suffix for a 0 value, so
// the unit is matched optionally.
const clipTopPx = (html) => {
  const m = html.match(/position:absolute;top:(-?[\d.]+)/);
  return m ? Number(m[1]) : null;
};

// ── Label + caption follow the selected slide ──────────────────────

test('cover (slide 1) keeps the live validation-signal label + caption', () => {
  const meta = spinoutPreviewMeta({ activeIdx: COVER_IDX, activeSlide: { title: 'Cover' }, fields: {} });
  assert.equal(meta.label, 'Cover preview — live validation signal');
  assert.match(meta.caption, /Cumulative discovery interviews/);
});

test('slide 2 uses the pain-frequency label', () => {
  const meta = spinoutPreviewMeta({ activeIdx: PROBLEM_IDX, activeSlide: { title: 'Problem' }, fields: PLACEHOLDER_PAINS });
  assert.equal(meta.label, 'Slide 2 preview — pain frequency');
});

test('a later slide (Ask) gets the neutral "Slide N preview — {title}" label', () => {
  const meta = spinoutPreviewMeta({ activeIdx: ASK_IDX, activeSlide: { title: 'The Ask' }, fields: {} });
  assert.equal(meta.label, 'Slide 10 preview — The Ask');
  assert.match(meta.caption, /Live preview of this slide/);
});

test('neutral label falls back to "Untitled" when the slide has no title', () => {
  const meta = spinoutPreviewMeta({ activeIdx: ASK_IDX, activeSlide: null, fields: {} });
  assert.equal(meta.label, 'Slide 10 preview — Untitled');
});

// ── Slide-2 caption flips on real vs placeholder pains ──────────────

test('slide 2 caption nudges when pains_json holds only placeholder rows', () => {
  const meta = spinoutPreviewMeta({ activeIdx: PROBLEM_IDX, activeSlide: { title: 'Problem' }, fields: PLACEHOLDER_PAINS });
  assert.equal(spinoutHasRealPains(PLACEHOLDER_PAINS), false);
  assert.match(meta.caption, /Log discovery interviews and group their pains/);
});

test('slide 2 caption switches to the real-data copy when pains_json has real rows', () => {
  const meta = spinoutPreviewMeta({ activeIdx: PROBLEM_IDX, activeSlide: { title: 'Problem' }, fields: REAL_PAINS });
  assert.equal(spinoutHasRealPains(REAL_PAINS), true);
  assert.match(meta.caption, /Your top grouped discovery pains/);
  assert.doesNotMatch(meta.caption, /Placeholder pains shown/);
});

test('spinoutHasRealPains is false for missing/empty/malformed pains', () => {
  assert.equal(spinoutHasRealPains(undefined), false);
  assert.equal(spinoutHasRealPains({}), false);
  assert.equal(spinoutHasRealPains({ 'problem.pains_json': '[]' }), false);
  assert.equal(spinoutHasRealPains({ 'problem.pains_json': 'not-json' }), false);
});

// ── The rendered Thumbnail clips to the selected slideIndex ─────────

const renderThumb = (slideIndex) =>
  renderToStaticMarkup(React.createElement(Thumbnail, { template: SPINOUT, slideIndex }));

test('Thumbnail clip offset tracks slideIndex (cover sits at the top)', () => {
  for (const idx of [COVER_IDX, PROBLEM_IDX, ASK_IDX]) {
    const html = renderThumb(idx);
    // `+ 0` normalizes the idx-0 case from -0 to 0 (strict equal treats them
    // as distinct).
    const expected = -(idx * INNER_H * DEFAULT_SCALE) + 0;
    assert.equal(
      clipTopPx(html),
      expected,
      `slideIndex ${idx} should clip the inner content to top:${expected}px`,
    );
  }
});

test('higher slideIndex shifts the preview further up (no two slides share an offset)', () => {
  const cover = clipTopPx(renderThumb(COVER_IDX));
  const problem = clipTopPx(renderThumb(PROBLEM_IDX));
  const ask = clipTopPx(renderThumb(ASK_IDX));
  assert.equal(cover, 0, 'cover must sit flush at the top');
  assert.ok(problem < cover, 'slide 2 must shift up from the cover');
  assert.ok(ask < problem, 'the Ask slide must shift further up than slide 2');
});
