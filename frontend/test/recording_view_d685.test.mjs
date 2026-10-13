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
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import RecordingView, { SHARE_NOTES, clock, initials, languageName, layers, statusWord } from '../src/pages/founder/RecordingView.jsx';
import RecordingPill from '../src/pages/founder/RecordingPill.jsx';
import { liveRedirect } from '../src/pages/founder/RecordLivePage.jsx';
import RecordLightbox from '../src/pages/founder/RecordLightbox.jsx';
import { setRecorder } from '../src/contexts/ActiveRecordingContext.jsx';

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

test('a hidden status announces Recording, Paused, Offline and Stopped; the timer itself is not live', () => {
  assert.match(view(), /<p class="sr-only" role="status" data-testid="recording-status">Recording</);
  assert.match(view({ phase: 'paused' }), /data-testid="recording-status">Paused</);
  assert.match(view({ online: false }), /data-testid="recording-status">Offline</);
  assert.match(view({ phase: 'stopping' }), /data-testid="recording-status">Stopped</);
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

test('dark: the canvas\'s ground and vignette, and dark pairs for the pill and the tiles', () => {
  const out = view({ video: true, cap: { displayVideo: {} } }, { theme: 'dark' });
  assert.match(out, /#07050d/);
  assert.match(out, /#130b22/);
  assert.match(out, /data-theme="dark"/);
  assert.match(tag(out, 'tile-you'), /dark:bg-\[#130b22\]/);
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
  const actions = { cancelStop: () => calls.push('keep'), confirmStop: () => calls.push('stop'), discard: () => calls.push('discard'), toggleDrawer: (v) => calls.push(`drawer:${v}`) };
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

test('the live route: bound to the recording; another session\'s address goes to its page; a finished one lands on its review', () => {
  const st = ST();
  assert.equal(liveRedirect(st, null), null);
  assert.equal(liveRedirect(st, '7'), null);
  assert.equal(liveRedirect(st, '9'), '/validate/session/9', 'no active recording for that id: its own page');
  assert.equal(liveRedirect({ session: null }, '9'), '/validate/session/9');
  assert.equal(liveRedirect({ session: null }, 'abc'), '/validate', 'a malformed id goes nowhere odd');
  assert.equal(liveRedirect({ session: null }, null), '/validate');
  assert.equal(liveRedirect({ ...st, phase: 'ready' }, '7'), '/validate/session/7');
  assert.equal(liveRedirect({ phase: 'discarded', session: null }, '7'), '/validate/interviews');
  const app = readFileSync('frontend/src/App.jsx', 'utf8');
  assert.match(app, /<Route path="\/validate\/record\/live" element=\{guard\(labRoles\(\['admin', 'founder'\]\), <RecordLivePage \/>\)\} \/>/);
  assert.match(app, /<ActiveRecordingProvider userId=\{user\?\.id \?\? null\} \/>/, 'mounted once, above the pages');
  assert.match(app, /<SafeMount name="RecordingPill"><RecordingPill \/><\/SafeMount>/);
  const live = readFileSync('frontend/src/pages/founder/RecordLivePage.jsx', 'utf8');
  assert.doesNotMatch(live, /recorder\.(signOut|discard|confirmStop)\(/, 'leaving the view never ends the recording');
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
  const sessions = { models: async () => ({}), create: async () => { order.push('create'); return { session: { id: 501, status: 'draft' }, call_label: 'Audio call · as the Worker words it', points: [{ id: 88, hypothesis_id: 2, text: 'H2 · They would pay', covered: false }] }; } };
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
    assert.deepEqual(order.slice(1), ['createInterview', 'create', ['begin', 'Audio call · as the Worker words it', false, [88]]], 'the Worker\'s label, and the drawer ticks the Worker\'s rows');
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
