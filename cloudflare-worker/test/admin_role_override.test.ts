/**
 * A super admin can correct a role. Narrowly, with a reason, and on the record.
 *
 * THE COMPLAINT WAS "I CANNOT CHANGE THE ROLE OF USERS", and it was true in
 * practice without anything being broken: leaving `exploring` requires a signed
 * binding agreement, checked in the dropdown and twice on the server, and every
 * new signup lands in `exploring` — so the control covered most of the Users
 * table and read as a dead picker.
 *
 * The resolution keeps the gate as the default and adds ONE narrow way past it.
 * These tests are what makes "narrow" a fact rather than an intention:
 *
 *   - it is super-admin only, not admin;
 *   - it needs a reason of real length, because the reason is the audit;
 *   - the reason reaches the `role_changed` audit line, so an override is
 *     legible afterwards instead of indistinguishable from a routine change;
 *   - and it CANNOT mint or remove an admin, which stays SQL-only. That last
 *     one is the assertion that matters most. Since D249 the override is
 *     decided below those guards, and the reason it still cannot reach them is
 *     that it only exists for an `exploring` target, which is never an admin —
 *     the three "cannot" tests at the end hold that, whatever the ordering.
 *
 * D249 added four facts, each pinned below: an override is a change OUT OF
 * `exploring` and nothing else (a reason on founder→partner is that change's
 * reason, not an override); it takes demote's bar (a TOTP-minted session and a
 * fresh step-up); the person's own row says it was an override, and why; and
 * it is one `role_override` audit row naming them, with `user_role_review`
 * stamped and a founder's onboarding restarted, as assign-role does.
 *
 * Real SQLite via the shim below, for the reason `_d1_sqlite.mjs` gives: the
 * route's own SQL with its own binds decides what happens, and `getSQL` is a
 * thin wrapper over `env.DB`, so the same shim serves both styles in this route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import admin from '../src/routes/admin.ts';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../src/util/authErrors.ts';

// `requireAdmin` refuses by throwing; the status comes from `app.onError` in
// index.ts, which is not in the chain for a directly dispatched sub-app. It is
// replicated from the ONE table index.ts reads, so a refusal — D249's factor
// and step-up included — is not asserted as a 500.
const app = new Hono<any>();
app.route('/', admin);
app.onError((err: any, c) => {
  const msg = String(err?.message || '');
  if (msg === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(err), 403);
  const status = AUTH_ERROR_STATUSES[msg];
  if (status) return c.json({ detail: msg }, status);
  throw err;
});

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
/** One table's CREATE TABLE, verbatim from the baseline. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;        // an admin who IS elevated
const PLAIN = 2;        // an admin who is not
const EXPLORER = 20;    // the case this exists for
const FOUNDER = 21;     // already assigned, so ungated
const OTHER_ADMIN = 22; // the target that must stay untouchable

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run().catch(() => ({}))); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER
    );
    CREATE TABLE user_role_review (
      user_id INTEGER PRIMARY KEY, role_confirmed INTEGER, assigned_role TEXT,
      assigned_by_user_id INTEGER, assigned_at TEXT, binding_envelope_id INTEGER, updated_at TEXT
    );
  `);
  // D249 — the write bar reads user_sessions; the override writes one audit
  // row and restarts a founder's onboarding.
  for (const t of ['user_sessions', 'admin_audit_log', 'onboarding_progress']) db.exec(ddl(t));
  db.exec(`INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
           VALUES ('totp-1', 1, 'totp', datetime('now'), datetime('now')),
                  ('stale-1', 1, 'totp', datetime('now', '-60 minutes'), datetime('now', '-60 minutes'))`);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(PLAIN, 'admin', 'Pat', 'pat@axal.example');
  u.run(EXPLORER, 'exploring', 'Ex', 'ex@example.com');
  u.run(FOUNDER, 'founder', 'Fran', 'fran@example.com');
  u.run(OTHER_ADMIN, 'admin', 'Otto', 'otto@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  return db;
}

/**
 * The same database, except `users` still carries `is_super_admin`.
 *
 * The first version of migration 199 put the elevation on `users` and set it
 * for every admin; 199 was rewritten to use the `super_admins` side table
 * because `users` is at D1's 100-column ceiling, but a database that applied
 * the first version still has the column and still has it saying yes. That
 * matters here because `getCurrentUser` loads the caller with `SELECT *`, so
 * the stale column arrives on the user object — and the override gate is a
 * single `isSuperAdmin(adminUser)` read of exactly that object.
 *
 * What makes it safe is ordering inside `getCurrentUser`: `hydrateSuperAdmin`
 * runs after the SELECT and writes the side table's answer over whatever came
 * back. This fixture is the only thing in the suite that would notice if that
 * ever stopped being true — every other test uses a schema where the column
 * does not exist, so they would all still pass while every admin in a
 * half-migrated database silently became a super admin.
 */
function staleColumnDb() {
  const db = freshDb();
  db.exec('ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 1');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, role: string, jti?: string): Promise<string> {
  return new SignJWT({ user_id: userId, role, ...(jti ? { jti } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** D249 — the super admin's TOTP-minted session, stepped up just now. */
const FRESH = 'totp-1';
/** The same kind of session, stepped up an hour ago. */
const STALE = 'stale-1';

async function setRole(
  e: any, actor: number, targetId: number, role: string, overrideReason?: string, session?: string,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(actor, 'admin', session)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(
    `/users/${targetId}/role?role=${role}`,
    { method: 'PATCH', headers, body: JSON.stringify(overrideReason ? { override_reason: overrideReason } : {}) },
    e,
  );
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const roleOf = (db: InstanceType<typeof DatabaseSync>, id: number): string =>
  (db.prepare('SELECT role FROM users WHERE id = ?').get(id) as any)?.role;

const auditLines = (db: InstanceType<typeof DatabaseSync>): string[] =>
  (db.prepare("SELECT details FROM activity_logs WHERE action = 'role_changed'").all() as any[])
    .map((r) => String(r.details));
/** The person's own row — the one their activity feed shows them. */
const theirLines = (db: InstanceType<typeof DatabaseSync>): Array<{ details: string; user_id: number }> =>
  db.prepare("SELECT details, user_id FROM activity_logs WHERE action = 'your_role_changed'").all() as any[];
const overrideAudit = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare("SELECT admin_user_id, viewed_user_id, filters_json FROM admin_audit_log WHERE action = 'role_override'").all() as any[];

const GOOD_REASON = 'Signed on paper, countersigned copy filed in Drive';

/* ------------------------------------------------------------------ *
 * The gate still holds
 * ------------------------------------------------------------------ */

test('without a reason, an exploring user is still refused', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder');
  assert.equal(r.status, 409);
  assert.equal(r.body?.code, 'use_exploring_assign_role',
    'the unreasoned path must refuse exactly as it did before');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});

test('a plain admin cannot override, however good the reason', async () => {
  const db = freshDb();
  const r = await setRole(env(db), PLAIN, EXPLORER, 'founder', GOOD_REASON);
  assert.equal(r.status, 403);
  assert.equal(r.body?.code, 'super_admin_required');
  assert.equal(roleOf(db, EXPLORER), 'exploring', 'a non-super admin moved a role');
});

test('a stale users.is_super_admin column does not elevate a plain admin', async () => {
  // Not hypothetical: the column exists in any database that applied the first
  // version of migration 199, saying 1 for every admin. The side table is the
  // authority, and this is the assertion that says so.
  const db = staleColumnDb();
  assert.equal(
    (db.prepare('SELECT is_super_admin FROM users WHERE id = ?').get(PLAIN) as any).is_super_admin, 1,
    'the fixture is not reproducing the half-migrated database this test is about',
  );
  const r = await setRole(env(db), PLAIN, EXPLORER, 'founder', GOOD_REASON);
  assert.equal(r.status, 403, 'a stale column elevated an admin who has no super_admins row');
  assert.equal(r.body?.code, 'super_admin_required');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});

test('the real elevation still reads through that same column', async () => {
  // The other direction of the same fact — if the side table's answer were not
  // reaching `isSuperAdmin` at all, the test above would pass for the wrong
  // reason and nobody could override anything.
  const db = staleColumnDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON, FRESH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(roleOf(db, EXPLORER), 'founder');
});

test('a reason under ten characters is not a reason', async () => {
  // D249 — sent from a stepped-up session, so the 400 is the reason's and not
  // the write bar's.
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder', 'ok', FRESH);
  assert.equal(r.status, 400);
  assert.equal(r.body?.code, 'override_reason_too_short');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});

test('whitespace is not length', async () => {
  // The check trims first. Without that, twelve spaces would buy an override
  // and the audit line would read as blank.
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder', '            ');
  assert.equal(r.status, 409,
    'a whitespace-only reason must not even register as an override request');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});

/* ------------------------------------------------------------------ *
 * The override works, and says so
 * ------------------------------------------------------------------ */

test('a super admin with a reason assigns the role', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON, FRESH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body?.override, true);
  assert.equal(roleOf(db, EXPLORER), 'founder');
});

test('the audit line carries the override and its reason', async () => {
  // The whole argument for allowing this is that it is legible afterwards. An
  // override recorded as a routine role change would be worse than no override.
  // D249 — re-aimed, not loosened: the role_changed line keeps every assertion
  // it had, and the record now also reaches the person's own row and one
  // audit row that names them. The reason is no longer "the only place it was
  // going", so that message is corrected, not the assertion.
  const db = freshDb();
  await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON, FRESH);

  const lines = auditLines(db);
  assert.equal(lines.length, 1, `expected one role_changed line, got ${lines.length}`);
  assert.match(lines[0], /OVERRIDE/,
    'the audit line does not mark this as an override, so it reads as routine');
  assert.ok(lines[0].includes(GOOD_REASON), 'the typed reason is not in the admin\'s role_changed line');
  assert.match(lines[0], /from exploring to founder/,
    'the audit line no longer names both roles');

  const theirs = theirLines(db);
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0].user_id, EXPLORER, 'the person\'s row is not on the person');
  assert.match(theirs[0].details, /without a completed binding agreement: a Super Admin override\./,
    'the person\'s own row does not say it was an override');
  assert.ok(theirs[0].details.endsWith(`Reason: ${GOOD_REASON}`), 'the person\'s own row does not say why');

  const audit = overrideAudit(db);
  assert.equal(audit.length, 1, `one override must write exactly one role_override audit row, got ${audit.length}`);
  assert.equal(audit[0].admin_user_id, SUPER);
  assert.equal(audit[0].viewed_user_id, EXPLORER, 'the audit row has no subject (D159: target_user_id)');
  const d = JSON.parse(audit[0].filters_json);
  assert.deepEqual([d.from, d.to, d.reason], ['exploring', 'founder', GOOD_REASON]);
});

test('D249: an override stamps the review as assign-role does, and restarts a founder\'s onboarding', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON, FRESH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const review = db.prepare('SELECT role_confirmed, assigned_role, assigned_by_user_id, assigned_at FROM user_role_review WHERE user_id = ?').get(EXPLORER) as any;
  assert.ok(review, 'no user_role_review row — the Exploring queue still reads the account as waiting');
  assert.equal(review.role_confirmed, 1);
  assert.equal(review.assigned_role, 'founder');
  assert.equal(review.assigned_by_user_id, SUPER);
  assert.ok(review.assigned_at, 'assigned_at was not stamped');
  const ob = db.prepare('SELECT flow, step, completed_at FROM onboarding_progress WHERE user_id = ?').get(EXPLORER) as any;
  assert.deepEqual(ob && [ob.flow, ob.step, ob.completed_at], ['founder', 0, null],
    'a founder moved in by override has no onboarding wizard to land on');
});

test('D249: the override takes demote\'s bar — no TOTP session, or a stale step-up, is refused and changes nothing', async () => {
  const db = freshDb();
  const bare = await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON);
  assert.equal(bare.status, 403, 'an override went through with no authenticator');
  assert.equal(bare.body?.detail, 'TOTP required');
  const stale = await setRole(env(db), SUPER, EXPLORER, 'founder', GOOD_REASON, STALE);
  assert.equal(stale.status, 403, 'an override went through on an hour-old step-up');
  assert.equal(stale.body?.code, 'step_up_required');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
  assert.equal(auditLines(db).length, 0);
  assert.equal(overrideAudit(db).length, 0);
});

test('a routine role change is not marked as an override', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, FOUNDER, 'partner');
  assert.equal(r.status, 200);
  const lines = auditLines(db);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /OVERRIDE/,
    'an ordinary change is being labelled an override, which makes the marker meaningless');
});

test('an already-assigned user is unaffected by a reason being present', async () => {
  // D249 — this drove founder→partner with a reason and checked only the
  // role, while the route stamped "BINDING-AGREEMENT OVERRIDE" on the line: an
  // ordinary change labelled an override, because the label keyed on a reason
  // being present. It is re-aimed at what the label means now. The reason is
  // carried as the change's own reason, on both rows, and nothing says override.
  const db = freshDb();
  const r = await setRole(env(db), SUPER, FOUNDER, 'partner', GOOD_REASON);
  assert.equal(r.status, 200);
  assert.equal(r.body?.override, false);
  assert.equal(roleOf(db, FOUNDER), 'partner');
  const [line] = auditLines(db);
  assert.doesNotMatch(line, /OVERRIDE/, 'an ordinary change with a reason is labelled an override');
  assert.ok(line.endsWith(`. Reason: ${GOOD_REASON}`), 'the reason sent with an ordinary change was dropped');
  const [theirs] = theirLines(db);
  assert.doesNotMatch(theirs.details, /override/i, 'the person is told an ordinary change was an override');
  assert.ok(theirs.details.endsWith(`. Reason: ${GOOD_REASON}`));
  assert.equal(overrideAudit(db).length, 0, 'an ordinary change wrote a role_override audit row');
});

test('D249: a reason on an ordinary change is not an override, so a plain admin may send one', async () => {
  // The Super Admin requirement belongs to the override. A plain admin could
  // always make founder→partner without a reason; refusing the same change
  // WITH one guarded nothing, and only punished writing down why.
  const db = freshDb();
  const r = await setRole(env(db), PLAIN, FOUNDER, 'partner', GOOD_REASON);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(roleOf(db, FOUNDER), 'partner');
  assert.equal(overrideAudit(db).length, 0);
});

/* ------------------------------------------------------------------ *
 * The door stays narrow
 * ------------------------------------------------------------------ */

test('the override cannot mint an admin', async () => {
  // Admin promotion is SQL-only, deliberately, to bound the blast radius of a
  // compromised admin session. The override is validated ABOVE that guard so it
  // can never reach it; reordering the two would turn this into escalation.
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'admin', GOOD_REASON);
  assert.equal(r.status, 403);
  assert.equal(r.body?.code, 'admin_promotion_disabled');
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});

test('the override cannot demote an existing admin', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, OTHER_ADMIN, 'founder', GOOD_REASON);
  assert.equal(r.status, 403);
  assert.equal(r.body?.code, 'admin_demotion_disabled');
  assert.equal(roleOf(db, OTHER_ADMIN), 'admin');
});

test('the override cannot invent a role', async () => {
  const db = freshDb();
  const r = await setRole(env(db), SUPER, EXPLORER, 'superuser', GOOD_REASON);
  assert.equal(r.status, 400);
  assert.equal(roleOf(db, EXPLORER), 'exploring');
});
