/**
 * D134 — opening and closing an admin account, through the licence.
 *
 * WHAT WAS MISSING, MEASURED RATHER THAN ASSUMED. The user's model is that one
 * super admin opens, supervises, bans and closes many subsidiary admins. D132
 * gave "ban" (toggle-active) and D133 gave "supervise"; "open" and "close" had
 * no route at all:
 *
 *   - `PATCH /users/:userId/role` refuses `role === 'admin'` with
 *     `admin_promotion_disabled`, for EVERYONE, holder included — and its
 *     override is validated deliberately ABOVE that guard so it can never
 *     reach it. The only way to mint an admin was SQL against production.
 *   - The same route refuses to demote one, with `admin_demotion_disabled`,
 *     on the same terms. The only way to close one was SQL.
 *   - `POST /licences/:uid/admins` wrote the binding and left `users.role`
 *     alone, so the table that says WHICH licence an administrator runs could
 *     name an account that was not an administrator at all.
 *
 * THE SHAPE THIS FILE PINS, and it is asymmetric on purpose. Opening is ONE
 * act: bind and promote in one batch, so no admin exists without a territory
 * behind them. Closing is TWO: demote, then detach — because unbinding first
 * would produce exactly the unscoped admin the single-act open exists to make
 * impossible. `DELETE` refuses while the role is still held and names the step.
 *
 * EVERY REFUSAL HAS A COMPANION, on the D133 precedent: a gate that refuses
 * everybody is not a gate. Each test that proves something is stopped is
 * paired with one proving the intended path still works.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_admin_lifecycle_d134.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import admin from '../src/routes/admin.ts';
import licences from '../src/routes/admin_licences.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;         // HQ — the one elevated account
const SPARE_ADMIN = 2;   // another admin, so the last-admin floor is not the refusal under test
const MEMBER = 30;       // a founder — the account being appointed
const LIC = 'lic_d134';
const REASON = 'appointing the France principal per signed licence AXL-001';

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
    // NOT swallowing here, unlike D133's shim: the promote is a batch and a
    // silently dropped statement is exactly the defect these tests exist to
    // catch — a binding written with no role, or a role with no binding.
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const ERRORS = {
  Unauthorized: 401,
  'Admin required': 403,
  'Super admin required': 403,
  'HQ only': 403,
  'TOTP required': 403,
  step_up_required: 403,
} as Record<string, 401 | 403>;

function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const s = ERRORS[String(err?.message || '')];
    if (s) return c.json({ detail: err.message, code: err.message }, s);
    throw err;
  });
  return a;
}
const app = appFor(admin);
const lic = appFor(licences);

/**
 * `users` has NO role CHECK on purpose: `ensureExploringSchema` rebuilds the
 * table only when the live DDL carries one naming 'partner', so leaving it off
 * keeps the demote's bootstrap a no-op instead of dropping and recreating the
 * fixture mid-test.
 */
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      name TEXT, email TEXT
    );
    CREATE TABLE super_admins (
      user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT
    );
    CREATE TABLE user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT,
      last_step_up_at TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE user_role_review (
      user_id INTEGER PRIMARY KEY, role_confirmed INTEGER, assigned_role TEXT,
      assigned_by_user_id INTEGER, assigned_at TEXT, updated_at TEXT
    );
    CREATE TABLE territory_licences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT,
      signatory_name TEXT, signatory_title TEXT, status TEXT NOT NULL DEFAULT 'active',
      term_years INTEGER, annual_fee_cents INTEGER, currency TEXT, revenue_share_bps INTEGER,
      token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- The CHECK is copied from migration 187 rather than left off: a fixture
    -- that admits any event value cannot fail on an event the real constraint
    -- rejects, which is how a live violation stayed invisible one table over.
    CREATE TABLE licence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                           'terms_changed', 'activated', 'suspended',
                                           'reinstated', 'renewed', 'terminated')),
      detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(SPARE_ADMIN, 'admin', 'Pat', 'pat@axal.example');
  u.run(MEMBER, 'founder', 'Fran', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, SPARE_ADMIN, MEMBER]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  db.prepare(
    "INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,'active')",
  ).run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function token(userId: number, jti = `totp-${userId}`): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  a: any, e: any, actor: number, path: string, method = 'GET', body?: any, jti?: string,
): Promise<{ status: number; body: any }> {
  const res = await a.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${await token(actor, jti ?? `totp-${actor}`)}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

const appoint = (e: any, actor = SUPER, over: any = {}) =>
  call(lic, e, actor, `/${LIC}/admins`, 'POST',
    { email: 'fran@example.com', admin_role: 'principal', reason: REASON, ...over });

const roleOf = (db: any, id: number) =>
  String(db.prepare('SELECT role FROM users WHERE id = ?').get(id)?.role ?? '');
const boundCount = (db: any, id: number) =>
  Number(db.prepare('SELECT COUNT(*) AS n FROM licence_admins WHERE user_id = ?').get(id)?.n ?? 0);

/* ------------------------------------------------------------------ *
 * 1. Open — one act, or it is not an act at all                       *
 * ------------------------------------------------------------------ */

test('appointing an administrator promotes the account AND binds it, in one call', async () => {
  const db = freshDb();
  const { status, body } = await appoint(env(db));
  assert.equal(status, 200, `appoint refused: ${JSON.stringify(body)}`);
  assert.equal(roleOf(db, MEMBER), 'admin',
    'the binding was written and the role was not — an administrator who cannot administer');
  assert.equal(boundCount(db, MEMBER), 1,
    'the role was granted and nothing names the licence behind it — the unscoped admin this door exists to prevent');
  assert.equal(body?.promoted_from, 'founder',
    'the audit cannot say what the account was before, so the change is not reversible by reading it');
});

test('the appointment is recorded as a licence event, with the reason', async () => {
  const db = freshDb();
  await appoint(env(db));
  const ev = db.prepare(
    "SELECT event, note, detail_json FROM licence_events ORDER BY id DESC LIMIT 1",
  ).get() as any;
  assert.equal(ev?.event, 'terms_changed');
  assert.equal(ev?.note, REASON, 'the reason was collected and thrown away');
  assert.match(String(ev?.detail_json || ''), /promoted_from/);
});

test('a reason under ten characters refuses, and writes NOTHING', async () => {
  const db = freshDb();
  const { status, body } = await appoint(env(db), SUPER, { reason: 'because' });
  assert.equal(status, 400);
  assert.equal(body?.code, 'reason_too_short');
  assert.equal(roleOf(db, MEMBER), 'founder', 'a refused appointment still promoted the account');
  assert.equal(boundCount(db, MEMBER), 0, 'a refused appointment still bound the account');
});

test('a session that never carried TOTP cannot appoint — the write bar, not the elevation', async () => {
  // The companion below is the whole point: this must fail for the FACTOR, not
  // because the super admin lost the power.
  const db = freshDb();
  db.prepare("UPDATE user_sessions SET factor = 'sms', assurance_level = 'sms' WHERE user_id = ?").run(SUPER);
  const { status, body } = await appoint(env(db));
  assert.equal(status, 403, 'an SMS-minted super admin session minted an administrator');
  // `admin_licences.ts` catches its own throws, so the answer is `mapError`'s
  // `{detail}` rather than the app-level handler's shape. Asserting the sentence
  // and not just the status is what keeps this distinguishable from the
  // elevation refusal, which is also a 403.
  assert.equal(body?.detail, 'TOTP required');
  assert.equal(roleOf(db, MEMBER), 'founder');
});

test('a TOTP session whose step-up has gone stale cannot appoint either', async () => {
  const db = freshDb();
  db.prepare(
    "UPDATE user_sessions SET created_at = datetime('now','-3 hours') WHERE user_id = ?",
  ).run(SUPER);
  const { status, body } = await appoint(env(db));
  assert.equal(status, 403, 'a day-old TOTP session was treated as a person at a keyboard');
  // THIS ASSERTION FOUND A LIVE DEFECT AND IS WHY IT IS THREE LINES RATHER THAN
  // ONE. `step_up_required` was in `app.onError` as a special case and in
  // `AUTH_ERROR_STATUSES` not at all, so `mapError` — which 31 route files reach
  // INSTEAD of that handler — fell through to its 400 default. The status was
  // wrong and, worse, the body carried neither the code the SPA prompts off nor
  // the TTL it shows. Both readers now build it from one function.
  assert.equal(body?.code, 'step_up_required');
  assert.equal(body?.ttl_minutes, 15, 'the refusal cannot say how fresh a step-up has to be');
  assert.match(String(body?.detail || ''), /re-authentication/);
});

test('a plain admin cannot appoint one — this is the super admin\'s door', async () => {
  const db = freshDb();
  const { status } = await appoint(env(db), SPARE_ADMIN);
  assert.equal(status, 403, 'a subsidiary admin appointed an administrator');
  assert.equal(roleOf(db, MEMBER), 'founder');
});

/* ------------------------------------------------------------------ *
 * 2. The list — the transient state is on the screen, not inferred    *
 * ------------------------------------------------------------------ */

test('GET returns the account\'s role and active state, not just its name', async () => {
  const db = freshDb();
  await appoint(env(db));
  const { status, body } = await call(lic, env(db), SUPER, `/${LIC}/admins`);
  assert.equal(status, 200);
  const row = (body?.items || []).find((x: any) => x.user_id === MEMBER);
  assert.ok(row, 'the appointed administrator is not in the list');
  assert.equal(row.role, 'admin',
    'the list cannot tell an administrator from an account that was demoted an hour ago');
  assert.equal(Number(row.is_active), 1,
    'the list renders a closed account and a live one identically');
});

/* ------------------------------------------------------------------ *
 * 3. Close — two steps, in that order                                 *
 * ------------------------------------------------------------------ */

test('detach REFUSES while the account still holds the admin role, and names the step', async () => {
  const db = freshDb();
  await appoint(env(db));
  const { status, body } = await call(lic, env(db), SUPER, `/${LIC}/admins/${MEMBER}`, 'DELETE');
  assert.equal(status, 409, 'detaching first left an administrator with no licence behind them');
  assert.equal(body?.code, 'still_an_admin');
  assert.match(String(body?.error || ''), /demote-admin/,
    'the refusal does not say which route to use, so it is a dead end');
  assert.equal(boundCount(db, MEMBER), 1, 'the refusal still unbound the account');
});

test('demote then detach is the path, and it completes', async () => {
  const db = freshDb();
  const e = env(db);
  await appoint(e);
  const dem = await call(app, e, SUPER, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'licence AXL-001 terminated, administrator closed' });
  assert.equal(dem.status, 200, `demote refused: ${JSON.stringify(dem.body)}`);
  assert.equal(roleOf(db, MEMBER), 'exploring',
    'a demoted administrator did not land in the holding state');
  assert.equal(boundCount(db, MEMBER), 1,
    'the demote also unbound the licence — the two steps are meant to be separable');
  const det = await call(lic, e, SUPER, `/${LIC}/admins/${MEMBER}`, 'DELETE');
  assert.equal(det.status, 200, `detach refused after demote: ${JSON.stringify(det.body)}`);
  assert.equal(boundCount(db, MEMBER), 0);
});

test('the demote resets the exploring review so the account reappears in the queue', async () => {
  const db = freshDb();
  const e = env(db);
  await appoint(e);
  db.prepare(
    "INSERT INTO user_role_review (user_id, role_confirmed, assigned_role) VALUES (?, 1, 'founder')",
  ).run(MEMBER);
  await call(app, e, SUPER, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'licence AXL-001 terminated, administrator closed' });
  const rr = db.prepare('SELECT role_confirmed, assigned_role FROM user_role_review WHERE user_id = ?').get(MEMBER) as any;
  assert.equal(Number(rr?.role_confirmed ?? 1), 0,
    'the account reads as already reviewed, so it never reaches the Exploring queue');
  assert.equal(rr?.assigned_role, null);
});

test('the demote tells the account, in its own feed', async () => {
  const db = freshDb();
  const e = env(db);
  await appoint(e);
  await call(app, e, SUPER, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'licence AXL-001 terminated, administrator closed' });
  const mine = db.prepare(
    "SELECT details FROM activity_logs WHERE user_id = ? AND action = 'your_role_changed' ORDER BY id DESC LIMIT 1",
  ).get(MEMBER) as any;
  assert.ok(mine, 'the account was closed and never told');
  assert.match(String(mine.details), /administrator role was removed/);
});

/* ------------------------------------------------------------------ *
 * 4. The demote's refusals, each a way to lock the platform out of itself *
 * ------------------------------------------------------------------ */

test('the super admin cannot demote themselves', async () => {
  const db = freshDb();
  const { status, body } = await call(app, env(db), SUPER, `/users/${SUPER}/demote-admin`, 'POST',
    { reason: 'tidying up my own account this morning' });
  assert.equal(status, 409, 'the holder demoted themselves and left the elevation dangling');
  assert.equal(body?.code, 'cannot_demote_self');
  assert.equal(roleOf(db, SUPER), 'admin');
});

test('the elevation HOLDER cannot be demoted, and the refusal names revoke', async () => {
  const db = freshDb();
  const e = env(db);
  // A second holder, so this is refused for holding the elevation rather than
  // for being the caller. (D133 caps the set at one going forward; a database
  // that predates the cap can carry two, which is exactly when this matters.)
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SPARE_ADMIN);
  const { status, body } = await call(app, e, SUPER, `/users/${SPARE_ADMIN}/demote-admin`, 'POST',
    { reason: 'closing the second holder account today' });
  assert.equal(status, 409);
  assert.equal(body?.code, 'super_admin_holder');
  assert.match(String(body?.error || ''), /super-admins/,
    'the refusal does not name the revoke route');
  assert.equal(roleOf(db, SPARE_ADMIN), 'admin');
});

test('the platform can never be left with no admin, and NOT by a count check', async () => {
  // THE GUARD THIS REPLACES WAS DEAD, and writing this test is how that was
  // found. The first draft refused when `COUNT(*) WHERE role='admin' AND
  // is_active=1 AND id != target` reached zero — the `last_super_admin` floor
  // one tier down. Driving it to zero is impossible: the caller is an active
  // admin by the time the handler runs, and cannot be the target. The attempt
  // below is what proves it — deactivating the caller to shrink the count
  // refuses at AUTHENTICATION, 401, before the handler is entered at all.
  //
  // So the floor holds structurally and the check that claimed to hold it could
  // not fail. It is gone; this is the property it rested on, asserted where it
  // actually lives. If `getCurrentUser` ever stopped refusing an inactive
  // account, this fails — and so would a great deal else.
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SUPER);
  const { status } = await call(app, env(db), SUPER, `/users/${SPARE_ADMIN}/demote-admin`, 'POST',
    { reason: 'closing the final administrator account' });
  assert.equal(status, 401, 'a deactivated super admin was still able to act');
  assert.equal(roleOf(db, SPARE_ADMIN), 'admin');
});

test('a successful demote always leaves the caller administering the platform', async () => {
  // The companion, and the positive form of the invariant above: whatever else
  // the demote does, the account that performed it is still an active admin.
  const db = freshDb();
  const e = env(db);
  await appoint(e);
  const { status } = await call(app, e, SUPER, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'licence AXL-001 terminated, administrator closed' });
  assert.equal(status, 200);
  const left = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE LOWER(role) = 'admin' AND is_active = 1",
  ).get() as any;
  assert.ok(Number(left?.n ?? 0) >= 1, 'the platform was left with nobody able to administer it');
});

test('a demote with a short reason refuses, and a non-admin target is a no-op', async () => {
  const db = freshDb();
  const e = env(db);
  const short = await call(app, e, SUPER, `/users/${SPARE_ADMIN}/demote-admin`, 'POST', { reason: 'no' });
  assert.equal(short.status, 400);
  assert.equal(short.body?.code, 'reason_too_short');
  assert.equal(roleOf(db, SPARE_ADMIN), 'admin');
  // Re-running the first step of a two-step flow must not block the second.
  const again = await call(app, e, SUPER, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'retrying the demote after a dropped connection' });
  assert.equal(again.status, 200);
  assert.equal(again.body?.already, true, 'a repeated demote hard-failed instead of reporting done');
  assert.equal(roleOf(db, MEMBER), 'founder', 'a no-op demote still moved a non-admin account');
});

test('a plain admin cannot demote anybody', async () => {
  const db = freshDb();
  const e = env(db);
  await appoint(e);
  const { status } = await call(app, e, SPARE_ADMIN, `/users/${MEMBER}/demote-admin`, 'POST',
    { reason: 'closing a peer administrator quietly' });
  assert.equal(status, 403, 'one admin silenced another');
  assert.equal(roleOf(db, MEMBER), 'admin');
});

/* ------------------------------------------------------------------ *
 * 5. The role route's two doors stay shut, and now say where to go    *
 * ------------------------------------------------------------------ */

test('PATCH /users/:id/role still refuses to mint or remove an admin, naming the real doors', async () => {
  const db = freshDb();
  const e = env(db);
  const mint = await call(app, e, SUPER, `/users/${MEMBER}/role?role=admin`, 'PATCH', {});
  assert.equal(mint.status, 403);
  assert.equal(mint.body?.code, 'admin_promotion_disabled');
  assert.match(String(mint.body?.error || ''), /licences\/:uid\/admins/,
    'the refusal still sends the operator to a production SQL console');

  const drop = await call(app, e, SUPER, `/users/${SPARE_ADMIN}/role?role=founder`, 'PATCH', {});
  assert.equal(drop.status, 403);
  assert.equal(drop.body?.code, 'admin_demotion_disabled');
  assert.match(String(drop.body?.error || ''), /demote-admin/,
    'the refusal still sends the operator to a production SQL console');
  assert.equal(roleOf(db, SPARE_ADMIN), 'admin');
});

/* ------------------------------------------------------------------ *
 * 6. One write bar, not three copies of it                            *
 * ------------------------------------------------------------------ */

test('the write bar is defined once and checks all three of its steps', () => {
  // A SOURCE ASSERTION ON PURPOSE, because the thing being pinned is that there
  // is ONE definition: the behavioural tests above would pass just as well
  // against three copies, right up until one of them dropped a step.
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const auth = read('cloudflare-worker/src/auth.ts');
  const at = auth.indexOf('export async function requireSuperAdminWriteBar');
  assert.ok(at > 0, 'the shared write bar is gone — re-point this guard rather than deleting it');
  const body = auth.slice(at, at + 400);
  for (const step of ["requireFactor(c, 'totp')", 'requireStepUp(c)', 'requireSuperAdmin(c)']) {
    assert.ok(body.includes(step), `the write bar no longer checks ${step}`);
  }
  for (const f of [
    'cloudflare-worker/src/routes/admin_super_admins.ts',
    'cloudflare-worker/src/routes/admin_licences.ts',
    'cloudflare-worker/src/routes/admin.ts',
  ]) {
    assert.ok(!/^async function requireWriteBar/m.test(read(f)),
      `${f} declares its own copy of the write bar`);
  }
});
