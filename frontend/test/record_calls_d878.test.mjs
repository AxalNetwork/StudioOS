/**
 * D878 (#2525) — Record a session › Calls, the boards MC1–MC7 on the Worker's
 * reads (D875, D872, D877, D757, and D878's two). Every API is stubbed; every
 * person and figure is invented, and every name is a "[Participant]" mark.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_calls_d878.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import RecordChannelPage from '../src/pages/founder/RecordChannelPage.jsx';
import {
  MC_TABS, audioLine, callConsent, callProposalGroups, callRows, callTimeline, callTurns, chunkBar, mcHref, mcRoute, noneConnected, offset,
  renameCheck, retentionWord, setupCards, sourceBadge, speakersOf, summaryLines, tokenEstimate, upcomingRows,
} from '../src/pages/founder/callsModel.js';
import { tgRoute, waRoute } from '../src/pages/founder/channelSessionModel.js';
import { UploadError } from '../src/lib/recordingUpload.js';

process.env.TZ = 'UTC';
const TZ = 'UTC';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

/* ------------------------------------------------------------------ *
 * Fixtures (invented)
 * ------------------------------------------------------------------ */

const step = (n, key, state, code, action = null) => ({ step: n, key, state, code, action });
const SETUP = {
  zoom: {
    steps: [step(1, 'set_up', 'done', 'zoom_set_up'), step(2, 'app_open', 'todo', 'zoom_beta', 'Zoom is open to invited founders only for now.'), step(3, 'connected', 'todo', 'zoom_not_connected', 'Connect Zoom in Account › Connectors.')],
    prerequisites: [{ key: 'zoom_cloud_transcript', line: 'Needs a paid Zoom plan with cloud recording on.', state: null }], next: 'app_open', ready: false, audience: 'beta',
  },
  google_meet: {
    steps: [step(1, 'set_up', 'done', 'google_set_up'), step(2, 'connected', 'done', 'google_connected'), step(3, 'transcripts', 'todo', 'meet_scope_missing', 'Press Allow transcript import.')],
    prerequisites: [{ key: 'meet_transcription', line: 'Needs a Google Workspace edition with Meet transcription.', state: null }], next: 'transcripts', ready: false, meet_transcripts: 'available',
  },
};
const NOTHING = {
  zoom: { ...SETUP.zoom, steps: [step(1, 'set_up', 'done', 'zoom_set_up'), step(2, 'app_open', 'done', 'zoom_open'), step(3, 'connected', 'todo', 'zoom_not_connected', 'Connect Zoom.')], audience: 'public' },
  google_meet: { ...SETUP.google_meet, steps: [step(1, 'set_up', 'done', 'google_set_up'), step(2, 'connected', 'todo', 'google_not_connected', 'Connect Google.'), step(3, 'transcripts', 'blocked', 'needs_google', 'Connect Google first.')] },
};
const GOOGLE = { connected: true, google_email: 'participant@example.test', sync_error: null };
const NOW = Date.parse('2026-10-21T08:00:00Z');
const meeting = (o) => ({ uid: 'r1', provider: 'google_meet', label: 'Google Meet', join_url: 'https://meet.google.com/abc-mnop-xyz', starts_at: '2026-10-21T10:00:00Z', ends_at: '2026-10-21T10:42:00Z', status: 'imported', error: null, error_code: null, transcript_source: 'native', interview_id: 4, session_id: 40, ...o });
const call = (id, o = {}) => ({
  session_id: id, interview_id: 4, interviewee_name: '[Participant A]', interviewee_company: '[Company A]', source: 'google_meet',
  session: { status: 'stopped', channel: 'video', consent_status: 'given', consent_method: 'verbal', created_at: '2026-10-21 10:00:00', processing_stage: null, processing_error: null },
  meeting: meeting({ session_id: id }), audio: { state: 'none', kept_until: null, removed_at: null, removed_reason: null }, pending_proposals: 0, ...o,
});
const ZOOM_NONE = 'Zoom has no transcript for this call.';
const CALLS = {
  project_id: 7, truncated: false,
  calls: [
    call(41, { source: 'upload', interview_id: 5, interviewee_name: '[Participant C]', interviewee_company: null, meeting: null,
      session: { status: 'stopped', consent_status: 'given', consent_method: 'written', created_at: '2026-10-21 16:00:00', processing_stage: 'done' },
      audio: { state: 'held', kept_until: '2026-11-20T16:02:00.000Z', removed_at: null, removed_reason: null } }),
    call(40, { pending_proposals: 4 }),
    call(43, { source: 'zoom', meeting: meeting({ uid: 'r43', provider: 'zoom', label: 'Zoom', status: 'failed', error: 'There are no AI tokens left.', error_code: 'stt_budget', transcript_source: null, session_id: 43 }),
      audio: { state: 'removed', kept_until: null, removed_at: '2026-10-18 03:00:00', removed_reason: 'retention' } }),
    call(44, { source: 'zoom', meeting: meeting({ uid: 'r44', provider: 'zoom', label: 'Zoom', status: 'no_transcript', error: ZOOM_NONE, error_code: 'zoom_no_transcript', transcript_source: null, session_id: 44 }) }),
    call(45, { meeting: meeting({ uid: 'r45', status: 'scheduled', starts_at: '2026-10-22T10:00:00Z', ends_at: '2026-10-22T10:45:00Z', session_id: 45 }), interviewee_name: '[Participant D]' }),
  ],
};
const UPCOMING = {
  connected: true,
  calls: [
    { provider: 'google_meet', title: '[Participant E] · discovery call', starts_at: '2026-10-24T09:00:00Z', ends_at: '2026-10-24T09:30:00Z', join_url: 'https://meet.google.com/qrs-tuvw-xyz', attach: { method: 'POST' }, attach_blocked: null },
    { provider: 'zoom', title: '[Participant F] · follow-up', starts_at: '2026-10-22T15:30:00Z', ends_at: '2026-10-22T16:00:00Z', join_url: 'https://zoom.us/j/91234567890', attach: { method: 'POST' }, attach_blocked: null },
    { provider: 'google_meet', title: '[Participant G] · pricing call', starts_at: '2026-10-28T11:00:00Z', ends_at: null, join_url: 'https://meet.google.com/aaa-bbbb-ccc', attach: null, attach_blocked: 'Axal can import only a Meet call you organize.' },
  ],
};
const SEGMENTS = [
  { id: 1, source: 'final', start_ms: 8000, speaker_label: '[Name] (you)', text: 'Before we start, is it all right if I record this call?', translation_status: 'same' },
  { id: 2, source: 'final', start_ms: 302000, speaker_label: 'Speaker 3', text: 'Nosotros usamos listas en papel.', translation: 'We use paper checklists.', translation_status: 'done', source_lang: 'es' },
  { id: 3, source: 'final', start_ms: 452000, speaker_label: 'Speaker 3', text: 'Se pierden en la obra.', translation: null, translation_status: 'pending', source_lang: 'es' },
  { id: 4, source: 'live', start_ms: 452000, speaker_label: 'Speaker 3', text: 'live copy' },
  { id: 5, source: 'final', start_ms: null, speaker_label: '[Participant A]', text: 'About [€1,200] a month per site.', translation_status: 'same' },
];
const placement = (id, kind, payload, o = {}) => ({ id, kind, payload: { confidence: 0.85, ...payload }, edited_payload: null, status: 'pending', can_accept: true, cite: { quote: `quote ${id}` }, ...o });
const PLACEMENTS = { runs: [{ run_id: 'r1', source: 'studioos', placements: [
  placement(11, 'decision', { statement: 'Run a two-site pilot from [1 Nov].' }),
  placement(12, 'follow_up', { detail: 'send the pilot price sheet', due_hint: 'by [24 Oct]' }),
  placement(13, 'demand_signal', { signal: 'willing_to_pay', detail: '[€1,200] a month per site' }),
  placement(14, 'pain_severity', { phrase: 'Paper checklists get lost', severity: 'real' }),
  placement(15, 'decision', { statement: 'Already dismissed.' }, { status: 'discarded' }),
] }] };
const DIGEST = { kept: false, overview: [{ text: '[Company A] loses days each week waiting for inspections.' }, 'They track them on paper.'], decisions: [], next_steps: [] };
const MODELS = { final: [{ model: '@cf/openai/whisper-large-v3-turbo', price_usd_per_minute: 0.0005 }], defaults: { final: '@cf/openai/whisper-large-v3-turbo' } };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('addresses: six tabs as paths, a session id only after Calls and Proposals; the other channels keep theirs', () => {
  assert.deepEqual(MC_TABS.map((t) => t.label), ['Upcoming', 'Calls', 'Upload', 'Proposals', 'Connection', 'Retention']);
  assert.deepEqual(mcRoute('/validate/record/calls'), { tab: 'upcoming', id: null });
  assert.deepEqual(mcRoute('/validate/record/calls/'), { tab: 'upcoming', id: null });
  assert.deepEqual(mcRoute('/validate/record/calls/calls/40'), { tab: 'calls', id: 40 });
  assert.deepEqual(mcRoute('/validate/record/calls/retention'), { tab: 'retention', id: null });
  for (const bad of ['/validate/record/calls/upcoming', '/validate/record/calls/upload/3', '/validate/record/calls/nope', '/validate/record/calls/calls/0', '/validate/record/calls/calls/1/x', '/validate/record/telegram/calls/1']) {
    assert.equal(mcRoute(bad), null, bad);
  }
  assert.equal(mcHref('proposals', 40), '/validate/record/calls/proposals/40');
  assert.equal(mcHref('retention', 40), '/validate/record/calls/retention', 'Retention reads no session');
  assert.equal(waRoute('/validate/record/calls/calls/40'), null);
  assert.equal(tgRoute('/validate/record/calls/calls/40'), null);
});

test('MC1: each card is the Worker\'s steps and sentences; Zoom\'s beta pill; Allow transcript import; a refused Google sign-in reads Sign-in expired with Reconnect', () => {
  const [meet, zoom] = setupCards(SETUP, GOOGLE);
  assert.deepEqual([meet.name, zoom.name], ['Google Meet', 'Zoom']);
  assert.deepEqual(meet.steps.map((s) => `${s.label}:${s.state}`), ['Available on Axal:done', 'Connected:done', 'Transcript access:todo']);
  assert.equal(meet.steps[1].line, 'Signed in as participant@example.test.');
  assert.equal(meet.steps[2].line, 'Press Allow transcript import.');
  assert.equal(meet.press, 'meet_allow');
  assert.deepEqual(zoom.pills, [['Zoom beta: open to invited founders', 'lav']]);
  assert.equal(zoom.press, 'zoom_connect');
  assert.equal(zoom.prerequisite, 'Needs a paid Zoom plan with cloud recording on.');
  const [expired] = setupCards(SETUP, { ...GOOGLE, sync_error: { code: 'connection_refused' } });
  assert.deepEqual(expired.pills, [['Sign-in expired', 'neg']]);
  assert.equal(expired.press, 'google_reconnect');
  assert.equal(expired.steps[1].state, 'failed');
  const ready = setupCards({ google_meet: { ...SETUP.google_meet, ready: true, steps: SETUP.google_meet.steps.map((s) => ({ ...s, state: 'done' })) } }, GOOGLE);
  assert.deepEqual([ready[0].pills, ready[0].press], [[['Ready', 'pos']], null]);
  assert.equal(noneConnected(NOTHING), true);
  assert.equal(noneConnected(SETUP), false, 'Google is connected');
  assert.equal(noneConnected(null), false, 'an unread setup is not "not connected"');
});

test('MC2: attached calls with their interview, then the calendar\'s; Meet attaches here, Zoom when it starts, a blocked one says why', () => {
  const rows = upcomingRows({ upcoming: UPCOMING, calls: CALLS.calls }, NOW, TZ);
  assert.deepEqual(rows.map((r) => r.title), ['[Participant D] · [Company A]', '[Participant F] · follow-up', '[Participant E] · discovery call', '[Participant G] · pricing call']);
  assert.deepEqual(rows[0].attached, { interviewId: 4, sessionId: 45 });
  assert.equal(rows[0].span, '10:00 – 10:45');
  assert.equal(rows[1].zoomLater, true);
  assert.equal(rows[1].attach, null, 'a Zoom call needs its recording session first (D685)');
  assert.deepEqual(rows[2].attach, { join_url: 'https://meet.google.com/qrs-tuvw-xyz' });
  assert.equal(rows[3].blocked, 'Axal can import only a Meet call you organize.');
  assert.equal(rows[3].span, '11:00', 'no end: the start alone');
  const later = upcomingRows({ upcoming: { calls: [] }, calls: CALLS.calls }, Date.parse('2026-11-30T00:00:00Z'), TZ);
  assert.equal(later.length, 0, 'a call scheduled outside the next 14 days is not upcoming');
  const early = upcomingRows({ upcoming: { calls: [] }, calls: CALLS.calls }, Date.parse('2026-10-01T00:00:00Z'), TZ);
  assert.equal(early.length, 0, 'a call more than 14 days ahead is not upcoming yet');
});

test('MC3: each call\'s steps, its source badge, and what comes next', () => {
  const [up, meet, budget, none] = CALLS.calls;
  const m = callTimeline(meet, TZ);
  assert.deepEqual(m.steps.map((s) => `${s.t}:${s.state}`), ['Scheduled:done', 'Ended:done', 'Transcript ready:done', 'Imported:done']);
  assert.equal(m.steps[1].at, '10:42 · 42 min');
  assert.deepEqual(m.next, []);
  assert.deepEqual(sourceBadge(meet), { t: 'Meet transcript', tone: 'pos' });
  const n = callTimeline(none, TZ);
  assert.deepEqual(n.steps.map((s) => s.state), ['done', 'done', 'stop']);
  assert.equal(n.steps[2].line, ZOOM_NONE, 'the Worker\'s own sentence');
  assert.deepEqual(n.next.map((x) => x.key), ['upload']);
  const b = callTimeline(budget, TZ);
  assert.deepEqual(b.next.map((x) => [x.key, x.t, x.tokens, x.minutes]), [['import', 'Transcribe with Axal', true, 42]]);
  assert.match(b.why, /no AI tokens left/);
  assert.equal(sourceBadge({ ...budget, meeting: { ...budget.meeting, status: 'imported', transcript_source: 'whisper' } }).t, 'Transcribed by Axal');
  assert.deepEqual(sourceBadge(up), { t: 'Uploaded recording', tone: 'out' });
  assert.deepEqual(callTimeline(up, TZ).steps.map((s) => s.t), ['Uploaded', 'Transcript ready']);
  const stalled = callTimeline({ ...up, session: { ...up.session, processing_stage: null } }, TZ);
  assert.deepEqual([stalled.steps[1].t, stalled.next[0].key], ['Waiting for the upload to finish', 'upload']);
  const failed = callTimeline({ ...up, session: { ...up.session, processing_stage: 'failed', processing_error: 'Speech-to-text failed.' } }, TZ);
  assert.deepEqual([failed.steps[1].line, failed.next[0].key], ['Speech-to-text failed.', 'process']);
  const sched = callTimeline(CALLS.calls[4], TZ);
  assert.deepEqual(sched.steps.map((s) => s.state), ['done', 'todo', 'todo', 'todo'], 'a scheduled call has not ended');
  const missing = callTimeline({ ...meet, meeting: { ...meet.meeting, starts_at: null } }, TZ);
  assert.equal(missing.steps[0].at, 'Not recorded', 'a time the store does not hold is never a date');
  const rows = callRows(CALLS, TZ);
  assert.deepEqual(rows.map((r) => r.status[0]), ['Transcript ready', 'Imported', 'Stopped', 'No transcript', 'Scheduled']);
  assert.equal(rows[1].pending, 4);
});

test('AI tokens: an estimate from the minutes and the model\'s price, or none, never $0.00', () => {
  assert.equal(tokenEstimate(42, MODELS), 'about $0.02 in AI tokens');
  assert.equal(tokenEstimate(1, MODELS), 'about <$0.01 in AI tokens');
  assert.equal(tokenEstimate(null, MODELS), null);
  assert.equal(tokenEstimate(42, { final: [], defaults: {} }), null);
  assert.equal(tokenEstimate(0, MODELS), null);
});

test('MC5: turns by speaker with their offset; translation as the chat boards show it; speakers once each; rename rules', () => {
  const turns = callTurns(SEGMENTS, 'both');
  assert.deepEqual(turns.map((t) => [t.id, t.who, t.at]), [[1, '[Name] (you)', '00:00:08'], [2, 'Speaker 3', '00:05:02'], [3, 'Speaker 3', '00:07:32'], [5, '[Participant A]', null]], 'live segments are not the transcript; a missing offset is not 00:00:00');
  assert.deepEqual([turns[1].showOriginal, turns[1].showTranslation, turns[1].from], [true, true, 'Translated from Spanish']);
  const tr = callTurns(SEGMENTS, 'tr');
  assert.deepEqual([tr[1].showOriginal, tr[1].showTranslation], [false, true]);
  assert.deepEqual([tr[2].showOriginal, tr[2].pending], [true, true], 'a pending translation shows the original, marked');
  assert.deepEqual(callTurns(SEGMENTS, 'orig').map((t) => t.showTranslation), [false, false, false, false]);
  assert.deepEqual(speakersOf(SEGMENTS), [{ label: '[Name] (you)', turns: 1, unnamed: false }, { label: 'Speaker 3', turns: 2, unnamed: true }, { label: '[Participant A]', turns: 1, unnamed: false }]);
  assert.deepEqual(renameCheck('Speaker 3', '  [Participant B] '), { name: '[Participant B]' });
  assert.ok(renameCheck('Speaker 3', '   ').error);
  assert.ok(renameCheck('Speaker 3', 'Speaker 3').error);
  assert.equal(renameCheck('Speaker 3', 'n'.repeat(120)).name.length, 80);
  assert.equal(offset(3_723_000), '01:02:03');
  assert.deepEqual([offset(null), offset(-1), offset('x')], [null, null, null]);
  assert.equal(callConsent({ consent_status: 'given', consent_method: 'verbal' }).t, 'Everyone recorded agreed, out loud.');
  assert.match(callConsent({ consent_status: 'not_asked' }).t, /not recorded/);
});

test('MC6: pending proposals as Decisions, Action items and Data points with their module; dismissed ones are gone; the summary\'s lines', () => {
  const groups = callProposalGroups(PLACEMENTS);
  assert.deepEqual(groups.map((g) => [g.g, g.items.map((i) => i.id)]), [['Decisions', [11]], ['Action items', [12]], ['Data points', [13, 14]]]);
  assert.equal(groups[0].items[0].t, 'Run a two-site pilot from [1 Nov].');
  assert.equal(groups[1].items[0].t, 'Follow up: send the pilot price sheet (by [24 Oct])');
  assert.deepEqual(groups[2].items.map((i) => i.mod), ['Validate › Demand and urgency signals', 'Validate › Problem discovery']);
  assert.equal(groups[0].items[0].conf.t, 'High');
  assert.deepEqual(callProposalGroups({ runs: [] }), []);
  assert.deepEqual(summaryLines(DIGEST), ['[Company A] loses days each week waiting for inspections.', 'They track them on paper.']);
  assert.deepEqual(summaryLines(null), []);
});

test('MC4 and MC7: the upload\'s parts, retention in words, and each call\'s audio', () => {
  assert.deepEqual(chunkBar(7, 12), [...Array(7).fill('done'), 'now', ...Array(4).fill('todo')]);
  assert.deepEqual(chunkBar(3, 3), ['done', 'done', 'done']);
  assert.deepEqual([retentionWord(30), retentionWord(1), retentionWord(365), retentionWord(null), retentionWord(undefined)], ['30 days', '1 day', '1 year', 'Until I delete it', 'Not recorded']);
  assert.equal(audioLine(CALLS.calls[0].audio, TZ), 'Audio kept until 20 Nov 2026');
  assert.equal(audioLine({ state: 'held', kept_until: null }, TZ), 'Audio kept until you delete it');
  assert.equal(audioLine(CALLS.calls[2].audio, TZ), 'Audio deleted 18 Oct 2026 by your retention · text kept');
  assert.equal(audioLine({ state: 'none' }, TZ), 'No audio held · the call’s text only');
  assert.equal(audioLine(undefined, TZ), 'Audio not recorded');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stubApi(o = {}) {
  const calls = [];
  const rec = (name, value) => (...a) => { calls.push([name, ...a]); return typeof value === 'function' ? value(...a) : Promise.resolve(value); };
  const fail = (status, data = {}) => () => Promise.reject(Object.assign(new Error('x'), { status, data }));
  return {
    calls,
    fail,
    api: {
      channels: {
        meetingSetup: rec('meetingSetup', o.setup ?? SETUP),
        googleStatus: rec('googleStatus', o.google ?? GOOGLE),
        upcomingCalls: rec('upcomingCalls', o.upcoming ?? UPCOMING),
        calls: rec('calls', o.calls ?? CALLS),
        attachCalendarMeet: rec('attachCalendarMeet', o.attach ?? { meeting: {}, session_id: 50 }),
        importMeeting: rec('importMeeting', { outcome: 'waiting' }),
        meetingRecording: rec('meetingRecording', { recordings: [] }),
        allowMeetTranscripts: rec('allowMeetTranscripts', 'https://accounts.google.com/o/oauth2/x'),
      },
      sessions: {
        models: rec('models', MODELS),
        get: rec('get', o.session ?? { session: { consent_status: 'given', consent_method: 'verbal' }, segments: SEGMENTS, digest: DIGEST }),
        audio: rec('audio', o.audio ?? { parts: [{ seq: 0, url: '/api/files/dl/a', start_ms: 0 }, { seq: 2, url: '/api/files/dl/c', start_ms: 240000 }] }),
        renameSpeaker: rec('renameSpeaker', o.rename ?? { ok: true, speaker_label: '[Participant B]', renamed: 2 }),
        placements: rec('placements', PLACEMENTS),
        accept: rec('accept', { ok: true }), discard: rec('discard', { ok: true }), acceptAll: rec('acceptAll', { accepted: 4, remaining: 0 }),
        keepDigest: rec('keepDigest', { ok: true }),
        process: rec('process', { ok: true }),
        audioRetention: rec('audioRetention', o.retention ?? { days: 30, chosen: false, default_days: 30 }),
        setAudioRetention: rec('setAudioRetention', { days: 7, chosen: true }),
        removeAudio: rec('removeAudio', { ok: true }),
      },
      app: {
        listProjects: rec('listProjects', [{ id: 7, name: '[Venture A]' }]),
        listInterviews: rec('listInterviews', [{ id: 4, interviewee_name: '[Participant A]' }, { id: 5, interviewee_name: '[Participant C]' }]),
        googleCalConnect: rec('googleCalConnect', { redirect_url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
      },
      upload: {
        decode: rec('decode', o.decode ?? { samples: new Float32Array(16000 * 6), durationMs: 42 * 60000 }),
        run: rec('run', o.run ?? (async ({ onProgress }) => { onProgress({ done: 1, total: 3 }); onProgress({ done: 3, total: 3 }); return { sessionId: 61, parts: 3, sent: 2, skipped: 1 }; })),
      },
      assign: rec('assign', undefined),
    },
  };
}

async function mount(path, api) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(RecordChannelPage, { callsApi: api }))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });
const change = async (n, value) => act(async () => { await props(n).onChange?.({ target: { value, files: value } }); await new Promise((r) => setTimeout(r, 0)); });
const pickRadio = async (n) => act(async () => { props(n).onChange?.({ target: { checked: true } }); await new Promise((r) => setTimeout(r, 0)); });

test('MC2 mounted: the six tabs; Upcoming lists the calls; Attach to interview sends nothing before its dialog has an interview and a consent answer', async () => {
  // The page reads the clock: the scheduled call is tomorrow, whenever this runs.
  const soon = new Date(Date.now() + 86400000).toISOString();
  const s = stubApi({ calls: { ...CALLS, calls: CALLS.calls.map((c) => (c.session_id === 45 ? { ...c, meeting: { ...c.meeting, starts_at: soon, ends_at: null } } : c)) } });
  const w = await mount('/validate/record/calls', s.api);
  try {
    for (const t of MC_TABS) assert.ok(byId(w.container, `mc-tab-${t.key}`), t.key);
    assert.ok(byId(w.container, 'record-channel-calls'));
    assert.ok(byId(w.container, 'mc-upcoming-a-45'), 'the scheduled call on its interview');
    assert.equal(props(byId(w.container, 'mc-upcoming-open-a-45')).href, '/validate/record/calls/calls/45');
    assert.match(text(byId(w.container, 'mc-upcoming-zoom-u-1')), /attached when it starts/);
    assert.match(text(byId(w.container, 'mc-upcoming-blocked-u-2')), /only a Meet call you organize/);
    await click(byId(w.container, 'mc-upcoming-attach-u-0'));
    assert.ok(byId(w.container, 'mc-attach-dialog'));
    await click(byId(w.container, 'mc-attach-dialog-confirm'));
    assert.match(text(byId(w.container, 'mc-attach-error')), /Choose the interview/);
    await change(byId(w.container, 'mc-attach-interview'), '4');
    await click(byId(w.container, 'mc-attach-dialog-confirm'));
    assert.match(text(byId(w.container, 'mc-attach-error')), /how the interviewee agreed/);
    assert.equal(s.calls.filter((c) => c[0] === 'attachCalendarMeet').length, 0, 'nothing attached without consent');
    await pickRadio(byId(w.container, 'mc-attach-consent-verbal'));
    await click(byId(w.container, 'mc-attach-dialog-confirm'));
    const sent = s.calls.find((c) => c[0] === 'attachCalendarMeet');
    assert.deepEqual(sent.slice(1), [4, { join_url: 'https://meet.google.com/qrs-tuvw-xyz', consent: { status: 'given', method: 'verbal' } }]);
    assert.equal(byId(w.container, 'mc-attach-dialog'), undefined);
  } finally { await w.done(); }
});

test('MC-S mounted: Upcoming\'s not connected, empty, reconnect and error states', async () => {
  let s = stubApi({ setup: NOTHING, upcoming: { connected: false, calls: [] }, calls: { calls: [] } });
  let w = await mount('/validate/record/calls', s.api);
  try { assert.equal(props(byId(w.container, 'mc-upcoming-nc-go')).href, '/validate/record/calls/connection'); } finally { await w.done(); }
  s = stubApi({ upcoming: { connected: true, calls: [] }, calls: { calls: [] } });
  w = await mount('/validate/record/calls', s.api);
  try { assert.match(text(byId(w.container, 'mc-upcoming-empty')), /No calls in the next 14 days/); } finally { await w.done(); }
  s = stubApi();
  s.api.channels.upcomingCalls = s.fail(409, { detail: 'meet_reconnect', message: 'Reconnect Google.' });
  w = await mount('/validate/record/calls', s.api);
  try { assert.match(text(byId(w.container, 'mc-upcoming-reconnect')), /Reconnect Google\./); } finally { await w.done(); }
  s = stubApi();
  let reads = 0;
  s.api.channels.upcomingCalls = () => { reads += 1; return Promise.reject(Object.assign(new Error('x'), { status: 503 })); };
  w = await mount('/validate/record/calls', s.api);
  try {
    assert.ok(byId(w.container, 'mc-upcoming-error'));
    await click(byId(w.container, 'mc-upcoming-error-retry'));
    assert.equal(reads, 2, 'Try again reads again');
  } finally { await w.done(); }
});

test('MC3 mounted: the list, a call\'s timeline and source; Transcribe with Axal states its AI tokens in a dialog before it runs', async () => {
  const s = stubApi();
  let w = await mount('/validate/record/calls/calls', s.api);
  try {
    assert.ok(byId(w.container, 'mc-call-40'));
    assert.match(text(byId(w.container, 'mc-call-40')), /Imported.*Meet transcript.*4 to accept/s);
  } finally { await w.done(); }
  w = await mount('/validate/record/calls/calls/43', s.api);
  try {
    assert.equal(text(byId(w.container, 'mc-source')), 'No transcript yet');
    assert.match(text(byId(w.container, 'mc-next-import')), /Transcribe with Axal · about \$0\.02 in AI tokens/);
    await click(byId(w.container, 'mc-next-import'));
    assert.match(props(byId(w.container, 'mc-run-dialog')).sub ?? text(byId(w.container, 'mc-run-dialog')), /AI tokens/);
    assert.equal(s.calls.filter((c) => c[0] === 'importMeeting').length, 0, 'nothing runs before the dialog\'s press');
    await click(byId(w.container, 'mc-run-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'importMeeting').slice(1), [4, 'r43']);
  } finally { await w.done(); }
  w = await mount('/validate/record/calls/calls/44', s.api);
  try { assert.equal(props(byId(w.container, 'mc-next-upload')).href, '/validate/record/calls/upload?interview=4'); } finally { await w.done(); }
  w = await mount('/validate/record/calls/calls/999', s.api);
  try { assert.ok(byId(w.container, 'mc-call-missing')); } finally { await w.done(); }
});

test('MC3 states mounted: no call, not connected, and an unreadable list', async () => {
  let s = stubApi({ calls: { calls: [] } });
  let w = await mount('/validate/record/calls/calls', s.api);
  try { assert.ok(byId(w.container, 'mc-calls-empty')); } finally { await w.done(); }
  s = stubApi({ calls: { calls: [] }, setup: NOTHING });
  w = await mount('/validate/record/calls/calls', s.api);
  try { assert.match(text(byId(w.container, 'mc-calls-nc')), /Connect Google or Zoom/); } finally { await w.done(); }
  s = stubApi();
  s.api.channels.calls = s.fail(500);
  w = await mount('/validate/record/calls/calls', s.api);
  try { assert.ok(byId(w.container, 'mc-calls-error')); } finally { await w.done(); }
});

test('MC5 mounted: Rename speaker renames every line through one dialog; an empty name is refused; the switch; a time jumps to its audio', async () => {
  const s = stubApi();
  const w = await mount('/validate/record/calls/calls/40', s.api);
  try {
    assert.equal(text(byId(w.container, 'mc-consent')), 'Everyone recorded agreed, out loud.');
    assert.equal(byId(w.container, 'mc-turn-4'), undefined, 'a live segment is not the transcript');
    assert.ok(byId(w.container, 'mc-turn-translation-2'));
    await click(byId(w.container, 'mc-view-orig'));
    assert.equal(byId(w.container, 'mc-turn-translation-2'), undefined);
    await click(byId(w.container, 'mc-rename-Speaker 3'));
    assert.ok(byId(w.container, 'mc-rename-dialog'));
    await click(byId(w.container, 'mc-rename-dialog-confirm'));
    assert.match(text(byId(w.container, 'mc-rename-error')), /Give the speaker a name/);
    assert.equal(s.calls.filter((c) => c[0] === 'renameSpeaker').length, 0);
    await change(byId(w.container, 'mc-rename-input'), '[Participant B]');
    await click(byId(w.container, 'mc-rename-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'renameSpeaker').slice(1), [40, 'Speaker 3', '[Participant B]']);
    assert.equal(s.calls.filter((c) => c[0] === 'get').length, 2, 'the transcript is read again');
    assert.equal(byId(w.container, 'mc-rename-dialog'), undefined);
    await click(byId(w.container, 'mc-jump-2'));
    assert.equal(props(byId(w.container, 'mc-audio')).src, '/api/files/dl/c', 'the part holding 00:05:02');
  } finally { await w.done(); }
});

test('MC5 mounted: a failed rename keeps the dialog and says nothing changed; deleted audio says the text is kept', async () => {
  const s = stubApi();
  s.api.sessions.renameSpeaker = s.fail(500);
  s.api.sessions.audio = s.fail(404, { detail: 'audio_removed', message: 'The audio of this session was removed by your retention.' });
  const w = await mount('/validate/record/calls/calls/40', s.api);
  try {
    await click(byId(w.container, 'mc-rename-Speaker 3'));
    await change(byId(w.container, 'mc-rename-input'), '[Participant B]');
    await click(byId(w.container, 'mc-rename-dialog-confirm'));
    assert.match(text(byId(w.container, 'mc-rename-error')), /Nothing changed/);
    await click(byId(w.container, 'mc-jump-2'));
    assert.match(text(byId(w.container, 'mc-audio-removed')), /removed by your retention/);
  } finally { await w.done(); }
});

test('MC4 mounted: no upload before the attestation; the estimate; the parts as they are stored; done links to the call', async () => {
  const s = stubApi();
  const w = await mount('/validate/record/calls/upload?interview=4', s.api);
  try {
    assert.equal(props(byId(w.container, 'mc-upload-interview')).value, '4', 'Upload the recording carries its interview');
    assert.equal(props(byId(w.container, 'mc-upload-go')).disabled, true, 'no file yet');
    await change(byId(w.container, 'mc-upload-file'), [{ name: 'call.m4a' }]);
    await settle();
    assert.match(text(byId(w.container, 'mc-upload-estimate')), /42 min · transcribing it uses about \$0\.02 in AI tokens/);
    assert.equal(props(byId(w.container, 'mc-upload-go')).disabled, true, 'no attestation yet');
    assert.match(text(byId(w.container, 'mc-attest')), /Everyone recorded agreed/);
    await pickRadio(byId(w.container, 'mc-attest-written'));
    assert.equal(props(byId(w.container, 'mc-upload-go')).disabled, false);
    await click(byId(w.container, 'mc-upload-go'));
    const run = s.calls.find((c) => c[0] === 'run')[1];
    assert.deepEqual([run.target, run.attestation], [{ project_id: 7, interview_id: 4 }, { agreed: true, method: 'written' }]);
    assert.match(text(byId(w.container, 'mc-upload-progress')), /3 of 3 parts stored/);
    assert.match(text(byId(w.container, 'mc-upload-done')), /1 part was already stored/);
    assert.equal(props(walk(byId(w.container, 'mc-upload-done')).find((n) => props(n).href)).href, '/validate/record/calls/calls/61');
  } finally { await w.done(); }
});

test('MC4 mounted: an unreadable file, and a stopped upload that says it resumes', async () => {
  const s = stubApi({ decode: () => Promise.reject(new UploadError('undecodable')) });
  let w = await mount('/validate/record/calls/upload', s.api);
  try {
    await change(byId(w.container, 'mc-upload-file'), [{ name: 'x.bin' }]);
    await settle();
    assert.match(text(byId(w.container, 'mc-upload-unreadable')), /could not be read as audio on this device\. Export the call/);
  } finally { await w.done(); }
  const t = stubApi({ run: async ({ onProgress }) => { onProgress({ done: 2, total: 5 }); throw Object.assign(new Error('x'), { status: 503 }); } });
  w = await mount('/validate/record/calls/upload?interview=5', t.api);
  try {
    await change(byId(w.container, 'mc-upload-file'), [{ name: 'call.m4a' }]);
    await settle();
    await pickRadio(byId(w.container, 'mc-attest-verbal'));
    await click(byId(w.container, 'mc-upload-go'));
    assert.match(text(byId(w.container, 'mc-upload-error')), /carries on from the part it stopped at/);
    assert.match(text(byId(w.container, 'mc-upload-progress')), /2 of 5 parts stored/);
    assert.equal(byId(w.container, 'mc-upload-done'), undefined);
  } finally { await w.done(); }
});

test('MC6 mounted: the summary and the proposals list; Accept and Dismiss only through their dialogs', async () => {
  const s = stubApi();
  let w = await mount('/validate/record/calls/proposals', s.api);
  try {
    assert.ok(byId(w.container, 'mc-proposals-pick-40'));
    assert.equal(byId(w.container, 'mc-proposals-pick-41'), undefined, 'a call with nothing waiting is not listed');
  } finally { await w.done(); }
  w = await mount('/validate/record/calls/proposals/40', s.api);
  try {
    assert.match(text(byId(w.container, 'mc-summary')), /loses days each week.*track them on paper/s);
    for (const g of ['decisions', 'actions', 'data']) assert.ok(byId(w.container, `proposals-group-${g}`), g);
    assert.equal(byId(w.container, 'proposal-15'), undefined, 'a dismissed proposal is not offered again');
    assert.equal(text(byId(w.container, 'proposal-mod-13')), 'Validate › Demand and urgency signals');
    await click(byId(w.container, 'proposal-accept-11'));
    assert.equal(s.calls.filter((c) => c[0] === 'accept').length, 0);
    await click(byId(w.container, 'proposal-accept-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'accept').slice(1), [11]);
    await click(byId(w.container, 'proposal-dismiss-14'));
    await click(byId(w.container, 'proposal-dismiss-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'discard').slice(1), [14]);
    await click(byId(w.container, 'mc-summary-keep'));
    assert.equal(s.calls.filter((c) => c[0] === 'keepDigest').length, 0);
    await click(byId(w.container, 'mc-summary-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'keepDigest').slice(1), [40]);
  } finally { await w.done(); }
  const none = stubApi({ calls: { calls: [call(41, { pending_proposals: 0 })] } });
  w = await mount('/validate/record/calls/proposals', none.api);
  try { assert.match(text(byId(w.container, 'mc-proposals-none')), /Nothing to accept yet/); } finally { await w.done(); }
});

test('MC1 mounted: both cards; Allow transcript import and Reconnect go to Google only after the dialog; Zoom connects on its connector page; the notetaker is not available yet', async () => {
  const s = stubApi();
  let w = await mount('/validate/record/calls/connection', s.api);
  try {
    assert.ok(byId(w.container, 'mc-card-google_meet'));
    assert.match(text(byId(w.container, 'mc-pill-zoom')), /Zoom beta/);
    assert.match(text(byId(w.container, 'mc-prereq-zoom')), /paid Zoom plan.*Not checked by Axal/s);
    assert.equal(props(byId(w.container, 'mc-press-zoom')).href, '/account/connectors/zoom');
    assert.match(text(byId(w.container, 'mc-bot-later')), /Not available yet/);
    await click(byId(w.container, 'mc-press-meet_allow'));
    assert.equal(s.calls.filter((c) => c[0] === 'allowMeetTranscripts').length, 0);
    await click(byId(w.container, 'mc-press-dialog-confirm'));
    assert.equal(s.calls.find((c) => c[0] === 'allowMeetTranscripts')[1], 'record');
    await click(byId(w.container, 'mc-check-again'));
    assert.equal(s.calls.filter((c) => c[0] === 'meetingSetup').length, 2);
  } finally { await w.done(); }
  const e = stubApi({ google: { ...GOOGLE, sync_error: { code: 'connection_refused' } } });
  w = await mount('/validate/record/calls/connection', e.api);
  try {
    assert.match(text(byId(w.container, 'mc-pill-google_meet')), /Sign-in expired/);
    await click(byId(w.container, 'mc-press-google_reconnect'));
    await click(byId(w.container, 'mc-press-dialog-confirm'));
    assert.deepEqual(e.calls.find((c) => c[0] === 'googleCalConnect')[1], { return_to: 'record' });
    assert.equal(e.calls.find((c) => c[0] === 'assign')[1], 'https://accounts.google.com/o/oauth2/v2/auth?x=1');
  } finally { await w.done(); }
  const f = stubApi();
  f.api.channels.meetingSetup = f.fail(500);
  w = await mount('/validate/record/calls/connection', f.api);
  try { assert.ok(byId(w.container, 'mc-connect-error')); } finally { await w.done(); }
});

test('MC7 mounted: the setting saves through its dialog; each call\'s audio line; Delete audio only after its dialog', async () => {
  const s = stubApi();
  const w = await mount('/validate/record/calls/retention', s.api);
  try {
    assert.equal(props(byId(w.container, 'mc-retention-save')).disabled, true, 'nothing to save');
    assert.match(text(byId(w.container, 'mc-kept-audio-41')), /Audio kept until 20 Nov 2026/);
    assert.match(text(byId(w.container, 'mc-kept-audio-43')), /deleted 18 Oct 2026 by your retention · text kept/);
    assert.equal(byId(w.container, 'mc-delete-audio-43'), undefined, 'deleted audio has no Delete');
    await pickRadio(byId(w.container, 'mc-retention-7'));
    await click(byId(w.container, 'mc-retention-save'));
    assert.equal(s.calls.filter((c) => c[0] === 'setAudioRetention').length, 0);
    await click(byId(w.container, 'mc-retention-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'setAudioRetention').slice(1), [7]);
    await click(byId(w.container, 'mc-delete-audio-41'));
    assert.match(text(byId(w.container, 'mc-delete-dialog')) + (props(byId(w.container, 'mc-delete-dialog')).sub || ''), /transcript and anything accepted from it stay/);
    assert.equal(s.calls.filter((c) => c[0] === 'removeAudio').length, 0);
    await click(byId(w.container, 'mc-delete-dialog-confirm'));
    assert.deepEqual(s.calls.find((c) => c[0] === 'removeAudio').slice(1), [41]);
  } finally { await w.done(); }
  const e = stubApi({ calls: { calls: [] } });
  const v = await mount('/validate/record/calls/retention', e.api);
  try { assert.match(text(byId(v.container, 'mc-retention-empty')), /No recordings kept.*uploaded recordings too/s); } finally { await v.done(); }
});

test('the routes, the clients on Worker routes, and the house rules', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/validate/record/calls/:tab', '/validate/record/calls/:tab/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder']), <RecordChannelPage />)} />`), p);
  }
  const worker = read('cloudflare-worker/src/routes/founder_validate_sessions.ts');
  for (const r of ["sessions.get('/meetings/calls'", "sessions.patch('/sessions/:id/speakers'", "sessions.get('/sessions/audio-retention'", "sessions.put('/sessions/audio-retention'", "sessions.delete('/sessions/:id/audio'"]) {
    assert.ok(worker.includes(r), r);
  }
  const src = ['RecordCallsTool.jsx', 'callsModel.js'].map((f) => read(`frontend/src/pages/founder/${f}`)).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(alert|confirm|prompt|open)\(/);
  assert.doesNotMatch(code, /\b(advisor|advice|recommendation)s?\b/i);
  assert.doesNotMatch(code, /\bcredits?\b/i, 'AI tokens, never credits');
  for (const m of code.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) {
    if (/hover:underline/.test(m[1]) && !/hover:(bg|text|border)-/.test(m[1].replace('hover:underline', ''))) continue;
    assert.match(m[1], /dark:hover:/, m[1].slice(0, 90));
  }
  // The attestation's sentence is the upload helper's, which the Worker's methods match.
  assert.ok(read('cloudflare-worker/src/services/interviewSessions.ts').includes("'verbal'"));
});
