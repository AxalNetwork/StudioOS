/**
 * D1576 (#3823, deck v2 E3) — entrances and transitions.
 *
 *   1. the model keeps an area's entrance and a card's transition, drops a
 *      malformed one on read and refuses it on save;
 *   2. the order: by `order`, then reading order;
 *   3. the PowerPoint: one click effect per entrance, in that order, each on
 *      its own shape, with PowerPoint's preset, and the card's p:transition;
 *   4. Present and the PowerPoint play the same sequence: the browser's
 *      `motionModel` reveals the areas in the order the PPTX clicks them.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/motion_d1576.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRANCES, MOTION_MS, ORDER_MAX, TRANSITIONS, entranceOf, entranceSequence } from '../src/services/decks/motion.ts';
import { modelProblems } from '../src/services/decks/slideModel.ts';
import { sanitizeSlides } from '../src/routes/decks.ts';
import { ENTRANCE_PRESETS, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import * as front from '../../frontend/src/pages/raise/pitch/motionModel.js';

const URL_OK = (u: string) => u;
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });
const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };

// Reading order would be h, a, b, c; the authored orders put c first, then a, then b and h by reading order.
const CARD = {
  title: 'Traction', transition: 'push',
  blocks: [
    { id: 'h', kind: 'text', style: 'heading', text: 'Traction', grid: g(1, 12, 1, 1), entrance: { effect: 'fade' } },
    { id: 'a', kind: 'text', style: 'paragraph', text: 'Pilots', grid: g(1, 6, 2, 6), entrance: { effect: 'rise', order: 2 } },
    { id: 'b', kind: 'metric', label: 'Pilots', value: '3', grid: g(7, 9, 2, 3), entrance: { effect: 'zoom' } },
    { id: 'c', kind: 'text', style: 'paragraph', text: 'Signed', grid: g(10, 12, 2, 3), entrance: { effect: 'wipe', order: 1 } },
    { id: 'd', kind: 'text', style: 'paragraph', text: 'Always on', grid: g(7, 12, 4, 6) },
  ],
};

function unzip(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true);
    const nameLen = v.getUint16(i + 26, true);
    const extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    i = start + size;
  }
  return out;
}
const slideXml = async (card: any) => unzip((await writeEditableDeck({ slides: [card], renderable: [{ title: 'x', fields: [] }] as any, brand: BRAND, notes: false, images: new Map() })).bytes).get('ppt/slides/slide1.xml')!;

test('1. the model keeps an entrance and a transition, drops a malformed one on read, refuses it on save', () => {
  // Mutation checked: entranceOf not called in sanitizeBlocks → the kept entrance check fails; motionProblems dropped → the refusals fail.
  const [s] = sanitizeSlides([CARD]) as any[];
  assert.equal(s.transition, 'push');
  assert.deepEqual(s.blocks.find((b: any) => b.id === 'a').entrance, { effect: 'rise', order: 2 });
  assert.equal(s.blocks.find((b: any) => b.id === 'd').entrance, undefined, 'no entrance, no field: a card from before E3 hashes as it did');
  const [bad] = sanitizeSlides([{ ...CARD, transition: 'spin', blocks: [{ ...CARD.blocks[0], entrance: { effect: 'bounce' } }] }]) as any[];
  assert.equal(bad.transition, undefined);
  assert.equal(bad.blocks[0].entrance, undefined);
  assert.deepEqual(modelProblems([{ ...CARD, transition: 'spin' }], URL_OK), ['Card 1: the transition must be fade, push or wipe.']);
  assert.deepEqual(modelProblems([{ ...CARD, blocks: [{ ...CARD.blocks[0], entrance: { effect: 'bounce' } }] }], URL_OK), ['Card 1: an entrance must be fade, rise, zoom or wipe.']);
  assert.deepEqual(modelProblems([{ ...CARD, blocks: [{ ...CARD.blocks[0], entrance: { effect: 'fade', order: 99 } }] }], URL_OK), [`Card 1: an entrance's order is a whole number from 1 to ${ORDER_MAX}.`]);
  assert.deepEqual(modelProblems([CARD], URL_OK), []);
  assert.equal(entranceOf({ effect: 'fade', order: 0 })?.order, undefined);
});

test('2. the order: an authored order first, then reading order; an area with no entrance is not in it', () => {
  // Mutation checked: the order key ignored → reading order (h, a, b, c) fails.
  assert.deepEqual(entranceSequence(CARD), ['c', 'a', 'h', 'b']);
  assert.deepEqual(entranceSequence({ blocks: [] }), []);
});

test('3. the PowerPoint: one click per entrance in that order, each on its shape with its preset, and the transition', async () => {
  // Mutation checked: the timing written in stored order → the spid order fails; a preset swapped → the presetID check fails;
  // the transition left out → the p:transition check fails.
  const xml = await slideXml(CARD);
  const spidOf = (name: string) => {
    const at = xml.indexOf(`" name="${name}"`);
    assert.ok(at > 0, name);
    const open = xml.lastIndexOf('<p:cNvPr id="', at) + '<p:cNvPr id="'.length;
    return Number(xml.slice(open, at));
  };
  const expected = ['c', 'a', 'h', 'b'].map((id) => ({ text: `text ${id}`, metric: `metric ${id}` })).map((n, k) => spidOf(k === 3 ? n.metric : n.text));
  const effects = [...xml.matchAll(/presetID="(\d+)" presetClass="entr"[^>]*nodeType="clickEffect"/g)].map((m) => Number(m[1]));
  // PowerPoint's own entrance presets: Fade 10, Wipe 22, Ascend 42, Zoom 53.
  assert.deepEqual(ENTRANCE_PRESETS, { fade: 10, rise: 42, zoom: 53, wipe: 22 });
  assert.deepEqual(effects, [22, 42, 10, 53]);
  const clicks = [...xml.matchAll(/<p:set><p:cBhvr>[\s\S]*?<p:spTgt spid="(\d+)"\/>/g)].map((m) => Number(m[1]));
  assert.deepEqual(clicks, expected, 'each click shows its own area, in the sequence');
  assert.equal((xml.match(/delay="indefinite"/g) || []).length, 4, 'one click each');
  assert.ok(xml.includes(`dur="${MOTION_MS}"`));
  assert.match(xml, /<\/p:cSld><p:transition spd="med"><p:push dir="u"\/><\/p:transition><p:timing>/, 'the transition, then the timing, after the shapes');
  // No entrance and no transition: neither element.
  const still = await slideXml({ ...CARD, transition: undefined, blocks: CARD.blocks.map((b) => ({ ...b, entrance: undefined })) });
  assert.doesNotMatch(still, /<p:timing>|<p:transition/);
  // An area the writer draws nothing for (an empty text block) is not a click.
  const empty = await slideXml({ ...CARD, blocks: [{ ...CARD.blocks[0], text: '' }, CARD.blocks[1]] });
  assert.equal((empty.match(/nodeType="clickEffect"/g) || []).length, 1);
});

test('4. Present and the PowerPoint play the same sequence: the browser reveals the areas in the order the PPTX clicks them', () => {
  // Mutation checked: the browser's sort reversed → the sequence check fails; a list changed on one side → the equal lists fail.
  assert.deepEqual([...front.ENTRANCES], [...ENTRANCES]);
  assert.deepEqual([...front.TRANSITIONS], [...TRANSITIONS]);
  assert.equal(front.MOTION_MS, MOTION_MS);
  assert.equal(front.ORDER_MAX, ORDER_MAX);
  const fixtures = [CARD, { blocks: [] }, { blocks: [{ id: 'x', grid: g(1, 1, 6, 6), entrance: { effect: 'fade' } }, { id: 'y', grid: g(1, 1, 1, 1), entrance: { effect: 'fade' } }] }];
  for (const card of fixtures) assert.deepEqual(front.entranceSequence(card), entranceSequence(card));
  // Stepping Present through the card reveals exactly the PPTX's click order.
  const revealed: string[] = [];
  let at = { card: 0, shown: 0 };
  for (let k = 0; k < 4; k += 1) {
    at = front.presentStep(at, 'next', [CARD]);
    revealed.push(...CARD.blocks.filter((b) => !front.areaMotion(CARD, b.id, at.shown, true).hidden && b.entrance && !revealed.includes(b.id)).map((b) => b.id));
  }
  assert.deepEqual(revealed, entranceSequence(CARD));
});
