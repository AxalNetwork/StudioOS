/**
 * D757 (#1926) — Google Meet transcripts are offered only once the owner has
 * switched them on (MEET_TRANSCRIPTS_ENABLED): the Calendar status read says
 * `meet_transcripts`, the consent route refuses honestly while it is off, and
 * a grant without the scope is still `meet_scope_missing`. Google is mocked.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/meet_transcripts_d757.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { memKV } from './_mem_kv.mjs';
import calendarRouter, { meetTranscriptsEnabled, meetTranscriptsState } from '../src/routes/calendar.ts';
import { GOOGLE_MEET_TRANSCRIPT_SCOPE } from '../src/services/calendar.ts';
import { encryptString } from '../src/services/cryptoBox.ts';

const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const SIGNING_KEY = 'test-only-session-signing-material-0123456789';
const ME = 2;
const EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

function world(flag?: string) {
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER;
    CREATE TABLE oauth_state_tokens (state TEXT PRIMARY KEY, user_id INTEGER NOT NULL, provider TEXT NOT NULL,
      pkce_verifier TEXT, extra_json TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, consumed_at TIMESTAMP);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    CREATE TABLE user_recovery_state (user_id INTEGER PRIMARY KEY, cooling_off_until TEXT, step_up_due_at TEXT);
  `);
  db.exec(tableFromBaseline(BASELINE, 'google_oauth_tokens'));
  const env: any = { DB, ENVIRONMENT: 'development', JWT_SECRET: SIGNING_KEY, KEK_PII: 'k'.repeat(48),
    GOOGLE_CLIENT_ID: 'google-fixture-client', GOOGLE_CLIENT_SECRET: 'google-fixture-secret',
    APP_URL: 'https://axal.test', PUBLIC_BASE_URL: 'https://axal.test', RATE_LIMITS: memKV(),
    ...(flag === undefined ? {} : { MEET_TRANSCRIPTS_ENABLED: flag }),
  };
  return { env, db };
}
type World = ReturnType<typeof world>;

const app = (() => {
  const a = new Hono();
  a.route('/api/calendar', calendarRouter as any);
  a.onError((err: any, c) => c.json({ detail: err?.message }, 500));
  return a;
})();

async function auth(user = ME) {
  const token = await new SignJWT({ user_id: user, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SIGNING_KEY));
  return { Authorization: `Bearer ${token}` };
}
async function granted(f: World, scope: string) {
  f.db.prepare('INSERT INTO google_oauth_tokens (user_id, refresh_token, scope) VALUES (?, ?, ?)')
    .run(ME, await encryptString(f.env, 'fixture-refresh'), scope);
}
async function status(f: World) {
  const res = await app.fetch(new Request('http://x/api/calendar/google/status', { headers: await auth() }), f.env);
  assert.equal(res.status, 200);
  return (await res.json() as any).meet_transcripts;
}
async function connect(f: World, returnTo = 'record') {
  return app.fetch(new Request(`http://x/api/calendar/google/meet-transcripts/connect?return_to=${returnTo}`, {
    method: 'POST', headers: await auth(),
  }), f.env);
}
const stateRows = (f: World) => {
  try { return Number(f.db.prepare('SELECT COUNT(*) n FROM oauth_state_tokens').get().n); } catch { return 0; }
};
function mockFetch(t: any, routes: Record<string, () => Response>) {
  const old = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const handler = routes[`${(init.method || 'GET').toUpperCase()} ${url.origin}${url.pathname}`];
    if (!handler) throw new Error(`unmocked provider request: ${url}`);
    return handler();
  }) as any;
  t.after(() => { globalThis.fetch = old; });
}

test('the flag is "on" trimmed and in any case; anything else, or nothing, is off', () => {
  for (const v of ['on', ' ON ', 'On']) assert.equal(meetTranscriptsEnabled({ MEET_TRANSCRIPTS_ENABLED: v } as any), true, v);
  for (const v of [undefined, '', 'off', '1', 'true', 'yes', 'onn']) assert.equal(meetTranscriptsEnabled({ MEET_TRANSCRIPTS_ENABLED: v } as any), false, String(v));
});

test('the Calendar status read says granted, available or not_set_up', async () => {
  // No grant: the flag decides.
  assert.equal(await status(world()), 'not_set_up');
  assert.equal(await status(world('off')), 'not_set_up');
  assert.equal(await status(world('on')), 'available');
  // A grant without the scope: still the flag.
  const off = world('off'); await granted(off, EVENTS);
  assert.equal(await status(off), 'not_set_up');
  const on = world('on'); await granted(on, EVENTS);
  assert.equal(await status(on), 'available');
  // A grant holding the scope is granted, whatever the flag says now.
  const kept = world('off'); await granted(kept, `${EVENTS} ${GOOGLE_MEET_TRANSCRIPT_SCOPE}`);
  assert.equal(await status(kept), 'granted');
  const comma = world('on'); await granted(comma, `${EVENTS},${GOOGLE_MEET_TRANSCRIPT_SCOPE}`);
  assert.equal(await status(comma), 'granted');
  // A scope that only contains the name is not the scope.
  assert.equal(meetTranscriptsState({} as any, `${GOOGLE_MEET_TRANSCRIPT_SCOPE}.extra`), 'not_set_up');
});

test('with the flag off, connect answers 503 meet_transcripts_not_set_up and writes no state', async () => {
  for (const flag of [undefined, 'off']) {
    const f = world(flag);
    const res = await connect(f);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'meet_transcripts_not_set_up', message: "Importing Meet transcripts isn't set up on Axal yet." });
    assert.equal(stateRows(f), 0, 'no oauth state is written');
    assert.equal(res.headers.get('set-cookie'), null, 'no return cookie either');
  }
});

test('with the flag on, connect answers with Google’s URL carrying the transcript scope', async () => {
  const f = world('on');
  const res = await connect(f);
  assert.equal(res.status, 200);
  const url = new URL((await res.json() as any).redirect_url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.ok(url.searchParams.get('scope')?.split(' ').includes(GOOGLE_MEET_TRANSCRIPT_SCOPE));
  assert.equal(stateRows(f), 1);
});

test('the callback without the scope still answers meet_scope_missing; with it, the return says meet=granted', async (t) => {
  const missing = world('on');
  const start = await connect(missing);
  const state = new URL((await start.json() as any).redirect_url).searchParams.get('state');
  mockFetch(t, { 'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access', refresh_token: 'r', scope: EVENTS }) });
  const back = await app.fetch(new Request(`http://x/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state!)}`,
    { headers: { Cookie: 'studioos_cal_return=record' } }), missing.env);
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), 'https://axal.test/validate/record?google=error&reason=meet_scope_missing');
  assert.equal(Number(missing.db.prepare('SELECT COUNT(*) n FROM google_oauth_tokens').get().n), 0, 'nothing is stored');

  const ok = world('on');
  const start2 = await connect(ok);
  const state2 = new URL((await start2.json() as any).redirect_url).searchParams.get('state');
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access', refresh_token: 'r', scope: `${EVENTS} ${GOOGLE_MEET_TRANSCRIPT_SCOPE}` }),
    'GET https://www.googleapis.com/oauth2/v2/userinfo': () => json({}),
  });
  const back2 = await app.fetch(new Request(`http://x/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state2!)}`,
    { headers: { Cookie: 'studioos_cal_return=record' } }), ok.env);
  assert.equal(back2.status, 302);
  const loc = new URL(back2.headers.get('location')!);
  assert.equal(loc.pathname, '/validate/record');
  assert.equal(loc.searchParams.get('google'), 'connected');
  assert.equal(loc.searchParams.get('meet'), 'granted');
  assert.equal(await status(ok), 'granted');
});

test('an ordinary Google connect never says meet=granted', async (t) => {
  const f = world('on');
  const res = await app.fetch(new Request('http://x/api/calendar/google/connect?return_to=record', { method: 'POST', headers: await auth() }), f.env);
  const state = new URL((await res.json() as any).redirect_url).searchParams.get('state');
  mockFetch(t, {
    'POST https://oauth2.googleapis.com/token': () => json({ access_token: 'fixture-access', refresh_token: 'r', scope: EVENTS }),
    'GET https://www.googleapis.com/oauth2/v2/userinfo': () => json({}),
  });
  const back = await app.fetch(new Request(`http://x/api/calendar/google/callback?code=fixture-code&state=${encodeURIComponent(state!)}`,
    { headers: { Cookie: 'studioos_cal_return=record' } }), f.env);
  assert.equal(back.status, 302);
  const loc = new URL(back.headers.get('location')!);
  assert.equal(loc.searchParams.get('google'), 'connected');
  assert.equal(loc.searchParams.get('meet'), null);
});
