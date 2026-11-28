/**
 * #9028 (D9028) — a member's Microsoft calendar connection survives Microsoft
 * rotating its refresh token, and a grant without Calendars.ReadWrite is not a
 * connection. Findings 2 and 3 of `documentation/operations/TEAMS_ENTRA_5809.md`.
 *
 * Real SQLite (`microsoft_oauth_tokens` from the production baseline, or the
 * whole baseline for the callback) and the token endpoint faked the way
 * `teams_entra_inventory_5809.test.ts` fakes it: `fetch` answers Microsoft's
 * hosts from the test and fails on any other. Every token is made at run time
 * from a random id, and every address is `example.test`.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/microsoft_token_rotation_9028.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { encryptString, decryptString } from '../src/services/cryptoBox.ts';
import { microsoftGrantHasCalendarScope, refreshMicrosoftAccessTokenFor } from '../src/services/calendar.ts';
import { createTeamsMeeting } from '../src/services/channels/teamsMeet.ts';
import calendar from '../src/routes/calendar.ts';

const BASELINE = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const SECRET = ['fixture', 'jwt', randomUUID(), randomUUID()].join('-');
/** A synthetic token, made here so no token-shaped literal sits in the file. */
const fixtureToken = (label: string) => ['fixture', label, randomUUID()].join('-');
const OLD_STAMP = '2026-01-01T00:00:00.000Z';

type TokenAnswer = { status?: number; refresh_token?: string; scope?: string };

/** The token endpoint, and Graph for the meeting call; every other host fails the test. */
function fakeMicrosoft(t: any, token: () => TokenAnswer) {
  const posted: URLSearchParams[] = [];
  t.mock.method(globalThis, 'fetch', async (input: any, init: any = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.host === 'login.microsoftonline.com') {
      posted.push(new URLSearchParams(String(init.body ?? '')));
      const a = token();
      if (a.status && a.status >= 400) return Response.json({ error: 'invalid_grant' }, { status: a.status });
      const body: Record<string, unknown> = { access_token: fixtureToken('ms-access'), expires_in: 3600 };
      if (a.refresh_token !== undefined) body.refresh_token = a.refresh_token;
      if (a.scope !== undefined) body.scope = a.scope;
      return Response.json(body);
    }
    if (url.host === 'graph.microsoft.com' && url.pathname === '/v1.0/me') return Response.json({ id: 'fixture-ms-sub-3', mail: 'member-3@example.test' });
    if (url.host === 'graph.microsoft.com' && init.method === 'POST') return Response.json({ id: 'fixture-event-1', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fixture' } });
    throw new Error(`unexpected host ${url.host}`);
  });
  return posted;
}

/** One member's Microsoft row on a real SQLite table; `plaintext` stores a legacy unencrypted token. */
async function tokenWorld(opts: { plaintext?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(tableFromBaseline(BASELINE, 'microsoft_oauth_tokens'));
  const env: any = {
    DB: d1Over(db), ENVIRONMENT: 'development', JWT_SECRET: SECRET, APP_URL: 'https://app.example.test',
    MICROSOFT_CAL_CLIENT_ID: 'fixture-ms-client', MICROSOFT_CAL_CLIENT_SECRET: fixtureToken('ms-secret'),
  };
  const original = fixtureToken('ms-refresh-original');
  db.prepare('INSERT INTO microsoft_oauth_tokens (user_id, refresh_token, scope, updated_at) VALUES (?, ?, ?, ?)')
    .run(3, opts.plaintext ? original : await encryptString(env, original), 'openid offline_access Calendars.ReadWrite User.Read', OLD_STAMP);
  // A second member's row, which no refresh of member 3's may touch.
  const other = fixtureToken('ms-refresh-other');
  db.prepare('INSERT INTO microsoft_oauth_tokens (user_id, refresh_token, scope, updated_at) VALUES (?, ?, ?, ?)')
    .run(4, await encryptString(env, other), 'Calendars.ReadWrite', OLD_STAMP);
  const row = (userId = 3) => db.prepare('SELECT refresh_token, updated_at FROM microsoft_oauth_tokens WHERE user_id = ?').get(userId) as { refresh_token: string; updated_at: string };
  const stored = async (userId = 3) => {
    const raw = row(userId).refresh_token;
    return { raw, plain: await decryptString(env, raw) };
  };
  return { db, env, original, other, row, stored };
}

test('1. a refresh that rotates the token leaves the new one stored, encrypted, with updated_at moved', async (t) => {
  const w = await tokenWorld();
  const rotated = fixtureToken('ms-refresh-rotated');
  const posted = fakeMicrosoft(t, () => ({ refresh_token: rotated }));
  const access = await refreshMicrosoftAccessTokenFor(w.env, 3, { raw: w.original, wasPlaintext: false });
  assert.match(access, /^fixture-ms-access-/);
  assert.equal(posted[0].get('refresh_token'), w.original, 'the refresh spends the stored token');
  const s = await w.stored();
  assert.equal(s.plain, rotated, 'the stored token is the rotated one');
  assert.notEqual(s.raw, rotated, 'it is stored encrypted, not in the clear');
  assert.notEqual(w.row().updated_at, OLD_STAMP, 'updated_at records the rotation');
  assert.equal((await w.stored(4)).plain, w.other, 'another member\'s row is untouched');
});

test('2. a refresh without a refresh_token, or with the same one, leaves the stored token unchanged', async (t) => {
  for (const answer of [{}, { refresh_token: '' }, 'same'] as const) {
    const w = await tokenWorld();
    const before = w.row();
    fakeMicrosoft(t, () => (answer === 'same' ? { refresh_token: w.original } : answer));
    await refreshMicrosoftAccessTokenFor(w.env, 3, { raw: w.original, wasPlaintext: false });
    assert.deepEqual(w.row(), before, `${JSON.stringify(answer)}: the stored row is byte-for-byte the same`);
    assert.equal((await w.stored()).plain, w.original);
    t.mock.restoreAll();
  }
});

test('3. a refused refresh throws refresh_failed and stores nothing', async (t) => {
  const w = await tokenWorld();
  const before = w.row();
  fakeMicrosoft(t, () => ({ status: 400 }));
  await assert.rejects(refreshMicrosoftAccessTokenFor(w.env, 3, { raw: w.original, wasPlaintext: false }), /^Error: refresh_failed:400$/);
  assert.deepEqual(w.row(), before);
});

test('4. a legacy plaintext row: rotation wins over the roll-forward, and without rotation the row is encrypted in place', async (t) => {
  const rotatedWorld = await tokenWorld({ plaintext: true });
  const rotated = fixtureToken('ms-refresh-rotated');
  fakeMicrosoft(t, () => ({ refresh_token: rotated }));
  await refreshMicrosoftAccessTokenFor(rotatedWorld.env, 3, { raw: rotatedWorld.original, wasPlaintext: true });
  assert.equal((await rotatedWorld.stored()).plain, rotated, 'the old plaintext token is not written back over the rotated one');
  t.mock.restoreAll();

  const plainWorld = await tokenWorld({ plaintext: true });
  fakeMicrosoft(t, () => ({}));
  await refreshMicrosoftAccessTokenFor(plainWorld.env, 3, { raw: plainWorld.original, wasPlaintext: true });
  const s = await plainWorld.stored();
  assert.equal(s.plain, plainWorld.original, 'the same token, now decryptable');
  assert.notEqual(s.raw, plainWorld.original, 'no longer stored in the clear');
});

test('5. the Teams meeting call refreshes through the helper: the next call spends the rotated token', async (t) => {
  const w = await tokenWorld();
  const first = fixtureToken('ms-refresh-first-rotation');
  const second = fixtureToken('ms-refresh-second-rotation');
  const answers = [first, second];
  const posted = fakeMicrosoft(t, () => ({ refresh_token: answers.shift() }));
  await createTeamsMeeting(w.env, 3, { topic: 'Fixture', durationMin: 30 });
  await createTeamsMeeting(w.env, 3, { topic: 'Fixture', durationMin: 30 });
  assert.deepEqual(posted.map((p) => p.get('refresh_token')), [w.original, first], 'the second refresh used the first rotation');
  assert.equal((await w.stored()).plain, second);
});

test('6. every Microsoft refresh goes through the storing helper', () => {
  const callers = [
    'cloudflare-worker/src/services/calendar.ts',
    'cloudflare-worker/src/services/calendar/sync.ts',
    'cloudflare-worker/src/services/calendar/externalReaders.ts',
    'cloudflare-worker/src/services/channels/teamsMeet.ts',
  ];
  const counts = callers.map((f) => (readFileSync(f, 'utf8').match(/refreshMicrosoftAccessTokenFor\(env,/g) || []).length);
  assert.deepEqual(counts, [1, 3, 1, 1], 'syncUserToMicrosoft; sync push, cancel and disconnect; the external reader; the Teams call');
  const service = readFileSync(callers[0], 'utf8');
  assert.equal((service.match(/refreshMicrosoftTokens\(/g) || []).length, 2, 'the raw refresh is declared once and called once, by the helper');
  assert.doesNotMatch(service, /export async function refreshMicrosoftTokens/, 'the raw refresh is not exported');
  assert.doesNotMatch(service, /refreshMicrosoftAccessToken\(/, 'the old non-storing refresh is gone');
});

test('7. the grant check reads Calendars.ReadWrite bare, under the Graph resource, in any case', () => {
  assert.equal(microsoftGrantHasCalendarScope('openid profile email offline_access Calendars.ReadWrite User.Read'), true);
  assert.equal(microsoftGrantHasCalendarScope('https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/User.Read'), true);
  assert.equal(microsoftGrantHasCalendarScope('calendars.readwrite'), true);
  for (const scope of ['openid profile email offline_access Calendars.Read User.Read', 'Calendars.ReadWrite.Shared', '', undefined, null]) {
    assert.equal(microsoftGrantHasCalendarScope(scope), false, String(scope));
  }
});

// ─────────────────────────────────────────── the callback, on the whole baseline
function callbackWorld() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(BASELINE);
  for (const name of ['235_calendar_events_kind.sql', '277_user_recovery_state.sql', '603_calendar_feed_tokens.sql', '708_calendar_source_prefs.sql',
    '610_calendar_feed_scope_sync_errors.sql', '202611101741_5207_calendar_copy_jobs.sql']) {
    db.exec(readFileSync(`cloudflare-worker/sql/migrations/${name}`, 'utf8'));
  }
  db.prepare('INSERT INTO users (id, email, name, role) VALUES (3, ?, ?, ?)').run('member-3@example.test', 'Fixture Member', 'founder');
  const env: any = {
    DB: d1Over(db), ENVIRONMENT: 'production', JWT_SECRET: SECRET, APP_URL: 'https://app.example.test',
    MICROSOFT_CLIENT_ID: 'fixture-ms-client', MICROSOFT_CLIENT_SECRET: fixtureToken('ms-secret'),
    MICROSOFT_CALENDAR_REDIRECT_URI: 'https://app.example.test/api/calendar/microsoft/callback',
  };
  const app = new Hono<any>();
  app.route('/api/calendar', calendar);
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = async (path: string, method = 'GET') => {
    const jwt = await new SignJWT({ user_id: 3 }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    return app.request(`https://app.example.test${path}`, { method, headers: { Cookie: `studioos_auth=${jwt}` } }, env, ctx as any);
  };
  const rows = () => (db.prepare('SELECT COUNT(*) AS n FROM microsoft_oauth_tokens WHERE user_id = 3').get() as { n: number }).n;
  async function roundTrip(t: any, scope: string) {
    const start = await call('/api/calendar/microsoft/connect', 'POST');
    assert.equal(start.status, 200);
    const body: any = await start.json();
    const state = new URL(body.auth_url || body.url).searchParams.get('state')!;
    fakeMicrosoft(t, () => ({ refresh_token: fixtureToken('ms-refresh-connect'), scope }));
    const cb = await call(`/api/calendar/microsoft/callback?code=${fixtureToken('code')}&state=${encodeURIComponent(state)}`);
    t.mock.restoreAll();
    return cb;
  }
  return { rows, roundTrip };
}

test('8. a callback whose scope lacks Calendars.ReadWrite writes no row and redirects with calendar_scope_missing', async (t) => {
  const w = callbackWorld();
  const cb = await w.roundTrip(t, 'openid profile email offline_access Calendars.Read User.Read');
  assert.equal(cb.status, 302);
  const location = new URL(cb.headers.get('location')!);
  assert.equal(location.searchParams.get('microsoft'), 'error');
  assert.equal(location.searchParams.get('reason'), 'calendar_scope_missing');
  assert.equal(w.rows(), 0, 'nothing is stored');

  // The same round trip with the permission granted connects, so the refusal above is the scope's alone.
  const ok = await w.roundTrip(t, 'openid profile email offline_access Calendars.ReadWrite User.Read');
  assert.equal(new URL(ok.headers.get('location')!).searchParams.get('microsoft'), 'connected');
  assert.equal(w.rows(), 1);
});

test('9. the calendar page has a sentence for the new reason', () => {
  const page = readFileSync('frontend/src/pages/CalendarPage.jsx', 'utf8');
  assert.match(page, /if \(reason === 'calendar_scope_missing'\) return '[^']+';/);
});
