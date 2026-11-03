/**
 * D1534 (#3778 phase 2, pd27): the AI image tools on a placed image's toolbar.
 *
 *   - Off (the switch, until the owner's steps): every tool stays greyed under
 *     "Coming later", and the adapter answers unavailable with the Worker's words.
 *   - On: Remove background is a live button; its press is quoted first and runs
 *     only from the quote; a short balance never runs; the result is kept and
 *     placed in the block's own place, so the crop, filter and fit stay.
 *   - Upscale has no model: always greyed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_image_tools_d1534.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ImageToolbar from '../src/pages/raise/pitch/ImageToolbar.jsx';
import ImageToolbarLive from '../src/pages/raise/pitch/ImageToolbarLive.jsx';
import { TOOL_OF_LABEL, liveTools, placedResult, toolCostLine, toolRunnable } from '../src/pages/raise/pitch/imageToolsModel.js';
import { deckImageEditsApi } from '../src/lib/api/deckImageEdits.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import * as api from '../src/lib/api.js';

const h = React.createElement;
const BLOCK = { id: 'i1', kind: 'image', grid: { c1: 1, r1: 1, c2: 6, r2: 4 }, image_url: '/api/decks/images/a/file', image_id: 'a', alt: 'The team', tag: 'photo', fit: 'cover', crop: { x: 40, y: 50, rect: { x: 10, y: 0, w: 80, h: 80 } }, filter: 'warm' };
const QUOTE = { ai: true, tool: 'remove_background', label: 'Remove background', model: 'bria/remove-background', model_label: 'Bria RMBG 2.0', hold_microusd: 18_000, balance: { ok: true } };
const OFF_LINE = 'Background removal is coming later. Nothing was run and nothing was charged.';

async function mount(element) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(element); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const press = async (n) => { assert.ok(n, 'missing'); assert.ok(!pr(n).disabled, 'disabled'); await act(async () => { pr(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); };
  return { by, pr, text, press, settle, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('the model: live tools from the adapter, a cost line that is never $0, the placement patch', () => {
  assert.deepEqual([...liveTools({ available: true, value: { tools: [{ tool: 'remove_background', on: true }, { tool: 'upscale', on: false }] } })], ['remove_background']);
  assert.equal(liveTools({ available: false, reason: OFF_LINE }).size, 0);
  assert.equal(TOOL_OF_LABEL['Remove background'], 'remove_background');
  assert.match(toolCostLine(QUOTE), /^Bria RMBG 2\.0 · 1 image · .+ · covered by your AI tokens$/);
  assert.equal(toolCostLine({ ...QUOTE, hold_microusd: null }), 'Bria RMBG 2.0 · Price not recorded', 'an unread price is never $0');
  assert.equal(toolCostLine({ ai: false, message: OFF_LINE }), OFF_LINE);
  assert.equal(toolRunnable({ ...QUOTE, balance: { ok: false } }), false);
  assert.deepEqual(placedResult({ uid: 'b', url: '/api/decks/images/b/file', alt: 'x' }), { image_url: '/api/decks/images/b/file', image_id: 'b' });
  assert.equal(placedResult({ uid: 'b' }), null);
});

test('the client: liveTools answers the list only while a tool is on, else 503 image_tool_off in the Worker\'s words', async () => {
  // Mutation checked: liveTools answering the list with every tool off (the picker would offer a tool the Worker refuses).
  const real = globalThis.fetch;
  const restore = installDocument();
  const answer = (tools) => { globalThis.fetch = async () => new Response(JSON.stringify({ tools }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    answer([{ tool: 'remove_background', on: false, message: OFF_LINE }, { tool: 'upscale', on: false, message: 'No model.' }]);
    await assert.rejects(deckImageEditsApi.liveTools(), (e) => e.status === 503 && e.code === 'image_tool_off' && e.message === OFF_LINE);
    answer([{ tool: 'remove_background', on: true }]);
    assert.deepEqual(await deckImageEditsApi.liveTools(), { tools: [{ tool: 'remove_background', on: true }] });
  } finally { globalThis.fetch = real; restore(); }
});

test('the adapter: with every tool off, imageEditAi is "Coming later" in the Worker\'s words; with one on, it is available', async () => {
  const real = api.request;
  const saved = deckImageEditsApi.liveTools;
  try {
    deckImageEditsApi.liveTools = async () => { const e = new Error(OFF_LINE); e.status = 503; e.code = 'image_tool_off'; throw e; };
    const off = await adapter.imageEditAi();
    assert.deepEqual([off.available, off.reason, off.issue], [false, OFF_LINE, 3778]);
    deckImageEditsApi.liveTools = async () => ({ tools: [{ tool: 'remove_background', on: true }] });
    const on = await adapter.imageEditAi();
    assert.equal(on.available, true);
  } finally { deckImageEditsApi.liveTools = saved; assert.equal(api.request, real); }
});

test('off: every tool is greyed under Coming later', async () => {
  const m = await mount(h(ImageToolbar, { block: BLOCK, image: null, onPatch() {}, onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {}, live: new Set(), tools: { quote() { throw new Error('no'); }, run() { throw new Error('no'); } } }));
  try {
    await m.press(m.by('pitch-image-filters'));
    assert.equal(m.by('pitch-image-tool-remove_background'), undefined);
    assert.match(m.text(m.by('pitch-image-coming-later')), /Remove background/);
  } finally { await m.unmount(); }
});

test('on: the press is quoted first, runs only from the quote, and a short balance never runs; Upscale stays greyed', async () => {
  // Mutation checked: Run enabled before a quote (a press runs unpriced).
  const seen = [];
  const tools = { quote: async (t) => { seen.push(['quote', t]); return QUOTE; }, run: async (t) => { seen.push(['run', t]); } };
  const m = await mount(h(ImageToolbar, { block: BLOCK, image: null, onPatch() {}, onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {}, live: new Set(['remove_background']), tools }));
  try {
    await m.press(m.by('pitch-image-filters'));
    assert.equal(m.by('pitch-image-tool-upscale'), undefined, 'Upscale has no model');
    await m.press(m.by('pitch-image-tool-remove_background'));
    assert.deepEqual(seen, [['quote', 'remove_background']], 'the quote, and nothing run');
    assert.match(m.text(m.by('pitch-image-tool-cost')), /^Bria RMBG 2\.0 · 1 image · /);
    await m.press(m.by('pitch-image-tool-run'));
    assert.deepEqual(seen, [['quote', 'remove_background'], ['run', 'remove_background']]);
    assert.equal(m.by('pitch-image-tool-press'), undefined, 'done');
  } finally { await m.unmount(); }
  const short = await mount(h(ImageToolbar, { block: BLOCK, image: null, onPatch() {}, onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {}, live: new Set(['remove_background']),
    tools: { quote: async () => ({ ...QUOTE, balance: { ok: false, message: 'Not enough AI tokens.' } }), run: async () => { throw new Error('must not run'); } } }));
  try {
    await short.press(short.by('pitch-image-filters'));
    await short.press(short.by('pitch-image-tool-remove_background'));
    assert.equal(short.pr(short.by('pitch-image-tool-run')).disabled, true);
  } finally { await short.unmount(); }
});

test('the live toolbar keeps the cutout and places it in the block\'s own place: crop, filter and fit stay', async () => {
  // Mutation checked: the result placed without being kept, or placed as a new block.
  const calls = [];
  const patches = [];
  const fake = {
    edits: {
      toolQuote: async (uid, tool) => { calls.push(['quote', uid, tool]); return QUOTE; },
      runTool: async (uid, tool, key) => { calls.push(['run', uid, tool, typeof key]); return { image: { uid: 'b', url: '/api/decks/images/b/file', alt: 'The team', state: 'proposed' } }; },
    },
    images: { keep: async (uid, body) => { calls.push(['keep', uid, body]); return { image: { uid, url: `/api/decks/images/${uid}/file`, state: 'kept' } }; } },
  };
  const live = async () => ({ available: true, value: { tools: [{ tool: 'remove_background', on: true }] } });
  const m = await mount(h(ImageToolbarLive, { block: BLOCK, image: null, onPatch: (p) => patches.push(p), onReplace() {}, onUpload() {}, onRegenerate() {}, onRemove() {}, api: fake, adapter: live }));
  try {
    await m.press(m.by('pitch-image-filters'));
    await m.press(m.by('pitch-image-tool-remove_background'));
    await m.press(m.by('pitch-image-tool-run'));
    assert.deepEqual(calls, [['quote', 'a', 'remove_background'], ['run', 'a', 'remove_background', 'string'], ['keep', 'b', { use: 'content', alt: 'The team' }]]);
    assert.deepEqual(patches, [{ image_url: '/api/decks/images/b/file', image_id: 'b' }], 'only the image changes: the crop, filter and fit stay');
  } finally { await m.unmount(); }
});
