/**
 * D685 §5.6 and §5.8 (#1588) — the recording that lives above the routes
 * (`lib/activeRecording.js`) and the capture under it (`lib/interviewCapture.js`):
 * the mic opened in the Start click, start posted only once granted, the video
 * call's two clicks and its audio-only mix, marks that wait offline, stop and
 * discard, continuing seqs, the 4402 budget close, and nothing reloading or
 * logging out under a running capture.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/recorder_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRecorder, elapsedMs, pillLabel, pillVariant } from '../src/lib/activeRecording.js';
import { BUDGET_CLOSE, LEVEL_MS, NO_SOUND_MS, createCapture, memoryQueue, nextSeq } from '../src/lib/interviewCapture.js';
import { isCapturing, setCaptureProbe, whenIdle } from '../src/lib/captureGuard.js';
import { FLASH_MS, flashLevel, runRing } from '../src/lib/ringViz.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function track(kind = 'audio') {
  const handlers = {};
  return { kind, stopped: 0, stop() { this.stopped += 1; }, addEventListener: (ev, fn) => { (handlers[ev] ||= []).push(fn); }, fire: (ev) => (handlers[ev] || []).forEach((f) => f()) };
}
function stream(tracks) {
  return { getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'), getVideoTracks: () => tracks.filter((t) => t.kind === 'video') };
}

/** A browser: every call is logged in `log`, in order. */
function fakeBrowser({ micDenied = false, shareFails = false, shareAudio = true, withWake = true, lateStop = false } = {}) {
  const log = [];
  const mic = track('audio');
  const disp = { a: track('audio'), v: track('video') };
  const recorders = [];
  class Ctx {
    constructor() { log.push('AudioContext'); this.sampleRate = 48000; }
    createMediaStreamSource(s) { return { s, connect: () => {} }; }
    createGain() { return { connect: () => {} }; }
    createMediaStreamDestination() { return { stream: 'MIXED-AUDIO' }; }
    createAnalyser() { return { fftSize: 0, connect: () => {} }; }
    close() { log.push('ctx.close'); }
  }
  class Rec {
    constructor(s) { this.s = s; this.state = 'inactive'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const fire = () => { this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); };
      // A real MediaRecorder fires onstop later, as an event, not inside stop().
      if (lateStop) setTimeout(fire, 5); else fire();
    }
  }
  const timers = [];
  return {
    log, mic, disp, recorders, timers,
    browser: {
      getUserMedia: async () => { log.push('getUserMedia'); if (micDenied) throw new Error('NotAllowed'); return stream([mic]); },
      getDisplayMedia: async () => { log.push('getDisplayMedia'); if (shareFails) throw new Error('cancelled'); return stream(shareAudio ? [disp.a, disp.v] : [disp.v]); },
      AudioContext: Ctx, MediaStream: function MS(t) { this.t = t; }, MediaRecorder: Rec, WebSocket: null,
      clearTimeout: () => {}, setInterval: (f, ms) => { timers.push(ms); return timers.length; }, clearInterval: () => {},
      wakeLock: withWake ? { request: async () => { log.push('wakeLock'); return { release() { log.push('wake.release'); } }; } } : undefined,
    },
  };
}

/** A Worker: every call is logged in `calls`, in order. */
function fakeApi(over = {}) {
  const calls = [];
  const session = (status, extra = {}) => ({ id: 7, status, active_ms: 0, live_model: null, channel: 'in_person', final_model: 'whisper', ...extra });
  return {
    calls,
    api: {
      action: async (id, a) => { calls.push(['action', a]); return { session: session({ start: 'recording', resume: 'recording', pause: 'paused', stop: 'stopped' }[a], { recording_since: null }) }; },
      mark: async (id, offset) => { calls.push(['mark', Math.round(offset)]); return {}; },
      uploadChunk: async (id, seq) => { calls.push(['chunk', seq]); return {}; },
      transcribe: async () => { calls.push(['transcribe']); return {}; },
      setConsent: async (id, status) => { calls.push(['consent', status]); return {}; },
      remove: async () => { calls.push(['remove']); return {}; },
      liveUrl: () => 'wss://x/live',
      ...over,
    },
    session,
  };
}
const draft = (extra = {}) => ({ id: 7, status: 'draft', active_ms: 0, channel: 'in_person', final_model: 'whisper', live_model: null, ...extra });

test('Start: the mic and the AudioContext are asked for in the click; start is posted only once the mic is granted', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r.prepare();
  assert.deepEqual(b.log, ['AudioContext'], 'the context is made in the click, synchronously');
  await tick();
  assert.deepEqual(b.log, ['AudioContext', 'getUserMedia'], 'and the mic is asked for before anything else is awaited');
  const out = await r.begin({ session: draft(), interview: { interviewee_name: 'Dana' }, callLabel: null });
  assert.equal(out, 'recording');
  assert.equal(b.log.filter((x) => x === 'getUserMedia').length, 1, 'the prepared mic is used, not asked for twice');
  assert.equal(b.log.filter((x) => x === 'AudioContext').length, 1, 'and the prepared context');
  assert.deepEqual(w.calls, [['action', 'start']]);
  assert.equal(r.getSnapshot().phase, 'recording');
  await tick();
  assert.ok(b.log.includes('wakeLock'), 'the screen lock is asked for while recording');
  assert.equal(r.isCapturing(), true);
});

test('a denied mic keeps the session a draft and shows the denied card; Try again asks again, and starts once granted', async () => {
  const b = fakeBrowser({ micDenied: true });
  const w = fakeApi();
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.begin({ session: draft() }), 'denied');
  assert.equal(r.getSnapshot().phase, 'denied');
  assert.deepEqual(w.calls, [], 'start is never posted for a mic that was refused');
  b.browser.getUserMedia = async () => { b.log.push('getUserMedia'); return stream([track()]); };
  assert.equal(await r.retryMic(), 'recording');
  assert.deepEqual(w.calls, [['action', 'start']]);
});

test('a video call: Start waits for the second click; sharing asks for the tab first, then the mic; the recorder takes the audio mix only', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.begin({ session: draft({ channel: 'video' }), video: true, callLabel: 'Video call · Zoom' }), 'share');
  assert.equal(r.getSnapshot().phase, 'share');
  assert.deepEqual(b.log, [], 'nothing is asked for until the founder shares');
  assert.equal(r.getSnapshot().callLabel, 'Video call · Zoom');
  await r.share();
  assert.deepEqual(b.log.slice(0, 2), ['getDisplayMedia', 'getUserMedia'], 'the share first, while the click is fresh');
  assert.equal(b.recorders[0].s, 'MIXED-AUDIO', 'the recorder is on the mixed audio stream, never the display stream (415)');
  assert.equal(r.getSnapshot().cap.shareNote, null);
  assert.ok(r.getSnapshot().cap.displayVideo, 'the tab feeds the tile');
  // Stop sharing mid-call: the mic keeps recording, and the note says so.
  b.disp.v.fire('ended');
  assert.equal(r.getSnapshot().cap.shareNote, 'not_shared');
  assert.equal(r.getSnapshot().cap.displayVideo, null);
  assert.equal(r.getSnapshot().phase, 'recording');
  await r.confirmStop();
  assert.equal(b.disp.a.stopped + b.disp.v.stopped, 2, 'stop() ends the display stream too');
});

test('a refused or audio-less share records the microphone only, with the note, never as a denied mic', async () => {
  for (const [opts, note] of [[{ shareFails: true }, 'not_shared'], [{ shareAudio: false }, 'no_audio']]) {
    const b = fakeBrowser(opts);
    const r = createRecorder({ api: fakeApi().api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
    await r.begin({ session: draft({ channel: 'video' }), video: true });
    assert.equal(await r.share(), 'recording');
    assert.equal(r.getSnapshot().cap.shareNote, note);
    assert.notEqual(r.getSnapshot().phase, 'denied');
  }
  const b = fakeBrowser();
  const r = createRecorder({ api: fakeApi().api, browser: { ...b.browser, getDisplayMedia: undefined }, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft({ channel: 'video' }), video: true });
  await r.share();
  assert.equal(r.getSnapshot().cap.shareNote, 'unsupported', 'a phone has no getDisplayMedia');
  const m = fakeBrowser();
  const r2 = createRecorder({ api: fakeApi().api, browser: m.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r2.begin({ session: draft({ channel: 'video' }), video: true });
  await r2.share({ micOnly: true });
  assert.ok(!m.log.includes('getDisplayMedia'), '"Record without the call\'s audio" never asks for the tab');
});

test('marks wait on this device when offline or refused, and replay on reconnect and before stop', async () => {
  const b = fakeBrowser();
  let fail = true;
  const w = fakeApi({ mark: async (id, o) => { if (fail) throw new Error('down'); w.calls.push(['mark', Math.round(o)]); return {}; } });
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft() });
  assert.equal(await r.mark(), 'queued', 'a refused mark is kept');
  fail = false;
  r.setOnline(false);
  w.calls.length = 0;
  assert.equal(await r.mark(), 'queued', 'offline, it is not even tried');
  assert.equal(w.calls.filter((c) => c[0] === 'mark').length, 0, 'nothing is sent while offline');
  fail = true;
  assert.equal(r.getSnapshot().marksQueued.length, 2);
  assert.ok(r.getSnapshot().toast, 'the toast shows either way');
  fail = false;
  r.setOnline(true);
  await tick(); await tick();
  assert.equal(r.getSnapshot().marksQueued.length, 0, 'replayed on reconnect');
  assert.equal(w.calls.filter((c) => c[0] === 'mark').length, 2);
  // A mark that waits until Stop is replayed before the stop is posted.
  fail = true; await r.mark(); fail = false;
  w.calls.length = 0;
  await r.confirmStop();
  const order = w.calls.map((c) => c.join(':')).filter((c) => !c.startsWith('chunk'));
  assert.deepEqual(order.slice(0, 2), [order.find((c) => c.startsWith('mark')), 'action:stop'], 'the waiting mark is sent, and before stop');
  assert.ok(order[0].startsWith('mark'));
});

test('Stop and process: stop, flush, transcribe; the pill turns "Ready to review" and nobody is navigated', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  let release;
  const gate = new Promise((res) => { release = res; });
  const transcribe = w.api.transcribe;
  w.api.transcribe = async (...a) => { await gate; return transcribe(...a); };
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft() });
  r.askStop();
  assert.equal(r.getSnapshot().confirm, true);
  r.cancelStop();
  assert.equal(r.getSnapshot().confirm, false, 'Keep recording');
  const done = r.confirmStop();
  await tick(); await tick();
  assert.equal(r.getSnapshot().phase, 'stopping');
  assert.equal(r.isCapturing(), true, 'still uploading: nothing may reload or log out yet');
  release();
  await done;
  assert.deepEqual(w.calls.map((c) => c.join(':')).filter((c) => !c.startsWith('chunk')), ['action:start', 'action:stop', 'transcribe']);
  assert.equal(r.getSnapshot().phase, 'ready');
  assert.equal(pillVariant(r.getSnapshot()), 'ready');
  assert.equal(r.isCapturing(), false);
  assert.ok(b.log.includes('wake.release'), 'the screen lock is let go');
});

test('Discard this recording: pause, consent withdrawn, then the session and its audio deleted; nothing queued is sent', async () => {
  const b = fakeBrowser({ lateStop: true });
  const w = fakeApi();
  const queue = memoryQueue();
  await queue.put({ sessionId: 7, seq: 3, blob: {}, startMs: 0 });
  const r = createRecorder({ api: w.api, browser: b.browser, queue, setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft() });
  w.calls.length = 0;
  assert.equal(await r.discard(), 'discarded');
  assert.deepEqual(w.calls.map((c) => c.join(':')), ['action:pause', 'consent:declined', 'remove'], 'and the slice being recorded is never uploaded');
  await new Promise((res) => setTimeout(res, 20)); // the recorder's late onstop has fired
  assert.deepEqual(await queue.list(7), [], 'what waited on the device for it is gone, and the last slice never lands');
  assert.equal(r.getSnapshot().phase, 'discarded');
});

test('a session left recording with no capture here is paused, and resumed by hand after the audio already saved', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  // The Worker answers with the session it holds: 90 s already recorded.
  w.api.action = async (id, a) => { w.calls.push(['action', a]); return { session: w.session(a === 'pause' ? 'paused' : 'recording', { active_ms: 90000, recording_since: null }) }; };
  const queue = memoryQueue();
  await queue.put({ sessionId: 7, seq: 6, blob: {}, startMs: 0 });
  const r = createRecorder({ api: w.api, browser: b.browser, queue, setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.adopt({ session: draft({ status: 'recording', active_ms: 90000 }), storedSeqs: [0, 1, 2, 3, 4] }), 'paused');
  assert.deepEqual(w.calls, [['action', 'pause']], 'never left recording without a microphone');
  assert.equal(await r.resume(), 'recording');
  assert.deepEqual(w.calls.slice(-1), [['action', 'resume']]);
  assert.equal(r.capture.state.seq, 8, 'one past the highest stored (4) or queued (6) seq: 7 was taken by the first slice');
  assert.equal(nextSeq([0, 1, 2], [6]), 7);
  assert.equal(nextSeq([], []), 0);
  assert.equal(r.capture.offsetMs() >= 90000, true, 'offsets continue from active_ms');
});

test('sign-out stops the capture and sends nothing more under another member', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  const queue = memoryQueue();
  const r = createRecorder({ api: w.api, browser: b.browser, queue, setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft() });
  await queue.put({ sessionId: 7, seq: 9, blob: {}, startMs: 0 });
  await r.signOut();
  assert.equal(w.calls.some((c) => c[0] === 'chunk'), false, 'the queued chunk stays on the device');
  assert.equal(r.getSnapshot().session, null);
  assert.equal(b.mic.stopped, 1, 'the microphone is released');
});

test('the capture: 30 s of silence is "no sound", read every 250 ms; a lost mic track shows at once', async () => {
  assert.equal(NO_SOUND_MS, 30000);
  assert.equal(LEVEL_MS, 250);
  const b = fakeBrowser();
  const states = [];
  let now = 1000;
  const c = createCapture({ deps: { ...b.browser, now: () => now, setTimeout: (f, ms) => (ms ? 0 : f()) }, api: { uploadChunk: async () => ({}) }, queue: memoryQueue(), sessionId: 1, liveOn: false, onState: (s) => states.push(s) });
  await c.open();
  c.start();
  assert.deepEqual(b.timers, [250], 'a level check every 250 ms, not at chunk boundaries');
  now += 31000;
  c.flush && null;
  b.mic.fire('ended');
  assert.equal(states.at(-1).mic, 'ended');
  assert.ok(states.at(-1).silentMs >= 30000);
});

test('the relay\'s 4402 close stops captions for good: the socket is never reopened', async () => {
  const sockets = [];
  function WS() { this.sent = []; sockets.push(this); this.send = () => {}; this.close = () => {}; }
  let t = 0;
  const states = [];
  const c = createCapture({
    deps: { getUserMedia: async () => stream([track()]), WebSocket: WS, now: () => (t += 10), setTimeout: (f, ms) => (ms ? 0 : f()), clearTimeout: () => {}, liveUrl: 'wss://x' },
    api: { uploadChunk: async () => ({}) }, queue: memoryQueue(), sessionId: 1, liveOn: true, onState: (s) => states.push(s),
  });
  await c.open(); c.start();
  assert.equal(sockets.length, 1);
  assert.equal(BUDGET_CLOSE, 4402);
  sockets[0].onclose({ code: 4402 });
  assert.equal(states.at(-1).budget, true);
  c.setLive(true); c.reconnect(); c.pause(); c.resume();
  assert.equal(sockets.length, 1, 'neither showing captions, nor reconnecting, nor resuming reopens it');
  // An ordinary close is reopened on reconnect.
  const s2 = [];
  function WS2() { s2.push(this); this.send = () => {}; this.close = () => {}; }
  const c2 = createCapture({ deps: { getUserMedia: async () => stream([track()]), WebSocket: WS2, now: () => (t += 10), setTimeout: (f, ms) => (ms ? 0 : f()), clearTimeout: () => {}, liveUrl: 'x' }, api: { uploadChunk: async () => ({}) }, queue: memoryQueue(), sessionId: 2, liveOn: true });
  await c2.open(); c2.start();
  s2[0].onclose({ code: 1006 });
  c2.reconnect();
  assert.equal(s2.length, 2, 'back online, the live socket reopens');
});

test('nothing reloads or logs out under a running capture', async () => {
  let capturing = true;
  setCaptureProbe(() => capturing);
  assert.equal(isCapturing(), true);
  const ran = [];
  const timers = [];
  whenIdle(() => ran.push('reload'), { every: 10, setTimer: (f) => timers.push(f) });
  assert.deepEqual(ran, [], 'the reload waits');
  capturing = false;
  timers.shift()();
  assert.deepEqual(ran, ['reload'], 'and runs once the capture ends');
  setCaptureProbe(null);
  assert.equal(isCapturing(), false);
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /enabled: !!user && !activeRecorder\.isCapturing\(\),/, 'the inactivity logout is suspended');
  assert.match(readFileSync('frontend/src/lib/pwa.js', 'utf8'), /reloadWithinBudget\(SW_RELOAD_KEY, SW_RELOAD_PARAM, MAX_SW_RELOADS, whenIdle\)/);
  assert.match(readFileSync('frontend/src/components/RouteErrorBoundary.jsx', 'utf8'), /reloadWithinBudget\(RELOAD_GUARD_KEY, RELOAD_GUARD_PARAM, MAX_BOUNDARY_RELOADS, whenIdle\)/);
});

test('the pill\'s variants and accessible names, and the timer from the Worker\'s fields', () => {
  const s = { id: 7, status: 'recording', active_ms: 60000, recording_since: '2026-10-13 10:00:00' };
  assert.equal(elapsedMs(s, Date.parse('2026-10-13T10:00:30Z')), 90000);
  assert.equal(elapsedMs({ ...s, status: 'paused' }, Date.parse('2026-10-13T10:00:30Z')), 60000, 'paused: active_ms alone');
  assert.equal(elapsedMs(null, 0), 0);
  assert.equal(pillVariant({ session: s, phase: 'recording', online: true, cap: {} }), 'recording');
  assert.equal(pillVariant({ session: s, phase: 'recording', online: false, cap: {} }), 'offline');
  assert.equal(pillVariant({ session: s, phase: 'paused', cap: {} }), 'paused');
  assert.equal(pillVariant({ session: s, phase: 'stopping', cap: {} }), 'processing');
  assert.equal(pillVariant({ session: s, phase: 'ready', cap: {} }), 'ready');
  assert.equal(pillVariant({ session: null, phase: 'recording' }), null);
  assert.equal(pillLabel('recording', '00:01:30'), 'Recording · 00:01:30 · tap to expand');
  assert.equal(pillLabel('ready', ''), 'Ready to review · open the review');
});

test('the mark flash: fades over its length, and never under reduced motion; a paused ring keeps drawing until it fades', () => {
  assert.equal(flashLevel(0, false), 1);
  assert.equal(flashLevel(FLASH_MS / 2, false), 0.5);
  assert.equal(flashLevel(FLASH_MS, false), 0);
  assert.equal(flashLevel(10, true), 0, 'reduced motion: no flash');
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  let frames = 0;
  runRing({ ctx, size: { w: 100, h: 100 }, analyser: null, sampleRate: 48000, mode: 'paused', dark: false, reduced: false, progress: 0, raf: () => { frames += 1; return frames; }, caf: () => {}, now: () => 0, flashAt: 0 });
  assert.equal(frames, 1, 'a fading flash asks for one more frame even while paused');
});
