/**
 * D1346 (#3554) — Record a Session › Call: "Create the meeting for me" on the
 * member's own Zoom or Google account, and whether Eadwyn AI can join, read
 * when the dialog opens.
 *
 * Every provider call goes through a mocked `globalThis.fetch` that fails on
 * anything it was not told about, so no test reaches Zoom or Google.
 *
 * What these prove:
 *   · Zoom: an instant meeting (type 1) with the waiting room on and no join
 *     before the host, on the member's own Zoom user; the reply is the join
 *     link only, never Zoom's start link or a token;
 *   · Google Meet: a Calendar event with a Meet createRequest starting now;
 *     the reply is the Meet link only;
 *   · 409 when the member has not connected, 503 when the provider is not set
 *     up here, 400 for any other provider (Teams: D1359);
 *   · GET /meetings/bot is false on every platform while the bot is not
 *     deployed, with no price; once it is, true with the per-minute prices
 *     and the plan's limit, and still false for a member it is not enabled for.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/record_call_create_meeting_d1346.test.ts
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
import { encryptCredentials } from '../src/integrations/secrets.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const JWT_SECRET = 'd1346-s29-fixture-only-signing-secret-0123456789';
const ME = 2;
const HOUR = 3_600_000;
const MEETING_ID = '85746065432';
const MEET_CODE = 'abc-mnop-xyz';
const HOST_SECRET = 'SECRET-HOST-TOKEN';

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
  for (const t of ['integrations', 'google_oauth_tokens']) db.exec(tableFromBaseline(BASELINE, t));
  db.exec(readFileSync(new URL('../sql/migrations/656_meet_created_spaces.sql', import.meta.url), 'utf8'));
  const env: any = {
    DB, ENVIRONMENT: 'development', JWT_SECRET, KEK_PII: 'k'.repeat(48),
    ZOOM_CLIENT_ID: 'zoom-client-id', ZOOM_CLIENT_SECRET: 'zoom-client-secret', ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom-webhook-secret',
    GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret', PUBLIC_BASE_URL: 'https://axal.test',
    APP_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    ...over,
  };
  return { env, db };
}
type World = ReturnType<typeof world>;

async function connectZoom(f: World) {
  const uid = `zoom-${ME}`;
  const enc = await encryptCredentials(f.env, uid, { access_token: 'zoom-at', refresh_token: 'zoom-rt', token_type: 'bearer', expires_at: Date.now() + HOUR });
  f.db.prepare(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type, credentials_enc)
                VALUES (?, ?, 'zoom', 'active', 'oauth2', ?)`).run(uid, ME, enc);
}
async function connectGoogle(f: World, extraScope = '') {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(ME, await encryptString(f.env, 'google-refresh-token'), `https://www.googleapis.com/auth/calendar.events openid${extraScope}`);
}
const SPACE_SCOPE = ' https://www.googleapis.com/auth/meetings.space.created';

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

test('Zoom: an instant meeting with the waiting room on; the reply is the join link only', async (t) => {
  const f = world();
  await connectZoom(f);
  const calls = mockFetch(t, {
    'POST https://api.zoom.us/v2/users/me/meetings': () => json({
      id: Number(MEETING_ID), join_url: `https://zoom.us/j/${MEETING_ID}?pwd=abc`,
      start_url: `https://zoom.us/s/${MEETING_ID}?zak=${HOST_SECRET}`, password: 'abc',
    }, 201),
  });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'zoom' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { provider: 'zoom', join_url: `https://zoom.us/j/${MEETING_ID}?pwd=abc` });
  assert.ok(!r.text.includes(HOST_SECRET) && !r.text.includes('zoom-at') && !r.text.includes('start_url'), 'no host link and no token in the reply');
  const sent = JSON.parse(calls[0].body!);
  assert.equal(sent.type, 1, 'an instant meeting');
  assert.equal(sent.settings.waiting_room, true);
  assert.equal(sent.settings.join_before_host, false);
  assert.equal(sent.topic, 'Customer interview', 'a neutral topic by default');
  assert.equal(calls.length, 1);
});

test('Google Meet: a Calendar event with a Meet link starting now; the reply is the link only', async (t) => {
  const f = world();
  await connectGoogle(f);
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', expires_in: 3599, token_type: 'Bearer' }),
    'POST https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json({
      id: 'evt0123abc', hangoutLink: `https://meet.google.com/${MEET_CODE}`,
      conferenceData: { conferenceId: MEET_CODE, createRequest: { status: { statusCode: 'success' } },
        entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${MEET_CODE}` }] },
    }),
  });
  const before = Date.now();
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'google_meet', duration_min: 45 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { provider: 'google_meet', join_url: `https://meet.google.com/${MEET_CODE}` });
  assert.ok(!r.text.includes('g-at') && !r.text.includes('google-refresh-token'), 'no token in the reply');
  const event = JSON.parse(calls.find((c) => c.key.endsWith('/calendars/primary/events'))!.body!);
  assert.ok(event.conferenceData?.createRequest, 'a Meet createRequest, as D1211 makes it');
  const start = Date.parse(event.start.dateTime);
  assert.ok(start >= before - 1000 && start <= Date.now() + 1000, 'it starts now');
  assert.equal(Date.parse(event.end.dateTime) - start, 45 * 60_000);
});

test('D1376: with the Meet permission the call is a space Axal creates: Open and transcribing itself, no Calendar event', async (t) => {
  const f = world();
  await connectGoogle(f, SPACE_SCOPE);
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', expires_in: 3599, token_type: 'Bearer' }),
    'POST https://meet.googleapis.com/v2/spaces': () => json({ name: 'spaces/sp1abc', meetingUri: `https://meet.google.com/${MEET_CODE}`, meetingCode: MEET_CODE }),
  });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'google_meet', duration_min: 45 });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body, { provider: 'google_meet', join_url: `https://meet.google.com/${MEET_CODE}`, open: true, auto_transcribe: true });
  const sent = JSON.parse(calls.find((c) => c.key.endsWith('/v2/spaces'))!.body!);
  assert.deepEqual(sent.config, { accessType: 'OPEN', artifactConfig: { transcriptionConfig: { autoGenerationType: 'ON' } } });
  assert.ok(!calls.some((c) => c.key.includes('/calendar/v3/')), 'no Calendar event');
  const [row] = f.db.prepare('SELECT * FROM meet_created_spaces').all() as any[];
  assert.deepEqual([row.user_id, row.meeting_code, row.space_name, row.auto_transcribe], [ME, MEET_CODE, 'spaces/sp1abc', 1]);
  assert.equal(Date.parse(row.ends_at) - Date.parse(row.starts_at), 45 * 60_000, 'the slot an import reads');
  assert.ok(!r.text.includes('g-at'), 'no token in the reply');
});

test('D1376: an account whose plan refuses automatic transcripts still gets an Open space; without the permission, the Calendar event as before', async (t) => {
  const f = world();
  await connectGoogle(f, SPACE_SCOPE);
  const bodies: any[] = [];
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', expires_in: 3599, token_type: 'Bearer' }),
    'POST https://meet.googleapis.com/v2/spaces': (_u, init) => {
      const b = JSON.parse(String(init.body)); bodies.push(b);
      return b.config.artifactConfig ? json({ error: { code: 400, status: 'FAILED_PRECONDITION' } }, 400)
        : json({ name: 'spaces/sp2', meetingUri: `https://meet.google.com/${MEET_CODE}` });
    },
  });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'google_meet' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.auto_transcribe, false);
  assert.deepEqual(bodies.map((b) => b.config), [
    { accessType: 'OPEN', artifactConfig: { transcriptionConfig: { autoGenerationType: 'ON' } } }, { accessType: 'OPEN' }]);

  const g = world();
  await connectGoogle(g);
  const calls = mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', expires_in: 3599, token_type: 'Bearer' }),
    'POST https://www.googleapis.com/calendar/v3/calendars/primary/events': () => json({ id: 'evt0123abc', hangoutLink: `https://meet.google.com/${MEET_CODE}` }),
  });
  const old = await call(g.env, 'POST', '/meetings/instant', { provider: 'google_meet' });
  assert.equal(old.status, 201);
  assert.ok(!calls.some((c) => c.key.includes('meet.googleapis.com')), 'no Meet API without the permission');
});

test('not connected is 409, not set up is 503, and any other provider is 400', async (t) => {
  mockFetch(t, {});
  const f = world();
  let r = await call(f.env, 'POST', '/meetings/instant', { provider: 'zoom' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'connect_first');
  assert.match(r.body.message, /Connect Zoom/);
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'google_meet' });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Connect Google/);
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'webex' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'provider_invalid');
  // D1359: Teams is created on the Microsoft calendar connection; without its client here it is not set up.
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'teams' });
  assert.deepEqual([r.status, r.body.error], [503, 'provider_unavailable']);
  r = await call(f.env, 'POST', '/meetings/instant', { provider: 'zoom', duration_min: 2 });
  assert.equal(r.status, 400);
  const bare = world({ ZOOM_CLIENT_ID: undefined });
  await connectZoom(bare);
  r = await call(bare.env, 'POST', '/meetings/instant', { provider: 'zoom' });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'provider_unavailable');
});

test('a Zoom refusal is the meeting error, not a 500', async (t) => {
  const f = world();
  await connectZoom(f);
  mockFetch(t, { 'POST https://api.zoom.us/v2/users/me/meetings': () => json({ code: 300, message: 'no' }, 400) });
  const r = await call(f.env, 'POST', '/meetings/instant', { provider: 'zoom' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'zoom_create_failed');
});

const BOT_RUN = { idFromName: (s: string) => s, get: () => ({ fetch: async () => json({}) }) };
const DEPLOYED = {
  MEETING_BOT: 'on', MEETING_BOT_SECRET: 'd1346-'.padEnd(40, 'x'), MEETING_BOT_RUN: BOT_RUN, MEETING_BOT_COST_MICROUSD_PER_MINUTE: '2232',
  MEETING_BOT_RUNTIME: { async start() {}, async stop() {} }, AI_BILLING: 'charged',
};

test('GET /meetings/bot: not deployed is false everywhere, with no price', async (t) => {
  mockFetch(t, {});
  const r = await call(world().env, 'GET', '/meetings/bot');
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.deepEqual(r.body.platforms, { zoom: false, google_meet: false, teams: false });
  assert.deepEqual(r.body.price, { bot_microusd_per_minute: null, transcription_microusd_per_minute: null }, 'never a 0 for an unmeasured price');
  assert.equal(r.body.limit_minutes, 30);
});

test('GET /meetings/bot: deployed is true with the per-minute prices; off for this member is false', async (t) => {
  mockFetch(t, {});
  const r = await call(world(DEPLOYED).env, 'GET', '/meetings/bot');
  assert.equal(r.body.available, true);
  assert.deepEqual(r.body.platforms, { zoom: true, google_meet: true, teams: true });
  assert.equal(r.body.price.bot_microusd_per_minute, 2790, 'D886 §5: 2,232 × 1.25, rounded up');
  assert.ok(Number.isSafeInteger(r.body.price.transcription_microusd_per_minute) && r.body.price.transcription_microusd_per_minute > 0);
  const canary = await call(world({ ...DEPLOYED, MEETING_BOT: 'canary' }).env, 'GET', '/meetings/bot');
  assert.equal(canary.body.available, false, 'canary is Super Admins only');
  const noRun = await call(world({ ...DEPLOYED, MEETING_BOT_RUN: undefined }).env, 'GET', '/meetings/bot');
  assert.equal(noRun.body.available, false, 'MEETING_BOT_RUN unbound: the bot is not deployed');
});
