/**
 * D1358 — Record a Session: a Zoom, Google Meet or Teams call is captured by
 * the provider (Eadwyn AI joining, or an import after the call), never by the
 * browser recorder. The Worker half:
 *
 *   · GET /meetings/capabilities tells the truth per provider for this member:
 *     nothing set up is all false with a reason; connected Zoom imports after
 *     the call and says RTMS is not configured; Meet without the transcript
 *     scope cannot import; Teams has no import at all; the bot only where it
 *     is deployed. No token, link or secret is in the reply.
 *   · A Zoom link attached with no session (`{ attach: { join_url }, consent }`)
 *     is verified as hosted by the member's own connected account, opens its
 *     own video session marked `zoom`, and stores the call for import. It is
 *     refused without consent, without a connection, for another host's call,
 *     for another member's interview; a refusal leaves no session behind.
 *   · A retry of the same attach answers the first one (200, `existing`) with
 *     the same session, for Zoom and for a Calendar Meet call, and only for
 *     the member who made it.
 *   · Zoom's `meeting.ended` gives that call its end, so the sweep can find it;
 *     a link pasted beside a recording still waits for Stop.
 *
 * Every provider request is a mocked `globalThis.fetch` that fails on
 * anything unmocked.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/meeting_capture_d1358.test.ts
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
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import { GOOGLE_MEET_TRANSCRIPT_SCOPE } from '../src/services/calendar.ts';
import { loadRef } from '../src/services/channels/meetings.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const SIGNING_KEY = 'test-only-session-signing-material-0123456789';
// Joined, so no HMAC key sits in the source as one literal (the d690 fixtures do the same).
const WEBHOOK_KEY = ['test', 'only', 'zoom', 'webhook', 'material'].join('-');
const ME = 2, OTHER = 3, FOUNDER = 9, INTERVIEW = 101, FOREIGN_INTERVIEW = 501;
const ZOOM_ID = '85746065432', MEET_CODE = 'abc-mnop-xyz';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

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
    '449_interview_channels.sql', '529_meeting_transcript_source.sql', '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    '488_channel_consents.sql', '452_record_session_setup.sql']) db.exec(migration(name));
    applySessionTranslationColumns(db); // D857: migration 527's segment columns
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  const jobs: unknown[] = [];
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SIGNING_KEY, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-fixture-client', ZOOM_CLIENT_SECRET: 'zoom-fixture-secret', ZOOM_WEBHOOK_SECRET_TOKEN: WEBHOOK_KEY,
    GOOGLE_CLIENT_ID: 'google-fixture-client', GOOGLE_CLIENT_SECRET: 'google-fixture-secret',
    APP_URL: 'https://axal.test', PUBLIC_BASE_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    USE_CF_QUEUE: 'true', JOB_QUEUE: { async send(job: unknown) { jobs.push(job); } },
    ...over,
  };
  return { env, db, jobs };
}
type World = ReturnType<typeof world>;

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.route('/api/channels', zoomWebhook as any);
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
async function zoomConnected(f: World, userId = ME) {
  const uid = `zoom-test-${userId}`;
  const encrypted = await encryptCredentials(f.env, uid, {
    access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_at: Date.now() + 3600000,
  });
  f.db.prepare(`INSERT INTO integrations
    (uid, user_id, provider_key, status, auth_type, credentials_enc, external_account_id, config_json)
    VALUES (?, ?, 'zoom', 'active', 'oauth2', ?, ?, '{"zoom_account_id":"account-1"}')`)
    .run(uid, userId, encrypted, userId === ME ? 'host-1' : 'host-2');
}
async function meetConnected(f: World, scope = `https://www.googleapis.com/auth/calendar.events ${GOOGLE_MEET_TRANSCRIPT_SCOPE}`) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(ME, await encryptString(f.env, 'fixture-refresh'), scope);
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


const ZOOM_HOSTED = {
  'GET https://api.zoom.us/v2/users/me': () => json({ id: 'host-1', account_id: 'account-1' }),
  [`GET https://api.zoom.us/v2/meetings/${ZOOM_ID}`]: () => json({ id: Number(ZOOM_ID), host_id: 'host-1' }),
};
const CONSENT = { status: 'given', method: 'verbal' };
const ZOOM_LINK = `https://us02web.zoom.us/j/${ZOOM_ID}?pwd=fixture`;
const saveZoom = (f: World, extra: Record<string, unknown> = { consent: CONSENT }, interview = INTERVIEW) =>
  request(f, 'POST', `/interviews/${interview}/meetings`, { attach: { join_url: ZOOM_LINK }, ...extra });
const sessionCount = (f: World) => Number(f.db.prepare('SELECT COUNT(*) n FROM interview_sessions').get().n);
const BOT_RUN = { idFromName: (s: string) => s, get: () => ({ fetch: async () => json({}) }) };
const DEPLOYED = {
  MEETING_BOT: 'on', MEETING_BOT_SECRET: 'd1358-'.padEnd(40, 'x'), MEETING_BOT_RUN: BOT_RUN, MEETING_BOT_COST_MICROUSD_PER_MINUTE: '2232',
  MEETING_BOT_RUNTIME: { async start() {}, async stop() {} }, AI_BILLING: 'charged',
};
const SECRET_WORDS = ['fixture-access', 'fixture-refresh', 'zoom-fixture-secret', 'google-fixture-secret', 'd1358-', 'access_token', 'refresh_token'];

test('capabilities: nothing set up is false everywhere, with a reason, and no browser mode', async (t) => {
  mockFetch(t, {});
  const f = world({ ZOOM_CLIENT_ID: undefined, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
  const r = await request(f, 'GET', '/meetings/capabilities');
  assert.equal(r.status, 200);
  assert.equal(r.body.bot.available, false);
  for (const p of ['zoom', 'google_meet', 'teams']) {
    const cap = r.body.providers[p];
    assert.equal(cap.can_join_as_bot, false, p);
    assert.equal(cap.can_capture_realtime_audio, false, p);
    assert.equal(cap.can_retrieve_transcript, false, p);
    assert.deepEqual(cap.capture_modes, [], `${p}: no capture mode, and never the browser`);
    assert.ok(typeof cap.reason === 'string' && cap.reason.length > 10, `${p} says why`);
  }
  assert.equal(r.body.providers.zoom.available, false);
});

test('capabilities: connected Zoom imports after the call and says RTMS is not configured; Meet needs its transcript scope; Teams has no import', async (t) => {
  mockFetch(t, {});
  const f = world();
  await zoomConnected(f);
  await meetConnected(f, 'https://www.googleapis.com/auth/calendar.events');
  const r = await request(f, 'GET', '/meetings/capabilities');
  const { zoom, google_meet: meet, teams } = r.body.providers;
  assert.deepEqual([zoom.connected, zoom.can_create_meeting, zoom.can_retrieve_transcript, zoom.can_retrieve_recording], [true, true, true, true]);
  assert.deepEqual([zoom.can_join_as_bot, zoom.can_capture_realtime_audio], [false, false], 'the bot is not deployed here');
  assert.deepEqual(zoom.capture_modes, ['post_meeting_import']);
  assert.equal(zoom.reason, null);
  assert.ok(zoom.notes.some((n: string) => /RTMS/.test(n)), 'RTMS is named as not configured');
  assert.deepEqual([meet.connected, meet.can_create_meeting, meet.can_retrieve_transcript], [true, true, false]);
  assert.deepEqual(meet.capture_modes, [], 'no transcript scope: no import');
  assert.match(meet.reason, /Reconnect Google/);
  assert.deepEqual([teams.connected, teams.can_create_meeting, teams.can_retrieve_transcript, teams.can_join_as_bot], [false, false, false, false]);
  assert.deepEqual(teams.capture_modes, []);
  assert.match(teams.reason, /no Microsoft Teams connection/);
  f.db.prepare('UPDATE google_oauth_tokens SET scope = ? WHERE user_id = ?').run(GOOGLE_MEET_TRANSCRIPT_SCOPE, ME);
  const granted = (await request(f, 'GET', '/meetings/capabilities')).body.providers.google_meet;
  assert.deepEqual([granted.can_retrieve_transcript, granted.reason], [true, null]);
  assert.deepEqual(granted.capture_modes, ['post_meeting_import']);
  const text = JSON.stringify(r.body);
  for (const word of SECRET_WORDS) assert.ok(!text.includes(word), `no ${word} in the reply`);
});

test('capabilities: a deployed bot adds the bot mode on every platform, Teams included', async (t) => {
  mockFetch(t, {});
  const f = world(DEPLOYED);
  await zoomConnected(f);
  const r = await request(f, 'GET', '/meetings/capabilities');
  assert.equal(r.body.bot.available, true);
  assert.deepEqual(r.body.providers.zoom.capture_modes, ['bot', 'post_meeting_import']);
  assert.deepEqual(r.body.providers.google_meet.capture_modes, ['bot'], 'not connected: the bot only');
  assert.deepEqual(r.body.providers.teams.capture_modes, ['bot']);
  assert.equal(r.body.providers.teams.reason, null);
  const text = JSON.stringify(r.body);
  for (const word of SECRET_WORDS) assert.ok(!text.includes(word), `no ${word} in the reply`);
});

test('a hosted Zoom call saved with no session opens its own session for import after the call', async (t) => {
  const f = world();
  await zoomConnected(f);
  const calls = mockFetch(t, ZOOM_HOSTED);
  const made = await saveZoom(f);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.notice.code, 'zoom_import_after_call');
  assert.match(made.body.notice.message, /does not record this call itself/);
  const ref = (await loadRef(f.env, made.body.meeting.uid))!;
  assert.deepEqual([ref.provider, ref.external_ref, ref.status, ref.ends_at, Number(ref.session_id)],
    ['zoom', ZOOM_ID, 'scheduled', null, made.body.session_id]);
  const session = f.db.prepare('SELECT channel, status, submitted_via, consent_status, consent_method, audio_bytes, created_by_user_id FROM interview_sessions WHERE id = ?')
    .get(made.body.session_id);
  assert.deepEqual({ ...session }, { channel: 'video', status: 'draft', submitted_via: 'zoom', consent_status: 'given',
    consent_method: 'verbal', audio_bytes: 0, created_by_user_id: ME });
  assert.deepEqual(calls.sort(), ['GET https://api.zoom.us/v2/meetings/' + ZOOM_ID, 'GET https://api.zoom.us/v2/users/me']);
  assert.ok(!JSON.stringify(made.body).includes('fixture-access'));
});

test('a retried save answers the first one with the same session; another interview is refused', async (t) => {
  const f = world();
  await zoomConnected(f);
  const calls = mockFetch(t, ZOOM_HOSTED);
  const first = await saveZoom(f);
  const before = calls.length;
  const again = await saveZoom(f);
  assert.equal(again.status, 200);
  assert.equal(again.body.existing, true);
  assert.equal(again.body.session_id, first.body.session_id);
  assert.equal(again.body.meeting.uid, first.body.meeting.uid);
  assert.equal(calls.length, before, 'a retry asks Zoom nothing');
  assert.equal(sessionCount(f), 1, 'one call, one session');
  f.db.prepare("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (102, 7, 'Second interviewee')").run();
  const elsewhere = await saveZoom(f, { consent: CONSENT }, 102);
  assert.deepEqual([elsewhere.status, elsewhere.body.error], [409, 'meeting_link_reused']);
  assert.equal(sessionCount(f), 1, 'the refused save left no session behind');
});

test('a Zoom save is refused without consent, a connection, the host, or the member\'s own interview, leaving nothing', async (t) => {
  const f = world();
  const calls = mockFetch(t, {
    'GET https://api.zoom.us/v2/users/me': () => json({ id: 'host-1', account_id: 'account-1' }),
    [`GET https://api.zoom.us/v2/meetings/${ZOOM_ID}`]: () => json({ id: Number(ZOOM_ID), host_id: 'someone-else' }),
  });
  const noConsent = await saveZoom(f, {});
  assert.deepEqual([noConsent.status, noConsent.body.error], [400, 'consent_required']);
  const notConnected = await saveZoom(f);
  assert.deepEqual([notConnected.status, notConnected.body.error], [409, 'connect_first']);
  await zoomConnected(f);
  assert.equal((await saveZoom(f, { consent: CONSENT }, FOREIGN_INTERVIEW)).status, 404);
  assert.equal(calls.length, 0, 'no Zoom request before consent, a connection and the member\'s own interview');
  const notHosted = await saveZoom(f);
  assert.deepEqual([notHosted.status, notHosted.body.error], [409, 'meeting_not_hosted']);
  const unavailable = await saveZoom(world({ ZOOM_CLIENT_ID: undefined }));
  assert.deepEqual([unavailable.status, unavailable.body.error], [503, 'provider_unavailable']);
  for (const bad of ['http://zoom.us/j/85746065432', 'https://zoom.us.evil.example/j/85746065432', 'https://zoom.us/s/85746065432',
    'https://user:pw@zoom.us/j/85746065432', 'javascript:alert(1)', 'https://teams.microsoft.com/l/meetup-join/abc']) {
    const r = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, { attach: { join_url: bad }, consent: CONSENT });
    assert.deepEqual([r.status, r.body.error], [400, 'meeting_link_invalid'], bad);
  }
  assert.equal(sessionCount(f), 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_channel_refs').get().n, 0);
});

test('another member\'s retry is not answered with the first member\'s session', async (t) => {
  const f = world();
  await zoomConnected(f);
  mockFetch(t, ZOOM_HOSTED);
  const first = await saveZoom(f);
  f.db.prepare('UPDATE interview_channel_refs SET user_id = ? WHERE uid = ?').run(OTHER, first.body.meeting.uid);
  const r = await saveZoom(f);
  assert.deepEqual([r.status, r.body.error], [409, 'meeting_link_reused']);
  assert.equal(r.body.session_id, undefined);
});

async function zoomEvent(f: World, event: string, uuid: string) {
  const payload = JSON.stringify({ event, event_ts: Date.now(), payload: { account_id: 'account-1', object: { id: ZOOM_ID, uuid } } });
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_KEY).update(`v0:${ts}:${payload}`).digest('hex');
  return app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: { 'x-zm-signature': `v0=${signature}`, 'x-zm-request-timestamp': String(ts) }, body: payload,
  }), f.env);
}

test('meeting.ended gives a saved call its end; a link pasted beside a recording waits for Stop', async (t) => {
  const f = world();
  await zoomConnected(f);
  mockFetch(t, ZOOM_HOSTED);
  const made = await saveZoom(f);
  assert.equal((await zoomEvent(f, 'meeting.ended', 'uuid-saved')).status, 200);
  const ended = (await loadRef(f.env, made.body.meeting.uid))!;
  assert.equal(ended.status, 'ended');
  assert.ok(ended.ends_at && Number.isFinite(Date.parse(ended.ends_at)), 'the call now has an end the sweep can read');
  // A D685 link pasted for a browser recording keeps ends_at empty until Stop.
  f.db.prepare('DELETE FROM interview_channel_refs').run();
  const rec = f.db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status,
      consent_status, consent_method, started_at) VALUES ('rec', ?, 7, ?, 'video', 'recording', 'given', 'verbal', datetime('now')) RETURNING id`)
    .get(INTERVIEW, ME);
  f.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, status)
      VALUES ('pasted', 'zoom', ?, ?, ?, ?, ?, datetime('now'), 'scheduled')`).run(ZOOM_ID, rec.id, INTERVIEW, ME, ZOOM_LINK);
  assert.equal((await zoomEvent(f, 'meeting.ended', 'uuid-pasted')).status, 200);
  const pasted = (await loadRef(f.env, 'pasted'))!;
  assert.deepEqual([pasted.status, pasted.ends_at], ['ended', null]);
});

test('a retried Calendar Meet attach answers the first one', async (t) => {
  const f = world();
  await meetConnected(f);
  const start = new Date(Date.now() - 30 * 60_000).toISOString();
  const end = new Date(Date.now() + 30 * 60_000).toISOString();
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access' }),
    'GET https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json({ items: [{
      id: 'evt0001fixture', organizer: { self: true }, hangoutLink: `https://meet.google.com/${MEET_CODE}`,
      conferenceData: { conferenceId: MEET_CODE, entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${MEET_CODE}` }] },
      start: { dateTime: start }, end: { dateTime: end },
    }] }),
  });
  const body = { attach: { join_url: `https://meet.google.com/${MEET_CODE}` }, consent: CONSENT };
  const first = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, body);
  assert.equal(again.status, 200);
  assert.equal(again.body.existing, true);
  assert.equal(again.body.session_id, first.body.session_id);
  assert.equal(sessionCount(f), 1);
});
