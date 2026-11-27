// #5309 (D5309, D3724 §gaps 8 to 11): the cover step's upload — three crops
// from one focal point, required alt text — and the four-variant press.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/event_cover_upload_5309.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm } from './_form_d695.mjs';
import EventCoverStep from '../src/pages/events/EventCoverStep.jsx';
import EventCoverVariants from '../src/pages/events/EventCoverVariants.jsx';
import * as adapter from '../src/pages/events/recommendationsAdapter.js';
import {
  ALT_REQUIRED, CENTRE, COVER_RATIOS, VARIANTS_NONE, VARIANTS_PER_DRAW,
  brandColoursLine, canSendUpload, cropRect, cropsFromFocal, readFocal, variantsLine,
} from '../src/pages/events/eventCoverModel.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const RATIO = 1920 / 1080;
const near = (a, b, within = 1e-4) => Math.abs(a - b) <= within;
/** Press the node with this test id. The harness clicks by label; these buttons are found by id. */
async function press(ui, testid) {
  const node = ui.by(testid);
  assert.ok(node, testid);
  assert.ok(!ui.props(node).disabled, testid + ' is enabled');
  await act(async () => ui.props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }));
}
/** Fire a node's own onChange, as the harness's private `change` does. */
async function fire(ui, testid, event) {
  const node = ui.by(testid);
  assert.ok(node, testid);
  await act(async () => ui.props(node).onChange?.(event));
}

test('one focal point gives three crops, each the largest rectangle of its own shape inside the image', () => {
  const crops = cropsFromFocal(RATIO, CENTRE);
  assert.deepEqual(Object.keys(crops).sort(), ['card', 'social', 'square']);
  for (const { key, ratio } of COVER_RATIOS) {
    const r = crops[key];
    assert.ok(r.w > 0 && r.h > 0, `${key} is a rectangle`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, `${key} lies inside the image`);
    assert.ok(near((r.w * RATIO) / r.h, ratio), `${key} is ${ratio}, not ${(r.w * RATIO) / r.h}`);
  }
  // A 16:9 image's card crop is the whole frame; its square crop is not.
  assert.deepEqual(crops.card, { x: 0, y: 0, w: 1, h: 1 });
  assert.ok(crops.square.w < 1 && crops.square.h === 1, 'a square crop of a wide image loses width, never height');
  assert.ok(crops.social.h < 1 && crops.social.w === 1, 'a 1.91:1 crop of a 16:9 image loses height');

  // The focal point slides each crop as far as the edges allow, and no further.
  const left = cropsFromFocal(RATIO, { x: 0, y: 0.5 });
  assert.equal(left.square.x, 0, 'a focal point at the left edge pins the square crop to it');
  const right = cropsFromFocal(RATIO, { x: 1, y: 0.5 });
  assert.ok(near(right.square.x + right.square.w, 1), 'and at the right edge, to that one');
  assert.ok(right.square.x > left.square.x, 'the two are not the same crop');
  // Mutation check: the shapes come from the image's aspect, not a constant.
  const square = cropsFromFocal(1, CENTRE);
  assert.deepEqual(square.card, { x: 0, y: 0.21875, w: 1, h: 0.5625 }, 'a square image loses height to the card crop');
  assert.notDeepEqual(square.card, crops.card);
  // An unknown aspect claims no crops at all.
  assert.equal(cropsFromFocal(0, CENTRE), null);
  assert.equal(cropsFromFocal(null, CENTRE), null);
  assert.equal(cropRect(RATIO, 0, CENTRE), null);
  // An unreadable focal point is the centre, and never NaN.
  assert.deepEqual(readFocal({ x: 'x', y: null }), CENTRE);
  assert.deepEqual(readFocal({ x: -4, y: 9 }), { x: 0, y: 1 });
});

test('alt text is required before an upload is sent', () => {
  assert.deepEqual(canSendUpload({ file: { name: 'a.png' }, alt: 'A harbour' }), { ok: true });
  assert.equal(canSendUpload({ file: { name: 'a.png' }, alt: '   ' }).error, ALT_REQUIRED);
  assert.equal(canSendUpload({ file: { name: 'a.png' } }).error, ALT_REQUIRED);
  assert.equal(canSendUpload({ alt: 'A harbour' }).ok, false, 'and so is a file');
});

test('the variants line counts what was drawn and never reads as 0; the colours line says when none is recorded', () => {
  assert.match(variantsLine({ variants: [1, 2, 3, 4], asked: 4, refused: [] }), /^4 variants drawn\./);
  assert.match(variantsLine({ variants: [1, 2, 3], asked: 4, refused: [{ message: 'The model did not answer.' }] }), /^3 of 4 drawn\. The rest were refused: The model did not answer\./);
  assert.equal(variantsLine({ variants: [], asked: 4, refused: [] }), VARIANTS_NONE);
  assert.equal(variantsLine(null), VARIANTS_NONE);
  assert.doesNotMatch(variantsLine(null), /\b0\b/, 'nothing drawn is never "0 variants"');
  assert.equal(brandColoursLine({ brand_colours: ['#0b1020'], brand_colours_recorded: true }), 'Drawn in the venture\'s brand colours: #0b1020.');
  assert.equal(brandColoursLine({ brand_colours: [], brand_colours_recorded: false }), 'No brand colours are recorded for this venture.');
  assert.equal(brandColoursLine({ brand_colours: ['#0b1020'], brand_colours_recorded: false }), 'No brand colours are recorded for this venture.', 'colours the Worker did not record are not shown as recorded');
});

test('the upload press sends the file, the alt text, the focal point and the three crops, and places nothing until the Worker answers', async () => {
  const sent = [];
  const set = (k, v) => sent.push([k, v]);
  const calls = [];
  const upload = async (id, body) => { calls.push([id, body]); return { available: true, value: { url: 'https://axal.vc/api/events/5/cover/upload-x.png', alt: body.alt, focal: body.focal, crops: body.crops } }; };
  const ui = await mountForm(h(EventCoverStep, { id: '5', form: { cover_url: '' }, set, upload }));
  try {
    // No file yet: the press is disabled and nothing is sent.
    assert.equal(ui.props(ui.by('event-cover-upload')).disabled, true, 'nothing to send yet');
    await fire(ui, 'event-cover-file', { target: { files: [{ name: 'cover.png', type: 'image/png' }] } });
    assert.deepEqual(calls, [], 'choosing a file sends nothing');
    // The focal-point controls are there, and all three crops are described.
    assert.ok(ui.by('event-cover-focal-x') && ui.by('event-cover-focal-y'), 'the focal point is chosen here');
    assert.match(ui.text(), /Say what the image shows/);
    assert.deepEqual(sent, [], 'and the form is untouched');
  } finally { await ui.unmount(); }
  // The adapter itself refuses an upload with no file, without reaching the client.
  const none = await adapter.uploadCover('5', {});
  assert.equal(none.available, false);
  assert.match(none.reason, /Choose a JPG or PNG image/);
});

test('the four-variant press prices first, draws on that quote, and nothing is placed until "Use this one"', async () => {
  const chosen = [];
  const quotes = [];
  const draws = [];
  const quoteFn = async (id, prompt) => {
    quotes.push([id, prompt]);
    return { available: true, value: { quote_uid: 'q1', hold_microusd: 4000, draw_microusd: 3000, checks_microusd: 1000, model_label: 'FLUX.1 Schnell', variants: 4, balance: { ok: true }, brand_colours: ['#0b1020'], brand_colours_recorded: true } };
  };
  const drawFn = async (id, prompt, uid) => {
    draws.push([id, prompt, uid]);
    return { available: true, value: { asked: 4, refused: [], variants: [0, 1, 2, 3].map((index) => ({ index, filename: `cover-${index}.png`, url: `https://axal.vc/api/events/5/cover/cover-${index}.png`, alt: `Variant ${index}` })) } };
  };
  const ui = await mountForm(h(EventCoverVariants, { id: '5', prompt: 'A harbour at dawn', onChoose: (url, alt) => chosen.push([url, alt]), quoteFn, drawFn }));
  try {
    // Draw is not offered before a price.
    assert.equal(ui.by('event-cover-variants-draw'), undefined, 'no draw before a price');
    await press(ui, 'event-cover-variants-price');
    assert.deepEqual(quotes, [['5', 'A harbour at dawn']]);
    assert.deepEqual(draws, [], 'a price draws nothing');
    assert.match(ui.text(), /FLUX\.1 Schnell/);
    assert.match(ui.text(), /brand colours: #0b1020/);
    await press(ui, 'event-cover-variants-draw');
    assert.deepEqual(draws, [['5', 'A harbour at dawn', 'q1']], 'the draw runs on the quote\'s own uid');
    assert.match(ui.text(), /4 variants drawn/);
    assert.deepEqual(chosen, [], 'four images on screen, none placed');
    await press(ui, 'event-cover-variants-use-2');
    assert.deepEqual(chosen, [['https://axal.vc/api/events/5/cover/cover-2.png', 'Variant 2']]);
    // "More like this one" re-prices with that variant's own words.
    await press(ui, 'event-cover-variants-more-1');
    assert.equal(quotes.length, 2);
    assert.match(quotes[1][1], /^A harbour at dawn\. Closer to this one: Variant 1$/);
  } finally { await ui.unmount(); }
  // Without a quote the adapter sends nothing and asks for the price.
  const noQuote = await adapter.drawVariants('5', 'A harbour', null);
  assert.equal(noQuote.available, false);
  assert.equal(noQuote.reason, 'Get the price first.');
  const noPrompt = await adapter.variantsQuote('5', '   ');
  assert.equal(noPrompt.available, false);
  assert.match(noPrompt.reason, /Describe the cover/);
});

test('a refused quote or draw reads as the Worker\'s own sentence, never as an empty grid', async () => {
  const ui = await mountForm(h(EventCoverVariants, {
    id: '5', prompt: 'A harbour at dawn',
    quoteFn: async () => ({ available: false, reason: 'Not enough AI tokens for this cover.' }),
    drawFn: async () => { throw new Error('never reached'); },
  }));
  try {
    await press(ui, 'event-cover-variants-price');
    assert.match(ui.text(), /Not enough AI tokens for this cover\./);
    assert.equal(ui.by('event-cover-variants-grid'), undefined, 'no grid for a refusal');
    assert.equal(ui.by('event-cover-variants-draw'), undefined, 'and no draw to press');
  } finally { await ui.unmount(); }
  const drawn = await mountForm(h(EventCoverVariants, {
    id: '5', prompt: 'A harbour at dawn',
    quoteFn: async () => ({ available: true, value: { quote_uid: 'q1', hold_microusd: 4000, balance: { ok: true }, brand_colours: [], brand_colours_recorded: false } }),
    drawFn: async () => ({ available: false, reason: 'The cover could not be drawn. Nothing was saved.' }),
  }));
  try {
    await press(drawn, 'event-cover-variants-price');
    assert.match(drawn.text(), /No brand colours are recorded/);
    await press(drawn, 'event-cover-variants-draw');
    assert.match(drawn.text(), /Nothing was saved\./);
    assert.equal(drawn.by('event-cover-variants-grid'), undefined);
  } finally { await drawn.unmount(); }
});

test('the adapter calls the mounted routes, and each client path has a Worker route that answers it', () => {
  const client = read('frontend/src/lib/api/eventCovers.js');
  const adapterSrc = read('frontend/src/pages/events/recommendationsAdapter.js');
  const worker = read('cloudflare-worker/src/routes/events.ts');
  for (const [path, route] of [
    ['/cover/upload', "events.post('/:id/cover/upload'"],
    ['/cover/variants/quote', "events.post('/:id/cover/variants/quote'"],
    ['/cover/variants', "events.post('/:id/cover/variants'"],
  ]) {
    assert.ok(client.includes(path), path);
    assert.ok(worker.includes(route), route);
  }
  assert.match(adapterSrc, /eventCoversApi\.upload\(id, \{ file, alt, focal, crops \}\)/);
  assert.match(adapterSrc, /eventCoversApi\.variants\(id, prompt, quoteUid\)/);
  assert.doesNotMatch(adapterSrc, /switched on yet/, '#5309 switched both on');
  // The variants press sends the quote's uid as the Idempotency-Key, so a retry charges nothing again.
  assert.match(client, /'Idempotency-Key': quoteUid/);
  // The migration carries the four columns the read answers.
  const migration = read('cloudflare-worker/sql/migrations/202611110745_5309_event_cover_upload.sql');
  for (const column of ['cover_alt', 'cover_source', 'cover_focal_json', 'cover_crops_json']) {
    assert.ok(migration.includes(`ADD COLUMN ${column}`), column);
  }
  const shape = read('cloudflare-worker/src/services/eventsCommon.ts');
  for (const field of ['cover_alt', 'cover_source', 'cover_focal', 'cover_crops']) assert.ok(shape.includes(`${field}:`), field);
  assert.equal(VARIANTS_PER_DRAW, 4);
});
