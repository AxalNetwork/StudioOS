// D1499 (#3749) part 2 — The Grid's one geometry on the page: the editor's
// stage, Present and print place every area with `gridModel.placeOf` (boxOf
// as a share of the 16:9 or 4:3 slide), the free areas come from the card's
// structure, and ⋯ › Slide size writes the theme's aspect.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_grid_stage_d1499.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  GRID, SLIDE_SIZES, STRUCTURES, boxOf, frameOf, placeOf, ratioOf, withAspect,
} from '../src/pages/raise/pitch/gridModel.js';
import { areasOf, structureAreas } from '../src/pages/raise/pitch/gridSelection.js';
import { changesOf } from '../src/pages/raise/pitch/editorModel.js';
import { BlockGrid } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';
import { CARD, MODEL, mountEditor } from './_pitch_editor_mount.mjs';

const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const h = React.createElement;
const ranges = () => {
  const out = [];
  for (let c1 = 1; c1 <= GRID.cols; c1 += 1) for (let c2 = c1; c2 <= GRID.cols; c2 += 1) {
    for (let r1 = 1; r1 <= GRID.rows; r1 += 1) for (let r2 = r1; r2 <= GRID.rows; r2 += 1) out.push({ c1, c2, r1, r2 });
  }
  return out;
};

test('placeOf is boxOf scaled to the face: every one of the 1,638 ranges within 1 px, at 16:9 and 4:3, at any width', () => {
  // Mutations checked: placeOf on a CSS gap of 8 px, or on a 3% padding, or 4:3 drawn on the 16:9 slide — each red.
  const all = ranges();
  assert.equal(all.length, 1638);
  for (const aspect of ['16:9', '4:3']) {
    const s = SLIDE_SIZES[aspect];
    for (const width of [s.width, 1280, 733, 360]) {
      const scale = width / s.width;
      const height = s.height * scale;
      for (const g of all) {
        const p = placeOf(g, aspect);
        const b = boxOf(g, aspect);
        const px = { x: (parseFloat(p.left) / 100) * width, y: (parseFloat(p.top) / 100) * height, w: (parseFloat(p.width) / 100) * width, h: (parseFloat(p.height) / 100) * height };
        for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(px[k] - b[k] * scale) <= 1, `${aspect} at ${width}: ${JSON.stringify(g)} ${k} ${px[k]} vs ${b[k] * scale}`);
      }
    }
  }
  assert.equal(ratioOf('4:3'), '4 / 3');
  assert.equal(ratioOf(undefined), '16 / 9', 'a theme with no aspect is 16:9');
  assert.deepEqual(frameOf('16:9'), placeOf({ c1: 1, c2: 12, r1: 1, r2: 6 }, '16:9'), 'the safe area is the whole grid');
});

test('the slide size lives in the theme: 4:3 is written, 16:9 is left out, and an untouched brand theme stays null', () => {
  assert.deepEqual(withAspect(null, '4:3'), { kind: 'brand', background: null, aspect: '4:3' });
  assert.equal(withAspect(null, '16:9'), null, 'a deck that never chose a size: no theme is written');
  assert.equal(withAspect({ kind: 'brand', background: null, aspect: '4:3' }, '16:9'), null, 'back to the default: the deck saves as it did');
  assert.deepEqual(withAspect({ kind: 'neutral_dark', background: null }, '4:3'), { kind: 'neutral_dark', background: null, aspect: '4:3' });
  assert.deepEqual(withAspect({ kind: 'neutral_dark', background: null, aspect: '4:3' }, undefined), { kind: 'neutral_dark', background: null });
  // A theme change keeps the size; the save summary says each on its own line.
  assert.match(read('pages/raise/pitch/DeckSheets.jsx'), /onTheme\(withAspect\(k === 'brand' && !theme\?\.background \? null : \{ kind: k, background: theme\?\.background \?\? null \}, theme\?\.aspect\)\)/);
  const base = { cards: [], theme: null, audience: null };
  assert.deepEqual(changesOf(base, { ...base, theme: { kind: 'brand', background: null, aspect: '4:3' } }), ['The slide size becomes Standard 4:3 (1440 × 1080).']);
  assert.deepEqual(changesOf(base, { ...base, theme: { kind: 'neutral_dark', background: null } }), ['The theme becomes Neutral dark.']);
});

test('the structure is the area source: its areas no block touches are the free areas, in its order', () => {
  // Mutations checked: the structure ignored (row-by-row ranges kept), a touched area kept — each red.
  const halves = { blocks: [{ id: 'b1', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 6 }, style: 'paragraph', text: 'Synthetic words' }], structure: 'halves' };
  assert.deepEqual(areasOf(halves, MODEL).map((a) => [a.id, a.kind]), [['b1', 'block'], ['free:7-1', 'free']]);
  assert.deepEqual(areasOf(halves, MODEL)[1].grid, { c1: 7, c2: 12, r1: 1, r2: 6 }, 'the right half, whole');
  const hero = { blocks: [], structure: 'hero_3' };
  assert.deepEqual(areasOf(hero, MODEL).map((a) => a.id), ['free:1-1', 'free:1-4', 'free:5-4', 'free:9-4'], 'Hero + 3, in its reading order');
  // A block that touches an area takes it; the areas it does not touch stay.
  const touched = { blocks: [{ id: 'b9', kind: 'metric', grid: { c1: 6, c2: 7, r1: 5, r2: 5 }, label: 'Synthetic' }], structure: 'hero_3' };
  assert.deepEqual(areasOf(touched, MODEL).map((a) => a.id), ['b9', 'free:1-1', 'free:1-4', 'free:9-4']);
  // The card's own areas win over the catalogue's; a bad one is skipped.
  const own = { blocks: [], structure: 'custom', areas: [{ id: 'x', c1: 1, c2: 12, r1: 1, r2: 2, order: 2 }, { id: 'y', c1: 1, c2: 12, r1: 3, r2: 6, order: 1 }, { id: 'z', c1: 0, c2: 3, r1: 1, r2: 1, order: 3 }] };
  assert.deepEqual(structureAreas(own, MODEL), [{ c1: 1, c2: 12, r1: 3, r2: 6 }, { c1: 1, c2: 12, r1: 1, r2: 2 }]);
  // No structure, or one this page does not know: the row-by-row free ranges, as before v2.
  assert.deepEqual(areasOf(CARD, MODEL).map((a) => a.id), areasOf({ ...CARD, structure: 'not_a_structure' }, MODEL).map((a) => a.id));
  assert.equal(structureAreas(CARD, MODEL), null);
  assert.equal(STRUCTURES.length, 17);
});

test('Present and print draw the same boxes: BlockGrid places from placeOf, the print page is the slide itself', () => {
  // Mutations checked: BlockGrid back on `gap-2 p-[3%]` / `gap-6`, the print page left at 1920 for 4:3 — each red.
  const blocks = [{ id: 'b1', kind: 'text', grid: { c1: 2, c2: 7, r1: 2, r2: 4 }, style: 'paragraph', text: 'Synthetic words' }];
  const colours = { bg: '#fff', ink: '#000', accent: '#60f', muted: '#666' };
  for (const aspect of ['16:9', '4:3']) {
    const html = renderToStaticMarkup(h(BlockGrid, { blocks, colours, live: true, size: 'print', aspect }));
    const p = placeOf(blocks[0].grid, aspect);
    assert.ok(html.includes(`left:${p.left}`) && html.includes(`top:${p.top}`) && html.includes(`width:${p.width}`) && html.includes(`height:${p.height}`), `${aspect}: ${html}`);
    assert.ok(html.includes(`data-aspect="${aspect}"`));
    assert.doesNotMatch(html, /gap-|p-\[3%\]|grid-template/, 'no CSS gap or padding, on screen or in print');
  }
  const four = renderToStaticMarkup(h(StudioPrintCard, { slide: { title: 'Synthetic', blocks }, index: 0, aspect: '4:3' }));
  assert.match(four, /width:1440px/, 'a 4:3 page is 1440 wide');
  const wide = renderToStaticMarkup(h(StudioPrintCard, { slide: { title: 'Synthetic', blocks }, index: 0 }));
  assert.match(wide, /width:1920px/, 'a deck that never chose 4:3 prints as it did');
  // Each surface reads the deck's own aspect.
  assert.match(read('pages/raise/pitch/PitchPresent.jsx'), /const aspect = aspectOf\(deck\?\.theme\?\.aspect\)/);
  assert.match(read('pages/PitchDeckPrintPage.jsx'), /@page \{ size: \$\{pageW\}px 1080px; margin: 0; \}/);
  assert.match(read('pages/PitchDeckPrintPage.jsx'), /aspect=\{deck\.theme\?\.aspect\}/);
});

test('⋯ › Slide size: 4:3 redraws the stage at once, says so in the save summary, and saves the theme’s aspect', async () => {
  let saved = null;
  const m = await mountEditor({ answers: { deckUpdate: async (id, body) => { saved = body; return { id: 32, project_id: 7, version: 4, title: body.title, slides: body.slides, theme: body.theme }; } } });
  try {
    assert.equal(m.pr(m.by('pitch-editor-card'))['data-aspect'], '16:9', 'a deck with no aspect is 16:9');
    assert.equal(m.pr(m.by('pitch-editor-card')).style.aspectRatio, '16 / 9');
    await m.press(m.by('deck-more-open'));
    assert.equal(m.pr(m.by('deck-more-size'))['aria-disabled'] ?? m.pr(m.by('deck-more-size')).disabled ?? false, false, 'no longer Coming later');
    await m.press(m.by('deck-more-size'));
    assert.ok(m.by('pitch-sheet-size'), 'an in-page sheet, never a browser pop-up');
    assert.match(m.text(m.by('pitch-sheet-size')), /Widescreen 16:9.*1920 × 1080.*Standard 4:3.*1440 × 1080/);
    await m.type(m.by('pitch-size-4x3'), true);
    assert.equal(m.pr(m.by('pitch-editor-card'))['data-aspect'], '4:3');
    assert.equal(m.pr(m.by('pitch-editor-card')).style.aspectRatio, '4 / 3');
    // The blocks move onto the 4:3 slide's boxes: the same cells, narrower columns.
    const b2 = m.pr(m.by('pitch-editor-block-b2')).style;
    assert.equal(b2.left, placeOf({ c1: 1, c2: 7, r1: 2, r2: 6 }, '4:3').left);
    assert.equal(b2.width, placeOf({ c1: 1, c2: 7, r1: 2, r2: 6 }, '4:3').width);
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/, 'held until Save');
    await m.press(m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-changes')), /The slide size becomes Standard 4:3 \(1440 × 1080\)\./);
    await m.press(m.by('pitch-editor-save-run'));
    assert.equal(saved?.theme?.aspect, '4:3', 'the save carries the aspect');
  } finally { await m.close(); }
});
