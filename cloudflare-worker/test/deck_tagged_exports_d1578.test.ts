/**
 * D1578 (#3825, deck v2 E5) — tagged PDF, PowerPoint reading order, and AI
 * marking that survives every export (owner decision V = A: IPTC
 * DigitalSourceType and the model id).
 *
 *   · the PDF/UA check: Chromium's own tagged output, finished by
 *     `finishTaggedPdf`, passes; each thing it checks is refused when absent
 *     (not tagged, no language, no title, no PDF/UA id, a Figure without alt
 *     text, AI pictures unmarked);
 *   · PowerPoint: shapes in reading order, decor and filter washes marked
 *     decorative, the alt text on each picture, the file's title and language;
 *   · marking: an AI-drawn image is marked in its own file for PowerPoint,
 *     .odp and HTML; an upload never is; the PDF's XMP lists each AI picture
 *     with its model and card; provenance is read from the venture's own rows.
 *
 * Every deck, image and model id is synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts } from 'pdf-lib';
import { checkDeckPdf, finishTaggedPdf, pdfLangOf, SLIDE_SIZES } from '../src/services/decks/pdfExport.ts';
import { AI_COMPOSITE_TYPE, aiImagesOf, imageRefsOf, isMarked, markImages, pdfXmp, UNKNOWN_MODEL } from '../src/services/decks/aiMarking.ts';
import { AI_SOURCE_TYPE, xmpOf } from '../src/services/decks/imageBytes.ts';
import { DECORATIVE_EXT, decorative, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { writeOdp } from '../src/services/decks/odp.ts';
import { imageDataUri, writeOfflineDeck } from '../src/services/decks/offlineHtml.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { CHROMIUM_TAGGED_DECK_PDF } from './fixtures/chromiumTaggedDeck.ts';

const CHROME = new Uint8Array(Buffer.from(CHROMIUM_TAGGED_DECK_PDF, 'base64'));
const PAGE = { aspect: '16:9' as const, ...SLIDE_SIZES['16:9'] };
const MODEL = '@cf/synthetic/image-model-1';
const UID_AI = '0b7e3a52-6d1f-4c3a-9e2b-5f4d8c7a1b20';
const UID_UP = '1c8f4b63-7e2a-4d4b-8f3c-6a5e9d8b2c31';
const UID_BG = '2d9a5c74-8f3b-4e5c-9a4d-7b6f0e9c3d42';
const URL_AI = `https://axal.vc/api/decks/images/${UID_AI}/file`;
const URL_UP = `https://axal.vc/api/decks/images/${UID_UP}/file`;
const URL_BG = `https://axal.vc/api/decks/images/${UID_BG}/file`;
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const BRAND: any = { show_footer: false, footer_text: '', watermark_url: null };
const g = (c1: number, c2: number, r1: number, r2: number) => ({ c1, c2, r1, r2 });

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
const txt = (parts: Map<string, Uint8Array>, name: string) => new TextDecoder().decode(parts.get(name) ?? new Uint8Array());
const ua = async (bytes: Uint8Array, ai = 0) => {
  const r = await checkDeckPdf(bytes, PAGE, { words: true, ua: { ai } });
  return r.ok ? [] : r.codes;
};

// ─────────────────────────────────────────────── the PDF/UA check

test('Chromium’s tagged PDF, finished, passes the PDF/UA check; as printed it lacks the PDF/UA id', async () => {
  assert.deepEqual(await ua(CHROME), ['no_pdfua_id'], 'Chrome tags the structure, language and title itself; the XMP is ours');
  const done = await finishTaggedPdf(CHROME, { title: 'Synthetic deck', lang: 'fr' });
  assert.deepEqual(await ua(done), []);
  const doc = await PDFDocument.load(done, { updateMetadata: false });
  assert.equal(doc.getTitle(), 'Synthetic deck');
  assert.equal(doc.catalog.lookup(PDFName.of('Lang'))?.toString(), '(fr)', 'the deck’s own language, not the print page’s');
  assert.ok(doc.catalog.lookup(PDFName.of('StructTreeRoot')) instanceof PDFDict, 'Chrome’s structure tree is kept');
  assert.equal((await checkDeckPdf(done, PAGE, { words: true })).ok, true, 'the earlier checks still pass on the finished file');
});

test('each PDF/UA rule refuses its absence', async () => {
  // Not tagged: a PDF with words but no structure tree.
  const plain = await PDFDocument.create();
  const p = plain.addPage([PAGE.width * 0.75, PAGE.height * 0.75]);
  p.drawText('Synthetic words', { font: await plain.embedFont(StandardFonts.Helvetica), x: 40, y: 40 });
  const untagged = await finishTaggedPdf(await plain.save(), { title: 'Synthetic', lang: 'en' });
  // Mutation checked: drop the StructTreeRoot test → this fails.
  assert.ok((await ua(untagged)).includes('not_tagged'));

  // No language, no title: the finished file, with each one taken back out.
  const done = await finishTaggedPdf(CHROME, { title: 'Synthetic deck', lang: 'en' });
  const without = async (edit: (d: PDFDocument) => void) => { const d = await PDFDocument.load(done, { updateMetadata: false }); edit(d); return ua(await d.save()); };
  assert.ok((await without((d) => d.catalog.delete(PDFName.of('Lang')))).includes('no_language'));
  assert.ok((await without((d) => d.catalog.delete(PDFName.of('ViewerPreferences')))).includes('no_title'), 'a title not shown as the window title');
  // Mutation checked: drop the DisplayDocTitle test → a title the viewer hides passes and this fails.
  assert.ok((await without((d) => d.catalog.set(PDFName.of('ViewerPreferences'), d.context.obj({ DisplayDocTitle: false })))).includes('no_title'));
  assert.ok((await without((d) => d.catalog.delete(PDFName.of('Metadata')))).includes('no_pdfua_id'));
  assert.ok((await without((d) => d.catalog.delete(PDFName.of('MarkInfo')))).includes('not_tagged'));

  // A Figure without its alt text.
  // Mutation checked: skip the Figure walk → this fails.
  const bare = await without((d) => {
    const seen = new Set<unknown>();
    const strip = (o: unknown): void => {
      const v = o instanceof PDFRef ? d.context.lookup(o) : o;
      if (!v || seen.has(v)) return;
      seen.add(v);
      if (v instanceof PDFArray) { v.asArray().forEach(strip); return; }
      if (!(v instanceof PDFDict)) return;
      if (v.get(PDFName.of('S'))?.toString() === '/Figure') v.delete(PDFName.of('Alt'));
      strip(v.get(PDFName.of('K')));
    };
    strip((d.catalog.lookup(PDFName.of('StructTreeRoot')) as PDFDict).get(PDFName.of('K')));
  });
  assert.ok(bare.includes('figure_without_alt'));
});

test('a deck with AI pictures says so in its PDF, each with its model and card; one without them is refused', async () => {
  const ai = [{ url: URL_AI, model: MODEL, card: 2 }];
  const marked = await finishTaggedPdf(CHROME, { title: 'Synthetic deck', lang: 'en', ai });
  assert.deepEqual(await ua(marked, 1), []);
  const xmp = pdfXmp({ title: 'Synthetic deck', lang: 'en', ai });
  assert.ok(xmp.includes(AI_COMPOSITE_TYPE) && xmp.includes(AI_SOURCE_TYPE));
  assert.match(xmp, new RegExp(`<xmp:CreatorTool>${MODEL.replace(/[/.]/g, '\\$&')}</xmp:CreatorTool><axal:card>3</axal:card>`));
  // Mutation checked: drop the ai_unmarked rule → this fails.
  const unmarked = await finishTaggedPdf(CHROME, { title: 'Synthetic deck', lang: 'en' });
  assert.ok((await ua(unmarked, 1)).includes('ai_unmarked'));
  assert.equal(pdfXmp({ title: 'x', lang: 'en', ai: [] }).includes(AI_COMPOSITE_TYPE), false, 'no AI picture, no AI claim');
  assert.equal(pdfLangOf({ lang: 'ar' }), 'ar');
  assert.equal(pdfLangOf({ lang: 'not a tag!' }), 'en');
});

// ─────────────────────────────────────────────── provenance and marking

function provenanceDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const ins = db.prepare(`INSERT INTO deck_images (uid, project_id, r2_key, mime, source, use, state, model) VALUES (?, ?, ?, 'image/png', ?, 'content', 'kept', ?)`);
  ins.run(UID_AI, 1, 'k1', 'generated', MODEL);
  ins.run(UID_UP, 1, 'k2', 'upload', null);
  ins.run(UID_BG, 1, 'k3', 'generated', null);
  return db;
}
const SLIDES = [
  { title: 'Cover', blocks: [{ id: 'i1', kind: 'image', image_id: UID_AI, image_url: URL_AI, alt: 'A synthetic skyline', grid: g(7, 12, 2, 6) }] },
  { title: 'Team', background: { image_id: UID_BG, image_url: URL_BG }, blocks: [{ id: 'i2', kind: 'image', image_id: UID_UP, image_url: URL_UP, alt: 'Uploaded photo', grid: g(1, 6, 2, 6) }] },
];

test('the AI pictures are the venture’s own generated rows, by block and background; never an upload or another venture’s', async () => {
  const db = provenanceDb();
  const env: any = { DB: d1Over(db) };
  assert.deepEqual(imageRefsOf(SLIDES).map((r) => r.uid), [UID_AI, UID_BG, UID_UP]);
  const ai = await aiImagesOf(env, 1, SLIDES);
  // Mutation checked: drop `source = 'generated'` → the upload is marked and this fails.
  assert.deepEqual(ai.map((a) => [a.url, a.model, a.card]), [[URL_AI, MODEL, 0], [URL_BG, UNKNOWN_MODEL, 1]]);
  // Mutation checked: drop `project_id = ?` → another venture's deck reads these rows and this fails.
  assert.deepEqual(await aiImagesOf(env, 2, SLIDES), []);
  assert.deepEqual(await aiImagesOf({ DB: { prepare() { throw new Error('synthetic'); } } } as any, 1, SLIDES), [], 'an unreadable store marks nothing new');
});

test('markImages writes the mark into an AI picture once, and never into an upload', async () => {
  const images = new Map<string, any>([[URL_AI, { kind: 'png', bytes: PNG }], [URL_UP, { kind: 'png', bytes: PNG }], [URL_BG, { kind: 'gif', bytes: PNG }]]);
  const ai = [{ url: URL_AI, model: MODEL, card: 0 }, { url: URL_BG, model: MODEL, card: 1 }];
  assert.equal(markImages(images, ai), 1, 'a GIF cannot be walked, and is left as it is');
  const out = images.get(URL_AI).bytes;
  assert.ok(isMarked(out));
  assert.ok(xmpOf(out)!.includes(MODEL));
  assert.equal(isMarked(images.get(URL_UP).bytes), false);
  // Mutation checked: drop the isMarked skip → a marked file gains a second packet and this fails.
  assert.equal(markImages(images, ai), 0, 'an image already marked is left as it is');
  assert.equal(new TextDecoder('latin1').decode(images.get(URL_AI).bytes).split('<x:xmpmeta').length - 1, 1);
});

test('the mark survives every export: PowerPoint, .odp and HTML carry the marked file; the upload carries none', async () => {
  const images = new Map<string, any>([[URL_AI, { kind: 'png', bytes: PNG }], [URL_UP, { kind: 'png', bytes: PNG }]]);
  markImages(images, [{ url: URL_AI, model: MODEL, card: 0 }]);
  const slides = [{ title: 'Cover', blocks: [SLIDES[0].blocks[0], { ...SLIDES[1].blocks[0], grid: g(1, 6, 2, 6) }] }];
  const media = (parts: Map<string, Uint8Array>, prefix: string) => [...parts].filter(([n]) => n.startsWith(prefix)).map(([, b]) => isMarked(b)).sort();

  const pptx = unzip((await writeEditableDeck({ slides, renderable: [{ title: 'Cover', fields: [] }] as any, brand: BRAND, notes: false, images, today: '2026-11-03' })).bytes);
  assert.deepEqual(media(pptx, 'ppt/media/'), [false, true]);
  const odp = unzip((await writeOdp({ title: 'Cover', version: 1, slides, renderable: [{ title: 'Cover', fields: [] } as any], images, brand: BRAND, notes: false, today: '2026-11-03' })).bytes);
  assert.deepEqual(media(odp, 'Pictures/'), [false, true]);
  const html = await writeOfflineDeck({
    title: 'Cover', version: 1, slides, footer: null, watermark: null, notes: false, sources: false,
    images: new Map([...images].map(([u, v]) => [u, imageDataUri(v.kind, v.bytes)])),
  });
  const uris = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => isMarked(new Uint8Array(Buffer.from(m[1], 'base64'))));
  assert.deepEqual(uris.sort(), [false, true]);
});

test('every export route marks its pictures through one reader; the PDF route finishes and checks for PDF/UA', () => {
  const routes = readFileSync(new URL('../src/routes/deck_exports.ts', import.meta.url), 'utf8');
  // HTML, .odp, Google Slides, PowerPoint.
  assert.equal(routes.match(/await markedImages\(c\.env, /g)?.length, 4);
  assert.equal(/await fetchImages\(imageUrlsOf/.test(routes), false, 'no export embeds an unmarked fetch');
  const pdf = readFileSync(new URL('../src/routes/decks.ts', import.meta.url), 'utf8');
  assert.match(pdf, /const pdf = await finishTaggedPdf\(r\.bytes, \{ title: row\.title \|\| 'Pitch deck', lang: pdfLangOf\(themeOfRow\(row\)\), ai \}\);/);
  assert.match(pdf, /ua: \{ ai: ai\.length \}/);
  assert.match(pdf, /return new Response\(pdf, \{/, 'the finished file, not the browser’s, is handed out');
});

// ─────────────────────────────────────────────── PowerPoint reading order

test('PowerPoint: areas in reading order, decor and washes decorative, alt text on pictures, a title and a language', async () => {
  const slides = [{
    title: 'Plan',
    decor: [
      { id: 'd1', kind: 'icon', ref: 'rocket', tone: 'accent', at: { x: 1600, y: 96, w: 160, h: 160 } },
      { id: 'd2', kind: 'shape', ref: 'circle', tone: 'accent', at: { x: 96, y: 800, w: 160, h: 160 } },
    ],
    blocks: [
      { id: 'later', kind: 'text', style: 'body', text: 'Read second', grid: g(1, 12, 4, 5) },
      { id: 'pic', kind: 'image', image_url: URL_AI, alt: 'A synthetic skyline', filter: 'warm', grid: g(7, 12, 2, 3) },
      { id: 'first', kind: 'text', style: 'heading', text: 'Read first', grid: g(1, 6, 1, 1) },
    ],
  }];
  const images = new Map<string, any>([[URL_AI, { kind: 'png', bytes: PNG }]]);
  const out = unzip((await writeEditableDeck({ slides, renderable: [{ title: 'Plan', fields: [] }] as any, brand: BRAND, notes: false, images, today: '2026-11-03', meta: { title: 'Synthetic plan', lang: 'de' } })).bytes);
  const slide = txt(out, 'ppt/slides/slide1.xml');
  const at = (s: string) => slide.indexOf(s);
  assert.ok(at('Read first') < at('descr="A synthetic skyline"') && at('descr="A synthetic skyline"') < at('Read second'), 'top to bottom, then start to end');
  // Mutation checked: drop `decorative(...)` on decor → this fails.
  const decor = slide.slice(slide.indexOf('name="Decor d1"') - 40, slide.indexOf('name="Decor d1"') + 400);
  assert.ok(decor.includes('adec:decorative'), 'decor is skipped by a screen reader');
  // Mutation checked: drop `decorative(...)` on a native decor shape → this fails.
  const shape = slide.slice(slide.indexOf('name="Decor d2"'), slide.indexOf('name="Decor d2"') + 300);
  assert.ok(slide.includes('name="Decor d2"') && shape.includes('adec:decorative'), 'a native decor shape is decorative too');
  // Mutation checked: drop `decorative(...)` on the filter's wash → this fails.
  const wash = slide.slice(slide.indexOf('name="Image pic filter"'), slide.indexOf('name="Image pic filter"') + 300);
  assert.ok(slide.includes('name="Image pic filter"') && wash.includes('adec:decorative'), 'a filter’s colour wash is decorative');
  assert.equal(slide.slice(at('descr="A synthetic skyline"') - 120, at('descr="A synthetic skyline"') + 60).includes('adec:decorative'), false, 'the picture itself is read');
  assert.match(txt(out, 'docProps/core.xml'), /<dc:title>Synthetic plan<\/dc:title>\s*<dc:language>de<\/dc:language>/);
  assert.match(txt(out, '_rels/.rels'), /core-properties" Target="docProps\/core\.xml"/);
  assert.match(txt(out, '[Content_Types].xml'), /PartName="\/docProps\/core\.xml"/);
  assert.equal(decorative('<p:cNvPr id="3" name="x"/><p:cNvPr id="4" name="y"/>'), `<p:cNvPr id="3" name="x">${DECORATIVE_EXT}</p:cNvPr><p:cNvPr id="4" name="y"/>`, 'only the shape’s own first cNvPr');
});
