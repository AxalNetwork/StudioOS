/**
 * D1576 (#3823, deck v2 E3) — entrances and transitions, the browser half.
 *
 *   1. Present's steps: → reveals the next area, then moves on; ← hides the
 *      last, then goes back to the previous card with all of it shown;
 *   2. an area's state at a step, and reduced motion (the same steps, nothing
 *      moves, no transition);
 *   3. BlockGrid draws an area not yet revealed in its place, hidden;
 *   4. the controls: the entrance in BlockTools (only with an area's tools),
 *      the transition under ⋯ › This card, and Present wired to play them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/motion_d1576.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import {
  ENTRANCE_LINE, MOTION_MS, areaMotion, entranceSequence, presentStep, transitionMotion, withEntrance,
} from '../src/pages/raise/pitch/motionModel.js';
import { BlockGrid } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { EntranceTools } from '../src/pages/raise/pitch/BlockTools.jsx';
import TransitionSheet from '../src/pages/raise/pitch/TransitionSheet.jsx';
import { MORE_MENU } from '../src/pages/raise/pitch/deckV2Model.js';
import { cardOf } from '../src/pages/raise/pitch/presentExportModel.js';

const h = React.createElement;
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const A = { title: 'One', transition: 'fade', blocks: [
  { id: 'h', kind: 'text', style: 'heading', text: 'One', grid: g(1, 12, 1, 1) },
  { id: 'x', kind: 'text', style: 'paragraph', text: 'First', grid: g(1, 6, 2, 6), entrance: { effect: 'rise' } },
  { id: 'y', kind: 'text', style: 'paragraph', text: 'Second', grid: g(7, 12, 2, 6), entrance: { effect: 'fade' } },
] };
const B = { title: 'Two', blocks: [{ id: 'z', kind: 'text', style: 'paragraph', text: 'Only', grid: g(1, 12, 1, 6), entrance: { effect: 'zoom' } }] };
const C = { title: 'Three', blocks: [{ id: 'q', kind: 'text', style: 'paragraph', text: 'Still', grid: g(1, 12, 1, 6) }] };
const CARDS = [A, B, C];

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => [container, ...walk(document.body)];
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  return { by, pr, async press(id) { await act(async () => { pr(by(id)).onClick?.({}); }); }, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('1. Present’s steps: next reveals, then moves on; prev hides, then goes back with the card shown', () => {
  // Mutation checked: next always moving on → the shown 1 and 2 steps fail; prev landing on shown 0 → the back-step fails.
  let at = { card: 0, shown: 0 };
  const trail = [];
  for (let k = 0; k < 5; k += 1) { at = presentStep(at, 'next', CARDS); trail.push([at.card, at.shown]); }
  assert.deepEqual(trail, [[0, 1], [0, 2], [1, 0], [1, 1], [2, 0]]);
  assert.deepEqual(presentStep({ card: 2, shown: 0 }, 'next', CARDS), { card: 2, shown: 0 }, 'the last card stays');
  assert.deepEqual(presentStep({ card: 1, shown: 1 }, 'prev', CARDS), { card: 1, shown: 0 });
  assert.deepEqual(presentStep({ card: 1, shown: 0 }, 'prev', CARDS), { card: 0, shown: 2 }, 'back to the previous card, all shown');
  assert.deepEqual(presentStep({ card: 1, shown: 1 }, 'first', CARDS), { card: 0, shown: 0 });
  assert.deepEqual(presentStep({ card: 0, shown: 0 }, 'last', CARDS), { card: 2, shown: 0 });
  assert.deepEqual(entranceSequence(A), ['x', 'y']);
});

test('2. an area at a step, and reduced motion: the same steps, nothing moves, no transition', () => {
  // Mutation checked: reduced motion ignored → the null animation fails; a revealed area animating on every step → the 'shown' check fails.
  assert.deepEqual(areaMotion(A, 'h', 0, false), { hidden: false, animation: null }, 'no entrance: always shown');
  assert.deepEqual(areaMotion(A, 'x', 0, false), { hidden: true, animation: null });
  assert.equal(areaMotion(A, 'x', 1, false).animation, `deck-in-rise ${MOTION_MS}ms ease-out both`);
  assert.deepEqual(areaMotion(A, 'x', 2, false), { hidden: false, animation: null }, 'it animates only on the step that revealed it');
  assert.deepEqual(areaMotion(A, 'x', 1, true), { hidden: false, animation: null });
  assert.deepEqual(areaMotion(A, 'y', 1, true), { hidden: true, animation: null }, 'reduced motion keeps the steps');
  assert.equal(transitionMotion(A, false), `deck-tr-fade ${MOTION_MS}ms ease-out both`);
  assert.equal(transitionMotion(A, true), null);
  assert.equal(transitionMotion(C, false), null);
  assert.equal(cardOf(A, 0).transition, 'fade', 'Present’s card keeps its transition');
  assert.deepEqual(withEntrance({}, 'zoom', '3'), { entrance: { effect: 'zoom', order: 3 } });
  assert.deepEqual(withEntrance({}, null), { entrance: null });
});

test('3. BlockGrid keeps an area not yet revealed in its place, hidden', async () => {
  // Mutation checked: motion ignored → the hidden state fails.
  const v = await mount(h(BlockGrid, { blocks: A.blocks, colours: { bg: '#fff', ink: '#000', accent: '#60f', muted: '#666' }, motion: (b) => areaMotion(A, b.id, 1, false) }));
  try {
    assert.equal(v.pr(v.by('deck-block-y'))['data-motion'], 'hidden');
    assert.equal(v.pr(v.by('deck-block-y')).style.visibility, 'hidden');
    assert.ok(v.pr(v.by('deck-block-y')).style.gridColumn || v.pr(v.by('deck-block-y')).style.left || Object.keys(v.pr(v.by('deck-block-y')).style).length > 1, 'it keeps its place');
    assert.equal(v.pr(v.by('deck-block-x'))['data-motion'], 'entering');
    assert.equal(v.pr(v.by('deck-block-h'))['data-motion'], 'shown');
  } finally { await v.unmount(); }
});

test('4. the controls: an entrance with the area’s tools, a transition under ⋯ › This card, and Present plays them', async () => {
  // Mutation checked: the entrance control's patch dropped → the patch check fails; the menu item removed → the This card check fails.
  const patches = [];
  let v = await mount(h(EntranceTools, { block: A.blocks[1], onPatch: (p) => patches.push(p) }));
  try {
    assert.equal(v.pr(v.by('pitch-tools-entrance-rise'))['aria-pressed'], true);
    await v.press('pitch-tools-entrance-wipe');
    await v.press('pitch-tools-entrance-none');
    assert.deepEqual(patches, [{ entrance: { effect: 'wipe' } }, { entrance: null }]);
  } finally { await v.unmount(); }
  const picked = [];
  v = await mount(h(TransitionSheet, { card: A, index: 0, readOnly: false, onTransition: (t) => picked.push(t), onClose() {} }));
  try {
    assert.equal(v.pr(v.by('pitch-transition-fade'))['aria-checked'], true);
    await v.press('pitch-transition-push');
    await v.press('pitch-transition-none');
    assert.deepEqual(picked, ['push', null]);
  } finally { await v.unmount(); }
  assert.ok(MORE_MENU.find((s) => s.id === 'card').items.some((it) => it.id === 'transition'), '⋯ › This card › Transition');
  const read = (f) => readFileSync(new URL(`../src/pages/raise/pitch/${f}`, import.meta.url), 'utf8');
  assert.match(read('BlockTools.jsx'), /<EntranceTools block=\{block\} onPatch=\{onPatch\} \/>/, 'inside the one-block tools only');
  assert.match(read('PitchEditor.jsx'), /'background', 'transition', /);
  assert.match(read('PitchEditor.jsx'), /key: 'transition', value: t \?\? undefined/);
  const present = read('PitchPresent.jsx');
  assert.match(present, /presentStep\(at, s, cards\)/, 'the keys step through the entrances');
  assert.match(present, /motion=\{playing \? \(b\) => areaMotion\(card, b\.id, shown, reduced\) : null\}/);
  assert.match(present, /prefers-reduced-motion: reduce/);
  assert.ok(ENTRANCE_LINE.includes('Reduced motion'));
});
