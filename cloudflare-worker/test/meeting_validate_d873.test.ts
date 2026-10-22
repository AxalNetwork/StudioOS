/**
 * D873 (#2520, PR 1) — calls populate Validate like any other session.
 *
 *   1. Three fixtures, each through its real import path, then the engine on
 *      the founder's press (D765), then D858's analytics:
 *        - a Zoom VTT, parsed by `parseVtt` and imported by `importMeetingRef`;
 *        - a Google Meet call, read by `googleMeet.fetchTranscript` from the
 *          Meet REST API (mocked) and imported the same way;
 *        - an uploaded recording transcribed by Workers AI Whisper (#2519's
 *          `submitted_via = 'upload'`, its segments as speech-to-text writes them).
 *      Each yields a pending suggestion citing its line, a draft summary, and
 *      analytics with `channel` zoom, meet or upload and how its text was made.
 *   2. A three-speaker call keeps its speakers: the founder's and the
 *      interviewee's lines by name, anyone else unattributed, never the
 *      interviewee, in the analytics and in the suggestion's evidence.
 *   3. Nothing lands in a module without an Accept.
 *   4. A venture's calls read, and a call with no times reads null minutes.
 *
 * Real SQLite; Workers AI is an in-memory stand-in; every provider request is
 * mocked, and an unmocked one throws, so no test reaches Zoom or Google.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/meeting_validate_d873.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import sessionsRoutes from '../src/routes/founder_validate_sessions.ts';
import structureRoutes from '../src/routes/founder_validate_structure.ts';
import validateConversations from '../src/routes/validate_conversations.ts';
import { parseVtt } from '../src/services/channels/zoom.ts';
import { fetchTranscript as fetchMeetTranscript, MEET_TRANSCRIPT_SCOPE } from '../src/services/channels/googleMeet.ts';
import { importMeetingRef } from '../src/services/channels/meetings.ts';
import { moduleSuggestions } from '../src/services/interviewSuggestions.ts';
import { openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { REASONS } from '../src/services/conversationAnalytics.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const JWT_SECRET = 'd873-fixture-only-signing-secret-0123456789';

const ME = 2, OTHER = 3, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101;
const MEET_CODE = 'abc-mnop-xyz';
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const SUMMARY_MARK = 'Summarise one customer';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';

// Fixture words only: no customer's real words, names or numbers.
const PAIN_LINE = 'We reconcile invoices by hand every Friday.';
const COLLEAGUE_LINE = 'I spend two days a month on it.';

const ZOOM_VTT = [
  'WEBVTT', '',
  '1', '00:00:00.000 --> 00:00:04.000', 'Sam Founder: How do you close the month today?', '',
  '2', '00:00:04.000 --> 00:00:09.000', `Dana Ruiz: ${PAIN_LINE}`, '',
  '3', '00:00:09.000 --> 00:00:13.000', `Lee Park: ${COLLEAGUE_LINE}`, '',
  '4', '00:00:13.000 --> 00:01:30.000', 'Dana Ruiz: We would try anything that stops it.', '',
].join('\n');

function world() {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    UPDATE users SET founder_id = ${FOUNDER}, name = 'Sam Founder' WHERE id = ${ME};
    CREATE TABLE founders (id INTEGER PRIMARY KEY, user_id INTEGER);
    INSERT INTO founders VALUES (${FOUNDER}, ${ME});
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Not mine', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz');
    CREATE TABLE hypotheses (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, code TEXT NOT NULL, claim TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0, retired_at TEXT);
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    ALTER TABLE activity_logs ADD COLUMN entity_type TEXT;
    ALTER TABLE activity_logs ADD COLUMN entity_id TEXT;
  `);
  for (const t of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    '452_record_session_setup.sql', '453_interview_processing.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql', '488_channel_consents.sql']) db.exec(mig(m));
  applyEngineSchema(db);
  applySessionTranslationColumns(db); // D857: production applies migration 527 before the Worker ships.
  const ai: string[] = [];
  let quote = PAIN_LINE;
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', MEET_TRANSCRIPTS_ENABLED: 'on',
    PUBLIC_BASE_URL: 'https://axal.test', APP_URL: 'https://axal.test',
    AI: {
      run: async (model: string, input: unknown) => {
        if (/guard/.test(model)) return { response: 'safe' };
        const prompt = JSON.stringify(input);
        const task = prompt.includes(SUMMARY_MARK) ? 'summary' : 'structure';
        ai.push(task);
        // As a model would: cite the span of the line the quote is on, from the prompt's `[from-to] speaker: text`.
        const at = new RegExp(`\\[(\\d+)-(\\d+)\\][^\\[]*?${quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).exec(prompt);
        const cite = at ? { from: Number(at[1]), to: Number(at[2]) } : { from: -1, to: -1 };
        return { response: task === 'summary'
          ? JSON.stringify({ overview: [{ text: 'They reconcile invoices by hand.', cites: [cite] }], key_quotes: [{ quote }] })
          : JSON.stringify({ placements: [
            { kind: 'pain_severity', payload: { phrase: 'Manual invoice reconciliation', severity: 'severe' }, cite, quote },
          ] }) };
      },
    },
  };
  return { env, db, ai, quoteOn: (q: string) => { quote = q; } };
}
type World = ReturnType<typeof world>;

// ── HTTP ─────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessionsRoutes as any);
  a.route('/api/founder/validate', structureRoutes as any);
  a.route('/api/validate', validateConversations as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, method: string, path: string, body?: unknown, user = ME) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const h: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const analytics = (f: World, id: number, user = ME) => call(f.env, 'GET', `/validate/sessions/${id}/analytics`, undefined, user);

// ── fetch ────────────────────────────────────────────────────────────────────

type Handler = (url: URL) => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Routes are `METHOD origin+path`; a request nothing matches throws, so no test reaches a provider. */
function mockFetch(t: any, routes: Record<string, Handler>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked fetch: ${key}`);
    return handler(url);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
}

/** Meet's REST API for one ended call of three participants, one of them not named by Meet. */
function meetApi(): Record<string, Handler> {
  const start = iso(-2 * HOUR);
  const at = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
  return {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', expires_in: 3600, token_type: 'Bearer' }),
    'GET https://meet.googleapis.com/v2/conferenceRecords': () => json({ conferenceRecords: [
      { name: 'conferenceRecords/rec1', startTime: start, endTime: at(30 * 60_000) }] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts': () => json({ transcripts: [
      { name: 'conferenceRecords/rec1/transcripts/t1', state: 'FILE_GENERATED' }] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/participants': () => json({ participants: [
      { name: 'conferenceRecords/rec1/participants/p1', signedinUser: { user: 'users/1', displayName: 'Sam Founder' } },
      // Meet's own spelling of the guest: a name matches whatever its case.
      { name: 'conferenceRecords/rec1/participants/p2', anonymousUser: { displayName: 'dana ruiz' } },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts/t1/entries': () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/rec1/participants/p1', text: 'How do you close the month today?', startTime: at(0), endTime: at(4000) },
      { participant: 'conferenceRecords/rec1/participants/p2', text: PAIN_LINE, startTime: at(4000), endTime: at(9000) },
      { participant: 'conferenceRecords/rec1/participants/p9', text: COLLEAGUE_LINE, startTime: at(9000), endTime: at(120_000) },
    ] }),
  };
}

// ── The three imports ────────────────────────────────────────────────────────

/** A consented call session and its ref, as the schedule route leaves them: the slot Meet's record starts in, ended an hour ago. */
async function callRef(f: World, provider: 'zoom' | 'google_meet') {
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const s = await openSession(f.env, scoped, provider, 'video', { method: 'verbal' });
  const uid = `ref-${provider}`;
  f.db.prepare(`INSERT INTO interview_channel_refs
      (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'transcript_ready')`).run(
    uid, provider, provider === 'zoom' ? '85746065432' : 'evt0123abc', s.id, INTERVIEW, ME,
    provider === 'zoom' ? 'https://zoom.us/j/85746065432' : `https://meet.google.com/${MEET_CODE}`, iso(-2 * HOUR), iso(-HOUR));
  return { sessionId: s.id, ref: () => f.db.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').get(uid) };
}

async function zoomCall(f: World) {
  const { sessionId, ref } = await callRef(f, 'zoom');
  const out = await importMeetingRef(f.env, ref(), async () => ({ kind: 'segments', segments: parseVtt(ZOOM_VTT) }));
  assert.equal(out.status, 'imported');
  return sessionId;
}

async function meetCall(f: World, t: any) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(ME, await encryptString(f.env, 'google-refresh-token'), `https://www.googleapis.com/auth/calendar.events openid ${MEET_TRANSCRIPT_SCOPE}`);
  const { sessionId, ref } = await callRef(f, 'google_meet');
  mockFetch(t, meetApi());
  const out = await importMeetingRef(f.env, ref(), fetchMeetTranscript);
  assert.equal(out.status, 'imported', String(out.code));
  return sessionId;
}

/**
 * An uploaded call (#2519): consent attested, its text as Workers AI speech-to-text labels it (`speakerLabel`:
 * "Me", the interviewee's name, or "Interviewee" when the interview has none on file).
 */
function uploadedCall(f: World) {
  f.db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status,
                  consent_status, consent_method, consent_at, submitted_via, submitted_via_name, active_ms, language, final_model)
                VALUES ('upload-1', ?, ?, ?, 'in_person', 'transcribed', 'given', 'member_attested', datetime('now'),
                        'upload', 'Upload', 95000, 'en', ?)`).run(INTERVIEW, PROJECT, ME, WHISPER);
  const id = Number(f.db.prepare("SELECT id FROM interview_sessions WHERE uid = 'upload-1'").get().id);
  const line = f.db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, start_ms, end_ms, speaker_label, text, model)
                             VALUES (?, 'final', ?, ?, ?, ?, ?)`);
  line.run(id, 0, 4000, 'Me', 'How do you close the month today?', WHISPER);
  line.run(id, 4000, 9000, 'Dana Ruiz', PAIN_LINE, WHISPER);
  line.run(id, 9000, 12000, 'Interviewee', 'Every single month.', WHISPER);
  return id;
}

/** The founder's two presses (D765): Summarise, then Structure. */
async function press(f: World, id: number) {
  const s = await call(f.env, 'POST', `/founder/validate/sessions/${id}/summarise`, {});
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const st = await call(f.env, 'POST', `/founder/validate/sessions/${id}/structure`, {});
  assert.equal(st.status, 201, JSON.stringify(st.body));
}

const pending = (f: World, id: number) => f.db.prepare(
  "SELECT id, kind, status, cite_from, cite_to FROM validate_proposals WHERE session_id = ? ORDER BY id").all(id);
const lineAt = (f: World, id: number, text: string) => f.db.prepare(
  'SELECT start_ms, end_ms, speaker_label FROM interview_transcript_segments WHERE session_id = ? AND text = ?').get(id, text);

// ── 1. Each fixture reaches the engine, a suggestion and the analytics ───────

test('1. a Zoom VTT: imported, structured on the press into a suggestion citing its line, and read as a native zoom call', async () => {
  const f = world();
  const id = await zoomCall(f);
  assert.equal(f.ai.length, 0, 'an import runs no model by itself (D765)');
  await press(f, id);
  const [p, ...rest] = pending(f, id);
  assert.equal(rest.length, 0);
  assert.deepEqual([p.kind, p.status], ['pain_severity', 'pending']);
  const line = lineAt(f, id, PAIN_LINE);
  assert.deepEqual([p.cite_from, p.cite_to], [line.start_ms, line.end_ms], 'the suggestion cites the line it quotes');

  const digest = f.db.prepare('SELECT digest_json FROM interview_sessions WHERE id = ?').get(id).digest_json;
  assert.ok(JSON.parse(digest).overview.length, "the engine's draft summary is there");

  const r = await analytics(f, id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.session, { id, kind: 'call', provider: 'zoom', channel: 'zoom', created_at: r.body.session.created_at });
  assert.deepEqual(r.body.transcript_source, { value: { source: 'native', channel: 'zoom', model: 'zoom_transcript' }, sources: ['Recorded'], reason: null });
  assert.deepEqual(r.body.voice_minutes, { value: 1.5, sources: ['Recorded'], reason: null }, "the last line's end: 90 s");
  assert.deepEqual(r.body.languages, { value: null, sources: [], reason: REASONS.callLanguage });
  assert.deepEqual(r.body.median_reply_seconds.reason, REASONS.replyTimeNotChat);
  assert.deepEqual(r.body.suggestion_reach.value, { cited: 1, of: 4, share: 0.25 });
  assert.deepEqual(r.body.pain_themes.value, [{ group_id: null, title: null, suggested: 1, accepted: 0 }]);
});

test('1. a Google Meet call: read from the Meet API, structured on the press, and read as a native meet call', async (t) => {
  const f = world();
  const id = await meetCall(f, t);
  await press(f, id);
  const [p] = pending(f, id);
  assert.deepEqual([p.kind, p.status, p.cite_from], ['pain_severity', 'pending', 4000]);
  const r = await analytics(f, id);
  assert.equal(r.body.session.channel, 'meet');
  assert.equal(r.body.session.provider, 'google_meet');
  assert.deepEqual(r.body.transcript_source.value, { source: 'native', channel: 'meet', model: 'google_meet_transcript' });
  assert.deepEqual(r.body.voice_minutes.value, 2, "the last entry's end: 120 s");
});

test('1. an uploaded call transcribed by Whisper: structured on the press, and read as speech-to-text', async () => {
  const f = world();
  const id = uploadedCall(f);
  await press(f, id);
  assert.deepEqual(pending(f, id).map((p: any) => [p.kind, p.status, p.cite_from]), [['pain_severity', 'pending', 4000]]);
  const r = await analytics(f, id);
  assert.deepEqual(r.body.session, { id, kind: 'call', provider: 'upload', channel: 'upload', created_at: r.body.session.created_at });
  assert.deepEqual(r.body.transcript_source.value, { source: 'speech_to_text', channel: 'upload', model: WHISPER });
  assert.deepEqual(r.body.voice_minutes.value, 1.6, "the recorder's active time wins over the last line's end: 95 s");
  assert.deepEqual(r.body.languages.value, [{ language: 'en', count: 1 }]);
  assert.deepEqual(r.body.messages.value, {
    founder: { typed: 0, recorded: 1 }, customer: { typed: 0, recorded: 2 }, unattributed: { typed: 0, recorded: 0 }, total: 3,
  }, '"Interviewee" is the interviewee\'s side');
});

// ── 2. Three speakers keep their sides ───────────────────────────────────────

test("2. a three-speaker call: the founder and the interviewee by name, anyone else unattributed, never the interviewee", async (t) => {
  const f = world();
  const zoom = await zoomCall(f);
  const z = (await analytics(f, zoom)).body;
  assert.deepEqual(z.speakers.value, [
    { speaker: 'Sam Founder', side: 'founder', lines: 1 },
    { speaker: 'Dana Ruiz', side: 'customer', lines: 2 },
    { speaker: 'Lee Park', side: 'unattributed', lines: 1 },
  ]);
  assert.deepEqual(z.messages.value, {
    founder: { typed: 0, recorded: 1 }, customer: { typed: 0, recorded: 2 }, unattributed: { typed: 0, recorded: 1 }, total: 4,
  });

  const meet = await meetCall(f, t);
  const m = (await analytics(f, meet)).body;
  assert.deepEqual(m.speakers.value.map((s: any) => [s.speaker, s.side]), [
    ['Sam Founder', 'founder'], ['dana ruiz', 'customer'], ['Speaker ?', 'unattributed'],
  ], 'a participant Meet does not name stays "Speaker ?", not the interviewee');

  // The suggestion's evidence names who said it: a colleague's line stays the colleague's.
  f.quoteOn(COLLEAGUE_LINE);
  await press(f, zoom);
  const ev = (await moduleSuggestions(f.env, PROJECT, 'problem-discovery')).filter((s) => s.session_id === zoom);
  assert.deepEqual(ev.map((s) => [s.speaker, s.interviewee]), [['Lee Park', 'Dana Ruiz']],
    'the line is Lee Park\'s; the interview is still Dana Ruiz\'s');
});

// ── 3. Nothing lands without an Accept ───────────────────────────────────────

test('3. nothing lands in a module without an Accept', async () => {
  const f = world();
  const id = await zoomCall(f);
  // Customer research's pains on the interview: what accepting a pain writes (applyPain).
  const modules = () => f.db.prepare('SELECT pains_json FROM discovery_interviews WHERE id = ?').get(INTERVIEW).pains_json ?? null;
  const before = modules();
  await press(f, id);
  assert.deepEqual(modules(), before, 'structuring writes a suggestion, not the module');
  const [p] = pending(f, id);
  assert.equal(p.status, 'pending');
  const a = await call(f.env, 'POST', `/founder/validate/placements/${p.id}/accept`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(pending(f, id)[0].status, 'accepted');
  assert.notDeepEqual(modules(), before, 'the Accept is what writes the module');
});

// ── 4. The venture's calls, and what reads null ──────────────────────────────

test("4. a venture's calls read: one count per channel, aggregates only, and another founder gets 404", async (t) => {
  const f = world();
  await zoomCall(f);
  await meetCall(f, t);
  uploadedCall(f);
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  await openSession(f.env, scoped, 'telegram', 'text');

  const calls = await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=calls`);
  assert.equal(calls.status, 200, JSON.stringify(calls.body));
  assert.equal(calls.body.kind, 'calls');
  assert.equal(calls.body.sessions, 3, 'the chat is not a call');
  assert.deepEqual(calls.body.sessions_by_provider, { zoom: 1, meet: 1, upload: 1 });
  assert.deepEqual(calls.body.voice_minutes.value, 5.1, '90 s + 120 s + 95 s');
  assert.deepEqual(calls.body.messages.value.unattributed, { typed: 0, recorded: 2 }, "Lee Park's line and Meet's unnamed one");
  assert.deepEqual(calls.body.languages.value, [{ language: 'en', count: 1 }]);
  for (const words of [PAIN_LINE, COLLEAGUE_LINE, 'Lee Park']) assert.equal(JSON.stringify(calls.body).includes(words), false, 'aggregates only');

  const chats = await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}`);
  assert.deepEqual([chats.body.kind, chats.body.sessions], ['chats', 1], "D858's default is unchanged: chats only");
  const all = await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=all`);
  assert.equal(all.body.sessions, 4);
  assert.equal((await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=meetings`)).status, 400);
  assert.equal((await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=calls`, undefined, OTHER)).status, 404);
  assert.equal((await analytics(f, 1, OTHER)).status, 404);

  const none = (await call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=calls&from=2020-01-01&to=2020-01-31`)).body;
  assert.equal(none.sessions, 0);
  assert.deepEqual(none.voice_minutes, { value: 0, sources: [], reason: null }, 'no calls is zero minutes, a count');
  assert.deepEqual(none.voice_notes.reason, REASONS.notChat);
  assert.deepEqual(none.median_reply_seconds.reason, REASONS.replyTimeNotChat);
});

test('4. a call whose transcript carries no times reads null minutes, and the venture total is null, never a partial sum', async () => {
  const f = world();
  const { sessionId, ref } = await callRef(f, 'zoom');
  await importMeetingRef(f.env, ref(), async () => ({ kind: 'segments', segments: [{ speaker: 'Dana Ruiz', text: PAIN_LINE, startMs: null, endMs: null }] }));
  const second = await callRef(f, 'google_meet');
  await importMeetingRef(f.env, second.ref(), async () => ({ kind: 'segments', segments: [{ speaker: 'Dana Ruiz', text: 'Every single month.', startMs: 0, endMs: 2000 }] }));
  const venture = () => call(f.env, 'GET', `/validate/conversations/analytics?project_id=${PROJECT}&kind=calls`);
  assert.deepEqual((await venture()).body.languages, { value: null, sources: [], reason: REASONS.callLanguage },
    'two calls, neither with a language: unknown, not an empty list');
  uploadedCall(f);
  assert.deepEqual((await analytics(f, sessionId)).body.voice_minutes, { value: null, sources: [], reason: REASONS.callMinutes });
  const v = await venture();
  assert.deepEqual(v.body.voice_minutes, { value: null, sources: [], reason: REASONS.callMinutes });

  f.db.prepare('UPDATE interview_sessions SET final_model = NULL WHERE id = ?').run(sessionId);
  assert.deepEqual((await analytics(f, sessionId)).body.transcript_source, { value: null, sources: [], reason: REASONS.transcriptModel });
});
