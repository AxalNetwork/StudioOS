/**
 * D1533 (#3777, deck v2 B1) — direct manipulation, the Worker half.
 *
 *   - a saved card keeps its decor, its groups, its locks (`pinned`) and its
 *     decor layer order through `sanitizeBlocks` and `sanitizeModel`, and a
 *     second pass changes nothing;
 *   - `modelProblems` refuses decor that holds a figure or body text, a decor
 *     box off the 8 px baseline and a malformed group id, and accepts the
 *     card; the fit check reads it as it reads the card without them;
 *   - the editable PowerPoint draws the decor under the blocks in layer order,
 *     locks what is pinned and makes each group one group shape; and the print
 *     page's plan (`frontend/.../arrangeModel.decorPlan`, what the PDF draws)
 *     is this file's plan, item for item, so the PDF and the PowerPoint agree.
 *
 * Every card is synthetic.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/deck_arrange_d1533.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { BLOCK_KINDS, modelProblems, sanitizeBlocks, sanitizeModel } from '../src/services/decks/slideModel.ts';
import { EXPORT_GEOMETRY, TONE_COLOURS, atOf, decorPlan } from '../src/services/decks/arrange.ts';
import { fitProblems } from '../src/services/decks/designSystem.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import * as front from '../../frontend/src/pages/raise/pitch/arrangeModel.js';

const url = (u: string | null | undefined) => (typeof u === 'string' && u.startsWith('https://') ? u : null);

/** The card as the editor saves it after pd26's moves. */
const SAVED = {
  title: 'Synthetic arrange', layout: 'title',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 6, r1: 1, r2: 2 }, style: 'heading', text: 'Synthetic heading', group: 'g1', pinned: true },
    { id: 'b2', kind: 'text', grid: { c1: 7, c2: 12, r1: 1, r2: 2 }, style: 'paragraph', text: 'Synthetic words', group: 'g1' },
    { id: 'b3', kind: 'metric', grid: { c1: 1, c2: 3, r1: 4, r2: 5 }, label: 'MRR', value: null },
  ],
  decor: [
    { id: 'd1', kind: 'shape', grid: { c1: 9, c2: 10, r1: 4, r2: 5 }, layer: 3, group: 'g2', pinned: true },
    { id: 'd2', kind: 'shape', at: { x: 1600, y: 760, w: 96, h: 96 }, layer: 1, group: 'g2' },
    { id: 'd3', kind: 'divider', at: { x: 112, y: 976, w: 640, h: 8 }, layer: 2 },
  ],
};

test('a saved card keeps its decor, groups, locks and layer order through sanitizeBlocks and sanitizeModel', () => {
  const blocks = sanitizeBlocks(SAVED.blocks, url);
  assert.deepEqual(blocks.map((b) => [b.id, b.group ?? null, b.pinned ?? false]), [['b1', 'g1', true], ['b2', 'g1', false], ['b3', null, false]]);
  const kept = sanitizeModel(SAVED, url) as any;
  assert.deepEqual(kept.blocks, blocks, 'sanitizeModel keeps what sanitizeBlocks keeps');
  // The layer order d2 (1), d3 (2), d1 (3), stored bottom first, with group g2's members sharing one place,
  // where its lowest (d2) stood: d2, d1, then d3.
  assert.deepEqual(kept.decor.map((d: any) => [d.id, d.layer, d.group ?? null, d.pinned ?? false]), [['d2', 1, 'g2', false], ['d1', 2, 'g2', true], ['d3', 3, null, false]]);
  assert.deepEqual(kept.decor[0].at, { x: 1600, y: 760, w: 96, h: 96 }, 'the 8 px box');
  assert.deepEqual(kept.decor[1].grid, { c1: 9, c2: 10, r1: 4, r2: 5 }, 'a range-placed item keeps its range');
  assert.deepEqual(sanitizeModel({ ...SAVED, ...kept }, url), kept, 'a second save changes nothing');
  // Decor overlaps content only as decor: d1 sits over no block's cells but could, and is never a block.
  assert.ok(!kept.blocks.some((b: any) => b.id.startsWith('d')));
});

test('sanitize drops what is not arrange: an off-grid box, a bad group, a pin that is not true, decor that claims a block kind', () => {
  const kept = sanitizeModel({
    blocks: [{ id: 'b1', kind: 'text', grid: { c1: 1, c2: 2, r1: 1, r2: 1 }, text: 'x', group: 'no spaces allowed', pinned: 'yes' }],
    decor: [
      { id: 'd1', kind: 'shape', at: { x: 13, y: 0, w: 96, h: 96 } },
      { id: 'd2', kind: 'text', text: 'Body words' },
      { id: 'd3', kind: 'shape', at: { x: 1920, y: 0, w: 96, h: 96 } },
    ],
  }, url) as any;
  assert.deepEqual(Object.keys(kept.blocks[0]).sort(), ['grid', 'id', 'kind', 'style', 'text']);
  assert.deepEqual(kept.decor.map((d: any) => d.id), ['d1', 'd3'], 'a text item is not decor');
  assert.equal(kept.decor[0].at, undefined, 'never rounded into place');
  assert.equal(kept.decor[1].at, undefined, 'off the slide');
  assert.equal(atOf({ x: 1824, y: 984, w: 96, h: 96 })?.x, 1824, 'the last 8 px step inside 1920 × 1080');
});

test('modelProblems: decor never holds a figure or body text; its box is on 8 px; a group id is a plain id; the card is sound', () => {
  assert.deepEqual(modelProblems([SAVED], url), []);
  const card = (decor: any[], blocks: any[] = SAVED.blocks) => modelProblems([{ ...SAVED, blocks, decor }], url);
  for (const d of [{ id: 'd9', kind: 'shape', text: 'Body words' }, { id: 'd9', kind: 'shape', value: '$1M' }, { id: 'd9', kind: 'shape', binding: { source_key: 'grow.arr' } }, { id: 'd9', kind: 'chart' }, { id: 'd9', kind: 'shape', series: [] }]) {
    assert.deepEqual(card([d]), ['Card 1: decor never holds a figure or body text.'], JSON.stringify(d));
  }
  assert.deepEqual(card([{ id: 'd9', kind: 'shape', at: { x: 4, y: 0, w: 96, h: 96 } }]), ['Card 1: a decor item\'s box sits on the 8 px baseline, inside the slide.']);
  assert.deepEqual(card([{ id: 'd9', kind: 'shape', group: 'a group' }]), ['Card 1: a group id is at most 40 letters, digits, - or _.']);
  assert.deepEqual(card([], [{ ...SAVED.blocks[0], group: 'a group' }]), ['Card 1, block 1: a group id is at most 40 letters, digits, - or _.']);
  assert.ok((BLOCK_KINDS as readonly string[]).includes('text'));
  // The fit check reads the arranged card as it reads the card without the arrange fields.
  const bare = { ...SAVED, decor: undefined, blocks: SAVED.blocks.map(({ group: _g, pinned: _p, ...b }: any) => b) };
  assert.deepEqual(fitProblems([SAVED]), fitProblems([bare]));
});

// ------------------------------------------------------------------ the exports

function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true), nameLen = v.getUint16(i + 26, true), extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    i = start + size;
  }
  return out;
}
const BRAND = { show_footer: false, footer_text: '', watermark_url: null, can_remove_footer: true } as any;

/**
 * The saved card as the exports read it. The shape each item draws is its
 * `ref` and `tone`, the elements library's fields (#3779, D1541's `decorOf`
 * keeps them). Until that merges, a save drops them, so they are put back here
 * the way #3779 stores them: a circle, a square and a divider line.
 */
function exported() {
  const kept = sanitizeModel(SAVED, url) as any;
  const lib: Record<string, { ref: string; tone: string }> = { d1: { ref: 'circle', tone: 'accent' }, d2: { ref: 'rect', tone: 'muted' }, d3: { ref: 'line', tone: 'ink' } };
  return { ...SAVED, ...kept, decor: kept.decor.map((d: any) => ({ ...d, ...lib[d.id] })) };
}

test('the editable PowerPoint: decor under the blocks in layer order, pinned items locked, each group one group shape', async () => {
  const card = exported();
  const xml = unzip((await writeEditableDeck({ slides: [card], renderable: [{ title: 'Synthetic arrange', fields: [] }], brand: BRAND, notes: false, images: new Map() })).bytes).get('ppt/slides/slide1.xml')!;
  const names = [...xml.matchAll(/name="((?:Decor|Group|text|metric) [^"]+)"/g)].map((m) => m[1]);
  // Decor first, in layer order: group g2 (d2, d1) as one shape, then d3; then the blocks, g1 as one shape.
  assert.deepEqual(names, ['Group g2', 'Decor d2', 'Decor d1', 'Decor d3', 'Group g1', 'text b1', 'text b2', 'metric b3']);
  const shape = (name: string) => xml.slice(xml.indexOf(`name="${name}"`), xml.indexOf(name.startsWith('Decor d3') ? '</p:cxnSp>' : '</p:sp>', xml.indexOf(`name="${name}"`)));
  assert.match(shape('Decor d2'), /prst="rect"/);
  assert.match(shape('Decor d2'), /<a:srgbClr val="64748B"\/>/, 'the muted tone');
  assert.match(shape('Decor d1'), /prst="ellipse"/);
  assert.match(shape('Decor d1'), /<a:spLocks noMove="1" noResize="1"\/>/, 'pinned');
  assert.doesNotMatch(shape('Decor d2'), /spLocks/, 'not pinned');
  assert.match(shape('Decor d3'), /<p:cxnSp>|prst="line"/);
  assert.match(shape('text b1'), /<a:spLocks noMove="1" noResize="1"\/>/, 'a pinned area');
  assert.doesNotMatch(shape('text b2'), /spLocks/);
  // d2's box is its 8 px `at`, in EMU (6350 a card pixel).
  assert.match(shape('Decor d2'), /<a:off x="10160000" y="4826000"\/><a:ext cx="609600" cy="609600"\/>/);
  // Only some of g1 is pinned, so the group shape itself is not locked.
  assert.doesNotMatch(xml.slice(xml.indexOf('name="Group g1"'), xml.indexOf('name="text b1"')), /grpSpLocks/);
  assert.ok(xml.indexOf('name="Decor d3"') < xml.indexOf('name="text b1"'), 'decor is under every block');
});

test('the PDF and the PowerPoint draw the same decor: the print page\'s plan is the Worker\'s, item for item', async () => {
  const card = exported();
  assert.deepEqual(front.EXPORT_GEOMETRY, EXPORT_GEOMETRY, 'one shape table');
  assert.deepEqual(front.TONE_COLOURS, TONE_COLOURS, 'one tone table');
  assert.equal(front.NUDGE_LINE, 'Arrow keys nudge by 8 px.');
  const plan = decorPlan(card);
  assert.deepEqual(front.decorPlan(card), plan, 'what PrintDecor draws (frontend) is what the PowerPoint draws (Worker)');
  assert.deepEqual(plan.map((d) => [d.id, d.geometry, d.colour, d.group, d.pinned, d.layer]), [
    ['d2', 'rect', '#64748b', 'g2', false, 1], ['d1', 'ellipse', '#6d28d9', 'g2', true, 2], ['d3', 'line', '#0f2a3d', null, false, 3],
  ]);
  const xml = unzip((await writeEditableDeck({ slides: [card], renderable: [{ title: 'x', fields: [] }], brand: BRAND, notes: false, images: new Map() })).bytes).get('ppt/slides/slide1.xml')!;
  const drawn = [...xml.matchAll(/name="Decor (d\d)"/g)].map((m) => m[1]);
  assert.deepEqual(drawn, plan.filter((d) => d.geometry).map((d) => d.id), 'the PowerPoint stacks every planned shape in the plan\'s order');
  // An item with no native shape (an icon, until #3779's art reaches the exports) is drawn by neither.
  const icon = { ...card, decor: [{ id: 'd7', kind: 'icon', ref: 'rocket' }] };
  assert.equal(decorPlan(icon)[0].geometry, null);
  assert.equal(front.decorPlan(icon)[0].geometry, null);
  assert.doesNotMatch(unzip((await writeEditableDeck({ slides: [icon], renderable: [{ title: 'x', fields: [] }], brand: BRAND, notes: false, images: new Map() })).bytes).get('ppt/slides/slide1.xml')!, /Decor d7/);
});
