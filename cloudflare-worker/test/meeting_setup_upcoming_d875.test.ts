/**
 * D875 (#2522): the Zoom and Google Meet setup read, and the member's upcoming
 * calls with their attach path. Setup reads stored rows only; every provider
 * request is mocked, and an unmocked one fails the test.
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
import meetingsRouter from '../src/routes/founder_validate_meetings.ts';
import sessionsRouter from '../src/routes/founder_validate_sessions.ts';
import { GOOGLE_MEET_TRANSCRIPT_SCOPE } from '../src/services/calendar.ts';
import { ATTACH_BLOCKED, MEETING_PREREQUISITES, MEETING_SETUP_ACTIONS, UPCOMING_DAYS, zoomLinkOf } from '../src/services/channels/meetingSetup.ts';
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (n: string) => readFileSync(new URL(`../sql/migrations/${n}`, import.meta.url), 'utf8');
const SIGNING_KEY = 'test-only-session-signing-material-0123456789';
const ME = 2, OTHER = 3, FOUNDER = 9, INTERVIEW = 101;
const ZOOM_ID = '85746065432', OTHER_ZOOM_ID = '91234567890', MEET_CODE = 'abc-mnop-xyz', THEIR_MEET = 'qrs-tuvw-xyz', HELD_MEET = 'hel-dmee-tin';
const CALENDAR = 'GET https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TOKEN = 'POST https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function world(extra: Record<string, unknown> = {}) {
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
    INSERT INTO projects (id, name, founder_id) VALUES (7, 'Fixture project', ${FOUNDER});
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, interviewee_name TEXT NOT NULL, interviewee_role TEXT,
      interview_date TEXT, notes TEXT, hypotheses_json TEXT, pains_json TEXT, icp_fit TEXT,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${INTERVIEW}, 7, 'Fixture interviewee');
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const name of ['integrations', 'google_oauth_tokens', 'waitlist_signups', 'metric_targets', 'competitor_analyses',
    'competitor_candidates', 'competitor_sources', 'competitor_signals']) db.exec(tableFromBaseline(BASELINE, name));
  for (const name of ['106_pain_groups.sql', '211_founder_validate_evidence.sql', '214_validate_proposals.sql',
    '246_fills_the_blanks_everywhere.sql', '438_interview_sessions.sql', '439_validate_proposals_structuring.sql',
    '440_validate_cycle_stores.sql', '446_interview_structure_receipts.sql', '447_assistant_interviews.sql',
    '449_interview_channels.sql', '457_integrations_last_error_at.sql', '458_channel_link_consent.sql',
    '488_channel_consents.sql']) db.exec(migration(name));
  applyEngineSchema(db);
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SIGNING_KEY, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-fixture-client', ZOOM_CLIENT_SECRET: 'zoom-fixture-secret', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-fixture-hook',
    GOOGLE_CLIENT_ID: 'google-fixture-client', GOOGLE_CLIENT_SECRET: 'google-fixture-secret',
    APP_URL: 'https://axal.test', PUBLIC_BASE_URL: 'https://axal.test', RATE_LIMITS: memKV(), ...extra,
  };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return { env, db };
}
type World = ReturnType<typeof world>;

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', sessionsRouter as any);
  a.route('/api/founder/validate', meetingsRouter as any);
  a.onError((err: any, c) => c.json({ detail: err?.message }, 500));
  return a;
})();

async function request(f: World, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SIGNING_KEY));
  const res = await app.fetch(new Request(`http://x${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), f.env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const setup = (f: World) => request(f, 'GET', '/api/founder/validate/meetings/setup');
const upcoming = (f: World) => request(f, 'GET', '/api/founder/validate/meetings/upcoming');

async function zoomConnected(f: World, userId = ME) {
  const uid = `zoom-test-${userId}`;
  const encrypted = await encryptCredentials(f.env, uid, {
    access_token: `zoom-access-${userId}`, refresh_token: `zoom-refresh-${userId}`, token_type: 'bearer', expires_at: Date.now() + 3600000,
  });
  f.db.prepare(`INSERT INTO integrations
    (uid, user_id, provider_key, status, auth_type, credentials_enc, external_account_id, config_json)
    VALUES (?, ?, 'zoom', 'active', 'oauth2', ?, ?, '{"zoom_account_id":"account-1"}')`)
    .run(uid, userId, encrypted, `host-${userId}`);
}
async function googleConnected(f: World, scope: string, userId = ME) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(userId, await encryptString(f.env, `google-refresh-${userId}`), scope);
}
function recording(f: World) {
  const row = f.db.prepare(`INSERT INTO interview_sessions
    (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at,
     started_at, submitted_via)
    VALUES (?, ?, 7, ?, 'video', 'recording', 'given', 'verbal', datetime('now'), datetime('now'), NULL) RETURNING id`)
    .get(crypto.randomUUID(), INTERVIEW, ME);
  return Number(row.id);
}

interface Seen { key: string; url: URL; init: any }
function mockFetch(t: any, routes: Record<string, (url: URL, init: any) => Response | Promise<Response>>) {
  const old = globalThis.fetch;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    seen.push({ key, url, init });
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked provider request: ${key}`);
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = old; });
  return seen;
}
function stateOf(provider: any) {
  // A step left to do carries its sentence; a done one carries none.
  for (const s of provider.steps) {
    assert.equal(s.action, s.state === 'done' ? null : MEETING_SETUP_ACTIONS[s.code], s.code);
    if (s.state !== 'done') assert.ok(s.action, `${s.code} has a sentence`);
  }
  return Object.fromEntries(provider.steps.map((s: any) => [s.key, `${s.state}:${s.code}`]));
}

test('setup: every Zoom and Meet state reads from stored rows, with no provider call', async (t) => {
  const seen = mockFetch(t, {});

  // Nothing set up on the deployment: both providers are blocked on Axal, not on the member.
  const bare = await setup(world({ ZOOM_CLIENT_ID: undefined, GOOGLE_CLIENT_ID: undefined }));
  assert.equal(bare.status, 200);
  assert.deepEqual(stateOf(bare.body.zoom), { set_up: 'blocked:zoom_not_set_up', app_open: 'blocked:needs_zoom', connected: 'blocked:needs_zoom' });
  assert.deepEqual(stateOf(bare.body.google_meet),
    { set_up: 'blocked:google_not_set_up', connected: 'blocked:google_not_set_up', transcripts: 'blocked:google_not_set_up' });
  assert.equal(bare.body.zoom.ready, false);
  assert.equal(bare.body.zoom.next, 'set_up');
  assert.equal(bare.body.zoom.steps[0].action, MEETING_SETUP_ACTIONS.zoom_not_set_up);

  // Set up, nobody connected, Zoom still own_account: the app is closed to this member.
  const f = world();
  const closed = await setup(f);
  assert.deepEqual(stateOf(closed.body.zoom), { set_up: 'done:zoom_set_up', app_open: 'blocked:zoom_own_account', connected: 'todo:zoom_not_connected' });
  assert.equal(closed.body.zoom.audience, 'own_account');
  assert.equal(closed.body.zoom.steps[0].action, null);
  assert.equal(closed.body.zoom.next, 'app_open');
  assert.deepEqual(stateOf(closed.body.google_meet),
    { set_up: 'done:google_set_up', connected: 'todo:google_not_connected', transcripts: 'blocked:needs_google' });
  assert.deepEqual(closed.body.zoom.prerequisites, [{ ...MEETING_PREREQUISITES.zoom, state: null }]);
  assert.deepEqual(closed.body.google_meet.prerequisites, [{ ...MEETING_PREREQUISITES.google_meet, state: null }]);
  assert.match(closed.body.zoom.prerequisites[0].line, /Create audio transcript/);
  assert.match(closed.body.google_meet.prerequisites[0].line, /Workspace/);

  // The audience var: beta is the member's move, public is open.
  assert.equal(stateOf((await setup(world({ ZOOM_APP_AUDIENCE: 'beta' }))).body.zoom).app_open, 'todo:zoom_beta');
  assert.equal(stateOf((await setup(world({ ZOOM_APP_AUDIENCE: 'public' }))).body.zoom).app_open, 'done:zoom_open');

  // Connected: a connected member is inside the distribution, whatever the var says.
  await zoomConnected(f);
  await googleConnected(f, CALENDAR_SCOPE);
  const linked = await setup(f);
  assert.deepEqual(stateOf(linked.body.zoom), { set_up: 'done:zoom_set_up', app_open: 'done:zoom_open', connected: 'done:zoom_connected' });
  assert.equal(linked.body.zoom.ready, true);
  assert.equal(linked.body.zoom.next, null);
  // MEET_TRANSCRIPTS_ENABLED is off: the transcript scope is Axal's step, not the member's.
  assert.equal(stateOf(linked.body.google_meet).transcripts, 'blocked:meet_transcripts_not_set_up');
  assert.equal(linked.body.google_meet.meet_transcripts, 'not_set_up');

  // Switched on: missing scope is the member's move; no recorded scope reads as unknown.
  f.env.MEET_TRANSCRIPTS_ENABLED = 'on';
  const missing = await setup(f);
  assert.equal(stateOf(missing.body.google_meet).transcripts, 'todo:meet_scope_missing');
  assert.equal(missing.body.google_meet.meet_transcripts, 'available');
  assert.equal(missing.body.google_meet.next, 'transcripts');
  f.db.prepare("UPDATE google_oauth_tokens SET scope = '' WHERE user_id = ?").run(ME);
  assert.equal(stateOf((await setup(f)).body.google_meet).transcripts, 'todo:meet_scope_unknown');
  f.db.prepare('UPDATE google_oauth_tokens SET scope = ? WHERE user_id = ?').run(`${CALENDAR_SCOPE} ${GOOGLE_MEET_TRANSCRIPT_SCOPE}`, ME);
  const granted = await setup(f);
  assert.equal(stateOf(granted.body.google_meet).transcripts, 'done:meet_transcripts_granted');
  assert.equal(granted.body.google_meet.ready, true);
  assert.equal(granted.body.google_meet.meet_transcripts, 'granted');

  // Another member's connections never answer for this one.
  const g = world();
  await zoomConnected(g, OTHER);
  await googleConnected(g, `${CALENDAR_SCOPE} ${GOOGLE_MEET_TRANSCRIPT_SCOPE}`, OTHER);
  const mine = await setup(g);
  assert.equal(stateOf(mine.body.zoom).connected, 'todo:zoom_not_connected');
  assert.equal(stateOf(mine.body.google_meet).connected, 'todo:google_not_connected');

  assert.deepEqual(seen, [], 'the setup read makes no provider call');
});

function calendarEvents(start: string) {
  const at = (h: number) => new Date(Date.parse(start) + h * 3600_000).toISOString();
  return { items: [
    { id: 'e1', status: 'confirmed', summary: '  Call   with  a customer ', start: { dateTime: at(1) }, end: { dateTime: at(2) },
      hangoutLink: `https://meet.google.com/${MEET_CODE}`, organizer: { self: true },
      attendees: [{ email: 'customer@example.test' }], description: 'Private agenda line', location: 'Room 4' },
    { id: 'e2', status: 'confirmed', summary: 'Their Meet', start: { dateTime: at(3) }, end: { dateTime: at(4) },
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${THEIR_MEET}` }] },
      organizer: { self: false, email: 'organizer@example.test' } },
    { id: 'e3', status: 'confirmed', summary: 'Zoom interview', start: { dateTime: at(5) }, end: { dateTime: at(6) },
      location: `https://acme.zoom.us/j/${ZOOM_ID}?pwd=fixturePasscode1`, organizer: { self: true } },
    { id: 'e4', status: 'confirmed', summary: 'Zoom in the notes', start: { dateTime: at(7) },
      description: `Join: https://zoom.us/j/${OTHER_ZOOM_ID} — dial-in details`, organizer: { self: false } },
    { id: 'e5', status: 'cancelled', summary: 'Cancelled', start: { dateTime: at(8) }, hangoutLink: 'https://meet.google.com/can-cell-edd' },
    { id: 'e6', status: 'confirmed', summary: 'All day', start: { date: start.slice(0, 10) }, hangoutLink: 'https://meet.google.com/all-dayy-eve' },
    { id: 'e7', status: 'confirmed', summary: 'No link', start: { dateTime: at(9) }, location: 'Office' },
    { id: 'e8', status: 'confirmed', summary: 'Held already', start: { dateTime: at(10) },
      hangoutLink: `https://meet.google.com/${HELD_MEET}`, organizer: { self: true } },
  ] };
}

test('upcoming: the member’s own calendar calls, unattached, with no attendee, description or passcode', async (t) => {
  const f = world();
  await googleConnected(f, CALENDAR_SCOPE);
  await googleConnected(f, CALENDAR_SCOPE, OTHER);
  await zoomConnected(f);
  // A call already held for an interview (here another member's) is not offered again.
  f.db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, status)
    VALUES ('held-ref', 'google_meet', ?, ?, ${INTERVIEW}, ${OTHER}, 'scheduled')`).run(HELD_MEET, recording(f));
  const start = new Date(Date.now() + 60_000).toISOString();
  const seen = mockFetch(t, {
    [TOKEN]: (_u, init) => json({ access_token: String(init.body).includes(`google-refresh-${ME}`) ? 'access-me' : 'access-other' }),
    [CALENDAR]: (_u, init) => {
      const auth = new Headers(init.headers).get('authorization');
      return auth === 'Bearer access-me' ? json(calendarEvents(start)) : json({ error: 'wrong member' }, 403);
    },
  });
  const before = Date.now();
  const res = await upcoming(f);
  assert.equal(res.status, 200);
  assert.equal(res.body.connected, true);

  // The request: the member's primary calendar, the next 14 days, and only the fields this read needs.
  const query = seen.find((s) => s.key === CALENDAR)!.url.searchParams;
  const fields = query.get('fields')!;
  assert.doesNotMatch(fields, /attendees|email|creator/);
  assert.match(fields, /organizer\(self\)/);
  assert.equal(query.get('singleEvents'), 'true');
  const span = Date.parse(query.get('timeMax')!) - Date.parse(query.get('timeMin')!);
  assert.equal(span, UPCOMING_DAYS * 86_400_000);
  assert.equal(UPCOMING_DAYS, 14);
  assert.ok(Date.parse(query.get('timeMin')!) >= before - 1000);

  const calls = res.body.calls;
  assert.deepEqual(calls.map((c: any) => [c.provider, c.title]), [
    ['google_meet', 'Call with a customer'],
    ['google_meet', 'Their Meet'],
    ['zoom', 'Zoom interview'],
    ['zoom', 'Zoom in the notes'],
  ]);
  for (const c of calls) {
    assert.deepEqual(Object.keys(c).sort(), ['attach', 'attach_blocked', 'ends_at', 'join_url', 'provider', 'starts_at', 'title']);
  }
  const body = JSON.stringify(res.body);
  assert.doesNotMatch(body, /@example\.test/, 'no attendee or organizer address');
  assert.doesNotMatch(body, /Private agenda|Room 4|dial-in/, 'no description or location');
  assert.doesNotMatch(body, /pwd|fixturePasscode1/, 'no Zoom passcode');
  assert.equal(calls[0].starts_at, new Date(Date.parse(start) + 3600_000).toISOString());
  assert.equal(calls[0].ends_at, new Date(Date.parse(start) + 7200_000).toISOString());
  assert.equal(calls[3].ends_at, null);
  assert.equal(calls[0].join_url, `https://meet.google.com/${MEET_CODE}`);
  assert.equal(calls[1].join_url, `https://meet.google.com/${THEIR_MEET}`);
  assert.equal(calls[2].join_url, `https://acme.zoom.us/j/${ZOOM_ID}`);
  assert.equal(calls[3].join_url, `https://zoom.us/j/${OTHER_ZOOM_ID}`);

  // A Meet call is attachable only when the member organizes it; a Zoom call when Zoom is connected.
  assert.deepEqual(calls[0].attach, {
    method: 'POST', path: '/api/founder/validate/interviews/:interview_id/meetings',
    body: { attach: { join_url: `https://meet.google.com/${MEET_CODE}` }, session_id: null }, needs: ['interview_id', 'session_id'],
  });
  assert.equal(calls[0].attach_blocked, null);
  assert.equal(calls[1].attach, null);
  assert.equal(calls[1].attach_blocked, ATTACH_BLOCKED.meet_not_organizer);
  assert.ok(calls[2].attach && calls[3].attach);

  f.db.prepare("DELETE FROM integrations WHERE provider_key = 'zoom'").run();
  const noZoom = (await upcoming(f)).body.calls.filter((c: any) => c.provider === 'zoom');
  assert.deepEqual(noZoom.map((c: any) => c.attach_blocked), [ATTACH_BLOCKED.zoom_not_connected, ATTACH_BLOCKED.zoom_not_connected]);
  assert.ok(noZoom.every((c: any) => c.attach === null));
});

test('upcoming: no Google connection lists nothing and calls nobody; a refused grant asks to reconnect', async (t) => {
  const f = world();
  const seen = mockFetch(t, {
    [TOKEN]: () => json({ access_token: 'access-me' }),
    [CALENDAR]: () => json({ error: 'revoked' }, 401),
  });
  const none = await upcoming(f);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { connected: false, calls: [] });
  assert.deepEqual(seen, []);
  await googleConnected(f, CALENDAR_SCOPE);
  const refused = await upcoming(f);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.detail, 'meet_reconnect');
  assert.equal(typeof refused.body.message, 'string');
  assert.ok(refused.body.message.length > 0);
});

test('attach from the list works for a Meet call the member organizes and a Zoom meeting they host', async (t) => {
  const f = world();
  await googleConnected(f, CALENDAR_SCOPE);
  await zoomConnected(f);
  const start = new Date(Date.now() + 60_000).toISOString();
  mockFetch(t, {
    [TOKEN]: () => json({ access_token: 'access-me' }),
    [CALENDAR]: () => json(calendarEvents(start)),
    'GET https://api.zoom.us/v2/users/me': () => json({ id: `host-${ME}`, account_id: 'account-1' }),
    [`GET https://api.zoom.us/v2/meetings/${ZOOM_ID}`]: () => json({ id: Number(ZOOM_ID), host_id: `host-${ME}` }),
  });
  const listed = (await upcoming(f)).body.calls;
  const wanted = [`https://meet.google.com/${MEET_CODE}`, `https://acme.zoom.us/j/${ZOOM_ID}`];
  const attachable = listed.filter((c: any) => c.attach && wanted.includes(c.join_url));
  assert.deepEqual(attachable.map((c: any) => c.provider), ['google_meet', 'zoom']);
  for (const call of attachable) {
    const sessionId = recording(f);
    const path = call.attach.path.replace(':interview_id', String(INTERVIEW));
    const made = await request(f, call.attach.method, path, { ...call.attach.body, session_id: sessionId });
    assert.equal(made.status, 201, `${call.provider}: ${JSON.stringify(made.body)}`);
    assert.equal(made.body.meeting.provider, call.provider);
  }
  const refs = f.db.prepare('SELECT provider, external_ref, user_id FROM interview_channel_refs ORDER BY id').all();
  assert.deepEqual(refs.map((r: any) => [r.provider, r.external_ref, r.user_id]), [['google_meet', MEET_CODE, ME], ['zoom', ZOOM_ID, ME]]);
  // Once attached, neither is offered again.
  const after = (await upcoming(f)).body.calls.map((c: any) => c.join_url);
  assert.ok(!after.includes(`https://meet.google.com/${MEET_CODE}`));
  assert.ok(!after.includes(`https://acme.zoom.us/j/${ZOOM_ID}`));
  assert.equal(after.length, listed.length - 2);
});

test('zoomLinkOf: the conference first, then the location, then the description; never a look-alike host', () => {
  assert.deepEqual(zoomLinkOf({ conferenceData: { entryPoints: [{ uri: `https://us02web.zoom.us/j/${ZOOM_ID}?pwd=x` }] }, location: `https://zoom.us/j/${OTHER_ZOOM_ID}` }),
    { joinUrl: `https://us02web.zoom.us/j/${ZOOM_ID}`, externalRef: ZOOM_ID });
  assert.deepEqual(zoomLinkOf({ location: `https://zoom.us/j/${OTHER_ZOOM_ID}`, description: `https://zoom.us/j/${ZOOM_ID}` }),
    { joinUrl: `https://zoom.us/j/${OTHER_ZOOM_ID}`, externalRef: OTHER_ZOOM_ID });
  assert.equal(zoomLinkOf({ description: `https://zoom.us.evil.test/j/${ZOOM_ID}` })?.externalRef ?? null, null);
  assert.equal(zoomLinkOf({ description: `http://zoom.us/j/${ZOOM_ID}` }), null);
  assert.equal(zoomLinkOf({}), null);
});
