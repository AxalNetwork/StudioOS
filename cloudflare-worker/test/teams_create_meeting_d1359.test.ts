/**
 * D1359 — Record a Session › Call: "Create the meeting for me" for Microsoft
 * Teams, on the member's own Microsoft calendar connection.
 *
 * Every Microsoft request is a mocked `globalThis.fetch` that fails on
 * anything it was not told about.
 *
 * What these prove:
 *   · an Outlook event starting now with a Teams meeting (isOnlineMeeting,
 *     teamsForBusiness), for the chosen length; the reply is the join link
 *     only, never a token or the event id;
 *   · a personal account (the event comes back with no Teams link) is told so,
 *     and the event is deleted again;
 *   · not connected 409, a refused refresh 409 reconnect, Microsoft down 503,
 *     not set up here 503, a join link off Teams' hosts refused;
 *   · /meetings/capabilities says Teams can create a meeting only when the
 *     member is connected.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/teams_create_meeting_d1359.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import meetingsRouter from '../src/routes/founder_validate_meetings.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const JWT_SECRET = 'd1359-fixture-only-signing-secret-0123456789abc';
const ME = 2;

function world(over: Record<string, unknown> = {}) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN founder_id INTEGER;
    ALTER TABLE users ADD COLUMN spinout_lab_active INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  for (const t of ['integrations', 'google_oauth_tokens', 'microsoft_oauth_tokens']) db.exec(tableFromBaseline(BASELINE, t));
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-client-id', ZOOM_CLIENT_SECRET: 'zoom-client-secret', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-webhook-secret',
    GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', PUBLIC_BASE_URL: 'https://axal.test',
    MICROSOFT_CLIENT_ID: 'ms-client-id', MICROSOFT_CLIENT_SECRET: 'ms-client-secret',
    APP_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    ...over,
  };
  return { env, db };
}
type World = ReturnType<typeof world>;

type Handler = (url: URL, init: any) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(t: any, routes: Record<string, Handler>) {
  const calls: { key: string; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const key = `${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`;
    calls.push({ key, body: init.body == null ? null : String(init.body) });
    const handler = routes[key];
    if (!handler) throw new Error(`unmocked fetch: ${key}`);
    return handler(url, init);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', meetingsRouter as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function call(env: any, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x/api/founder/validate${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}


const TOKEN_URL = 'POST https://login.microsoftonline.com/common/oauth2/v2.0/token';
const EVENTS = 'POST https://graph.microsoft.com/v1.0/me/events';
const TEAMS_LINK = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_fixture%40thread.v2/0';
const MS_SECRET = 'MS-ACCESS-TOKEN-FIXTURE';

async function connectMicrosoft(f: World) {
  f.db.prepare('INSERT INTO microsoft_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(ME, await encryptString(f.env, 'ms-refresh-token'), 'openid offline_access Calendars.ReadWrite User.Read');
}

test('Teams: an Outlook event starting now with a Teams meeting; the reply is the join link only', async (t) => {
  const f = world();
  await connectMicrosoft(f);
  const calls = mockFetch(t, {
    [TOKEN_URL]: () => json({ access_token: MS_SECRET, expires_in: 3600 }),
    [EVENTS]: () => json({ id: 'EVENT-ID-FIXTURE', onlineMeeting: { joinUrl: TEAMS_LINK } }, 201),
  });
  const before = Date.now();
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams', duration_min: 45 });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body, { provider: 'teams', join_url: TEAMS_LINK });
  assert.ok(!r.text.includes(MS_SECRET) && !r.text.includes('EVENT-ID-FIXTURE') && !r.text.includes('ms-refresh-token'), 'no token or event id');
  const sent = JSON.parse(calls.find((c) => c.key === EVENTS)!.body!);
  assert.equal(sent.isOnlineMeeting, true);
  assert.equal(sent.onlineMeetingProvider, 'teamsForBusiness');
  assert.equal(sent.subject, 'Customer interview', 'a neutral topic by default');
  assert.equal(sent.start.timeZone, 'UTC');
  const start = Date.parse(`${sent.start.dateTime}Z`), end = Date.parse(`${sent.end.dateTime}Z`);
  assert.ok(start >= before - 2000 && start <= Date.now() + 2000, 'starting now');
  assert.equal(end - start, 45 * 60_000);
  assert.deepEqual(calls.map((c) => c.key), [TOKEN_URL, EVENTS]);
});

test('Teams: a personal account gets no Teams link — told so, and the event is deleted again', async (t) => {
  const f = world();
  await connectMicrosoft(f);
  const calls = mockFetch(t, {
    [TOKEN_URL]: () => json({ access_token: MS_SECRET }),
    [EVENTS]: () => json({ id: 'EVENT-ID-FIXTURE', onlineMeeting: null }, 201),
    'DELETE https://graph.microsoft.com/v1.0/me/events/EVENT-ID-FIXTURE': () => new Response(null, { status: 204 }),
  });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'teams_personal_account');
  assert.match(r.body.message ?? r.body.detail ?? r.text, /work or school Microsoft 365 account/);
  assert.ok(calls.some((c) => c.key.startsWith('DELETE ')), 'the event without a Teams meeting is removed');
});

test('Teams: a join link off Teams\' own hosts is never handed back', async (t) => {
  const f = world();
  await connectMicrosoft(f);
  mockFetch(t, {
    [TOKEN_URL]: () => json({ access_token: MS_SECRET }),
    [EVENTS]: () => json({ id: 'EVENT-ID-FIXTURE', onlineMeeting: { joinUrl: 'https://evil.example/l/meetup-join/x' } }, 201),
    'DELETE https://graph.microsoft.com/v1.0/me/events/EVENT-ID-FIXTURE': () => new Response(null, { status: 204 }),
  });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.equal(r.status, 409);
  assert.ok(!r.text.includes('evil.example'));
});

test('Teams refusals: not connected, a refused refresh, Microsoft down, Graph 403, and not set up here', async (t) => {
  const f = world();
  let r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [409, 'teams_not_connected']);
  await connectMicrosoft(f);
  let tokenStatus = 400, eventStatus = 201;
  mockFetch(t, {
    [TOKEN_URL]: () => (tokenStatus === 200 ? json({ access_token: MS_SECRET }) : json({ error: 'invalid_grant' }, tokenStatus)),
    [EVENTS]: () => json({ error: { code: 'x', message: 'PROVIDER-TEXT' } }, eventStatus),
  });
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [409, 'teams_reconnect']);
  tokenStatus = 500;
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [503, 'teams_unreachable']);
  tokenStatus = 200; eventStatus = 403;
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [409, 'teams_reconnect']);
  eventStatus = 400;
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [502, 'teams_create_failed']);
  assert.ok(!r.text.includes('PROVIDER-TEXT'), 'never Microsoft\'s words');
  const bare = world({ MICROSOFT_CLIENT_ID: undefined });
  r = await call(bare.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [503, 'provider_unavailable']);
});

test('capabilities: Teams can create a meeting once Microsoft is connected, and says it needs a work or school account', async (t) => {
  mockFetch(t, {});
  const f = world();
  let teams = (await call(f.env, 'GET', '/meetings/capabilities')).body.providers.teams;
  assert.deepEqual([teams.connected, teams.can_create_meeting], [false, false]);
  await connectMicrosoft(f);
  teams = (await call(f.env, 'GET', '/meetings/capabilities')).body.providers.teams;
  assert.deepEqual([teams.connected, teams.can_create_meeting, teams.can_retrieve_transcript], [true, true, false]);
  assert.ok(teams.notes.some((n: string) => /work or school Microsoft 365/.test(n)));
});
