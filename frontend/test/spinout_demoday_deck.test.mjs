/**
 * Axal Spin-Out Demo Day deck — 9-slide BASEPOINT design regression tests.
 *
 * The in-app renderer (`Deck_axal_spinout_demoday`) reproduces the PPTX export
 * one-to-one and is fully data-driven: every narrative string + structured viz
 * (problem pain bars, validation funnel, market rings, cap-table donut, …)
 * comes from `hydrate(data)`, which merges a flat dotted-key field dict onto the
 * bundled BASEPOINT `SAMPLE_DATA`. This suite locks:
 *   - the no-crash contract for populated / empty / undefined / null inputs,
 *   - the autofill default: a deck with no (or only legacy) fields renders the
 *     full BASEPOINT sample, byte-for-byte equal to render(SAMPLE_DATA),
 *   - dotted-key overrides (scalar + `_json`) binding onto the sample, with a
 *     type-mismatch guard, and
 *   - the 9-slide registry shape (Axal-Signal / Product-Demo / people / brand /
 *     Review-the-deal slides dropped).
 *
 * The TSX is loaded through the Vite-Oxc loader hook (see _deck-loader.mjs) so
 * no build step is needed.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test \
 *     frontend/test/spinout_demoday_deck.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Deck, { SLIDES, SAMPLE_DATA } from '../src/decks/templates/axal_spinout_demoday_app.tsx';

const render = (data) => renderToStaticMarkup(React.createElement(Deck, { data }));
const countFrames = (html) => (html.match(/data-slide-frame=""/g) || []).length;

// A fully-populated data prop in the flat dotted-key shape `hydrate()` expects:
// scalar narrative fields as strings, structured viz fields as `_json` strings.
const POPULATED = {
  'cover.company': 'ZZACME',
  'cover.thesis': 'A wholly different thesis sentence for ZZACME.',
  'problem.title': 'A different problem headline entirely.',
  'problem.pains_json': JSON.stringify([
    ['Custom pain alpha', 90, '40 / 44'],
    ['Custom pain beta', 60, '26 / 44'],
  ]),
  'deal.contact': 'founder@zzacme.com   ·   axal.vc',
};

const EMPTY = {};

test('renders without crashing for populated, empty, undefined and null', () => {
  assert.doesNotThrow(() => render(POPULATED));
  assert.doesNotThrow(() => render(EMPTY));
  // Non-object / no-data inputs must also be safe — hydrate guards them.
  assert.doesNotThrow(() => render(undefined));
  assert.doesNotThrow(() => render(null));
});

test('empty data degrades to the full BASEPOINT sample deck', () => {
  const empty = render(EMPTY);
  // render({}) === render(SAMPLE_DATA), byte-for-byte (the autofill default).
  assert.equal(empty, render(SAMPLE_DATA), 'empty render should equal the sample render');
  // Anchor a stable BASEPOINT copy string so the sample is the fallback.
  assert.ok(empty.includes('BASEPOINT'), 'BASEPOINT brand copy missing on empty');
});

test('passing the nested SAMPLE_DATA object is equivalent to passing {}', () => {
  // sample.ts::previewDataFor returns the nested SAMPLE_DATA for the picker
  // thumbnail / preview modal; hydrate must treat it as "no flat keys".
  assert.equal(render(SAMPLE_DATA), render(EMPTY), 'nested SAMPLE_DATA should hydrate to the sample');
});

test('legacy / non-dotted keys are ignored and fall back to the sample', () => {
  // Old-shape keys from the prior deck design have no dotted path, so hydrate
  // skips them entirely and renders the BASEPOINT sample.
  const legacy = render({
    cover_activity_log_json: '[]',
    product_demo_screenshot_url: 'https://cdn.axal.vc/demo/x.png',
    axal_spinout_variant: 'manifesto',
  });
  assert.equal(legacy, render(EMPTY), 'legacy keys must not change the render');
});

test('scalar dotted-key overrides bind onto the sample + clear the sample value', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('ZZACME'), 'cover.company override did not bind');
  assert.ok(html.includes('A wholly different thesis sentence for ZZACME.'), 'cover.thesis override did not bind');
  // The overridden sample thesis must not leak through.
  assert.ok(!html.includes('Basepoint scores it in real time'), 'sample thesis leaked into the override');
});

test('_json dotted-key overrides bind structured viz data', () => {
  const html = render(POPULATED);
  assert.ok(html.includes('Custom pain alpha'), 'problem.pains_json override did not bind');
  assert.ok(html.includes('Custom pain beta'), 'second pain row did not bind');
  // The sample pain rows must be replaced, not merged.
  assert.ok(!html.includes('Stale data at decision time'), 'sample pain row leaked into the override');
});

test('mergeShape type-guard: a malformed _json value keeps the sample shape', () => {
  // A non-array value for an array field must not replace the typed base or
  // crash the slide; the sample array survives.
  const html = render({ 'cover.meta_json': JSON.stringify('not-an-array') });
  assert.doesNotThrow(() => render({ 'cover.meta_json': JSON.stringify('not-an-array') }));
  assert.equal(html, render(EMPTY), 'malformed array override should leave the sample untouched');
});

test('hydrate is prototype-pollution safe (dotted path + JSON.parse payload)', () => {
  // A crafted dotted key must not walk the prototype chain, and a JSON.parse'd
  // structured value must not smuggle an own `__proto__` key onto a merged
  // object's prototype. Neither must pollute the global Object.prototype.
  assert.doesNotThrow(() => render({ 'cover.__proto__.polluted': 'x' }));
  assert.doesNotThrow(() => render({ 'cover.meta_json': '{"__proto__":{"polluted":"x"}}' }));
  assert.doesNotThrow(() => render({ 'cover.constructor.prototype.polluted': 'x' }));
  // The canary: no global prototype pollution leaked from any of the above.
  assert.equal({}.polluted, undefined, 'Object.prototype was polluted by hydrate');
  // The malformed keys are dropped, so the render still degrades to the sample.
  assert.equal(render({ 'cover.__proto__.polluted': 'x' }), render(EMPTY), 'forbidden dotted key changed the render');
});

test('SLIDES registry — canonical 11 slides in order (validation → Problem, cap table → Ask)', () => {
  assert.equal(SLIDES.length, 11, 'expected exactly 11 slides');
  const ids = SLIDES.map((s) => s.id);
  assert.deepEqual(ids, [
    'cover', 'problem', 'solution', 'product_demo', 'market',
    'competitive', 'traction', 'roadmap', 'team_network', 'ask',
    'review_the_deal',
  ], 'slide ids / order changed');
  assert.equal(SLIDES[SLIDES.length - 1].id, 'review_the_deal', 'Review the deal must be the last slide');
  // Validation and Cap Table are merged into Problem and Ask; the old
  // standalone slides (and older drops) must stay absent.
  for (const gone of ['validation', 'cap_table', 'axal_signal', 'team_readiness', 'mentor_network', 'brand']) {
    assert.ok(!ids.includes(gone), `${gone} slide must be absent`);
  }
  // The rendered deck emits exactly one frame per slide.
  assert.equal(countFrames(render(EMPTY)), 11, 'rendered deck should emit 11 slide frames');
});

test('merged slides render the absorbed sections in place', () => {
  const html = render(EMPTY);
  // Problem carries the discovery funnel strip (validation.* read in place).
  assert.ok(html.includes(SAMPLE_DATA.validation.funnelLabel), 'Problem slide missing validation funnel label');
  assert.ok(html.includes(SAMPLE_DATA.validation.conversion[0]), 'Problem slide missing conversion stat');
  // Ask carries the cap-table donut labels (captable.* read in place).
  assert.ok(html.includes(SAMPLE_DATA.captable.donutLabel), 'Ask slide missing cap-table donut label');
  assert.ok(html.includes('entity setup steps complete'), 'Ask slide missing entity setup status');
  // New slides render their sample content.
  assert.ok(html.includes(SAMPLE_DATA.competitive.tableLabel), 'Competitive slide missing landscape table');
  assert.ok(html.includes(SAMPLE_DATA.traction.mixLabel), 'Traction slide missing revenue mix');
});
