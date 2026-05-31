/**
 * Axal Spin-Out Demo Day deck — empty/placeholder regression tests.
 *
 * The deck is fully data-driven: the Cover activity strip, Problem theme
 * bars, Validation 0–5 rating histogram, Mentors skill radar, Product
 * Demo media, and the Review-the-deal CTA all render from real Lab/project
 * data, and each has a graceful empty/placeholder path. This suite locks
 * those paths in so a future data-shape or component change can't silently
 * break an empty-state slide (Task #6 verified them by hand; this is the
 * automated net).
 *
 * Strategy: render the real `Deck_axal_spinout_demoday` (its own
 * VariantContext provider wraps every slide) to static HTML via
 * react-dom/server, with (a) populated and (b) empty/missing data, and
 * assert no crash plus the correct branch. The TSX is loaded through a
 * Vite-Oxc loader hook (see _deck-loader.mjs) so no build step is needed.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/spinout_demoday_deck.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Deck, { SLIDES } from '../src/decks/templates/axal_spinout_demoday_app.tsx';

const render = (data) => renderToStaticMarkup(React.createElement(Deck, { data }));
const countFrames = (html) => (html.match(/data-slide-frame=""/g) || []).length;

// A fully-populated data prop in the flat-field shape `hydrate()` expects
// (the editor surfaces real strings + JSON-encoded arrays, never blobs).
const POPULATED = {
  cover_activity_log_json: JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      count: (i % 4) + 1,
      kind: 'lab',
    })),
  ),
  problem_pain_themes_json: JSON.stringify([
    { theme: 'onboarding friction', mentions: 7 },
    { theme: 'manual reconciliation', mentions: 4 },
  ]),
  validation_question: 'How likely are you to pay for this?',
  validation_ratings_json: JSON.stringify([4, 5, 4, 5, 3]),
  mn_skill_coverage_json: JSON.stringify([
    { label: 'GTM', value: 0.8 },
    { label: 'Eng', value: 0.6 },
    { label: 'Design', value: 0.9 },
    { label: 'Finance', value: 0.5 },
  ]),
  product_demo_screenshot_url: 'https://cdn.axal.vc/demo/screenshot.png',
  contact_deal_access_json: JSON.stringify({
    deal_room_url: 'https://deal.axal.vc/room/abc',
    nda_required: true,
    data_room_ready: true,
    cta_label: 'Review the deal',
  }),
};

// Empty/missing data — `{}` already yields the all-empty visuals because
// the flat-field hydrate path defaults every array to [] and media URLs to
// ''. This is the exact state a brand-new project produces.
const EMPTY = {};

test('renders without crashing for both populated and empty data', () => {
  assert.doesNotThrow(() => render(POPULATED));
  assert.doesNotThrow(() => render(EMPTY));
  // No-data / non-object inputs must also be safe (hydrate guards them).
  assert.doesNotThrow(() => render(undefined));
  assert.doesNotThrow(() => render(null));
});

test('ActivityLog30Day — empty log renders 30 ghost cells (count 0)', () => {
  const html = render(EMPTY);
  // hydrate fills 30 placeholder days keyed d-0…d-29, all count 0.
  const ghosts = (html.match(/title="d-\d+ · 0"/g) || []).length;
  assert.equal(ghosts, 30, 'expected exactly 30 ghost activity cells');
  assert.ok(html.includes('title="d-0 · 0"'));
  assert.ok(html.includes('title="d-29 · 0"'));
});

test('ActivityLog30Day — populated log renders real counts', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('title="2026-05-01 · 1"'), 'first real activity cell missing');
  assert.ok(html.includes('title="2026-05-30 · '), 'last real activity cell missing');
  // No ghost placeholder cells when real data is present.
  assert.ok(!html.includes('title="d-0 · 0"'), 'ghost cells leaked into populated render');
});

test('ThemeFrequencyBars — empty themes + no signals hides the block', () => {
  const html = render(EMPTY);
  assert.ok(!html.includes('Pain themes · clustered'), 'theme block should be hidden when empty');
});

test('ThemeFrequencyBars — falls back to raw signals when no clustered themes', () => {
  const html = render({ problem_signals: ['Manual data entry wastes hours every week'] });
  assert.ok(html.includes('Pain themes · clustered'), 'theme block should show via signal fallback');
  assert.ok(html.includes('Manual data entry wastes hours'), 'signal text missing from bars');
});

test('ThemeFrequencyBars — populated themes render labels + mention counts', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('Pain themes · clustered'));
  assert.ok(html.includes('onboarding friction'));
  assert.ok(html.includes('manual reconciliation'));
});

test('RatingDistribution — empty ratings show avg DASH and n=0', () => {
  const html = render(EMPTY);
  assert.ok(html.includes('avg — · n=0'), 'empty rating histogram should show avg — · n=0');
});

test('RatingDistribution — populated ratings show numeric avg and n', () => {
  const html = render(POPULATED);
  // [4,5,4,5,3] → mean 4.2, n=5.
  assert.ok(html.includes('avg 4.2 · n=5'), 'populated rating histogram avg/n missing');
  assert.ok(html.includes('How likely are you to pay for this?'), 'question prompt missing');
});

test('SkillsSpider — fewer than 3 axes falls back to NetworkConstellation', () => {
  const html = render(EMPTY);
  assert.ok(!html.includes('Skill coverage'), 'skill radar header should be absent when <3 axes');
  assert.ok(html.includes('Axal network ·'), 'constellation fallback label missing');
});

test('SkillsSpider — 3+ axes render the radar (no constellation fallback)', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('Skill coverage'), 'skill radar header missing for populated axes');
  assert.ok(html.includes('GTM') && html.includes('Design'), 'radar axis labels missing');
  assert.ok(!html.includes('Axal network ·'), 'constellation should not render when radar is shown');
});

test('Product Demo — no loop/screenshot shows the pending placeholder', () => {
  const html = render(EMPTY);
  assert.ok(html.includes('Demo loop pending'), 'product demo pending placeholder missing');
});

test('Product Demo — screenshot URL renders an <img> (no placeholder)', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('https://cdn.axal.vc/demo/screenshot.png'), 'screenshot src missing');
});

test('Product Demo — YouTube link renders an <iframe> embed', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  ]) {
    const html = render({ product_demo_loop_url: u });
    assert.ok(
      html.includes('src="https://www.youtube.com/embed/dQw4w9WgXcQ"'),
      `expected YouTube embed iframe for ${u}`,
    );
    assert.ok(!html.includes('Demo loop pending'), `should not show placeholder for ${u}`);
    assert.ok(!html.includes('<video'), `YouTube link must not use a <video> element (${u})`);
  }
});

test('Product Demo — Vimeo link renders an <iframe> embed', () => {
  for (const u of [
    'https://vimeo.com/123456789',
    'https://player.vimeo.com/video/123456789',
  ]) {
    const html = render({ product_demo_loop_url: u });
    assert.ok(
      html.includes('src="https://player.vimeo.com/video/123456789"'),
      `expected Vimeo embed iframe for ${u}`,
    );
    assert.ok(!html.includes('Demo loop pending'), `should not show placeholder for ${u}`);
  }
});

test('Product Demo — direct video file still plays via <video>', () => {
  const html = render({ product_demo_loop_url: 'https://cdn.axal.vc/demo/loop.mp4' });
  assert.ok(html.includes('<video'), 'direct file should render a <video> element');
  assert.ok(html.includes('https://cdn.axal.vc/demo/loop.mp4'), 'video src missing');
  assert.ok(!html.includes('<iframe'), 'direct file must not use an <iframe>');
});

test('Review-the-deal — no deal_room_url shows the "pending" badge, not a link', () => {
  const html = render(EMPTY);
  assert.ok(html.includes('· pending'), 'pending CTA badge missing');
  assert.ok(html.includes('Data room pending'), 'data-room-pending badge missing');
  assert.ok(!html.includes('href="https://deal.axal.vc'), 'should not render a deal-room link when empty');
});

test('Review-the-deal — deal_room_url renders the CTA link + ready badge', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('href="https://deal.axal.vc/room/abc"'), 'deal-room CTA link missing');
  assert.ok(html.includes('Data room ready'), 'data-room-ready badge missing');
});

test('SLIDES registry — 13 slides, Axal Signal dropped, Product Demo @ slot 6, Review last', () => {
  assert.equal(SLIDES.length, 13, 'expected exactly 13 slides');
  const ids = SLIDES.map((s) => s.id);
  assert.ok(!ids.includes('axal_signal'), 'Axal Signal slide must be absent');
  assert.equal(SLIDES[5].id, 'product_demo', 'Product Demo must be the 6th slide (index 5)');
  assert.equal(SLIDES[SLIDES.length - 1].id, 'review_the_deal', 'Review-the-deal must be the last slide');
  // And the rendered deck emits one frame per slide.
  assert.equal(countFrames(render(EMPTY)), 13, 'rendered deck should emit 13 slide frames');
});
