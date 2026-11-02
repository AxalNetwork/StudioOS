// D1533 (#3777, deck v2 B1, pd26, pd3b) — direct manipulation on The Grid:
// guides, 8 px snap, spacing markers, the 8 px nudge, multi-select and group,
// the Arrange set on the selection only, the decor layers list, and the print
// page's decor. Every card is synthetic.
//
// The issue's "3 testers place 10 elements with no off-grid edge" is a
// usability test with people, which CI cannot run. Its automated stand-in is
// the seeded property test below: 400 seeded cards, ten arrange operations
// each, and no operation ever leaves an edge off its layer's grid (an area on
// whole cells, a decor box on 8 px inside the slide), or two areas on one cell.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_arrange_d1533.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { CARD, DECK, mountEditor } from './_pitch_editor_mount.mjs';
import {
  ARRANGE_OPS, DECOR_RULE, LAYERS_TITLE, MIXED, NO_LAYERS, NUDGE_LINE, PINNED, arrange, arrangeState, decorLabel, decorPlan, guidesFor,
  moveDecor, movedPx, nudgeStep, offGridEdges, spacingOf,
} from '../src/pages/raise/pitch/arrangeModel.js';
import { groupSelection, pickGroup } from '../src/pages/raise/pitch/gridSelection.js';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';

const h = React.createElement;

// ───────────────────────────────────────────── the property test (seeded)

/** A small seeded generator (mulberry32), so a failure names its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const overlaps = (a, z) => a.c1 <= z.c2 && z.c1 <= a.c2 && a.r1 <= z.r2 && z.r1 <= a.r2;

/** A card: up to six areas on free cells, and two to five decor items, some on a range, some on an 8 px box. */
function cardOf(r) {
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const blocks = [];
  for (let i = 0; i < 12 && blocks.length < 6; i += 1) {
    const c1 = int(1, 11); const r1 = int(1, 6);
    const g = { c1, c2: Math.min(12, c1 + int(0, 3)), r1, r2: Math.min(6, r1 + int(0, 1)) };
    if (!blocks.some((b) => overlaps(b.grid, g))) blocks.push({ id: `b${blocks.length + 1}`, kind: 'text', grid: g, text: 'Synthetic', ...(r() < 0.2 ? { pinned: true } : {}) });
  }
  const decor = Array.from({ length: int(2, 5) }, (_, i) => {
    const d = { id: `d${i + 1}`, kind: 'shape', ref: 'circle' };
    if (r() < 0.4) { const c1 = int(1, 11); const r1 = int(1, 5); d.grid = { c1, c2: c1 + 1, r1, r2: r1 + 1 }; } else d.at = { x: 8 * int(0, 200), y: 8 * int(0, 110), w: 8 * int(1, 30), h: 8 * int(1, 20) };
    if (r() < 0.15) d.pinned = true;
    return d;
  });
  return { title: 'Synthetic', blocks, decor };
}

test('property (the testers\' stand-in): 400 seeded cards × 10 arrange operations never leave an edge off its grid', () => {
  // Mutation checked: `snap` dropped from moveDecor's x → an off-8 px edge; areaTargets' Math.round dropped → a fractional
  // cell; decorTargets' `fit` not clamping → off the slide; the overlap check skipped → two areas on one cell. Each fails here.
  const OPS = ARRANGE_OPS.map((o) => o.id);
  let ran = 0; let refused = 0;
  for (let seed = 1; seed <= 400; seed += 1) {
    const r = rng(seed);
    let card = cardOf(r);
    // A grid-placed item is not yet on 8 px; the first move or alignment puts it there.
    for (let step = 0; step < 10; step += 1) {
      const ids = [...card.blocks.map((b) => String(b.id)), ...card.decor.map((d) => `decor:${d.id}`)];
      const decorOnly = r() < 0.6;
      const pool = ids.filter((x) => x.startsWith('decor:') === decorOnly);
      const selection = pool.filter(() => r() < 0.6);
      if (!selection.length) continue;
      const before = JSON.stringify(card);
      let res;
      if (decorOnly && r() < 0.4) {
        const dx = Math.round((r() - 0.5) * 900); const dy = Math.round((r() - 0.5) * 500);
        res = moveDecor(card, selection, dx, dy);
      } else {
        res = arrange(card, selection, OPS[Math.floor(r() * OPS.length)], { aspect: '16:9' });
      }
      if (res.error || res.same) {
        refused += 1;
        assert.equal(JSON.stringify(card), before, `seed ${seed}, step ${step}: a refusal changes nothing`);
        continue;
      }
      ran += 1;
      const moved = new Set(res.card.decor.filter((d, i) => JSON.stringify(d) !== JSON.stringify(card.decor.find((x) => x.id === d.id))).map((d) => d.id));
      card = res.card;
      assert.deepEqual(offGridEdges(card), [], `seed ${seed}, step ${step}: every edge on its grid`);
      for (const d of card.decor) if (moved.has(d.id) && d.at === undefined && !d.grid) assert.fail(`seed ${seed}: a moved decor item lost its place`);
      for (const [i, a] of card.blocks.entries()) for (const z of card.blocks.slice(i + 1)) assert.ok(!overlaps(a.grid, z.grid), `seed ${seed}, step ${step}: ${a.id} and ${z.id} share a cell`);
      // A pinned item never moves.
      for (const d of card.decor) if (d.pinned && JSON.parse(before).decor.find((x) => x.id === d.id)?.pinned) assert.deepEqual(d.at, JSON.parse(before).decor.find((x) => x.id === d.id).at, `seed ${seed}: pinned ${d.id} moved`);
    }
  }
  assert.ok(ran > 1500, `the operations ran (${ran}), not only refused (${refused})`);
});

// ───────────────────────────────────────────── the pure parts

const DECOR_CARD = {
  ...CARD,
  decor: [
    { id: 'd1', kind: 'shape', ref: 'circle', tone: 'accent', at: { x: 160, y: 160, w: 96, h: 96 } },
    { id: 'd2', kind: 'shape', ref: 'rect', at: { x: 400, y: 200, w: 96, h: 96 } },
    { id: 'd3', kind: 'divider', ref: 'line', at: { x: 800, y: 400, w: 320, h: 8 } },
  ],
};
const D = (...ids) => ids.map((i) => `decor:${i}`);

test('the nudge is 8 px ("Moved 8 px"; Shift, 24), snapped, and a locked item keeps its place', () => {
  assert.equal(NUDGE_LINE, 'Arrow keys nudge by 8 px.');
  assert.deepEqual(nudgeStep('ArrowRight'), [8, 0]);
  assert.deepEqual(nudgeStep('ArrowUp', true), [0, -24]);
  assert.equal(nudgeStep('a'), null);
  const r = moveDecor(DECOR_CARD, D('d1'), 8, 0);
  assert.equal(r.line, 'Moved 8 px');
  assert.deepEqual(r.card.decor[0].at, { x: 168, y: 160, w: 96, h: 96 });
  assert.deepEqual(moveDecor(DECOR_CARD, D('d1'), 13, 0).card.decor[0].at.x, 176, 'a drag snaps to 8 px');
  assert.equal(movedPx(24), 'Moved 24 px');
  const pinned = { ...DECOR_CARD, decor: DECOR_CARD.decor.map((d) => (d.id === 'd1' ? { ...d, pinned: true } : d)) };
  assert.deepEqual(moveDecor(pinned, D('d1'), 8, 0), { error: PINNED });
  assert.deepEqual(moveDecor(DECOR_CARD, D('d1'), -4000, 0).card.decor[0].at.x, 0, 'kept on the slide');
});

test('guides where edges or centres meet, and the spacing markers to the nearest item each way', () => {
  const g = guidesFor({ x: 160, y: 400, w: 96, h: 96 }, [{ x: 160, y: 100, w: 40, h: 40 }, { x: 900, y: 448, w: 8, h: 8 }]);
  assert.deepEqual(g.v, [160], 'left edges meet');
  assert.deepEqual(g.h, [448], 'the centre meets an edge');
  assert.deepEqual(guidesFor({ x: 912, y: 0, w: 96, h: 8 }, []).v, [960], 'the slide\'s centre');
  const gaps = spacingOf({ x: 160, y: 160, w: 96, h: 96 }, [{ x: 280, y: 160, w: 96, h: 96 }, { x: 160, y: 280, w: 96, h: 96 }, { x: 600, y: 160, w: 8, h: 8 }]);
  assert.deepEqual(gaps.map((x) => [x.axis, x.px]), [['h', 24], ['v', 24]], '"24 px", the nearest each way');
});

test('the Arrange set: pd26\'s thirteen tools, each refused with its reason where it cannot run', () => {
  assert.deepEqual(ARRANGE_OPS.map((o) => o.label), ['Align left', 'Align centre', 'Align right', 'Align top', 'Align middle', 'Align bottom', 'Distribute horizontally', 'Distribute vertically', 'Group', 'Lock', 'Bring forward', 'Send back', 'Copy style']);
  const mixed = arrangeState(DECOR_CARD, ['b2', 'decor:d1']);
  assert.deepEqual(mixed['align-left'], { ok: false, why: MIXED });
  assert.deepEqual(mixed.group, { ok: false, why: MIXED });
  assert.equal(mixed.lock.ok, true, 'lock reaches both');
  assert.deepEqual(arrangeState(DECOR_CARD, ['b2']).forward, { ok: false, why: NO_LAYERS }, 'areas have no layers');
  assert.equal(arrangeState(DECOR_CARD, D('d1', 'd2'))['distribute-h'].ok, false, 'three or more to distribute');
  assert.equal(arrangeState(DECOR_CARD, D('d1', 'd2', 'd3'))['distribute-h'].ok, true);
  assert.deepEqual(arrange(DECOR_CARD, ['b2', 'decor:d1'], 'align-left'), { error: MIXED });
});

test('align, distribute, layers, group, lock and copy style on decor; an area alignment that would overlap is refused', () => {
  const left = arrange(DECOR_CARD, D('d1', 'd2', 'd3'), 'align-left').card;
  assert.deepEqual(left.decor.map((d) => d.at.x), [160, 160, 160]);
  const spread = arrange(DECOR_CARD, D('d1', 'd2', 'd3'), 'distribute-h').card;
  assert.deepEqual(spread.decor.map((d) => d.at.x), [160, 480, 800], 'equal gaps (224 px), on 8 px');
  const up = arrange(DECOR_CARD, D('d1'), 'forward').card;
  assert.deepEqual(decorPlan(up).map((d) => d.id), ['d2', 'd1', 'd3'], 'Bring forward');
  assert.deepEqual(decorPlan(arrange(up, D('d1'), 'back').card).map((d) => d.id), ['d1', 'd2', 'd3'], 'Send back');
  assert.equal(arrange(DECOR_CARD, D('d3'), 'forward').line, 'Already at the top.');
  const grouped = arrange(DECOR_CARD, D('d1', 'd3'), 'group');
  assert.equal(grouped.line, 'Grouped 2 items.');
  assert.deepEqual(decorPlan(grouped.card).map((d) => [d.id, d.group]), [['d1', 'g1'], ['d3', 'g1'], ['d2', null]], 'a group shares one place in the layer order');
  assert.deepEqual(groupSelection(grouped.card, 'decor:d3'), ['decor:d1', 'decor:d3'], 'a click selects the group');
  assert.deepEqual(pickGroup([], null, 'decor:d3', {}, grouped.card), ['decor:d1', 'decor:d3']);
  assert.deepEqual(pickGroup(['decor:d1', 'decor:d3'], null, 'decor:d3', { shift: true }, grouped.card), ['decor:d1'], 'Shift takes one away');
  assert.equal(arrange(grouped.card, D('d1', 'd3'), 'group').line, 'Ungrouped.');
  const locked = arrange(DECOR_CARD, ['b2', 'decor:d1'], 'lock');
  assert.equal(locked.line, 'Locked. Unlock to move it.');
  assert.equal(locked.card.decor[0].pinned, true);
  assert.equal(locked.card.blocks.find((b) => b.id === 'b2').pinned, true);
  assert.equal(locked.card.blocks.find((b) => b.id === 'b2').locked, undefined, 'never the brand-kit lock (#3819)');
  assert.equal(arrange(locked.card, ['b2', 'decor:d1'], 'lock').line, 'Unlocked.');
  const styled = arrange(DECOR_CARD, D('d1', 'd2', 'd3'), 'copy-style').card;
  assert.deepEqual(styled.decor.map((d) => d.tone), ['accent', 'accent', 'accent']);
  // Areas: b3 aligned left onto b2's columns overlaps it, so nothing changes; aligned top it fits.
  assert.deepEqual(arrange(CARD, ['b2', 'b3'], 'align-left'), { error: 'That range overlaps the 7 × 5 text. Pick a free range.' });
  assert.deepEqual(arrange(CARD, ['b2', 'b3'], 'align-bottom').card.blocks.find((b) => b.id === 'b3').grid, { c1: 8, c2: 10, r1: 5, r2: 6 });
  // A centre between two cells rounds to a whole cell, never a half (mutation checked: Math.round dropped → refused).
  const two = { blocks: [{ id: 'a', kind: 'text', grid: { c1: 1, c2: 3, r1: 1, r2: 1 } }, { id: 'z', kind: 'text', grid: { c1: 5, c2: 10, r1: 3, r2: 3 } }] };
  assert.deepEqual(arrange(two, ['a', 'z'], 'align-centre').card.blocks.map((b) => b.grid), [{ c1: 5, c2: 7, r1: 1, r2: 1 }, { c1: 3, c2: 8, r1: 3, r2: 3 }]);
});

test('the layers list names each item by the elements library (#3779) when it answers, else by kind', () => {
  assert.equal(LAYERS_TITLE, 'LAYERS · DECOR ONLY');
  assert.equal(DECOR_RULE, 'Decor never holds a figure or body text.');
  const lib = { available: true, value: { shapes: [{ kind: 'shape', ref: 'circle', label: 'Circle' }], dividers: [{ kind: 'divider', ref: 'line', label: 'Line' }], icons: { items: [] } } };
  assert.equal(decorLabel({ kind: 'shape', ref: 'circle' }, lib), 'Circle');
  assert.equal(decorLabel({ kind: 'divider', ref: 'line' }, lib), 'Line');
  assert.equal(decorLabel({ kind: 'shape', ref: 'circle' }, { available: false }), 'Shape · circle', 'until #3779 answers');
});

// ───────────────────────────────────────────── the print page (the PDF)

test('print: the decor under the blocks, in layer order, each shape with its layer, group and lock', async () => {
  const card = { ...DECOR_CARD, decor: [{ ...DECOR_CARD.decor[0], layer: 3, group: 'g1', pinned: true }, { ...DECOR_CARD.decor[1], layer: 1 }, { ...DECOR_CARD.decor[2], layer: 2 }, { id: 'd4', kind: 'icon', ref: 'rocket', layer: 4 }] };
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(StudioPrintCard, { slide: card, index: 0 })));
  try {
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const nodes = walk(container);
    const decor = nodes.filter((n) => /^print-decor-0-d\d$/.test(pr(n)['data-testid'] || ''));
    assert.deepEqual(decor.map((n) => [pr(n)['data-testid'].slice(-2), pr(n)['data-geometry'], pr(n)['data-layer'], pr(n)['data-group'], pr(n)['data-pinned']]),
      [['d2', 'rect'], ['d3', 'line'], ['d1', 'ellipse']].map(([id, g]) => {
        const p = decorPlan(card).find((x) => x.id === id);
        return [id, g, p.layer, p.group || undefined, p.pinned ? 'true' : undefined];
      }), 'the plan\'s order; an icon has no native shape and is placed in neither export');
    const at = (id) => nodes.findIndex((n) => pr(n)['data-testid'] === id);
    assert.ok(at('print-decor-0') < at('print-blocks-0'), 'under the blocks');
    assert.equal(pr(decor[2]).style.borderRadius, '50%', 'the circle');
  } finally { await act(async () => root.unmount()); restore(); }
});

// ───────────────────────────────────────────── the editor, mounted

const withDecor = { deckGet: async () => ({ ...DECK, slides: [DECOR_CARD, DECK.slides[1]] }) };

test('the Arrange set appears only with a selection; an area alignment that overlaps is refused in grey, nothing changed', async () => {
  const m = await mountEditor();
  try {
    assert.ok(!m.by('pitch-arrange-tools'), 'nothing selected: no Arrange tools, never a permanent toolbar');
    await m.press(m.by('pitch-editor-block-b2'));
    assert.ok(m.by('pitch-arrange-tools'));
    assert.equal(m.walk(m.by('pitch-arrange-tools')).filter((n) => /^pitch-arrange-(align|distribute|group|lock|forward|back|copy)/.test(m.pr(n)['data-testid'] || '')).length, 13);
    assert.equal(m.pr(m.by('pitch-arrange-align-left'))['aria-disabled'], true, 'one area: nothing to align with');
    await m.press(m.by('pitch-editor-block-b3'), { shiftKey: true });
    await m.press(m.by('pitch-arrange-align-left'));
    assert.equal(m.text(m.by('pitch-arrange-refused')), 'That range overlaps the 7 × 5 text. Pick a free range. Nothing changed.');
    assert.ok(!m.by('pitch-editor-save'), 'nothing changed');
    await m.press(m.by('pitch-arrange-align-bottom'));
    assert.match(m.text(m.by('pitch-arrange-line')), /^Align bottom: 1 moved\.$/);
    assert.ok(m.by('pitch-editor-save'), 'one edit, held until Save');
    await m.press(m.by('pitch-editor-selbar-clear'));
    assert.ok(!m.by('pitch-arrange-tools'), 'cleared: gone again');
  } finally { await m.close(); }
});

test('the layers list selects decor; its handle nudges by 8 px with "Moved 8 px", guides and spacing markers', async () => {
  const m = await mountEditor({ answers: withDecor });
  try {
    const list = m.by('pitch-decor-layers');
    assert.match(m.text(list), /^LAYERS · DECOR ONLY 3 Divider · line 2 Shape · rect 1 Shape · circle Decor never holds a figure or body text\.$/);
    assert.ok(!m.by('pitch-editor-decor-handle-d1'), 'no handle until it is selected');
    await m.press(m.by('pitch-decor-layer-d1'));
    assert.equal(m.pr(m.by('pitch-decor-layer-d1'))['aria-pressed'], true);
    assert.ok(m.by('pitch-editor-decor-handle-d1'));
    assert.match(m.text(m.by('pitch-editor-decor-line')), /Arrow keys nudge by 8 px\./);
    assert.ok(m.by('pitch-arrange-tools'), 'the Arrange set for the decor');
    await m.fire(m.by('pitch-editor-decor-handle-d1'), 'onKeyDown', { key: 'ArrowRight' });
    assert.equal(m.text(m.by('pitch-editor-decor-moved')), 'Moved 8 px');
    assert.equal(m.pr(m.by('pitch-editor-decor-handle-d1')).style.left, `${(168 / 1920) * 100}%`, 'x 160 → 168');
    assert.ok(m.by('pitch-editor-save'), 'held until Save');
    // d1 (x 168…264) and d2 (x 400) share rows 200…256: a marker to d2.
    assert.ok(m.walk(m.container).some((n) => m.pr(n)['data-testid'] === 'pitch-editor-spacing' && m.text(n) === '136 px'));
    // Shift-click adds d2; Bring forward is decor's.
    await m.press(m.by('pitch-decor-layer-d2'), { shiftKey: true });
    await m.press(m.by('pitch-arrange-align-top'));
    assert.match(m.text(m.by('pitch-arrange-line')), /^Align top: 1 moved, on the 8 px grid\.$/);
    assert.ok(m.walk(m.container).some((n) => m.pr(n)['data-testid'] === 'pitch-editor-guide-h'), 'a violet guide where the tops meet');
  } finally { await m.close(); }
});

test('the source: a refused drop draws a grey ghost, never red; the adapter answers arrange locally, with no route', async () => {
  const stage = codeOnly(readFileSync('frontend/src/pages/raise/pitch/GridStage.jsx', 'utf8'));
  assert.match(stage, /ghost\.error \? 'border-gray-400 bg-gray-400\/15/);
  assert.doesNotMatch(stage, /\b(?:bg|border|text|outline)-red-/, 'never red');
  const seam = codeOnly(readFileSync('frontend/src/pages/raise/pitch/deckV2Adapter.js', 'utf8'));
  assert.doesNotMatch(seam, /export const arrange = [^\n]*through\(/, 'no route, so no through() and no contract');
  assert.ok(adapter.SWAPPED.includes('arrange'));
  assert.equal(adapter.availability('arrange'), null);
  const r = await adapter.arrange(DECOR_CARD, D('d1'), 'lock');
  assert.equal(r.available, true);
  assert.equal(r.value.card.decor[0].pinned, true);
});
