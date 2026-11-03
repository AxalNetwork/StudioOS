// D1534 (#3778 phase 1, deck v2 B2) — an image block's crop and filter, the
// same in the editor, the print page (the PDF and the PowerPoint download) and
// the editable PowerPoint; Replace keeps the crop; an upload needs alt text and
// is screened, which flags and never blocks.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/deck_image_look_d1534.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as worker from '../src/services/decks/imageLook.ts';
import * as browser from '../../frontend/src/pages/raise/pitch/imageLook.js';
import { sanitizeBlocks as sanitizeWith } from '../src/services/decks/slideModel.ts';
const sanitizeBlocks = (v: unknown) => sanitizeWith(v, (u: string) => u);
import { imageLookParts, writeEditableDeck } from '../src/services/decks/pptxEditable.ts';
import { FLAGGED_LINE, NOT_SCREENED_LINE, UPLOAD_SCREEN_DEPS, screenAnswer, screenOf, screenUpload } from '../src/services/decks/uploadScreen.ts';
import { d1Over } from './_d1_sqlite.mjs';

/** A PNG header whose IHDR says width × height (enough for `imageSize`). */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w); v.setUint32(20, h);
  return b;
}

test('D1534: one table — the Worker and the browser hold the same eight presets and the same rules', () => {
  assert.deepEqual([...worker.FILTERS], [...browser.FILTERS]);
  // Mutation checked: any number changed on one side only → this fails.
  assert.deepEqual(JSON.parse(JSON.stringify(worker.FILTER_SPECS)), JSON.parse(JSON.stringify(browser.FILTER_SPECS)));
  assert.equal(worker.ZOOM_MIN_W, browser.ZOOM_MIN_W);
  for (const f of worker.FILTERS) assert.equal(worker.cssFilter(f), browser.cssFilter(f), f);
  for (const v of [{ x: 10, y: 20, w: 50 }, { x: 80, y: 80, w: 40 }, { x: 0, y: 0, w: 3 }, { w: 100 }, null, { x: 'a', y: 1, w: 50 }]) {
    assert.deepEqual(worker.rectOf(v), browser.rectOf(v), JSON.stringify(v));
  }
  assert.equal(browser.FILTER_WORDS.brand, 'Brand tint');
  assert.deepEqual([...browser.COMING_LATER], ['Erase', 'Expand', 'Vary', 'Remove background', 'Upscale']);
});

test('D1534: the sanitiser keeps a crop window locked to the frame\'s aspect and inside it, and one of the eight filters', () => {
  const g = { c1: 1, r1: 1, c2: 6, r2: 4 };
  const [b] = sanitizeBlocks([{ id: 'i1', kind: 'image', grid: g, image_url: 'https://img.example.test/a.png', alt: 'A desk', crop: { x: 30, y: 70, rect: { x: 80, y: 5, w: 40, h: 90 } }, filter: 'vivid' }]) as any[];
  // Mutation checked: `h` kept as sent → h is 90 and the picture would stretch; the window let past the frame → x is 80.
  assert.deepEqual(b.crop, { x: 30, y: 70, rect: { x: 60, y: 5, w: 40, h: 40 } });
  assert.equal(b.filter, 'vivid');
  const [plain] = sanitizeBlocks([{ id: 'i2', kind: 'image', grid: g, image_url: 'https://img.example.test/a.png', crop: { x: 50, y: 50, rect: { x: 0, y: 0, w: 100 } }, filter: 'original' }]) as any[];
  assert.deepEqual(plain.crop, { x: 50, y: 50 }, 'the whole frame is no window');
  assert.equal(plain.filter, undefined, 'Original is no key');
  const [junk] = sanitizeBlocks([{ id: 'i3', kind: 'image', grid: g, image_url: 'https://img.example.test/a.png', filter: 'sepia<script>' }]) as any[];
  assert.equal(junk.filter, undefined);
});

test('D1534: the window that shows is the same in the browser and in PowerPoint\'s srcRect', () => {
  // A 2000 × 1000 image in a 1600 × 900 frame, the focus at the left edge, a half-size window at (25, 25).
  const crop = { x: 0, y: 50, rect: { x: 25, y: 25, w: 50, h: 50 } };
  const v = worker.visibleSource(crop, 'cover', { w: 1600, h: 900 }, { w: 2000, h: 1000 });
  // Cover: 88.9% of the width shows, from the left edge; the window is its middle half.
  assert.ok(Math.abs(v.l - 0.2222) < 1e-3 && Math.abs(v.t - 0.25) < 1e-9 && Math.abs(v.w - 0.4444) < 1e-3 && Math.abs(v.h - 0.5) < 1e-9, JSON.stringify(v));
  assert.equal(worker.srcRectXml(v), '<a:srcRect l="22222" t="25000" r="33333" b="25000"/>');
  // The browser: the image is twice the frame and moved half a frame up and left — the same window.
  const css = browser.imageLookStyle({ kind: 'image', crop, fit: 'cover' });
  assert.deepEqual([css.img.width, css.img.height, css.img.left, css.img.top, css.img.objectPosition], ['200%', '200%', '-50%', '-50%', '0% 50%']);
  // Mutation checked: the zoom left out of `visibleSource` → the srcRect is the cover window and this fails.
  assert.equal(worker.srcRectXml(worker.visibleSource({ x: 50, y: 50 }, 'cover', { w: 100, h: 100 }, { w: 100, h: 100 })), '', 'the whole image: no srcRect');
  assert.deepEqual(worker.visibleSource(crop, 'contain', { w: 1600, h: 900 }, { w: 2000, h: 1000 }), { l: 0, t: 0, w: 1, h: 1 }, 'shown whole: no window');
  assert.equal(browser.imageLookStyle({ kind: 'image', crop, fit: 'contain' }).zoomed, false);
});

test('D1534: a filter is the picture\'s own effects and a wash over it in PowerPoint, and the same filter and wash in the browser', async () => {
  const block = { id: 'i1', kind: 'image', grid: { c1: 1, r1: 1, c2: 6, r2: 4 }, image_url: 'https://img.example.test/a.png', alt: 'A desk', fit: 'cover', crop: { x: 50, y: 50, rect: { x: 10, y: 10, w: 50, h: 50 } }, filter: 'warm' };
  const parts = imageLookParts(block, { x: 0, y: 0, w: 800, h: 450 }, { kind: 'png', bytes: png(1600, 900) });
  assert.match(parts.src, /<a:srcRect l="10000" t="10000" r="40000" b="40000"\/>/);
  assert.equal(parts.effects, '<a:hsl hue="0" sat="10000" lum="0"/>');
  assert.deepEqual(parts.wash, { colour: '#F59E0B', alpha: 0.12 });
  assert.equal(imageLookParts({ ...block, filter: 'mono' }, { x: 0, y: 0, w: 800, h: 450 }, { kind: 'png', bytes: png(1600, 900) }).effects, '<a:grayscl/>');
  const css = browser.imageLookStyle(block);
  assert.equal(css.img.filter, 'saturate(1.1)');
  assert.equal(css.wash, 'rgba(245, 158, 11, 0.12)');
  assert.equal(browser.imageLookStyle({ ...block, filter: 'brand' }).wash, 'rgba(15, 42, 61, 0.18)', 'the brand tint in the deck ink');

  const out = await writeEditableDeck({
    slides: [{ blocks: [block] }], renderable: [{ title: 'One', fields: [] } as any], brand: { show_footer: false, footer_text: '', watermark_url: null, can_remove_footer: true },
    notes: false, images: new Map([[block.image_url, { kind: 'png', bytes: png(1600, 900) }]]),
  });
  const xml = new TextDecoder('latin1').decode(out.bytes);
  // Mutation checked: `picture` without its look → the srcRect and the hsl are missing and this fails.
  // This block's range is narrower than 16:9, so the cover fit trims the sides first; the window's top and bottom are its own.
  assert.match(xml, /<a:blip r:embed="rId\d+"><a:hsl hue="0" sat="10000" lum="0"\/><\/a:blip><a:srcRect l="\d+" t="10000" r="\d+" b="40000"\/>/);
  assert.match(xml, /name="Image i1 filter".*<a:srgbClr val="F59E0B"><a:alpha val="12000"\/>/s, 'the wash over the picture');
  assert.deepEqual(out.images, { placed: 1, not_placed: 0 });
});

test('D1534: Replace keeps the crop — the new image takes the old block\'s place, window, filter and fit', () => {
  const old = { id: 'i1', kind: 'image', grid: { c1: 2, r1: 2, c2: 7, r2: 5 }, image_url: 'https://img.example.test/old.png', alt: 'Old', fit: 'cover', crop: { x: 20, y: 30, rect: { x: 10, y: 10, w: 60, h: 60 } }, filter: 'fade' };
  const fresh = { kind: 'image', image_url: 'https://img.example.test/new.png', image_id: 'u2', alt: 'New desk', tag: 'photo', fit: 'cover', crop: { x: 50, y: 50 } };
  // Mutation checked: `keepLook` without the crop → the new image's centre crop and this fails.
  assert.deepEqual(browser.keepLook(old, fresh), { ...fresh, id: 'i1', grid: old.grid, crop: old.crop, fit: 'cover', filter: 'fade' });
  assert.equal(browser.keepLook(old, { ...fresh, alt: '' }).alt, 'Old', 'its own alt when it has one, else the old one');
  assert.equal(browser.keepLook(null, fresh), fresh);
  // Zoom and pan stay inside the frame and keep the aspect.
  assert.deepEqual(browser.zoomTo({ x: 50, y: 50 }, 50).rect, { x: 25, y: 25, w: 50, h: 50 });
  assert.deepEqual(browser.panTo(browser.zoomTo({ x: 50, y: 50 }, 50), 40, -40).rect, { x: 50, y: 0, w: 50, h: 50 });
  assert.deepEqual(browser.zoomTo({ x: 50, y: 50, rect: { x: 0, y: 0, w: 50, h: 50 } }, 100), { x: 50, y: 50 }, 'zoomed all the way out: no window');
});

test('D1534: an upload is screened once; the screen flags, never blocks, and an unanswered screen is "not screened"', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE deck_images (id INTEGER PRIMARY KEY, uid TEXT, qa_json TEXT)');
  db.exec("INSERT INTO deck_images (uid) VALUES ('u1'), ('u2'), ('u3')");
  const env: any = { DB: d1Over(db) };
  const seen: any[] = [];
  const reply = (r: any) => { UPLOAD_SCREEN_DEPS.run = async (_e, o) => { seen.push(o); return r; }; };
  const base = { userId: 2, rail: { page: 'Founder · Raise · Pitch deck', option: 'deck:image', record: 'deck:7' } as any, mime: 'image/png', bytes: png(10, 10) };
  try {
    reply({ ok: true, output: 'YES' });
    assert.equal(await screenUpload(env, { ...base, imageUid: 'u1' }), true);
    reply({ ok: true, output: 'no' });
    assert.equal(await screenUpload(env, { ...base, imageUid: 'u2' }), false);
    reply({ ok: false, refusal: 'budget_user_day' });
    assert.equal(await screenUpload(env, { ...base, imageUid: 'u3' }), null);
  } finally { UPLOAD_SCREEN_DEPS.run = (await import('../src/services/aiRouter.ts')).run; }
  assert.equal(seen[0].task, 'image_screen');
  assert.equal(seen[0].surface, '/raise/pitch', 'D552: the pitch page');
  assert.match(seen[0].images[0], /^data:image\/png;base64,/);
  const qa = (uid: string) => screenOf((db.prepare('SELECT qa_json FROM deck_images WHERE uid = ?').get(uid) as any).qa_json);
  // Mutation checked: an unanswered screen read as "no" → u3 reads as passed and this fails.
  assert.deepEqual([qa('u1'), qa('u2'), qa('u3')], [{ flagged: true, line: FLAGGED_LINE }, { flagged: false, line: null }, { flagged: null, line: NOT_SCREENED_LINE }]);
  assert.equal(screenOf(JSON.stringify({ screen: false, face: false })), null, 'a generated image\'s checks are not an upload screen');
  assert.deepEqual([screenAnswer({ ok: true, output: ' Yes.' }), screenAnswer({ ok: true, output: 'maybe' })], [true, null]);
});
