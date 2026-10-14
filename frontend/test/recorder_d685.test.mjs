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
import { codeOnly } from './_codeOnly.mjs';
import { POLL_MS, STAGE_KEYS, createRecorder, elapsedMs, liveRefusal, pillLabel, pillVariant, processingProgress, stageIndex, startRefused } from '../src/lib/activeRecording.js';
import { layers, ringMode } from '../src/pages/founder/RecordingView.jsx';
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

test('#1587 a Start the Worker refuses is said in its words, never as a denied microphone; 409 session_active names the live recording', async () => {
  const b = fakeBrowser();
  const refusal = Object.assign(new Error('You are already recording another session. Stop it, or return to it, first.'), { status: 409, code: 'session_active', data: { error: 'session_active', session_id: 88 } });
  const w = fakeApi({ action: async (id, a) => { w.calls.push(['action', a]); throw refusal; } });
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.begin({ session: draft() }), 'refused');
  const st = r.getSnapshot();
  assert.deepEqual(st.refused, { text: 'You are already recording another session. Stop it, or return to it, first.', sessionId: 88 });
  assert.deepEqual(layers(st), { ...layers(st), refused: true, denied: false }, 'the refused card, not the microphone\'s');
  assert.equal(ringMode(layers(st)), 'paused');
  // Another refusal: its words, and no recording to return to.
  assert.deepEqual(startRefused(Object.assign(new Error('Record consent first.'), { status: 409, code: 'consent_required', data: { session_id: 88 } })), { text: 'Record consent first.', sessionId: null });
  assert.deepEqual(startRefused({}), { text: 'The recording could not start.', sessionId: null });
  // A refused microphone is still the microphone's card.
  const b2 = fakeBrowser({ micDenied: true });
  const r2 = createRecorder({ api: fakeApi().api, browser: b2.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r2.begin({ session: draft() });
  assert.equal(r2.getSnapshot().refused, null);
  assert.equal(layers(r2.getSnapshot()).denied, true);
  // Started after all: the refusal is cleared.
  const w3 = fakeApi();
  let first = true;
  const action = w3.api.action;
  w3.api.action = async (id, a) => { if (first) { first = false; throw refusal; } return action(id, a); };
  const r3 = createRecorder({ api: w3.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r3.begin({ session: draft() });
  assert.equal(await r3.retryMic(), 'recording');
  assert.equal(r3.getSnapshot().refused, null);
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
    // Past the script, the run reads as done: a poll that ignores a stale or
    // failed stage then ends in the wrong state instead of spinning forever.
    const p = i < reads.length + 20 ? reads[Math.min(i, reads.length - 1)] : P('done'); i += 1;
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

test('the client posts finish with last_seq and auto, process and summarise, to #1605\'s mounted routes', () => {
  const client = readFileSync('frontend/src/lib/api/interviewSessions.js', 'utf8');
  assert.match(client, /finish: \(id, lastSeq, auto = true\) => request\(`\$\{P\}\/sessions\/\$\{enc\(id\)\}\/finish`, \{\s*method: 'POST', body: JSON\.stringify\(\{ last_seq: lastSeq, auto: auto !== false \}\),/);
  assert.match(client, /process: \(id\) => request\(`\$\{P\}\/sessions\/\$\{enc\(id\)\}\/process`, \{ method: 'POST'/);
  assert.match(client, /summarise: \(id, model\) => request\(`\$\{P\}\/sessions\/\$\{enc\(id\)\}\/summarise`/);
  const worker = readFileSync('cloudflare-worker/src/routes/founder_validate_sessions.ts', 'utf8');
  for (const r of ['finish', 'process', 'summarise']) assert.match(worker, new RegExp(`sessions\\.post\\('/sessions/:id/${r}'`), r);
  assert.match(worker, /body\?\.auto !== false/, 'the Worker reads auto the same way');
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
  assert.equal(w.calls.some((c) => c[0] === 'action'), false, 'already stopped: no second stop is posted');

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
  // #1588: nothing recording, never "recording".
  assert.equal(pillVariant({ session: s, phase: 'share', cap: {} }), 'share');
  assert.equal(pillVariant({ session: s, phase: 'denied', refused: null, cap: {} }), 'blocked');
  assert.equal(pillVariant({ session: s, phase: 'denied', refused: { text: 'No.' }, cap: {} }), 'refused');
  assert.equal(pillVariant({ session: s, phase: 'share', online: false, cap: {} }), 'share', 'offline says nothing about a tab not yet shared');
  assert.equal(pillLabel('share', '00:00'), 'Not recording yet · share the call\'s tab · tap to expand');
  assert.equal(pillLabel('blocked', '00:00'), 'Not recording · the microphone is blocked · tap to expand');
  assert.equal(pillLabel('refused', '00:00'), 'Not recording · the recording did not start · tap to expand');
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

// ------------------------------------------------- #1588: recovery on load, the lock, marks' keys

import { joinHref, lockName, markKey } from '../src/lib/activeRecording.js';

/** Web Locks with one holder per name; `held` names another tab's locks. */
function fakeLocks(held = []) {
  const taken = new Map(held.map((n) => [n, 'other']));
  const asked = [];
  return {
    asked, taken,
    locks: {
      request(name, opts, cb) {
        const fn = typeof opts === 'function' ? opts : cb;
        const ifAvailable = typeof opts === 'object' && opts?.ifAvailable;
        asked.push([name, ifAvailable ? 'ifAvailable' : 'hold']);
        if (ifAvailable) return Promise.resolve(fn(taken.has(name) ? null : { name }));
        taken.set(name, 'this');
        return Promise.resolve(fn({ name })).finally(() => taken.delete(name));
      },
    },
  };
}

test('#1588 a mark carries a client_key the Worker accepts, made once: its replay sends the same key', async () => {
  for (const [id, off] of [[7, 1234.6], ['12', 0], [7, -5]]) {
    const k = markKey(id, off);
    assert.match(k, /^[A-Za-z0-9_-]{1,80}$/, `${k} is in the Worker's alphabet`);
    assert.doesNotMatch(k, /:/);
  }
  assert.notEqual(markKey(7, 1000), markKey(7, 1000), 'two marks in the same millisecond are two');
  assert.equal(markKey(7, 1000.4, () => 'ab:c'), 'm7-1000-abc');
  const sent = [];
  let down = true;
  const w = fakeApi({ mark: async (id, o, label, key) => { if (down) throw new Error('down'); sent.push([id, Math.round(o), key]); return {}; } });
  const r = createRecorder({ api: w.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  await r.begin({ session: draft() });
  assert.equal(await r.mark(), 'queued');
  const key = r.getSnapshot().marksQueued[0].key;
  assert.match(key, /^m7-\d+-[a-z0-9]+$/);
  down = false;
  r.setOnline(true);
  await tick();
  assert.deepEqual(sent.map((x) => x[2]), [key], 'the replay is the same mark');
  assert.equal(await r.mark(), 'sent');
  assert.match(sent[1][2], /^m7-/, 'an online mark sends its key too');
  assert.notEqual(sent[1][2], key);
});

test('#1588 queued chunks are tagged with the member, and only theirs are listed', async () => {
  const q = memoryQueue();
  await q.put({ sessionId: 3, seq: 0, blob: 'a', startMs: 0, userId: 7 });
  await q.put({ sessionId: 4, seq: 0, blob: 'b', startMs: 0, userId: 7 });
  await q.put({ sessionId: 5, seq: 0, blob: 'c', startMs: 0, userId: 9 });
  assert.deepEqual((await q.sessions(7)).sort(), [3, 4]);
  assert.deepEqual(await q.sessions(9), [5]);
  // The capture writes the tag.
  const b = fakeBrowser();
  const r = createRecorder({ api: fakeApi().api, browser: b.browser, queue: q, setTimeout: (f, ms) => (ms ? 0 : f()) });
  r.setUser(7);
  await r.begin({ session: draft({ id: 21 }) });
  await r.capture.stop({ flush: false });
  await tick();
  assert.deepEqual((await q.sessions(7)).sort((x, y) => x - y), [3, 4, 21]);
  assert.ok((await q.sessions(7)).includes(21), 'the new chunk is tagged with member 7');
  assert.equal((await q.sessions(9)).includes(21), false);
});

test('#1588 the capturing tab holds rec-<id>; Stop, Discard and sign-out let it go', async () => {
  const L = fakeLocks();
  const r = createRecorder({ api: fakeApi().api, browser: { ...fakeBrowser().browser, locks: L.locks }, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(lockName(7), 'rec-7');
  await r.begin({ session: draft() });
  assert.deepEqual(L.asked, [['rec-7', 'hold']]);
  assert.equal(L.taken.get('rec-7'), 'this');
  await r.signOut();
  await tick();
  assert.equal(L.taken.has('rec-7'), false, 'released on sign-out');
  // No Web Locks (an old browser): nothing breaks.
  const plain = createRecorder({ api: fakeApi().api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await plain.begin({ session: draft() }), 'recording');
});

const ACTIVE = (over = {}) => ({ id: 7, status: 'recording', interview_id: 30, interviewee_name: 'Dana', interviewee_company: 'Acme', channel: 'video', call_label: 'Video call · Zoom', active_ms: 5000, recording_since: '2026-10-14T10:00:00Z', chunk_seqs: [0, 1], processing: null, ...over });
const FULL = { session: { id: 7, status: 'recording', channel: 'video', active_ms: 5000, live_model: null, interview_id: 30 }, interview: { id: 30, interviewee_name: 'Dana', interviewee_company: 'Acme' }, call_label: 'Video call · Zoom', meeting_url: 'https://acme.zoom.us/j/1', points: [{ id: 88, text: 'H2', covered: false }], chunks: [{ seq: 0 }, { seq: 1 }] };

test('#1588 recovery on load: what this member queued is flushed, and the recording in flight comes back paused with the Worker\'s label', async () => {
  const q = memoryQueue();
  await q.put({ sessionId: 3, seq: 0, blob: 'a', startMs: 0, userId: 7 });
  await q.put({ sessionId: 5, seq: 0, blob: 'c', startMs: 0, userId: 9 });
  const L = fakeLocks();
  const w = fakeApi({
    active: async () => ({ items: [ACTIVE()] }),
    get: async (id) => { w.calls.push(['get', id]); return FULL; },
    uploadChunk: async (id, seq) => { w.calls.push(['chunk', id, seq]); return {}; },
  });
  const r = createRecorder({ api: w.api, browser: { ...fakeBrowser().browser, locks: L.locks }, queue: q, setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.recover(), 'skipped', 'no member, nothing is read');
  r.setUser(7);
  assert.equal(await r.recover(), 'restored');
  assert.deepEqual(w.calls.filter((c) => c[0] === 'chunk'), [['chunk', 3, 0]], 'member 9\'s chunk never flushes under member 7');
  assert.ok(L.asked.length > 0 && L.asked.every(([n, how]) => n === 'rec-7' && how === 'ifAvailable'), 'asked, never held: a probe (recovery\'s, and adopt\'s own)');
  assert.deepEqual(w.calls.filter((c) => c[0] === 'action'), [['action', 'pause']], 'a recording with no capture here is paused');
  const st = r.getSnapshot();
  assert.equal(st.phase, 'paused');
  assert.equal(st.callLabel, 'Video call · Zoom', 'the Worker\'s label, kept after a reload');
  assert.equal(st.meetingUrl, 'https://acme.zoom.us/j/1');
  assert.deepEqual(st.storedSeqs, [0, 1], 'a resume continues after the stored seqs');
  assert.deepEqual(st.points.map((p) => p.id), [88]);
  assert.equal(st.interview.interviewee_name, 'Dana');
  assert.equal(await r.recover(), 'skipped', 'a tab holding a session is left alone');
});

test('#1588 recovery never pauses a recording another tab holds; a processing session is followed', async () => {
  const L = fakeLocks(['rec-7']);
  const w = fakeApi({ active: async () => ({ items: [ACTIVE()] }), get: async () => { throw new Error('never'); } });
  const r = createRecorder({ api: w.api, browser: { ...fakeBrowser().browser, locks: L.locks }, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r.setUser(7);
  assert.equal(await r.recover(), 'other_tab');
  assert.deepEqual(w.calls, [], 'no pause, no read');
  assert.equal(r.getSnapshot().session, null);

  const busy = ACTIVE({ id: 9, status: 'stopped', processing: { stage: 'transcribing', done: 1, total: 3, error: null } });
  const w2 = fakeApi({ active: async () => ({ items: [busy] }), get: async () => ({ session: { id: 9, status: 'stopped' }, processing: { stage: 'done' } }) });
  const r2 = createRecorder({ api: w2.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()), wait: async () => {} });
  r2.setUser(7);
  assert.equal(await r2.recover(), 'following');
  assert.equal(r2.getSnapshot().session.id, 9);
  assert.equal(r2.getSnapshot().callLabel, 'Video call · Zoom');
  assert.equal(r2.getSnapshot().interview.interviewee_company, 'Acme');

  const w3 = fakeApi({ active: async () => { throw new Error('offline'); } });
  const r3 = createRecorder({ api: w3.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r3.setUser(7);
  assert.equal(await r3.recover(), 'unread');
  // A paused session comes back too, paused, with nothing posted.
  const w5 = fakeApi({ active: async () => ({ items: [ACTIVE({ status: 'paused' })] }), get: async () => ({ ...FULL, session: { ...FULL.session, status: 'paused' } }) });
  const r5 = createRecorder({ api: w5.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r5.setUser(7);
  assert.equal(await r5.recover(), 'restored');
  assert.equal(r5.getSnapshot().phase, 'paused');
  assert.deepEqual(w5.calls.filter((c) => c[0] === 'action'), [], 'already paused: no pause is posted');
  const w4 = fakeApi({ active: async () => ({ items: [] }) });
  const r4 = createRecorder({ api: w4.api, browser: fakeBrowser().browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r4.setUser(7);
  assert.equal(await r4.recover(), 'none');
});

test('#1588 the provider runs recovery for the signed-in member; the client reads /sessions/active and sends the mark\'s key', async () => {
  const ctx = readFileSync('frontend/src/contexts/ActiveRecordingContext.jsx', 'utf8');
  assert.match(ctx, /r\.setUser\(userId\);\n    r\.recover\(\)/);
  assert.match(ctx, /locks: nav\.locks,/);
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body ? JSON.parse(init.body) : undefined });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { interviewSessionsApi } = await import('../src/lib/api/interviewSessions.js');
    await interviewSessionsApi.active();
    await interviewSessionsApi.mark(7, 1234.6, undefined, 'm7-1235-ab');
    await interviewSessionsApi.mark(7, 50);
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /founder/validate/sessions/active', 'POST /founder/validate/sessions/7/marks', 'POST /founder/validate/sessions/7/marks']);
  assert.deepEqual(calls[1].body, { offset_ms: 1235, client_key: 'm7-1235-ab' }, 'a whole number of milliseconds, as the Worker takes');
  assert.deepEqual(calls[2].body, { offset_ms: 50 });
});

test('#1588 a meeting link the view may open is https only; the recorder knows whether a tab can be shared', () => {
  assert.equal(joinHref('https://acme.zoom.us/j/1'), 'https://acme.zoom.us/j/1');
  assert.equal(joinHref('http://acme.zoom.us/j/1'), null);
  assert.equal(joinHref('javascript:alert(1)'), null);
  assert.equal(joinHref(null), null);
  const r = createRecorder({ api: fakeApi().api, browser: fakeBrowser().browser, queue: memoryQueue() });
  assert.equal(r.canShareTab, true);
  const phone = createRecorder({ api: fakeApi().api, browser: { ...fakeBrowser().browser, getDisplayMedia: undefined }, queue: memoryQueue() });
  assert.equal(phone.canShareTab, false, 'a phone cannot share a tab');
  // The lightbox's link is kept for the share step; anything but https is not.
  const v = createRecorder({ api: fakeApi().api, browser: fakeBrowser().browser, queue: memoryQueue() });
  return v.begin({ session: draft({ channel: 'video' }), video: true, meetingUrl: 'https://acme.zoom.us/j/1' }).then(async () => {
    assert.equal(v.getSnapshot().meetingUrl, 'https://acme.zoom.us/j/1');
    await v.begin({ session: draft({ channel: 'video' }), video: true, meetingUrl: 'http://acme.zoom.us/j/1' });
    assert.equal(v.getSnapshot().meetingUrl, null, 'a second Start at the share step replaces it: no microphone was open');
  });
});

test('#1588 a second Start while a capture is live is refused, and the live one keeps its microphone, its session and its capture', async () => {
  const b = fakeBrowser();
  const w = fakeApi();
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  assert.equal(await r.begin({ session: draft() }), 'recording');
  const live = r.capture;
  // "Record a session" on another row, or another draft's Start: the click prepares its own mic, then hands over.
  const second = track();
  b.browser.getUserMedia = async () => stream([second]);
  r.prepare();
  await tick();
  assert.equal(await r.begin({ session: draft({ id: 9 }) }), 'busy');
  const st = r.getSnapshot();
  assert.equal(st.session.id, 7, 'the live session stays');
  assert.equal(st.phase, 'recording');
  assert.equal(r.capture, live, 'and its capture, which can still be stopped');
  assert.equal(b.mic.stopped, 0, 'its microphone runs on');
  await tick();
  assert.equal(second.stopped, 1, 'the microphone opened for the refused Start is let go');
  assert.equal(r.isCapturing(), true, 'so the reload and logout guards keep holding off');
  assert.deepEqual(w.calls, [['action', 'start']], 'nothing is posted for the second session');
  assert.equal(await r.adopt({ session: { id: 9, status: 'recording' } }), 'busy', 'nor does Resume here replace it');
  assert.deepEqual(w.calls, [['action', 'start']], 'and no pause is posted');
  assert.deepEqual(liveRefusal(st, true), { text: 'You are already recording another session. Stop it, or return to it, first.', sessionId: 7 });
  assert.match(liveRefusal({ ...st, phase: 'stopping' }, true).text, /still being saved/);
  assert.equal(liveRefusal(st, false), null, 'nothing captured, nothing refused');
  assert.equal(liveRefusal({ phase: 'idle', session: null }, true), null);
  // Once stopped and handed to the Worker, a new Start is allowed again.
  w.api.finish = async () => ({ processing: { stage: 'transcribing', done: 0, total: 1, error: null } });
  w.api.get = async () => ({ session: { id: 7, status: 'transcribed' }, processing: { stage: 'done' } });
  await r.confirmStop();
  assert.equal(r.isCapturing(), false);
  assert.equal(await r.begin({ session: draft({ id: 9 }) }), 'recording');
  assert.equal(r.getSnapshot().session.id, 7, 'the Worker\'s answer (the fake says 7) replaces the draft');
});

test('#1588 Resume here never pauses a recording another tab is capturing: adopt probes rec-<id> first', async () => {
  const L = fakeLocks(['rec-7']);
  const w = fakeApi();
  const r = createRecorder({ api: w.api, browser: { ...fakeBrowser().browser, locks: L.locks }, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  for (const status of ['recording', 'paused']) {
    assert.equal(await r.adopt({ session: { id: 7, status, channel: 'in_person' } }), 'other_tab', status);
    assert.deepEqual(w.calls, [], `${status}: no pause posted, so the other tab's capture is untouched`);
    assert.equal(r.getSnapshot().session, null, 'and this tab takes nothing');
  }
  assert.deepEqual(L.asked.at(-1), ['rec-7', 'ifAvailable'], 'asked without waiting');
  // Once the other tab lets it go, this tab adopts it, paused.
  L.taken.delete('rec-7');
  assert.equal(await r.adopt({ session: { id: 7, status: 'recording', channel: 'in_person' } }), 'paused');
  assert.deepEqual(w.calls, [['action', 'pause']]);
  // A draft has no capture anywhere: no probe needed, nothing refused.
  const r2 = createRecorder({ api: fakeApi().api, browser: { ...fakeBrowser().browser, locks: fakeLocks(['rec-8']).locks }, queue: memoryQueue() });
  assert.equal(await r2.adopt({ session: { id: 8, status: 'draft', channel: 'in_person' } }), 'idle');
});

test('#1588 every Start opens the mic inside its own click, not only the first: the prepared mic is used once, then forgotten', async () => {
  const b = fakeBrowser();
  const w = fakeApi({
    finish: async () => ({ processing: { stage: 'transcribing', done: 0, total: 1, error: null } }),
    get: async () => ({ session: { id: 7, status: 'transcribed' }, processing: { stage: 'done' } }),
  });
  const r = createRecorder({ api: w.api, browser: b.browser, queue: memoryQueue(), setTimeout: (f, ms) => (ms ? 0 : f()) });
  r.prepare();
  await tick();
  assert.equal(await r.begin({ session: draft() }), 'recording');
  await r.confirmStop();
  r.clear();
  b.log.length = 0;
  // The second Start, after a Stop: its click asks again, synchronously for the context.
  r.prepare();
  assert.deepEqual(b.log, ['AudioContext'], 'a fresh context in the second click');
  await tick();
  assert.deepEqual(b.log, ['AudioContext', 'getUserMedia'], 'and the mic, before anything is awaited');
  assert.equal(await r.begin({ session: draft({ id: 9 }) }), 'recording');
  assert.equal(b.log.filter((x) => x === 'getUserMedia').length, 1, 'the second click\'s mic is the one used, not asked for again after the POST');
  assert.equal(b.log.filter((x) => x === 'AudioContext').length, 1);
});

test('#1588 main.jsx\'s own stale-chunk reload waits for the capture, and keeps the rethrow while it waits', () => {
  const main = codeOnly(readFileSync('frontend/src/main.jsx', 'utf8'));
  assert.match(main, /import \{ isCapturing, whenIdle \} from '\.\/lib\/captureGuard';/);
  const fn = main.slice(main.indexOf('function reloadOnceForStaleChunk()'), main.indexOf('function dropCachesThenReload('));
  assert.match(fn, /const now = !isCapturing\(\);\s*whenIdle\(\(\) => dropCachesThenReload\(next\)\);\s*return now;/,
    'the reload runs through whenIdle, and reports a reload under way only when it starts now');
  assert.doesNotMatch(fn, /reloadCarryingCount|serviceWorker|caches/, 'nothing reloads or drops caches outside whenIdle');
  assert.match(main, /if \(reloadOnceForStaleChunk\(\)\) \{\s*try \{ e\.preventDefault\(\); \}/, 'the rethrow is suppressed only when a reload starts');
  assert.match(readFileSync('documentation/architecture/GOTCHAS.md', 'utf8'), /`main\.jsx`'s own stale-chunk reload on `vite:preloadError`/);
});
