/**
 * D581 (#1208) — the Spin-Out pitch deck has eleven slides, and every surface
 * that says how many reads `SLIDE_META.length`.
 *
 * Two kinds of check. The first grows `SLIDE_META` by one BEFORE the modules
 * that count it are loaded, then reads what they say: if a surface still says
 * eleven, it was typed, not derived. (`node --test` runs each file in its own
 * process, so the longer array never leaks into another suite.) The second
 * reads the source with its prose stripped and fails on a typed count of this
 * deck — "12-slide", "Eleven slides", "Rendering 11 slides".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_deck_slide_count_d581.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { SLIDE_META } from '../src/lib/pitchDeckViewModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const SURFACES = [
  'frontend/src/lib/spinoutBrief.js',
  'frontend/src/lib/spinoutLabArsenal.js',
  'frontend/src/components/PitchDeckModals.jsx',
];

test('the deck has eleven slides, as D360 and the template say', () => {
  assert.equal(SLIDE_META.length, 11);
});

test('every count of the deck follows SLIDE_META: one more slide, and they all say twelve', async () => {
  SLIDE_META.push({ ...SLIDE_META[SLIDE_META.length - 1], prefix: 'extra' });
  try {
    const brief = await import('../src/lib/spinoutBrief.js');
    const { LAB_TOOLS } = await import('../src/lib/spinoutLabArsenal.js');
    const templates = await import('../src/decks/templates/index.ts');
    const { PitchDeckExportModal } = await import('../src/components/PitchDeckModals.jsx');

    assert.equal(brief.DECK_SLIDES, 12);
    assert.ok(brief.DELIVERABLES.includes('Twelve-slide pitch deck'),
      `the brief's deliverable does not follow the array: ${JSON.stringify(brief.DELIVERABLES)}`);
    assert.equal(brief.TOOL_EXAMPLE_READS.deck.read, 'Twelve slides from recorded data');
    assert.equal(LAB_TOOLS.find((t) => t.id === 'deck').blurb, 'Twelve slides from your own data.');

    const registry = Object.values(templates).find((v) => v && typeof v === 'object' && v.axal_spinout_demoday);
    assert.ok(registry, 'the template registry is not exported');
    assert.equal(registry.axal_spinout_demoday.slide_count, 12);
    assert.match(registry.axal_spinout_demoday.description, /^12 slides · /);

    const modal = renderToStaticMarkup(React.createElement(PitchDeckExportModal, { phase: 'rendering', progress: 10 }));
    assert.match(modal, /Rendering 12 slides · Axal VC Spin-Out/);
  } finally {
    SLIDE_META.pop();
  }
});

test('no surface types the deck\'s length', () => {
  const TYPED = /\b(?:\d+|ten|eleven|twelve|thirteen)[- ]slides?\b/i;
  for (const file of SURFACES) {
    const lines = codeOnly(read(file)).split('\n').filter((l) => TYPED.test(l));
    assert.deepEqual(lines, [], `${file} types the deck's slide count`);
  }
  const templates = codeOnly(read('frontend/src/decks/templates/index.ts'));
  const row = /axal_spinout_demoday: \{[^\n]*/.exec(templates)?.[0] || '';
  assert.ok(row, 'the axal_spinout_demoday registry row is gone');
  assert.doesNotMatch(row, /slide_count: \d/, 'the registry types the slide count');
  assert.match(row, /description: SPINOUT_DECK_DESCRIPTION,/);
  assert.match(templates, /const SPINOUT_DECK_DESCRIPTION = `\$\{SLIDE_META\.length\} slides · /);
});

test('the decision and the route map record eleven, and the canvas\'s thirteen as a departure', () => {
  const d = read('documentation/architecture/decisions/D581.md');
  assert.match(d, /eleven/i);
  assert.match(d, /thirteen/i);
  const row = read('documentation/architecture/ROUTE_MAP.md').split('\n').find((l) => l.startsWith('| Pitch Deck Builder |'));
  assert.ok(row, 'the Pitch Deck Builder row is gone');
  assert.match(row, /D581/);
  assert.match(row, /thirteen/i);
});
