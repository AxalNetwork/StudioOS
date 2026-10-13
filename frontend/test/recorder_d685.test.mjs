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
import { POLL_MS, STAGE_KEYS, createRecorder, elapsedMs, pillLabel, pillVariant, processingProgress, stageIndex } from '../src/lib/activeRecording.js';
import { BUDGET_CLOSE, LEVEL_MS, NO_SOUND_MS, createCapture, memoryQueue, nextSeq } from '../src/lib/interviewCapture.js';
import { isCapturing, setCaptureProbe, whenIdle } from '../src/lib/captureGuard.js';
import { FLASH_MS, INDETERMINATE_SWEEP, flashLevel, runRing, stoppingArc } from '../src/lib/ringViz.js';

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

/** A Worker whose session read walks through `reads`, one per poll (the last repeats). */
function processingApi(reads, over = {}) {
  const w = fakeApi(over);
  let i = 0;
  w.api.finish = async (id, lastSeq, auto) => { w.calls.push(['finish', lastSeq, auto]); return { ok: true, processing: { stage: 'uploading', done: 0, total: lastSeq + 1, error: null }, queued: false }; };
  w.api.process = async () => { w.calls.push(['process']); return { ok: true, processing: { stage: 'transcribing', done: 1, total: 2, error: null } }; };
  w.api.get = async () => {
    w.calls.push(['get']);
    const p = reads[Math.min(i, reads.length - 1)]; i += 1;
    if (p instanceof Error) throw p;
    return { session: w.session(p?.stage === 'done' ? 'transcribed' : 'stopped'), processing: p };
  };
  return w;
}
const P = (stage, done = null, total = null, error = null, stale = false) => ({ stage, done, total, error, stale });

test('Stop and process: stop, flush, finish with the last seq recorded, then the Worker\'s stages to done; nobody is navigated', async () => {
  const b = fakeBrowser();
  const w = processingApi([P('uploading', 1, 2), P('transcribing', 1, 2), P('summarising'), P('placing'), P('done')]);
  const seen = [];
  let r;
  const wait = async () => { const x = r.getSnapshot(); seen.push([x.processing?.stage, x.stageAt, x.processing?.done ?? null, r.isCapturing()]); };
  r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait });
  await r.begin({ session: draft() });
  r.askStop();
  assert.equal(r.getSnapshot().confirm, true);
  r.cancelStop();
  assert.equal(r.getSnapshot().confirm, false, 'Keep recording');
  const pending = r.confirmStop();
  assert.equal(r.getSnapshot().phase, 'stopping');
  assert.equal(r.isCapturing(), true, 'still leaving this device: nothing may reload or log out yet');
  assert.equal(await pending, 'done');
  const calls = w.calls.map((c) => c.join(':')).filter((c) => !c.startsWith('chunk'));
  assert.deepEqual(calls.slice(0, 3), ['action:start', 'action:stop', 'finish:0:true'], 'finish names the last seq queued, after the flush');
  assert.ok(w.calls.findIndex((c) => c[0] === 'chunk') < w.calls.findIndex((c) => c[0] === 'finish'), 'the last slice is uploaded before finish');
  assert.equal(calls.filter((c) => c === 'get').length, 5, 'polled until done');
  assert.deepEqual(seen.map((x) => x[1]), [0, 1, 2, 3], 'each stage in turn, from the Worker');
  assert.deepEqual(seen.map((x) => x[2]), [1, 1, null, null], 'a count only where the Worker keeps one');
  assert.deepEqual(seen.map((x) => x[3]), [true, false, false, false], 'only uploading holds a reload: the rest runs on the Worker');
  assert.equal(r.getSnapshot().phase, 'ready');
  assert.equal(pillVariant(r.getSnapshot()), 'ready');
  assert.equal(r.isCapturing(), false);
  assert.ok(b.log.includes('wake.release'), 'the screen lock is let go');
});

test('the honest ring: a fraction only while uploading or transcribing, from the Worker\'s counts; none for summarising or placing', () => {
  assert.equal(processingProgress(P('uploading', 3, 4)), 0.75);
  assert.equal(processingProgress(P('transcribing', 1, 4)), 0.25);
  assert.equal(processingProgress(P('transcribing', 9, 4)), 1, 'never past full');
  assert.equal(processingProgress(P('uploading', null, null)), null, 'before finish answers: no number');
  assert.equal(processingProgress(P('uploading', 0, 0)), null, 'no total, no fraction');
  assert.equal(processingProgress(P('summarising', 3, 4)), null, 'summarising has no count, whatever the row holds');
  assert.equal(processingProgress(P('placing')), null);
  assert.equal(processingProgress(null), null);
  assert.deepEqual(STAGE_KEYS, ['uploading', 'transcribing', 'summarising', 'placing']);
  assert.equal(stageIndex(P('placing')), 3);
  assert.equal(stageIndex(P('done')), 4);
  assert.equal(stageIndex(P('failed'), 1), 1, 'a failure keeps the stage it reached');
  assert.equal(POLL_MS, 2000);
});

test('Manual mode sends auto: false; a recording with no audio fails in words and never calls finish', async () => {
  const w = processingApi([P('done')]);
  const r = createRecorder({ api: w.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  await r.begin({ session: draft() });
  await r.confirmStop({ auto: false });
  assert.deepEqual(w.calls.find((c) => c[0] === 'finish'), ['finish', 0, false]);
  const w2 = processingApi([P('done')]);
  const r2 = createRecorder({ api: w2.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  await r2.adopt({ session: draft({ status: 'paused' }) });
  assert.equal(await r2.confirmStop(), 'failed');
  assert.equal(r2.getSnapshot().processing.error, 'No audio was recorded, so there is nothing to process.');
  assert.equal(w2.calls.some((c) => c[0] === 'finish'), false);
});

test('a failure shows the Worker\'s sentence, and Retry resumes: the step that failed, or the Worker\'s run once finish was taken', async () => {
  const w = processingApi([P('transcribing', 1, 2), P('failed', 1, 2, 'The recording could not be read. Nothing was transcribed.'), P('summarising'), P('done')]);
  const r = createRecorder({ api: w.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  await r.begin({ session: draft() });
  assert.equal(await r.confirmStop(), 'failed');
  assert.equal(r.getSnapshot().phase, 'stopping', 'the processing view stays, with the sentence');
  assert.equal(r.getSnapshot().processing.error, 'The recording could not be read. Nothing was transcribed.');
  assert.equal(r.getSnapshot().stageAt, 1, 'the chips stay on the stage reached');
  assert.equal(pillVariant(r.getSnapshot()), 'failed');
  assert.equal(pillLabel('failed', ''), 'Processing stopped · tap to retry');
  assert.equal(await r.retry(), 'done');
  const after = w.calls.map((c) => c[0]);
  assert.equal(after.filter((c) => c === 'finish').length, 1, 'finish was taken: not sent again');
  assert.equal(after.filter((c) => c === 'action').length, 2, 'start and one stop, never a second stop');
  assert.ok(after.includes('process'), 'the Worker resumes from the stage it reached');

  // finish refused: Retry sends finish again, and nothing before it.
  const w2 = processingApi([P('done')]);
  let refuse = true;
  const finish = w2.api.finish;
  w2.api.finish = async (...a) => { if (refuse) { w2.calls.push(['finish-refused']); throw new Error('Network down.'); } return finish(...a); };
  const r2 = createRecorder({ api: w2.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  await r2.begin({ session: draft() });
  assert.equal(await r2.confirmStop(), 'failed');
  assert.equal(r2.getSnapshot().processing.error, 'Network down.');
  refuse = false;
  assert.equal(await r2.retry(), 'done');
  assert.deepEqual(w2.calls.map((c) => c[0]).filter((c) => c !== 'chunk' && c !== 'get'), ['action', 'action', 'finish-refused', 'finish']);
  assert.equal(w2.calls.some((c) => c[0] === 'process'), false);
});

test('a dropped read keeps polling; a stale run fails in words; a chunk left on the device is sent while uploading', async () => {
  const queue = memoryQueue();
  const w = processingApi([new Error('offline'), P('uploading', 0, 1), P('done')]);
  // The network is down until the first wait between reads: the flushes before
  // finish and in the first pass fail, and the chunk stays queued.
  let failUpload = true;
  const r = createRecorder({ api: w.api, browser: fakeBrowser().browser, queue, setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => { failUpload = false; } });
  await r.adopt({ session: draft({ status: 'stopped' }), storedSeqs: [] });
  await queue.put({ sessionId: 7, seq: 0, blob: {}, startMs: 0 });
  const up = w.api.uploadChunk;
  w.api.uploadChunk = async (...a) => { if (failUpload) throw new Error('offline'); return up(...a); };
  assert.equal(await r.confirmStop(), 'done');
  assert.deepEqual(w.calls.find((c) => c[0] === 'finish'), ['finish', 0, true], 'the queued seq is the last one');
  assert.ok(w.calls.some((c) => c[0] === 'chunk' && c[1] === 0), 'sent by the poll while the Worker waited for it');
  assert.deepEqual(await queue.list(7), []);

  const w2 = processingApi([P('transcribing', 1, 4, null, true)]);
  const r2 = createRecorder({ api: w2.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  await r2.begin({ session: draft() });
  assert.equal(await r2.confirmStop(), 'failed');
  assert.equal(r2.getSnapshot().processing.error, 'Processing has not moved for 15 minutes. Nothing was lost; try again.');
});

test('after a reload the view follows the Worker\'s processing state; sign-out ends the poll', async () => {
  const w = processingApi([P('placing'), P('done')]);
  const r = createRecorder({ api: w.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  const p = r.follow({ session: draft({ status: 'transcribed' }), interview: { id: 3, interviewee_name: 'Dana' }, processing: P('summarising') });
  assert.equal(r.getSnapshot().phase, 'stopping');
  assert.equal(r.getSnapshot().stageAt, 2, 'drawn from the Worker\'s stage, not from a Stop in this tab');
  assert.equal(r.isCapturing(), false, 'nothing is leaving this device');
  assert.equal(await p, 'done');
  assert.equal(r.getSnapshot().phase, 'ready');
  assert.equal(r.getSnapshot().interview.id, 3);
  const failed = createRecorder({ api: processingApi([]).api, browser: {}, queue: memoryQueue(), wait: async () => {} });
  assert.equal(await failed.follow({ session: draft({ status: 'stopped' }), processing: P('failed', null, null, 'No.') }), 'failed');
  assert.equal(failed.getSnapshot().processing.error, 'No.');

  let reads = 0;
  let r3;
  const w3 = processingApi([P('transcribing', 1, 9)]);
  const get = w3.api.get;
  w3.api.get = async (...a) => { reads += 1; if (reads === 2) await r3.signOut(); return get(...a); };
  r3 = createRecorder({ api: w3.api, browser: {}, queue: memoryQueue(), wait: async () => {} });
  assert.equal(await r3.follow({ session: draft({ status: 'stopped' }), processing: P('transcribing', 0, 9) }), 'cancelled');
  assert.equal(reads, 2, 'no read after the sign-out');
  assert.equal(r3.getSnapshot().session, null);
});

test('the processing arc: a count is drawn still from the top; no count turns a quarter arc, still under reduced motion', () => {
  const counted = stoppingArc(0.5, 3, false);
  assert.equal(counted.indeterminate, false);
  assert.equal(counted.start, -Math.PI / 2);
  assert.ok(Math.abs(counted.end - Math.PI / 2) < 1e-9, 'half a turn');
  const spin = stoppingArc(null, 1, false);
  assert.equal(spin.indeterminate, true);
  assert.ok(Math.abs((spin.end - spin.start) - Math.PI * 2 * INDETERMINATE_SWEEP) < 1e-9);
  assert.notEqual(stoppingArc(null, 2, false).start, spin.start, 'it turns with time');
  assert.equal(stoppingArc(null, 2, true).start, stoppingArc(null, 9, true).start, 'not under reduced motion');
  const frames = (progress, reduced) => {
    let asked = 0;
    const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
    const stop = runRing({ ctx, size: { w: 10, h: 10 }, analyser: null, mode: 'stopping', reduced, progress, raf: () => { asked += 1; return asked; }, caf: () => {}, now: () => 0 });
    stop();
    return asked;
  };
  assert.equal(frames(0.4, false), 0, 'a counted arc is one still frame');
  assert.equal(frames(null, false), 1, 'an indeterminate arc keeps drawing');
  assert.equal(frames(null, true), 0, 'and is one still frame under reduced motion');
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

test('a talking point is ticked at once, saved by the Worker under its own id, and put back when refused', async () => {
  const b = fakeBrowser();
  let refuse = false;
  let seen = null;
  const w = fakeApi({
    tickPoint: async (id, pointId, covered) => {
      w.calls.push(['tick', id, pointId, covered]);
      seen = r.getSnapshot().points.find((p) => p.id === pointId)?.covered;
      if (refuse) throw new Error('500');
      // The Worker answers with the whole list, as it now stands.
      return { points: [{ id: 88, text: 'H2', covered, covered_offset_ms: 4000 }, { id: 89, text: 'H1', covered: false, covered_offset_ms: null }], points_covered: covered ? 1 : 0 };
    },
  });
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.adopt({ session: draft({ status: 'paused' }), points: [{ id: 88, text: 'H2', covered: false }, { id: 89, text: 'H1', covered: false }] });
  assert.deepEqual(r.getSnapshot().points.map((p) => p.id), [88, 89], 'an adopted session keeps the read\'s points');
  assert.equal(await r.tick(88, true), 'saved');
  assert.deepEqual(w.calls.at(-1), ['tick', 7, 88, true]);
  assert.equal(seen, true, 'shown ticked before the Worker answers');
  assert.equal(r.getSnapshot().points[0].covered_offset_ms, 4000, 'the Worker\'s answer replaces the list');
  refuse = true;
  assert.equal(await r.tick(89, true), 'refused');
  assert.equal(r.getSnapshot().points.find((p) => p.id === 89).covered, false, 'a refused tick is put back');
  assert.equal(r.getSnapshot().pointError, 'That tick was not saved. Try again.');
  refuse = false;
  await r.tick(88, false);
  assert.equal(r.getSnapshot().pointError, null, 'the next tick clears the refusal');
  assert.equal(r.getSnapshot().points[0].covered, false);
  const client = readFileSync('frontend/src/lib/api/interviewSessions.js', 'utf8');
  assert.match(client, /tickPoint: \(id, pointId, covered\) => request\(`\$\{P\}\/sessions\/\$\{enc\(id\)\}\/points\/\$\{enc\(pointId\)\}`, \{\s*method: 'PUT', body: JSON\.stringify\(\{ covered: !!covered \}\),/);
  const worker = readFileSync('cloudflare-worker/src/routes/founder_validate_sessions.ts', 'utf8');
  assert.match(worker, /sessions\.put\('\/sessions\/:id\/points\/:pointId'/, 'the route it calls is mounted');
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
