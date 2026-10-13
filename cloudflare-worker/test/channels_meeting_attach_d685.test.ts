/** D685 #1585: attached calls, consent and deauthorization. All provider I/O is mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import meetingsRouter, { zoomWebhook } from '../src/routes/founder_validate_meetings.ts';
import channelsRouter from '../src/routes/channels.ts';
import calendarRouter, { buildGoogleOAuthStartResponse } from '../src/routes/calendar.ts';
import { GOOGLE_MEET_TRANSCRIPT_SCOPE } from '../src/services/calendar.ts';
import { closeAttachedRefs, importMeetingRef, loadRef } from '../src/services/channels/meetings.ts';
import { googleConnection, transcriptAccess } from '../src/services/channels/googleMeet.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const SIGNING_KEY = 'test-only-session-signing-material-0123456789';
const WEBHOOK_KEY = 'test-only-zoom-webhook-material';
const ME = 2, OTHER = 3, FOUNDER = 9, INTERVIEW = 101, FOREIGN_INTERVIEW = 501;
const ZOOM_ID = '85746065432', MEET_CODE = 'abc-mnop-xyz';
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
    '449_interview_channels.sql']) db.exec(migration(name));
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
function recording(f: World, id = INTERVIEW) {
  const uid = crypto.randomUUID();
  const row = f.db.prepare(`INSERT INTO interview_sessions
    (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
     started_at, submitted_via)
    VALUES (?, ?, ?, ?, 'video', 'recording', 'given', 'verbal', datetime('now'), datetime('now'), NULL) RETURNING id`)
    .get(uid, id, id === INTERVIEW ? 7 : 8, ME);
  return Number(row.id);
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

test('attached Zoom call verifies its host, rejects reuse, and closes at recording stop', async (t) => {
  const f = world();
  const sessionId = recording(f);
  await zoomConnected(f);
  const calls = mockFetch(t, {
    'GET https://api.zoom.us/v2/users/me': () => json({ id: 'host-1', account_id: 'account-1' }),
    [`GET https://api.zoom.us/v2/meetings/${ZOOM_ID}`]: () => json({ id: Number(ZOOM_ID), host_id: 'host-1' }),
  });
  const input = { attach: { join_url: `https://zoom.us/j/${ZOOM_ID}` }, session_id: sessionId };
  const made = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, input);
  assert.equal(made.status, 201);
  assert.equal((await loadRef(f.env, made.body.meeting.uid))?.external_ref, ZOOM_ID);
  assert.match(made.body.notice.message, /only if this connected account hosts/);
  const ref = await loadRef(f.env, made.body.meeting.uid);
  assert.equal(ref?.ends_at, null);
  assert.equal(calls.filter((s) => s.includes('/users/me')).length, 1);
  const again = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, input);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'meeting_link_reused');
  f.db.prepare("UPDATE interview_sessions SET status = 'stopped', stopped_at = datetime('now') WHERE id = ?").run(sessionId);
  assert.equal(await closeAttachedRefs(f.env, sessionId), 1);
  assert.ok((await loadRef(f.env, ref!.uid))?.ends_at);
  assert.equal(await closeAttachedRefs(f.env, sessionId), 0);
});

test('channel status reports only this member’s Zoom and Meet connections, including transcript access', async () => {
  const f = world();
  const get = async () => {
    const response = await app.fetch(new Request('http://x/api/channels', { headers: await auth() }), f.env);
    assert.equal(response.status, 200);
    return await response.json() as any;
  };
  const empty = await get();
  assert.equal(empty.connections.zoom, undefined);
  assert.equal(empty.connections.google_meet, undefined);
  await zoomConnected(f);
  await meetConnected(f, 'https://www.googleapis.com/auth/calendar.events');
  const connected = await get();
  assert.deepEqual(connected.connections.zoom, { status: 'active' });
  assert.deepEqual(connected.connections.google_meet, { status: 'active', transcript_access: 'missing' });
  f.db.prepare('UPDATE google_oauth_tokens SET scope = ? WHERE user_id = ?')
    .run(GOOGLE_MEET_TRANSCRIPT_SCOPE, ME);
  assert.equal((await get()).connections.google_meet.transcript_access, 'granted');
});

test('attached call refuses another host and another interview without storing a ref', async (t) => {
  const f = world();
  const sessionId = recording(f);
  await zoomConnected(f);
  mockFetch(t, {
    'GET https://api.zoom.us/v2/users/me': () => json({ id: 'host-1', account_id: 'account-1' }),
    [`GET https://api.zoom.us/v2/meetings/${ZOOM_ID}`]: () => json({ id: Number(ZOOM_ID), host_id: 'host-2' }),
  });
  const input = { attach: { join_url: `https://zoom.us/j/${ZOOM_ID}` }, session_id: sessionId };
  assert.equal((await request(f, 'POST', `/interviews/${FOREIGN_INTERVIEW}/meetings`, input)).status, 404);
  const foreign = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, input);
  assert.equal(foreign.status, 409);
  assert.equal(foreign.body.error, 'meeting_not_hosted');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_channel_refs').get().n, 0);
});

test('attached Meet verifies own Calendar event; import creates provider session without changing recording', async (t) => {
  const f = world();
  const sessionId = recording(f);
  await meetConnected(f);
  f.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text) VALUES (?, 'final', 'Speaker', 'Recorder words')")
    .run(sessionId);
  f.db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run('Recorder words', INTERVIEW);
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access' }),
    'GET https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json({ items: [
      { organizer: { self: true }, hangoutLink: `https://meet.google.com/${MEET_CODE}` },
    ] }),
  });
  const made = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, {
    attach: { join_url: `https://meet.google.com/${MEET_CODE}` }, session_id: sessionId,
  });
  assert.equal(made.status, 201);
  assert.equal((await loadRef(f.env, made.body.meeting.uid))?.external_ref, MEET_CODE);
  assert.ok(calls.includes('GET https://www.googleapis.com/calendar/v3/calendars/primary/events'));
  const ref = (await loadRef(f.env, made.body.meeting.uid))!;
  const imported = await importMeetingRef(f.env, ref, async () => ({ kind: 'segments', segments: [
    { text: 'Fixture transcript', speaker: 'Speaker', startMs: 1000, endMs: 2000 },
  ] }));
  assert.equal(imported.status, 'imported');
  const recordingRow = f.db.prepare('SELECT status, submitted_via FROM interview_sessions WHERE id = ?').get(sessionId);
  assert.equal(recordingRow.status, 'recording');
  assert.equal(recordingRow.submitted_via, null);
  assert.equal(f.db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ?').get(sessionId).text,
    'Recorder words');
  const provider = f.db.prepare("SELECT id, status, submitted_via FROM interview_sessions WHERE uid = ?")
    .get(`meeting:${ref.uid}`);
  assert.equal(provider.submitted_via, 'google_meet');
  assert.equal(provider.status, 'transcribed');
  assert.equal(f.db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ?').get(provider.id).text,
    'Fixture transcript');
  assert.equal(f.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript,
    'Recorder words');
});

test('attached Meet refuses a call organised by another account', async (t) => {
  const f = world();
  const sessionId = recording(f);
  await meetConnected(f);
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access' }),
    'GET https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json({ items: [
      { organizer: { self: false }, hangoutLink: `https://meet.google.com/${MEET_CODE}` },
    ] }),
  });
  const response = await request(f, 'POST', `/interviews/${INTERVIEW}/meetings`, {
    attach: { join_url: `https://meet.google.com/${MEET_CODE}` }, session_id: sessionId,
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'meeting_not_hosted');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_channel_refs').get().n, 0);
});

test('Meet transcript scope is requested only by incremental consent, and missing grant leaves old token', async (t) => {
  const f = world();
  await meetConnected(f, 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(transcriptAccess(await googleConnection(f.env, ME)), 'missing');
  const regular = await buildGoogleOAuthStartResponse(f.env, ME);
  assert.equal(regular.status, 200);
  assert.ok(!new URL(regular.body.redirect_url).searchParams.get('scope')?.includes(GOOGLE_MEET_TRANSCRIPT_SCOPE));
  const opted = await buildGoogleOAuthStartResponse(f.env, ME, undefined, true);
  assert.equal(opted.status, 200);
  assert.ok(new URL(opted.body.redirect_url).searchParams.get('scope')?.includes(GOOGLE_MEET_TRANSCRIPT_SCOPE));
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access', refresh_token: 'new-refresh',
      scope: 'https://www.googleapis.com/auth/calendar.events' }),
  });
  const state = new URL(opted.body.redirect_url).searchParams.get('state');
  const response = await app.fetch(new Request(`http://x/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state!)}`), f.env);
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') || '', /meet_scope_missing/);
  assert.equal(transcriptAccess(await googleConnection(f.env, ME)), 'missing');
});

test('explicit Meet consent callback stores the grant and returns to Record', async (t) => {
  const f = world();
  await meetConnected(f, 'https://www.googleapis.com/auth/calendar.events');
  const start = await app.fetch(new Request('http://x/api/calendar/google/meet-transcripts/connect?return_to=record', {
    method: 'POST', headers: await auth(),
  }), f.env);
  assert.equal(start.status, 200);
  assert.match(start.headers.get('set-cookie') || '', /studioos_cal_return=record/);
  const url = new URL((await start.json() as any).redirect_url);
  assert.ok(url.searchParams.get('scope')?.includes(GOOGLE_MEET_TRANSCRIPT_SCOPE));
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access', refresh_token: 'new-refresh',
      scope: `https://www.googleapis.com/auth/calendar.events ${GOOGLE_MEET_TRANSCRIPT_SCOPE}` }),
    'GET https://www.googleapis.com/oauth2/v2/userinfo': () => json({}),
  });
  const state = url.searchParams.get('state');
  const callback = await app.fetch(new Request(
    `http://x/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state!)}`,
    { headers: { Cookie: 'studioos_cal_return=record' } },
  ), f.env);
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location') || '', /^https:\/\/axal\.test\/validate\/record\?google=connected/);
  assert.equal(transcriptAccess(await googleConnection(f.env, ME)), 'granted');
});

test('signed Zoom deauthorization removes only the matched member connection and is idempotent', async () => {
  const f = world();
  await zoomConnected(f);
  await zoomConnected(f, OTHER);
  const payload = JSON.stringify({ event: 'app_deauthorized', event_id: 'event-1', event_ts: Date.now(),
    payload: { client_id: f.env.ZOOM_CLIENT_ID, user_id: 'host-1', account_id: 'account-1' } });
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_KEY).update(`v0:${ts}:${payload}`).digest('hex');
  const headers = { 'x-zm-signature': `v0=${signature}`, 'x-zm-request-timestamp': String(ts) };
  const post = (h: Record<string, string>) => app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: h, body: payload,
  }), f.env);
  assert.equal((await post({})).status, 401);
  assert.equal(f.db.prepare("SELECT status FROM integrations WHERE provider_key = 'zoom' AND user_id = ?").get(ME).status, 'active');
  assert.equal((await post(headers)).status, 200);
  const row = f.db.prepare("SELECT status, credentials_enc, external_account_id FROM integrations WHERE provider_key = 'zoom' AND user_id = ?").get(ME);
  assert.equal(row.status, 'disconnected');
  assert.equal(row.credentials_enc, null);
  assert.equal(row.external_account_id, null);
  assert.equal(f.db.prepare("SELECT status FROM integrations WHERE provider_key = 'zoom' AND user_id = ?").get(OTHER).status,
    'active');
  assert.equal((await post(headers)).status, 200);
});

test('deauthorization with only an account id cannot disconnect every user in that Zoom account', async () => {
  const f = world();
  await zoomConnected(f);
  const payload = JSON.stringify({ event: 'app_deauthorized', event_id: 'event-account-only',
    payload: { client_id: f.env.ZOOM_CLIENT_ID, account_id: 'account-1' } });
  const ts = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_KEY).update(`v0:${ts}:${payload}`).digest('hex');
  const response = await app.fetch(new Request('http://x/api/channels/zoom/webhook', {
    method: 'POST', headers: { 'x-zm-signature': `v0=${signature}`, 'x-zm-request-timestamp': String(ts) }, body: payload,
  }), f.env);
  assert.equal(response.status, 400);
  assert.equal(f.db.prepare("SELECT status FROM integrations WHERE provider_key = 'zoom'").get().status, 'active');
});
