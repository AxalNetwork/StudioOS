// D1515 (#3767, deck v2 A4c, plan §5.9.2) — the undo model, over seeded
// random decks (a failure names its seed and its op):
//
//   1. op then inverse returns the original: for every op of `gridOps.js`,
//      applying the op and then its inverse gives back the deck exactly, and
//      the inverse's inverse gives the edited deck again (redo);
//   2. a run of random steps undone all the way returns the original, and
//      redone all the way returns the end, through the 100-step history;
//   3. the history: 100 steps kept, typing within 800 ms is one step, Accept
//      all (one group) is one step, a new edit clears redo, and a charged
//      step stays marked so undo can say "Still charged";
//   4. find and replace skips bound values: a metric, a figure's binding and
//      a chart keep their words, and rich runs keep their marks;
//   5. the editing keys.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_grid_ops_d1515.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOUND_NEVER, HISTORY_STEPS, OPS, apply, editKey, emptyHistory, findIn, historyCounts, perform, record, redo, undo,
} from '../src/pages/raise/pitch/gridOps.js';
import { STRUCTURES } from '../src/pages/raise/pitch/gridModel.js';
import { dividersOf } from '../src/pages/raise/pitch/gridSelection.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pickOf = (r, list) => list[int(r, 0, list.length - 1)];
const RUNS = 400;
const overlaps = (x, y) => x.c1 <= y.c2 && y.c1 <= x.c2 && x.r1 <= y.r2 && y.r1 <= x.r2;
const WORDS = ['revenue', 'Synthetic', 'growth', 'team', 'MRR', 'pilot', 'Revenue', 'customers', 'seed'];
const words = (r, n) => Array.from({ length: n }, () => pickOf(r, WORDS)).join(' ');
const clone = (v) => JSON.parse(JSON.stringify(v));

/** A synthetic card: text blocks (some rich), a bound metric, sometimes a chart, notes, flags. */
function randomCard(r, n) {
  const blocks = [];
  for (let i = 0; i < int(r, 1, 6); i += 1) {
    const c1 = int(r, 1, 10), r1 = int(r, 1, 5);
    const g = { c1, c2: Math.min(12, c1 + int(r, 0, 4)), r1, r2: Math.min(6, r1 + int(r, 0, 2)) };
    if (blocks.some((b) => overlaps(b.grid, g))) continue;
    const kind = pickOf(r, ['text', 'text', 'text', 'metric', 'chart']);
    if (kind === 'text') {
      const text = words(r, int(r, 1, 30));
      const rich = r() < 0.4 ? { paras: [{ runs: [{ text: text.slice(0, 5), b: true }, { text: text.slice(5) }].filter((x) => x.text) }] } : {};
      blocks.push({ id: `b${i}`, kind, style: pickOf(r, ['heading', 'paragraph', 'list']), text, grid: g, ...rich });
    } else if (kind === 'metric') {
      blocks.push({ id: `b${i}`, kind, label: 'MRR', value: 'revenue 4200', binding: { source_key: 'revenue.mrr', as_of: '2026-10-01', grade: 'Measured' }, grid: g });
    } else {
      blocks.push({ id: `b${i}`, kind, chart_type: 'line', title: 'revenue', series: [{ label: 'revenue', binding: { source_key: 'revenue.mrr' } }], grid: g });
    }
  }
  return {
    uid: `c${n}`, title: words(r, 2), layout: 'statement', blocks,
    ...(r() < 0.5 ? { notes: words(r, 5) } : {}), ...(r() < 0.2 ? { appendix: true } : {}), ...(r() < 0.2 ? { hidden: true } : {}),
    ...(r() < 0.2 ? { background: { color: '#ffffff', image_url: null } } : {}),
  };
}

function randomDoc(r) {
  return {
    cards: Array.from({ length: int(r, 1, 6) }, (_, i) => randomCard(r, i + 1)),
    theme: r() < 0.5 ? null : { kind: pickOf(r, ['neutral_light', 'sand', 'ocean']) },
    audience: r() < 0.5 ? null : 'seed_fund',
  };
}

/** One random op of `type` on `doc`, with arguments that make sense for it (or null when it cannot apply). */
function randomOp(r, doc, type) {
  const n = doc.cards.length;
  const index = int(r, 0, n - 1);
  const card = doc.cards[index];
  const blocks = card.blocks || [];
  const block = blocks.length ? pickOf(r, blocks) : null;
  switch (type) {
    case 'setCard': return { type, index, card: { ...card, title: words(r, 3) } };
    case 'setCards': return { type, cards: [...doc.cards].reverse() };
    case 'setDoc': return { type, parts: { cards: doc.cards.slice(0, Math.max(1, n - 1)), theme: { kind: 'sand', aspect: '4:3' } } };
    case 'setTheme': return { type, theme: r() < 0.3 ? null : { kind: pickOf(r, ['brand', 'forest', 'neutral_dark']) } };
    case 'setAudience': return { type, audience: r() < 0.3 ? null : 'angel' };
    case 'applyBrand': return r() < 0.5 ? { type } : { type, theme: { kind: 'neutral_light' } };
    case 'setStructure': return { type, index, structure: pickOf(r, STRUCTURES).id };
    case 'moveDivider': {
      const divs = dividersOf(card);
      return divs.length ? { type, index, div: pickOf(r, divs), delta: pickOf(r, [-2, -1, 1, 2]) } : null;
    }
    case 'moveOverflowToNotes': return block ? { type, index, id: block.id, aspect: pickOf(r, ['16:9', '4:3']) } : null;
    case 'addBlock': {
      const c1 = int(r, 1, 12), r1 = int(r, 1, 6);
      return { type, index, block: { kind: 'text', style: 'paragraph', text: words(r, 2), grid: { c1, c2: c1, r1, r2: r1 } } };
    }
    case 'insertBlock': return { type, index, at: int(r, 0, blocks.length), block: { id: `x${int(r, 1, 99)}`, kind: 'text', text: 'new', grid: { c1: 1, c2: 1, r1: 1, r2: 1 } } };
    case 'removeBlock': return block ? { type, index, id: block.id } : null;
    case 'updateBlock': return block ? { type, index, id: block.id, patch: { text: words(r, 2), ...(r() < 0.5 ? { style: 'list' } : {}), ...(r() < 0.3 ? { fresh: 1 } : {}) }, ...(r() < 0.3 ? { drop: ['paras'] } : {}) } : null;
    case 'moveArea': return block ? { type, index, id: block.id, grid: { c1: 1, c2: 1, r1: 6, r2: 6 } } : null;
    case 'insertProposal': return { type, index, card: { ...card, blocks: blocks.map((b) => (b.kind === 'text' ? { ...b, text: 'Accepted words' } : b)) } };
    // Sometimes two placements on one card (Accept all on two areas of it): the inverse must undo them last first.
    case 'insertBatch': return r() < 0.5
      ? { type, items: [{ index: 0, card: { ...doc.cards[0], title: 'Batch a' } }, { index: 0, card: { ...doc.cards[0], title: 'Batch b' } }] }
      : { type, items: doc.cards.slice(0, 2).map((c, i) => ({ index: i, card: { ...c, title: `Batch ${i}` } })) };
    case 'moveCard': return { type, from: index, to: int(r, 0, n - 1) };
    case 'reorderCards': {
      const order = doc.cards.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i -= 1) { const j = int(r, 0, i); [order[i], order[j]] = [order[j], order[i]]; }
      return { type, order };
    }
    case 'duplicateCard': return { type, index, uid: `k${int(r, 100, 999)}` };
    case 'insertCard': return { type, index: int(r, 0, n), card: { uid: `k${int(r, 100, 999)}`, title: 'New card', blocks: [] } };
    case 'removeCard': return n > 1 ? { type, index } : null;
    case 'setFlag': return { type, index, key: pickOf(r, ['appendix', 'section', 'hidden']), value: pickOf(r, [true, undefined, 'Market', false]) };
    case 'hideCard': return { type, index, hidden: r() < 0.5 };
    case 'decorOp': return { type, index, decor: r() < 0.3 ? [] : [{ id: 'd1', kind: 'rule' }] };
    case 'findReplace': return { type, find: pickOf(r, WORDS), replace: pickOf(r, ['', 'ARR', 'Revenue run-rate']), matchCase: r() < 0.5 };
    case 'noop': return { type };
    default: throw new Error(`no generator for ${type}`);
  }
}

test('1. op then inverse returns the original, for every op, over seeded random decks', () => {
  const applied = Object.fromEntries(OPS.map((o) => [o, 0]));
  for (let seed = 1; seed <= RUNS; seed += 1) {
    for (const type of OPS) {
      const r = rng(seed * 101 + OPS.indexOf(type));
      const doc = randomDoc(r);
      const before = clone(doc);
      const op = randomOp(r, doc, type);
      if (!op) continue;
      const a = apply(doc, op);
      assert.deepEqual(doc, before, `seed ${seed} ${type}: the op mutated the deck it was given`);
      if (a.error) { assert.equal(a.inverse, null, `seed ${seed} ${type}: a refusal has no inverse`); assert.equal(a.doc, doc); continue; }
      applied[type] += 1;
      const b = apply(a.doc, a.inverse);
      assert.equal(b.error, undefined, `seed ${seed} ${type}: the inverse was refused: ${b.error}`);
      assert.deepEqual(clone(b.doc), before, `seed ${seed} ${type}: op then inverse is not the original`);
      // Redo: the inverse's own inverse gives the edited deck again.
      const c = apply(b.doc, b.inverse);
      assert.deepEqual(clone(c.doc), clone(a.doc), `seed ${seed} ${type}: the inverse's inverse is not the edit`);
    }
  }
  for (const type of OPS) assert.ok(applied[type] > 20, `${type} was applied only ${applied[type]} times`);
  // Plan §5.9.2's list, and #3765's structure and divider ops, are all here.
  for (const op of ['setStructure', 'moveDivider', 'addBlock', 'updateBlock', 'removeBlock', 'moveArea', 'insertProposal', 'insertBatch', 'setTheme',
    'applyBrand', 'reorderCards', 'duplicateCard', 'hideCard', 'moveOverflowToNotes', 'findReplace', 'decorOp']) assert.ok(OPS.includes(op), op);
  assert.match(apply({ cards: [] }, { type: 'nope' }).error, /not one the editor knows/);
});

test('2. random steps undone all the way return the original; redone all the way return the end', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const r = rng(seed);
    const start = randomDoc(r);
    let doc = start;
    let h = emptyHistory();
    const docs = [clone(start)];
    for (let k = 0; k < int(r, 1, 30); k += 1) {
      const op = randomOp(r, doc, pickOf(r, OPS));
      if (!op) continue;
      const p = perform(doc, h, op, { label: op.type, at: k * 1000 });
      if (p.error) continue;
      doc = p.doc; h = p.history; docs.push(clone(doc));
    }
    const end = clone(doc);
    assert.equal(historyCounts(h).undo, docs.length - 1, `seed ${seed}`);
    for (let k = docs.length - 1; k > 0; k -= 1) {
      const u = undo(doc, h);
      doc = u.doc; h = u.history;
      assert.deepEqual(clone(doc), docs[k - 1], `seed ${seed}: undo ${docs.length - k}`);
    }
    assert.equal(undo(doc, h), null, 'nothing left to undo');
    while (historyCounts(h).redo) { const x = redo(doc, h); doc = x.doc; h = x.history; }
    assert.deepEqual(clone(doc), end, `seed ${seed}: redo all is the end`);
  }
});

test('3. the history: 100 steps, typing and Accept all are one step each, a new edit clears redo, a charged step stays marked', () => {
  let doc = { cards: [{ uid: 'c1', title: 'Synthetic', blocks: [{ id: 'b1', kind: 'text', text: '', grid: { c1: 1, c2: 6, r1: 1, r2: 2 } }] }, { uid: 'c2', blocks: [] }], theme: null, audience: null };
  let h = emptyHistory();
  // Typing: one keystroke every 300 ms is one step; a pause over 800 ms starts the next.
  let t = 0;
  for (const text of ['S', 'Sy', 'Syn', 'Synt']) { t += 300; ({ doc, history: h } = perform(doc, h, { type: 'updateBlock', index: 0, id: 'b1', patch: { text } }, { coalesce: 'text:c1:b1', at: t })); }
  assert.equal(historyCounts(h).undo, 1, 'four keystrokes within 800 ms of each other are one step');
  t += 900;
  ({ doc, history: h } = perform(doc, h, { type: 'updateBlock', index: 0, id: 'b1', patch: { text: 'Synth' } }, { coalesce: 'text:c1:b1', at: t }));
  assert.equal(historyCounts(h).undo, 2, 'a pause of 900 ms starts a new step');
  // Accept all: three placements, awaited one after another, are one step, and it was charged.
  for (const title of ['A1', 'A2', 'A3']) ({ doc, history: h } = perform(doc, h, { type: 'insertProposal', index: 1, card: { uid: 'c2', title, blocks: [] } }, { group: 'accept-all:1', charged: true, at: (t += 5000) }));
  assert.equal(historyCounts(h).undo, 3, 'Accept all is one step');
  const u = undo(doc, h);
  assert.equal(u.step.charged, true, 'the undone step placed a charged run');
  assert.equal(u.doc.cards[1].title, undefined, 'the whole batch is undone at once');
  assert.equal(u.doc.cards[0].blocks[0].text, 'Synth');
  // A new edit clears what could be redone.
  const after = perform(u.doc, u.history, { type: 'setTheme', theme: { kind: 'sand' } }, { at: t + 1 });
  assert.equal(historyCounts(after.history).redo, 0);
  // 100 steps are kept; the 101st forgets the oldest.
  let d = { cards: [{ uid: 'c1', blocks: [] }], theme: null, audience: null };
  let hh = emptyHistory();
  for (let i = 0; i < HISTORY_STEPS + 5; i += 1) ({ doc: d, history: hh } = perform(d, hh, { type: 'setFlag', index: 0, key: 'section', value: `S${i}` }, { at: i * 2000 }));
  assert.equal(HISTORY_STEPS, 100);
  assert.equal(historyCounts(hh).undo, 100);
  for (let i = 0; i < 100; i += 1) ({ doc: d, history: hh } = undo(d, hh));
  assert.equal(d.cards[0].section, 'S4', 'the five oldest steps were forgotten');
  // One charged step on its own (an accepted run, no group) stays marked too.
  const lone = perform({ cards: [{ uid: 'c1', blocks: [] }], theme: null, audience: null }, emptyHistory(), { type: 'insertProposal', index: 0, card: { uid: 'c1', title: 'Accepted', blocks: [] } }, { charged: true, at: 1 });
  assert.equal(undo(lone.doc, lone.history).step.charged, true);
  // Typing that joins the step on top after an undo still clears what could be redone.
  let td = { cards: [{ uid: 'c1', blocks: [] }], theme: null, audience: null };
  let th = emptyHistory();
  ({ doc: td, history: th } = perform(td, th, { type: 'setFlag', index: 0, key: 'notes', value: 'a' }, { coalesce: 'notes:c1', at: 0 }));
  ({ doc: td, history: th } = perform(td, th, { type: 'setTheme', theme: { kind: 'sand' } }, { at: 100 }));
  ({ doc: td, history: th } = undo(td, th));
  ({ doc: td, history: th } = perform(td, th, { type: 'setFlag', index: 0, key: 'notes', value: 'ab' }, { coalesce: 'notes:c1', at: 200 }));
  assert.deepEqual(historyCounts(th), { undo: 1, redo: 0 }, 'the undone theme can no longer be redone');
  // A refused op records nothing.
  const refused = perform(d, hh, { type: 'setStructure', index: 0, structure: 'not-one' });
  assert.match(refused.error, /seventeen/);
  // record() without a time never coalesces.
  const r0 = record(record(emptyHistory(), { ops: [{ type: 'noop' }], inverses: [{ type: 'noop' }], coalesce: 'x' }), { ops: [{ type: 'noop' }], inverses: [{ type: 'noop' }], coalesce: 'x' });
  assert.equal(r0.past.length, 2);
});

test('4. find and replace skips bound values', () => {
  const doc = {
    theme: null, audience: null,
    cards: [{
      uid: 'c1', title: 'Revenue story', notes: 'Say revenue twice: revenue.',
      blocks: [
        { id: 'b1', kind: 'text', text: 'Revenue grew; revenue matters.', grid: { c1: 1, c2: 6, r1: 1, r2: 2 } },
        { id: 'b2', kind: 'metric', label: 'Revenue', value: 'revenue 4200', binding: { source_key: 'revenue.mrr', grade: 'Measured' }, grid: { c1: 7, c2: 9, r1: 1, r2: 2 } },
        { id: 'b3', kind: 'text', text: 'Revenue (bound)', binding: { source_key: 'revenue.arr' }, grid: { c1: 10, c2: 12, r1: 1, r2: 2 } },
        { id: 'b4', kind: 'chart', title: 'Revenue', series: [{ label: 'Revenue', binding: { source_key: 'revenue.mrr' } }], grid: { c1: 1, c2: 6, r1: 3, r2: 6 } },
        { id: 'b5', kind: 'text', text: 'Big revenue', paras: [{ runs: [{ text: 'Big ', b: true }, { text: 'revenue', accent: '#6d28d9' }] }], grid: { c1: 7, c2: 12, r1: 3, r2: 4 } },
      ],
    }],
  };
  const before = clone(doc);
  const found = findIn(doc, { find: 'revenue' });
  assert.deepEqual(found, { matches: 6, cards: 1, skipped: 4 }, 'the title 1, the notes 2, b1 2 and b5 1 are found; the metric 2, the bound text 1 and the chart 1 are counted as skipped');
  const r = apply(doc, { type: 'findReplace', find: 'revenue', replace: 'ARR' });
  const [card] = r.doc.cards;
  assert.equal(card.title, 'ARR story');
  assert.equal(card.notes, 'Say ARR twice: ARR.');
  assert.equal(card.blocks[0].text, 'ARR grew; ARR matters.');
  assert.deepEqual(card.blocks[1], before.cards[0].blocks[1], 'the metric (a bound figure) is untouched');
  assert.deepEqual(card.blocks[2], before.cards[0].blocks[2], 'a block with a binding is untouched');
  assert.deepEqual(card.blocks[3], before.cards[0].blocks[3], 'a chart is untouched');
  assert.equal(card.blocks[4].text, 'Big ARR');
  assert.deepEqual(card.blocks[4].paras, [{ runs: [{ text: 'Big ', b: true }, { text: 'ARR', accent: '#6d28d9' }] }], 'the replacement keeps the marks of the words it replaced');
  assert.deepEqual(clone(apply(r.doc, r.inverse).doc), before, 'one undo step puts every card back');
  // Match case.
  assert.equal(apply(doc, { type: 'findReplace', find: 'Revenue', replace: 'X', matchCase: true }).doc.cards[0].blocks[0].text, 'X grew; revenue matters.');
  // Words found only in bound figures: nothing to replace, and it says so.
  const only = apply(doc, { type: 'findReplace', find: '4200', replace: '9999' });
  assert.match(only.error, /No match for “4200”/);
  assert.equal(findIn(doc, { find: '4200' }).skipped, 1);
  assert.equal(BOUND_NEVER, 'Bound figures are never replaced.');
  // A metric is a figure even when it carries no binding (a typed one): it is never rewritten either.
  const typed = { theme: null, audience: null, cards: [{ uid: 'c1', blocks: [{ id: 'm', kind: 'metric', label: 'Revenue', value: '4200', grid: { c1: 1, c2: 3, r1: 1, r2: 2 } }, { id: 't', kind: 'text', text: 'Revenue', grid: { c1: 4, c2: 6, r1: 1, r2: 2 } }] }] };
  const rt = apply(typed, { type: 'findReplace', find: 'Revenue', replace: 'ARR' });
  assert.equal(rt.doc.cards[0].blocks[0].label, 'Revenue');
  assert.equal(rt.doc.cards[0].blocks[1].text, 'ARR');
  assert.deepEqual(findIn(typed, { find: 'Revenue' }), { matches: 1, cards: 1, skipped: 1 }, 'the typed metric counts as a bound figure left alone');
});

test('5. the editing keys: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Cmd/Ctrl+F; a text field keeps its own undo', () => {
  const body = { tagName: 'BODY' };
  assert.equal(editKey({ key: 'z', metaKey: true, target: body }), 'undo');
  assert.equal(editKey({ key: 'z', ctrlKey: true, target: body }), 'undo');
  assert.equal(editKey({ key: 'Z', metaKey: true, shiftKey: true, target: body }), 'redo');
  assert.equal(editKey({ key: 'y', ctrlKey: true, target: body }), 'redo');
  assert.equal(editKey({ key: 'f', ctrlKey: true, target: body }), 'find');
  assert.equal(editKey({ key: 'f', metaKey: true, target: { tagName: 'TEXTAREA' } }), 'find', 'Find opens from anywhere');
  assert.equal(editKey({ key: 'z', metaKey: true, target: { tagName: 'TEXTAREA' } }), null, 'a text field keeps its native undo');
  assert.equal(editKey({ key: 'z', metaKey: true, target: { tagName: 'DIV', isContentEditable: true } }), null);
  assert.equal(editKey({ key: 'z', target: body }), null);
  assert.equal(editKey({ key: 'z', metaKey: true, altKey: true, target: body }), null);
});
