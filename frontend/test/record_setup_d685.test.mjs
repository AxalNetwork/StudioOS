/**
 * D685 (#1587) — the model behind the Record a session lightbox
 * (`pages/founder/recordSetup.js`): the canvas's copy, the chip statuses, the
 * estimate priced from the Worker's table, the consent gate, the meeting-link
 * rules, the talking points, and the body sent to today's route.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/record_setup_d685.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONSENTS, MODES, NOT_STORED, PROVIDERS, SETUP_FIELDS, callLabel, cents, chipStatus, connectionOf, consentNote, defaultProvider, estimate, isConnected,
  hasMeetingLink, meetingLinkProblem, money, parseConversation, sessionBody, startState, talkingPoints,
  FLUX, STAGE_WORD, assignTarget, languageOptions, newStartKey, pipelineRows, recordingHref, setupBody, startRefusal, threadsFor,
} from '../src/pages/founder/recordSetup.js';

const MODELS = {
  live: [{ model: 'nova', price_usd_per_minute: 0.0092, choosable: true }, { model: 'flux', price_usd_per_minute: 0.0077, choosable: true }],
  final: [{ model: 'whisper', price_usd_per_minute: 0.0005, choosable: true }, { model: 'unpriced', price_usd_per_minute: null, choosable: false }],
  defaults: { live: 'nova', final: 'whisper' },
};

const READ = {
  providers: [{ provider: 'telegram', available: true }, { provider: 'whatsapp', available: true }, { provider: 'zoom', available: false }, { provider: 'google_meet', available: true }],
  connections: [{ provider: 'telegram', connected: true }, { provider: 'whatsapp', connected: false }],
};

test('the four modes, their notes and their Start labels are the canvas\'s, word for word', () => {
  assert.deepEqual(MODES.map((m) => [m.key, m.label, m.start]), [
    ['in_person', 'In person', 'Start recording'], ['video', 'Video call', 'Start the call'],
    ['phone', 'Audio call', 'Start recording'], ['text', 'Text chat', 'Import the chat'],
  ]);
  assert.deepEqual(MODES.map((m) => m.note), [
    'Put the phone on the table between you. It records this device’s microphone.',
    'Paste the meeting link. It records the call’s audio.',
    'Put the call on speaker. It records this device’s microphone.',
    'No audio. Import the conversation from the app it happened in, or paste it.',
  ]);
  assert.deepEqual(MODES.map((m) => m.audio), [true, true, true, false]);
});

test('the chips per mode, and the default provider', () => {
  assert.deepEqual(PROVIDERS.in_person, []);
  assert.deepEqual(PROVIDERS.video.map((p) => p.label), ['Zoom', 'Google Meet', 'Microsoft Teams', 'WhatsApp video', 'Telegram video']);
  assert.deepEqual(PROVIDERS.phone.map((p) => p.label), ['This phone, on speaker', 'WhatsApp call', 'Telegram call', 'Signal call']);
  assert.deepEqual(PROVIDERS.text.map((p) => p.label), ['WhatsApp', 'Telegram', 'Paste a transcript', 'Signal', 'SMS', 'LinkedIn', 'Slack']);
  assert.equal(defaultProvider('video'), 'zoom');
  assert.equal(defaultProvider('phone'), 'phone_speaker');
  assert.equal(defaultProvider('in_person'), null);
  assert.equal(defaultProvider('text', null), 'paste', 'a disabled chip is never the default');
  assert.equal(defaultProvider('text', READ), 'whatsapp', 'a connectable one is');
  assert.equal(callLabel('video', 'zoom'), 'Video call · Zoom');
  assert.equal(callLabel('phone', 'whatsapp'), 'Audio call · WhatsApp call');
  assert.equal(callLabel('in_person', null), null);
  assert.equal(callLabel('text', 'paste'), null);
});

const chip = (mode, value) => PROVIDERS[mode].find((c) => c.value === value);

test('chip statuses: Connected, Connect, Ready, Not available yet; and an unreadable status never guesses', () => {
  assert.deepEqual(chipStatus('text', chip('text', 'telegram'), READ), { word: 'Connected', disabled: false });
  assert.deepEqual(chipStatus('text', chip('text', 'whatsapp'), READ), { word: 'Connect', disabled: false, connectHref: '/account/connectors' });
  assert.deepEqual(chipStatus('text', chip('text', 'paste'), READ), { word: 'Ready', disabled: false });
  assert.deepEqual(chipStatus('video', chip('video', 'teams'), READ), { word: 'Ready', disabled: false }, 'Teams records the tab; it needs no connection');
  for (const gone of ['signal', 'sms', 'linkedin', 'slack']) assert.deepEqual(chipStatus('text', chip('text', gone), READ), { word: 'Not available yet', disabled: true });
  // Zoom is not set up on this deployment: said so, but a call can still be recorded, so it is not disabled in Video.
  assert.deepEqual(chipStatus('video', chip('video', 'zoom'), READ), { word: 'Not available yet', disabled: false });
  assert.deepEqual(chipStatus('video', chip('video', 'google_meet'), READ), { word: 'Connect', disabled: false, connectHref: '/account/connectors' });
  // No read at all (the router is not mounted here yet, or the read failed): connection-backed chips say so; importing is disabled.
  assert.deepEqual(chipStatus('text', chip('text', 'telegram'), null), { word: 'Not available yet', disabled: true });
  assert.deepEqual(chipStatus('video', chip('video', 'zoom'), null), { word: 'Not available yet', disabled: false });
});

test('a connection is found whether the read lists them as an array or by key', () => {
  assert.equal(connectionOf(READ, 'telegram').connected, true);
  assert.equal(connectionOf({ connections: { zoom: { connected: true } } }, 'zoom').connected, true);
  assert.equal(connectionOf({ connections: { zoom: { connected: true } } }, 'constructor'), null, 'a prototype key is no connection');
  assert.equal(connectionOf(null, 'zoom'), null);
  assert.equal(chipStatus('video', chip('video', 'zoom'), { providers: [{ provider: 'zoom', available: true }], connections: { zoom: { connected: true } } }).word, 'Connected');
});

test('the estimate is priced from the Worker\'s table, in cents, and a missing price is not $0', () => {
  assert.equal(estimate(MODELS, 'nova', 'whisper', 30).text, '30 min ≈ $0.29 · live captions while you talk');
  assert.equal(estimate(MODELS, 'flux', 'whisper', 30).text, '30 min ≈ $0.25 · live captions while you talk', 'the canvas\'s $0.29 for Flux is its own sample, not a price');
  assert.equal(estimate(MODELS, null, 'whisper', 30).text, '30 min ≈ $0.02 · the transcript appears when you stop');
  assert.equal(money(30 * 0.0005), '$0.02');
  assert.equal(cents(0.015), 0.02, 'rounded, not truncated');
  assert.equal(estimate(MODELS, 'nova', 'unpriced', 30).usd, null);
  assert.equal(estimate(MODELS, 'nova', 'unpriced', 30).text, '30 min · Not priced');
  assert.equal(estimate(MODELS, 'ghost', 'whisper', 30).text, '30 min · Not priced', 'a live model with no price is Not priced');
  assert.equal(estimate(null, null, null, 30).text, '30 min · Not priced', 'no model list is not $0');
  assert.equal(estimate(MODELS, 'nova', 'whisper', 60).usd > estimate(MODELS, 'nova', 'whisper', 30).usd, true);
});

test('consent: four picks, none preselected, and the note follows the mode and the pick', () => {
  assert.deepEqual(CONSENTS.map(([, label]) => label), ['Said yes out loud', 'In writing', 'In the app', 'Agreed beforehand']);
  assert.deepEqual(CONSENTS.map(([k]) => k), ['verbal', 'written', 'in_app', 'pre_agreed'], 'the Worker\'s four methods');
  assert.equal(consentNote('in_person', ''), 'Audio starts only once consent is recorded.');
  assert.equal(consentNote('video', 'written'), 'Consent recorded. Audio starts when you press Start.');
  assert.equal(consentNote('text', ''), 'Optional for a text chat: needed only to quote it.');
  assert.equal(consentNote('text', 'verbal'), 'Optional for a text chat: needed only to quote it.');
});

test('Start: audio needs consent and a name; a text chat needs a conversation; a picked interview needs no name', () => {
  const base = { mode: 'in_person', consent: 'verbal', name: 'Dana', interview: null, conversation: '' };
  assert.equal(startState(base).ok, true);
  assert.equal(startState({ ...base, consent: '' }).ok, false);
  assert.equal(startState({ ...base, consent: '' }).reason, 'Audio starts only once consent is recorded.');
  assert.equal(startState({ ...base, consent: 'maybe' }).ok, false, 'only the Worker\'s methods count');
  assert.equal(startState({ ...base, name: '  ' }).reason, 'Add who you are talking to.');
  assert.equal(startState({ ...base, name: '', interview: { id: 7 } }).ok, true);
  assert.equal(startState({ ...base, mode: 'text', consent: '' }).ok, false, 'a text chat with nothing pasted');
  assert.equal(startState({ ...base, mode: 'text', consent: '', conversation: 'Dana: hi' }).ok, true, 'a text chat needs no consent to import');
  assert.equal(startState({ ...base, mode: 'text', consent: '', conversation: '   \n  ' }).ok, false);
});

test('a meeting link must be https, and its host must match the provider', () => {
  assert.equal(meetingLinkProblem('zoom', ''), null, 'optional');
  assert.equal(meetingLinkProblem('zoom', 'https://acme.zoom.us/j/123456789'), null);
  assert.equal(meetingLinkProblem('zoom', 'https://zoom.us/j/1'), null);
  assert.equal(meetingLinkProblem('zoom', 'https://evilzoom.us/j/1'), 'A Zoom link is on zoom.us.', 'a lookalike host is not zoom.us');
  assert.equal(meetingLinkProblem('zoom', 'https://zoom.us.evil.test/j/1'), 'A Zoom link is on zoom.us.');
  assert.equal(meetingLinkProblem('zoom', 'http://zoom.us/j/1'), 'The link must start with https://.');
  assert.equal(meetingLinkProblem('zoom', 'javascript:alert(1)'), 'The link must start with https://.');
  assert.equal(meetingLinkProblem('zoom', 'not a link'), 'That is not a link.');
  assert.equal(meetingLinkProblem('google_meet', 'https://meet.google.com/abc-defg-hij'), null);
  assert.equal(meetingLinkProblem('google_meet', 'https://notmeet.google.com/x'), 'A Google Meet link is on meet.google.com.');
  assert.equal(meetingLinkProblem('teams', 'https://teams.microsoft.com/l/meetup-join/x'), null);
  assert.equal(meetingLinkProblem('teams', 'https://teams.live.com/meet/1'), null);
  assert.equal(meetingLinkProblem('teams', 'https://x.teams.microsoft.com/y'), 'A Teams link is on teams.microsoft.com or teams.live.com.');
  assert.match(meetingLinkProblem('whatsapp', 'https://wa.me/1'), /no meeting link/);
  assert.match(meetingLinkProblem('telegram', 'https://t.me/x'), /no meeting link/);
  assert.equal(hasMeetingLink('video', 'zoom'), true);
  assert.equal(hasMeetingLink('video', 'whatsapp'), false, 'hidden for WhatsApp and Telegram video');
  assert.equal(hasMeetingLink('phone', 'zoom'), false);
});

test('talking points: open claims only, the current sprint\'s first, the first two on', () => {
  const board = [
    { id: 1, code: 'H1', claim: 'Ops leads lose a day to exports', sort_order: 3, retired_at: null, lane: 'none' },
    { id: 2, code: 'H2', claim: 'They would pay', sort_order: 2, retired_at: null, lane: 'testing', sprint: 4 },
    { id: 3, code: 'H3', claim: 'Done and proved', sort_order: 1, retired_at: null, lane: 'validated' },
    { id: 4, code: 'H4', claim: 'Retired', sort_order: 0, retired_at: '2026-10-01', lane: 'testing', sprint: 4 },
    { id: 5, code: 'H5', claim: 'Unclear', sort_order: 5, retired_at: null, lane: 'unknown' },
    { id: 6, code: 'H6', claim: 'Disproved', sort_order: 6, retired_at: null, lane: 'invalidated' },
    { id: 7, code: 'H7', claim: 'Testing with no sprint', sort_order: 1, retired_at: null, lane: 'testing', sprint: null },
  ];
  const pts = talkingPoints(board);
  assert.deepEqual(pts.map((p) => p.id), [2, 7, 1, 5], 'sprint testing first; then by sort_order; validated, invalidated and retired are out; inconclusive stays');
  assert.deepEqual(pts.map((p) => p.on), [true, true, false, false]);
  assert.equal(pts[0].text, 'H2 · They would pay');
  assert.deepEqual(talkingPoints(undefined), []);
  assert.deepEqual(talkingPoints([{ id: 1, lane: 'validated' }]), [], 'only closed claims leaves none');
  assert.deepEqual(talkingPoints([{ id: 1, lane: 'none', sort_order: 1 }, { id: 2, lane: 'none', sort_order: 1 }]).map((p) => p.id), [1, 2], 'ties break on id');
});

test('the session part of POST /sessions: every field is stored now, and a field turned off is never sent', () => {
  assert.deepEqual({ ...SETUP_FIELDS }, { points: true, language: true, call_provider: true, meeting_url: true, channels: true }, 'POST /sessions stores them all (#1591)');
  assert.match(NOT_STORED, /^Not saved yet/);
  const audio = { mode: 'video', consent: 'written', live: 'nova', final: 'whisper', provider: 'zoom', link: ' https://zoom.us/j/1 ', language: 'fr', points: [2, 7] };
  assert.deepEqual(sessionBody(audio), {
    channel: 'video', consent: { status: 'given', method: 'written' }, live_model: 'nova', final_model: 'whisper', language: 'fr', call_provider: 'zoom', meeting_url: 'https://zoom.us/j/1', points: [2, 7],
  });
  assert.deepEqual(sessionBody(audio, { points: false, language: false, call_provider: false, meeting_url: false }),
    { channel: 'video', consent: { status: 'given', method: 'written' }, live_model: 'nova', final_model: 'whisper' }, 'a flag off sends nothing for it');
  assert.equal('points' in sessionBody({ ...audio, points: [] }), false, 'no points picked sends none');
  assert.equal('language' in sessionBody({ ...audio, language: '' }), false, 'Detect sends none');
  assert.equal(sessionBody({ ...audio, live: null }).live_model, null, 'Off is null, not a model');
  assert.equal('meeting_url' in sessionBody({ ...audio, provider: 'whatsapp' }), false, 'WhatsApp video has no link');
  assert.equal('meeting_url' in sessionBody({ ...audio, link: '  ' }), false);
  const text = sessionBody({ mode: 'text', consent: '', conversation: 'Dana: hi\nwe log it', provider: 'paste' });
  assert.deepEqual(text, { channel: 'text', messages: [{ author: 'Dana', text: 'hi' }, { author: 'Me', text: 'we log it' }], call_provider: 'paste' });
  assert.equal('consent' in text, false, 'no pick, no quote consent');
  assert.deepEqual(sessionBody({ mode: 'text', consent: 'written', conversation: 'Dana: hi', provider: 'paste' }).consent, { method: 'written' },
    'a text chat\'s pick is quote consent (§5.1.4): the method alone, never an audio status');
  assert.equal('consent' in sessionBody({ mode: 'text', consent: 'maybe', conversation: 'Dana: hi' }), false, 'only the Worker\'s methods');
  assert.deepEqual(parseConversation(''), []);
});

test('setupBody: the project, who (picked by id, or named), the session, and the Start\'s client_key', () => {
  const s = { mode: 'in_person', consent: 'verbal', live: null, final: 'w', name: '  Dana ', company: ' ', points: [] };
  assert.deepEqual(setupBody(s, { projectId: '3', clientKey: 'k1' }), {
    project_id: 3, interviewee: { name: 'Dana', company: null }, channel: 'in_person', consent: { status: 'given', method: 'verbal' }, live_model: null, final_model: 'w', client_key: 'k1',
  });
  const picked = setupBody({ ...s, company: 'Acme' }, { projectId: 3, interview: { id: '9', interviewee_name: 'Old' }, clientKey: 'k2' });
  assert.equal(picked.interview_id, 9);
  assert.equal('interviewee' in picked, false, 'a picked interview is never made again');
  assert.match(newStartKey(), /^record-.{8,}$/);
  assert.notEqual(newStartKey(), newStartKey());
});

test('a refused Start: the Worker\'s words; 409 session_active points at that recording', () => {
  assert.deepEqual(startRefusal(Object.assign(new Error('Name the person you are talking to.'), { status: 400, code: 'interviewee_name_required' })),
    { text: 'Name the person you are talking to.', liveHref: null });
  const active = Object.assign(new Error('You are already recording another session.'), { status: 409, code: 'session_active', data: { session_id: 88 } });
  assert.deepEqual(startRefusal(active), { text: 'You are already recording another session.', liveHref: '/validate/record/live?session=88' });
  assert.equal(startRefusal({ ...active, message: active.message, code: 'session_active', data: {} }).liveHref, null, 'no id, no link');
  assert.equal(startRefusal({ message: 'x', code: 'other', data: { session_id: 88 } }).liveHref, null, 'only session_active points anywhere');
  assert.equal(startRefusal({ message: '  ' }).text, 'The session could not be created.');
});

test('/validate/record while this tab records: the live view, never the setup over it', () => {
  assert.equal(recordingHref({ phase: 'recording', session: { id: 5 } }), '/validate/record/live?session=5');
  assert.equal(recordingHref({ phase: 'paused', session: { id: 5 } }), '/validate/record/live?session=5');
  for (const phase of ['idle', 'share', 'denied', 'stopping', 'ready', 'discarded']) assert.equal(recordingHref({ phase, session: { id: 5 } }), null, phase);
  assert.equal(recordingHref({ phase: 'recording', session: null }), null);
  assert.equal(recordingHref(null), null);
  // Wired before the route's first early return, so it runs on every render of /validate/record.
  const route = readFileSync('frontend/src/pages/cycles/CycleRoute.jsx', 'utf8');
  assert.match(route, /const toLive = lightbox && cycle === 'validate' \? recordingHref\(recording\) : null;/, 'Validate\'s lightbox only: Build, Raise and Grow open their own');
  assert.match(route, /if \(toLive\) return <Navigate to=\{toLive\} replace \/>;\n  if \(!def\) return null;/);
});

test('the language: Detect, then the Worker\'s list; English only with Flux live', () => {
  const models = { languages: [{ code: 'en', name: 'English' }, { code: 'fr', name: 'French' }, { code: '', name: 'Bad' }, null] };
  assert.deepEqual(languageOptions(models, 'nova'), [{ code: '', name: 'Detect' }, { code: 'en', name: 'English' }, { code: 'fr', name: 'French' }]);
  assert.equal(FLUX, '@cf/deepgram/flux');
  assert.deepEqual(languageOptions(models, FLUX), [{ code: '', name: 'Detect' }, { code: 'en', name: 'English' }]);
  assert.deepEqual(languageOptions(null, 'nova'), [{ code: '', name: 'Detect' }], 'an unreadable list leaves Detect');
});

test('the recruiting pipeline as Who\'s picks; the chats one Text chip imports; the assignment', () => {
  const read = { records: { rows: [
    { id: 4, interviewee: 'Booked Bo', company: 'Acme', stage: 'booked' },
    { id: '5', interviewee: 'Lead Li', company: null, stage: 'lead' },
    { id: 6, interviewee: 'Done Di', company: 'X', stage: 'done' },
    { id: 'x', interviewee: 'No id', stage: 'invited' },
  ] } };
  assert.deepEqual(pipelineRows(read), [
    { id: 4, interviewee_name: 'Booked Bo', interviewee_company: 'Acme', stage: 'booked' },
    { id: 5, interviewee_name: 'Lead Li', interviewee_company: null, stage: 'lead' },
  ], 'the Worker\'s order (booked first), held interviews and bad ids out');
  assert.deepEqual(pipelineRows(null), []);
  assert.deepEqual(STAGE_WORD, { lead: 'Lead', invited: 'Invited', booked: 'Booked' });
  const threads = { items: [{ uid: 'a', provider: 'whatsapp' }, { uid: 'b', provider: 'telegram' }, { uid: '', provider: 'whatsapp' }] };
  assert.deepEqual(threadsFor(threads, 'whatsapp').map((t) => t.uid), ['a']);
  assert.deepEqual(threadsFor([{ uid: 'b', provider: 'telegram' }], 'telegram').map((t) => t.uid), ['b']);
  assert.deepEqual(threadsFor(null, 'telegram'), []);
  assert.deepEqual(assignTarget({ name: ' Dana ', company: ' Acme ', consent: '' }, { projectId: '3' }),
    { create: { interviewee_name: 'Dana', interviewee_company: 'Acme', project_id: 3 } });
  assert.deepEqual(assignTarget({ name: 'Dana', company: '', consent: 'in_app' }, { projectId: 3, interview: { id: '7' } }), { interview_id: 7, quote_consent: true });
  assert.equal(assignTarget({ name: 'D', company: '', consent: '' }, { projectId: 3 }).create.interviewee_company, null);
});

// #1586: the Text chips read their real status from the Worker's own read.
const WORKER_READ = {
  providers: [{ provider: 'telegram', available: true, missing: [] }, { provider: 'whatsapp', available: true, missing: [] }],
  connections: {
    telegram: { status: 'active', external_account_name: '@dana_biz', can_reply: true, business_connected: true },
    whatsapp: { status: 'active', external_account_name: 'Ledger Co', can_reply: true },
  },
  pending: { telegram: 2, whatsapp: 0 },
};

test('#1586 the chips read GET /api/channels as the Worker answers it', () => {
  assert.equal(SETUP_FIELDS.channels, true, 'the read is mounted on main (D684), so the chips use it');
  assert.deepEqual(chipStatus('text', chip('text', 'whatsapp'), WORKER_READ), { word: 'Connected', disabled: false });
  assert.deepEqual(chipStatus('text', chip('text', 'telegram'), WORKER_READ), { word: 'Connected', disabled: false });
  // Telegram linked, but Telegram Business not yet: no chat can arrive, so not Connected.
  const linkedOnly = { ...WORKER_READ, connections: { ...WORKER_READ.connections, telegram: { status: 'active', business_connected: false } } };
  assert.deepEqual(chipStatus('text', chip('text', 'telegram'), linkedOnly), { word: 'Connect', disabled: false, connectHref: '/account/connectors' });
  // A connection with a problem is not Connected either.
  const broken = { ...WORKER_READ, connections: { whatsapp: { status: 'error' } } };
  assert.deepEqual(chipStatus('text', chip('text', 'whatsapp'), broken), { word: 'Connect', disabled: false, connectHref: '/account/connectors' });
  assert.equal(defaultProvider('text', WORKER_READ), 'whatsapp');
});

test('#1586 isConnected: the Worker shape, the older flag, and nothing else', () => {
  assert.equal(isConnected({ status: 'active' }, 'whatsapp'), true);
  assert.equal(isConnected({ status: 'active', business_connected: true }, 'telegram'), true);
  assert.equal(isConnected({ status: 'active', business_connected: false }, 'telegram'), false);
  assert.equal(isConnected({ status: 'active' }, 'telegram'), true, 'a read without the flag is not taken for a missing link');
  assert.equal(isConnected({ status: 'disconnected' }, 'whatsapp'), false);
  assert.equal(isConnected({ connected: true }, 'zoom'), true);
  assert.equal(isConnected(null, 'whatsapp'), false);
});

test('#1588 attachesCall: video, Zoom or Meet, a valid link and that provider connected; attachOutcome keeps the Worker\'s words', async () => {
  const { attachesCall, attachOutcome } = await import('../src/pages/founder/recordSetup.js');
  const on = { connections: { zoom: { status: 'active' }, google_meet: { status: 'active' } } };
  assert.equal(attachesCall('video', 'zoom', 'https://acme.zoom.us/j/12345678', on), true);
  assert.equal(attachesCall('video', 'google_meet', 'https://meet.google.com/abc-defg-hij', on), true);
  assert.equal(attachesCall('audio', 'zoom', 'https://acme.zoom.us/j/12345678', on), false, 'video only');
  assert.equal(attachesCall('video', 'teams', 'https://teams.microsoft.com/l/x', on), false, 'Teams has no import');
  assert.equal(attachesCall('video', 'zoom', '', on), false, 'no link');
  assert.equal(attachesCall('video', 'zoom', 'https://evil.test/j/1', on), false, 'a link the field refuses');
  assert.equal(attachesCall('video', 'zoom', 'https://acme.zoom.us/j/12345678', { connections: { zoom: { status: 'revoked' } } }), false, 'not connected');
  assert.equal(attachesCall('video', 'zoom', 'https://acme.zoom.us/j/12345678', null), false, 'unreadable: not guessed');
  assert.deepEqual(attachOutcome({ notice: { message: ' Imported later. ' } }, null), { tone: 'attached', text: 'Imported later.' });
  assert.equal(attachOutcome({}, null).tone, 'attached');
  assert.deepEqual(attachOutcome(null, new Error('This meeting link is already attached to an interview.')), { tone: 'refused', text: 'This meeting link is already attached to an interview.' });
  assert.match(attachOutcome(null, {}).text, /The recording is not affected/);
});

test('#1588 the attach client posts { attach: { join_url }, session_id, provider } to the interview\'s meetings, and names only Zoom or Meet', async () => {
  const { channelsApi } = await import('../src/lib/api/channels.js');
  globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  const seen = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push([String(url), init?.method, JSON.parse(init?.body || 'null')]); return { ok: true, status: 201, headers: { get: () => 'application/json' }, json: async () => ({ ok: 1 }), text: async () => '{"ok":1}' }; };
  try {
    await channelsApi.attachMeeting(41, { session_id: '501', join_url: 'https://acme.zoom.us/j/12345678', provider: 'zoom' });
  } finally { globalThis.fetch = saved; }
  assert.equal(seen.length, 1);
  assert.match(seen[0][0], /\/founder\/validate\/interviews\/41\/meetings$/);
  assert.equal(seen[0][1], 'POST');
  assert.deepEqual(seen[0][2], { attach: { join_url: 'https://acme.zoom.us/j/12345678' }, session_id: 501, provider: 'zoom' });
  assert.throws(() => channelsApi.attachMeeting(41, { session_id: 1, join_url: 'x', provider: 'teams' }), /Unknown meeting provider/);
});
