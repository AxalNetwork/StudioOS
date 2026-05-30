/**
 * Pitch-deck templates — missing-data / empty-state regression tests.
 *
 * Task #7 proved the Axal Spin-Out Demo Day deck degrades gracefully
 * when data is missing (see spinout_demoday_deck.test.mjs). This suite
 * extends that safety net to the other 12 registry templates so a future
 * data-shape change can't silently break their empty-state slides.
 *
 * Two families of deck, two empty-state contracts:
 *
 *  1. Editable-placeholder decks (yc_seed, sequoia_classic,
 *     kawasaki_10_20_30, one_pager_teaser) read fields through DeckBase
 *     `v()` / `<Editable>` and show a literal placeholder (e.g.
 *     "[Company]") when the field is empty. Empty data ⇒ placeholders.
 *
 *  2. Sample-fallback decks (minimal_seed + every *_app deck) merge the
 *     incoming `data` over a rich `SAMPLE_DATA` constant, so a brand-new
 *     project with no data renders the full sample deck (the graceful
 *     degradation) plus an em-dash "—" for any field absent from the
 *     sample too. For the deterministic ones, render({}) is byte-for-byte
 *     identical to render(SAMPLE_DATA); that equality is the assertion.
 *
 * Every deck is also rendered with {}, undefined and null to lock the
 * no-crash contract (null bypasses the per-slide `data = {}` default, so
 * it's the sharpest probe — it's what surfaced the kawasaki guard).
 *
 * The TSX is loaded through the shared Vite-Oxc loader hook (see
 * _deck-loader.mjs) so no build step is needed.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/deck_templates_missing_data.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Deck_yc_seed } from '../src/decks/templates/yc_seed.tsx';
import { Deck_sequoia_classic } from '../src/decks/templates/sequoia_classic.tsx';
import { Deck_kawasaki_10_20_30 } from '../src/decks/templates/kawasaki_10_20_30.tsx';
import { Deck_one_pager_teaser } from '../src/decks/templates/one_pager_teaser.tsx';
import { Deck_minimal_seed } from '../src/decks/templates/minimal_seed.tsx';
import { Deck_demo_day_app } from '../src/decks/templates/demo_day_app.tsx';
import { Deck_sales_commercial_app } from '../src/decks/templates/sales_commercial_app.tsx';
import { Deck_partnership_bd_app } from '../src/decks/templates/partnership_bd_app.tsx';
import { Deck_investor_appendix_app, SAMPLE_DATA as INVESTOR_SAMPLE } from '../src/decks/templates/investor_appendix_app.tsx';
import { Deck_series_a_growth_app, SAMPLE_DATA as SERIES_A_SAMPLE } from '../src/decks/templates/series_a_growth_app.tsx';
import { Deck_series_b_diligence_app, SAMPLE_DATA as SERIES_B_SAMPLE } from '../src/decks/templates/series_b_diligence_app.tsx';
import { Deck_narrative_brand_app, SAMPLE_DATA as NARRATIVE_SAMPLE } from '../src/decks/templates/narrative_brand_app.tsx';
import { SAMPLE_DATA as SALES_SAMPLE } from '../src/decks/templates/sales_commercial_app.tsx';
import { SAMPLE_DATA as PARTNERSHIP_SAMPLE } from '../src/decks/templates/partnership_bd_app.tsx';
import { SAMPLE_DATA as MINIMAL_SAMPLE } from '../src/decks/templates/minimal_seed.tsx';
import { SAMPLE_DATA as DEMODAY_SAMPLE } from '../src/decks/templates/demo_day_app.tsx';

const render = (Comp, data) => renderToStaticMarkup(React.createElement(Comp, { data }));
const countFrames = (html) => (html.match(/data-slide-frame=""/g) || []).length;

// ── Shared no-crash + structure contract ───────────────────────────
// Each deck must render structurally-intact frames for {} (a brand-new
// project), and must not throw for undefined or null payloads.
const DECKS = [
  { name: 'yc_seed',                Comp: Deck_yc_seed,                frames: 10 },
  { name: 'sequoia_classic',        Comp: Deck_sequoia_classic,        frames: 12 },
  { name: 'kawasaki_10_20_30',      Comp: Deck_kawasaki_10_20_30,      frames: 10 },
  { name: 'one_pager_teaser',       Comp: Deck_one_pager_teaser,       frames: 1  },
  { name: 'minimal_seed',           Comp: Deck_minimal_seed,           frames: 6  },
  { name: 'demo_day_app',           Comp: Deck_demo_day_app,           frames: 12 },
  { name: 'sales_commercial_app',   Comp: Deck_sales_commercial_app,   frames: 18 },
  { name: 'partnership_bd_app',     Comp: Deck_partnership_bd_app,     frames: 12 },
  { name: 'investor_appendix_app',  Comp: Deck_investor_appendix_app,  frames: 51 },
  { name: 'series_a_growth_app',    Comp: Deck_series_a_growth_app,    frames: 15 },
  { name: 'series_b_diligence_app', Comp: Deck_series_b_diligence_app, frames: 32 },
  { name: 'narrative_brand_app',    Comp: Deck_narrative_brand_app,    frames: 19 },
];

for (const { name, Comp, frames } of DECKS) {
  test(`${name} — no crash on {}, undefined, null; ${frames} frames on empty`, () => {
    assert.doesNotThrow(() => render(Comp, {}), `${name} threw on empty {}`);
    assert.doesNotThrow(() => render(Comp, undefined), `${name} threw on undefined`);
    assert.doesNotThrow(() => render(Comp, null), `${name} threw on null`);
    const html = render(Comp, {});
    assert.equal(countFrames(html), frames, `${name} empty render should emit ${frames} slide frames`);
    // Every deck surfaces the em-dash placeholder for at least one
    // missing field when rendered with no data.
    assert.ok(html.includes('—'), `${name} empty render should show the "—" placeholder`);
  });
}

// ── Family 1: Editable-placeholder empty states + data binding ──────

test('yc_seed — empty shows placeholders; populated binds + clears them', () => {
  const empty = render(Deck_yc_seed, {});
  assert.ok(empty.includes('[Company]'), 'company placeholder missing on empty');
  assert.ok(empty.includes('[One-line vision — what becomes possible.]'), 'vision placeholder missing');

  const populated = render(Deck_yc_seed, { company: 'ZZACME' });
  assert.ok(populated.includes('ZZACME'), 'company value did not bind');
  assert.ok(!populated.includes('[Company]'), 'company placeholder leaked into populated render');
});

test('sequoia_classic — empty shows placeholders; populated binds + clears them', () => {
  const empty = render(Deck_sequoia_classic, {});
  assert.ok(empty.includes('[Company]'), 'company placeholder missing on empty');
  assert.ok(empty.includes('founders@company.com'), 'contact placeholder missing on empty');

  const populated = render(Deck_sequoia_classic, { company: 'ZZACME' });
  assert.ok(populated.includes('ZZACME'), 'company value did not bind');
  assert.ok(!populated.includes('[Company]'), 'company placeholder leaked into populated render');
});

test('kawasaki_10_20_30 — empty shows placeholders; populated binds the problem stat', () => {
  const empty = render(Deck_kawasaki_10_20_30, {});
  assert.ok(empty.includes('One workflow. Done.'), 'solution placeholder missing on empty');
  assert.ok(empty.includes('founders@company.com'), 'contact placeholder missing on empty');

  const populated = render(Deck_kawasaki_10_20_30, { problem_stat: { value: '$9T', label: 'lost yearly' } });
  assert.ok(populated.includes('$9T'), 'problem-stat value did not bind');
  assert.ok(populated.includes('lost yearly'), 'problem-stat label did not bind');
});

test('one_pager_teaser — empty shows placeholders; populated binds company + ask', () => {
  const empty = render(Deck_one_pager_teaser, {});
  assert.ok(empty.includes('[Company]'), 'company placeholder missing on empty');
  assert.ok(empty.includes('[Irresistible one-line hook]'), 'one-liner placeholder missing on empty');

  const populated = render(Deck_one_pager_teaser, { company: 'ZZACME', ask_amount: 5000000 });
  assert.ok(populated.includes('ZZACME'), 'company value did not bind');
  assert.ok(populated.includes('$5,000,000'), 'ask_amount was not formatted/bound');
  assert.ok(!populated.includes('[Company]'), 'company placeholder leaked into populated render');
});

// ── Family 2: sample-fallback empty states + data binding ───────────

test('minimal_seed — empty falls back to sample; populated company overrides it', () => {
  const empty = render(Deck_minimal_seed, {});
  assert.ok(
    empty.includes('The default way operations teams ship cross-system workflows.'),
    'sample one-liner fallback missing on empty',
  );
  // render({}) is the SAMPLE_DATA fallback, byte-for-byte.
  assert.equal(empty, render(Deck_minimal_seed, MINIMAL_SAMPLE), 'empty render should equal the sample render');

  const populated = render(Deck_minimal_seed, { company: 'ZZACME' });
  assert.ok(populated.includes('ZZACME'), 'company override did not bind');
  assert.ok(!populated.includes('[Company]'), 'sample company placeholder leaked into populated render');
});

// Deterministic sample-fallback decks: render({}) must equal
// render(SAMPLE_DATA), and a known sample string must surface — proving
// the no-data path degrades to the full sample deck rather than blanks.
const SAMPLE_FALLBACK = [
  { name: 'sales_commercial_app',   Comp: Deck_sales_commercial_app,   sample: SALES_SAMPLE,       needle: 'Continental Bank' },
  { name: 'partnership_bd_app',     Comp: Deck_partnership_bd_app,     sample: PARTNERSHIP_SAMPLE, needle: 'Northbridge Industries' },
  { name: 'series_b_diligence_app', Comp: Deck_series_b_diligence_app, sample: SERIES_B_SAMPLE,    needle: 'The default platform every operating team routes their work through.' },
  { name: 'investor_appendix_app',  Comp: Deck_investor_appendix_app,  sample: INVESTOR_SAMPLE,    needle: null },
  { name: 'series_a_growth_app',    Comp: Deck_series_a_growth_app,    sample: SERIES_A_SAMPLE,    needle: null },
  { name: 'narrative_brand_app',    Comp: Deck_narrative_brand_app,    sample: NARRATIVE_SAMPLE,   needle: null },
];

for (const { name, Comp, sample, needle } of SAMPLE_FALLBACK) {
  test(`${name} — empty render degrades to the full sample deck`, () => {
    const empty = render(Comp, {});
    assert.equal(empty, render(Comp, sample), `${name} empty render should equal the sample render`);
    if (needle) {
      assert.ok(empty.includes(needle), `${name} sample fallback string missing on empty`);
    }
  });
}

// demo_day_app injects per-render non-deterministic content, so it can't
// be byte-compared. Assert the structural + sample-fallback contract
// instead: the sample company name surfaces and the frame count holds.
test('demo_day_app — empty render shows the sample fallback + holds 12 frames', () => {
  const empty = render(Deck_demo_day_app, {});
  assert.ok(empty.includes('Loopline'), 'sample company fallback missing on empty');
  assert.equal(countFrames(empty), 12, 'empty render should emit 12 slide frames');
  // The full sample render must also stay crash-free + 12 frames.
  assert.doesNotThrow(() => render(Deck_demo_day_app, DEMODAY_SAMPLE));
  assert.equal(countFrames(render(Deck_demo_day_app, DEMODAY_SAMPLE)), 12, 'sample render should emit 12 slide frames');
});
