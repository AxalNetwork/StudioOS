/**
 * D4616 (#4616) — session and identity consistency.
 *
 * Real SQLite over every migration and the real settings router, signed in
 * with real tokens bound to `user_sessions` rows. Pinned, from the issue's
 * acceptance criteria:
 *   · the member's session list and the /security count use the shared rule
 *     (services/sessionStatus.ts): individually revoked, expired and
 *     signed-out-everywhere rows are kept as labelled history and never
 *     counted; only the caller's own rows are read;
 *   · "This device" is found through authentication's own token choice, for a
 *     cookie sign-in as well as a Bearer one;
 *   · a member cannot revoke another member's session;
 *   · the field labelled Display name round-trips through the identity
 *     contract, and Settings, the identity read and the public profile agree
 *     on the name shown, while the account name stays its own field.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/settings_sessions_identity_4616.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import settings from '../src/routes/settings.ts';
import { publicPersonCard } from '../src/routes/public.ts';
import { effectiveDisplayName } from '../src/services/profileExpansion.ts';
import { userSessionStatus } from '../src/services/sessionStatus.ts';

const SECRET = ['d4616', 'settings', 'fixture', 'secret'].join('-');
const ME = 51, OTHER = 52;

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(ME, 'u-me', 'founder', 'Mel Member', 'mel@example.test');
  u.run(OTHER, 'u-other', 'founder', 'Otto Other', 'otto@example.test');
  const s = db.prepare(`INSERT INTO user_sessions (user_id, jti, user_agent, created_at, last_seen_at, revoked_at)
                        VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?), ?)`);
  // Mine: the device in use, one revoked by hand, one past its 24-hour token,
  // and one minted before "Sign out everywhere" (the floor, 28 hours ago, set
  // below; the expired one was minted after it, so it is expired, not signed out).
  s.run(ME, 'jti-current', 'This browser', '-1 minutes', '-1 minutes', null);
  s.run(ME, 'jti-revoked', 'Old phone', '-2 hours', '-2 hours', '2026-11-09 00:00:00');
  s.run(ME, 'jti-expired', 'Laptop', '-26 hours', '-26 hours', null);
  s.run(ME, 'jti-floor', 'Tablet', '-30 hours', '-30 hours', null);
  // Someone else's live session, which must never show up or be revocable.
  s.run(OTHER, 'jti-other', 'Their browser', '-1 minutes', '-1 minutes', null);
  db.prepare('UPDATE users SET jwt_min_iat = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 28 * 3600, ME);

  const env = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/settings', settings);
  app.onError((err: any, c) => {
    const st = ({ Unauthorized: 401 } as Record<string, 401>)[String(err?.message || '')];
    if (st) return c.json({ detail: err.message }, st);
    throw err;
  });
  const tokenFor = (as: number, jti: string) => new SignJWT({ user_id: as, jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  async function call(o: { as: number; jti: string; via?: 'bearer' | 'cookie' }, method: string, path: string, body?: unknown) {
    const token = await tokenFor(o.as, o.jti);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if ((o.via ?? 'bearer') === 'bearer') headers.Authorization = `Bearer ${token}`;
    else headers.Cookie = `other=1; studioos_auth=${token}`;
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error] = saved; }
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, env, call, one };
}

const me = (via: 'bearer' | 'cookie' = 'bearer') => ({ as: ME, jti: 'jti-current', via });

test('the list keeps history, labelled by the shared rule; the count and /security count only active sessions', async () => {
  // Mutations checked: the list read without the owner filter; the count back to `revoked_at IS NULL` alone.
  const { call } = fixture();
  const list = await call(me(), 'GET', '/api/settings/sessions');
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const byAgent = Object.fromEntries(list.body.sessions.map((s: any) => [s.user_agent, s]));
  assert.deepEqual(Object.keys(byAgent).sort(), ['Laptop', 'Old phone', 'Tablet', 'This browser'], 'only my rows, never another member\'s');
  assert.equal(byAgent['This browser'].status, 'active');
  assert.equal(byAgent['Old phone'].status, 'revoked');
  assert.equal(byAgent['Laptop'].status, 'expired');
  assert.equal(byAgent['Tablet'].status, 'signed_out');
  assert.equal(list.body.active_count, 1);
  assert.ok(list.body.sessions.every((s: any) => !('jti' in s)), 'a session key is never returned');
  const security = await call(me(), 'GET', '/api/settings/security');
  assert.equal(security.status, 200);
  assert.equal(security.body.active_sessions, 1, 'the security summary counts what the list calls active');
});

test('"This device" is found through authentication\'s own token choice: Bearer and cookie alike', async () => {
  // Mutation checked: the current jti read from the Bearer header only (the cookie case loses its marker).
  const { call } = fixture();
  for (const via of ['bearer', 'cookie'] as const) {
    const list = await call(me(via), 'GET', '/api/settings/sessions');
    assert.equal(list.status, 200, `${via}: ${JSON.stringify(list.body)}`);
    const current = list.body.sessions.filter((s: any) => s.is_current).map((s: any) => s.user_agent);
    assert.deepEqual(current, ['This browser'], `${via}: exactly one row is this device`);
    const root = await call(me(via), 'GET', '/api/settings');
    assert.equal(root.status, 200);
    assert.equal(root.body.current_jti, 'jti-current', `${via}: the root payload names the same session`);
  }
});

test('a member cannot revoke another member\'s session; revoking the current one ends it', async () => {
  const { call, one } = fixture();
  const otherId = one('SELECT id FROM user_sessions WHERE jti = ?', 'jti-other').id;
  const denied = await call(me(), 'POST', `/api/settings/sessions/${otherId}/revoke`, {});
  assert.equal(denied.status, 404, 'another member\'s row is not found, not revoked');
  assert.equal(one('SELECT revoked_at FROM user_sessions WHERE jti = ?', 'jti-other').revoked_at, null);
  const mineId = one('SELECT id FROM user_sessions WHERE jti = ?', 'jti-current').id;
  assert.equal((await call(me('cookie'), 'POST', `/api/settings/sessions/${mineId}/revoke`, {})).status, 200);
  assert.equal((await call(me('cookie'), 'GET', '/api/settings/sessions')).status, 401, 'the revoked session no longer signs in');
});

test('the shared rule and the owner-scoped SQL agree row by row', async () => {
  const { db } = fixture();
  const rows = db.prepare(`SELECT s.*, u.jwt_min_iat FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?`).all(ME) as any[];
  const now = Date.now();
  // SQLite's datetime('now') is UTC; parseStoredTs reads it as such.
  assert.deepEqual(rows.map((r) => [r.jti, userSessionStatus(r, now)]).sort(), [
    ['jti-current', 'active'], ['jti-expired', 'expired'], ['jti-floor', 'signed_out'], ['jti-revoked', 'revoked'],
  ]);
});

test('Display name round-trips through the identity contract, and every reader shows the same name', async () => {
  // Mutations checked: the editor writing the account name; the public profile ignoring display_name.
  const { call, env, one } = fixture();
  const before = await call(me(), 'GET', '/api/settings');
  assert.equal(before.body.name, 'Mel Member');
  assert.equal(before.body.display_name, null);
  assert.equal(before.body.public_name, 'Mel Member', 'unset, other members see the account name');

  const saved = await call(me(), 'PUT', '/api/settings/profile/identity', { display_name: '  Mel M.  ' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.display_name, 'Mel M.');

  const reopened = await call(me(), 'GET', '/api/settings');
  assert.equal(reopened.body.display_name, 'Mel M.', 'the reopened editor shows what was saved');
  assert.equal(reopened.body.name, 'Mel Member', 'the account name is a different field and is unchanged');
  assert.equal(reopened.body.public_name, 'Mel M.');
  assert.equal((await call(me(), 'GET', '/api/settings/profile/identity')).body.display_name, 'Mel M.');
  const card = await publicPersonCard(env, 'u-me', null);
  assert.equal(card.status, 200);
  assert.equal((card.body as any).name, 'Mel M.', 'the public profile shows the preview\'s name');
  assert.equal((card.body as any).display_name, 'Mel M.');
  // Article bylines read COALESCE(u.display_name, u.name): the same name.
  assert.equal(one('SELECT COALESCE(display_name, name) AS n FROM users WHERE id = ?', ME).n, 'Mel M.');

  // Cleared, every reader falls back to the account name together.
  await call(me(), 'PUT', '/api/settings/profile/identity', { display_name: '' });
  const cleared = await call(me(), 'GET', '/api/settings');
  assert.equal(cleared.body.display_name, null);
  assert.equal(cleared.body.public_name, 'Mel Member');
  assert.equal(((await publicPersonCard(env, 'u-me', null)).body as any).name, 'Mel Member');
  assert.equal(one('SELECT COALESCE(display_name, name) AS n FROM users WHERE id = ?', ME).n, 'Mel Member');
  assert.equal(effectiveDisplayName({ display_name: '   ', name: 'A' }), 'A');
});
