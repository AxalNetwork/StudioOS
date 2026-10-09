/**
 * D660 (#1473) — Record a session, the Interview Session page and the
 * Recording View, on D657's Worker routes.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_session_pages_d660.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import RecordSessionSheet, { ModelList, canStart, parseConversation, perMinute } from '../src/pages/founder/RecordSessionSheet.jsx';
import { StartPanel, TranscriptReview, SessionRail } from '../src/pages/founder/InterviewSessionPage.jsx';
import RecordingView, { recordingState, STATES } from '../src/pages/founder/RecordingView.jsx';
import { runRing, bandLevels, BANDS } from '../src/lib/ringViz.js';
import { createCapture, memoryQueue, flushQueue, downsampleTo16k, readLiveEvent } from '../src/lib/interviewCapture.js';

// The shape `GET /sessions/models` answers (D657, services/sttModels.ts).
const MODELS = {
  live: [
    { model: '@cf/deepgram/nova-3', label: 'Nova-3', good_at: 'Speakers, many languages', tags: ['Speakers'], price_usd_per_minute: 0.0092, choosable: true },
    { model: '@cf/deepgram/flux', label: 'Flux', good_at: 'Turn-taking', tags: [], price_usd_per_minute: 0.0077, choosable: true },
  ],
  final: [
    { model: '@cf/openai/whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', good_at: 'Fast, cheap', tags: ['Default'], price_usd_per_minute: 0.0005, choosable: true },
    { model: '@cf/openai/whisper-tiny-en', label: 'Whisper Tiny EN', good_at: 'English only', tags: ['Beta'], price_usd_per_minute: null, choosable: false },
  ],
  defaults: { live: '@cf/deepgram/nova-3', final: '@cf/openai/whisper-large-v3-turbo' },
};
const INTERVIEW = { id: 7, interviewee_name: 'Dana Ruiz', interviewee_role: 'Ops lead', interviewee_company: 'Acme' };
const html = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const startButton = (h) => /<button[^>]*data-testid="button-start-recording"[^>]*>/.exec(h)[0];

test('Start is disabled on an audio channel until consent is recorded, and the foot says why', () => {
  const none = html(React.createElement(RecordSessionSheet, { interview: INTERVIEW, initialModels: MODELS }));
  assert.match(startButton(none), /disabled=""/);
  assert.match(renderedText(none), /Start unlocks once consent is recorded\./);
  assert.match(renderedText(none), /Not recorded · ask before you start/);

  const declined = html(React.createElement(RecordSessionSheet, { interview: INTERVIEW, initialModels: MODELS, initialConsent: { status: 'declined', method: '' } }));
  assert.match(startButton(declined), /disabled=""/);

  const given = html(React.createElement(RecordSessionSheet, { interview: INTERVIEW, initialModels: MODELS, initialConsent: { status: 'given', method: 'verbal' } }));
  assert.doesNotMatch(startButton(given), /disabled=""/);
  assert.match(renderedText(given), /Transcribe with Whisper Large v3 Turbo/);
  assert.doesNotMatch(renderedText(given), /Start unlocks/);

  assert.equal(canStart('in_person', { status: 'not_recorded' }), false);
  assert.equal(canStart('video', { status: 'given', method: '' }), false, 'given needs a method, as the Worker does');
  assert.equal(canStart('phone', { status: 'given', method: 'written' }), true);
  assert.equal(canStart('text', { status: 'not_recorded' }), true, 'text records no audio and needs no consent');
});

test('the Worker\'s 409 is printed in its own words', () => {
  const words = 'Record the interviewee’s consent to be recorded before you start.';
  const out = html(React.createElement(StartPanel, { session: { channel: 'in_person', consent_status: 'not_recorded', status: 'draft' }, error: words }));
  assert.match(out, /role="alert"/);
  assert.ok(renderedText(out).includes(words));
  assert.match(/<button[^>]*data-testid="button-session-start"[^>]*>/.exec(out)[0], /disabled=""/);
  const ok = html(React.createElement(StartPanel, { session: { channel: 'in_person', consent_status: 'given', status: 'draft' } }));
  assert.doesNotMatch(/<button[^>]*data-testid="button-session-start"[^>]*>/.exec(ok)[0], /disabled=""/);
  assert.doesNotMatch(ok, /role="alert"/);
});

test('the model lists render from the response, with its prices, and an unpriced model cannot be chosen', () => {
  const live = html(React.createElement(ModelList, { kind: 'live', models: MODELS.live, value: MODELS.defaults.live, onChange: () => {}, allowOff: true }));
  const t = renderedText(live);
  assert.match(t, /Nova-3/); assert.match(t, /\$0\.0092\/min/);
  assert.match(t, /Flux/); assert.match(t, /\$0\.0077\/min/);
  assert.match(t, /Off/);
  const fin = html(React.createElement(ModelList, { kind: 'final', models: MODELS.final, value: MODELS.defaults.final, onChange: () => {} }));
  assert.match(renderedText(fin), /Whisper Large v3 Turbo/);
  assert.match(renderedText(fin), /\$0\.0005\/min/);
  const tiny = /<input[^>]*value="@cf\/openai\/whisper-tiny-en"[^>]*>/.exec(fin)[0];
  assert.match(tiny, /disabled=""/);
  assert.match(renderedText(fin), /Not offered/);
  const turbo = /<input[^>]*value="@cf\/openai\/whisper-large-v3-turbo"[^>]*>/.exec(fin)[0];
  assert.doesNotMatch(turbo, /disabled=""/);
  assert.match(turbo, /checked=""/);
  // A list that could not be read says so; it is never an empty list.
  assert.match(renderedText(html(React.createElement(ModelList, { kind: 'final', models: null }))), /Unreadable/);
  assert.equal(perMinute(null), 'Not priced');
});

function fakeDeps() {
  const sockets = [];
  class WS {
    constructor(url) { this.url = url; this.sent = []; this.closed = 0; sockets.push(this); }
    send(b) { this.sent.push(b); }
    close() { this.closed += 1; }  // a browser fires onclose later, not inside close()
  }
  let t = 1000;
  return {
    sockets,
    deps: {
      getUserMedia: async () => ({ getTracks: () => [] }), AudioContext: null, MediaRecorder: null, WebSocket: WS,
      now: () => (t += 10), setTimeout: (f) => { f(); return 1; }, clearTimeout: () => {}, liveUrl: 'wss://x/live',
    },
  };
}

test('hiding the live transcript closes the socket, and audio after it goes nowhere', async () => {
  const { sockets, deps } = fakeDeps();
  const c = createCapture({ deps, api: { uploadChunk: async () => ({}) }, queue: memoryQueue(), sessionId: 1, liveOn: true });
  await c.open();
  c.start();
  assert.equal(sockets.length, 1);
  sockets[0].onopen();
  c.state.socket.send(new Int16Array(4));
  assert.equal(sockets[0].sent.length, 1);
  const before = c.state.socket;
  c.setLive(false);
  assert.equal(sockets[0].closed, 1, 'Hide live transcript closes the socket');
  assert.equal(c.state.socket, null);
  before.send(new Int16Array(4));
  assert.equal(sockets[0].sent.length, 1, 'a closed socket sends nothing');
  c.setLive(true);
  assert.equal(sockets.length, 2, 'showing it again opens a new one');

  // Live off from the start opens nothing.
  const off = fakeDeps();
  const c2 = createCapture({ deps: off.deps, api: { uploadChunk: async () => ({}) }, queue: memoryQueue(), sessionId: 2, liveOn: false });
  await c2.open(); c2.start();
  assert.equal(off.sockets.length, 0);
});

test('reduced motion draws one still frame and asks for no other; paused does not animate', () => {
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const run = (opts) => {
    let frames = 0;
    const stop = runRing({ ctx, size: { w: 200, h: 200 }, analyser: null, sampleRate: 48000, dark: false, progress: 0,
      raf: () => { frames += 1; return frames; }, caf: () => {}, now: () => 0, ...opts });
    stop();
    return frames;
  };
  assert.equal(run({ mode: 'speech', reduced: true }), 0);
  assert.equal(run({ mode: 'paused', reduced: false }), 0);
  assert.equal(run({ mode: 'speech', reduced: false }), 1);
  assert.equal(BANDS.length, 3);
  const freq = new Uint8Array(1024).fill(160);
  assert.deepEqual(bandLevels(freq, 48000), [1, 1, 1]);
});

test('each of the eleven states is reachable, and the Recording View says the canvas words', () => {
  const seen = new Set([
    recordingState({}), recordingState({ silentMs: 3000 }), recordingState({ paused: true }),
    recordingState({ markedAt: 0, now: 100 }), recordingState({ online: false }), recordingState({ mic: 'denied' }),
    recordingState({ silentMs: 9000 }), recordingState({ stopping: true }), recordingState({ reduced: true }),
    recordingState({ drawer: true }), recordingState({ confirm: true }),
  ]);
  assert.deepEqual([...seen].sort(), [...STATES].sort());
  const view = (state, extra = {}) => renderedText(html(React.createElement(RecordingView, { state, elapsedMs: 61000, interviewee: 'Dana', liveAvailable: true, liveOn: true, ...extra })));
  assert.match(view('offline'), /Saved on this device, uploading when online/);
  assert.match(view('denied'), /StudioOS cannot hear the microphone/);
  assert.match(view('nosound'), /We can't hear anything\. Check the microphone\./);
  assert.match(view('marked', { lastMark: 24000 }), /Moment marked at 00:24/);
  assert.match(view('confirm'), /Stop and process this session\?/);
  assert.match(view('confirm'), /Keep recording/);
  assert.match(view('speech', { liveOn: false }), /Live transcript off\. The transcript appears when you stop\./);
  assert.match(view('stopping', { stage: 1 }), /Uploading.*Transcribing.*Summarising/);
  assert.match(view('speech'), /01:01/);
  const dark = html(React.createElement(RecordingView, { state: 'speech', theme: 'dark' }));
  assert.match(dark, /data-theme="dark"/);
  assert.match(html(React.createElement(RecordingView, { state: 'speech' })), /data-theme="light"/);
});

test('speakers are assigned with one tap; the receipt and the meter read the Worker', () => {
  const segs = [{ id: 1, source: 'final', speaker_label: 'Speaker ?', text: 'We lose a day a week.' }, { id: 2, source: 'live', speaker_label: 'Me', text: 'draft' }];
  const t = html(React.createElement(TranscriptReview, { segments: segs, intervieweeName: 'Dana' }));
  assert.match(t, /data-testid="speaker-1-Dana"/);
  assert.match(t, /data-testid="speaker-1-Me"/);
  assert.doesNotMatch(renderedText(t), /draft/, 'the final transcript replaces the live draft');
  const session = { channel: 'in_person', live_model: null, final_model: '@cf/openai/whisper-large-v3-turbo' };
  const rail = renderedText(html(React.createElement(SessionRail, { session, models: MODELS, receipt: { items: [{ kind: 'final', model: 'turbo', cost_microusd: 1500, outcome: 'ok' }], total_cost_microusd: 1500, budget: { day_left_microusd: 2000000, month_left_microusd: 9000000 } } })));
  assert.match(rail, /Live: Off/);
  assert.match(rail, /This session\$0\.0015/);
  assert.match(rail, /Left today\$2\.0000/);
  const unread = renderedText(html(React.createElement(SessionRail, { session, models: MODELS, receipt: { items: [], total_cost_microusd: 0, budget: null, budget_error: 'Unreadable: your AI allowance and top-up balance could not be read.' } })));
  assert.match(unread, /Unreadable: your AI allowance/);
  assert.doesNotMatch(unread, /Left today/);
});

test('the offline queue keeps every chunk the Worker has not taken, in order', async () => {
  const q = memoryQueue();
  for (const seq of [2, 0, 1]) await q.put({ sessionId: 9, seq, blob: { seq }, startMs: seq * 15000 });
  const sent = [];
  let fail = true;
  const upload = async (seq) => { if (seq === 1 && fail) throw new Error('offline'); sent.push(seq); };
  const r = await flushQueue(q, 9, upload);
  assert.deepEqual(sent, [0]);
  assert.equal(r.pending, 2);
  assert.deepEqual((await q.list(9)).map((x) => x.seq), [1, 2]);
  fail = false;
  await flushQueue(q, 9, upload);
  assert.deepEqual(sent, [0, 1, 2]);
  assert.equal((await q.list(9)).length, 0);
});

test('16 kHz linear16, the conversation parser, and live events', () => {
  const pcm = downsampleTo16k(new Float32Array(48000).fill(0.5), 48000);
  assert.equal(pcm.length, 16000);
  assert.equal(pcm[0], Math.round(0.5 * 0x7fff));
  assert.deepEqual(parseConversation('Dana: It takes a day\nwe log it'), [{ author: 'Dana', text: 'It takes a day' }, { author: 'Me', text: 'we log it' }]);
  assert.deepEqual(readLiveEvent({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'hi' }] } }), { text: 'hi', final: false });
  assert.deepEqual(readLiveEvent({ event: 'EndOfTurn', transcript: 'done' }), { text: 'done', final: true });
});
