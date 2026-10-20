/**
 * D481 — HQ · Security's Sessions zone acts: list, revoke, revoke selected,
 * end a support session, and token anomalies from `ai_usage_logs`.
 *
 * EVERY ASSERTION RUNS THE ROUTE. The tables come from schema_baseline.sql,
 * the requests go through the real router and the real gates
 * (`requireSuperAdmin`, `requireSuperAdminWriteBar`), and the effects are read
 * back from the database: whether a row was revoked, whether an audit row
 * names the account, whether the revoked token still opens a door. A source
 * scan could show the words are present; it could not show any of those.
 *
 * The mutations this file exists to catch (#1021):
 *   · a revoke that writes no audit row
 *   · a plain admin (no elevation) reaching the list or a write
 *   · an anomaly counted from anything but `ai_usage_logs`
 *   · a failed read shown as an empty list or as "Not recorded"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import security from '../src/routes/admin_security.ts';
import { requireAuth, JWT_EXPIRY_HOURS } from '../src/auth.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { revokeUserSession } from '../src/services/userSessions.ts';
import {
  loadTokenAnomalies, TOKEN_ANOMALY_FLOOR, TOKEN_ANOMALY_MULTIPLE, TOKEN_ANOMALY_BASELINE_DAYS,
} from '../src/services/tokenAnomalies.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 901;
const PLAIN = 902;
const TARGET = 903;
const OTHER = 904;
const REASON = 'Device reported stolen, ticket SEC-212';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const SETTINGS = read('cloudflare-worker/src/routes/settings.ts');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

const TABLES = [
  'users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log',
  'impersonation_sessions', 'ai_usage_logs',
];

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of TABLES) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sam Super', 'super@axal.example');
  u.run(PLAIN, 'admin', 'Pat Plain', 'plain@axal.example');
  u.run(TARGET, 'founder', 'Fran Target', 'fran@example.com');
  u.run(OTHER, 'founder', 'Olu Other', 'olu@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  // requireFactor wants factor='totp'; requireStepUp wants it RECENT.
  const sess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  );
  sess.run('jti-super', SUPER);
  sess.run('jti-plain', PLAIN);
  const plainSess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, user_agent, ip, factor, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, 'password', datetime('now', ?), datetime('now', ?), ?)`,
  );
  // Minted inside the token lifetime (JWT_EXPIRY_HOURS), so each can still be live.
  plainSess.run('jti-t1', TARGET, 'Mozilla/5.0 (Macintosh)', '203.0.113.7', '-5 hours', '-1 hours', null);
  plainSess.run('jti-t2', TARGET, 'Mozilla/5.0 (iPhone)', '203.0.113.8', '-6 hours', '-2 hours', null);
  plainSess.run('jti-o1', OTHER, 'Mozilla/5.0 (Windows)', '198.51.100.4', '-20 hours', '-3 hours', null);
  // Long expired, and already revoked: neither is listed.
  plainSess.run('jti-stale', OTHER, 'old', '198.51.100.5', '-60 days', '-40 days', null);
  plainSess.run('jti-gone', OTHER, 'gone', '198.51.100.6', '-2 days', '-1 hours', '2026-01-01 00:00:00');
  return db;
}

const idOf = (db: any, jti: string) =>
  Number((db.prepare('SELECT id FROM user_sessions WHERE jti = ?').get(jti) as any).id);
const revokedAt = (db: any, jti: string) =>
  (db.prepare('SELECT revoked_at FROM user_sessions WHERE jti = ?').get(jti) as any).revoked_at;
const audits = (db: any, action: string) =>
  db.prepare('SELECT admin_user_id, viewed_user_id, filters_json FROM admin_audit_log WHERE action = ? ORDER BY id')
    .all(action) as any[];

function app() {
  const a = new Hono();
  a.route('/', security);
  // The worker's own mapping (index.ts), so a refused gate is a 403 here as
  // it is in production rather than a 500 that would pass for "refused".
  a.onError((err: any, c) => {
    const msg = String(err?.message ?? '');
    if (msg === 'step_up_required') return c.json({ detail: msg }, 403);
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[msg];
    if (mapped) return c.json({ detail: msg }, mapped as 401 | 403);
    return c.json({ detail: 'Internal server error', msg }, 500);
  });
  return a;
}

const env = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) }) as any;

async function jwtFor(userId: number, role: string, jti: string): Promise<string> {
  return new SignJWT({ user_id: userId, role, jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: any, actor: [number, string, string], method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(...actor)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app().fetch(
    new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env(db),
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const AS_SUPER: [number, string, string] = [SUPER, 'admin', 'jti-super'];
const AS_PLAIN: [number, string, string] = [PLAIN, 'admin', 'jti-plain'];

/**
 * Whether a token still opens a door — `requireAuth`, the gate every route uses.
 * Pass `token` to present one minted earlier; without it a fresh one is minted.
 */
async function tokenWorks(db: any, userId: number, jti: string, token?: string): Promise<boolean> {
  const a = new Hono();
  a.get('/me', async (c) => { await requireAuth(c as any); return c.json({ ok: true }); });
  a.onError((_e, c) => c.json({ detail: 'refused' }, 401));
  const res = await a.fetch(
    new Request('http://x/me', { headers: { Authorization: `Bearer ${token ?? await jwtFor(userId, 'founder', jti)}` } }),
    env(db),
  );
  return res.status === 200;
}

// ─────────────────────────────────────────────────────────── list ──

test('the list: active, unrevoked sessions in the window, the caller marked Current, no jti on the wire', async () => {
  const db = freshDb();
  const r = await call(db, AS_SUPER, 'GET', '/sessions');
  assert.equal(r.status, 200);
  const jtis = ['jti-super', 'jti-plain', 'jti-t1', 'jti-t2', 'jti-o1'].map((j) => idOf(db, j)).sort();
  assert.deepEqual(r.body.rows.map((x: any) => x.id).sort(), jtis,
    'the list must hold exactly the unrevoked rows seen inside the window');
  assert.equal(r.body.total, 5);
  const own = r.body.rows.find((x: any) => x.user_id === SUPER);
  assert.equal(own.is_current, true, 'the caller\'s own session is not marked Current');
  assert.equal(r.body.rows.filter((x: any) => x.is_current).length, 1);
  const t1 = r.body.rows.find((x: any) => x.id === idOf(db, 'jti-t1'));
  assert.equal(t1.email, 'fran@example.com', 'a row must name its account');
  for (const row of r.body.rows) assert.ok(!('jti' in row), 'the token key went out on the wire');
  assert.equal(r.body.impersonations.available, true);
});

test('"active" is a token that could still open a door: a signed-out account and an expired token drop out of the list AND the counts', async () => {
  const db = freshDb();
  // Seen a minute ago but minted past the token lifetime: last_seen_at alone
  // would call it active; its token died at created_at + JWT_EXPIRY_HOURS.
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at)
     VALUES ('jti-expired', ?, 'password', datetime('now', ?), datetime('now', '-1 minutes'))`,
  ).run(OTHER, `-${JWT_EXPIRY_HOURS + 1} hours`);
  const ids = async () => {
    const r = await call(db, AS_SUPER, 'GET', '/sessions');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = await call(db, AS_SUPER, 'GET', '/overview');
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.sessions.available, true);
    assert.equal(o.body.sessions.active, r.body.total, '/overview and the list disagree on what is active');
    return { ids: r.body.rows.map((x: any) => x.id), total: r.body.total, body: r.body };
  };

  const before = await ids();
  assert.ok(!before.ids.includes(idOf(db, 'jti-expired')), 'an expired token is listed as active');
  assert.ok(before.ids.includes(idOf(db, 'jti-o1')), 'a live session dropped out of the list');
  assert.ok(before.ids.includes(idOf(db, 'jti-t1')) && before.ids.includes(idOf(db, 'jti-t2')));
  assert.equal(before.total, 5, 'the count holds an expired token');
  assert.equal(before.body.token_hours, JWT_EXPIRY_HOURS);

  // The session's token is minted BEFORE the sign-out, as a live one would be.
  // A token minted after it is a new sign-in: the floor is the next whole
  // second (jwtMinIatFloor), so one minted once the clock reaches that second
  // passes it. Minting after the sign-out failed this assertion whenever the
  // run crossed a second boundary between the two calls.
  const t1Token = await jwtFor(TARGET, 'founder', 'jti-t1');

  // HQ's "Sign out account" — it writes users.jwt_min_iat and nothing else.
  const f = await call(db, AS_SUPER, 'POST', `/force-reauth/${TARGET}`, { reason: REASON });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(revokedAt(db, 'jti-t1'), null, 'fixture: force-reauth is expected to leave revoked_at alone');
  assert.equal(await tokenWorks(db, TARGET, 'jti-t1', t1Token), false, 'fixture: the signed-out token still works');

  const after = await ids();
  assert.ok(!after.ids.includes(idOf(db, 'jti-t1')) && !after.ids.includes(idOf(db, 'jti-t2')),
    'a signed-out account\'s sessions came back as active');
  assert.ok(after.ids.includes(idOf(db, 'jti-o1')), 'another account\'s live session dropped out');
  assert.equal(after.total, 3, 'the count still holds the signed-out account\'s sessions');
});

test('a plain admin reaches neither the list nor a write — and nothing moves', async () => {
  const db = freshDb();
  const list = await call(db, AS_PLAIN, 'GET', '/sessions');
  assert.equal(list.status, 403, 'an admin without the elevation read the session list');
  assert.ok(!Array.isArray(list.body.rows));

  const t1 = idOf(db, 'jti-t1');
  const one = await call(db, AS_PLAIN, 'POST', `/sessions/${t1}/revoke`, { reason: REASON });
  assert.equal(one.status, 403);
  const bulk = await call(db, AS_PLAIN, 'POST', '/sessions/revoke', { ids: [t1], reason: REASON });
  assert.equal(bulk.status, 403);
  assert.equal(revokedAt(db, 'jti-t1'), null, 'a refused caller revoked a session');
  assert.equal(audits(db, 'security_session_revoked').length, 0);
});

test('the write bar holds: a super admin on a session without the authenticator cannot revoke', async () => {
  const db = freshDb();
  db.exec("UPDATE user_sessions SET factor = 'password', last_step_up_at = NULL WHERE jti = 'jti-super'");
  const r = await call(db, AS_SUPER, 'POST', `/sessions/${idOf(db, 'jti-t1')}/revoke`, { reason: REASON });
  assert.equal(r.status, 403);
  assert.equal(revokedAt(db, 'jti-t1'), null);
});

test('an unreadable session table is a 503 saying so — never an empty list', async () => {
  const db = freshDb();
  // auth.ts reads user_sessions by jti and, when the table is absent, falls
  // back to the iat floor alone — so the gate still answers and the LIST is
  // what fails, which is the state under test.
  db.exec('DROP TABLE user_sessions');
  const r = await call(db, AS_SUPER, 'GET', '/sessions');
  assert.equal(r.status, 503, 'a failed read came back as a list');
  assert.equal(r.body.code, 'sessions_unreadable');
  assert.match(r.body.error, /^Unreadable/);
  assert.doesNotMatch(r.body.error, /not recorded/i, 'a failed read is not a store that keeps nothing');
  assert.ok(!('rows' in r.body) && !('total' in r.body), 'an unreadable list carried a count');
});

// ───────────────────────────────────────────────────────── revoke ──

test('revoke: the row is revoked, its token stops working, and ONE audit row names the account', async () => {
  const db = freshDb();
  const t1 = idOf(db, 'jti-t1');
  assert.equal(await tokenWorks(db, TARGET, 'jti-t1'), true, 'fixture: the token works before the revoke');

  const r = await call(db, AS_SUPER, 'POST', `/sessions/${t1}/revoke`, { reason: REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(revokedAt(db, 'jti-t1'), 'the session was not revoked');
  assert.equal(revokedAt(db, 'jti-t2'), null, 'the account\'s other session was revoked too');
  assert.equal(await tokenWorks(db, TARGET, 'jti-t1'), false, 'the revoked token still opens a door');
  assert.equal(await tokenWorks(db, TARGET, 'jti-t2'), true, 'a bystander session stopped working');

  const rows = audits(db, 'security_session_revoked');
  assert.equal(rows.length, 1, 'a revoke must write exactly one audit row');
  assert.equal(rows[0].admin_user_id, SUPER);
  assert.equal(rows[0].viewed_user_id, TARGET, 'the audit row does not name whose session it was');
  const f = JSON.parse(rows[0].filters_json);
  assert.equal(f.reason, REASON);
  assert.equal(f.session_id, t1);
  const activity = db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'security_session_revoked'").get() as any;
  assert.equal(activity.n, 1, 'the shared writer\'s activity_logs half is missing');
});

test('revoke refuses: no reason, your own session, a revoked row, an absent id — and audits none of them', async () => {
  const db = freshDb();
  const t1 = idOf(db, 'jti-t1');
  const noReason = await call(db, AS_SUPER, 'POST', `/sessions/${t1}/revoke`, { reason: 'short' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'reason_required');
  assert.equal(revokedAt(db, 'jti-t1'), null);

  const own = await call(db, AS_SUPER, 'POST', `/sessions/${idOf(db, 'jti-super')}/revoke`, { reason: REASON });
  assert.equal(own.status, 409);
  assert.equal(own.body.code, 'own_current_session');
  assert.equal(revokedAt(db, 'jti-super'), null);

  const before = revokedAt(db, 'jti-gone');
  const again = await call(db, AS_SUPER, 'POST', `/sessions/${idOf(db, 'jti-gone')}/revoke`, { reason: REASON });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'already_revoked');
  assert.equal(revokedAt(db, 'jti-gone'), before, 'a second revoke re-stamped the first one\'s time');

  const absentId = await call(db, AS_SUPER, 'POST', '/sessions/99999/revoke', { reason: REASON });
  assert.equal(absentId.status, 404);

  assert.equal(audits(db, 'security_session_revoked').length, 0, 'a refused revoke was recorded as an act');
});

test('revoke selected: one audit row PER SESSION, each naming its own account; a revoked row is reported, not audited', async () => {
  const db = freshDb();
  const ids = [idOf(db, 'jti-t1'), idOf(db, 'jti-o1'), idOf(db, 'jti-gone')];
  const r = await call(db, AS_SUPER, 'POST', '/sessions/revoke', { ids, reason: REASON });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revoked, 2);
  assert.deepEqual(r.body.results.map((x: any) => x.outcome), ['revoked', 'revoked', 'already_revoked']);
  assert.ok(revokedAt(db, 'jti-t1') && revokedAt(db, 'jti-o1'));
  assert.equal(revokedAt(db, 'jti-t2'), null, 'an unselected session was revoked');

  const rows = audits(db, 'security_session_revoked');
  assert.equal(rows.length, 2, 'the bulk revoke must write one audit row per revoked session');
  assert.deepEqual(rows.map((x) => x.viewed_user_id).sort(), [TARGET, OTHER].sort(),
    'each audit row must name the account whose session it was');
});

test('revoke selected refuses a selection holding your own session, and changes nothing', async () => {
  const db = freshDb();
  const ids = [idOf(db, 'jti-t1'), idOf(db, 'jti-super')];
  const r = await call(db, AS_SUPER, 'POST', '/sessions/revoke', { ids, reason: REASON });
  assert.equal(r.status, 409);
  assert.equal(revokedAt(db, 'jti-t1'), null, 'part of a refused selection was revoked');
  assert.equal(audits(db, 'security_session_revoked').length, 0);
  const empty = await call(db, AS_SUPER, 'POST', '/sessions/revoke', { ids: [], reason: REASON });
  assert.equal(empty.status, 400);
});

// ──────────────────────────────────────────── the settings door ──

test('the account holder\'s door reaches only its own rows; the revoke has one home', async () => {
  const db = freshDb();
  const e = env(db);
  const notMine = await revokeUserSession(e, idOf(db, 'jti-o1'), TARGET);
  assert.equal(notMine.outcome, 'not_found', 'an owner-scoped revoke reached another account\'s session');
  assert.equal(revokedAt(db, 'jti-o1'), null);
  const mine = await revokeUserSession(e, idOf(db, 'jti-t1'), TARGET);
  assert.equal(mine.outcome, 'revoked');
  assert.ok(revokedAt(db, 'jti-t1'));
  // The statement moved; settings.ts must not keep a second copy of it.
  assert.match(SETTINGS, /revokeUserSession\(c\.env, id, user\.id\)/, 'settings no longer calls the shared revoke');
  assert.doesNotMatch(SETTINGS, /UPDATE user_sessions SET revoked_at = datetime\('now'\) WHERE id = \$\{id\}/,
    'settings.ts still carries its own copy of the revoke');
});

test('a revoke racing another lands as already revoked, keeps the first time, and is not audited twice', async () => {
  const db = freshDb();
  const t1 = idOf(db, 'jti-t1');
  // A D1 that lets a concurrent revoke land in the gap between the read and
  // the write — the only place the UPDATE's own `revoked_at IS NULL` matters.
  const base = d1Over(db);
  const racing = {
    ...base,
    prepare(sql: string) {
      if (sql.startsWith('UPDATE user_sessions SET revoked_at')) {
        db.prepare("UPDATE user_sessions SET revoked_at = '2026-02-02 02:02:02' WHERE id = ?").run(t1);
      }
      return base.prepare(sql);
    },
  };
  const out = await revokeUserSession({ DB: racing } as any, t1);
  assert.equal(out.outcome, 'already_revoked', 'a revoke this call did not make was reported as its own');
  assert.equal(revokedAt(db, 'jti-t1'), '2026-02-02 02:02:02', 'the racing revoke re-stamped the first one');
});

// ─────────────────────────────────────────── support sessions ──

function seedImpersonations(db: any) {
  const ins = db.prepare(
    `INSERT INTO impersonation_sessions (admin_user_id, target_user_id, context, started_at, ended_at)
     VALUES (?, ?, ?, datetime('now', ?), ?)`,
  );
  const live = Number(ins.run(SUPER, TARGET, 'ticket HQ-4471', '-10 minutes', null).lastInsertRowid);
  const branch = Number(ins.run(0, OTHER, 'hq_support:FR:ticket 9', '-5 minutes', null).lastInsertRowid);
  const old = Number(ins.run(SUPER, OTHER, 'ticket HQ-1', '-300 minutes', null).lastInsertRowid);
  const ended = Number(ins.run(SUPER, OTHER, 'ticket HQ-2', '-20 minutes', '2026-01-01 00:00:00').lastInsertRowid);
  return { live, branch, old, ended };
}
const impRow = (db: any, id: number) => db.prepare('SELECT * FROM impersonation_sessions WHERE id = ?').get(id) as any;

test('the list offers only support sessions that could still be live', async () => {
  const db = freshDb();
  const { live, branch } = seedImpersonations(db);
  const r = await call(db, AS_SUPER, 'GET', '/sessions');
  assert.deepEqual(r.body.impersonations.rows.map((x: any) => x.id).sort(), [live, branch].sort(),
    'an ended row or one past the ceiling was offered as live');
});

test('ending a support session sets ended_at ONLY — the row, its admin and its context survive, and the branch reader still finds it', async () => {
  const db = freshDb();
  const { live, branch } = seedImpersonations(db);
  for (const id of [live, branch]) {
    const before = impRow(db, id);
    const r = await call(db, AS_SUPER, 'POST', `/impersonations/${id}/end`, { reason: REASON });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = impRow(db, id);
    assert.ok(after, 'ending deleted the row');
    assert.ok(after.ended_at, 'ended_at was not set');
    assert.equal(after.admin_user_id, before.admin_user_id, 'admin_user_id was rewritten');
    assert.equal(after.context, before.context, 'context was rewritten');
    assert.equal(after.started_at, before.started_at);
    assert.match(r.body.message, /stays valid until it expires/, 'the response claims the access stopped now');
  }
  // routes/branch_support_sessions.ts's own selection, verbatim.
  const seen = db.prepare(
    `SELECT i.id FROM impersonation_sessions i
      WHERE i.admin_user_id = 0 AND i.context LIKE 'hq_support:%'`,
  ).all() as any[];
  assert.deepEqual(seen.map((x) => x.id), [branch], 'the branch support-session reader lost the row');

  const rows = audits(db, 'security_impersonation_ended');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.viewed_user_id), [TARGET, OTHER], 'the audit row does not name the account');
});

test('ending refuses: already ended, past the ceiling, no reason — and leaves each row as it was', async () => {
  const db = freshDb();
  const { live, old, ended } = seedImpersonations(db);
  const a = await call(db, AS_SUPER, 'POST', `/impersonations/${ended}/end`, { reason: REASON });
  assert.equal(a.status, 409);
  assert.equal(impRow(db, ended).ended_at, '2026-01-01 00:00:00');
  const b = await call(db, AS_SUPER, 'POST', `/impersonations/${old}/end`, { reason: REASON });
  assert.equal(b.status, 409);
  assert.equal(b.body.code, 'past_ceiling');
  assert.equal(impRow(db, old).ended_at, null, 'a row past the ceiling was stamped with a false end time');
  const c = await call(db, AS_SUPER, 'POST', `/impersonations/${live}/end`, {});
  assert.equal(c.status, 400);
  assert.equal(impRow(db, live).ended_at, null);
  const p = await call(db, AS_PLAIN, 'POST', `/impersonations/${live}/end`, { reason: REASON });
  assert.equal(p.status, 403);
  assert.equal(impRow(db, live).ended_at, null);
  assert.equal(audits(db, 'security_impersonation_ended').length, 0);
});

// ─────────────────────────────────────────────── token anomalies ──

/** One day's usage for a user, `hoursAgo` back, as N rows of `tokens` each. */
function usage(db: any, userId: number, hoursAgo: number, tokens: number, cached = 0) {
  db.prepare(
    `INSERT INTO ai_usage_logs (user_id, task, model, prompt_tokens, completion_tokens, cached, created_at)
     VALUES (?, 'chat', 'm', ?, ?, ?, datetime('now', ?))`,
  ).run(userId, Math.floor(tokens / 2), tokens - Math.floor(tokens / 2), cached, `-${hoursAgo} hours`);
}

test('anomalies are computed from ai_usage_logs: a spike over its own baseline, a steady account, a new one, cache hits', async () => {
  const db = freshDb();
  const day = 5000;
  // TARGET: 5,000 a day for the seven days before, 30,000 in the last 24h → 6×.
  for (let d = 2; d <= TOKEN_ANOMALY_BASELINE_DAYS + 1; d++) usage(db, TARGET, d * 24 - 12, day);
  usage(db, TARGET, 2, 30000);
  // OTHER: steady — the same baseline, a normal day.
  for (let d = 2; d <= TOKEN_ANOMALY_BASELINE_DAYS + 1; d++) usage(db, OTHER, d * 24 - 12, day);
  usage(db, OTHER, 3, 6000);
  // PLAIN: no usage before, then over the floor — no baseline, not an anomaly.
  usage(db, PLAIN, 1, TOKEN_ANOMALY_FLOOR + 5000);
  // SUPER: a huge day served entirely from cache — spends nothing.
  usage(db, SUPER, 1, 90000, 1);

  const a = await loadTokenAnomalies(env(db));
  assert.equal(a.available, true);
  if (!a.available) return;
  assert.equal(a.count, 1, 'exactly one account spiked');
  assert.equal(a.rows[0].user_id, TARGET);
  assert.equal(a.rows[0].tokens_24h, 30000);
  assert.equal(a.rows[0].daily_avg_baseline, Math.round((day * TOKEN_ANOMALY_BASELINE_DAYS) / TOKEN_ANOMALY_BASELINE_DAYS));
  assert.ok(a.rows[0].ratio >= TOKEN_ANOMALY_MULTIPLE);
  assert.equal(a.rows[0].email, 'fran@example.com');
  assert.equal(a.no_baseline, 1, 'a heavy new account was dropped or folded into the anomalies');
  assert.equal(a.accounts_checked, 3, 'cache hits were counted as consumption');
});

test('the anomaly figure moves with ai_usage_logs and nothing else', async () => {
  const db = freshDb();
  for (let d = 2; d <= TOKEN_ANOMALY_BASELINE_DAYS + 1; d++) usage(db, TARGET, d * 24 - 12, 5000);
  const before = await loadTokenAnomalies(env(db));
  assert.equal(before.available && before.count, 0);
  // The only change is one ai_usage_logs row. A count read from any other
  // store could not see it.
  usage(db, TARGET, 1, 40000);
  const after = await loadTokenAnomalies(env(db));
  assert.equal(after.available && after.count, 1, 'a spike written to ai_usage_logs was not counted');
});

test('an unreadable ai_usage_logs is unavailable with its reason and NO count', async () => {
  const db = freshDb();
  db.exec('DROP TABLE ai_usage_logs');
  const a: any = await loadTokenAnomalies(env(db));
  assert.equal(a.available, false);
  assert.match(a.reason, /could not be read/);
  assert.ok(!('count' in a), 'an unreadable table carried a count');
});

// ───────────────────────────────────────────────────── /overview ──

test('/overview serves the anomaly figure, and names what the platform does not record — each with a reason', async () => {
  const db = freshDb();
  for (let d = 2; d <= TOKEN_ANOMALY_BASELINE_DAYS + 1; d++) usage(db, TARGET, d * 24 - 12, 5000);
  usage(db, TARGET, 1, 40000);
  const r = await call(db, AS_SUPER, 'GET', '/overview');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ai_safety.token_anomalies.available, true);
  assert.equal(r.body.ai_safety.token_anomalies.count, 1);
  const gaps = r.body.ai_safety.not_counted.map((n: any) => n.what);
  assert.ok(!gaps.includes('Token anomalies'), 'the panel still refuses a figure it serves');
  assert.ok(gaps.includes('Cross-tenant refusals'));
  assert.ok(gaps.includes('Flagged outputs held for review'));
  assert.deepEqual(r.body.kyc_not_recorded.map((n: any) => n.what), ['Accreditation lapsed']);
  assert.deepEqual(r.body.backup_dr.not_recorded.map((n: any) => n.what), ['Failover test']);
  for (const n of [...r.body.ai_safety.not_counted, ...r.body.kyc_not_recorded, ...r.body.backup_dr.not_recorded]) {
    assert.ok(typeof n.reason === 'string' && n.reason.length > 20, `${n.what} has no reason`);
    assert.ok(!('n' in n) && !('count' in n), `${n.what} carries a count nothing measures`);
  }
  const kinds = r.body.dsr.kinds;
  assert.deepEqual(kinds.map((k: any) => [k.kind, k.recorded]), [['erasure', true], ['access', false], ['portability', false]]);
  for (const k of kinds.filter((x: any) => !x.recorded)) assert.ok(k.reason, `${k.kind} has no reason`);
});

test('/overview: each open request names its kind from the store, not from the page', async () => {
  const db = freshDb();
  db.exec(`UPDATE users SET deletion_requested_at = datetime('now', '-3 days') WHERE id = ${TARGET}`);
  const r = await call(db, AS_SUPER, 'GET', '/overview');
  assert.equal(r.body.dsr.rows.length, 1);
  assert.equal(r.body.dsr.rows[0].kind, 'erasure');
});
