/**
 * D871 (#2518) — Google Meet: attach a call from the member's own Calendar,
 * name its speakers, and the no-transcript path with the Drive recording.
 *
 * The D685 attach fixture (routes driven with a signed session, every Google
 * request mocked and recorded). Covers:
 *   · attach by Meet code, link or event id with no session: the member's own
 *     organised event only, with consent; the event's times are kept, so the
 *     sweep imports the transcript after the call;
 *   · refusals that store nothing: not in the calendar, another organiser, no
 *     Meet conference, no times, past Meet's 30 days, no consent, not
 *     connected, attached twice, another member's interview;
 *   · speakers: the founder's Google account is "Me", names are kept, dial-ins
 *     and unnamed participants are numbered per call, no phone number stored;
 *   · no transcript: a listed recording settles `meet_no_transcript_recording`
 *     and its Drive link is read live; no Drive request is ever made.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/meet_attach_speakers_d871.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import channelsRouter from '../src/routes/channels.ts';
import calendarRouter from '../src/routes/calendar.ts';
import { GOOGLE_MEET_TRANSCRIPT_SCOPE } from '../src/services/calendar.ts';
import { MEETING_ERRORS, importMeetingRef, loadRef } from '../src/services/channels/meetings.ts';
import { fetchTranscript, participantLabel, sweepMeet } from '../src/services/channels/googleMeet.ts';
import { upcomingCalls } from '../src/services/channels/meetingSetup.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const GOOGLE_SUB = '10987654321';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const SIGNING_KEY = 'test-only-session-signing-material-0123456789';
// Joined, so no HMAC key sits in the source as one literal (the d690 fixtures do the same).
const WEBHOOK_KEY = ['test', 'only', 'zoom', 'webhook', 'material'].join('-');
const ME = 2, OTHER = 3, FOUNDER = 9, INTERVIEW = 101, FOREIGN_INTERVIEW = 501;
const MEET_CODE = 'abc-mnop-xyz';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function world() {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER} WHERE id = ${ME};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (7, 'Fixture project', ${FOUNDER}), (8, 'Foreign project', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (${INTERVIEW}, 7, 'Fixture interviewee'), (${FOREIGN_INTERVIEW}, 8, 'Foreign interviewee');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const name of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, name));
  for (const name of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    // openSession stores the call (call_provider), as production's 452 lets it.
    '452_record_session_setup.sql', '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    '488_channel_consents.sql', '529_meeting_transcript_source.sql']) db.exec(migration(name));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  const jobs: unknown[] = [];
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SIGNING_KEY, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-fixture-client', ZOOM_CLIENT_SECRET: 'zoom-fixture-secret', ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_KEY,
    GOOGLE_CLIENT_ID: 'google-fixture-client', GOOGLE_CLIENT_SECRET: 'google-fixture-secret',
    APP_URL: 'https://axal.test', PUBLIC_BASE_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(job: unknown) { jobs.push(job); } },
  };
  return { env, db, jobs };
}
type World = ReturnType<typeof world>;

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.route('/api/channels', zoomWebhook as any);
  a.route('/api/channels', channelsRouter as any);
  a.route('/api/calendar', calendarRouter as any);
  a.onError((err: any, c) => c.json({ detail: err?.message }, 500));
  return a;
})();

async function auth(user = ME) {
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SIGNING_KEY));
  return { Authorization: `Bearer ${token}` };
}
async function request(f: World, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers: { ...await auth(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
async function meetConnected(f: World, scope = `https://www.googleapis.com/auth/calendar.events ${GOOGLE_MEET_TRANSCRIPT_SCOPE}`, userId = ME) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope, google_sub) VALUES (?, ?, ?, ?)')
    .run(userId, await encryptString(f.env, 'fixture-refresh'), scope, `${GOOGLE_SUB}${userId}`);
}
function mockFetch(t: any, routes: Record<string, (url: URL, init: any) => Response | Promise<Response>>) {
  const old = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked provider request: ${key}`);
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = old; });
  return calls;
}


const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MEET = 'https://meet.googleapis.com/v2';
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const CONSENT = { status: 'given', method: 'verbal' };
const TOKEN = { 'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access' }) };

/** A Calendar event as Google returns it. */
function event(over: Record<string, unknown> = {}) {
  return {
    id: 'event0001', status: 'confirmed', organizer: { self: true },
    hangoutLink: `https://meet.google.com/${MEET_CODE}`,
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${MEET_CODE}` }] },
    start: { dateTime: iso(-2 * HOUR) }, end: { dateTime: iso(-1 * HOUR) },
    ...over,
  };
}
const refs = (f: World) => f.db.prepare('SELECT * FROM interview_channel_refs ORDER BY id').all() as any[];
const sessions = (f: World) => f.db.prepare("SELECT * FROM interview_sessions WHERE submitted_via = 'google_meet'").all() as any[];
const attach = (f: World, a: Record<string, unknown>, extra: Record<string, unknown> = { consent: CONSENT }, interview = INTERVIEW) =>
  request(f, 'POST', `/interviews/${interview}/meetings`, { attach: a, ...extra });

test('a Meet call in the member\'s own Calendar attaches by code, keeps its times, and imports after the call', async (t) => {
  const f = world();
  await meetConnected(f);
  const calls = mockFetch(t, {
    ...TOKEN,
    [`GET ${CAL}`]: () => json({ items: [event()] }),
    [`GET ${MEET}/conferenceRecords`]: () => json({ conferenceRecords: [
      { name: 'conferenceRecords/r1', startTime: iso(-2 * HOUR), endTime: iso(-1.5 * HOUR) }] }),
    [`GET ${MEET}/conferenceRecords/r1/transcripts`]: () => json({ transcripts: [{ name: 'conferenceRecords/r1/transcripts/t1', state: 'FILE_GENERATED' }] }),
    [`GET ${MEET}/conferenceRecords/r1/participants`]: () => json({ participants: [
      { name: 'conferenceRecords/r1/participants/p1', signedinUser: { user: `users/${GOOGLE_SUB}${ME}`, displayName: 'Fixture Founder' } },
      { name: 'conferenceRecords/r1/participants/p2', signedinUser: { user: 'users/555', displayName: 'Dana Fixture' } },
    ] }),
    [`GET ${MEET}/conferenceRecords/r1/transcripts/t1/entries`]: () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/r1/participants/p2', text: 'Fixture pain line.', startTime: iso(-2 * HOUR + 5000), endTime: iso(-2 * HOUR + 8000) },
      { participant: 'conferenceRecords/r1/participants/p1', text: 'Fixture question line.', startTime: iso(-2 * HOUR + 9000), endTime: iso(-2 * HOUR + 10000) },
    ] }),
  });
  const made = await attach(f, { meeting_code: MEET_CODE.toUpperCase() });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const [ref] = refs(f);
  assert.equal(ref.external_ref, 'event0001', 'the event, as scheduling stores it');
  assert.equal(ref.join_url, `https://meet.google.com/${MEET_CODE}`);
  assert.ok(ref.starts_at && ref.ends_at, 'the event\'s own times, so the sweep finds it');
  assert.equal(ref.status, 'ended', 'a call already over waits for its transcript');
  const [session] = sessions(f);
  assert.equal(session.id, made.body.session_id);
  assert.deepEqual([session.channel, session.consent_status, session.consent_method], ['video', 'given', 'verbal']);
  assert.ok(!calls.some((k) => k.startsWith('GET https://www.googleapis.com/drive')));

  assert.deepEqual(await sweepMeet(f.env, new Date(Date.now() + 15 * 60_000)), ['queued']);
  const out = await importMeetingRef(f.env, (await loadRef(f.env, ref.uid))!, fetchTranscript);
  assert.equal(out.status, 'imported');
  const segs = f.db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(session.id) as any[];
  assert.deepEqual(segs.map((s) => [s.speaker_label, s.text]), [['Dana Fixture', 'Fixture pain line.'], ['Me', 'Fixture question line.']]);
});

test('a Meet link and a Calendar event id attach too; an upcoming call waits as scheduled', async (t) => {
  const f = world();
  await meetConnected(f);
  const instance = 'ev2_20261030T150000Z';
  mockFetch(t, {
    ...TOKEN,
    [`GET ${CAL}`]: () => json({ items: [event()] }),
    [`GET ${CAL}/${instance}`]: () => json(event({ id: instance, hangoutLink: 'https://meet.google.com/xyz-abcd-efg',
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/xyz-abcd-efg' }] },
      start: { dateTime: iso(24 * HOUR) }, end: { dateTime: iso(25 * HOUR) } })),
  });
  assert.equal((await attach(f, { join_url: `https://meet.google.com/${MEET_CODE}` })).status, 201);
  assert.equal((await attach(f, { event_id: instance })).status, 201);
  const [, upcoming] = refs(f);
  assert.deepEqual([upcoming.external_ref, upcoming.status], [instance, 'scheduled']);
  assert.deepEqual(await sweepMeet(f.env, new Date()), [], 'not over: not swept');
});

test('a recurring Meet code attaches the instance nearest now', async (t) => {
  const f = world();
  await meetConnected(f);
  mockFetch(t, {
    ...TOKEN,
    [`GET ${CAL}`]: () => json({ items: [
      event({ id: 'week_1', start: { dateTime: iso(-7 * 24 * HOUR) }, end: { dateTime: iso(-7 * 24 * HOUR + HOUR) } }),
      event({ id: 'week_2', start: { dateTime: iso(-2 * HOUR) }, end: { dateTime: iso(-1 * HOUR) } }),
      event({ id: 'week_3', start: { dateTime: iso(7 * 24 * HOUR) }, end: { dateTime: iso(7 * 24 * HOUR + HOUR) } }),
    ] }),
  });
  assert.equal((await attach(f, { meeting_code: MEET_CODE })).status, 201);
  assert.equal(refs(f)[0].external_ref, 'week_2');
});

test('refusals store nothing: another organiser, not in the calendar, no Meet, no times, too old, attached twice', async (t) => {
  const f = world();
  await meetConnected(f);
  const items: Record<string, unknown> = {
    'ev-theirs': event({ id: 'ev-theirs', organizer: { self: false } }),
    'ev-nomeet': event({ id: 'ev-nomeet', hangoutLink: undefined, conferenceData: undefined }),
    'ev-allday': event({ id: 'ev-allday', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }),
    'ev-old': event({ id: 'ev-old', start: { dateTime: iso(-32 * 24 * HOUR) }, end: { dateTime: iso(-31 * 24 * HOUR) } }),
    'ev-cancel': event({ id: 'ev-cancel', status: 'cancelled' }),
  };
  mockFetch(t, {
    ...TOKEN,
    [`GET ${CAL}`]: () => json({ items: [event({ id: 'other-code', hangoutLink: 'https://meet.google.com/qrs-tuvw-xyz',
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/qrs-tuvw-xyz' }] } })] }),
    ...Object.fromEntries(Object.entries(items).map(([id, body]) => [`GET ${CAL}/${id}`, () => json(body)])),
    [`GET ${CAL}/ev-gone`]: () => json({ error: { code: 404 } }, 404),
  });
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ event_id: 'ev-theirs' }, 409, 'meeting_not_hosted'],
    [{ meeting_code: MEET_CODE }, 404, 'meeting_not_in_calendar'],
    [{ event_id: 'ev-gone' }, 404, 'meeting_not_in_calendar'],
    [{ event_id: 'ev-nomeet' }, 404, 'meeting_not_in_calendar'],
    [{ event_id: 'ev-cancel' }, 404, 'meeting_not_in_calendar'],
    [{ event_id: 'ev-allday' }, 409, 'meeting_no_time'],
    [{ event_id: 'ev-old' }, 409, 'meeting_expired'],
  ];
  for (const [a, status, code] of cases) {
    const r = await attach(f, a);
    assert.deepEqual([r.status, r.body.error], [status, code], JSON.stringify(a));
  }
  assert.equal(refs(f).length, 0);
  assert.equal(sessions(f).length, 0, 'no session opened for a refused attach');
});

test('one call attaches once: the same event, or a link already pasted for a recording during it', async (t) => {
  const f = world();
  await meetConnected(f);
  mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
  assert.equal((await attach(f, { meeting_code: MEET_CODE })).status, 201);
  const again = await attach(f, { meeting_code: MEET_CODE });
  assert.deepEqual([again.status, again.body.error], [409, 'meeting_link_reused']);
  f.db.prepare("UPDATE interview_channel_refs SET starts_at = ?, ends_at = ?").run(iso(-50 * HOUR), iso(-49 * HOUR));
  const moved = await attach(f, { meeting_code: MEET_CODE });
  assert.deepEqual([moved.status, moved.body.error], [409, 'meeting_link_reused'], 'the event moved since: still one call');
  assert.equal(sessions(f).length, 1, 'the session opened for the refused attach was removed');
  f.db.prepare("DELETE FROM interview_channel_refs").run();
  f.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, status)
    VALUES ('pasted', 'google_meet', ?, ?, ?, ?, ?, ?, 'scheduled')`)
    .run(MEET_CODE, sessions(f)[0].id, INTERVIEW, ME, `https://meet.google.com/${MEET_CODE}`, iso(-2 * HOUR + 60_000));
  const pasted = await attach(f, { meeting_code: MEET_CODE });
  assert.deepEqual([pasted.status, pasted.body.error], [409, 'meeting_link_reused']);
  assert.equal(sessions(f).length, 1, 'the refused attach left no session behind');
});

test('consent, a connection and the member\'s own interview come first, before any Google request', async (t) => {
  const f = world();
  const calls = mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
  const noConsent = await attach(f, { meeting_code: MEET_CODE }, {});
  assert.deepEqual([noConsent.status, noConsent.body.error], [400, 'consent_required']);
  const notConnected = await attach(f, { meeting_code: MEET_CODE });
  assert.deepEqual([notConnected.status, notConnected.body.error], [409, 'connect_first']);
  await meetConnected(f);
  assert.equal((await attach(f, { meeting_code: MEET_CODE }, { consent: CONSENT }, FOREIGN_INTERVIEW)).status, 404);
  assert.equal(calls.length, 0, 'no Google request for a refused caller');
  const zoomLink = await attach(f, { join_url: 'https://zoom.us/j/85746065432' });
  assert.deepEqual([zoomLink.status, zoomLink.body.error], [400, 'session_required'], 'a Zoom link still needs its recording');
  const mismatch = await attach(f, { join_url: `https://meet.google.com/${MEET_CODE}` }, { consent: CONSENT, provider: 'zoom' });
  assert.deepEqual([mismatch.status, mismatch.body.error], [400, 'meeting_link_invalid'], 'a Meet link named as Zoom is refused');
  assert.equal(refs(f).length, 0);
});

test('speakers: the founder is Me, names stay, dial-ins and unnamed participants are numbered, no phone number is kept', async (t) => {
  assert.deepEqual(participantLabel({ signedinUser: { user: 'users/1', displayName: 'X' } }, 'users/1'), { label: 'Me' });
  assert.deepEqual(participantLabel({ anonymousUser: { displayName: '  Guest   Name ' } }, null), { label: 'Guest Name' });
  assert.equal('kind' in participantLabel({ name: 'p', phoneUser: { displayName: '+1 555-***-**01' } }, null), true);
  assert.equal('kind' in participantLabel({ name: 'p', signedinUser: { user: 'users/9' } }, 'users/1'), true);
  assert.deepEqual(participantLabel({ signedinUser: { user: 'users/2', displayName: 'Y' } }, null), { label: 'Y' }, 'no own account: never Me');

  const f = world();
  await meetConnected(f);
  mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
  const made = await attach(f, { meeting_code: MEET_CODE });
  const ref = (await loadRef(f.env, made.body.meeting.uid))!;
  const at = (s: number) => iso(-2 * HOUR + s * 1000);
  mockFetch(t, {
    ...TOKEN,
    [`GET ${MEET}/conferenceRecords`]: () => json({ conferenceRecords: [
      { name: 'conferenceRecords/r1', startTime: iso(-2 * HOUR), endTime: iso(-1.8 * HOUR) },
      { name: 'conferenceRecords/r2', startTime: iso(-1.7 * HOUR), endTime: iso(-1.5 * HOUR) }] }),
    [`GET ${MEET}/conferenceRecords/r1/transcripts`]: () => json({ transcripts: [{ name: 'conferenceRecords/r1/transcripts/t1', state: 'FILE_GENERATED' }] }),
    [`GET ${MEET}/conferenceRecords/r2/transcripts`]: () => json({ transcripts: [{ name: 'conferenceRecords/r2/transcripts/t2', state: 'FILE_GENERATED' }] }),
    [`GET ${MEET}/conferenceRecords/r1/participants`]: () => json({ participants: [
      { name: 'conferenceRecords/r1/participants/me', signedinUser: { user: `users/${GOOGLE_SUB}${ME}`, displayName: 'Fixture Founder' } },
      { name: 'conferenceRecords/r1/participants/dial', phoneUser: { displayName: '+1 555-***-**01' } },
      { name: 'conferenceRecords/r1/participants/anon', anonymousUser: {} },
      { name: 'conferenceRecords/r1/participants/quiet', signedinUser: { user: 'users/777' } },
    ] }),
    [`GET ${MEET}/conferenceRecords/r2/participants`]: () => json({ participants: [
      { name: 'conferenceRecords/r2/participants/quiet2', signedinUser: { user: 'users/777' } },
    ] }),
    [`GET ${MEET}/conferenceRecords/r1/transcripts/t1/entries`]: () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/r1/participants/me', text: 'one', startTime: at(1) },
      { participant: 'conferenceRecords/r1/participants/dial', text: 'two', startTime: at(2) },
      { participant: 'conferenceRecords/r1/participants/quiet', text: 'three', startTime: at(3) },
      { participant: 'conferenceRecords/r1/participants/anon', text: 'four', startTime: at(4) },
      { text: 'five', startTime: at(5) },
    ] }),
    [`GET ${MEET}/conferenceRecords/r2/transcripts/t2/entries`]: () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/r2/participants/quiet2', text: 'six', startTime: at(400) },
    ] }),
  });
  const got = await fetchTranscript(f.env, ref, {}, Date.now() + 25 * HOUR);
  assert.equal(got.kind, 'segments');
  const labels = (got as any).segments.map((s: any) => [s.speaker, s.text]);
  assert.deepEqual(labels, [
    ['Me', 'one'], ['Phone participant 1', 'two'], ['Speaker 1', 'three'], ['Speaker 2', 'four'], ['Speaker ?', 'five'],
    ['Speaker 1', 'six'],
  ], 'the same signed-in person keeps their number across the call\'s two conferences');
  assert.ok(!JSON.stringify(labels).includes('555'), 'a dial-in\'s number is never a speaker');
});

function noTranscriptMeet(recordings: unknown) {
  return {
    ...TOKEN,
    [`GET ${MEET}/conferenceRecords`]: () => json({ conferenceRecords: [
      { name: 'conferenceRecords/r1', startTime: iso(-2 * HOUR), endTime: iso(-1.5 * HOUR) }] }),
    [`GET ${MEET}/conferenceRecords/r1/transcripts`]: () => json({ transcripts: [] }),
    [`GET ${MEET}/conferenceRecords/r1/recordings`]: typeof recordings === 'function' ? recordings as any : () => json({ recordings }),
  };
}
const DRIVE_VIEW = 'https://drive.google.com/file/d/fixture-file/view';

test('no transcript, but a recording: settled with the download-and-upload message, and the link is read live', async (t) => {
  const f = world();
  await meetConnected(f);
  mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
  const made = await attach(f, { meeting_code: MEET_CODE });
  const calls = mockFetch(t, noTranscriptMeet([
    { name: 'conferenceRecords/r1/recordings/x', state: 'ENDED', driveDestination: { exportUri: 'https://drive.google.com/file/d/not-ready/view' } },
    { name: 'conferenceRecords/r1/recordings/y', state: 'FILE_GENERATED', startTime: iso(-2 * HOUR), driveDestination: { file: 'fixture-file', exportUri: DRIVE_VIEW } },
    { name: 'conferenceRecords/r1/recordings/z', state: 'FILE_GENERATED', driveDestination: { exportUri: 'https://evil.example/file' } },
  ]));
  assert.deepEqual(await sweepMeet(f.env, new Date(Date.now() + 25 * HOUR)), ['no_transcript']);
  const [ref] = refs(f);
  assert.equal(ref.status, 'no_transcript');
  assert.equal(ref.last_error, MEETING_ERRORS.meet_no_transcript_recording);
  assert.ok(!Object.values(ref).some((v) => String(v).includes('fixture-file')), 'no Drive link or file id is stored');

  const read = await request(f, 'GET', `/interviews/${INTERVIEW}/meetings/${made.body.meeting.uid}/recording`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.recordings.map((r: any) => r.url), [DRIVE_VIEW], 'generated, on Drive, https only');
  const listed = await request(f, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.equal(listed.body.meetings[0].error_code, 'meet_no_transcript_recording');
  assert.ok(!calls.some((k) => !k.startsWith('POST https://oauth2.googleapis.com') && !k.startsWith(`GET ${MEET}`)), 'Meet and the token only: no Drive request');
});

test('no transcript and no recording keeps the plain reason; a recording listing that fails does too', async (t) => {
  for (const recordings of [[], () => json({ error: {} }, 500)]) {
    const f = world();
    await meetConnected(f);
    mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
    await attach(f, { meeting_code: MEET_CODE });
    mockFetch(t, noTranscriptMeet(recordings));
    assert.deepEqual(await sweepMeet(f.env, new Date(Date.now() + 25 * HOUR)), ['no_transcript']);
    assert.equal(refs(f)[0].last_error, MEETING_ERRORS.meet_no_transcript);
  }
});

test('the recording read is the member\'s own Meet call only', async (t) => {
  const f = world();
  await meetConnected(f);
  mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [event()] }) });
  const made = await attach(f, { meeting_code: MEET_CODE });
  f.db.prepare('UPDATE interview_channel_refs SET user_id = ? WHERE uid = ?').run(OTHER, made.body.meeting.uid);
  const theirs = await request(f, 'GET', `/interviews/${INTERVIEW}/meetings/${made.body.meeting.uid}/recording`);
  assert.deepEqual([theirs.status, theirs.body.error], [404, 'meeting_not_found']);
  f.db.prepare("UPDATE interview_channel_refs SET user_id = ?, provider = 'zoom' WHERE uid = ?").run(ME, made.body.meeting.uid);
  const zoomRef = await request(f, 'GET', `/interviews/${INTERVIEW}/meetings/${made.body.meeting.uid}/recording`);
  assert.equal(zoomRef.status, 404);
});

test('a call attached from the Calendar (or scheduled from Axal) is not offered again by D875\'s upcoming list', async (t) => {
  const f = world();
  await meetConnected(f);
  const upcoming = event({ id: 'event-upcoming', start: { dateTime: iso(2 * HOUR) }, end: { dateTime: iso(3 * HOUR) } });
  const other = event({ id: 'event-other', hangoutLink: 'https://meet.google.com/qrs-tuvw-xyz',
    conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/qrs-tuvw-xyz' }] },
    start: { dateTime: iso(4 * HOUR) }, end: { dateTime: iso(5 * HOUR) } });
  mockFetch(t, { ...TOKEN, [`GET ${CAL}`]: () => json({ items: [upcoming, other] }), [`GET ${CAL}/event-upcoming`]: () => json(upcoming) });
  const before = await upcomingCalls(f.env, ME);
  assert.deepEqual(before.calls.map((c) => c.join_url).sort(), [`https://meet.google.com/${MEET_CODE}`, 'https://meet.google.com/qrs-tuvw-xyz']);
  assert.equal((await attach(f, { event_id: 'event-upcoming' })).status, 201);
  const after = await upcomingCalls(f.env, ME);
  assert.deepEqual(after.calls.map((c) => c.join_url), ['https://meet.google.com/qrs-tuvw-xyz'], 'held under its event id');
});
