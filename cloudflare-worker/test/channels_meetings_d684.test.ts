/**
 * D684 (#1577) — Zoom and Google Meet calls scheduled from a Validate
 * interview, and the transcripts they bring back (S18).
 *
 * Real SQLite (migration 449 and the session migrations, as the foundation
 * test applies them). Every provider call goes through a mocked
 * `globalThis.fetch` that fails loudly on anything it was not told about, so
 * no test can reach Zoom or Google.
 *
 * What these prove:
 *   · Zoom's url_validation is answered only on a signed request, with the
 *     HMAC of a well-formed plain token — never an HMAC of a string of the
 *     caller's choosing;
 *   · every Zoom event needs a fresh, correct signature; a forged, missing or
 *     stale one is refused, and an unset secret fails closed;
 *   · transcript_completed is claimed once and queues one import carrying ids
 *     only; the import fetches with the MEMBER'S token, keeps speakers and
 *     offsets, and lands in the ref's session — tenancy from the ref row;
 *   · an unknown meeting is ignored with nothing stored; no transcript is
 *     said in plain words;
 *   · a Zoom call ended and started again on its link has every instance
 *     imported, each by its own uuid, none over another (the later one into a
 *     session of its own), whatever order the jobs run in; a cancelled call
 *     imports nothing; a use of the link days later is not this interview's;
 *   · a rotating Zoom refresh token is spent once under a D1 lease even when
 *     KV shows no lease; a refusal of a token someone else already rotated is
 *     not "reconnect Zoom"; a refresh never overwrites a reconnect's pair;
 *   · disconnecting Zoom revokes the refresh token, or a live access token;
 *   · the VTT parser survives what WebVTT allows and Zoom varies;
 *   · a Meet call is a Calendar event with a hangoutsMeet createRequest;
 *   · the Meet sweep imports a generated transcript, waits for one that is not
 *     there yet (or for a part still being transcribed), imports a rejoined
 *     call's second conference with the first, settles a call with none after
 *     a day, and settles a call whose transcripts Axal cannot read yet —
 *     without asking Meet, and without advising a reconnect that cannot help;
 *   · the routes create, list, cancel and retry, answer 404 for an interview
 *     that is not the member's, 503 when a provider is not set up, and 409
 *     when the member has not connected.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channels_meetings_d684.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import { parseVtt, sweepZoom, verifyZoomSignature } from '../src/services/channels/zoom.ts';
import { meetingCodeOf, sweepMeet, MEET_TRANSCRIPT_SCOPE } from '../src/services/channels/googleMeet.ts';
import { MEETING_ERRORS, withinCallSlot } from '../src/services/channels/meetings.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { CONNECTOR_METADATA, getDescriptor, getProviderImpl } from '../src/integrations/registry.ts';
import { decryptCredentials, encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

/** How the interviewee agreed: a call is scheduled only with consent recorded (#1470's rule). */
const CONSENT = { status: 'given', method: 'verbal' };
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');

const JWT_SECRET = 'd684-s18-fixture-only-signing-secret-0123456789';
const WEBHOOK_SECRET = 'zoom-webhook-fixture-secret';
const ME = 2, OTHER = 3, FOUNDER = 9;
const PROJECT = 7, OTHER_PROJECT = 8;
const INTERVIEW = 101, THEIR_INTERVIEW = 501;
const MEETING_ID = '85746065432';
const MEET_CODE = 'abc-mnop-xyz';

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function world(over: Record<string, unknown> = {}) {
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
    INSERT INTO projects (id, name, founder_id) VALUES (${PROJECT}, 'Ledger tool', ${FOUNDER}), (${OTHER_PROJECT}, 'Not mine', 99);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES
      (${INTERVIEW}, ${PROJECT}, 'Dana Ruiz'), (${THEIR_INTERVIEW}, ${OTHER_PROJECT}, 'Theirs');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, t));
  for (const m of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '450_channel_events_delete_kind.sql', '451_channel_review_fixes.sql',
    // D870: interview_channel_refs.transcript_source, call_lang and stt_reservation_uid.
    '529_meeting_transcript_source.sql',
    // D685: openSession stores the call (call_provider), as production's 452 lets it.
    '452_record_session_setup.sql', '454_channel_voice_failures.sql',
    '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    // D754 (#1893): the consent store and channel_threads.consent_state.
    '488_channel_consents.sql']) db.exec(mig(m));
    applySessionTranslationColumns(db); // D857: migration 527's segment columns
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  const jobs: any[] = [];
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-client-id', ZOOM_CLIENT_SECRET: 'zoom-client-secret', ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_SECRET,
    GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', PUBLIC_BASE_URL: 'https://axal.test',
    APP_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(body: unknown) { jobs.push(body); } },
    ...over,
  };
  return { env, db, jobs };
}
type World = ReturnType<typeof world>;

const count = (db: any, sql: string, ...args: unknown[]) => Number(db.prepare(sql).get(...args)?.n ?? 0);

async function connectZoom(f: World, creds: Record<string, unknown> = {}, userId = ME) {
  const uid = `zoom-${userId}`;
  const enc = await encryptCredentials(f.env, uid, {
    access_token: 'zoom-at', refresh_token: 'zoom-rt', token_type: 'bearer', expires_at: Date.now() + HOUR, ...creds,
  });
  f.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc)
                VALUES (?, ?, 'zoom', 'active', 'oauth2', ?)`).run(uid, userId, enc);
}

async function connectGoogle(f: World, scope: string, userId = ME) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(userId, await encryptString(f.env, 'google-refresh-token'), scope);
}
const GRANTED = `https://www.googleapis.com/auth/calendar.events openid ${MEET_TRANSCRIPT_SCOPE}`;
const NO_MEET = 'https://www.googleapis.com/auth/calendar.events openid';

/** A ref as the POST route leaves it, last looked at long ago (so a sweep finds it due). */
async function seedRef(f: World, over: Partial<{ provider: string; external_ref: string; status: string; ends_at: string; join_url: string }> = {}) {
  const provider = (over.provider ?? 'zoom') as 'zoom' | 'google_meet';
  const scoped = await writableInterview(f.env, ME, INTERVIEW);
  const session = await openSession(f.env, scoped, provider, 'video');
  const uid = crypto.randomUUID();
  f.db.prepare(`INSERT INTO interview_channel_refs
      (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00')`).run(
    uid, provider, over.external_ref ?? (provider === 'zoom' ? MEETING_ID : 'evt0123abc'), session.id, INTERVIEW, ME,
    over.join_url ?? (provider === 'zoom' ? 'https://zoom.us/j/85746065432?pwd=x' : `https://meet.google.com/${MEET_CODE}`),
    iso(-2 * HOUR), over.ends_at ?? iso(-HOUR), over.status ?? 'scheduled');
  return { uid, sessionId: session.id };
}
const refRow = (f: World, uid: string) => f.db.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').get(uid);

// ── fetch ─────────────────────────────────────────────────────────────────────

type Handler = (url: URL, init: any) => Response | Promise<Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** Routes are `METHOD origin+path`; a request nothing matches throws, so no test reaches a provider. */
function mockFetch(t: any, routes: Record<string, Handler>) {
  const calls: { key: string; url: URL; headers: Headers; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    const body = init.body == null ? null : String(init.body);
    calls.push({ key, url, headers: new Headers(init.headers), body });
    const handler = routes[key] ?? (/^GET https:\/\/api\.zoom\.us\/v2\/past_meetings\/\d+\/instances$/.test(key) ? (() => json({ meetings: [] })) : undefined);
    if (!handler) throw new Error(`unmocked fetch: ${key}`);
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.route('/api/channels', zoomWebhook as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, user: number, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

const hmac = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex');
function signed(body: string, { ts = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET } = {}) {
  return { 'x-zm-signature': `v0=${hmac(secret, `v0:${ts}:${body}`)}`, 'x-zm-request-timestamp': String(ts), 'content-type': 'application/json' };
}
async function zoomPost(env: any, payload: unknown, headers?: Record<string, string>) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = await app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: headers ?? signed(body), body,
  }), env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const transcriptEvent = (id: string | number = Number(MEETING_ID), uuid = 'Mtg+uuid==') => ({
  event: 'recording.transcript_completed', event_ts: Date.now(),
  payload: {
    // Host and account fields are Zoom's view of the world; tenancy never reads them.
    account_id: 'some-other-account', object: {
      id, uuid, host_id: 'someone-else', topic: 'Customer interview',
      recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.us/rec/download/not-used-from-payload' }],
    },
  },
});

const VTT = [
  'WEBVTT', 'Kind: captions', '',
  'NOTE Zoom audio transcript', 'spans two lines', '',
  '1', '00:00:01.200 --> 00:00:04.000', 'Dana Ruiz: We lose a day a month', 'to reconciling invoices.', '',
  '2', '00:00:04.500 --> 00:00:07.000 align:start position:10%', 'Sam Founder: Who signs off?', '', '', '',
  '3', '00:00:07.000 --> 00:00:09.250', 'Dana Ruiz: The CFO &amp; me.', '',
].join('\r\n');

const zoomRecordings = (files: unknown[]) => json({ uuid: 'Mtg+uuid==', id: Number(MEETING_ID), recording_files: files });
const TRANSCRIPT_FILE = { file_type: 'TRANSCRIPT', file_extension: 'VTT', status: 'completed', recording_type: 'audio_transcript',
  download_url: 'https://zoom.us/rec/download/transcript-file' };

// ── Zoom: the webhook's door ─────────────────────────────────────────────────

test('Zoom url_validation is answered only when signed, and only for a well-formed token', async () => {
  const f = world();
  const challenge = { event: 'endpoint.url_validation', event_ts: Date.now(), payload: { plainToken: 'test-challenge-0001' } };
  const ok = await zoomPost(f.env, challenge);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { plainToken: 'test-challenge-0001', encryptedToken: hmac(WEBHOOK_SECRET, 'test-challenge-0001') });

  const raw = JSON.stringify(challenge);
  assert.equal((await zoomPost(f.env, raw, { 'content-type': 'application/json' })).status, 401, 'unsigned');
  // Not an oracle: a `v0:` message of the caller's choosing is never signed back.
  const oracle = await zoomPost(f.env, { ...challenge, payload: { plainToken: `v0:${Math.floor(Date.now() / 1000)}:{"event":"x"}` } });
  assert.equal(oracle.status, 400);
  assert.equal(JSON.stringify(oracle.body).includes(hmac(WEBHOOK_SECRET, 'v0:')), false);

  const dark = world({ ZOOM_WEBHOOK_SECRET_TOKEN: undefined });
  assert.equal((await zoomPost(dark.env, challenge)).status, 503, 'fails closed without its secret');
});

test('every Zoom event needs a fresh signature over the raw body', async () => {
  const f = world();
  const ended = JSON.stringify({ event: 'meeting.ended', payload: { object: { id: 1234567890, uuid: 'u1' } } });
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await zoomPost(f.env, ended)).status, 200, 'good');
  const forged = await zoomPost(f.env, ended, signed(ended, { secret: 'not-the-secret' }));
  assert.equal(forged.status, 401);
  assert.equal(forged.body.error, 'signature_mismatch');
  assert.equal((await zoomPost(f.env, ended, { 'content-type': 'application/json' })).body.error, 'signature_missing');
  assert.equal((await zoomPost(f.env, ended, signed(ended, { ts: now - 6 * 60 }))).body.error, 'signature_stale');
  assert.equal((await zoomPost(f.env, ended, signed(ended, { ts: now + 6 * 60 }))).body.error, 'signature_stale');
  // The signature is over the exact bytes: one changed character is a forgery.
  const tampered = await zoomPost(f.env, ended.replace('1234567890', '1234567891'), signed(ended));
  assert.equal(tampered.status, 401);

  const headers = new Headers(signed(ended, { ts: now }));
  assert.equal(await verifyZoomSignature(WEBHOOK_SECRET, ended, headers, now * 1000), 'ok');
  assert.equal(await verifyZoomSignature(WEBHOOK_SECRET, ended, headers, now * 1000 + 5 * 60_000 + 1), 'stale');

  const big = 'x'.repeat(256 * 1024 + 1);
  assert.equal((await zoomPost(f.env, big, signed(big))).status, 413);
  // No Content-Length (chunked, HTTP/2): the bytes are counted as they arrive and the read stops at the cap.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= 8 * 1024 * 1024) { ctrl.close(); return; }
      sent += 64 * 1024;
      ctrl.enqueue(new Uint8Array(64 * 1024).fill(32));
    },
  }, { highWaterMark: 0 });
  const streamed = await app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half',
  } as RequestInit), f.env);
  assert.equal(streamed.status, 413);
  assert.ok(sent <= 256 * 1024 + 128 * 1024, `read ${sent} bytes of a body that sent no Content-Length`);
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM channel_events'), 0, 'nothing for an unknown meeting');
});

// ── Zoom: transcript to session ──────────────────────────────────────────────

test('transcript_completed queues one import; the job imports the VTT with speakers and offsets', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f);
  const calls = mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/Mtg%2Buuid%3D%3D/recordings': () => zoomRecordings([
      { file_type: 'MP4', status: 'completed', download_url: 'https://zoom.us/rec/download/video' }, TRANSCRIPT_FILE]),
    'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT, { status: 200 }),
  });

  const first = await zoomPost(f.env, transcriptEvent());
  assert.equal(first.status, 200);
  assert.equal(refRow(f, uid).status, 'transcript_ready');
  assert.equal(f.jobs.length, 1);
  const job = f.jobs[0];
  assert.equal(job.job_type, 'meeting_import');
  assert.deepEqual(job.payload, { refUid: uid, meetingUuid: 'Mtg+uuid==', provider: 'zoom' });
  assert.equal(job.idempotency_key, `zoom:meeting_import:${uid}:Mtg+uuid==`);
  assert.equal(JSON.stringify(job).includes('download'), false, 'ids only: no download link in the queue');
  const ev = f.db.prepare('SELECT kind, status, user_id, session_id FROM channel_events').get();
  assert.deepEqual({ ...ev }, { kind: 'transcript', status: 'stored', user_id: ME, session_id: sessionId });

  const again = await zoomPost(f.env, transcriptEvent());
  assert.deepEqual(again.body, { ok: true, duplicate: true });
  assert.equal(f.jobs.length, 1, 'a redelivered event queues nothing');
  assert.equal(calls.length, 0, 'the webhook itself calls nobody');

  const logged: string[] = [];
  const { error, warn } = console;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  console.warn = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try { await runChannelJob(f.env, 'meeting_import', job.payload); } finally { console.error = error; console.warn = warn; }

  const download = calls.find((c) => c.key === 'GET https://zoom.us/rec/download/transcript-file')!;
  assert.equal(download.headers.get('authorization'), 'Bearer zoom-at', "the member's own token");
  assert.equal(calls.some((c) => c.url.toString().includes('not-used-from-payload')), false);
  const segs = f.db.prepare('SELECT speaker_label, text, start_ms, end_ms, model FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId);
  assert.deepEqual(segs.map((s: any) => [s.speaker_label, s.text, s.start_ms, s.end_ms]), [
    ['Dana Ruiz', 'We lose a day a month to reconciling invoices.', 1200, 4000],
    ['Sam Founder', 'Who signs off?', 4500, 7000],
    ['Dana Ruiz', 'The CFO & me.', 7000, 9250],
  ]);
  const session = f.db.prepare('SELECT status, final_model, submitted_via, channel FROM interview_sessions WHERE id = ?').get(sessionId);
  assert.deepEqual({ ...session }, { status: 'transcribed', final_model: 'zoom_transcript', submitted_via: 'zoom', channel: 'video' });
  assert.match(f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, /reconciling invoices/);
  assert.deepEqual({ ...f.db.prepare('SELECT status, last_error FROM interview_channel_refs WHERE uid = ?').get(uid) }, { status: 'imported', last_error: null });
  // D765 (#2090), D720 §6: the transcript is in, and no Structure pass is queued; the founder presses it.
  assert.equal(f.jobs.length, 1);
  assert.equal(f.jobs.some((j: any) => j.job_type === 'session_structure'), false);
  assert.equal(logged.join('\n').includes('invoices'), false, 'no transcript text in the logs');
  const events = JSON.stringify(f.db.prepare('SELECT * FROM channel_events').all());
  assert.equal(events.includes('invoices'), false);

  // The same instance redelivered after the import is still the duplicate it was.
  assert.deepEqual((await zoomPost(f.env, transcriptEvent())).body, { ok: true, duplicate: true });
  assert.equal(f.jobs.length, 1, 'nothing more is queued for the same instance');
});

// ── Zoom: a call ended and started again on its link ─────────────────────────

const VTT_B = 'WEBVTT\n\n1\n00:00:02.000 --> 00:00:05.000\nDana Ruiz: After the restart: month-end close is the worst part.\n';
/** One instance's recording list, as Zoom answers GET /meetings/{uuid}/recordings. */
const instanceRecordings = (uuid: string, startTime: string) => () => json({
  uuid, id: Number(MEETING_ID), start_time: startTime,
  recording_files: [{ ...TRANSCRIPT_FILE, download_url: `https://zoom.us/rec/download/${uuid}` }],
});
const sessionTexts = (f: World, sessionId: number) =>
  f.db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId).map((s: any) => s.text);
const interviewSessions = (f: World) => f.db.prepare(
  'SELECT id, channel, status, submitted_via, consent_status, consent_method FROM interview_sessions WHERE interview_id = ? ORDER BY id',
).all(INTERVIEW);

test('a restarted Zoom call: the later instance is imported into a session of its own, beside the first', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f, { status: 'ended' });
  f.db.prepare("UPDATE interview_sessions SET consent_status = 'given', consent_method = 'verbal' WHERE id = ?").run(sessionId);
  const start = Date.parse(refRow(f, uid).starts_at);
  mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/instanceA/recordings': instanceRecordings('instanceA', new Date(start).toISOString()),
    'GET https://api.zoom.us/v2/meetings/instanceB/recordings': instanceRecordings('instanceB', new Date(start + 40 * 60_000).toISOString()),
    'GET https://api.zoom.us/v2/meetings/nextWeek/recordings': instanceRecordings('nextWeek', new Date(start + 7 * 24 * HOUR).toISOString()),
    'GET https://zoom.us/rec/download/instanceA': () => new Response(VTT),
    'GET https://zoom.us/rec/download/instanceB': () => new Response(VTT_B),
    'GET https://zoom.us/rec/download/nextWeek': () => new Response(VTT_B),
  });
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceA'));
  await runChannelJob(f.env, 'meeting_import', f.jobs.at(-1).payload);
  assert.equal(refRow(f, uid).status, 'imported');

  // Ended and started again on the same link: a second instance, after the first was imported.
  const second = await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceB'));
  assert.deepEqual(second.body, { ok: true }, 'a new instance of an imported call is not a duplicate');
  const job = f.jobs.at(-1);
  assert.deepEqual(job.payload, { refUid: uid, meetingUuid: 'instanceB', provider: 'zoom' });
  await runChannelJob(f.env, 'meeting_import', job.payload);
  await runChannelJob(f.env, 'meeting_import', job.payload);

  assert.equal(sessionTexts(f, sessionId).length, 3, 'the first instance stays in the call’s session');
  assert.match(sessionTexts(f, sessionId)[0], /reconciling invoices/);
  const sessions = interviewSessions(f);
  assert.equal(sessions.length, 2, 'one session more, made once however often the job runs');
  assert.deepEqual({ ...sessions[1] }, {
    id: sessions[1].id, channel: 'video', status: 'transcribed', submitted_via: 'zoom', consent_status: 'given', consent_method: 'verbal',
  }, 'the later instance carries the call’s consent');
  assert.deepEqual(sessionTexts(f, sessions[1].id), ['After the restart: month-end close is the worst part.']);
  assert.equal(f.jobs.some((j: any) => j.job_type === 'session_structure'), false, 'D765: no Structure is queued');
  const listed = await call(f.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.deepEqual(listed.body.meetings.map((m: any) => [m.session_id, m.status]).sort(), [[sessionId, 'imported'], [sessions[1].id, 'imported']].sort(),
    'the call, and its later part beside it');

  // A use of the link a week later is another conversation, not this interview's.
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'nextWeek'));
  await runChannelJob(f.env, 'meeting_import', f.jobs.at(-1).payload);
  assert.equal(interviewSessions(f).length, 2);
  assert.equal(refRow(f, uid).status, 'imported');
});

test('a restarted Zoom call whose two events arrive before either import: neither instance replaces the other', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f, { status: 'ended' });
  const start = Date.parse(refRow(f, uid).starts_at);
  mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/instanceA/recordings': instanceRecordings('instanceA', new Date(start).toISOString()),
    'GET https://api.zoom.us/v2/meetings/instanceB/recordings': instanceRecordings('instanceB', new Date(start + 40 * 60_000).toISOString()),
    'GET https://zoom.us/rec/download/instanceA': () => new Response(VTT),
    'GET https://zoom.us/rec/download/instanceB': () => new Response(VTT_B),
  });
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceA'));
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceB'));
  const jobs = f.jobs.filter((j: any) => j.job_type === 'meeting_import');
  assert.equal(jobs.length, 2);
  await Promise.all(jobs.map((j: any) => runChannelJob(f.env, 'meeting_import', j.payload)));

  const sessions = interviewSessions(f);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].id, sessionId);
  const held = sessions.map((s: any) => sessionTexts(f, s.id).join(' '));
  assert.equal(held.filter((x: string) => /reconciling invoices/.test(x)).length, 1, 'the first instance is in one session');
  assert.equal(held.filter((x: string) => /month-end close/.test(x)).length, 1, 'the second instance is in the other');
  assert.ok(held.every((x: string) => !(/reconciling invoices/.test(x) && /month-end close/.test(x))));
  assert.equal(refRow(f, uid).status, 'imported');
});

test('a cancelled Zoom call imports nothing, even from an instance found before it was cancelled', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f, { status: 'ended' });
  let files: unknown[] = [{ ...TRANSCRIPT_FILE, status: 'processing' }];
  mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => zoomRecordings(files),
    'GET https://api.zoom.us/v2/meetings/Mtg%2Buuid%3D%3D/recordings': () => zoomRecordings(files),
    'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT),
  });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.equal(refRow(f, uid).status, 'ended', 'its instance was found, its transcript still being made');
  assert.equal((await call(f.env, ME, 'DELETE', `/interviews/${INTERVIEW}/meetings/${uid}`)).body.meeting.status, 'cancelled');
  files = [TRANSCRIPT_FILE];
  f.db.exec(`UPDATE interview_channel_refs SET updated_at = '2026-01-01 00:00:00', ends_at = '${iso(-25 * HOUR)}'`);
  assert.equal(await sweepZoom(f.env, new Date()), 1, 'the found instance is still swept');
  await runChannelJob(f.env, 'meeting_import', f.jobs.at(-1).payload);
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', sessionId), 0);
  assert.equal(count(f.db, "SELECT COUNT(*) n FROM interview_channel_refs WHERE status <> 'cancelled'"), 0);
});

test('after a restart, retrying the call fetches its own instance by uuid, never the meeting’s latest', async (t) => {
  const f = world();
  await connectZoom(f);
  const { uid, sessionId } = await seedRef(f, { status: 'ended' });
  const start = Date.parse(refRow(f, uid).starts_at);
  let downloadA = 0;
  mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/instanceA/recordings': instanceRecordings('instanceA', new Date(start).toISOString()),
    'GET https://api.zoom.us/v2/meetings/instanceB/recordings': instanceRecordings('instanceB', new Date(start + 40 * 60_000).toISOString()),
    // Asked by meeting id, Zoom answers with the latest instance only: B.
    'GET https://api.zoom.us/v2/meetings/85746065432/recordings': instanceRecordings('instanceB', new Date(start + 40 * 60_000).toISOString()),
    'GET https://zoom.us/rec/download/instanceA': () => (downloadA++ ? new Response(VTT) : json({ message: 'busy' }, 503)),
    'GET https://zoom.us/rec/download/instanceB': () => new Response(VTT_B),
  });
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceA'));
  await assert.rejects(runChannelJob(f.env, 'meeting_import', f.jobs.at(-1).payload), /meeting_import_retry:zoom_unreachable/);
  assert.equal(refRow(f, uid).status, 'failed');
  await zoomPost(f.env, transcriptEvent(Number(MEETING_ID), 'instanceB'));
  await runChannelJob(f.env, 'meeting_import', f.jobs.at(-1).payload);

  const retried = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.meeting.status, 'imported');
  assert.match(sessionTexts(f, sessionId).join(' '), /reconciling invoices/, 'the call’s session holds its own instance');
  assert.doesNotMatch(sessionTexts(f, sessionId).join(' '), /month-end close/);
  assert.equal(interviewSessions(f).length, 2);
});

test('an unknown meeting is ignored; meeting.ended moves only a scheduled call; no transcript says why', async (t) => {
  const f = world();
  await connectZoom(f);
  const unknown = await zoomPost(f.env, transcriptEvent(99999999999));
  assert.deepEqual(unknown.body, { ok: true, ignored: 'unknown_meeting' });
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM channel_events'), 0);
  assert.equal(f.jobs.length, 0);

  const { uid } = await seedRef(f);
  assert.equal((await zoomPost(f.env, { event: 'meeting.ended', payload: { object: { id: String(MEETING_ID), uuid: 'u1' } } })).status, 200);
  assert.equal(refRow(f, uid).status, 'ended');
  assert.equal((await zoomPost(f.env, { event: 'meeting.started', payload: { object: { id: MEETING_ID } } })).body.ignored, 'event');

  let files: unknown[] = [{ file_type: 'TRANSCRIPT', status: 'processing', download_url: TRANSCRIPT_FILE.download_url }];
  // First asked by meeting id (no instance known yet), then by the instance's own uuid.
  mockFetch(t, {
    'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => zoomRecordings(files),
    'GET https://api.zoom.us/v2/meetings/Mtg%2Buuid%3D%3D/recordings': () => zoomRecordings(files),
  });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.deepEqual({ ...f.db.prepare('SELECT status, last_error FROM interview_channel_refs WHERE uid = ?').get(uid) },
    { status: 'ended', last_error: null }, 'still being made: wait');

  files = [{ file_type: 'MP4', status: 'completed', download_url: 'https://zoom.us/rec/download/video' }];
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  const row = refRow(f, uid);
  assert.equal(row.status, 'no_transcript');
  assert.equal(row.last_error, MEETING_ERRORS.zoom_no_transcript);
  assert.match(row.last_error, /paid Zoom plan with cloud recording/);
  const listed = await call(f.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.equal(listed.body.meetings[0].error_code, 'zoom_no_transcript');
  assert.equal(listed.body.meetings[0].error, MEETING_ERRORS.zoom_no_transcript);
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_transcript_segments'), 0);
});

test('an expired Zoom token is refreshed once and the rotated refresh token stored encrypted', async (t) => {
  const f = world();
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  const { uid } = await seedRef(f, { status: 'ended' });
  const calls = mockFetch(t, {
    'POST https://zoom.us/oauth/token': () => json({ access_token: 'fresh-at', refresh_token: 'rotated-rt', expires_in: 3599, token_type: 'bearer' }),
    'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => zoomRecordings([TRANSCRIPT_FILE]),
    'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT),
  });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.equal(refRow(f, uid).status, 'imported');
  const tokenCalls = calls.filter((c) => c.key === 'POST https://zoom.us/oauth/token');
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].headers.get('authorization'), `Basic ${btoa('zoom-client-id:zoom-client-secret')}`);
  assert.equal(new URLSearchParams(tokenCalls[0].body!).get('grant_type'), 'refresh_token');
  assert.equal(new URLSearchParams(tokenCalls[0].body!).get('refresh_token'), 'zoom-rt');
  assert.equal(calls.find((c) => c.key.startsWith('GET https://api.zoom.us'))!.headers.get('authorization'), 'Bearer fresh-at');
  const row = f.db.prepare("SELECT uid, credentials_enc FROM integrations WHERE provider_key = 'zoom'").get();
  assert.equal(row.credentials_enc.includes('rotated-rt'), false, 'encrypted at rest');
  assert.equal((await decryptCredentials(f.env, row.uid, row.credentials_enc))?.refresh_token, 'rotated-rt');
});

test('a refused Zoom grant fails the import with a reconnect sentence and no provider text', async (t) => {
  const f = world();
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  const { uid } = await seedRef(f, { status: 'ended' });
  mockFetch(t, { 'POST https://zoom.us/oauth/token': () => json({ reason: 'Invalid Token!', error: 'invalid_grant' }, 400) });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  const row = refRow(f, uid);
  assert.equal(row.status, 'failed');
  assert.equal(row.last_error, MEETING_ERRORS.zoom_reconnect);
  assert.equal(row.last_error.includes('Invalid Token'), false);

  // A server error is worth retrying: the job throws (code only) so the queue tries again.
  const g = world();
  await connectZoom(g);
  const { uid: busy } = await seedRef(g, { status: 'ended' });
  // (mockFetch above restores the real fetch after this test.)
  globalThis.fetch = (async () => json({ message: 'upstream exploded' }, 502)) as typeof fetch;
  await assert.rejects(runChannelJob(g.env, 'meeting_import', { provider: 'zoom', refUid: busy }), /^Error: meeting_import_retry:zoom_unreachable$/);
  assert.equal(refRow(g, busy).last_error, MEETING_ERRORS.zoom_unreachable);
});

test('D686 #1592: a Zoom refresh that lands clears the stored failure and its time; a refused one keeps both', async (t) => {
  const failure = (f: World) => ({ ...f.db.prepare("SELECT last_error, last_error_at FROM integrations WHERE provider_key = 'zoom'").get() });
  const stale = { last_error: 'sync failed', last_error_at: '2026-10-01 08:00:00' };
  const ok = world();
  await connectZoom(ok, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  ok.db.prepare("UPDATE integrations SET last_error = ?, last_error_at = ? WHERE provider_key = 'zoom'").run(stale.last_error, stale.last_error_at);
  const { uid } = await seedRef(ok, { status: 'ended' });
  mockFetch(t, {
    'POST https://zoom.us/oauth/token': () => json({ access_token: 'fresh-at', refresh_token: 'rotated-rt', expires_in: 3599, token_type: 'bearer' }),
    'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => zoomRecordings([TRANSCRIPT_FILE]),
    'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT),
  });
  await runChannelJob(ok.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.equal(refRow(ok, uid).status, 'imported');
  assert.deepEqual(failure(ok), { last_error: null, last_error_at: null });

  const refused = world();
  await connectZoom(refused, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  refused.db.prepare("UPDATE integrations SET last_error = ?, last_error_at = ? WHERE provider_key = 'zoom'").run(stale.last_error, stale.last_error_at);
  const { uid: denied } = await seedRef(refused, { status: 'ended' });
  globalThis.fetch = (async () => json({ reason: 'Invalid Token!', error: 'invalid_grant' }, 400)) as typeof fetch;
  await runChannelJob(refused.env, 'meeting_import', { provider: 'zoom', refUid: denied });
  assert.equal(refRow(refused, denied).status, 'failed');
  assert.deepEqual(failure(refused), stale, 'giving the lease back is not a good sync');
});

test('the Zoom sweep asks once about a quiet call a day after it ended, and settles it', async (t) => {
  const f = world();
  await connectZoom(f);
  const quiet = await seedRef(f, { status: 'ended', ends_at: iso(-25 * HOUR) });
  const recent = await seedRef(f, { status: 'ended', ends_at: iso(-HOUR), external_ref: '11111111111' });
  assert.equal(await sweepZoom(f.env, new Date()), 1);
  assert.deepEqual(f.jobs.map((j) => j.payload.refUid), [quiet.uid]);
  assert.equal(await sweepZoom(f.env, new Date()), 0, 'touched: not asked again at once');
  mockFetch(t, { 'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => json({ code: 3301, message: 'This recording does not exist.' }, 404) });
  await runChannelJob(f.env, 'meeting_import', f.jobs[0].payload);
  assert.equal(refRow(f, quiet.uid).status, 'no_transcript');
  assert.equal(refRow(f, recent.uid).status, 'ended');
  assert.equal(await sweepZoom(world({ ZOOM_CLIENT_ID: undefined }).env, new Date()), 0, 'dark provider: no sweep');
});

// ── Zoom: the token refresh and the revoke ───────────────────────────────────

const storedZoomCreds = async (f: World, userId = ME) => {
  const row = f.db.prepare("SELECT uid, credentials_enc FROM integrations WHERE provider_key = 'zoom' AND user_id = ?").get(userId);
  return decryptCredentials(f.env, row.uid, row.credentials_enc);
};
/** What another writer stores while a refresh is out: a reconnect, or a refresh that got there first. */
const storeElsewhere = async (f: World, creds: Record<string, unknown>) => {
  const enc = await encryptCredentials(f.env, `zoom-${ME}`, { token_type: 'bearer', expires_at: Date.now() + HOUR, ...creds });
  f.db.prepare("UPDATE integrations SET credentials_enc = ? WHERE uid = ?").run(enc, `zoom-${ME}`);
};
const zoomImportRoutes = (): Record<string, Handler> => ({
  'GET https://api.zoom.us/v2/meetings/85746065432/recordings': () => zoomRecordings([TRANSCRIPT_FILE]),
  'GET https://api.zoom.us/v2/meetings/11111111111/recordings': () => zoomRecordings([TRANSCRIPT_FILE]),
  'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT),
});

test('two imports with an expired token spend the refresh token once, even when KV never shows a lease', async (t) => {
  // KV read from two locations: neither sees the other's write, so a KV lease is no lease.
  const blindKV = { async get() { return null; }, async put() {}, async delete() {} };
  const f = world({ RATE_LIMITS: blindKV });
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  const a = await seedRef(f, { status: 'ended' });
  const b = await seedRef(f, { status: 'ended', external_ref: '11111111111' });
  const calls = mockFetch(t, {
    ...zoomImportRoutes(),
    // Zoom rotates the refresh token: it works once.
    'POST https://zoom.us/oauth/token': async (_url, init) => {
      const spent = calls.filter((c) => c.key === 'POST https://zoom.us/oauth/token').length > 1;
      if (spent || new URLSearchParams(String(init.body)).get('refresh_token') !== 'zoom-rt') return json({ error: 'invalid_grant' }, 400);
      await new Promise((r) => setTimeout(r, 50));
      return json({ access_token: 'fresh-at', refresh_token: 'rotated-rt', expires_in: 3599 });
    },
  });
  await Promise.all([a, b].map((r) => runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: r.uid })));
  assert.equal(calls.filter((c) => c.key === 'POST https://zoom.us/oauth/token').length, 1, 'one refresh; the other request waited for it');
  assert.deepEqual([refRow(f, a.uid).status, refRow(f, b.uid).status], ['imported', 'imported']);
  const stored = await storedZoomCreds(f);
  assert.equal(stored?.refresh_token, 'rotated-rt');
  assert.equal(stored?.refresh_lease, undefined, 'the lease is given back with the new pair');
});

test('a refused refresh is not "reconnect Zoom" when another writer has stored a newer pair', async (t) => {
  const f = world();
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  const { uid } = await seedRef(f, { status: 'ended' });
  const calls = mockFetch(t, {
    ...zoomImportRoutes(),
    'POST https://zoom.us/oauth/token': async () => {
      await storeElsewhere(f, { access_token: 'theirs-at', refresh_token: 'theirs-rt' });
      return json({ reason: 'Invalid Token!', error: 'invalid_grant' }, 400);
    },
  });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.equal(refRow(f, uid).status, 'imported', 'the stored pair is used; the connection was never broken');
  assert.equal(calls.find((c) => c.key.startsWith('GET https://api.zoom.us'))!.headers.get('authorization'), 'Bearer theirs-at');
  assert.equal((await storedZoomCreds(f))?.refresh_token, 'theirs-rt');
});

test('a refresh never overwrites credentials a reconnect stored while it was out', async (t) => {
  const f = world();
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 1000 });
  const { uid } = await seedRef(f, { status: 'ended' });
  mockFetch(t, {
    ...zoomImportRoutes(),
    'POST https://zoom.us/oauth/token': async () => {
      await storeElsewhere(f, { access_token: 'reconnected-at', refresh_token: 'reconnected-rt' });
      return json({ access_token: 'fresh-at', refresh_token: 'rotated-rt', expires_in: 3599 });
    },
  });
  await runChannelJob(f.env, 'meeting_import', { provider: 'zoom', refUid: uid });
  assert.equal(refRow(f, uid).status, 'imported');
  const stored = await storedZoomCreds(f);
  assert.deepEqual([stored?.access_token, stored?.refresh_token], ['reconnected-at', 'reconnected-rt']);
});

test('disconnecting Zoom revokes the refresh token; when Zoom refuses that, a live access token', async (t) => {
  const f = world();
  // An hour-long access token, last refreshed days ago: long expired at disconnect.
  await connectZoom(f, { access_token: 'stale-at', expires_at: Date.now() - 3 * 24 * HOUR });
  const row = f.db.prepare("SELECT * FROM integrations WHERE provider_key = 'zoom'").get();
  let refuseRefresh = false;
  const calls = mockFetch(t, {
    'POST https://zoom.us/oauth/revoke': (_url, init) => (refuseRefresh && new URLSearchParams(String(init.body)).get('token') === 'zoom-rt'
      ? json({ reason: 'Invalid Token!' }, 400) : json({ status: 'success' })),
    'POST https://zoom.us/oauth/token': () => json({ access_token: 'fresh-at', refresh_token: 'rotated-rt', expires_in: 3599 }),
  });
  const revoked = () => calls.filter((c) => c.key === 'POST https://zoom.us/oauth/revoke').map((c) => new URLSearchParams(c.body!).get('token'));
  const impl = getProviderImpl('zoom')!;
  const { warn } = console;
  console.warn = () => {};
  try {
    await impl.disconnect!({ env: f.env } as any, { id: ME } as any, row);
    assert.deepEqual(revoked(), ['zoom-rt'], 'the refresh token, not the expired access token');
    assert.equal(calls[0].headers.get('authorization'), `Basic ${btoa('zoom-client-id:zoom-client-secret')}`);
    refuseRefresh = true;
    await impl.disconnect!({ env: f.env } as any, { id: ME } as any, row);
    assert.deepEqual(revoked(), ['zoom-rt', 'zoom-rt', 'fresh-at'], 'refused: a freshly refreshed access token is revoked instead');
  } finally { console.warn = warn; }
});

// ── The VTT parser ───────────────────────────────────────────────────────────

test('parseVtt: cue ids, blank lines, CRLF, multi-line cues, settings, tags and entities', () => {
  assert.deepEqual(parseVtt(VTT), [
    { speaker: 'Dana Ruiz', text: 'We lose a day a month to reconciling invoices.', startMs: 1200, endMs: 4000 },
    { speaker: 'Sam Founder', text: 'Who signs off?', startMs: 4500, endMs: 7000 },
    { speaker: 'Dana Ruiz', text: 'The CFO & me.', startMs: 7000, endMs: 9250 },
  ]);
  const mixed = '\uFEFFWEBVTT - Zoom\n\nSTYLE\n::cue { color: lime }\n\nintro-cue\n01:02:03.004 --> 01:02:05.5\n<v Dana Ruiz>Hello <i>there</i></v>\n\n'
    + 'no timing here, just words\n\n00:10.000 --> 00:12.000\n\n00:13.000 --> 00:14.000\n   \n\n'
    + 'a\nb\n00:15.000 --> 00:16.000\nthree lines before the timing is not a cue\n\n00:17.000 --> 00:18,500\nDana Ruiz: Comma millis, too.\n';
  assert.deepEqual(parseVtt(mixed), [
    { speaker: 'Dana Ruiz', text: 'Hello there', startMs: 3_723_004, endMs: 3_725_500 },
    { speaker: 'Dana Ruiz', text: 'Comma millis, too.', startMs: 17_000, endMs: 18_500 },
  ]);
});

test('parseVtt: a colon in an unlabelled transcript does not invent a speaker', () => {
  const unlabelled = 'WEBVTT\n\n00:01.000 --> 00:03.000\nHere’s the thing: we never close on time.\n\n00:03.500 --> 00:05.000\nNobody owns it.\n\n00:05.000 --> 00:06.000\nAt 10:30 we start.\n';
  assert.deepEqual(parseVtt(unlabelled).map((s) => [s.speaker, s.text, s.startMs]), [
    ['', 'Here’s the thing: we never close on time.', 1000],
    ['', 'Nobody owns it.', 3500],
    ['', 'At 10:30 we start.', 5000],
  ]);
  // A labelled transcript keeps its labels, even on a line that also has a colon later.
  const labelled = 'WEBVTT\n\n00:01.000 --> 00:02.000\nDana: Here’s the thing: it slips.\n\n00:02.000 --> 00:03.000\nunlabelled aside\n\n00:03.000 --> 00:04.000\nSam: Why?\n';
  assert.deepEqual(parseVtt(labelled).map((s) => [s.speaker, s.text]), [
    ['Dana', 'Here’s the thing: it slips.'], ['', 'unlabelled aside'], ['Sam', 'Why?'],
  ]);
  assert.deepEqual(parseVtt(''), []);
  assert.deepEqual(parseVtt('WEBVTT\n'), []);
  assert.deepEqual(parseVtt('not a vtt at all'), []);
});

// ── Google Meet ──────────────────────────────────────────────────────────────

const googleToken = () => json({ access_token: 'g-at', expires_in: 3599, token_type: 'Bearer' });
const calendarEvent = (over: Record<string, unknown> = {}) => ({
  id: 'evt0123abc', hangoutLink: `https://meet.google.com/${MEET_CODE}`,
  conferenceData: {
    conferenceId: MEET_CODE, createRequest: { status: { statusCode: 'success' } },
    entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${MEET_CODE}` }, { entryPointType: 'phone', uri: 'tel:+1-555' }],
  },
  ...over,
});

test('a Meet call is a Calendar event with a hangoutsMeet conference request', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': googleToken,
    'POST https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json(calendarEvent()),
  });
  const startsAt = iso(2 * HOUR);
  const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'google_meet', starts_at: startsAt, duration_min: 45, topic: 'Ledger chat' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const create = calls.find((c) => c.key.startsWith('POST https://www.googleapis.com/calendar'))!;
  assert.equal(create.url.searchParams.get('conferenceDataVersion'), '1');
  assert.equal(create.headers.get('authorization'), 'Bearer g-at');
  const sent = JSON.parse(create.body!);
  assert.equal(sent.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.match(sent.conferenceData.createRequest.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(sent.summary, 'Ledger chat');
  assert.equal(sent.attendees, undefined, 'no invitations sent on the member’s behalf');
  assert.equal(Date.parse(sent.end.dateTime) - Date.parse(sent.start.dateTime), 45 * 60_000);
  assert.equal(r.body.meeting.join_url, `https://meet.google.com/${MEET_CODE}`);
  assert.equal(r.body.meeting.status, 'scheduled');
  assert.equal(r.body.notice, null);
  const ref = refRow(f, r.body.meeting.uid);
  assert.equal(ref.external_ref, 'evt0123abc');
  assert.equal(meetingCodeOf(ref.join_url), MEET_CODE);
  const session = f.db.prepare('SELECT channel, status, submitted_via, submitted_via_name FROM interview_sessions WHERE id = ?').get(ref.session_id);
  assert.deepEqual({ ...session }, { channel: 'video', status: 'draft', submitted_via: 'google_meet', submitted_via_name: 'Google Meet' });
});

test('Meet: a grant without the transcript scope still schedules, and says plainly that Meet transcripts are not available yet', async (t) => {
  const f = world();
  await connectGoogle(f, NO_MEET);
  let pending = true;
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': googleToken,
    'POST https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json(calendarEvent({
      hangoutLink: undefined, conferenceData: { createRequest: { status: { statusCode: 'pending' } } } })),
    'GET https://www.googleapis.com/calendar/v3/calendars/primary/events/evt0123abc': () => json(pending ? calendarEvent() : calendarEvent({ hangoutLink: undefined, conferenceData: {} })),
    'DELETE https://www.googleapis.com/calendar/v3/calendars/primary/events/evt0123abc': () => new Response(null, { status: 204 }),
  });
  const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'google_meet', starts_at: iso(HOUR) });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.notice, { code: 'meet_transcripts_unavailable', message: MEETING_ERRORS.meet_transcripts_unavailable });
  assert.equal(r.body.meeting.error_code, 'meet_transcripts_unavailable');
  assert.match(r.body.meeting.error, /Meet transcripts are not available on Axal yet/);
  assert.match(r.body.meeting.error, /recorder/);
  assert.match(r.body.meeting.error, /paste the conversation/);
  // No consent screen asks for Meet's transcript scope yet (#1585): reconnecting cannot help, so it is not advised.
  assert.doesNotMatch(r.body.meeting.error, /reconnect/i);
  assert.equal(calls.filter((c) => c.key.startsWith('GET https://www.googleapis.com/calendar')).length, 1, 'a pending conference is asked for once more');

  pending = false;
  f.db.exec('DELETE FROM interview_channel_refs');
  const sessionsBefore = count(f.db, 'SELECT COUNT(*) n FROM interview_sessions');
  const none = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'google_meet', starts_at: iso(HOUR) });
  assert.equal(none.status, 502);
  assert.equal(none.body.error, 'meet_link_unavailable');
  assert.ok(calls.some((c) => c.key.startsWith('DELETE https://www.googleapis.com/calendar')), 'the link-less event is deleted');
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_sessions'), sessionsBefore, 'no session for a call that was not made');
});

function meetApi(over: { records?: unknown[]; transcripts?: unknown[]; status?: number; body?: unknown } = {}): Record<string, Handler> {
  const start = iso(-2 * HOUR);
  const offset = (milliseconds: number) => new Date(Date.parse(start) + milliseconds).toISOString();
  const records = over.records ?? [{ name: 'conferenceRecords/rec1', startTime: start, endTime: offset(30 * 60_000) }];
  const transcripts = over.transcripts ?? [{ name: 'conferenceRecords/rec1/transcripts/t1', state: 'FILE_GENERATED' }];
  const fail = over.status ? () => json(over.body ?? {}, over.status) : null;
  return {
    'POST https://oauth2.googleapis.com/token': googleToken,
    'GET https://meet.googleapis.com/v2/conferenceRecords': fail ?? (() => json({ conferenceRecords: records })),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts': () => json({ transcripts }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/participants': () => json({ participants: [
      { name: 'conferenceRecords/rec1/participants/p1', signedinUser: { user: 'users/1', displayName: 'Sam Founder' } },
      { name: 'conferenceRecords/rec1/participants/p2', anonymousUser: { displayName: 'Dana Ruiz' } },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts/t1/entries': (url) => url.searchParams.get('pageToken') === 'page-2'
      ? json({ transcriptEntries: [
        { participant: 'conferenceRecords/rec1/participants/p1', text: 'Who signs off?', startTime: offset(9000), endTime: offset(10000) },
        { participant: 'conferenceRecords/rec1/participants/p9', text: 'Can you hear me?', startTime: offset(11000), endTime: offset(12000) },
      ] })
      : json({ transcriptEntries: [
        { participant: 'conferenceRecords/rec1/participants/p2', text: 'We lose a day a month.', startTime: offset(5000), endTime: offset(8500) },
      ], nextPageToken: 'page-2' }),
  };
}

test('the Meet sweep queues a generated transcript; the import labels speakers and keeps offsets', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const { uid, sessionId } = await seedRef(f, { provider: 'google_meet' });
  const calls = mockFetch(t, meetApi());
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['queued']);
  const list = calls.find((c) => c.key === 'GET https://meet.googleapis.com/v2/conferenceRecords')!;
  assert.equal(list.url.searchParams.get('filter'), `space.meeting_code = "${MEET_CODE}"`);
  assert.equal(list.headers.get('authorization'), 'Bearer g-at');
  assert.equal(refRow(f, uid).status, 'transcript_ready');
  assert.equal(f.jobs.length, 1);
  assert.deepEqual(f.jobs[0].payload, { refUid: uid, provider: 'google_meet' });

  await runChannelJob(f.env, 'meeting_import', f.jobs[0].payload);
  const segs = f.db.prepare('SELECT speaker_label, text, start_ms, end_ms FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId);
  assert.deepEqual(segs.map((s: any) => [s.speaker_label, s.text, s.start_ms, s.end_ms]), [
    ['Dana Ruiz', 'We lose a day a month.', 5000, 8500],
    ['Sam Founder', 'Who signs off?', 9000, 10000],
    // D871 (#2518): a participant Meet did not name is numbered per call, not "Speaker ?".
    ['Speaker 1', 'Can you hear me?', 11000, 12000],
  ]);
  assert.equal(refRow(f, uid).status, 'imported');
  assert.equal(f.db.prepare('SELECT final_model FROM interview_sessions WHERE id = ?').get(sessionId).final_model, 'google_meet_transcript');
  assert.deepEqual(await sweepMeet(f.env, new Date()), [], 'imported: never swept again');
});

test('a reused Meet link imports only the conference scheduled for this interview', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const { uid, sessionId } = await seedRef(f, { provider: 'google_meet' });
  const old = { name: 'conferenceRecords/old', startTime: iso(-3 * 24 * HOUR), endTime: iso(-3 * 24 * HOUR + HOUR) };
  const current = { name: 'conferenceRecords/rec1', startTime: refRow(f, uid).starts_at, endTime: refRow(f, uid).ends_at };
  // The same link used again three hours after the slot's start, the same day: someone else's conversation.
  const start = Date.parse(refRow(f, uid).starts_at);
  const later = { name: 'conferenceRecords/later', startTime: new Date(start + 3 * HOUR).toISOString(), endTime: new Date(start + 4 * HOUR).toISOString() };
  const routes = {
    ...meetApi({ records: [current] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords': (url: URL) => url.searchParams.get('pageToken') === 'next'
      ? json({ conferenceRecords: [current, later] })
      : json({ conferenceRecords: [old], nextPageToken: 'next' }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/old/transcripts': () => json({ transcripts: [
      { name: 'conferenceRecords/old/transcripts/old', state: 'FILE_GENERATED' },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/later/transcripts': () => json({ transcripts: [
      { name: 'conferenceRecords/later/transcripts/later', state: 'FILE_GENERATED' },
    ] }),
  };
  const calls = mockFetch(t, routes);
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['queued']);
  assert.equal(calls.some((c) => c.key.includes('/old/transcripts')), false, 'another call on this link is never read');
  assert.equal(calls.some((c) => c.key.includes('/later/transcripts')), false, 'nor a later use of it the same day');
  await runChannelJob(f.env, 'meeting_import', f.jobs[0].payload);
  assert.equal(refRow(f, uid).status, 'imported');
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?', sessionId), 3);
});

test('a call is the conference that started within its slot: up to 30 minutes early or an hour after its end', () => {
  const ref = { starts_at: '2099-01-05T09:00:00Z', ends_at: '2099-01-05T09:30:00Z' };
  const at = (t: string) => Date.parse(`2099-01-05T${t}:00Z`);
  assert.equal(withinCallSlot(at('08:30'), ref), true, 'joined early');
  assert.equal(withinCallSlot(at('08:29'), ref), false);
  assert.equal(withinCallSlot(at('09:10'), ref), true, 'a restart during the call');
  assert.equal(withinCallSlot(at('10:30'), ref), true, 'a late start, an hour after the slot');
  assert.equal(withinCallSlot(at('10:31'), ref), false, 'another use of the link later that day');
  assert.equal(withinCallSlot(at('12:00'), ref), false);
  // No end: the slot is taken as two hours.
  assert.equal(withinCallSlot(at('12:00'), { starts_at: ref.starts_at, ends_at: null }), true);
  assert.equal(withinCallSlot(at('12:01'), { starts_at: ref.starts_at, ends_at: null }), false);
  assert.equal(withinCallSlot(NaN, ref), false);
  assert.equal(withinCallSlot(at('09:00'), { starts_at: null, ends_at: null }), false, 'an unknown slot claims nothing');
});

/** A conference record of the seeded call, `fromMin` to `toMin` minutes after its scheduled start. */
const meetRecord = (f: World, uid: string, name: string, fromMin: number, toMin: number | null) => {
  const start = Date.parse(refRow(f, uid).starts_at);
  return { name, startTime: new Date(start + fromMin * 60_000).toISOString(), ...(toMin == null ? {} : { endTime: new Date(start + toMin * 60_000).toISOString() }) };
};
const meetSegments = (f: World, sessionId: number) => f.db.prepare(
  'SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY COALESCE(start_ms, 0), id',
).all(sessionId).map((s: any) => `${s.speaker_label}: ${s.text}`);

test('a Meet call whose transcription was stopped and restarted waits for both parts, then imports both', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const { uid, sessionId } = await seedRef(f, { provider: 'google_meet' });
  const rec1 = meetRecord(f, uid, 'conferenceRecords/rec1', 0, 50);
  let second = 'ENDED';
  const routes = {
    ...meetApi({ records: [rec1] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts': () => json({ transcripts: [
      { name: 'conferenceRecords/rec1/transcripts/t1', state: 'FILE_GENERATED', startTime: rec1.startTime },
      { name: 'conferenceRecords/rec1/transcripts/t2', state: second, startTime: meetRecord(f, uid, 'x', 30, null).startTime },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec1/transcripts/t2/entries': () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/rec1/participants/p2', text: 'And the auditors want it in two days.',
        startTime: meetRecord(f, uid, 'x', 31, null).startTime, endTime: meetRecord(f, uid, 'x', 32, null).startTime },
    ] }),
  };
  mockFetch(t, routes);
  // The second transcript is still being written: importing now would settle the call on its first part.
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['waiting']);
  assert.equal(f.jobs.length, 0);
  assert.equal(refRow(f, uid).status, 'ended');

  second = 'FILE_GENERATED';
  f.db.exec(`UPDATE interview_channel_refs SET updated_at = '2026-01-01 00:00:00'`);
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['queued']);
  await runChannelJob(f.env, 'meeting_import', f.jobs[0].payload);
  assert.equal(refRow(f, uid).status, 'imported');
  assert.equal(meetSegments(f, sessionId).at(-1), 'Dana Ruiz: And the auditors want it in two days.');
  assert.equal(meetSegments(f, sessionId).length, 4);
});

test('a Meet call rejoined after everyone left (a second conference record) is imported whole, in time order', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const { uid, sessionId } = await seedRef(f, { provider: 'google_meet' });
  const rec1 = meetRecord(f, uid, 'conferenceRecords/rec1', 0, 20);
  const rec2 = meetRecord(f, uid, 'conferenceRecords/rec2', 25, 50);
  const lastWeek = meetRecord(f, uid, 'conferenceRecords/old', -7 * 24 * 60, -7 * 24 * 60 + 30);
  const calls = mockFetch(t, {
    ...meetApi({ records: [rec2, lastWeek, rec1] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec2/transcripts': () => json({ transcripts: [
      { name: 'conferenceRecords/rec2/transcripts/t3', state: 'FILE_GENERATED', startTime: rec2.startTime },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec2/participants': () => json({ participants: [
      { name: 'conferenceRecords/rec2/participants/p7', anonymousUser: { displayName: 'Dana Ruiz' } },
    ] }),
    'GET https://meet.googleapis.com/v2/conferenceRecords/rec2/transcripts/t3/entries': () => json({ transcriptEntries: [
      { participant: 'conferenceRecords/rec2/participants/p7', text: 'Sorry, my connection dropped.',
        startTime: meetRecord(f, uid, 'x', 26, null).startTime, endTime: meetRecord(f, uid, 'x', 27, null).startTime },
    ] }),
  });
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['queued']);
  await runChannelJob(f.env, 'meeting_import', f.jobs[0].payload);
  assert.equal(refRow(f, uid).status, 'imported');
  const segs = meetSegments(f, sessionId);
  assert.equal(segs.length, 4, 'both conferences of the call');
  assert.equal(segs.at(-1), 'Dana Ruiz: Sorry, my connection dropped.');
  assert.equal(calls.some((c) => c.key.includes('/old/')), false, 'a use of the link a week earlier is never read');
});

test('the Meet sweep waits for a transcript not there yet, and settles a call with none after a day', async (t) => {
  const f = world();
  await connectGoogle(f, GRANTED);
  const soon = await seedRef(f, { provider: 'google_meet', ends_at: iso(-HOUR) });
  let routes = meetApi({ records: [] });
  const calls = mockFetch(t, new Proxy({}, { get: (_t, k: string) => routes[k] }) as Record<string, Handler>);
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['waiting']);
  assert.deepEqual({ ...f.db.prepare('SELECT status, last_error FROM interview_channel_refs WHERE uid = ?').get(soon.uid) }, { status: 'ended', last_error: null });
  assert.equal(f.jobs.length, 0);
  const before = calls.length;
  assert.deepEqual(await sweepMeet(f.env, new Date()), [], 'looked at just now: not again for ten minutes');
  assert.equal(calls.length, before);

  f.db.exec(`UPDATE interview_channel_refs SET ends_at = '${iso(-25 * HOUR)}', updated_at = '2026-01-01 00:00:00'`);
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['no_transcript']);
  assert.equal(refRow(f, soon.uid).last_error, MEETING_ERRORS.meet_no_record);

  const recorded = await seedRef(f, { provider: 'google_meet', ends_at: iso(-25 * HOUR), external_ref: 'evt0456def' });
  routes = meetApi({ transcripts: [{ name: 'conferenceRecords/rec1/transcripts/t1', state: 'STARTED' }] });
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['no_transcript']);
  const row = refRow(f, recorded.uid);
  assert.equal(row.status, 'no_transcript');
  assert.equal(row.last_error, MEETING_ERRORS.meet_no_transcript);
  assert.match(row.last_error, /Workspace edition that includes Meet transcription/);
});

test('the Meet sweep settles a call it cannot read a transcript of, without asking Meet or advising a reconnect', async (t) => {
  const f = world();
  await connectGoogle(f, NO_MEET);
  const { uid } = await seedRef(f, { provider: 'google_meet' });
  const calls = mockFetch(t, meetApi());
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['no_transcript']);
  assert.equal(calls.length, 0, 'a grant recorded without the scope asks Google nothing');
  const row = refRow(f, uid);
  assert.equal(row.status, 'no_transcript', 'settled: there is nothing to retry or reconnect');
  assert.equal(row.last_error, MEETING_ERRORS.meet_transcripts_unavailable);
  assert.doesNotMatch(row.last_error, /reconnect/i);
  const listed = await call(f.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.equal(listed.body.meetings[0].error_code, 'meet_transcripts_unavailable');
  assert.equal(listed.body.providers.find((p: any) => p.provider === 'google_meet').transcript_access, 'missing');
  // Import now says the same, and asks Google nothing either.
  const retried = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.outcome, 'no_transcript');
  assert.equal(retried.body.meeting.error_code, 'meet_transcripts_unavailable');
  assert.equal(calls.length, 0);
});

test('an older Google grant with no recorded scopes learns of the missing one from Meet’s 403', async (t) => {
  const f = world();
  await connectGoogle(f, '');
  const { uid } = await seedRef(f, { provider: 'google_meet' });
  mockFetch(t, meetApi({ status: 403, body: { error: { code: 403, message: 'Request had insufficient authentication scopes.',
    status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } } }));
  assert.deepEqual(await sweepMeet(f.env, new Date()), ['no_transcript']);
  const row = refRow(f, uid);
  assert.equal(row.last_error, MEETING_ERRORS.meet_transcripts_unavailable);
  assert.equal(row.last_error.includes('insufficient'), false, 'our sentence, not Google’s');

  const g = world();
  await connectGoogle(g, '');
  const off = await seedRef(g, { provider: 'google_meet' });
  globalThis.fetch = (async (input: any) => String(input).includes('oauth2') ? googleToken()
    : json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403)) as typeof fetch;
  assert.deepEqual(await sweepMeet(g.env, new Date()), ['failed']);
  assert.equal(refRow(g, off.uid).last_error, MEETING_ERRORS.meet_api_disabled);
  assert.deepEqual(await sweepMeet(world({ GOOGLE_CLIENT_ID: undefined }).env, new Date()), [], 'no Google client: no sweep');
});

// ── The routes ───────────────────────────────────────────────────────────────

const zoomCreated = (url: URL, init: any) => json({
  id: Number(MEETING_ID), uuid: 'Mtg+uuid==', join_url: 'https://zoom.us/j/85746065432?pwd=abc',
  start_url: 'https://zoom.us/s/85746065432?zak=SECRET-HOST-TOKEN', start_time: JSON.parse(init.body).start_time, duration: 30,
}, 201);

test('schedule, list, cancel and retry a Zoom call', async (t) => {
  const f = world();
  await connectZoom(f);
  const calls = mockFetch(t, {
    'POST https://api.zoom.us/v2/users/me/meetings': zoomCreated,
    'DELETE https://api.zoom.us/v2/meetings/85746065432': () => new Response(null, { status: 204 }),
    'GET https://api.zoom.us/v2/meetings/85846065432/recordings': () => zoomRecordings([TRANSCRIPT_FILE]),
    'GET https://zoom.us/rec/download/transcript-file': () => new Response(VTT),
  });
  const deletes = () => calls.filter((c) => c.key === 'DELETE https://api.zoom.us/v2/meetings/85746065432').length;
  const startsAt = new Date(Date.now() + 3 * HOUR + 123).toISOString();
  const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'zoom', starts_at: startsAt });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sent = JSON.parse(calls.find((c) => c.key === 'POST https://api.zoom.us/v2/users/me/meetings')!.body!);
  assert.equal(sent.type, 2);
  assert.equal(sent.duration, 30);
  assert.equal(sent.topic, 'Customer interview', 'neutral by default: the topic is visible to invitees');
  assert.match(sent.start_time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(sent.settings.auto_recording, 'none', 'recording is the member’s call');
  assert.equal(JSON.stringify(r.body).includes('SECRET-HOST-TOKEN'), false, 'the host start_url is never kept');
  const m = r.body.meeting;
  assert.equal(m.provider, 'zoom');
  assert.equal(m.label, 'Zoom');
  assert.equal(m.status, 'scheduled');
  assert.equal(m.join_url, 'https://zoom.us/j/85746065432?pwd=abc');
  assert.equal(Date.parse(m.ends_at) - Date.parse(m.starts_at), 30 * 60_000);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM interview_channel_refs').all()).includes('SECRET-HOST-TOKEN'), false);
  const session = f.db.prepare('SELECT channel, status, submitted_via, consent_status FROM interview_sessions WHERE id = ?').get(r.body.session_id);
  assert.deepEqual({ ...session }, { channel: 'video', status: 'draft', submitted_via: 'zoom', consent_status: 'given' });

  const rec = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'zoom', starts_at: startsAt, auto_record: true, topic: '  Ledger\n chat ' });
  assert.equal(rec.status, 409, 'Zoom gave the same id again: refused, and undone at Zoom');
  assert.equal(rec.body.error, 'meeting_conflict');
  assert.equal(deletes(), 1, 'the duplicate was cancelled at Zoom');
  const second = JSON.parse(calls.filter((c) => c.key === 'POST https://api.zoom.us/v2/users/me/meetings')[1].body!);
  assert.equal(second.settings.auto_recording, 'cloud');
  assert.equal(second.topic, 'Ledger chat');
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_sessions'), 1, 'the conflicting call left no session behind');

  const listed = await call(f.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.meetings.length, 1);
  assert.equal(listed.body.meetings[0].uid, m.uid);
  assert.deepEqual(listed.body.providers, [
    { provider: 'zoom', label: 'Zoom', available: true, connected: true, transcript_access: null },
    { provider: 'google_meet', label: 'Google Meet', available: true, connected: false, transcript_access: null },
  ]);

  const early = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${m.uid}/import`);
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'call_not_over');

  const cancelled = await call(f.env, ME, 'DELETE', `/interviews/${INTERVIEW}/meetings/${m.uid}`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.provider_cancelled, true);
  assert.equal(cancelled.body.meeting.status, 'cancelled');
  assert.equal(deletes(), 2, 'cancelled at Zoom');
  assert.equal((await call(f.env, ME, 'DELETE', `/interviews/${INTERVIEW}/meetings/${m.uid}`)).body.provider_cancelled, true, 'twice is a no-op and preserves provider confirmation');
  assert.equal(deletes(), 2);
  assert.equal((await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${m.uid}/import`)).body.error, 'meeting_cancelled');

  // Retry: a call that ended, whose first import failed, is imported on request.
  const { uid } = await seedRef(f, { status: 'failed', external_ref: '85846065432' });
  const retried = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`);
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.outcome, 'imported');
  assert.equal(retried.body.segments, 3);
  assert.equal(retried.body.meeting.status, 'imported');
  assert.equal((await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`)).body.outcome, 'skipped', 'an imported Zoom call can check for a missed restart without reimporting its first part');
  assert.equal((await call(f.env, ME, 'DELETE', `/interviews/${INTERVIEW}/meetings/${uid}`)).status, 409, 'an imported call is not cancelled');
});

test('another member’s interview is not there, and nor are another member’s calls', async (t) => {
  const f = world();
  await connectZoom(f);
  await connectZoom(f, {}, OTHER);
  const calls = mockFetch(t, {});
  const { uid } = await seedRef(f);
  for (const [method, path] of [
    ['GET', `/interviews/${THEIR_INTERVIEW}/meetings`],
    ['POST', `/interviews/${THEIR_INTERVIEW}/meetings`],
    ['DELETE', `/interviews/${THEIR_INTERVIEW}/meetings/${uid}`],
    ['POST', `/interviews/${THEIR_INTERVIEW}/meetings/${uid}/import`],
  ] as const) {
    const r = await call(f.env, ME, method, path, method === 'POST' && !path.endsWith('import') ? { consent: CONSENT, provider: 'zoom', starts_at: iso(HOUR) } : undefined);
    assert.equal(r.status, 404, `${method} ${path}`);
    assert.equal(r.body.error, 'interview_not_found');
  }
  for (const [method, path] of [
    ['GET', `/interviews/${INTERVIEW}/meetings`],
    ['DELETE', `/interviews/${INTERVIEW}/meetings/${uid}`],
    ['POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`],
  ] as const) {
    assert.equal((await call(f.env, OTHER, method, path)).status, 404, `OTHER ${method} ${path}`);
  }
  assert.equal(refRow(f, uid).status, 'scheduled', 'nothing moved');
  assert.equal(calls.length, 0, 'no provider was asked');
  const anon = await app.fetch(new Request(`http://x/api/founder/validate/interviews/${INTERVIEW}/meetings`), f.env);
  assert.equal(anon.status, 401);
});

test('a provider that is not set up answers 503; a member who has not connected answers 409', async (t) => {
  mockFetch(t, {});
  const dark = world({ ZOOM_WEBHOOK_SECRET_TOKEN: undefined, GOOGLE_CLIENT_ID: undefined });
  await connectZoom(dark);
  for (const provider of ['zoom', 'google_meet']) {
    const r = await call(dark.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider, starts_at: iso(HOUR) });
    assert.equal(r.status, 503, provider);
    assert.equal(r.body.error, 'provider_unavailable');
    assert.match(r.body.message, /not available on Axal yet/);
  }
  const listed = await call(dark.env, ME, 'GET', `/interviews/${INTERVIEW}/meetings`);
  assert.deepEqual(listed.body.providers.map((p: any) => [p.provider, p.available]), [['zoom', false], ['google_meet', false]]);
  const { uid } = await seedRef(dark, { status: 'ended' });
  assert.equal((await call(dark.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings/${uid}/import`)).status, 503);

  const f = world();
  for (const provider of ['zoom', 'google_meet']) {
    const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider, starts_at: iso(HOUR) });
    assert.equal(r.status, 409, provider);
    assert.equal(r.body.error, 'connect_first');
  }
  for (const [body, code] of [
    [{ provider: 'teams', starts_at: iso(HOUR) }, 'provider_invalid'],
    [{ provider: 'zoom', starts_at: iso(-2 * HOUR) }, 'starts_at_invalid'],
    [{ provider: 'zoom', starts_at: 'tomorrow-ish' }, 'starts_at_invalid'],
    [{ provider: 'zoom', starts_at: iso(HOUR), duration_min: 2 }, 'duration_invalid'],
    [{ provider: 'zoom', starts_at: iso(HOUR), duration_min: 30.5 }, 'duration_invalid'],
  ] as const) {
    const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, body);
    assert.equal(r.status, 400, code);
    assert.equal(r.body.error, code);
  }
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
});

test('a provider refusal at scheduling stores nothing and shows no provider text', async (t) => {
  const f = world();
  await connectZoom(f);
  let status = 401;
  mockFetch(t, { 'POST https://api.zoom.us/v2/users/me/meetings': () => json({ code: 124, message: 'Invalid access token.' }, status) });
  const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'zoom', starts_at: iso(HOUR) });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'zoom_reconnect');
  assert.equal(r.body.message, MEETING_ERRORS.zoom_reconnect);
  assert.equal(JSON.stringify(r.body).includes('Invalid access token'), false);
  status = 503;
  const busy = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: CONSENT, provider: 'zoom', starts_at: iso(HOUR) });
  assert.equal(busy.status, 503);
  assert.equal(busy.body.error, 'zoom_unreachable');
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
  assert.equal(count(f.db, 'SELECT COUNT(*) n FROM interview_channel_refs'), 0);
});

// ── The Connectors registry ──────────────────────────────────────────────────

test('Zoom is a Connectors provider: PKCE on the authorize URL, Basic auth on the exchange', async (t) => {
  const f = world();
  const desc = getDescriptor('zoom')!;
  assert.equal(desc.auth_type, 'oauth2');
  assert.equal(desc.tier, 'free');
  assert.deepEqual(desc.oauth_scopes, ['meeting:write:meeting', 'meeting:delete:meeting',
    'cloud_recording:read:list_recording_files', 'meeting:read:meeting', 'meeting:read:list_past_instances', 'user:read:user']);
  assert.equal(CONNECTOR_METADATA.zoom.permissions.length, desc.oauth_scopes!.length, 'one plain sentence per scope');
  assert.equal(CONNECTOR_METADATA.zoom.category, 'Messaging');

  const impl = getProviderImpl('zoom')!;
  f.db.prepare('INSERT INTO oauth_state_tokens (state, user_id, provider, pkce_verifier, extra_json) VALUES (?, ?, ?, ?, ?)')
    .run('nonce.sig', ME, 'zoom', 'the-verifier', JSON.stringify({ challenge: 'the-challenge' }));
  const c: any = { env: f.env };
  const url = new URL(await impl.buildAuthorizeUrl!(c, { id: ME } as any, 'nonce.sig'));
  assert.equal(url.origin + url.pathname, 'https://zoom.us/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'zoom-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://axal.test/api/integrations/oauth/zoom/callback');
  assert.equal(url.searchParams.get('code_challenge'), 'the-challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');

  const calls = mockFetch(t, {
    'POST https://zoom.us/oauth/token': () => json({
      access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: desc.oauth_scopes!.join(' ') }),
    'GET https://api.zoom.us/v2/users/me': () => json({ id: 'zoom-user-fixture', account_id: 'zoom-account-fixture' }),
  });
  const out = await impl.connect(c, { id: ME } as any, { oauth_code: 'the-code', config: { pkce_verifier: 'the-verifier' } });
  const sent = new URLSearchParams(calls[0].body!);
  assert.equal(calls[0].headers.get('authorization'), `Basic ${btoa('zoom-client-id:zoom-client-secret')}`);
  assert.deepEqual([sent.get('grant_type'), sent.get('code'), sent.get('code_verifier')], ['authorization_code', 'the-code', 'the-verifier']);
  assert.equal(out.credentials.access_token, 'at');
  assert.equal(out.credentials.refresh_token, 'rt');
  assert.ok(Number(out.credentials.expires_at) > Date.now());
  assert.deepEqual(out.scopes, desc.oauth_scopes);
  assert.equal(out.external_account_id, 'zoom-user-fixture');
  assert.deepEqual(out.config, { zoom_account_id: 'zoom-account-fixture' });

  const dark: any = { env: { ...f.env, ZOOM_CLIENT_ID: undefined } };
  await assert.rejects(impl.buildAuthorizeUrl!(dark, { id: ME } as any, 's'), /^Error: zoom_oauth_unconfigured/);
});

test('a call is scheduled only with the interviewee\'s consent recorded, and how it was given', async (t) => {
  const f = world();
  await connectZoom(f);
  for (const consent of [undefined, { status: 'not_recorded' }, { status: 'given' }, { status: 'given', method: 'telepathy' }]) {
    const r = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent, provider: 'zoom', starts_at: iso(HOUR) });
    assert.deepEqual([r.status, r.body.error], [400, 'consent_required']);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_sessions').get().n, 0, 'nothing is created without consent');
  mockFetch(t, { 'POST https://api.zoom.us/v2/users/me/meetings': () => json({ id: 81122334455, join_url: 'https://zoom.us/j/81122334455', start_time: iso(HOUR) }) });
  const ok = await call(f.env, ME, 'POST', `/interviews/${INTERVIEW}/meetings`, { consent: { status: 'given', method: 'written' }, provider: 'zoom', starts_at: iso(HOUR) });
  assert.equal(ok.status, 201);
  const s = f.db.prepare('SELECT consent_status, consent_method, consent_at FROM interview_sessions WHERE id = ?').get(ok.body.session_id);
  assert.deepEqual([s.consent_status, s.consent_method, typeof s.consent_at], ['given', 'written', 'string']);
});
