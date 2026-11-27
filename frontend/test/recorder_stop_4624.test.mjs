/**
 * D4624 (#4624) — Stop waits for every recorder slice. A final event that fires
 * late, a queue write that is slow, and a prior slice that completes during Stop
 * are all part of the recording; a refused write is a recoverable state, never
 * "No audio was recorded".
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/recorder_stop_4624.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../src/lib/activeRecording.js';
import { createCapture, memoryQueue } from '../src/lib/interviewCapture.js';

const track = () => ({ kind: 'audio', stop() {}, addEventListener() {} });
const media = () => { const t = [track()]; return { getTracks: () => t, getAudioTracks: () => t, getVideoTracks: () => [] }; };

/** A browser whose recorders fire their final events only when the test says so. */
function browser() {
  const recorders = [];
  const timers = [];
  class Rec {
    constructor() { this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; }
    /** The final event, then the stop event, as a real recorder fires them. */
    finish(bytes = 'x') { this.ondataavailable?.({ data: new Blob([bytes], { type: 'audio/webm' }) }); return this.onstop?.(); }
  }
  class Ctx {
    createMediaStreamSource() { return { connect() {} }; }
    createGain() { return { connect() {} }; }
    createMediaStreamDestination() { return { stream: 'MIXED' }; }
    createAnalyser() { return { fftSize: 0, connect() {} }; }
    close() {}
  }
  return {
    recorders, timers,
    deps: {
      getUserMedia: async () => media(), AudioContext: Ctx, MediaStream: function MS() {}, MediaRecorder: Rec, WebSocket: null,
      now: () => 1000, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    },
  };
}
const gateQueue = (inner = memoryQueue()) => {
  const q = { ...inner, puts: [], gate: null, refuse: false };
  q.put = async (row) => {
    q.puts.push(row.seq);
    if (q.gate) await q.gate;
    if (q.refuse) throw new Error('QuotaExceededError');
    return inner.put(row);
  };
  return q;
};
const tick = () => new Promise((r) => setTimeout(r, 0));
async function capture(queue, b = browser()) {
  const c = createCapture({ deps: b.deps, api: { uploadChunk: async () => ({}) }, queue, sessionId: 1, liveOn: false });
  await c.open();
  c.start();
  return { c, b };
}

test('a final event that fires after Stop returns is still waited for: a short recording is not empty', async () => {
  const q = gateQueue();
  const { c, b } = await capture(q);
  let settled = false;
  const stopping = c.stop().then((r) => { settled = true; return r; });
  await tick(); await tick();
  assert.equal(settled, false, 'Stop waits for the slice, not for one turn of the event loop');
  b.recorders[0].finish();
  const out = await stopping;
  assert.deepEqual([out.lastSeq, out.unsaved], [0, 0]);
});

test('a slow local queue write is awaited, and lastSeq names what was persisted', async () => {
  const q = gateQueue();
  let open; q.gate = new Promise((r) => { open = r; });
  const { c, b } = await capture(q);
  const fired = b.recorders[0].finish();
  let settled = false;
  const stopping = c.stop().then((r) => { settled = true; return r; });
  await tick(); await tick();
  assert.equal(settled, false, 'the write has not landed yet');
  open();
  await fired;
  const out = await stopping;
  assert.equal(out.lastSeq, 0);
  assert.equal(out.unsaved, 0);
});

test('a prior slice that completes during Stop is counted with the last one', async () => {
  const q = gateQueue();
  const { c, b } = await capture(q);
  // The chunk timer rolls the recorder over: slice 0 stops, slice 1 starts.
  const roll = b.timers.find(([, ms]) => ms > 1000);
  roll[0]();
  assert.equal(b.recorders.length, 2);
  const stopping = c.stop();
  await tick();
  b.recorders[1].finish('last');   // the newest slice's event comes first
  await tick();
  b.recorders[0].finish('first');  // the prior slice completes during Stop
  const out = await stopping;
  assert.equal(out.lastSeq, 1);
  assert.deepEqual(q.puts.sort(), [0, 1]);
});

test('a refused write is reported, kept, and written again by the next stop', async () => {
  const q = gateQueue();
  q.refuse = true;
  const { c, b } = await capture(q);
  await b.recorders[0].finish();
  const first = await c.stop();
  assert.equal(first.unsaved, 1);
  assert.equal(first.lastSeq, null, 'nothing is claimed as persisted');
  q.refuse = false;
  const second = await c.stop();
  assert.deepEqual([second.unsaved, second.lastSeq], [0, 0]);
  assert.equal(q.puts.length, 3, 'written at the final event, retried by the first stop, written for good by the second');
});

test('a sign-out hold keeps the slice on the device and does not upload; discard drops an unsaved one', async () => {
  const sent = [];
  const q = gateQueue();
  const b = browser();
  const held = createCapture({ deps: b.deps, api: { uploadChunk: async (...a) => { sent.push(a); return {}; } }, queue: q, sessionId: 1, liveOn: false });
  await held.open(); held.start();
  const stopping = held.stop({ flush: false });
  await b.recorders[0].finish();
  const out = await stopping;
  assert.equal(out.lastSeq, 0);
  assert.equal(sent.length, 0, 'held, never sent');
  const b2 = browser(); const q2 = gateQueue(); q2.refuse = true;
  const d = createCapture({ deps: b2.deps, api: { uploadChunk: async () => ({}) }, queue: q2, sessionId: 2, liveOn: false });
  await d.open(); d.start();
  await b2.recorders[0].finish();
  await d.discard();
  assert.equal(d.state.unsaved.size, 0);
});

// ── Through the recorder: no finish with a gap, and Retry recovers ──────────

const session = (status) => ({ id: 7, status, active_ms: 0, live_model: null, channel: 'in_person', final_model: 'whisper' });
function worker() {
  const calls = [];
  return {
    calls,
    api: {
      action: async (id, a) => { calls.push(['action', a]); return { session: session(a === 'stop' ? 'stopped' : 'recording') }; },
      finish: async (id, last, auto) => { calls.push(['finish', last]); return { session: session('stopped'), processing: { stage: 'done', done: null, total: null, error: null } }; },
      get: async () => ({ session: session('transcribed'), processing: { stage: 'done' } }),
      uploadChunk: async () => ({}), marks: async () => ({}), placements: async () => ({}), consent: async () => ({}),
      chunks: async () => ({ chunks: [] }),
    },
  };
}

test('the recorder does not call finish on a refused write; Retry writes it again and finishes with the persisted seq', async () => {
  const b = browser();
  const q = gateQueue(); q.refuse = true;
  const w = worker();
  const r = createRecorder({ api: w.api, browser: { ...b.deps, MediaRecorder: b.deps.MediaRecorder }, queue: q, setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: { ...session('draft'), status: 'draft' } });
  await b.recorders[0]?.finish?.();
  const first = await r.confirmStop({ auto: false });
  assert.equal(first, 'failed');
  assert.match(r.getSnapshot().processing.error, /could not be saved on this device/);
  assert.equal(w.calls.some((c) => c[0] === 'finish'), false, 'no finish with a gap');
  q.refuse = false;
  await r.retry?.();
  assert.deepEqual(w.calls.filter((c) => c[0] === 'finish'), [['finish', 0]]);
});
