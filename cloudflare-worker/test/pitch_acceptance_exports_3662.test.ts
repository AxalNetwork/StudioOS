/**
 * #3662: the Pitch acceptance harness, offline part — no content lost on the
 * way out. Each synthetic fixture deck (`frontend/test/fixtures/
 * pitch_acceptance_decks.mjs`) goes the way a stored version goes:
 *   1. the read's sanitizer (`sanitizeSlides`, D898), which drops a block off
 *      the grid or on another;
 *   2. the offline HTML writer (D901's HTML export);
 *   3. the editable PowerPoint writer (D1112), unzipped, its slides' text read.
 * Every word a reader of the card should see (`readerTexts`) must be in each
 * file, after that file's own escaping. A figure nobody recorded must read
 * "Not recorded", never 0. The lossy fixture proves the harness catches a
 * loss: exactly its two faulty blocks are reported missing.
 *
 * What this does NOT prove (the live matrix in
 * documentation/operations/PITCH_ACCEPTANCE.md covers it): the PDF (Browser
 * Rendering photographs the print page), Google Slides, how the slides look,
 * and anything under real permissions.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pitch_acceptance_exports_3662.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSlides } from '../src/routes/decks.ts';
import { writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { DECKS, LOSSY_DROPPED, NOT_RECORDED, missingTexts, readerTexts } from '../../frontend/test/fixtures/pitch_acceptance_decks.mjs';

const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };
const htmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A store-mode zip reader, as deck_google_slides_d904's: the writer stores, it does not deflate. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 30 <= bytes.length && v.getUint32(i, true) === 0x04034b50) {
    const size = v.getUint32(i + 18, true);
    const nameLen = v.getUint16(i + 26, true);
    const extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    out.set(name, bytes.subarray(start, start + size));
    i = start + size;
  }
  return out;
}

async function exportsOf(deck: any) {
  const slides = sanitizeSlides(deck.slides);
  const html = await writeOfflineDeck({ title: deck.title, version: deck.version, slides, images: new Map(), footer: null, watermark: null, notes: true, sources: true });
  const pptx = await writeEditableDeck({
    slides, renderable: slides.map((s: any) => ({ title: s.title, fields: [] })) as any, brand: BRAND, notes: true, images: new Map(), chartShot: null,
  });
  const parts = unzip(pptx.bytes);
  const slideXml = [...parts.entries()].filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map(([, b]) => new TextDecoder().decode(b)).join('\n');
  return { slides, html, pptx, slideXml, parts };
}

for (const name of ['complete', 'sparse', 'multilingual'] as const) {
  test(`${name}: every word a reader should see reaches the HTML and the PowerPoint`, async () => {
    const deck = (DECKS as any)[name];
    const expected = readerTexts(deck);
    assert.ok(expected.length > 0, 'the fixture has words to check');
    const { slides, html, slideXml } = await exportsOf(deck);
    assert.equal(slides.length, deck.slides.length, 'no card lost by the read');
    assert.deepEqual(missingTexts(expected, html, htmlEsc), [], 'HTML');
    // The PowerPoint writes a metric's label in capitals, as the card's CSS draws it: case is not content.
    assert.deepEqual(missingTexts(expected, slideXml.toLowerCase(), (t: string) => xmlEsc(t).toLowerCase()), [], 'PowerPoint');
  });
}

test('sparse: a figure nobody recorded is "Not recorded" in both files, never 0', async () => {
  const { html, slideXml } = await exportsOf(DECKS.sparse);
  assert.ok(html.includes(NOT_RECORDED));
  assert.ok(slideXml.includes(NOT_RECORDED));
  assert.ok(!/>\s*0\s*</.test(html), 'no bare 0 in the HTML');
  assert.ok(!/<a:t>0<\/a:t>/.test(slideXml), 'no bare 0 in the PowerPoint');
});

test('complete: the PowerPoint has one slide per card, and the image without its file says so', async () => {
  const { slideXml, parts, pptx } = await exportsOf(DECKS.complete);
  const slideParts = [...parts.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert.equal(slideParts.length, DECKS.complete.slides.length);
  assert.equal(pptx.images.not_placed, 1, 'the fixture’s image URL is not fetched offline');
  assert.match(slideXml, /could not be included/);
});

test('lossy: the harness reports exactly the blocks the read dropped', async () => {
  const expected = readerTexts(DECKS.lossy);
  const { html, slideXml } = await exportsOf(DECKS.lossy);
  assert.deepEqual(missingTexts(expected, html, htmlEsc).map((m: any) => m.text).sort(), [...LOSSY_DROPPED].sort());
  assert.deepEqual(missingTexts(expected, slideXml.toLowerCase(), (t: string) => xmlEsc(t).toLowerCase()).map((m: any) => m.text).sort(), [...LOSSY_DROPPED].sort());
});

test('the same version exports the same bytes twice', async () => {
  const a = await exportsOf(DECKS.complete);
  const b = await exportsOf(DECKS.complete);
  assert.equal(a.html, b.html);
  assert.deepEqual(a.pptx.bytes, b.pptx.bytes);
});
