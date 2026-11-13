/**
 * D878 (#2525) — Record a session › Calls, the boards MC1–MC7 on the reads
 * the Worker serves (D870–D877, and D878's one list), on WhatsApp's parts
 * (D862). Every API is stubbed; every value is invented, and no join link,
 * meeting id or email appears.
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
  MC_TABS, NOT_RECORDED, UNKNOWN_SPEAKER, audioAt, callConsent, callProposalGroups, callTimeline, callTurns, chunkCells, clock, mcHref, mcRoute,
  renameTargets, retentionChoice, retentionRows, setupCards, sourceBadge, speakerName, uploadEstimate, uploadRow, upcomingRows,
} from '../src/pages/founder/callsModel.js';
import { channelOf } from '../src/pages/founder/recordChannels.js';

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
    audience: 'beta', ready: false, next: 'app_open',
    steps: [step(1, 'set_up', 'done', 'zoom_set_up'), step(2, 'app_open', 'todo', 'zoom_beta', 'Zoom is open to invited founders only for now.'), step(3, 'connected', 'todo', 'zoom_not_connected', 'Connect Zoom in Account › Connectors.')],
    prerequisites: [{ key: 'zoom_cloud_transcript', line: 'Needs a paid Zoom plan with cloud recording on.', state: null }],
  },
  google_meet: {
    meet_transcripts: 'available', ready: false, next: 'transcripts',
    steps: [step(1, 'set_up', 'done', 'google_set_up'), step(2, 'connected', 'done', 'google_connected'), step(3, 'transcripts', 'todo', 'meet_scope_missing', 'Press Allow transcript import in Account › Connectors.')],
    prerequisites: [{ key: 'meet_transcription', line: 'Needs a Google Workspace edition with Meet transcription.', state: null }],
  },
};
const UPCOMING = {
  connected: true,
  calls: [
    { provider: 'zoom', title: '[Company C] · follow-up', starts_at: '2026-10-22T15:30:00Z', ends_at: '2026-10-22T16:00:00Z', join_url: 'https://zoom.us/j/11122233344',
      attach: { method: 'POST', path: '/api/founder/validate/interviews/:interview_id/meetings', body: {}, needs: ['interview_id', 'session_id'] }, attach_blocked: null },
    { provider: 'google_meet', title: '[Company A] · discovery call', starts_at: '2026-10-22T10:00:00Z', ends_at: '2026-10-22T10:45:00Z', join_url: 'https://meet.google.com/abc-mnop-xyz',
      attach: { method: 'POST', path: '/api/founder/validate/interviews/:interview_id/meetings', body: {}, needs: ['interview_id', 'session_id'] }, attach_blocked: null },
    { provider: 'google_meet', title: '', starts_at: '2026-10-24T09:00:00Z', ends_at: null, join_url: 'https://meet.google.com/qrs-tuvw-xyz',
      attach: null, attach_blocked: 'Axal can import only a Meet call you organize.' },
  ],
};
const call = (id, o = {}) => ({ id, provider: 'google_meet', state: 'imported', source: 'scheduled', error_code: null, error: null, starts_at: '2026-10-21T10:00:00Z', ends_at: '2026-10-21T10:45:00Z', company: { id: 7, name: '[Company A]' }, interview_id: 4, session_id: 41, transcript_source: 'native', ...o });
const CALLS = {
  calls: [
    call('ref-a'),
    call('ref-b', { provider: 'zoom', state: 'no_transcript', session_id: 42, transcript_source: null, error: 'Zoom saved no transcript for this call.' }),
    call('ref-c', { provider: 'zoom', state: 'failed', session_id: 43, transcript_source: null }),
  ],
  uploads: [{ session_id: 51, interview_id: 4, company: { id: 7, name: '[Company A]' }, interviewee: '[Participant]', created_at: '2026-10-21T12:00:00Z', status: 'stopped', processing_stage: 'done' }],
  audio: [
    { session_id: 41, held: true, removed_at: null, removed_reason: null, expires_at: '2026-11-20T10:56:00Z' },
    { session_id: 42, held: false, removed_at: '2026-10-18T03:00:00Z', removed_reason: 'retention', expires_at: null },
    { session_id: 51, held: true, removed_at: null, removed_reason: null, expires_at: null },
  ],
  retention: { days: 30, chosen: false },
};
const SEGMENTS = [
  { id: 1, source: 'final', start_ms: 8000, speaker_label: 'Me', text: 'Before we start, is it all right if I record this call?', translation_status: 'same' },
  { id: 2, source: 'final', start_ms: 14000, speaker_label: '[Participant]', text: 'Yes, that is fine.', translation_status: 'same' },
  { id: 3, source: 'final', start_ms: 302000, speaker_label: null, text: 'Nosotros usamos listas en papel.', translation: 'We use paper checklists.', translation_status: 'done', source_lang: 'es' },
  { id: 4, source: 'final', start_ms: 330000, speaker_label: 'Speaker ?', text: 'Y se pierden en la obra.', translation: null, translation_status: 'pending', source_lang: 'es' },
  { id: 5, source: 'live', start_ms: 1000, speaker_label: 'Me', text: 'a live draft is never shown' },
];
const PLACEMENTS = { runs: [{ run_id: 'r1', source: 'studioos', placements: [
  { id: 71, kind: 'decision', payload: { statement: 'Run a two-site pilot', owner_hint: 'both', confidence: 0.9 }, status: 'pending', can_accept: true, cite: { quote: 'Let us try it on two sites first.' } },
  { id: 72, kind: 'follow_up', payload: { kind: 'action_item', detail: 'send the pilot price sheet', owner_hint: '[Name]', due_hint: 'Friday', confidence: 0.85 }, status: 'pending', can_accept: true, cite: { quote: 'Can you send me the price per site?' } },
  { id: 73, kind: 'demand_signal', payload: { signal: 'price', confidence: 0.7 }, status: 'pending', can_accept: true, cite: { quote: 'About a fixed amount a month per site.' } },
  { id: 74, kind: 'decision', payload: { statement: 'An old one' }, status: 'accepted', can_accept: true, cite: null },
] }] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('addresses: six tabs in the canvas’s order, each a path; a session only on Calls and Proposals', () => {
  assert.deepEqual(MC_TABS.map((t) => t.label), ['Upcoming', 'Calls', 'Upload', 'Proposals', 'Connection', 'Retention']);
  assert.deepEqual(mcRoute('/validate/record/calls'), { tab: 'upcoming', id: null });
  assert.deepEqual(mcRoute('/validate/record/calls/all'), { tab: 'calls', id: null });
  assert.deepEqual(mcRoute('/validate/record/calls/all/41/'), { tab: 'calls', id: 41 });
  assert.deepEqual(mcRoute('/validate/record/calls/proposals/41'), { tab: 'proposals', id: 41 });
  for (const bad of ['/validate/record/calls/upload/3', '/validate/record/calls/retention/1', '/validate/record/calls/nope', '/validate/record/calls/all/0', '/validate/record/calls/all/1/x', '/validate/record/whatsapp']) {
    assert.equal(mcRoute(bad), null, bad);
  }
  assert.equal(mcHref('calls', 41), '/validate/record/calls/all/41');
  assert.equal(mcHref('upload', 41), '/validate/record/calls/upload', 'Upload reads no session');
  assert.equal(channelOf('/validate/record/calls').key, 'calls');
});

test('MC1: each provider’s steps in the canvas’s words, the Worker’s sentence, the plan requirement, and one press', () => {
  const [meet, zoom] = setupCards(SETUP);
  assert.equal(meet.name, 'Google Meet');
  assert.deepEqual(meet.steps.map((s) => [s.t, s.pill]), [['Available on Axal', 'Done'], ['Connected', 'Done'], ['Transcript access', 'To do']]);
  assert.match(meet.steps[2].action, /Allow transcript import/);
  assert.deepEqual(meet.press, { kind: 'allow', t: 'Allow transcript import' });
  assert.match(meet.prerequisite, /Workspace edition/);
  // Mutation checked: read `audience` from the wrong provider → Zoom's beta pill reads "Your move".
  assert.deepEqual(zoom.pill, { t: 'Zoom beta: open to invited founders', tone: 'lav' });
  assert.equal(zoom.press, null, 'the first open step is the beta, which no press here answers');
  const connected = setupCards({ zoom: { ...SETUP.zoom, audience: 'public', steps: [SETUP.zoom.steps[0], step(2, 'app_open', 'done', 'zoom_open'), SETUP.zoom.steps[2]] } })[0];
  assert.deepEqual(connected.press, { kind: 'link', t: 'Connect Zoom', to: '/account/connectors/zoom' });
  assert.deepEqual(setupCards({ google_meet: { ...SETUP.google_meet, ready: true } })[0].pill, { t: 'Ready', tone: 'pos' });
});

test('MC2: soonest first; a Meet call is attached here, a Zoom call says where, a refused one says why; never the link', () => {
  const rows = upcomingRows(UPCOMING.calls, 'UTC');
  assert.deepEqual(rows.map((r) => r.provider), ['google_meet', 'zoom', 'google_meet']);
  assert.equal(rows[0].time, '10:00 – 10:45');
  assert.deepEqual([rows[0].wd, rows[0].day, rows[0].mon], ['THU', '22', 'OCT']);
  assert.equal(rows[0].canAttach, true);
  // Mutation checked: offer Attach on a Zoom row → its press needs a recording session the page does not have.
  assert.equal(rows[1].canAttach, false);
  assert.match(rows[1].note, /start a video session/);
  assert.equal(rows[2].canAttach, false);
  assert.equal(rows[2].note, 'Axal can import only a Meet call you organize.');
  assert.equal(rows[2].title, 'Title not recorded');
  assert.equal(rows[2].time, '09:00', 'no end, no invented end');
  const shown = JSON.stringify(rows.map(({ join, ...r }) => r));
  assert.doesNotMatch(shown, /zoom\.us|meet\.google\.com|11122233344/);
});

test('MC3: the timeline, the stop with its reason and next steps, and the badge that says how the text was made', () => {
  const ok = callTimeline(CALLS.calls[0], 'UTC');
  assert.deepEqual(ok.steps.map((s) => [s.t, s.state]), [['Scheduled', 'done'], ['Ended', 'done'], ['Transcript ready', 'done'], ['Imported', 'done']]);
  assert.match(ok.steps[0].at, /21 Oct 2026/);
  assert.equal(ok.steps[1].at, '', 'only the scheduled time is stored');
  assert.equal(ok.badge, 'Meet transcript');
  assert.equal(ok.open, true);
  const none = callTimeline(CALLS.calls[1]);
  assert.deepEqual(none.steps.map((s) => [s.t, s.state]), [['Scheduled', 'done'], ['Ended', 'done'], ['No transcript', 'stop']]);
  assert.equal(none.steps[2].at, 'Zoom saved no transcript for this call.', 'Axal’s own sentence from the Worker');
  assert.deepEqual(none.next.map((n) => n.kind), ['upload']);
  assert.equal(none.badge, null);
  // Mutation checked: offer retry on no_transcript → there is nothing to read again.
  assert.deepEqual(callTimeline(CALLS.calls[2]).next.map((n) => n.kind), ['retry', 'upload']);
  assert.deepEqual(callTimeline(call('x', { state: 'cancelled' })).steps.map((s) => s.t), ['Scheduled', 'Cancelled']);
  assert.deepEqual(callTimeline(call('x', { state: 'ended' })).steps.map((s) => s.state), ['done', 'done', 'todo', 'todo']);
  // Whisper's text is never called the provider's transcript.
  assert.equal(sourceBadge(call('w', { provider: 'zoom', transcript_source: 'whisper' })), 'Transcribed by Axal');
  assert.equal(sourceBadge(call('n', { provider: 'zoom' })), 'Zoom transcript');
  assert.equal(sourceBadge(call('u', { transcript_source: null })), `Source: ${NOT_RECORDED}`);
  assert.match(callTimeline(call('t', { provider: 'zoom', state: 'transcript_ready' })).whisperNote, /Transcribed by Axal/);
  assert.deepEqual(uploadRow(CALLS.uploads[0]).status, { t: 'Transcript ready', tone: 'pos' });
  assert.equal(uploadRow({ ...CALLS.uploads[0], processing_stage: 'failed' }).status.t, 'Transcription stopped');
});

test('MC5: speakers by name or “Speaker ?”, each turn’s time into the call; finals only; a rename reaches every passage of that speaker', () => {
  const turns = callTurns(SEGMENTS, 'both');
  assert.deepEqual(turns.map((t) => t.id), [1, 2, 3, 4], 'the live draft is never shown');
  assert.deepEqual(turns.map((t) => t.who), ['You', '[Participant]', UNKNOWN_SPEAKER, UNKNOWN_SPEAKER]);
  assert.deepEqual(turns.map((t) => t.at), ['00:00:08', '00:00:14', '00:05:02', '00:05:30']);
  assert.equal(turns[0].canRename, false, 'the founder is never renamed');
  assert.equal(turns[2].showTranslation, true);
  assert.equal(callTurns(SEGMENTS, 'orig')[2].showTranslation, false);
  assert.equal(turns[3].pending, true);
  // Mutation checked: match labels without the "Speaker ?" fallback → the null-labelled passage is left out.
  assert.deepEqual(renameTargets(SEGMENTS, UNKNOWN_SPEAKER), [3, 4]);
  assert.deepEqual(renameTargets(SEGMENTS, 'Me'), []);
  assert.equal(speakerName('  [Participant]   B '), '[Participant] B');
  assert.equal(speakerName('me'), null);
  assert.equal(speakerName(''), null);
  assert.equal(speakerName('x'.repeat(90)).length, 80);
  assert.equal(clock(null), null);
  assert.equal(clock(3723000), '01:02:03');
});

test('jump to audio: the chunk a turn falls in and the offset inside it; none without a time', () => {
  const parts = [{ seq: 0, start_ms: 0, url: '/a' }, { seq: 1, start_ms: 120000, url: '/b' }, { seq: 2, start_ms: 240000, url: '/c' }];
  assert.deepEqual(audioAt(parts, 302000), { part: parts[2], offset: 62 });
  assert.deepEqual(audioAt(parts, 14000), { part: parts[0], offset: 14 });
  assert.equal(audioAt(parts, null), null);
  assert.equal(audioAt([], 5), null);
});

test('consent: the session’s own record in plain words, or not recorded', () => {
  assert.equal(callConsent({ consent_status: 'given', consent_method: 'verbal' }).t, 'Everyone recorded agreed, out loud.');
  assert.equal(callConsent({ consent_status: 'given', consent_method: 'pre_agreed' }).t, 'Everyone recorded agreed, beforehand.');
  assert.equal(callConsent({ consent_status: 'not_recorded' }).tone, 'amb');
});

test('MC6: decisions, action items, then data points with their module; pending only', () => {
  const groups = callProposalGroups(PLACEMENTS);
  assert.deepEqual(groups.map((g) => g.g), ['Decisions', 'Action items', 'Data points']);
  assert.deepEqual(groups[0].items.map((i) => i.id), [71], 'an accepted decision is never offered again');
  assert.equal(groups[0].items[0].t, 'Run a two-site pilot (both)');
  // Mutation checked: leave action items out of their group → this line is gone.
  assert.equal(groups[1].items[0].t, '[Name]: send the pilot price sheet by Friday');
  assert.equal(groups[2].mod, 'Validate › Demand and urgency signals');
  assert.equal(groups[0].items[0].conf.t, 'High');
  assert.deepEqual(callProposalGroups({ runs: [] }), []);
});

test('MC4: the progress cells and the estimate in AI tokens', () => {
  assert.deepEqual(chunkCells(7, 12), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'now', 'rest', 'rest', 'rest', 'rest']);
  assert.deepEqual(chunkCells(12, 12).filter((c) => c === 'done').length, 12);
  assert.ok(chunkCells(0, 0).every((c) => c === 'rest'));
  assert.deepEqual(uploadEstimate(42 * 60000), { minutes: 42, usd: 0.02 });
  assert.equal(uploadEstimate(0), null);
});

test('MC7: the retention held; each session’s audio kept until a date, removed with its reason, or never held', () => {
  assert.equal(retentionChoice({ days: 30 }).key, '30');
  assert.equal(retentionChoice({ days: null }).t, 'Until I delete it');
  assert.equal(retentionChoice({ days: 45 }).t, '45 days');
  const rows = retentionRows(CALLS, 'UTC');
  const by = Object.fromEntries(rows.map((r) => [r.sessionId, r]));
  assert.equal(by[41].t, 'Audio kept until 20 Nov 2026');
  assert.equal(by[41].has, true);
  assert.equal(by[42].t, 'Audio removed after your retention 18 Oct 2026 · text kept');
  assert.equal(by[42].has, false);
  assert.equal(by[43].t, 'No audio kept · text kept');
  assert.equal(by[51].t, 'Audio kept until you delete it');
  assert.equal(by[51].sub, 'Uploaded · 21 Oct 2026');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stubApi(o = {}) {
  const calls = [];
  const rec = (name, value) => (...a) => { calls.push([name, ...a]); return typeof value === 'function' ? value(...a) : Promise.resolve(value); };
  return {
    calls,
    api: {
      channels: {
        meetingSetup: rec('meetingSetup', o.setup ?? SETUP),
        upcomingCalls: rec('upcomingCalls', o.upcoming ?? UPCOMING),
        calls: rec('calls', o.calls ?? CALLS),
        attachCalendarMeet: rec('attachCalendarMeet', { meeting: { id: 'ref-new' } }),
        importMeeting: rec('importMeeting', { ok: true }),
      },
      sessions: {
        get: rec('get', o.session ?? { session: { id: 41, interview_id: 4, submitted_via: 'google_meet', consent_status: 'given', consent_method: 'verbal', started_at: '2026-10-21T10:00:00Z' }, segments: SEGMENTS, chunks: [{ seq: 0, start_ms: 0 }], summary: { text: '[Company A] loses days each week waiting for inspections.', transcript: { source: 'native' } } }),
        setSpeaker: rec('setSpeaker', { ok: true }),
        audio: rec('audio', { parts: [{ seq: 0, start_ms: 0, url: '/api/files/dl/fixture' }] }),
        placements: rec('placements', PLACEMENTS),
        accept: rec('accept', { ok: true }), discard: rec('discard', { ok: true }), acceptAll: rec('acceptAll', { accepted: 3, remaining: 0 }),
        audioRetention: rec('audioRetention', { days: 30, chosen: false, default_days: 30, min_days: 1, max_days: 3650 }),
        setAudioRetention: rec('setAudioRetention', { days: 7, chosen: true }),
        deleteAudio: rec('deleteAudio', { ok: true }),
        remove: rec('remove', { ok: true }),
      },
      app: { listProjects: rec('listProjects', [{ id: 7, name: '[Company A]' }]), listInterviews: rec('listInterviews', [{ id: 4, interviewee_name: '[Participant]' }]) },
      allowMeetTranscripts: rec('allowMeetTranscripts', 'https://accounts.google.com/o/oauth2/fixture'),
      uploadRecording: o.uploadRecording ?? rec('uploadRecording', (args) => { args.onProgress?.({ done: 1, total: 2 }); args.onProgress?.({ done: 2, total: 2 }); return Promise.resolve({ sessionId: 51, parts: 2, sent: 2, skipped: 0 }); }),
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
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });
const change = async (n, target) => act(async () => { await props(n).onChange?.({ target }); await new Promise((r) => setTimeout(r, 0)); });

test('MC2 mounted: the Calls page draws the tool and its six tabs; Attach asks for the interview and consent before it writes', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls', api);
  try {
    assert.ok(byId(w.container, 'record-channel-calls'));
    assert.ok(byId(w.container, 'mc-tool'), 'Calls draws the tool, not D1309’s Today');
    assert.equal(byId(w.container, 'record-channel-wait'), undefined);
    for (const t of MC_TABS) assert.ok(byId(w.container, `mc-tab-${t.key}`), t.key);
    assert.ok(byId(w.container, 'mc-upcoming-list'));
    assert.doesNotMatch(text(w.container), /zoom\.us|meet\.google\.com/);
    await click(byId(w.container, 'mc-upcoming-attach'));
    assert.ok(byId(w.container, 'mc-attach'));
    // Mutation checked: enable Attach without a consent method → it writes with none.
    assert.equal(props(byId(w.container, 'mc-attach-confirm')).disabled, true, 'no consent, no attach');
    assert.equal(calls.filter((c) => c[0] === 'attachCalendarMeet').length, 0);
    await change(byId(w.container, 'mc-attach-consent-written'), {});
    await click(byId(w.container, 'mc-attach-confirm'));
    const sent = calls.find((c) => c[0] === 'attachCalendarMeet');
    assert.deepEqual(sent.slice(1), [4, { join_url: 'https://meet.google.com/abc-mnop-xyz', consent: { status: 'given', method: 'written' } }]);
    assert.match(text(byId(w.container, 'mc-upcoming-note')), /Attached/);
  } finally { await w.done(); }
});

test('MC2 mounted: an expired Google sign-in reads Reconnect; no calendar reads not connected', async () => {
  const expired = stubApi({ upcoming: () => Promise.reject(Object.assign(new Error('Reconnect Google to read your calendar.'), { status: 409 })) });
  let w = await mount('/validate/record/calls', expired.api);
  try {
    assert.match(text(byId(w.container, 'mc-upcoming-reconnect')), /Reconnect Google to read your calendar/);
  } finally { await w.done(); }
  w = await mount('/validate/record/calls', stubApi({ upcoming: { connected: false, calls: [] } }).api);
  try {
    assert.ok(byId(w.container, 'mc-upcoming-nc'));
    assert.equal(props(byId(w.container, 'mc-upcoming-nc-connect')).href, '/validate/record/calls/connection');
  } finally { await w.done(); }
  w = await mount('/validate/record/calls', stubApi({ upcoming: { connected: true, calls: [] } }).api);
  try { assert.match(text(byId(w.container, 'mc-upcoming-empty')), /No calls in the next 14 days/); } finally { await w.done(); }
});

test('MC3 mounted: each call’s timeline; a failed import is tried again only after its dialog', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/all', api);
  try {
    assert.equal(props(byId(w.container, 'mc-call-step-ref-b-no_transcript'))['data-state'], 'stop');
    assert.match(text(byId(w.container, 'mc-call-badge-ref-a')), /Meet transcript/);
    assert.equal(props(byId(w.container, 'mc-call-open-ref-a')).href, '/validate/record/calls/all/41');
    assert.equal(props(byId(w.container, 'mc-call-upload-ref-b')).href, '/validate/record/calls/upload');
    assert.ok(byId(w.container, 'mc-upload-row-51'));
    await click(byId(w.container, 'mc-call-retry-ref-c'));
    assert.equal(calls.filter((c) => c[0] === 'importMeeting').length, 0, 'retry asks first');
    await click(byId(w.container, 'mc-retry-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'importMeeting').slice(1), [4, 'ref-c']);
  } finally { await w.done(); }
  const empty = await mount('/validate/record/calls/all', stubApi({ calls: { calls: [], uploads: [], audio: [], retention: { days: 30 } } }).api);
  try { assert.match(text(byId(empty.container, 'mc-calls-empty')), /No call yet/); } finally { await empty.done(); }
  const broken = await mount('/validate/record/calls/all', stubApi({ calls: () => Promise.reject(Object.assign(new Error('x'), { status: 500 })) }).api);
  try { assert.match(text(byId(broken.container, 'mc-calls-error')), /could not be read/); } finally { await broken.done(); }
});

test('MC5 mounted: speakers, times, the switch, consent; Rename speaker renames every passage of theirs after its dialog', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/all/41', api);
  try {
    assert.equal(text(byId(w.container, 'mc-turn-who-3')), UNKNOWN_SPEAKER);
    assert.equal(text(byId(w.container, 'mc-turn-jump-3')), '00:05:02');
    assert.match(text(byId(w.container, 'mc-tx-consent')), /Everyone recorded agreed, out loud/);
    assert.match(text(byId(w.container, 'mc-tx-meta')), /Google Meet transcript/);
    assert.ok(byId(w.container, 'mc-turn-translation-3'));
    await click(byId(w.container, 'mc-tx-view-orig'));
    assert.equal(byId(w.container, 'mc-turn-translation-3'), undefined);
    assert.equal(byId(w.container, 'mc-turn-rename-1'), undefined, 'the founder is never renamed');
    await click(byId(w.container, 'mc-turn-rename-3'));
    assert.match(text(w.container), /2 passages by “Speaker \?” in this call take the new name/);
    assert.equal(props(byId(w.container, 'mc-rename-confirm')).disabled, true, 'no name, no rename');
    await change(byId(w.container, 'mc-rename-input'), { value: '[Participant] B' });
    await click(byId(w.container, 'mc-rename-confirm'));
    assert.deepEqual(calls.filter((c) => c[0] === 'setSpeaker').map((c) => c.slice(1)), [[41, 3, '[Participant] B'], [41, 4, '[Participant] B']]);
    await click(byId(w.container, 'mc-turn-jump-2'));
    assert.deepEqual(calls.filter((c) => c[0] === 'audio').map((c) => c[1]), [41], 'a jump asks for fresh audio links');
  } finally { await w.done(); }
});

test('MC4 mounted: Upload stays off until a file and the attestation; it reports progress and opens the transcript', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/upload', api);
  try {
    assert.equal(props(byId(w.container, 'mc-upload-start')).disabled, true);
    await change(byId(w.container, 'mc-upload-file'), { files: [{ name: 'call.m4a', size: 10, lastModified: 1 }] });
    // Mutation checked: drop the attestation from `ready` → the upload starts without it.
    assert.equal(props(byId(w.container, 'mc-upload-start')).disabled, true, 'no attestation, no upload');
    await change(byId(w.container, 'mc-upload-attest-verbal'), {});
    assert.equal(props(byId(w.container, 'mc-upload-start')).disabled, false);
    await click(byId(w.container, 'mc-upload-start'));
    const sent = calls.find((c) => c[0] === 'uploadRecording')[1];
    assert.deepEqual(sent.attestation, { agreed: true, method: 'verbal' });
    assert.deepEqual(sent.target, { project_id: 7, interview_id: 4 });
    assert.equal(sent.api, api.sessions, 'the recorder’s own routes (D872)');
    assert.match(text(byId(w.container, 'mc-upload-progress')), /2 of 2 parts stored/);
    assert.ok(byId(w.container, 'mc-upload-done'));
  } finally { await w.done(); }
  const failing = stubApi({ uploadRecording: () => Promise.reject(Object.assign(new Error('This file has no sound in it.'), { name: 'UploadError' })) });
  const f = await mount('/validate/record/calls/upload', failing.api);
  try {
    await change(byId(f.container, 'mc-upload-file'), { files: [{ name: 'quiet.mp3', size: 10, lastModified: 1 }] });
    await change(byId(f.container, 'mc-upload-attest-written'), {});
    await click(byId(f.container, 'mc-upload-start'));
    assert.match(text(byId(f.container, 'mc-upload-error')), /no sound/);
  } finally { await f.done(); }
});

test('MC6 mounted: the summary, then decisions, action items and data points, each accepted only after its dialog', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/proposals/41', api);
  try {
    assert.match(text(byId(w.container, 'mc-summary-text')), /waiting for inspections/);
    assert.ok(byId(w.container, 'proposals-group-decisions'));
    assert.ok(byId(w.container, 'proposals-group-actions'));
    assert.ok(byId(w.container, 'proposals-group-data'));
    await click(byId(w.container, 'proposal-accept-71'));
    assert.equal(calls.filter((c) => c[0] === 'accept').length, 0);
    await click(byId(w.container, 'proposal-accept-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'accept').slice(1), [71]);
  } finally { await w.done(); }
  const pick = await mount('/validate/record/calls/proposals', stubApi().api);
  try {
    assert.ok(byId(pick.container, 'mc-prop-pick-41'), 'an imported call');
    assert.ok(byId(pick.container, 'mc-prop-pick-51'), 'an upload');
    assert.equal(byId(pick.container, 'mc-prop-pick-42'), undefined, 'a call with no transcript has nothing to propose');
  } finally { await pick.done(); }
});

test('MC7 mounted: the held choice; changing it, deleting audio and deleting a session each ask first', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/retention', api);
  try {
    assert.equal(props(byId(w.container, 'mc-ret-30'))['aria-checked'], 'true');
    assert.match(text(byId(w.container, 'mc-ret-line-41')), /Audio kept until/);
    assert.equal(byId(w.container, 'mc-ret-del-audio-42'), undefined, 'removed audio cannot be deleted again');
    await click(byId(w.container, 'mc-ret-7'));
    assert.equal(calls.filter((c) => c[0] === 'setAudioRetention').length, 0);
    await click(byId(w.container, 'mc-ret-days-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'setAudioRetention').slice(1), [7]);
    await click(byId(w.container, 'mc-ret-del-audio-41'));
    await click(byId(w.container, 'mc-ret-audio-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'deleteAudio').slice(1), [41]);
    await click(byId(w.container, 'mc-ret-del-session-51'));
    await click(byId(w.container, 'mc-ret-session-dialog-confirm'));
    assert.deepEqual(calls.find((c) => c[0] === 'remove').slice(1), [51]);
  } finally { await w.done(); }
});

test('MC1 mounted: both cards, their steps and plan lines; Allow transcript import goes through Google, back to Record a session', async () => {
  const { api, calls } = stubApi();
  const w = await mount('/validate/record/calls/connection', api);
  try {
    assert.match(text(byId(w.container, 'mc-connect-pill-zoom')), /Zoom beta/);
    assert.match(text(byId(w.container, 'mc-prereq-google_meet')), /not checked by Axal/);
    assert.ok(byId(w.container, 'mc-step-zoom-connected'));
    await click(byId(w.container, 'mc-connect-press-google_meet'));
    await settle();
    assert.deepEqual(calls.find((c) => c[0] === 'allowMeetTranscripts').slice(1), ['record']);
  } finally { await w.done(); }
});

test('the routes, the client methods on real Worker routes, and the house rules', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of ['/validate/record/calls/:tab', '/validate/record/calls/:tab/:id']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder']), <RecordChannelPage />)} />`), p);
  }
  const worker = read('cloudflare-worker/src/routes/founder_validate_meetings.ts') + read('cloudflare-worker/src/routes/founder_validate_sessions.ts');
  for (const r of ["meetings.get('/meetings'", "sessions.get('/meetings/setup'", "sessions.get('/meetings/upcoming'", "sessions.get('/sessions/audio-retention'", "sessions.put('/sessions/audio-retention'", "sessions.delete('/sessions/:id/audio'"]) {
    assert.ok(worker.includes(r), r);
  }
  const src = ['RecordCallsTool.jsx', 'callsModel.js'].map((f) => read(`frontend/src/pages/founder/${f}`)).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(alert|confirm|prompt)\(/);
  assert.doesNotMatch(code, /\b(advisor|advice|recommendation)s?\b/i);
  assert.doesNotMatch(code, /@[a-z0-9-]+\.[a-z]/i, 'no email address');
  for (const m of code.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) {
    if (/hover:underline/.test(m[1]) && !/hover:(bg|text|border)-/.test(m[1].replace('hover:underline', ''))) continue;
    assert.match(m[1], /dark:hover:/, m[1].slice(0, 90));
  }
});
