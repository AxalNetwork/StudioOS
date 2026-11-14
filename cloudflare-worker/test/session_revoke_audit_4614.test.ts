/**
 * D4614 (#4614) — Settings' per-session revoke writes one audit row per revocation.
 *
 * `POST /api/settings/sessions/:id/revoke` used to write a `session_revoked`
 * activity_logs row on every call, ignoring the shared revoke's
 * `already_revoked` outcome, so a repeated or concurrent revoke of one
 * session left two rows for one act. Real SQLite over every migration and the
 * real settings router, signed in with a token bound to a `user_sessions` row.
 * Pinned:
 *   · one revoke writes exactly one row;
 *   · a second revoke of the same session writes none, and still answers 200 { ok: true };
 *   · two revokes sent together (both past the read before either writes) write exactly one;
 *   · another member's session is 404, unrevoked, and unaudited, as before.
 *
 * Mutations checked (documentation/architecture/decisions/D4614.md): the route's
 * `outcome === 'revoked'` guard removed fails the second, third and fourth
 * tests; the service reporting `revoked` whatever its UPDATE changed fails
 * the fourth; the route's revoke without `user.id` fails the fifth.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/session_revoke_audit_4614.test.ts
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

const SECRET = ['d4614', 'revoke', 'fixture', 'secret'].join('-');
const ME = 71, OTHER = 72;

function fixture() {
  const db = new DatabaseSync(':memory:', { ...SCHEMA_OPTIONS });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, uid, role, name, email) VALUES (?, ?, ?, ?, ?)');
  u.run(ME, 'u-synthetic-me', 'founder', 'Synthetic Member', 'member@example.test');
  u.run(OTHER, 'u-synthetic-other', 'founder', 'Synthetic Other', 'other@example.test');
  const s = db.prepare(`INSERT INTO user_sessions (user_id, jti, user_agent, created_at, last_seen_at, revoked_at)
                        VALUES (?, ?, ?, datetime('now', '-1 minutes'), datetime('now', '-1 minutes'), NULL)`);
  s.run(ME, 'jti-current', 'Synthetic browser A');
  s.run(ME, 'jti-target', 'Synthetic browser B');
  s.run(OTHER, 'jti-other', 'Synthetic browser C');
  const d1 = d1Over(db);
  // A read named by `hold` waits until `holdCount` callers have made it, so concurrent revokes all pass the
  // service's read before either writes: the race this issue is about, made certain instead of left to timing.
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
  async function revoke(id: number) {
    const token = await new SignJWT({ user_id: ME, jti: 'jti-current' }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
    try {
      const res = await withThrownResponses(() => app.request(`/api/settings/sessions/${id}/revoke`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
      }, env));
      let json: any = null; try { json = await res.json(); } catch { json = null; }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error] = saved; }
  }
  const one = (sql: string, ...a: unknown[]) => ({ ...(db.prepare(sql).get(...a) as any) });
  const idOf = (jti: string) => Number(one('SELECT id FROM user_sessions WHERE jti = ?', jti).id);
  const auditRows = (id: number) => db.prepare(
    "SELECT action, details, actor, user_id FROM activity_logs WHERE action = 'session_revoked' AND details = ?",
  ).all(`User revoked session ${id} from /settings`).map((r: any) => ({ ...r }));
  return { db, revoke, one, idOf, auditRows, holdReads };
}

test('one revoke writes exactly one session_revoked row, naming the member', async () => {
  const { revoke, one, idOf, auditRows } = fixture();
  const id = idOf('jti-target');
  const r = await revoke(id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  assert.ok(one('SELECT revoked_at FROM user_sessions WHERE id = ?', id).revoked_at, 'the session is revoked');
  assert.deepEqual(auditRows(id), [{
    action: 'session_revoked', details: `User revoked session ${id} from /settings`,
    actor: 'member@example.test', user_id: ME,
  }]);
});

test('a second revoke of the same session writes no row and still answers 200 { ok: true }', async () => {
  const { revoke, one, idOf, auditRows } = fixture();
  const id = idOf('jti-target');
  assert.equal((await revoke(id)).status, 200);
  const stamp = one('SELECT revoked_at FROM user_sessions WHERE id = ?', id).revoked_at;
  const again = await revoke(id);
  assert.equal(again.status, 200, 'the response is unchanged for an already-revoked session');
  assert.deepEqual(again.body, { ok: true });
  assert.equal(auditRows(id).length, 1, 'the repeat changed nothing, so it records nothing');
  assert.equal(one('SELECT revoked_at FROM user_sessions WHERE id = ?', id).revoked_at, stamp, 'the first time stays');
});

test('a revoke of a session ended earlier writes no row', async () => {
  const { db, revoke, idOf, auditRows } = fixture();
  const id = idOf('jti-target');
  db.prepare("UPDATE user_sessions SET revoked_at = '2026-01-01 00:00:00' WHERE id = ?").run(id);
  const r = await revoke(id);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(auditRows(id).length, 0);
});

test('two revokes sent together, both past the read before either writes: exactly one row', async () => {
  const { revoke, idOf, auditRows, holdReads } = fixture();
  const id = idOf('jti-target');
  holdReads(/^SELECT id, user_id, revoked_at FROM user_sessions WHERE id = \? AND user_id = \?$/, 2);
  const rs = await Promise.all([revoke(id), revoke(id)]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200], JSON.stringify(rs.map((r) => r.body)));
  assert.deepEqual(rs.map((r) => r.body), [{ ok: true }, { ok: true }], 'both callers are told the session is ended');
  assert.equal(auditRows(id).length, 1, 'one revocation, one audit row');
});

test('another member\'s session is not found, not revoked and not audited, as before', async () => {
  const { revoke, one, idOf, auditRows } = fixture();
  const id = idOf('jti-other');
  const r = await revoke(id);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: 'Not found' });
  assert.equal(one('SELECT revoked_at FROM user_sessions WHERE id = ?', id).revoked_at, null);
  assert.equal(auditRows(id).length, 0);
});
