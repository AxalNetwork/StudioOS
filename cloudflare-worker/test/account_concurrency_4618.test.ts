/**
 * D4618 (#4618, part) — the Account writes #4615 and #4616 repaired, sent
 * concurrently. The interaction half is frontend/test/account_regressions_4618.test.mjs.
 *
 * The earlier route tests (settings_privacy_notify_4615, settings_sessions_identity_4616)
 * send their requests one after another, so a stale write is refused by the
 * route's first check. These send two at once against the real settings
 * router over real SQLite (every migration), so both pass the first check
 * and the store decides:
 *
 *   · two privacy saves naming the same revision: one lands, one is a 409
 *     that wrote nothing;
 *   · two category saves naming the same revision: the same, and the loser,
 *     sent again with the new revision, keeps both choices;
 *   · two public-profile switch saves naming the same revision: the
 *     compare-and-swap lets one land and refuses the other;
 *   · two revokes of the same session: the row is revoked once, the count
 *     and the list agree, and the second revoke reports the already-revoked
 *     state with the first revoke's time.
 *
 * Fixtures are synthetic. documentation/architecture/decisions/D4618.md records the mutation made to check
 * each test fails without its fix.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/account_concurrency_4618.test.ts
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
import { revokeUserSession } from '../src/services/userSessions.ts';

const SECRET = ['d4618', 'account', 'fixture', 'secret'].join('-');
const ME = 61;

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)')
    .run(ME, 'u-synthetic', 'founder', 'Synthetic Member', 'member@example.test');
  const s = db.prepare(`INSERT INTO user_sessions (user_id, jti, user_agent, created_at, last_seen_at, revoked_at)
                        VALUES (?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'), NULL)`);
  s.run(ME, 'jti-a', 'Synthetic browser A');
  s.run(ME, 'jti-b', 'Synthetic browser B');
  const d1 = d1Over(db);
  // A read named by `hold` waits until `holdCount` requests have made it, so concurrent requests all pass their
  // read before any of them writes: the race these tests are about, made certain instead of left to timing.
  let hold: RegExp | null = null; let holdCount = 0; let waiting: Array<() => void> = [];
  const DB = {
    ...d1,
    prepare(sql: string) {
      const stmt = d1.prepare(sql);
      if (!hold || !hold.test(sql)) return stmt;
      const first = stmt.first.bind(stmt);
      const gated: any = { ...stmt, bind(...a: unknown[]) { stmt.bind(...a); return gated; } };
      gated.first = async (col?: string) => {
        const row = await first(col);
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length >= holdCount) { const all = waiting; waiting = []; hold = null; all.forEach((r) => r()); }
        });
        return row;
      };
      return gated;
    },
  };
  const holdReads = (re: RegExp, n: number) => { hold = re; holdCount = n; waiting = []; };
  const env = { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any;
  const app = new Hono<any>();
  app.route('/api/settings', settings);
  app.onError((err: any, c) => {
    const st = ({ Unauthorized: 401 } as Record<string, 401>)[String(err?.message || '')];
    if (st) return c.json({ detail: err.message }, st);
    throw err;
  });
  async function call(method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: ME, jti: 'jti-a' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env));
    let json: any = null; try { json = await res.json(); } catch { json = null; }
    return { status: res.status, body: json };
  }
  /** Several requests in flight together; console noise from the losers is muted. */
  async function together(...reqs: Array<() => Promise<{ status: number; body: any }>>) {
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try { return await Promise.all(reqs.map((r) => r())); } finally { [console.warn, console.error] = saved; }
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  return { db, env, call, together, one, holdReads };
}

const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort();

test('two privacy saves sent together, naming the same revision: one lands, the other is a 409 that wrote nothing', async () => {
  const { call, together, one } = fixture();
  const read = (await call('GET', '/api/settings/privacy')).body;
  assert.equal(read.revision, 0);
  const [a, b] = await together(
    () => call('PUT', '/api/settings/privacy', { visibility: 'private', expected_revision: 0 }),
    () => call('PUT', '/api/settings/privacy', { show_in_directory: false, expected_revision: 0 }),
  );
  assert.deepEqual(statuses([a, b]), [200, 409], JSON.stringify([a.body, b.body]));
  const lost = a.status === 409 ? a : b;
  assert.equal(lost.body.code ?? lost.body.error, 'privacy_conflict');
  assert.equal(lost.body.current.revision, 1, 'the refusal carries what is stored now');
  assert.equal(one('SELECT privacy_revision AS r FROM user_settings WHERE user_id = ?', ME).r, 1, 'one write moved the revision');
  const after = (await call('GET', '/api/settings/privacy')).body;
  const wonVisibility = a.status === 200;
  assert.deepEqual([after.visibility, after.show_in_directory], wonVisibility ? ['private', read.show_in_directory] : [read.visibility, false],
    'only the winner\'s field changed');
});

test('two category saves sent together, naming the same revision: one lands; the other, sent again, keeps both choices', async () => {
  const { call, together, one } = fixture();
  assert.equal((await call('GET', '/api/settings/notifications')).body.revision, 0);
  const sends = [
    { notif_categories_email: { deals: false } },
    { notif_categories_email: { mentions: false } },
  ];
  const rs = await together(...sends.map((body) => () => call('PUT', '/api/settings/notifications', { ...body, expected_revision: 0 })));
  assert.deepEqual(statuses(rs), [200, 409], JSON.stringify(rs.map((r) => r.body)));
  const loser = rs.findIndex((r) => r.status === 409);
  assert.equal(rs[loser].body.code ?? rs[loser].body.error, 'notifications_conflict');
  assert.equal(rs[loser].body.current.revision, 1);
  const again = await call('PUT', '/api/settings/notifications', { ...sends[loser], expected_revision: rs[loser].body.current.revision });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body.notif_categories_email, { deals: false, mentions: false }, 'both members\' choices are kept');
  assert.equal(one('SELECT notifications_revision AS r FROM user_settings WHERE user_id = ?', ME).r, 2);
});

test('two public-profile switch saves sent together, naming the same revision: the compare-and-swap lets one land', async () => {
  const { call, together, one, holdReads } = fixture();
  assert.equal((await call('GET', '/api/settings')).body.public_profile_revision, 0);
  // Both saves read revision 0 before either writes, so the route's own check passes for both and the write decides.
  holdReads(/^SELECT privacy_prefs, role FROM users WHERE id = \?$/, 2);
  const [a, b] = await together(
    () => call('PUT', '/api/settings/privacy/public-profile', { fields: { socials: true }, expected_revision: 0 }),
    () => call('PUT', '/api/settings/privacy/public-profile', { fields: { bio: false }, expected_revision: 0 }),
  );
  assert.deepEqual(statuses([a, b]), [200, 409], JSON.stringify([a.body, b.body]));
  const won = a.status === 200 ? a : b;
  const lost = a.status === 200 ? b : a;
  assert.equal(won.body.public_profile_revision, 1);
  assert.equal(lost.body.code ?? lost.body.error, 'public_profile_conflict');
  const stored = JSON.parse(one('SELECT privacy_prefs FROM users WHERE id = ?', ME).privacy_prefs);
  assert.equal(stored.revision, 1);
  assert.deepEqual(Object.keys(stored.public_profile), Object.keys(won === a ? { socials: true } : { bio: false }),
    'the refused switch was not merged in');
  const reopened = await call('GET', '/api/settings');
  assert.deepEqual(reopened.body.public_profile_effective, won.body.public_profile_effective);
});

test('two revokes of the same session sent together: revoked once, counted once, and the second reports the already-revoked state', async () => {
  const { call, together, one, env, db } = fixture();
  const b = one('SELECT id FROM user_sessions WHERE jti = ?', 'jti-b').id;
  const before = await call('GET', '/api/settings/sessions');
  assert.equal(before.body.active_count, 2);

  const rs = await together(
    () => call('POST', `/api/settings/sessions/${b}/revoke`, {}),
    () => call('POST', `/api/settings/sessions/${b}/revoke`, {}),
  );
  assert.deepEqual(statuses(rs), [200, 200], 'both callers are told the session is ended');
  const after = await call('GET', '/api/settings/sessions');
  assert.equal(after.body.active_count, 1, 'the list counts it once');
  assert.equal(after.body.sessions.find((s: any) => s.user_agent === 'Synthetic browser B').status, 'revoked');
  assert.equal((await call('GET', '/api/settings/security')).body.active_sessions, 1, 'and /security agrees');

  // The shared revoke, called twice at once on a fresh active row: one call revokes, the other sees it already revoked.
  db.prepare("UPDATE user_sessions SET revoked_at = NULL WHERE id = ?").run(b);
  const outcomes = await Promise.all([revokeUserSession(env, b, ME), revokeUserSession(env, b, ME)]);
  assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['already_revoked', 'revoked']);
  const stamp = one('SELECT revoked_at FROM user_sessions WHERE id = ?', b).revoked_at;
  assert.ok(stamp);
  for (const o of outcomes) assert.equal((o as any).revoked_at, stamp, 'both report the one revocation time');

  // Later, a revoke of a row ended earlier keeps the earlier time on the record.
  db.prepare("UPDATE user_sessions SET revoked_at = '2026-01-01 00:00:00' WHERE id = ?").run(b);
  const late = await revokeUserSession(env, b, ME);
  assert.equal(late.outcome, 'already_revoked');
  assert.equal(one('SELECT revoked_at FROM user_sessions WHERE id = ?', b).revoked_at, '2026-01-01 00:00:00');
});
