// D1370 (#3661, PF3 and pf5c): a finding drawn on its slide, and "Try again" for one slide.
//
//   - a contrast finding carries its colour pair; the overlay model names the kind
//     (cut off, contrast, other), the slide as exported, and says so when the deck
//     was edited after the check;
//   - the overlay draws the checked slide, its legend and, for contrast, the text and
//     background colours with their ratio; without a layout it draws no outline at
//     all (nothing guessed);
//   - Show me draws it under the strip;
//   - Try again on a slide that couldn't be checked measures that slide only, never
//     the whole deck while the result is current, and a slide that fails again stays
//     "Couldn't check", never a pass.
// Synthetic only: no real company, person or figure.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_preflight_overlay_3661.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { runPreflight } from '../src/pages/raise/pitch/preflightModel.js';
import { CLIP_LEGEND, PAIR_LEGEND, groupsOf, overlayOf, rowOf } from '../src/pages/raise/pitch/preflightUiModel.js';
import PreflightOverlay from '../src/pages/raise/pitch/PreflightOverlay.jsx';
import { DECK, mountEditor } from './_pitch_editor_mount.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const SLIDES = [
  { title: 'Synthetic problem', blocks: [
    { id: 'b1', kind: 'text', style: 'heading', grid: g(1, 12, 1, 1), text: 'Synthetic heading' },
    { id: 'b2', kind: 'text', style: 'paragraph', grid: g(1, 8, 2, 6), text: 'Synthetic body text that is quiet on a dark card.' },
  ], background: { color: '#3f3f46' } },
  { title: 'Synthetic traction', blocks: [
    { id: 'b1', kind: 'text', style: 'paragraph', grid: g(1, 12, 1, 2), text: 'Add [Your logo] here' },
  ] },
];
const deck = { id: 77, version: 5, theme: { kind: 'neutral_light' }, slides: SLIDES };

test('a contrast finding carries its colour pair, and the overlay model names what to draw', () => {
  // Mutation checked: the pair left off the finding (the card beside the slide has nothing to show).
  const result = runPreflight(deck, { now: NOW, measurements: { '0:b1': { clipped: true } } });
  const c = result.findings.find((f) => f.check === 'contrast' && f.block === 'b2');
  assert.ok(c, 'the quiet body text is a contrast warning');
  assert.deepEqual(Object.keys(c.pair).sort(), ['bg', 'fg', 'min', 'ratio']);
  assert.equal(c.pair.bg, '#3f3f46');
  assert.ok(c.pair.ratio < c.pair.min);
  const row = rowOf(c, SLIDES);
  assert.deepEqual(row.pair, c.pair);
  const ov = overlayOf(row, { n: 4 });
  assert.deepEqual([ov.kind, ov.tone, ov.n, ov.card, ov.block], ['contrast', 'look', 4, 0, 'b2']);
  assert.equal(ov.eyebrow, 'Slide 1 · 16:9');
  assert.equal(ov.legend.detail, PAIR_LEGEND);
  assert.match(ov.pair.ratio, /^\d+(\.\d{1,2})? : 1$/);
  assert.equal(ov.pair.reads, '4.5 : 1 reads reliably');
  assert.match(ov.pair.label, /^Text #[0-9a-f]{6} on #3f3f46: contrast .+ : 1, 4\.5 : 1 needed$/);

  const clipped = rowOf(result.findings.find((f) => f.check === 'overflow'), SLIDES);
  const clip = overlayOf(clipped, { n: 1, current: false });
  assert.deepEqual([clip.kind, clip.tone], ['clip', 'fix']);
  assert.equal(clip.eyebrow, 'Slide 1 · 16:9 · as exported · as checked, before your edit', 'an edit after the check is said');
  assert.equal(clip.legend.detail, CLIP_LEGEND);
  const other = overlayOf(rowOf(result.findings.find((f) => f.check === 'placeholder'), SLIDES), { n: 2, aspect: '4:3' });
  assert.deepEqual([other.kind, other.eyebrow], ['outline', 'Slide 2 · 4:3']);
  assert.equal(overlayOf({ card: null }), null, 'a finding with no slide draws nothing');
});

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  return { by, pr, text, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('the overlay: the checked slide, its legend, the contrast pair; no outline without a layout', async () => {
  // Mutation checked: an outline drawn from guessed coordinates when the page gave no box.
  const result = runPreflight(deck, { now: NOW });
  const row = rowOf(result.findings.find((f) => f.check === 'contrast' && f.block === 'b2'), SLIDES);
  const m = await mount(React.createElement(PreflightOverlay, { overlay: overlayOf(row, { n: 3 }), card: SLIDES[0], theme: deck.theme, kit: null }));
  try {
    assert.equal(m.pr(m.by('pitch-preflight-overlay'))['aria-label'], `${row.label}.`);
    assert.equal(m.text(m.by('pitch-preflight-overlay-eyebrow')), 'Slide 1 · 16:9');
    assert.match(m.text(m.by('pitch-preflight-overlay-legend')), /^3The text contrast is .+:1\. Shown with its colour pair\./);
    assert.equal(m.text(m.by('pitch-preflight-pair-background')), '#3f3f46');
    assert.match(m.text(m.by('pitch-preflight-pair-ratio')), / : 1$/);
    assert.ok(m.by('pitch-preflight-overlay-grid'), 'the slide is drawn');
    assert.equal(m.by('pitch-preflight-overlay-outline'), undefined, 'the fake page has no layout: no box, so no outline');
  } finally { await m.unmount(); }
});

async function openPanel(m) {
  await m.press(m.by('deck-more-open'));
  await m.press(m.by('deck-more-preflight'));
  for (let i = 0; i < 8 && !m.by('pitch-preflight-counts') && !m.by('pitch-preflight-nothing'); i += 1) await m.settle();
}

test('Show me draws the finding on its slide under the strip', async () => {
  const m = await mountEditor({ answers: { deckGet: async () => ({ ...DECK, slides: SLIDES }) } });
  try {
    await openPanel(m);
    const show = m.walk(m.by('pitch-preflight-look')).find((n) => String(m.pr(n)['data-testid'] || '').endsWith('-show'));
    await m.press(show);
    assert.ok(m.by('pitch-preflight-strip'));
    const ov = m.by('pitch-preflight-overlay');
    assert.ok(ov, 'the overlay under the strip');
    assert.match(m.text(m.by('pitch-preflight-overlay-eyebrow')), /^Slide \d+ · 16:9/);
    await m.press(m.by('pitch-preflight-strip-close'));
    assert.equal(m.by('pitch-preflight-overlay'), undefined, 'closing the strip closes the overlay');
  } finally { await m.close(); }
});

test('Try again checks one slide again, never the whole deck; a slide that fails again is still "Couldn\'t check"', async () => {
  // Mutations checked: Try again running the whole check while the result is current; a retried slide that
  // fails again dropped from "Couldn't check" (read as a pass).
  const m = await mountEditor({ answers: { deckGet: async () => ({ ...DECK, slides: SLIDES }) } });
  try {
    await openPanel(m);
    const before = m.text(m.by('pitch-preflight-counts'));
    assert.match(before, /couldn’t check/, 'the fake page has no layout');
    const retry = m.walk(m.by('pitch-preflight-unchecked')).find((n) => String(m.pr(n)['data-testid'] || '').endsWith('-retry'));
    assert.ok(retry, 'a slide row has Try again');
    assert.match(m.pr(retry)['aria-label'], /^Try again to check slide \d+$/);
    await m.press(retry);
    for (let i = 0; i < 6; i += 1) await m.settle();
    assert.doesNotMatch(m.text(m.by('pitch-preflight-chip')), /^Checking/, 'the whole check did not run');
    assert.equal(m.text(m.by('pitch-preflight-counts')), before, 'it failed again: still couldn’t check, never a pass');
    assert.ok(!m.calls.some(([n]) => /update|save|assist|quote/i.test(n)), 'nothing written, nothing run');
  } finally { await m.close(); }
});

test('the groups keep a retried slide that failed again in "Couldn\'t check"', () => {
  const result = runPreflight(deck, { now: NOW });
  const g1 = groupsOf(result, { slides: SLIDES, failed: [0, 1] });
  const g2 = groupsOf(result, { slides: SLIDES, failed: [1] });
  assert.deepEqual(g1.unchecked.map((r) => r.slide), [1, 2]);
  assert.deepEqual(g2.unchecked.map((r) => r.slide), [2], 'a slide measured on retry leaves the group');
});
