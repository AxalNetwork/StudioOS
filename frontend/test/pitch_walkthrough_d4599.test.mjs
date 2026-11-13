// D4599 part 2 (#4599; D1590 F11, #3837) — the recorded walkthrough's UI:
// the adapter swap, Present › Record (pd36) and pd35's Walkthrough column,
// mounted on a stubbed `fetch` with the real clients, switched on and off.
// The camera, microphone, recorder and clock are the test's own (`browser()`).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_walkthrough_d4599.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import { deckRecordingsApi } from '../src/lib/api/deckRecordings.js';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { NOT_ON } from '../src/pages/raise/pitch/deckV2Model.js';
import RecordPanel from '../src/pages/raise/pitch/RecordPanel.jsx';
import InvestorLinksTable, { WALKTHROUGH } from '../src/pages/raise/pitch/InvestorLinksTable.jsx';
import PitchPresent from '../src/pages/raise/pitch/PitchPresent.jsx';
import {
  DEVICE_BUSY, INTERRUPTED, NO_DEVICE, NO_RECORDER, PERMISSION_DENIED, SHORT, STORED, TOO_LARGE, chipOf, cueAt, permissionProblem,
  recordHref, slideNumbers, takeProblem, uploadProblem, walkthroughCell, walkthroughOf,
} from '../src/pages/raise/pitch/walkthroughModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const OFF = () => json({ error: 'not_switched_on', message: 'Not switched on yet.', detail: 'Not switched on yet.' }, 404);
// Three slides; the second is hidden, so Present's second card is the Worker's card 3.
const DECK = { id: 6, version: 3, project_id: 5, slides: [{ title: 'Problem' }, { title: 'Hidden', hidden: true }, { title: 'Traction' }] };
const CARDS = [{ title: 'Problem' }, { title: 'Traction' }];
const TAKE = (over = {}) => ({ uid: '11111111-1111-4111-8111-111111111111', card: 1, take: 2, duration_ms: 4200, media_mime: 'video/webm', media_bytes: 900, captions: [{ start_ms: 0, end_ms: 1500, text: '[Close takes two hours.]' }], caption_model: '[model]', charged_microusd: 40, created_at: '2026-11-12 09:00:00', ...over });
const LIST = (cards = [TAKE(), null, null], links = []) => json({ deck_id: 6, cards, recorded: cards.filter(Boolean).length, links });
const QUOTE = () => json({ model: '[model]', job: 'DK11', hold_microusd: 20_000, minutes: 3, balance: { ok: true } });
const LINK = (over = {}) => ({ id: 11, investor: { label: '[Pat Partner]', fund: '[Fund A]' }, version: { variant: null }, nda: { state: 'not_required' }, expires_at: null, view_cap: { limit: null, used: 0 }, status: 'live', analytics: { views: 0 }, ...over });

/** A camera, a microphone, MediaRecorder and a clock that only move when the test says so. */
function browser() {
  const b = { gum: 0, deny: null, recorders: [], tracksStopped: 0, t: 0 };
  const track = () => ({ stop() { b.tracksStopped += 1; } });
  const stream = () => { const v = track(); const a = track(); return { getTracks: () => [v, a], getAudioTracks: () => [a] }; };
  class Rec {
    static isTypeSupported(m) { return m === 'video/webm' || m === 'audio/webm'; }
    constructor(_s, opts = {}) { this.mimeType = opts.mimeType || ''; this.state = 'inactive'; this.sound = !!opts.audioBitsPerSecond; b.recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([this.sound ? 'aa' : 'vvvv'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  b.deps = {
    getUserMedia: async () => {
      b.gum += 1;
      if (b.deny) throw Object.assign(new Error('refused'), { name: b.deny });
      return stream();
    },
    enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'cam1', label: '[Built-in camera]' }, { kind: 'audioinput', deviceId: 'mic1', label: '[Built-in microphone]' }],
    MediaRecorder: Rec, MediaStream: function MS(tracks) { this.tracks = tracks; }, now: () => b.t, setInterval: () => 1, clearInterval() {},
  };
  return b;
}

/** Mount on a stubbed fetch keyed "METHOD /path"; an unknown request is a network failure. */
async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  const bodies = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push(key);
    bodies.push([key, init.body]);
    const f = handle[key];
    if (!f) throw new TypeError('Failed to fetch');
    return f(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(element));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join(' ') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    seen, bodies, settle, props, by: byId,
    text: (id) => textOf(id ? byId(id) : container).replace(/\s+/g, ' ').trim(),
    has: (id) => Boolean(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { await props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}
const panel = (b, over = {}) => h(RecordPanel, { deck: DECK, cards: CARDS, slideNos: slideNumbers(DECK), renderCard: (k) => h('div', { 'data-testid': `card-${k}` }, CARDS[k].title), onClose() {}, deps: b.deps, ...over });

/* ------------------------------------------------------------------ the swap and the words */

test('the swap: walkthrough answers through deckRecordingsApi.list, and the switch off reads "Not switched on yet."', async () => {
  // Mutation checked: walkthrough left as off('walkthrough') → the available answer fails; keyed to another row's issue → the 404 answer fails.
  const src = codeOnly(read('frontend/src/pages/raise/pitch/deckV2Adapter.js'));
  assert.match(src, /^export const walkthrough = \(deckId\) => through\(\(\) => deckRecordingsApi\.list\(deckId\), SURFACES\.walkthrough\.issue\);$/m);
  assert.ok(adapter.SWAPPED.includes('walkthrough'));
  assert.equal(adapter.availability('walkthrough'), null, 'nothing greys Record before the Worker answers');
  const real = deckRecordingsApi.list;
  try {
    deckRecordingsApi.list = async (id) => ({ deck_id: id, cards: [null], recorded: 0, links: [] });
    assert.deepEqual(await adapter.walkthrough(6), { available: true, value: { deck_id: 6, cards: [null], recorded: 0, links: [] } });
    deckRecordingsApi.list = async () => { throw Object.assign(new Error('Not switched on yet.'), { status: 404, code: 'not_switched_on' }); };
    assert.deepEqual(await adapter.walkthrough(6), { available: false, reason: NOT_ON, issue: 3837 });
    deckRecordingsApi.list = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
    const bad = await adapter.walkthrough(6);
    assert.equal(bad.unreadable, true, 'a failed read is unreadable, never an empty walkthrough');
  } finally { deckRecordingsApi.list = real; }
  // Wiring the UI turns nothing on: no client writes a flag, and the Worker's switch is still read on every route.
  const worker = codeOnly(read('cloudflare-worker/src/routes/deck_recordings.ts'));
  assert.match(worker, /flagsFor\(c\.env, user\)\)\.on\('deck:walkthrough'\)/);
  for (const f of ['RecordPanel.jsx', 'walkthroughModel.js', 'InvestorLinksTable.jsx']) {
    assert.doesNotMatch(codeOnly(read(`frontend/src/pages/raise/pitch/${f}`)), /feature-flags|featureFlags|deck:walkthrough/, f);
  }
});

test('the words: hidden cards keep the Worker\'s numbering; chips, cells, limits and refusals', () => {
  // Mutation checked: slideNumbers counting only shown cards → [1, 2] fails; a pending upload ignored → the chip says Take ✓.
  assert.deepEqual(slideNumbers(DECK), [1, 3]);
  assert.equal(chipOf({ index: 0, take: TAKE() }).line, 'Slide 1 · Take 2 ✓');
  assert.equal(chipOf({ index: 1, take: null, recording: true }).line, 'Slide 2 · Recording');
  assert.equal(chipOf({ index: 2, take: null }).line, 'Slide 3 · Not recorded');
  assert.equal(chipOf({ index: 0, take: TAKE(), pending: { status: 'interrupted' } }).line, 'Slide 1 · Not sent');
  const walk = walkthroughOf({ cards: [TAKE(), null, TAKE({ card: 3 })], recorded: 2, links: [11] });
  assert.deepEqual(walkthroughCell(walk, LINK()), { kind: 'attached', line: 'Attached · 2 slides' });
  assert.deepEqual(walkthroughCell(walk, LINK({ id: 12 })), { kind: 'attach', line: 'Attach · 2 slides' });
  assert.deepEqual(walkthroughCell(walkthroughOf({ cards: [null], recorded: 0, links: [] }), LINK()), { kind: 'record', line: 'Record ›' });
  assert.deepEqual(walkthroughCell(walk, LINK({ id: 12, status: 'withdrawn' })), { kind: 'none', line: 'Not attached' });
  assert.equal(recordHref(5, 6), '/raise/pitch/present?project_id=5&deck=6&view=record');
  assert.equal(cueAt(TAKE().captions, 800), '[Close takes two hours.]');
  assert.equal(cueAt(TAKE().captions, 1600), null);
  assert.equal(permissionProblem({ name: 'NotAllowedError' }).message, PERMISSION_DENIED);
  assert.equal(permissionProblem({ name: 'NotFoundError' }).message, NO_DEVICE);
  assert.equal(permissionProblem({ name: 'NotReadableError' }).message, DEVICE_BUSY);
  assert.deepEqual(takeProblem({ durationMs: 400, size: 10 }), { status: 'short', message: SHORT });
  assert.deepEqual(takeProblem({ durationMs: 4000, size: 41 * 1024 * 1024 }), { status: 'too_large', message: TOO_LARGE });
  assert.equal(takeProblem({ durationMs: 4000, size: 10 }), null);
  assert.equal(uploadProblem(new TypeError('Failed to fetch')).message, INTERRUPTED);
  assert.equal(uploadProblem({ code: 'timeout', message: 'took too long' }).status, 'interrupted');
  const full = uploadProblem(Object.assign(new Error('Your storage is full. Free some space first.'), { status: 413, code: 'storage_full' }));
  assert.deepEqual([full.status, full.message], ['failed', 'Your storage is full. Free some space first.']);
  for (const w of [STORED, PERMISSION_DENIED, INTERRUPTED]) assert.doesNotMatch(w, /advis|advice|recommend|fiduciar/i, 'Eadwyn\'s voice');
});

/* ------------------------------------------------------------------ Present › Record, switched off and on */

test('switched off: Present › Record says "Not switched on yet." and asks for no camera, records and sends nothing', async () => {
  // Mutation checked: the panel drawing its recorder on an unavailable read → record-panel is found and this fails.
  const b = browser();
  const v = await mount(panel(b), { 'GET /api/decks/6/recordings': OFF });
  try {
    assert.ok(v.has('record-unavailable'));
    assert.match(v.text(), /Not switched on yet\./);
    assert.equal(v.has('record-panel'), false);
    assert.equal(v.has('record-retry'), false, 'switched off is not a failed read');
    assert.equal(b.gum, 0, 'the camera is never asked for');
    assert.deepEqual(v.seen, ['GET /api/decks/6/recordings'], 'no quote, no links read, no upload');
  } finally { await v.close(); }
});

test('a failed read says it could not be read, with Try again, never an empty walkthrough', async () => {
  // Mutation checked: Try again not wired to the read → one call only and this fails.
  let calls = 0;
  const b = browser();
  const v = await mount(panel(b), {
    'GET /api/decks/6/recordings': () => { calls += 1; return calls === 1 ? json({ error: 'boom' }, 500) : LIST(); },
    'POST /api/decks/6/recordings/quote': QUOTE,
    'GET /api/decks/6/investor-links': () => json({ links: [] }),
  });
  try {
    assert.ok(v.has('record-unreadable'));
    assert.match(v.text(), /Your walkthrough could not be read\./);
    assert.doesNotMatch(v.text(), /Not recorded/);
    await v.click('record-retry');
    assert.equal(calls, 2);
    assert.ok(v.has('record-panel'));
    assert.match(v.text('record-chip-0'), /Slide 1 · Take 2 ✓/);
  } finally { await v.close(); }
});

test('switched on: record, move on, stop — each card\'s take is sent as it ends, under the Worker\'s card number', async () => {
  // Mutation checked: the card sent as the shown index (2, not 3) → the second POST's card fails; moving on without
  // finishing the take → only one POST; Stop not sending → one POST.
  const b = browser();
  const posts = [];
  const v = await mount(panel(b), {
    'GET /api/decks/6/recordings': () => LIST([null, null, null]),
    'POST /api/decks/6/recordings/quote': QUOTE,
    'GET /api/decks/6/investor-links': () => json({ links: [LINK()] }),
    'POST /api/decks/6/recordings': (init) => {
      const card = Number(init.body.get('card'));
      posts.push({ card, duration: Number(init.body.get('duration_ms')), media: init.body.get('media').type, audio: init.body.get('audio')?.type });
      const cards = [null, null, null];
      for (const p of posts) cards[p.card - 1] = TAKE({ card: p.card, take: 1, uid: `0000000${p.card}-1111-4111-8111-111111111111` });
      return json({ take: cards[card - 1], walkthrough: { cards, recorded: cards.filter(Boolean).length } }, 201);
    },
  });
  try {
    assert.match(v.text('record-hold'), /Captions · Holds up to \$0\.0200 a take/);
    assert.match(v.text('record-stored'), /Stored with your deck; delete it any time\./);
    assert.match(v.text('record-chip-0'), /Slide 1 · Not recorded/);
    assert.match(v.text('record-devices'), /asked for when you start/);
    await v.click('record-start');
    assert.equal(b.gum, 1);
    assert.equal(v.props(v.by('record-panel'))['data-stage'], 'recording');
    assert.match(v.text('record-chip-0'), /Slide 1 · Recording/);
    assert.ok(v.has('record-camera-preview'), 'the camera in its circle');
    assert.match(v.text('record-devices'), /\[Built-in camera\]/, 'the devices, named once allowed');
    b.t = 4200;
    await v.click('record-next');
    assert.deepEqual(posts, [{ card: 1, duration: 4200, media: 'video/webm', audio: 'audio/webm' }]);
    assert.match(v.text('record-chip-0'), /Slide 1 · Take 1 ✓/);
    assert.match(v.text('record-chip-1'), /Slide 2 · Recording/);
    b.t = 9200;
    await v.click('record-stop');
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1], { card: 3, duration: 5000, media: 'video/webm', audio: 'audio/webm' }, 'the hidden card is skipped in the numbering');
    assert.match(v.text('record-chip-1'), /Slide 2 · Take 1 ✓/);
    assert.equal(b.tracksStopped, 2, 'Stop lets go of the camera and the microphone');
    assert.equal(v.props(v.by('record-panel'))['data-stage'], 'idle');
  } finally { await v.close(); }
});

test('a take under one second is not sent, and says why', async () => {
  // Mutation checked: takeProblem skipped → a POST is made and this fails.
  const b = browser();
  const v = await mount(panel(b), { 'GET /api/decks/6/recordings': () => LIST([null, null, null]), 'POST /api/decks/6/recordings/quote': QUOTE, 'GET /api/decks/6/investor-links': () => json({ links: [] }) });
  try {
    await v.click('record-start');
    b.t = 500;
    await v.click('record-stop');
    assert.ok(!v.seen.includes('POST /api/decks/6/recordings'));
    assert.match(v.text('record-pending-0'), /Too short to keep/);
    assert.equal(v.has('record-resend-0'), false, 'a short take is recorded again, not sent again');
    assert.ok(v.has('record-rerecord-0'));
  } finally { await v.close(); }
});

test('camera or microphone refused: the words say how to allow it, and Try again asks again', async () => {
  // Mutation checked: permissionProblem bypassed (one generic line) → the words fail; Try again not wired → gum stays 1.
  const b = browser();
  b.deny = 'NotAllowedError';
  const v = await mount(panel(b), { 'GET /api/decks/6/recordings': () => LIST(), 'POST /api/decks/6/recordings/quote': QUOTE, 'GET /api/decks/6/investor-links': () => json({ links: [] }) });
  try {
    await v.click('record-start');
    assert.equal(v.props(v.by('record-problem'))['data-kind'], 'permission');
    assert.match(v.text('record-problem'), /Camera and microphone access was refused\. Allow both for this site in your browser's settings, then try again\./);
    assert.equal(v.props(v.by('record-panel'))['data-stage'], 'idle');
    b.deny = null;
    await v.click('record-problem-retry');
    assert.equal(b.gum, 2);
    assert.equal(v.has('record-problem'), false);
    assert.equal(v.props(v.by('record-panel'))['data-stage'], 'recording');
  } finally { await v.close(); }
});

test('a browser that cannot record says so, and asks for nothing', async () => {
  const b = browser();
  const v = await mount(panel(b, { deps: { ...b.deps, MediaRecorder: undefined } }), { 'GET /api/decks/6/recordings': () => LIST(), 'POST /api/decks/6/recordings/quote': QUOTE, 'GET /api/decks/6/investor-links': () => json({ links: [] }) });
  try {
    await v.click('record-start');
    assert.equal(v.text('record-problem'), NO_RECORDER);
    assert.equal(b.gum, 0);
  } finally { await v.close(); }
});

test('an interrupted upload keeps the take to send again; a refusal is shown in the Worker\'s words', async () => {
  // Mutation checked: the take dropped on failure (no item kept) → Send again posts nothing; uploadProblem bypassed → the words fail.
  const b = browser();
  let mode = 'drop';
  const v = await mount(panel(b), {
    'GET /api/decks/6/recordings': () => LIST([null, null, null]),
    'POST /api/decks/6/recordings/quote': QUOTE,
    'GET /api/decks/6/investor-links': () => json({ links: [] }),
    'POST /api/decks/6/recordings': () => {
      if (mode === 'drop') throw new TypeError('Failed to fetch');
      if (mode === 'full') return json({ error: 'storage_full', message: 'Your storage plan is full. Free some space, or add storage.', detail: 'Your storage plan is full. Free some space, or add storage.' }, 413);
      return json({ take: TAKE({ take: 1 }), walkthrough: { cards: [TAKE({ take: 1 }), null, null], recorded: 1 } }, 201);
    },
  });
  try {
    await v.click('record-start');
    b.t = 3000;
    await v.click('record-stop');
    assert.equal(v.props(v.by('record-chip-0'))['data-state'], 'interrupted');
    assert.match(v.text('record-pending-0'), /The upload was interrupted\. The take is still here: send it again\./);
    mode = 'full';
    await v.click('record-resend-0');
    assert.equal(v.props(v.by('record-chip-0'))['data-state'], 'failed');
    assert.match(v.text('record-pending-0'), /Your storage plan is full\./);
    mode = 'ok';
    await v.click('record-resend-0');
    assert.equal(v.seen.filter((k) => k === 'POST /api/decks/6/recordings').length, 3, 'the same take, sent three times');
    assert.match(v.text('record-chip-0'), /Slide 1 · Take 1 ✓/);
    assert.equal(v.has('record-pending-0'), false);
  } finally { await v.close(); }
});

test('playback, retake, delete behind its confirm, and attach and remove on an investor link', async () => {
  // Mutation checked: delete without the confirm → DELETE seen before yes; the DELETE failure dropped → no retry line;
  // attach sending attach:false → the PUT body fails; captions not drawn → the cue fails.
  const b = browser();
  let deleteFails = true;
  const puts = [];
  const v = await mount(panel(b), {
    'GET /api/decks/6/recordings': () => LIST([TAKE(), null, null], []),
    'POST /api/decks/6/recordings/quote': QUOTE,
    'GET /api/decks/6/investor-links': () => json({ links: [LINK(), LINK({ id: 12, status: 'withdrawn' })] }),
    'PUT /api/decks/6/recordings/links/11': (init) => { const body = JSON.parse(init.body); puts.push(body.attach); return json({ links: body.attach ? [11] : [] }); },
    'DELETE /api/decks/6/recordings/11111111-1111-4111-8111-111111111111': () => (deleteFails
      ? json({ error: 'storage_unavailable', message: 'The take could not be deleted. Try again.', detail: 'The take could not be deleted. Try again.' }, 503)
      : json({ deleted: true })),
    'POST /api/decks/6/recordings': () => json({ take: TAKE({ take: 3 }), walkthrough: { cards: [TAKE({ take: 3 }), null, null], recorded: 1 } }, 201),
  });
  try {
    // Playback, with the take's captions.
    await v.click('record-play-0');
    assert.ok(v.has('record-playback'));
    assert.equal(v.props(v.by('record-video')).src, '/api/decks/6/recordings/11111111-1111-4111-8111-111111111111/media');
    await act(async () => { v.props(v.by('record-video')).onTimeUpdate({ currentTarget: { currentTime: 0.8 } }); });
    assert.equal(v.text('record-caption'), '[Close takes two hours.]');
    await v.click('record-play-close');
    // Attach to the one live link, then remove it.
    assert.match(v.text('record-attach'), /Attach to \[Fund A\]’s link/);
    await v.click('record-attach-button');
    assert.deepEqual(puts, [true]);
    assert.match(v.text('record-attach'), /Remove from \[Fund A\]’s link/);
    await v.click('record-detach');
    assert.deepEqual(puts, [true, false]);
    // Retake: a new take for the same card.
    await v.click('record-retake-0');
    b.t = 2000;
    await v.click('record-stop');
    assert.match(v.text('record-chip-0'), /Slide 1 · Take 3 ✓/);
    // Delete asks first; a failed delete says so and can be tried again.
    await v.click('record-delete-0');
    assert.match(v.text('record-delete-confirm'), /Delete this take\?/);
    assert.ok(!v.seen.some((k) => k.startsWith('DELETE ')), 'nothing is deleted before the confirm');
    await v.click('record-delete-yes');
    assert.match(v.text('record-delete-failed'), /could not be deleted/);
    assert.match(v.text('record-chip-0'), /Take 3 ✓/, 'a take whose file could not be deleted stays');
    deleteFails = false;
    await v.click('record-delete-yes');
    assert.equal(v.has('record-delete-confirm'), false);
    assert.match(v.text('record-chip-0'), /Slide 1 · Not recorded/);
  } finally { await v.close(); }
});

test('a captions price that cannot be paid stops Record before the camera is asked for', async () => {
  // Mutation checked: `blocked` dropped from Start's disabled → the click goes through and gum is 1.
  const b = browser();
  const v = await mount(panel(b), {
    'GET /api/decks/6/recordings': () => LIST(),
    'POST /api/decks/6/recordings/quote': () => json({ model: '[model]', job: 'DK11', hold_microusd: 20_000, minutes: 3, balance: { ok: false, code: 'insufficient_balance', message: 'Add tokens to record.' } }),
    'GET /api/decks/6/investor-links': () => json({ links: [] }),
  });
  try {
    assert.match(v.text(), /Add tokens to record\./);
    assert.equal(v.props(v.by('record-start')).disabled, true);
    assert.equal(b.gum, 0);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ Present itself */

async function present(handle) {
  const ORIGINAL = { deckGet: api.deckGet };
  api.deckGet = async () => ({ ...DECK });
  const previous = globalThis.matchMedia;
  const media = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = media;
  const v = await mount(h(MemoryRouter, { initialEntries: ['/raise/pitch/present?project_id=5&deck=6&view=record'] }, h(PitchPresent)), handle);
  return { ...v, async close() { await v.close(); api.deckGet = ORIGINAL.deckGet; globalThis.matchMedia = previous; } };
}

test('Present opens on Record from ?view=record: on, the chips; off, "Not switched on yet."', async () => {
  // Mutation checked: ?view=record not read → the presenter view and no Record panel; the Record toggle dropped → no button.
  const on = await present({
    'GET /api/decks/6/recordings': () => LIST([TAKE(), null, null]),
    'POST /api/decks/6/recordings/quote': QUOTE,
    'GET /api/decks/6/investor-links': () => json({ links: [] }),
  });
  try {
    assert.ok(on.has('pitch-present-record'));
    assert.equal(on.props(on.by('pitch-present-record'))['aria-pressed'], true);
    assert.ok(on.has('record-panel'));
    assert.match(on.text('record-chips'), /Slide 1 · Take 2 ✓ .*Slide 2 · Not recorded/);
    assert.equal(on.has('record-chip-2'), false, 'the hidden card has no chip');
  } finally { await on.close(); }
  const off = await present({ 'GET /api/decks/6/recordings': OFF });
  try {
    assert.ok(off.has('record-unavailable'));
    assert.match(off.text('record-unavailable'), /Not switched on yet\./);
  } finally { await off.close(); }
});

/* ------------------------------------------------------------------ pd35's Walkthrough column */

test('pd35: switched on, the column reads Attached · N slides with Remove, Attach, or Record ›', async () => {
  // Mutation checked: the column drawn from `recorded` without the links → row 11 reads Attach; Remove sending attach:true → the PUT body fails.
  const puts = [];
  const v = await mount(h(InvestorLinksTable, { deck: DECK, projectId: 5 }), {
    'GET /api/decks/6/investor-links': () => json({ links: [LINK(), LINK({ id: 12, investor: { label: '[Ola Angel]' } }), LINK({ id: 13, status: 'withdrawn' })] }),
    'GET /api/decks/6/recordings': () => LIST([TAKE(), null, TAKE({ card: 3 })], [11]),
    'PUT /api/decks/6/recordings/links/11': (init) => { puts.push(JSON.parse(init.body).attach); return json({ links: [] }); },
    'PUT /api/decks/6/recordings/links/12': (init) => { puts.push(JSON.parse(init.body).attach); return json({ links: [12] }); },
  });
  try {
    assert.ok(v.text('investor-links').includes(WALKTHROUGH), 'the column header');
    assert.match(v.text('investor-link-walkthrough-11'), /Attached · 2 slides Remove/);
    assert.match(v.text('investor-link-walkthrough-12'), /Attach · 2 slides/);
    assert.match(v.text('investor-link-walkthrough-13'), /Not attached/);
    await v.click('investor-link-detach-11');
    await v.click('investor-link-attach-12');
    assert.deepEqual(puts, [false, true]);
    assert.match(v.text('investor-link-walkthrough-11'), /Attach · 2 slides/);
    assert.match(v.text('investor-link-walkthrough-12'), /Attached · 2 slides/);
  } finally { await v.close(); }
  const empty = await mount(h(InvestorLinksTable, { deck: DECK, projectId: 5 }), {
    'GET /api/decks/6/investor-links': () => json({ links: [LINK()] }),
    'GET /api/decks/6/recordings': () => LIST([null, null, null]),
  });
  try {
    assert.match(empty.text('investor-link-walkthrough-11'), /^Record ›$/);
    assert.equal(empty.props(empty.by('investor-link-record-11')).href, '/raise/pitch/present?project_id=5&deck=6&view=record');
  } finally { await empty.close(); }
});

test('pd35: switched off, no Walkthrough column; unreadable, "Could not be read" with Try again, never Record ›', async () => {
  // Mutation checked: the column drawn while off → its header is found; Try again not wired → one read only.
  const off = await mount(h(InvestorLinksTable, { deck: DECK, projectId: 5 }), {
    'GET /api/decks/6/investor-links': () => json({ links: [LINK()] }),
    'GET /api/decks/6/recordings': OFF,
  });
  try {
    assert.ok(off.has('investor-link-11'));
    assert.doesNotMatch(off.text('investor-links'), /Walkthrough/i);
    assert.equal(off.has('investor-link-walkthrough-11'), false);
  } finally { await off.close(); }
  let calls = 0;
  const bad = await mount(h(InvestorLinksTable, { deck: DECK, projectId: 5 }), {
    'GET /api/decks/6/investor-links': () => json({ links: [LINK()] }),
    'GET /api/decks/6/recordings': () => { calls += 1; return calls === 1 ? json({ error: 'boom' }, 500) : LIST([TAKE(), null, null], [11]); },
  });
  try {
    assert.match(bad.text('investor-link-walkthrough-11'), /Could not be read/);
    assert.doesNotMatch(bad.text('investor-link-walkthrough-11'), /Record/);
    await bad.click('investor-link-walkthrough-retry-11');
    assert.equal(calls, 2);
    assert.match(bad.text('investor-link-walkthrough-11'), /Attached · 1 slide\b/);
  } finally { await bad.close(); }
});
