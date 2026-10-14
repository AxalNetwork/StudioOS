/**
 * D685 §5.6, §5.7 and §5.2 (#1588) — the Recording View to the new export,
 * the minimised pill on every route, the live route, the talking-points
 * drawer, the stop confirm with "Discard this recording", and the lightbox
 * handing its draft to the recorder.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/recording_view_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import RecordingView, { SHARE_NOTES, clock, initials, languageName, layers, statusWord } from '../src/pages/founder/RecordingView.jsx';
import RecordingPill from '../src/pages/founder/RecordingPill.jsx';
import { liveRedirect } from '../src/pages/founder/RecordLivePage.jsx';
import { reviewPath } from '../src/lib/activeRecording.js';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { ActiveRecordingProvider, setRecorder } from '../src/contexts/ActiveRecordingContext.jsx';
import RecordLivePage from '../src/pages/founder/RecordLivePage.jsx';
import InterviewSessionPage from '../src/pages/founder/InterviewSessionPage.jsx';

const h = React.createElement;
const html = (el, url = '/') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, el));
const tag = (out, id) => new RegExp(`<[a-z]+[^>]*data-testid="${id}"[^>]*>`).exec(out)?.[0] ?? '';
const SESSION = { id: 7, status: 'recording', active_ms: 3723000, recording_since: null, live_model: 'nova', language: 'fr', channel: 'in_person' };
const ST = (patch = {}) => ({ phase: 'recording', session: SESSION, interview: { interviewee_name: 'Dana Ruiz', interviewee_company: 'Acme' }, callLabel: 'Audio call · WhatsApp call', cap: { live: true, caption: 'we lose a day' }, online: true, points: [], ...patch });
const view = (patch = {}, props = {}) => html(h(RecordingView, { st: ST(patch), now: 0, ...props }));

test('the top bar: who and where from, the call\'s pill, the offline pill, and Exit full screen', () => {
  const out = view();
  assert.ok(renderedText(tag(out, 'recording-who') + renderedText(out)).includes('Dana Ruiz · Acme'));
  assert.ok(renderedText(out).includes('Audio call · WhatsApp call'));
  assert.match(tag(out, 'recording-call-label'), /bg-violet-100[^"]*dark:bg-violet-900/);
  assert.match(tag(out, 'button-exit-full-screen'), /aria-label="Exit full screen"/);
  assert.doesNotMatch(out, /recording-offline/);
  assert.ok(renderedText(view({ interview: { interviewee_name: 'Dana Ruiz' } })).includes('Dana Ruiz · Not recorded'), 'a missing company says so');
  assert.ok(renderedText(view({ interview: null })).includes('Name not recorded'));
  const off = view({ online: false });
  assert.ok(renderedText(off).includes('Saved on this device, uploading when online'));
  assert.match(tag(off, 'recording-offline'), /bg-amber-100[^"]*dark:bg-amber-900/);
  assert.match(out, /pt-\[max\(1rem,env\(safe-area-inset-top\)\)\]/);
});

test('a hidden status announces Recording, Paused, Offline, each processing stage, and Ready to review; the timer itself is not live', () => {
  assert.match(view(), /<p class="sr-only" role="status" data-testid="recording-status">Recording</);
  assert.match(view({ phase: 'paused' }), /data-testid="recording-status">Paused</);
  assert.match(view({ online: false }), /data-testid="recording-status">Offline</);
  assert.match(view({ phase: 'stopping', processing: { stage: 'transcribing', done: 1, total: 4 } }), /data-testid="recording-status">Transcribing</);
  assert.match(view({ phase: 'stopping', processing: { stage: 'placing' } }), /data-testid="recording-status">Placing findings</);
  assert.match(view({ phase: 'stopping', processing: { stage: 'failed', error: 'No.' }, stageAt: 1 }), /data-testid="recording-status">Processing stopped</);
  assert.match(view({ phase: 'stopping', processing: null }), /data-testid="recording-status">Processing</);
  assert.match(view({ phase: 'ready' }), /data-testid="recording-status">Ready to review</);
  assert.equal(statusWord(layers(ST({ phase: 'paused', online: false })), 'paused'), 'Offline', 'offline is the more urgent word');
  const t = tag(view(), 'recording-clock');
  assert.match(t, /role="timer"/);
  assert.match(t, /aria-live="off"/);
});

test('the timer reads hh:mm:ss inside the ring, blinks while paused unless motion is reduced; the language is the session\'s, never a default', () => {
  assert.equal(clock(3723000), '01:02:03');
  assert.equal(clock(61000), '00:01:01', 'the hour is drawn under 60 minutes too');
  assert.ok(renderedText(view()).includes('01:02:03'));
  assert.match(tag(view({ phase: 'paused' }), 'recording-clock'), /motion-safe:animate-pulse/);
  assert.doesNotMatch(tag(view({ phase: 'paused' }, { reduced: true }), 'recording-clock'), /animate-pulse/);
  assert.doesNotMatch(tag(view(), 'recording-clock'), /animate-pulse/, 'no blink while recording');
  assert.ok(renderedText(tag(view(), 'recording-language') + '').length >= 0);
  assert.match(view(), /data-testid="recording-language">French</);
  assert.doesNotMatch(view({ session: { ...SESSION, language: null } }), /recording-language/, 'unknown: hidden, not "English"');
  assert.doesNotMatch(view({ phase: 'denied' }), /recording-language/, 'hidden when the mic is denied');
  assert.equal(languageName('xx'), null);
  assert.equal(languageName('constructor'), null);
});

test('four 68px labelled controls: Pause or Resume, Mark this moment, a red Stop, Talking points; none while stopping', () => {
  const out = view();
  for (const [id, label] of [['button-pause', 'Pause'], ['button-mark', 'Mark this moment'], ['button-stop', 'Stop and process this session'], ['button-drawer', 'Talking points']]) {
    assert.match(tag(out, id), new RegExp(`aria-label="${label}"`), id);
    assert.match(tag(out, id), /h-\[68px\] w-\[68px\]/, `${id} is 68px`);
  }
  assert.match(tag(out, 'button-stop'), /border-red-600 bg-red-600 text-white/);
  assert.match(tag(out, 'button-drawer'), /aria-expanded="false"/);
  assert.match(tag(out, 'button-drawer'), /aria-controls="recording-points"/);
  assert.match(tag(view({ phase: 'paused' }), 'button-resume'), /aria-label="Resume"/);
  assert.match(tag(view({ phase: 'paused' }), 'button-mark'), /disabled=""/);
  const stopping = view({ phase: 'stopping', stage: 1 });
  for (const id of ['button-pause', 'button-mark', 'button-stop', 'button-drawer']) assert.doesNotMatch(stopping, new RegExp(id));
  assert.match(renderedText(stopping), /Uploading.*Transcribing.*Summarising.*Placing findings/);
});

test('captions are not a live region: only the toast and the drawer\'s count announce', () => {
  const out = view();
  assert.ok(renderedText(out).includes('we lose a day'));
  assert.doesNotMatch(tag(out, 'live-caption'), /aria-live/);
  assert.doesNotMatch(out, /aria-live="polite"[^>]*>[^<]*we lose a day/);
  assert.match(view({ toast: { at: 1, offset: 24000 } }), /<p role="status"[^>]*data-testid="recording-toast">Moment marked at <!-- -->24:00|role="status"[^>]*data-testid="recording-toast"/);
  assert.ok(renderedText(view({ toast: { at: 1, offset: 24000 } })).includes('Moment marked at 00:24'));
  assert.ok(renderedText(view({ cap: { live: false } })).includes('Live transcript off. The transcript appears when you stop.'));
});

test('every state draws: silence, no sound for 30 s, the mic lost, offline, the budget spent, the share note, the screen lock', () => {
  assert.ok(renderedText(view({ cap: { silentMs: 31000 } })).includes("We can't hear anything. Check the microphone."));
  assert.doesNotMatch(view({ cap: { silentMs: 29000 } }), /recording-nosound/, 'not before 30 s');
  assert.ok(renderedText(view({ cap: { mic: 'ended' } })).includes('The microphone stopped sending sound.'), 'a lost track shows at once');
  assert.ok(renderedText(view({ online: false })).includes('Live transcript paused while offline'));
  const spent = view({ cap: { budget: true } });
  assert.ok(renderedText(spent).includes('Live captions stopped: your AI budget is spent.'));
  assert.doesNotMatch(spent, /button-toggle-live/, 'nothing offers to reopen captions after 4402');
  assert.ok(renderedText(view({ cap: { shareNote: 'not_shared' } })).includes(SHARE_NOTES.not_shared));
  assert.equal(SHARE_NOTES.not_shared, 'Recording your microphone only: the call’s audio was not shared.');
  assert.ok(renderedText(view({ wake: 'unsupported' })).includes('This browser cannot keep the screen on.'));
  assert.ok(renderedText(view({ error: 'The Worker says no.' })).includes('The Worker says no.'));
});

test('between Start and the microphone answering, the view says so and offers no controls', () => {
  const out = view({ phase: 'idle', session: { ...SESSION, status: 'draft' } });
  assert.ok(renderedText(out).includes('Opening the microphone…'));
  for (const id of ['button-pause', 'button-stop', 'live-caption']) assert.doesNotMatch(out, new RegExp(id));
  assert.doesNotMatch(view(), /recording-opening/, 'not once recording');
});

test('#1587 a refused Start draws the Worker\'s words, Return to that recording, and Back; never the microphone card', async () => {
  const st = { phase: 'denied', session: { ...SESSION, status: 'draft' }, refused: { text: 'You are already recording another session. Stop it, or return to it, first.', sessionId: 88 } };
  const out = view(st);
  assert.ok(renderedText(out).includes('You are already recording another session. Stop it, or return to it, first.'));
  assert.doesNotMatch(out, /StudioOS cannot hear the microphone|button-retry-mic/);
  assert.doesNotMatch(out, /button-pause/);
  const opened = [];
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  try {
    await act(async () => { root.render(h(RecordingView, { st, now: 0, onExit: () => opened.push('exit'), onOpen: (href) => opened.push(href) })); });
    assert.equal(pr(by('refused-card')).role, 'alert');
    await act(async () => { pr(by('button-refused-live')).onClick(); });
    await act(async () => { pr(by('button-refused-exit')).onClick(); });
    assert.deepEqual(opened, ['/validate/record/live?session=88', 'exit']);
    await act(async () => { root.render(h(RecordingView, { st: { ...st, refused: { text: 'Record consent first.', sessionId: null } }, now: 0, onExit() {}, onOpen() {} })); });
    assert.equal(by('button-refused-live'), undefined, 'no recording to return to');
  } finally { await act(async () => root.unmount()); restore(); }
  const live = readFileSync('frontend/src/pages/founder/RecordLivePage.jsx', 'utf8');
  assert.match(live, /onOpen=\{\(href\) => navigate\(href, \{ replace: true \}\)\}/);
});

test('the denied card draws in draft, with Try again; the video share step offers the tab or the mic only', () => {
  const denied = view({ phase: 'denied', session: { ...SESSION, status: 'draft' } });
  assert.ok(renderedText(denied).includes('StudioOS cannot hear the microphone'));
  assert.match(denied, /data-testid="button-retry-mic"/);
  assert.doesNotMatch(denied, /button-pause/);
  const share = view({ phase: 'share', video: true, session: { ...SESSION, status: 'draft', channel: 'video' } });
  assert.match(share, /data-testid="button-share-tab"/);
  assert.match(share, /data-testid="button-mic-only"/);
  assert.ok(renderedText(share).includes('Share the call’s tab'));
  assert.doesNotMatch(share, /recording-tiles/, 'no tiles until the call is shared');
});

test('the video tiles: the interviewee\'s from the shared tab, and "You" with initials; md and wider only; never off video', () => {
  const tiles = view({ video: true, cap: { displayVideo: {} } }, { you: 'Ada Lovelace' });
  assert.match(tag(tiles, 'recording-tiles'), /hidden[^"]*md:flex/);
  assert.match(tiles, /data-testid="tile-video"/);
  assert.match(tiles, /h-\[168px\]/);
  assert.match(tag(tiles, 'tile-you'), /h-\[112px\] w-\[112px\]/);
  assert.ok(renderedText(tiles).includes('AL'));
  assert.equal(initials(''), 'You');
  assert.doesNotMatch(view(), /recording-tiles/);
});

test('#1588 a video call: "Start the call" opens the meeting link first, then the share; on a phone the microphone only, and no tiles', () => {
  const sharing = { phase: 'share', video: true, session: { ...SESSION, status: 'draft', channel: 'video' } };
  const out = view({ ...sharing, meetingUrl: 'https://acme.zoom.us/j/1' });
  const link = tag(out, 'button-start-call');
  assert.match(link, /href="https:\/\/acme\.zoom\.us\/j\/1"/);
  assert.match(link, /target="_blank"/);
  assert.match(link, /rel="noopener noreferrer"/);
  assert.ok(out.indexOf('button-start-call') < out.indexOf('button-share-tab'), 'the link comes first: two clicks, in order');
  assert.doesNotMatch(view(sharing), /button-start-call/, 'no link, no step');
  // A phone: no tab to share.
  const phone = view({ ...sharing, meetingUrl: 'https://acme.zoom.us/j/1' }, { actions: { canShareTab: false } });
  assert.ok(renderedText(phone).includes('On a phone it records this device’s microphone only.'));
  assert.doesNotMatch(phone, /button-share-tab/);
  assert.match(phone, /data-testid="button-mic-only"/);
  assert.match(phone, /button-start-call/, 'the call can still be opened');
  assert.doesNotMatch(view({ video: true, cap: { displayVideo: {} } }, { actions: { canShareTab: false } }), /recording-tiles/, 'no tiles on a phone');
  assert.match(view({ video: true, cap: { displayVideo: {} } }, { actions: { canShareTab: true } }), /recording-tiles/);
});

test('dark: the canvas\'s ground and vignette, and dark pairs for the pill and the tiles', () => {
  const out = view({ video: true, cap: { displayVideo: {} } }, { theme: 'dark' });
  assert.match(out, /#07050d/);
  assert.match(out, /#130b22/);
  assert.match(out, /data-theme="dark"/);
  assert.match(tag(out, 'tile-you'), /dark:bg-\[#130b22\]/);
});

test('processing: a percentage and aria-valuenow only where the Worker counts; the chips; the sentence and Retry on failure', () => {
  const up = view({ phase: 'stopping', processing: { stage: 'uploading', done: 3, total: 4 } });
  const ring = tag(up, 'recording-ring');
  assert.match(ring, /role="progressbar"/);
  assert.match(ring, /aria-valuenow="75"/);
  assert.match(ring, /aria-label="Processing: Uploading"/);
  assert.match(up, /data-testid="processing-percent">75%</);
  assert.doesNotMatch(up, /data-testid="recording-clock"/, 'the timer gives way to the processing ring');
  for (const stage of ['summarising', 'placing']) {
    const out = view({ phase: 'stopping', processing: { stage, done: 3, total: 4 } });
    assert.match(tag(out, 'recording-ring'), /role="progressbar"/);
    assert.doesNotMatch(tag(out, 'recording-ring'), /aria-valuenow/, `${stage}: no count, no value`);
    assert.doesNotMatch(out, /processing-percent|\d+%/, `${stage}: never a guessed percentage`);
  }
  assert.doesNotMatch(tag(view({ phase: 'stopping', processing: { stage: 'uploading', done: null, total: null } }), 'recording-ring'), /aria-valuenow/, 'before finish answers');
  assert.doesNotMatch(tag(view(), 'recording-ring'), /progressbar/, 'recording: the ring is not a progress bar');

  const tr = view({ phase: 'stopping', processing: { stage: 'transcribing', done: 1, total: 4 } });
  assert.match(tag(tr, 'stage-1'), /data-tone="current"/);
  assert.match(tag(tr, 'stage-1'), /aria-current="step"/);
  assert.match(tag(tr, 'stage-1'), /bg-violet-700/, 'the current one filled violet');
  assert.match(tag(tr, 'stage-2'), /data-tone="next"/);
  assert.match(tag(tr, 'stage-2'), /bg-violet-100/, 'the next tinted');
  assert.match(tag(tr, 'stage-3'), /data-tone="rest"/);
  assert.doesNotMatch(tag(tr, 'stage-3'), /bg-/, 'the rest outlined');
  assert.match(tag(tr, 'stage-0'), /data-tone="done"/);
  assert.ok(renderedText(tr).includes('Then the review screen.'));
  assert.doesNotMatch(tr, /Not recorded/, 'no stage is marked as missing now that the Worker reports each');
  assert.doesNotMatch(tr, /data-testid="processing-failed"/);

  const failed = view({ phase: 'stopping', stageAt: 1, processing: { stage: 'failed', error: 'The recording could not be read. Nothing was transcribed.' } });
  assert.match(tag(failed, 'processing-failed'), /role="alert"/);
  assert.ok(renderedText(failed).includes('The recording could not be read. Nothing was transcribed.'));
  assert.match(failed, /data-testid="button-retry-processing"/);
  assert.match(tag(failed, 'stage-1'), /data-tone="rest"/, 'nothing is drawn as running after a failure');
  assert.doesNotMatch(renderedText(failed), /Then the review screen/);
  assert.doesNotMatch(failed, /data-testid="button-stop"/, 'no recording controls while processing');
});

test('the drawer: "[n] of [m] covered", one checkbox each, its empty sentence, ticks saved by the Worker, and a refusal said', () => {
  const pts = [{ id: 1, text: 'H1 · They lose a day', covered: true }, { id: 2, text: 'H2 · They would pay', covered: false }, { id: 3, text: 'H3', covered: false }];
  const out = view({ drawer: true, points: pts }, { actions: { tick() {} } });
  assert.match(out, /data-testid="points-count">1(<!-- -->)? of (<!-- -->)?3(<!-- -->)? covered</);
  assert.match(tag(out, 'points-count'), /aria-live="polite"/);
  assert.equal((out.match(/type="checkbox"/g) || []).length, 3);
  assert.match(out, /line-through opacity-50/, 'a covered row is struck and dimmed');
  assert.doesNotMatch(out, /type="checkbox"[^>]*disabled=""/, 'the Worker stores the ticks (#1591)');
  assert.doesNotMatch(renderedText(out), /Not saved yet/);
  assert.match(view({ drawer: true, points: pts }), /type="checkbox"[^>]*disabled=""/, 'nothing to save a tick with: disabled');
  const refused = view({ drawer: true, points: pts, pointError: 'That tick was not saved. Try again.' }, { actions: { tick() {} } });
  assert.match(tag(refused, 'points-error'), /role="alert"/);
  assert.ok(renderedText(refused).includes('That tick was not saved. Try again.'));
  assert.ok(renderedText(view({ drawer: true, points: [] })).includes('No talking points were picked for this session.'));
  assert.doesNotMatch(view({ drawer: true, points: [] }), /Not recorded/);
  assert.match(tag(view({ drawer: true }), 'button-drawer'), /aria-expanded="true"/);
});

test('the stop confirm: modal and labelled, a red Stop and process, and the quieter Discard this recording', () => {
  const out = view({ confirm: true });
  const dlg = tag(out, 'confirm-stop');
  assert.match(dlg, /role="dialog"/);
  assert.match(dlg, /aria-modal="true"/);
  assert.match(dlg, /aria-labelledby="stop-title"/);
  assert.match(tag(out, 'button-confirm-stop'), /bg-red-600/);
  assert.ok(renderedText(out).includes('Discard this recording'));
});

// ── Focus and keys, against a stub DOM patched with focus and listeners ─────

async function mountView(st, actions) {
  const restore = installDocument();
  const focused = [];
  const listeners = new Map();
  const create = document.createElement.bind(document);
  document.createElement = (t) => {
    const n = create(t);
    n.focus = function focus() { focused.push(this); document.activeElement = this; };
    n.querySelectorAll = () => [];
    n.addEventListener = (ev, fn) => { if (!listeners.has(n)) listeners.set(n, []); listeners.get(n).push([ev, fn]); };
    n.removeEventListener = () => {};
    return n;
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = (s) => act(async () => { root.render(h(MemoryRouter, null, h(RecordingView, { st: s, now: 0, actions }))); });
  await render(st);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const key = (id, k) => (listeners.get(by(id)) || []).filter(([ev]) => ev === 'keydown').forEach(([, fn]) => fn({ key: k, preventDefault() {}, stopPropagation() {} }));
  return { focused, by, pr, key, render, async unmount() { await act(async () => root.unmount()); restore(); } };
}

test('focus: into the view on open; into the confirm on Keep recording, Escape keeps recording, and focus goes back to Stop', async () => {
  const calls = [];
  const actions = { cancelStop: () => calls.push('keep'), confirmStop: () => calls.push('stop'), discard: () => calls.push('discard'), retry: () => calls.push('retry'), toggleDrawer: (v) => calls.push(`drawer:${v}`) };
  const m = await mountView(ST(), actions);
  try {
    assert.ok(m.focused.at(-1) === m.by('button-exit-full-screen'), 'focus moves into the view');
    await m.render(ST({ confirm: true }));
    assert.ok(m.focused.at(-1) === m.by('button-keep-recording'), 'initial focus on Keep recording');
    m.key('confirm-stop', 'Escape');
    assert.deepEqual(calls, ['keep'], 'Escape means keep recording');
    await m.render(ST());
    assert.ok(m.focused.at(-1) === m.by('button-stop'), 'and focus returns to Stop');
    await m.render(ST({ confirm: true }));
    await act(async () => { m.pr(m.by('button-discard')).onClick(); });
    assert.ok(calls.includes('discard'));
    await m.render(ST({ phase: 'stopping', processing: { stage: 'failed', error: 'No.' }, stageAt: 1 }));
    await act(async () => { m.pr(m.by('button-retry-processing')).onClick(); });
    assert.ok(calls.includes('retry'), 'Retry asks the recorder to resume');
  } finally { await m.unmount(); }
});

test('focus in the drawer: into it on open, Escape closes it, focus goes back to the button', async () => {
  const calls = [];
  const m = await mountView(ST({ points: [{ id: 1, text: 'H1' }] }), { toggleDrawer: (v) => calls.push(v), tick: (id, on) => calls.push(['tick', id, on]) });
  try {
    await m.render(ST({ drawer: true, points: [{ id: 1, text: 'H1' }] }));
    assert.ok(m.focused.at(-1) === m.by('points-close'), 'focus moves into the sheet');
    m.key('points-drawer', 'Escape');
    assert.deepEqual(calls, [false]);
    await m.render(ST({ drawer: true, points: [{ id: 1, text: 'H1', covered: false }, { id: 9, text: 'H9', covered: true }] }));
    m.pr(m.by('point-1')).onChange();
    m.pr(m.by('point-9')).onChange();
    assert.deepEqual(calls.slice(1), [['tick', 1, true], ['tick', 9, false]], 'a tick is sent with the Worker\'s point id, and an untick');
    await m.render(ST());
    assert.ok(m.focused.at(-1) === m.by('button-drawer'), 'focus returns to Talking points');
  } finally { await m.unmount(); }
});

// ── The pill, on every route ───────────────────────────────────────────────

function stubRecorder(state) {
  const listeners = new Set();
  let s = state;
  const r = {
    cleared: 0,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    getSnapshot: () => s,
    isCapturing: () => ['recording', 'paused', 'stopping', 'share'].includes(s.phase),
    clear() { r.cleared += 1; },
    set(next) { s = next; listeners.forEach((l) => l(s)); },
  };
  return r;
}

test('the pill shows on a route outside Validate, never on the live view, and states its state', () => {
  setRecorder(stubRecorder(ST()));
  const raise = html(h(RecordingPill), '/raise');
  assert.match(raise, /<button[^>]*aria-label="Recording · 01:02:03 · tap to expand"/);
  assert.ok(renderedText(raise).includes('Recording · tap to expand'));
  assert.match(raise, /data-testid="ring-viz"/, 'a live ring in the corner');
  assert.match(tag(raise, 'recording-pill'), /lg:right-\[300px\]/, 'clear of the open rail');
  assert.match(tag(raise, 'recording-pill'), /max-lg:bottom-\[calc\(76px\+env\(safe-area-inset-bottom\)\)\]/, 'above the phone tab bar');
  assert.match(tag(raise, 'recording-pill'), /dark:bg-\[#130b22\]/, 'a dark variant');
  assert.equal(html(h(RecordingPill), '/validate/record/live'), '', 'not over the view it minimises');
  setRecorder(stubRecorder(ST({ phase: 'paused' })));
  assert.match(html(h(RecordingPill), '/build'), /aria-label="Paused · /);
  setRecorder(stubRecorder(ST({ phase: 'stopping' })));
  assert.match(html(h(RecordingPill), '/build'), /aria-label="Processing the session · tap to expand"/);
  setRecorder(stubRecorder(ST({ phase: 'ready' })));
  const ready = html(h(RecordingPill), '/build');
  assert.match(ready, /<a [^>]*href="\/validate\/session\/7"/, '"Ready to review" links to the review');
  setRecorder(stubRecorder(ST({ phase: 'ready', session: { ...SESSION, interview_id: 41 } })));
  assert.match(html(h(RecordingPill), '/build'), /<a [^>]*href="\/validate\/interviews\/41\?session=7"/, 'the interview\'s review, on this session');
  setRecorder(stubRecorder(ST({ phase: 'stopping', processing: { stage: 'failed', error: 'No.' } })));
  assert.match(html(h(RecordingPill), '/build'), /aria-label="Processing stopped · tap to retry"/);
  setRecorder(stubRecorder({ ...ST(), session: null, phase: 'idle' }));
  assert.equal(html(h(RecordingPill), '/build'), '', 'nothing recording, no pill');
});

test('pressing the pill opens the live view for its session; the recording is untouched by the route change', async () => {
  const rec = stubRecorder(ST());
  setRecorder(rec);
  const restore = installDocument();
  let path = null;
  function Probe() { const l = useLocation(); path = `${l.pathname}${l.search}`; return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/grow'] }, h(Probe), h(RecordingPill))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const pill = walk(container).find((n) => pr(n)['data-testid'] === 'recording-pill');
  assert.equal(pill.tagName, 'BUTTON', 'a real button: Enter and Space work natively');
  await act(async () => { pr(pill).onClick(); });
  assert.equal(path, '/validate/record/live?session=7');
  assert.equal(rec.getSnapshot().phase, 'recording');
  await act(async () => root.unmount()); restore();
});

test('after a reload the session page hands a run under way to the recorder and opens the live view; a finished one stays', async () => {
  const followed = [];
  const rec = stubRecorder({ phase: 'idle', session: null });
  rec.follow = (arg) => { followed.push(arg); return Promise.resolve('done'); };
  setRecorder(rec);
  const read = (processing) => ({
    session: { id: 7, interview_id: 41, status: 'stopped', channel: 'in_person', consent_status: 'given' },
    interview: { id: 41, interviewee_name: 'Dana Ruiz' }, call_label: 'In person', processing, segments: [], marks: [], chunks: [],
  });
  const api = (r) => ({ get: async () => r, receipt: async () => ({ items: [] }), models: async () => ({ live: [], final: [] }), placements: async () => ({ items: [] }) });
  const mount = async (r) => {
    const restore = installDocument();
    // The page's theme hook reads the root's class list, which the stub DOM lacks.
    if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
    let path = null;
    function Probe() { const l = useLocation(); path = `${l.pathname}${l.search}`; return null; }
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(h(MemoryRouter, { initialEntries: ['/validate/session/7'] }, h(Probe),
        h(Routes, null, h(Route, { path: '/validate/session/:id', element: h(InterviewSessionPage, { api: api(r) }) }), h(Route, { path: '/validate/record/live', element: h('p', null, 'live') }))));
    });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    await act(async () => root.unmount()); restore();
    return path;
  };
  assert.equal(await mount(read({ stage: 'transcribing', done: 1, total: 3, error: null, stale: false })), '/validate/record/live?session=7');
  assert.equal(followed.length, 1);
  assert.equal(followed[0].processing.stage, 'transcribing', 'from the Worker\'s state');
  assert.equal(followed[0].interview.interviewee_name, 'Dana Ruiz', 'the name from the session read');
  assert.equal(followed[0].callLabel, 'In person');
  assert.equal(await mount(read({ stage: 'failed', done: null, total: null, error: 'No.', stale: false })), '/validate/record/live?session=7', 'a failure opens it too, with Retry');
  assert.equal(await mount(read({ stage: 'done', done: null, total: null, error: null, stale: false })), '/validate/session/7', 'done: nothing to follow');
  assert.equal(await mount(read(null)), '/validate/session/7', 'never processed: nothing to follow');
  assert.equal(followed.length, 2);
  const followedHere = stubRecorder({ phase: 'stopping', session: { id: 7 } });
  followedHere.follow = () => { followed.push('again'); return Promise.resolve('done'); };
  setRecorder(followedHere);
  assert.equal(await mount(read({ stage: 'transcribing', done: 1, total: 3, error: null, stale: false })), '/validate/session/7', 'already followed in this tab: left alone');
  assert.equal(followed.length, 2);
});

test('the live route: bound to the recording; another session\'s address goes to its page; a finished one lands on its review', () => {
  const st = ST();
  assert.equal(liveRedirect(st, null), null);
  assert.equal(liveRedirect(st, '7'), null);
  assert.equal(liveRedirect(st, '9'), '/validate/session/9', 'no active recording for that id: its own page');
  assert.equal(liveRedirect({ session: null }, '9'), '/validate/session/9');
  assert.equal(liveRedirect({ session: null }, 'abc'), '/validate', 'a malformed id goes nowhere odd');
  assert.equal(liveRedirect({ session: null }, null), '/validate');
  assert.equal(liveRedirect({ ...st, phase: 'ready', session: { ...SESSION, interview_id: 41 } }, '7'), '/validate/interviews/41?session=7', 'done: the interview\'s review, on this session');
  assert.equal(reviewPath({ id: 7 }), '/validate/session/7', 'no interview id: the session\'s own page');
  assert.equal(reviewPath(null), '/validate/interviews');
  assert.equal(liveRedirect({ phase: 'discarded', session: null }, '7'), '/validate/interviews');
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/validate\/record\/live" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RecordLivePage \/>\)\} \/>/);
  assert.match(app, /<ActiveRecordingProvider userId=\{user\?\.id \?\? null\} \/>/, 'mounted once, above the pages');
  assert.match(app, /<SafeMount name="RecordingPill"><RecordingPill \/><\/SafeMount>/);
  const live = readFileSync('frontend/src/pages/founder/RecordLivePage.jsx', 'utf8');
  const exitFn = live.slice(live.indexOf('const exit = '), live.indexOf('};', live.indexOf('const exit = ')));
  assert.doesNotMatch(exitFn, /recorder\./, 'leaving the view never ends the recording');
  assert.doesNotMatch(live, /recorder\.(signOut|discard)\(/);
  assert.match(live, /const \[auto\] = useAssistMode\('Validate'\);/, 'the rail\'s mode decides whether the Worker goes past Transcribing');
  assert.match(live, /confirmStop: \(\) => recorder\.confirmStop\(\{ auto \}\)/);
  assert.match(readFileSync('frontend/src/pages/founder/RecordingView.jsx', 'utf8'), /fixed inset-0 z-\[90\]/, 'full screen at every width, above the rail');
});

test('the lightbox hands its draft over: the mic is opened in the Start click, then the view replaces /record in history', async () => {
  const order = [];
  const recorder = {
    prepare: () => order.push('prepare'),
    release: () => order.push('release'),
    begin: (arg) => { order.push(['begin', arg.callLabel, arg.video, arg.points.map((p) => p.id)]); return Promise.resolve('recording'); },
  };
  const api = { createInterview: async () => { order.push('createInterview'); return { id: 41, interviewee_name: 'Dana' }; }, deleteInterview: async () => {}, getValidationBoard: async () => ({ hypotheses: [] }) };
  // The Worker answers with its own point rows: their ids are not the hypotheses'.
  const sessions = { models: async () => ({}), open: async () => { order.push('open'); return { session: { id: 501, status: 'draft' }, interview: { id: 41, interviewee_name: 'Dana', interviewee_company: null }, call_label: 'Audio call · as the Worker words it', points: [{ id: 88, hypothesis_id: 2, text: 'H2 · They would pay', covered: false }] }; } };
  const started = [];
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const models = { live: [], final: [{ model: 'w', label: 'W', price_usd_per_minute: 0.0005, choosable: true }], defaults: { live: null, final: 'w' } };
  const mount = (mode) => act(async () => { root.render(h(MemoryRouter, null, h(RecordLightbox, { key: mode, projectId: 3, initialModels: models, initialBoard: { hypotheses: [] }, channels: null, initialMode: mode, initialConsent: 'verbal', api, sessions, recorder, onClose() {}, onStarted: (...a) => started.push(a) }))); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  try {
    await mount('phone');
    await act(async () => { pr(by('record-name')).onChange({ target: { value: 'Dana' } }); });
    await act(async () => {
      const pending = pr(by('record-start')).onClick();
      assert.equal(order[0], 'prepare', 'synchronously, inside the click: before anything is awaited');
      await pending;
    });
    assert.deepEqual(order.slice(1), ['open', ['begin', 'Audio call · as the Worker words it', false, [88]]], 'one setup call; the Worker\'s label, and the drawer ticks the Worker\'s rows');
    assert.equal(started[0][2], 'live');
    order.length = 0; started.length = 0;
    await mount('video');
    await act(async () => { pr(by('record-name')).onChange({ target: { value: 'Dana' } }); });
    await act(async () => { pr(by('record-start')).onClick(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    assert.ok(!order.includes('prepare'), 'a video call asks in its own second click');
    assert.deepEqual(order.find((x) => Array.isArray(x)).slice(2, 3), [true]);
  } finally { await act(async () => root.unmount()); restore(); }
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /navigate\(`\/validate\/record\/live\?session=\$\{encodeURIComponent\(session\.id\)\}`, \{ replace: true \}\)/, 'Back does not reopen the setup');
});

test('the session page hands its recording to the recorder and no longer owns a capture', () => {
  const page = readFileSync('frontend/src/pages/founder/InterviewSessionPage.jsx', 'utf8');
  assert.doesNotMatch(page, /createCapture|indexedDbQueue|<RecordingView/, 'the capture lives above the routes now');
  assert.match(page, /recorder\.begin\(\{ session, interview, callLabel: data\.call_label \?\? null, points: data\.points \|\| \[\], video: session\.channel === 'video' \}\)/, 'the session read\'s points reach the drawer');
  assert.match(page, /recorder\.adopt\(\{ session, interview, callLabel: data\.call_label \?\? null, points: data\.points \|\| \[\], storedSeqs: chunks\.map\(\(c\) => c\.seq\) \}\)/, 'an interrupted recording resumes after the audio already saved, with its points');
  assert.match(page, /const interview = location\.state\?\.interview \|\| data\.interview \|\| null;/, 'after a reload the name comes from the session read');
});

/** The session page, mounted at /validate/session/7, with clicks; `path` follows navigation. */
async function sessionPage(read) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const where = { path: null };
  function Probe() { const l = useLocation(); where.path = `${l.pathname}${l.search}`; return null; }
  const api = { get: async () => read, receipt: async () => ({ items: [] }), models: async () => ({ live: [], final: [] }), placements: async () => ({ items: [] }) };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/validate/session/7'] }, h(Probe),
      h(Routes, null, h(Route, { path: '/validate/session/:id', element: h(InterviewSessionPage, { api }) }), h(Route, { path: '/validate/record/live', element: h('p', null, 'live') }))));
  });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    where, by, pr, text: (id) => text(by(id)).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}
const sessionRead = (status) => ({
  session: { id: 7, interview_id: 41, status, channel: 'in_person', consent_status: 'given', consent_method: 'verbal' },
  interview: { id: 41, interviewee_name: 'Dana Ruiz' }, call_label: 'In person', processing: null, segments: [], marks: [], chunks: [],
});

test('#1588 Resume here, in a second tab: the recording is live there, so nothing is paused and the page says so', async () => {
  const rec = stubRecorder({ phase: 'idle', session: null });
  const adopted = [];
  rec.adopt = async (arg) => { adopted.push(arg.session.id); return 'other_tab'; };
  setRecorder(rec);
  const p = await sessionPage(sessionRead('recording'));
  try {
    await p.click('button-adopt-recording');
    assert.deepEqual(adopted, [7]);
    assert.match(p.text('adopt-note'), /This recording is live in another tab\. Go back to that tab to pause, resume or stop it\./);
    assert.equal(p.where.path, '/validate/session/7', 'it stays on the page');
  } finally { await p.unmount(); }
  // Free here: it opens the live view.
  rec.adopt = async () => 'paused';
  const q = await sessionPage(sessionRead('paused'));
  try {
    await q.click('button-adopt-recording');
    assert.equal(q.where.path, '/validate/record/live?session=7');
  } finally { await q.unmount(); }
});

test('#1588 a draft\'s Start while this tab records another session: refused before anything is asked for, with the way back', async () => {
  const rec = stubRecorder({ phase: 'recording', session: { id: 88 } });
  const begun = [];
  rec.begin = async (arg) => { begun.push(arg.session.id); return 'recording'; };
  setRecorder(rec);
  const p = await sessionPage(sessionRead('draft'));
  try {
    await p.click('button-session-start');
    assert.deepEqual(begun, [], 'begin is never called, so no microphone opens');
    assert.match(p.text('start-error'), /You are already recording another session\. Stop it, or return to it, first\./);
    assert.equal(p.pr(p.by('start-error-live')).href, '/validate/record/live?session=88');
    assert.equal(p.where.path, '/validate/session/7');
  } finally { await p.unmount(); }
});

test('#1588 the pill never says Recording when nothing records, and its ring follows the dark pill', () => {
  // A video call waiting for its tab, a blocked microphone, a Start the Worker refused.
  for (const [patch, variant, words] of [
    [{ phase: 'share' }, 'share', /Share the call's tab · tap to expand/],
    [{ phase: 'denied', refused: null }, 'blocked', /Microphone blocked · tap to expand/],
    [{ phase: 'denied', refused: { text: 'No.', sessionId: null } }, 'refused', /Did not start · tap to expand/],
  ]) {
    setRecorder(stubRecorder(ST(patch)));
    const out = html(h(RecordingPill), '/raise');
    assert.match(tag(out, 'recording-pill'), new RegExp(`data-variant="${variant}"`));
    assert.match(renderedText(out), words);
    assert.doesNotMatch(out, /aria-label="Recording/, `${variant}: never "Recording"`);
    assert.doesNotMatch(out, /data-testid="recording-pill-clock"/, `${variant}: no clock runs`);
    assert.match(tag(out, 'ring-viz'), /data-mode="paused"/, `${variant}: the ring is still`);
  }
  // Light by default; dark when the root is dark.
  setRecorder(stubRecorder(ST()));
  assert.match(tag(html(h(RecordingPill), '/raise'), 'ring-viz'), /data-theme="light"/);
  const saved = globalThis.document;
  globalThis.document = { documentElement: { classList: { contains: (c) => c === 'dark' } } };
  try {
    assert.match(tag(html(h(RecordingPill), '/raise'), 'ring-viz'), /data-theme="dark"/, 'the dark pill draws the dark ring');
  } finally { globalThis.document = saved; }
});

test('#1588 the share step says what the attach did, in the Worker\'s words', () => {
  const at = (attach) => renderToStaticMarkup(h(MemoryRouter, null, h(RecordingView, { st: ST({ phase: 'share', video: true, attach }), now: 0, theme: 'light', actions: { canShareTab: true } })));
  const refused = at({ tone: 'refused', text: 'This meeting link is already attached to an interview.' });
  assert.match(tag(refused, 'share-attach-note'), /data-tone="refused"/);
  assert.match(tag(refused, 'share-attach-note'), /role="status"/);
  assert.ok(renderedText(refused).includes('This meeting link is already attached to an interview.'));
  assert.match(refused, /data-testid="share-attach-note"[^>]*class="[^"]*dark:text-amber-300/, 'a dark pair');
  assert.match(tag(at({ tone: 'attached', text: 'Imported later.' }), 'share-attach-note'), /data-tone="attached"/);
  assert.doesNotMatch(at(null), /share-attach-note/, 'nothing attached, nothing said');
});


/** The live route and the pill, mounted together, as App.jsx draws them; `where.path` follows navigation. */
async function liveApp(url) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.focus = function focus() { document.activeElement = this; }; return n; };
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  const where = { path: null };
  function Probe() { const l = useLocation(); where.path = `${l.pathname}${l.search}`; return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [url] }, h(Probe), h(RecordingPill),
      h(Routes, null,
        h(Route, { path: '/validate/record/live', element: h(RecordLivePage) }),
        h(Route, { path: '/validate/session/:id', element: h('p', null, 'session page') }),
        h(Route, { path: '*', element: h('p', null, 'elsewhere') }))));
  });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  return {
    where, by,
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); },
    async unmount() { await act(async () => root.unmount()); restore(); },
  };
}

test('#1588 the live route, mounted: a reload waits for recovery instead of leaving, then shows the recording; Exit keeps it and focuses the pill', async () => {
  const rec = stubRecorder({ ...ST(), session: null, phase: 'idle', recovery: 'running' });
  const ended = [];
  for (const m of ['confirmStop', 'discard', 'signOut', 'pause']) rec[m] = () => { ended.push(m); };
  setRecorder(rec);
  const app = await liveApp('/validate/record/live?session=7');
  try {
    assert.ok(app.by('live-restoring'), 'restoring, not redirected');
    assert.equal(app.where.path, '/validate/record/live?session=7');
    // Recovery brings it back, paused.
    await act(async () => { rec.set({ ...ST({ phase: 'paused', session: { ...SESSION, status: 'paused' } }), recovery: 'done' }); });
    assert.ok(app.by('recording-view'), 'the recording, on its own address');
    assert.equal(app.where.path, '/validate/record/live?session=7');
    // Exit full screen: back out, the recording untouched, focus on the pill that holds it.
    await app.click('button-exit-full-screen');
    assert.equal(app.where.path, '/validate', 'a deep link has no history, so Validate');
    assert.deepEqual(ended, [], 'nothing paused, stopped or discarded');
    assert.equal(rec.getSnapshot().phase, 'paused');
    const pill = app.by('recording-pill');
    assert.ok(pill, 'the pill holds the recording');
    assert.equal(document.activeElement, pill, 'and has the focus');
  } finally { await app.unmount(); }
  // Recovery finished and found nothing for that id: its own page.
  setRecorder(stubRecorder({ ...ST(), session: null, phase: 'idle', recovery: 'done' }));
  const gone = await liveApp('/validate/record/live?session=7');
  try { assert.equal(gone.where.path, '/validate/session/7'); } finally { await gone.unmount(); }
});

test('#1588 the provider, mounted: recovery runs once per member, and a member switch signs the recorder out', async () => {
  const restore = installDocument();
  const log = [];
  const rec = stubRecorder({ phase: 'idle', session: null });
  Object.assign(rec, { setUser: (id) => log.push(['setUser', id]), recover: async () => { log.push(['recover']); return 'none'; }, signOut: () => { log.push(['signOut']); }, setOnline() {}, onVisible() {} });
  setRecorder(rec);
  if (!document.addEventListener) document.addEventListener = () => {};
  if (!document.removeEventListener) document.removeEventListener = () => {};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(h(ActiveRecordingProvider, { userId: 7 })); });
    assert.deepEqual(log, [['setUser', 7], ['recover']]);
    await act(async () => { root.render(h(ActiveRecordingProvider, { userId: 7 })); });
    assert.equal(log.filter((x) => x[0] === 'recover').length, 1, 'once per member, not per render');
    await act(async () => { root.render(h(ActiveRecordingProvider, { userId: 9 })); });
    assert.deepEqual(log.slice(2), [['signOut'], ['setUser', 9], ['recover']], 'the old member\'s capture stops first');
  } finally { await act(async () => root.unmount()); restore(); }
});

// ── #1588, round two ─────────────────────────────────────────────────────────

test('#1588 r2 mounted: open a failed session\'s page while recording another; it is not handed over, the recording keeps going, and the page shows the stage', async () => {
  const rec = stubRecorder({ ...ST(), session: { ...SESSION, id: 88 }, phase: 'recording' });
  const followed = [];
  rec.follow = (arg) => { followed.push(arg.session.id); return Promise.resolve('done'); };
  setRecorder(rec);
  const read = { ...sessionRead('stopped'), processing: { stage: 'failed', done: null, total: null, error: 'Processing stopped unexpectedly. Nothing was lost; try again.' } };
  const p = await sessionPage(read);
  try {
    assert.deepEqual(followed, [], 'follow is never called, so the live capture is never dropped');
    assert.equal(p.where.path, '/validate/session/7', 'it stays on its page');
    assert.equal(rec.getSnapshot().session.id, 88);
    assert.equal(rec.getSnapshot().phase, 'recording');
    assert.match(p.text('processing-here'), /Processing stopped/);
    assert.match(p.text('processing-here'), /Nothing was lost; try again\./);
    assert.match(p.text('processing-here'), /You are recording another session/);
  } finally { await p.unmount(); }
  // Recording nothing: it is handed over as before.
  const idle = stubRecorder({ phase: 'idle', session: null });
  idle.follow = (arg) => { followed.push(arg.session.id); return Promise.resolve('failed'); };
  setRecorder(idle);
  const q = await sessionPage(read);
  try {
    assert.deepEqual(followed, [7]);
    assert.equal(q.where.path, '/validate/record/live?session=7');
  } finally { await q.unmount(); }
});

test('#1588 r2 mounted: the session page\'s Start opens the mic inside its click, before begin awaits anything, and lets it go on a refusal', async () => {
  const log = [];
  const rec = stubRecorder({ phase: 'idle', session: null });
  rec.prepare = () => { log.push('prepare'); };
  rec.release = () => { log.push('release'); };
  rec.begin = async () => { log.push('begin'); throw Object.assign(new Error('Record consent first.'), { status: 409 }); };
  setRecorder(rec);
  const p = await sessionPage(sessionRead('draft'));
  try {
    await p.click('button-session-start');
    assert.deepEqual(log, ['prepare', 'begin', 'release'], 'prepared in the click, then handed over, then let go');
    assert.match(p.text('start-error'), /Record consent first\./);
  } finally { await p.unmount(); }
  // A video call asks in its own click: nothing prepared here.
  log.length = 0;
  rec.begin = async () => { log.push('begin'); return 'share'; };
  const v = await sessionPage({ ...sessionRead('draft'), session: { ...sessionRead('draft').session, channel: 'video' } });
  try {
    await v.click('button-session-start');
    assert.deepEqual(log, ['begin']);
  } finally { await v.unmount(); }
});

test('#1588 r2 Exit from a Start still opening sets no focus flag, so a later pill never takes focus from another page', async () => {
  const rec = stubRecorder({ ...ST(), phase: 'idle' });
  setRecorder(rec);
  const app = await liveApp('/validate/record/live?session=7');
  try {
    await app.click('button-exit-full-screen');
    assert.equal(app.where.path, '/validate');
    const typing = { id: 'search-box' };
    document.activeElement = typing;
    await act(async () => { rec.set(ST({ phase: 'recording' })); });
    assert.ok(app.by('recording-pill'), 'the pill is drawn later');
    assert.equal(document.activeElement, typing, 'and leaves the founder\'s focus where it was');
  } finally { await app.unmount(); }
});
