/**
 * D5249 (#5249) — "Require MFA for admins", option B (enrol-first).
 *
 * Pins: the setting is off by default; while on, an admin without MFA is
 * refused on admin routes with a body naming where to enrol, and an admin with
 * MFA is not; turning it on is refused to a Super Admin without MFA, so it
 * cannot lock out every Super Admin; a change needs a reason, is Super Admin
 * only, and writes its audit row; an unreadable setting reads as off and the
 * read says Unreadable.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/require_admin_mfa_d5249.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import policy from '../src/routes/admin_mfa_policy.ts';
import { requireAdmin } from '../src/auth.ts';
import { mapError } from '../src/routes/_t13t14t15_helpers.ts';
import { ADMIN_MFA_REQUIRED } from '../src/util/authErrors.ts';
import { hasMfaEnrolled, readAdminMfaPolicy } from '../src/services/adminMfaPolicy.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER_MFA = 1;    // Super Admin with MFA
const SUPER_BARE = 2;   // Super Admin without MFA (a TOTP session, but tfa_methods empty)
const ADMIN_BARE = 3;   // plain admin without MFA
const ADMIN_MFA = 4;    // plain admin with MFA

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      db.exec('BEGIN');
      try { const out = []; for (const st of x || []) out.push(await st.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function freshDb({ settings = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT, tfa_methods TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  if (settings) {
    db.exec(`CREATE TABLE platform_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by TEXT
    );`);
  }
  const u = db.prepare('INSERT INTO users (id, role, name, email, tfa_methods) VALUES (?,?,?,?,?)');
  u.run(SUPER_MFA, 'admin', 'Sue', 'sue@axal.example', '["totp"]');
  u.run(SUPER_BARE, 'admin', 'Sam', 'sam@axal.example', '[]');
  u.run(ADMIN_BARE, 'admin', 'Ann', 'ann@axal.example', null);
  u.run(ADMIN_MFA, 'admin', 'Max', 'max@axal.example', '["totp"]');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER_MFA);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER_BARE);
  for (const id of [SUPER_MFA, SUPER_BARE, ADMIN_BARE, ADMIN_MFA]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

// One admin route behind `requireAdmin`, answering through the shared mapError.
const probe = new Hono<any>();
probe.get('/admin-thing', async (c) => {
  try { await requireAdmin(c); return c.json({ ok: true }); } catch (e) { return mapError(c, e); }
});
const app = new Hono<any>();
app.route('/policy', policy);
app.route('/', probe);

async function call(e: any, actor: number, path: string, method = 'GET', body?: any) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(actor)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

const settingRow = (db: any) =>
  db.prepare("SELECT value FROM platform_settings WHERE key = 'require_admin_mfa'").get() as any;
const auditRows = (db: any) =>
  db.prepare("SELECT * FROM admin_audit_log WHERE action = 'require_admin_mfa_update'").all() as any[];

test('the predicate is the Overview\'s: null and [] are no MFA, anything else is MFA', () => {
  assert.equal(hasMfaEnrolled({ tfa_methods: null }), false);
  assert.equal(hasMfaEnrolled({}), false);
  assert.equal(hasMfaEnrolled({ tfa_methods: '[]' }), false);
  assert.equal(hasMfaEnrolled({ tfa_methods: '["totp"]' }), true);
});

test('off by default: no row reads as off, and an admin without MFA reaches admin routes', async () => {
  const db = freshDb();
  const p = await readAdminMfaPolicy(env(db) as any);
  assert.equal(p.on, false);
  assert.equal(p.readable, true);
  const r = await call(env(db), ADMIN_BARE, '/admin-thing');
  assert.equal(r.status, 200);
  const g = await call(env(db), SUPER_MFA, '/policy');
  assert.equal(g.status, 200);
  assert.equal(g.body.enabled, false);
  assert.equal(g.body.readable, true);
  assert.equal(g.body.admins_without_mfa, 2);
});

test('while on, an admin without MFA is refused with a body naming where to enrol; one with MFA is not', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO platform_settings (key, value) VALUES ('require_admin_mfa', '1')").run();
  const bare = await call(env(db), ADMIN_BARE, '/admin-thing');
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, ADMIN_MFA_REQUIRED);
  assert.equal(bare.body.enrol_path, '/account/security');
  const covered = await call(env(db), ADMIN_MFA, '/admin-thing');
  assert.equal(covered.status, 200);
  // A Super Admin without MFA is an admin without MFA: refused too, reads included.
  const superBare = await call(env(db), SUPER_BARE, '/policy');
  assert.equal(superBare.status, 403);
  assert.equal(superBare.body.code, ADMIN_MFA_REQUIRED);
});

test('a value other than "1" is off', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO platform_settings (key, value) VALUES ('require_admin_mfa', '0')").run();
  assert.equal((await call(env(db), ADMIN_BARE, '/admin-thing')).status, 200);
});

test('an unreadable setting reads as off, and the read says Unreadable rather than off', async () => {
  const db = freshDb({ settings: false });
  assert.equal((await call(env(db), ADMIN_BARE, '/admin-thing')).status, 200);
  const g = await call(env(db), SUPER_MFA, '/policy');
  assert.equal(g.status, 200);
  assert.equal(g.body.readable, false);
  // And a write against an unreadable store changes nothing.
  const w = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: true, reason: 'Roll out MFA' });
  assert.equal(w.status, 503);
});

test('turning it on cannot lock out every Super Admin: a Super Admin without MFA is refused, nothing changes', async () => {
  const db = freshDb();
  const r = await call(env(db), SUPER_BARE, '/policy', 'PUT', { enabled: true, reason: 'Roll out MFA' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'actor_without_mfa');
  assert.equal(settingRow(db), undefined);
  assert.equal(auditRows(db).length, 0);
});

test('a Super Admin with MFA turns it on with a reason; the setting and its audit row land together', async () => {
  const db = freshDb();
  const r = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: true, reason: 'Roll out MFA' });
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.changed, true);
  assert.equal(settingRow(db).value, '1');
  const audit = auditRows(db);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, SUPER_MFA);
  assert.deepEqual(JSON.parse(audit[0].filters_json), { from: false, to: true, reason: 'Roll out MFA' });
  // The actor who turned it on still reaches admin routes.
  assert.equal((await call(env(db), SUPER_MFA, '/admin-thing')).status, 200);
  // Same state again changes nothing and writes no second row.
  const again = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: true, reason: 'Roll out MFA' });
  assert.equal(again.body.changed, false);
  assert.equal(auditRows(db).length, 1);
  // Turning it off is recorded too.
  const off = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: false, reason: 'Pause rollout' });
  assert.equal(off.status, 200);
  assert.equal(settingRow(db).value, '0');
  assert.equal(auditRows(db).length, 2);
});

test('a change needs a reason and a boolean', async () => {
  const db = freshDb();
  const noReason = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: true });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, 'reason_required');
  const blank = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: true, reason: '   ' });
  assert.equal(blank.status, 400);
  const notBool = await call(env(db), SUPER_MFA, '/policy', 'PUT', { enabled: 'yes', reason: 'Roll out MFA' });
  assert.equal(notBool.status, 400);
  assert.equal(settingRow(db), undefined);
});

test('a plain admin can neither read nor change the setting', async () => {
  const db = freshDb();
  assert.equal((await call(env(db), ADMIN_MFA, '/policy')).status, 403);
  const w = await call(env(db), ADMIN_MFA, '/policy', 'PUT', { enabled: true, reason: 'Roll out MFA' });
  assert.equal(w.status, 403);
  assert.equal(settingRow(db), undefined);
});
