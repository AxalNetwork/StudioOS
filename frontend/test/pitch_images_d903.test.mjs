/**
 * D903 (#2682, part 9 of #2434) — images for the deck's cards and backgrounds.
 *
 *   · the model: the contrast line (the Worker's figure), the description
 *     prefilled from the card without its figures, the cost line naming the
 *     model, the placed image's line, where Keep places an image;
 *   · PD12, mounted: the cost line before anything runs, Generate with its
 *     own rail option, the refusal for a real person in the canvas's words, a
 *     short balance holding Generate, AI off;
 *   · PD12b, PD12c: "Keep as background" waits until the contrast reads 4.5:1;
 *   · an upload showing a person waits for their agreement;
 *   · PD12d: the toolbar's Crop, Fit and Alt text, and the line under the card;
 *   · D1604 (#3716): the entry is the area lightbox's Generated photo, one
 *     image drawn for the selected area's shape, quoted first, kept on Accept
 *     and discarded on Discard; "More image options" opens this lightbox.
 *
 * Every venture, card and image is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_images_d903.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import { __resetAssistModeForTest, seedAssistModes } from '../src/hooks/useAssistMode.js';
import ImageLightbox from '../src/pages/raise/pitch/ImageLightbox.jsx';
import ImageToolbar from '../src/pages/raise/pitch/ImageToolbar.jsx';
import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';
import {
  REAL_PERSON, askBody, contrastLine, costLine, defaultDescription, imageTag, keepLabel, overlayStyle, placeImage, placedLine,
} from '../src/pages/raise/pitch/imageModel.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountEditor } from './_pitch_editor_mount.mjs';
import { rowPlan } from '../src/pages/raise/pitch/areaLightboxModel.js';

const h = React.createElement;
const MODEL = { grid: { cols: 12, rows: 6 } };
const CARD = {
  title: 'Solution',
  blocks: [
    { id: 'h1', kind: 'text', style: 'heading', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, text: 'Close the month in an afternoon' },
    { id: 'p1', kind: 'text', style: 'paragraph', grid: { c1: 7, c2: 12, r1: 2, r2: 6 }, text: 'Teams stop chasing receipts. We saved 42 hours last month.' },
  ],
};
const IMAGE = { uid: '0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d', url: 'https://axal.vc/api/decks/images/0b6a2c1e-3f4d-4a5b-8c9d-0e1f2a3b4c5d/file', state: 'proposed', use: 'content', source: 'generated', alt: '', model_label: 'FLUX.1 Schnell', charged_microusd: 1880, created_at: '2026-10-21 09:00:00' };
const QUOTE = { ai: true, model_label: 'FLUX.1 Schnell', models: [{ id: 'flux', label: 'FLUX.1 Schnell', per_image_microusd: 1880 }], per_image_microusd: 1880, count: 2, total_microusd: 3760, balance: { ok: true } };

// ── The model ───────────────────────────────────────────────────────────────

test('the contrast line, the tags and the overlay colour', () => {
  assert.equal(contrastLine('content', 'none'), null, 'a content image needs no check');
  assert.deepEqual(contrastLine('card', 'none'), { ratio: 1.04, ok: false, figure: '1.0:1', text: 'Too low. Keep waits until the text reaches 4.5:1.' });
  assert.equal(contrastLine('deck', 'light').text, 'Readable');
  assert.equal(contrastLine('deck', 'strong', '#c4b5fd').ok, false, 'a light ink cannot carry light text');
  assert.equal(imageTag('content'), 'Illustration'); assert.equal(imageTag('card'), 'Illustration · Background');
  assert.equal(keepLabel('content'), 'Keep'); assert.equal(keepLabel('deck'), 'Keep as background');
  assert.equal(overlayStyle('none', '#0f2a3d'), null);
  assert.equal(overlayStyle('light', '#0f2a3d'), 'rgba(15, 42, 61, 0.65)');
});

test('the description comes from the card without its figures; the cost line names the model', () => {
  assert.equal(defaultDescription(CARD), 'Close the month in an afternoon. Teams stop chasing receipts', 'the sentence with a figure is left out');
  assert.equal(defaultDescription({ title: 'Team' }), 'Team');
  assert.equal(costLine(QUOTE), 'FLUX.1 Schnell · 2 × $0.0019 = $0.0038 · covered by your AI tokens');
  assert.equal(costLine({ ...QUOTE, balance: { ok: false } }), 'FLUX.1 Schnell · 2 × $0.0019 = $0.0038');
  assert.equal(costLine({ ai: false, message: 'AI assistance is off on this page.' }), 'AI assistance is off on this page.');
  assert.equal(costLine(null), 'Pricing…');
  assert.equal(placedLine(IMAGE), 'FLUX.1 Schnell · generated 21 Oct · $0.0019');
  assert.equal(placedLine({ ...IMAGE, charged_microusd: null }), 'FLUX.1 Schnell · generated 21 Oct · cost not recorded', 'never $0');
  assert.equal(placedLine({ source: 'upload', created_at: '2026-10-22 10:00:00', shows_person: true }), 'Uploaded 22 Oct · the person’s agreement recorded');
  assert.deepEqual(askBody({ use: 'deck', description: ' a desk ', style: 'flat', palette: 'brand', aspect: '16:9', count: 1, card: null }),
    { use: 'deck', description: 'a desk', style: 'flat', palette: 'brand', aspect: '16:9', count: 1, points: [], colours: [] });
});

test('Keep places a content image as a block, a card background on the card, the deck background in the theme', () => {
  const content = placeImage({ card: CARD, theme: null, model: MODEL }, { ...IMAGE, alt: 'A tidy desk' }, 'content');
  assert.deepEqual(content.block, { id: content.block.id, kind: 'image', grid: { c1: 1, c2: 6, r1: 2, r2: 5 }, image_url: IMAGE.url, image_id: IMAGE.uid, alt: 'A tidy desk', tag: 'illustration', fit: 'cover', crop: { x: 50, y: 50 } });
  const card = placeImage({ card: CARD, theme: null, model: MODEL }, { ...IMAGE, overlay: 'strong' }, 'card');
  assert.deepEqual(card.card.background, { color: null, image_url: IMAGE.url, image_id: IMAGE.uid, overlay: 'strong' });
  const deck = placeImage({ card: CARD, theme: { kind: 'brand', background: null }, model: MODEL }, IMAGE, 'deck');
  assert.deepEqual(deck.theme.background, { color: null, image_url: IMAGE.url, image_id: IMAGE.uid, overlay: 'light' });
  assert.equal(deck.card, CARD, 'the card is unchanged');
  const full = { blocks: [{ id: 'x', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }] };
  assert.match(placeImage({ card: full, theme: null, model: MODEL }, IMAGE, 'content').error, /no free 4 × 3 range/);
  assert.match(placeImage({ card: CARD, theme: null, model: MODEL }, { uid: 'x' }, 'content').error, /no address/);
});

test('a placed image draws with its fit, its crop and its alt text, everywhere BlockView draws', () => {
  const html = renderToStaticMarkup(h(BlockView, { block: { kind: 'image', image_url: IMAGE.url, alt: 'A tidy desk', fit: 'contain', crop: { x: 20, y: 80 } }, colours: {}, live: true, size: 'print' }));
  assert.match(html, /alt="A tidy desk"/); assert.match(html, /object-contain/); assert.match(html, /object-position:20% 80%/);
  assert.match(renderToStaticMarkup(h(BlockView, { block: { kind: 'image', image_url: IMAGE.url }, colours: {} })), /object-cover.*object-position:50% 50%/);
});

// ── Mounted ─────────────────────────────────────────────────────────────────

async function mount(element, answers = {}, { aiOff = false } = {}) {
  const calls = [];
  const stubs = {
    quote: async () => QUOTE,
    generate: async () => ({ images: [IMAGE] }),
    keep: async (uid, body) => ({ image: { ...IMAGE, state: 'kept', use: body.use, overlay: body.overlay ?? null } }),
    discard: async () => ({ ok: true }),
    upload: async () => ({ image: { ...IMAGE, source: 'upload', state: 'kept' } }),
    list: async () => ({ images: [] }),
    ...answers,
  };
  for (const [k, fn] of Object.entries(stubs)) deckImagesApi[k] = (...a) => { calls.push([k, ...a]); return fn(...a); };
  const restore = installDocument();
  __resetAssistModeForTest();
  if (aiOff) seedAssistModes({ raise: false });
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; n.querySelectorAll = () => []; n.querySelector = () => null; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, null, element)); });
  await settle(400); // the cost line waits for the request to settle
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const press = async (n) => { assert.ok(n, 'missing'); assert.ok(!pr(n).disabled, 'disabled'); await act(async () => { pr(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(400); };
  const type = async (n, value) => { await act(async () => { pr(n).onChange({ target: { value, checked: value } }); }); await settle(400); };
  return { calls, by, pr, text, press, type, settle, async unmount() { await act(async () => root.unmount()); restore(); } };
}
const lightbox = (props = {}) => h(ImageLightbox, { deckId: 31, cardIndex: 3, card: CARD, theme: null, model: MODEL, items: [], colours: { ink: '#0f2a3d' }, onClose() {}, onPlace() {}, ...props });

test('PD12: the description prefilled, the cost line before anything runs, and Generate with its own rail option', async () => {
  const placed = [];
  const m = await mount(lightbox({ onPlace: (p) => placed.push(p) }));
  try {
    assert.equal(m.pr(m.by('pitch-image-description')).value, 'Close the month in an afternoon. Teams stop chasing receipts');
    assert.equal(m.text(m.by('pitch-image-cost')), 'FLUX.1 Schnell · 2 × $0.0019 = $0.0038 · covered by your AI tokens');
    assert.deepEqual(m.calls.filter((c) => c[0] === 'quote').at(-1)[2], { use: 'content', description: 'Close the month in an afternoon. Teams stop chasing receipts', style: 'flat', palette: 'brand', aspect: '4:3', count: 2, card: 3, points: [], colours: ['#0f2a3d'] });
    assert.equal(m.calls.some((c) => c[0] === 'generate'), false, 'nothing runs until Generate');
    await m.press(m.by('pitch-image-generate'));
    const run = m.calls.find((c) => c[0] === 'generate');
    assert.equal(run[3]['X-Rail-Option'], encodeURIComponent('deck:image'));
    assert.ok(m.by(`pitch-image-result-${IMAGE.uid}`));
    await m.press(m.by(`pitch-image-keep-${IMAGE.uid}`));
    assert.equal(m.calls.find((c) => c[0] === 'keep')[2].use, 'content');
    assert.equal(placed.length, 1); assert.equal(placed[0].block.image_id, IMAGE.uid);
  } finally { await m.unmount(); }
});

test('a real person is refused in the canvas\'s words; a short balance holds Generate; AI off runs nothing', async () => {
  const refusal = Object.assign(new Error(REAL_PERSON), { status: 422, code: 'real_person', data: { error: 'real_person', message: REAL_PERSON } });
  const m = await mount(lightbox(), { quote: async () => { throw refusal; } });
  try {
    assert.equal(m.text(m.by('pitch-image-people')), 'Eadwyn does not draw real people. Upload a photo the person agreed to share.');
    assert.equal(m.pr(m.by('pitch-image-generate')).disabled, true);
  } finally { await m.unmount(); }
  const short = await mount(lightbox(), { quote: async () => ({ ...QUOTE, balance: { ok: false, code: 'budget_user_month', message: 'Your AI tokens for this month are used up.' } }) });
  try {
    assert.equal(short.text(short.by('pitch-image-balance')), 'Your AI tokens for this month are used up.');
    assert.equal(short.pr(short.by('pitch-image-generate')).disabled, true);
  } finally { await short.unmount(); }
  const off = await mount(lightbox(), {}, { aiOff: true });
  try {
    assert.equal(off.text(off.by('pitch-image-cost')), 'AI assistance is off on this page. You can still upload an image.');
    assert.equal(off.pr(off.by('pitch-image-generate')).disabled, true);
    assert.equal(off.calls.filter((c) => c[0] === 'quote').length, 0, 'nothing is priced while it is off');
  } finally { await off.unmount(); }
});

test('PD12b, PD12c: "Keep as background" waits until the contrast reads 4.5:1', async () => {
  const placed = [];
  const m = await mount(lightbox({ initialUse: 'card', onPlace: (p) => placed.push(p) }));
  try {
    assert.equal(m.text(m.by('pitch-image-use-line')), 'Behind this card’s content, with an overlay in your brand ink so text keeps 4.5:1.');
    await m.press(m.by('pitch-image-generate'));
    await m.press(m.by('pitch-image-overlay-none'));
    assert.match(m.text(m.by('pitch-image-contrast')), /^Contrast 1\.0:1 · Too low\. Keep waits until the text reaches 4\.5:1\.$/);
    assert.equal(m.pr(m.by(`pitch-image-keep-${IMAGE.uid}`)).disabled, true);
    assert.equal(m.text(m.by(`pitch-image-keep-${IMAGE.uid}`)), 'Keep as background');
    await m.press(m.by('pitch-image-overlay-light'));
    assert.match(m.text(m.by('pitch-image-contrast')), /· Readable$/);
    await m.press(m.by(`pitch-image-keep-${IMAGE.uid}`));
    assert.deepEqual(m.calls.find((c) => c[0] === 'keep')[2], { use: 'card', overlay: 'light', ink: '#0f2a3d', alt: 'Close the month in an afternoon. Teams stop chasing receipts' });
    assert.deepEqual(placed[0].card.background, { color: null, image_url: IMAGE.url, image_id: IMAGE.uid, overlay: 'light' });
  } finally { await m.unmount(); }
});

test('an upload showing a person waits until their agreement is ticked', async () => {
  const m = await mount(lightbox());
  try {
    await act(async () => { m.pr(m.by('pitch-image-file')).onChange({ target: { files: [{ name: 'team.png' }] } }); });
    await m.settle();
    await act(async () => { m.pr(m.by('pitch-image-person')).onChange({ target: { checked: true } }); });
    await m.settle();
    assert.equal(m.pr(m.by('pitch-image-upload-run')).disabled, true, 'no agreement, no upload');
    await act(async () => { m.pr(m.by('pitch-image-consent')).onChange({ target: { checked: true } }); });
    await m.settle();
    await m.press(m.by('pitch-image-upload-run'));
    const up = m.calls.find((c) => c[0] === 'upload');
    assert.deepEqual(up[3], { use: 'content', card: 3, alt: '', shows_person: true, consent: true });
  } finally { await m.unmount(); }
});

test('PD12d: Crop, Fit and Alt text patch the block; the line under the card names the model, the day and the cost', async () => {
  const patches = [];
  const block = { id: 'i1', kind: 'image', image_url: IMAGE.url, image_id: IMAGE.uid, alt: 'A tidy desk', tag: 'illustration', fit: 'cover', crop: { x: 50, y: 50 } };
  const m = await mount(h(ImageToolbar, { block, image: IMAGE, onPatch: (p) => patches.push(p), onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {} }));
  try {
    assert.equal(m.text(m.by('pitch-image-tag')), 'Illustration');
    assert.ok(m.by('pitch-image-regenerate'), 'a generated image can be regenerated');
    assert.match(m.text(m.by('pitch-image-placed')), /^FLUX\.1 Schnell · generated 21 Oct · \$0\.0019Alt text: A tidy desk$/);
    await m.press(m.by('pitch-image-fit'));
    await m.press(m.by('pitch-image-fit-contain'));
    await m.press(m.by('pitch-image-alt'));
    await m.type(m.by('pitch-image-alt-input'), 'A desk at month end');
    assert.deepEqual(patches, [{ fit: 'contain' }, { alt: 'A desk at month end' }]);
  } finally { await m.unmount(); }
  const up = await mount(h(ImageToolbar, { block: { ...block, alt: '', tag: 'photo' }, image: { source: 'upload', created_at: '2026-10-22 10:00:00' }, onPatch() {}, onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {} }));
  try {
    assert.equal(up.by('pitch-image-regenerate'), undefined, 'an upload has nothing to regenerate');
    assert.match(up.text(up.by('pitch-image-placed')), /Alt text: None yet/);
  } finally { await up.unmount(); }
});

// ── D1604: the area lightbox's Generated photo ───────────────────────────────

const GENERATED = { ...IMAGE, uid: 'synthetic-g1', url: 'https://synthetic.example/g1.png', alt: 'Synthetic heading' };
const photoAnswers = (over = {}) => ({
  'prefs.page': async () => ({ ok: true, models: [{ id: 'flux', name: 'FLUX.1 Schnell', price: '$0.0019' }], pick: 'flux' }),
  'assist.quote': async () => ({ ai: true, hold_microusd: 1000 }),
  'images.quote': async () => ({ ...QUOTE, count: 1, total_microusd: 1880 }),
  'images.generate': async () => ({ images: [GENERATED] }),
  'images.keep': async (uid) => ({ image: { ...GENERATED, uid, state: 'kept' } }),
  'images.discard': async () => ({ ok: true }),
  ...over,
});
async function photoRow(m) {
  await m.press(m.by('pitch-editor-area-free:8-4'));
  await m.press(m.by('pitch-editor-ask-area'));
  await m.press(m.by('pitch-areas-row-free:8-4-element'));
  await m.press(m.by('pitch-areas-row-free:8-4-pick-photo'));
}

test('D1604: the lightbox\'s Generated photo is quoted for the area\'s shape, runs under deck:image, and keeps on Accept', async () => {
  const plan = rowPlan({ area: { id: 'free:1-1', kind: 'free', grid: { c1: 1, c2: 12, r1: 1, r2: 6 } }, element: 'illustration', card: CARD, cardIndex: 4 });
  assert.deepEqual([plan.run, plan.option, plan.body.style, plan.body.aspect, plan.body.count, plan.body.card], ['image', 'deck:image', 'flat', '16:9', 1, 4]);
  assert.equal(plan.body.description, defaultDescription(CARD), 'described from the card, without its figures');
  const m = await mountEditor({ answers: photoAnswers() });
  try {
    await photoRow(m);
    const quote = m.calls.filter((c) => c[0] === 'images.quote').at(-1);
    assert.deepEqual([quote[2].use, quote[2].count, quote[2].aspect, quote[2].card], ['content', 1, '1:1', 0]);
    assert.equal(m.text(m.by('pitch-areas-hold')), 'Holds up to $0.0019 · you pay what it uses');
    assert.equal(m.calls.filter((c) => c[0] === 'images.generate').length, 0, 'nothing runs until Generate');
    await m.press(m.by('pitch-areas-generate'));
    const run = m.calls.find((c) => c[0] === 'images.generate');
    assert.equal(run[3]['X-Rail-Option'], encodeURIComponent('deck:image'));
    assert.match(m.text(m.by('pitch-area-result-free:8-4-pill')), /Proposed · FLUX\.1 Schnell · \$0\.0019/);
    await m.press(m.by('pitch-area-result-free:8-4-accept'));
    assert.deepEqual(m.calls.find((c) => c[0] === 'images.keep').slice(1), ['synthetic-g1', { use: 'content', alt: 'Synthetic heading' }]);
    assert.ok(m.walk(m.by('pitch-editor-blocks')).some((x) => m.pr(x).src === GENERATED.url), 'the image is on the card');
  } finally { await m.close(); }
});

test('D1604: Discard releases a generated photo and places nothing; More image options opens the image lightbox', async () => {
  const m = await mountEditor({ answers: photoAnswers() });
  try {
    await photoRow(m);
    await m.press(m.by('pitch-areas-generate'));
    await m.press(m.by('pitch-area-result-free:8-4-discard'));
    assert.deepEqual(m.calls.find((c) => c[0] === 'images.discard').slice(1), ['synthetic-g1']);
    assert.ok(!m.calls.some((c) => c[0] === 'images.keep'));
    assert.match(m.text(m.by('pitch-area-result-free:8-4-decided')), /Discarded\. Nothing was placed\./);
    const onCard = m.walk(m.by('pitch-editor-blocks')).some((x) => m.pr(x).src === GENERATED.url);
    assert.equal(onCard, false, 'nothing placed on the card');
  } finally { await m.close(); }
  const n = await mountEditor({ answers: photoAnswers() });
  try {
    await photoRow(n);
    await n.press(n.by('pitch-areas-row-free:8-4-image-options'));
    assert.ok(!n.by('pitch-areas'), 'the area lightbox gives way');
    assert.ok(n.by('pitch-image-lightbox'), 'D903\'s lightbox, for style, palette and backgrounds');
  } finally { await n.close(); }
});
