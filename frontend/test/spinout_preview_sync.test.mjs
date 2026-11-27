/**
 * Spin-Out deck preview — the rendered Thumbnail clips to the selected slide.
 *
 * Task #26 made the old builder's preview a single card that tracked the
 * selected slide: the rendered <Thumbnail> is clipped to `slideIndex`. The
 * builder retired with D898 group E (#2676), and with it `spinoutPreview.js`,
 * the label and caption helper only it read; the Thumbnail's clip is still
 * the template renderer's, and this suite still guards it: each slideIndex
 * shifts the inner content up by `slideIndex * 1080 * scale`, so each slide
 * lands in the 16:9 window.
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

// Pull the inner clip wrapper's `top` offset out of the rendered markup. The
// clip div is uniquely identified by `position:absolute;top:…` (the outer
// frame is position:relative). React drops the "px" suffix for a 0 value, so
// the unit is matched optionally.
const clipTopPx = (html) => {
  const m = html.match(/position:absolute;top:(-?[\d.]+)/);
  return m ? Number(m[1]) : null;
};

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
