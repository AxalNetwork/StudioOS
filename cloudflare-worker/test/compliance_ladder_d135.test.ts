/**
 * D135 — the compliance ladder: notices, the freeze, and the clock that sets it.
 *
 * THE REQUIREMENT, in the owner's words: "first admins get notified; if admins
 * do not act on notifications, admin accounts are frozen until they act on
 * things from what they have been notified; and lastly if they don't comply
 * admin accounts are terminated."
 *
 * WHY THE SWEEP GETS THE SIX SHAPES FROM `support_session_close_d122.test.ts`.
 * A deadline swept against the clock is exactly the defect class that file was
 * written for, and this one adds a second failure mode it did not have: the
 * sweep performs TWO writes (the notice flip and the licence suspend), so
 * "idempotent" has to be proved for each of them separately, and the second has
 * to be shown to RETRY after a first pass that only managed the first.
 *
 * FIXTURE ROWS ARE AGED IN THE WRITER'S OWN FORMAT — `datetime('now','-N
 * minutes')`, never an ISO string. Aging them in ISO proves only that the test
 * and the fixture agree, which is how a mutation escaped on #588.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/compliance_ladder_d135.test.ts
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
import licence from '../src/routes/licence.ts';
import { freezeOverdueNotices, freezeHoldersForLicence } from '../src/services/complianceLadder.ts';
import { FREEZING_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;   // HQ
const HOLDER = 2;  // the subsidiary admin the notices are addressed to
const OTHER = 3;   // another admin, never addressed — the control
const LIC = 'lic_d135';

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
    async batch(x: any[]) { const out = []; for (const st of x || []) out.push(await st.run()); return out; },
  };
}

const ERRORS = {
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403,
  'HQ only': 403, 'TOTP required': 403, step_up_required: 403, admin_frozen: 423,
} as Record<string, 401 | 403 | 423>;

function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const s = ERRORS[String(err?.message || '')];
    if (s) return c.json({ detail: err.message, code: err.message, notice: err.notice ?? null }, s);
    throw err;
  });
  return a;
}
const app = appFor(admin);
const lic = appFor(licences);
const mine = appFor(licence);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      -- The profile drawer's own SELECT names these. A fixture narrower than the
      -- handler fails on the schema BEFORE reaching the gate under test, which
      -- is a refusal for the wrong reason and proves nothing (the D133 lesson).
      uid TEXT, email_verified INTEGER, founder_id INTEGER, partner_id INTEGER,
      kyc_status TEXT, kyc_provider TEXT, kyc_submitted_at TEXT, kyc_reviewed_at TEXT,
      kyc_rejection_reason TEXT, admin_notes TEXT, founder_public_id TEXT,
      partner_public_id TEXT, last_active_at TEXT, created_at TEXT
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
    -- The CHECK is migration 187's, copied rather than relaxed: a fixture that
    -- admits any event value cannot fail on an event the real constraint
    -- rejects, which is how a live violation stayed invisible one route over.
    CREATE TABLE licence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('created','territory_changed','seats_changed',
                                           'terms_changed','activated','suspended',
                                           'reinstated','renewed','terminated')),
      detail_json TEXT, note TEXT, actor_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
  `);
  // Migration 264's own DDL, sliced from the file rather than retyped, so the
  // fixture cannot drift from the table the code will actually meet.
  db.exec(noticesDdl());
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  u.run(OTHER, 'admin', 'Otto', 'otto@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, HOLDER, OTHER]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  db.prepare(
    "INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,'active')",
  ).run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  return db;
}

/** Migration 264's CREATE TABLE, read off disk. */
function noticesDdl(): string {
  const sql = readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/264_admin_notices.sql'), 'utf8',
  );
  const at = sql.indexOf('CREATE TABLE IF NOT EXISTS admin_notices');
  assert.ok(at > 0, 'migration 264 no longer creates admin_notices — re-point this fixture');
  return sql.slice(at);
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  a: any, e: any, actor: number, path: string, method = 'GET', body?: any,
): Promise<{ status: number; body: any }> {
  const res = await a.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(actor)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

/** Seed a notice directly, aged in the WRITER's format. */
function seedNotice(
  db: any,
  { uid = 'n1', user = HOLDER, licenceId = 1 as number | null, status = 'issued', dueIn = '+7 days' } = {},
) {
  db.prepare(
    `INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, issued_by_user_id, respond_by, status)
     VALUES (?, ?, ?, 'fees', ?, 'The Q3 licence fee is outstanding.', ?, datetime('now', ?), ?)`,
  ).run(uid, user, licenceId, `Fee outstanding ${uid}`, SUPER, dueIn, status);
}

const noticeRow = (db: any, uid: string) =>
  db.prepare('SELECT * FROM admin_notices WHERE uid = ?').get(uid) as any;
const licStatus = (db: any) =>
  String((db.prepare('SELECT status FROM territory_licences WHERE id = 1').get() as any)?.status ?? '');

// THE PROBES, and picking them correctly is not incidental. The freeze gate is
// method-dependent, so the write probe must be a route that actually ACCEPTS a
// write: the first version of this file PATCHed `/users/:id/profile`, which is
// GET-only, so Hono answered 404 before `requireAdmin` ran and four assertions
// passed against a gate they never reached. `toggle-active` is a real PATCH and
// `profile` is the real GET — one route each, both behind `requireAdmin`.
const WRITE_PROBE = (id: number) => `/users/${id}/toggle-active`;
const READ_PROBE = (id: number) => `/users/${id}/profile`;

/* ------------------------------------------------------------------ *
 * 1. The sweep — the six shapes, plus the two this one needs          *
 * ------------------------------------------------------------------ */

test('a past-deadline notice is frozen, and froze_at is the DEADLINE not the sweep clock', async () => {
  const db = freshDb();
  seedNotice(db, { dueIn: '-31 minutes' });
  const r = await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(r.due, 1);
  assert.equal(r.froze, 1);
  const n = noticeRow(db, 'n1');
  assert.equal(n.status, 'overdue');
  // EXACTLY the deadline. Stamping `datetime('now')` would record the freeze up
  // to a cadence-interval late and make the audit untrue in the one direction
  // that flatters the operator — the D122 rule.
  assert.equal(n.froze_at, n.respond_by,
    'froze_at is the sweep\'s own clock, so the cadence changes what the row says');
});

test('a notice still inside its window is untouched', async () => {
  const db = freshDb();
  seedNotice(db, { dueIn: '+7 days' });
  const r = await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(r.due, 0);
  assert.equal(noticeRow(db, 'n1').status, 'issued', 'a live notice was frozen early');
  assert.equal(licStatus(db), 'active');
});

test('each WHERE conjunct on its own: a RESPONDED row past its deadline is not frozen', async () => {
  // The status conjunct, exercised alone. Without it the sweep would freeze an
  // account that answered — punishing exactly the behaviour the ladder wants.
  const db = freshDb();
  seedNotice(db, { status: 'responded', dueIn: '-31 minutes' });
  const r = await freezeOverdueNotices(env(db), { notify: async () => 1 });
  // `due` AND `froze`, and the first of the two is what makes this assertion
  // able to fail. A mutation that widened the SELECT to admit `responded` rows
  // escaped a `froze === 0` check, because the flip's own `status = 'issued'`
  // conjunct still refused them — the outcome was right for the other reason.
  // The reported count is where the SELECT's conjunct is observable.
  assert.equal(r.due, 0, 'the sweep selected a notice that had already been answered');
  assert.equal(r.froze, 0);
  assert.equal(noticeRow(db, 'n1').status, 'responded');
});

test('an already-overdue row is not re-frozen, and sweeping twice does nothing the second time', async () => {
  const db = freshDb();
  const e = env(db);
  seedNotice(db, { dueIn: '-31 minutes' });
  let sent = 0;
  const notify = async () => { sent += 1; return 1; };
  const first = await freezeOverdueNotices(e, { notify });
  const second = await freezeOverdueNotices(e, { notify });
  assert.equal(first.froze, 1);
  assert.equal(second.due, 0, 'the second pass found the row again');
  assert.equal(second.froze, 0);
  assert.equal(sent, 1, 'the addressee was told twice about one freeze');
});

test('two sweeps racing flip the row once — the conditional UPDATE is the claim', async () => {
  // THE ONLY PLACE THIS CONJUNCT IS OBSERVABLE, and finding that out took a
  // mutation. Removing `AND status = 'issued'` from the flip escaped every
  // sequential test, because the next pass's SELECT no longer returns the row
  // at all — the two conjuncts are each independently sufficient when nothing
  // is racing, so neither can be killed while the other stands.
  //
  // They are not redundant in production: two isolates can run the sweep in the
  // same minute, both SELECT the row while it is still `issued`, and only the
  // conditional UPDATE decides which of them owns the transition. `changes === 1`
  // is what makes the notification fire exactly once without a ledger table.
  // Interleaving two calls over one database is the smallest honest way to say
  // so, and it fails the moment the conjunct is dropped.
  const db = freshDb();
  const e = env(db);
  seedNotice(db, { dueIn: '-31 minutes' });
  let sent = 0;
  const notify = async () => { sent += 1; return 1; };
  const [a, b] = await Promise.all([
    freezeOverdueNotices(e, { notify }),
    freezeOverdueNotices(e, { notify }),
  ]);
  assert.equal(a.due + b.due, 2, 'the two passes did not actually race — re-point this test');
  assert.equal(a.froze + b.froze, 1, 'both passes claimed the same notice');
  assert.equal(sent, 1, 'the addressee was told twice that one notice froze them');
});

test('a missing table reads UNREADABLE, not a cheerful zero', async () => {
  const db = freshDb();
  db.exec('DROP TABLE admin_notices');
  const r = await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(r.readable, false, 'a missing store reported "no notices are due"');
  assert.equal(r.froze, 0);
});

test('the freeze suspends the licence and writes a licence_event the CHECK admits', async () => {
  const db = freshDb();
  seedNotice(db, { dueIn: '-31 minutes' });
  await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(licStatus(db), 'suspended', 'the notice froze but the licence kept trading');
  const ev = db.prepare("SELECT event, note FROM licence_events ORDER BY id DESC LIMIT 1").get() as any;
  assert.equal(ev?.event, 'suspended');
  assert.match(String(ev?.note || ''), /not answered by its deadline/);
});

test('the suspend RETRIES on a later pass — it is driven by the notice, not by the flip', async () => {
  // The failure this shape exists for: a pass that flipped the notice and then
  // failed to suspend would never be retried if the suspend were conditional on
  // the flip, and the account would read frozen while its licence still traded.
  const db = freshDb();
  seedNotice(db, { status: 'overdue', dueIn: '-31 minutes' });
  const r = await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(r.froze, 0, 'an already-overdue row was flipped again');
  assert.equal(r.suspended, 1, 'the suspend did not retry for a notice already overdue');
  assert.equal(licStatus(db), 'suspended');
});

test('the sweep NEVER terminates, whatever the deadline says', async () => {
  const db = freshDb();
  seedNotice(db, { dueIn: '-400 days' });
  await freezeOverdueNotices(env(db), { notify: async () => 1 });
  assert.equal(licStatus(db), 'suspended',
    'a clock ended an account — termination is a deliberate act, never automatic');
  assert.equal(
    Number((db.prepare("SELECT COUNT(*) AS n FROM licence_territories").get() as any)?.n ?? 0), 0,
  );
});

/* ------------------------------------------------------------------ *
 * 2. The freeze gate                                                  *
 * ------------------------------------------------------------------ */

test('a frozen admin\'s WRITE refuses 423 and names the notice', async () => {
  const db = freshDb();
  seedNotice(db, { status: 'overdue' });
  const { status, body } = await call(app, env(db), HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.equal(status, 423, 'a frozen admin wrote anyway');
  assert.equal(body?.code, 'admin_frozen');
  assert.equal(body?.notice?.uid, 'n1',
    'the 423 does not say which notice froze them, so there is nothing to act on');
});

test('the same admin\'s READ passes — reads are never gated', async () => {
  // The control, and the sharpest one: an admin who cannot SEE what they were
  // asked cannot do the thing that lifts the freeze.
  const db = freshDb();
  seedNotice(db, { status: 'overdue' });
  const { status } = await call(app, env(db), HOLDER, READ_PROBE(OTHER), 'GET');
  assert.notEqual(status, 423, 'the freeze gated a read');
});

test('an ISSUED notice inside its window freezes nothing', async () => {
  // The rung BEFORE the freeze. Collapsing the two would make "first admins get
  // notified" meaningless.
  const db = freshDb();
  seedNotice(db, { status: 'issued', dueIn: '+7 days' });
  const { status } = await call(app, env(db), HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.notEqual(status, 423, 'being notified was treated as being frozen');
});

test('the super admin is never frozen by the ladder they run', async () => {
  const db = freshDb();
  seedNotice(db, { user: SUPER, status: 'overdue' });
  const { status } = await call(app, env(db), SUPER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.notEqual(status, 423, 'HQ froze itself and can now lift nobody');
});

test('an unreadable admin_notices is NOT a freeze', async () => {
  // A database between deploy and migration must not freeze every admin —
  // exactly when somebody is trying to work. `requireBranchNotSuspended` makes
  // the same call for the same reason.
  const db = freshDb();
  db.exec('DROP TABLE admin_notices');
  const { status } = await call(app, env(db), HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.notEqual(status, 423, 'a missing table froze the whole tier');
});

/* ------------------------------------------------------------------ *
 * 3. Issue, respond, review                                           *
 * ------------------------------------------------------------------ */

const issue = (e: any, over: any = {}) =>
  call(lic, e, SUPER, `/${LIC}/notices`, 'POST', {
    email: 'hana@axal.example', kind: 'fees',
    subject: 'Q3 licence fee outstanding',
    body: 'The Q3 fee has not been received. Please settle it or tell us when you will.',
    respond_days: 14, ...over,
  });

test('HQ issues a notice, and respond_by is SQL format written by the database', async () => {
  const db = freshDb();
  const { status, body } = await issue(env(db));
  assert.equal(status, 200, `issue refused: ${JSON.stringify(body)}`);
  const n = db.prepare('SELECT * FROM admin_notices LIMIT 1').get() as any;
  assert.equal(n.status, 'issued');
  // 'YYYY-MM-DD HH:MM:SS' — NOT an ISO string. An ISO value compared against
  // datetime('now') is always the greater one, so the deadline would not bite
  // until the UTC date rolled over.
  assert.match(String(n.respond_by), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    'respond_by was written as an ISO string, so the sweep will not fire on time');
});

test('a notice cannot be sent to somebody who does not administer that licence', async () => {
  const db = freshDb();
  const { status, body } = await issue(env(db), { email: 'otto@axal.example' });
  assert.equal(status, 404);
  assert.equal(body?.code, 'not_an_administrator');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM admin_notices').get() as any).n), 0);
});

test('a notice needs a body, and a bad kind is refused', async () => {
  const db = freshDb();
  const short = await issue(env(db), { body: 'pay up' });
  assert.equal(short.status, 400);
  assert.equal(short.body?.code, 'body_too_short');
  const bad = await issue(env(db), { kind: 'vibes' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body?.code, 'bad_kind');
  assert.equal(Number((db.prepare('SELECT COUNT(*) AS n FROM admin_notices').get() as any).n), 0);
});

test('the addressee can answer, and answering lifts the freeze', async () => {
  const db = freshDb();
  const e = env(db);
  seedNotice(db, { status: 'overdue' });
  const before = await call(app, e, HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.equal(before.status, 423);
  const r = await call(mine, e, HOLDER, '/notices/n1/respond', 'POST',
    { response: 'Paid this morning, reference AX-88213.' });
  assert.equal(r.status, 200, `respond refused: ${JSON.stringify(r.body)}`);
  assert.equal(noticeRow(db, 'n1').status, 'responded');
  const after = await call(app, e, HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.notEqual(after.status, 423,
    'an admin who did what they were asked is still frozen while HQ reads it');
});

test('a notice addressed to somebody else answers 404, not 403', async () => {
  // 403 would confirm the notice exists. The ownership is in the WHERE.
  const db = freshDb();
  seedNotice(db, { user: HOLDER, status: 'overdue' });
  const { status } = await call(mine, env(db), OTHER, '/notices/n1/respond', 'POST',
    { response: 'Nothing to do with me at all.' });
  assert.equal(status, 404);
  assert.equal(noticeRow(db, 'n1').status, 'overdue');
});

test('a short response is refused and writes nothing', async () => {
  const db = freshDb();
  seedNotice(db, { status: 'issued' });
  const { status, body } = await call(mine, env(db), HOLDER, '/notices/n1/respond', 'POST', { response: 'ok' });
  assert.equal(status, 400);
  assert.equal(body?.code, 'response_too_short');
  assert.equal(noticeRow(db, 'n1').response, null);
});

test('HQ cannot review a notice nobody has answered', async () => {
  const db = freshDb();
  seedNotice(db, { status: 'overdue' });
  const { status, body } = await call(lic, env(db), SUPER, `/${LIC}/notices/n1/review`, 'POST', { decision: 'accept' });
  assert.equal(status, 409);
  assert.equal(body?.code, 'not_responded',
    'a click by the person who owes the fee became HQ\'s acceptance of it');
});

test('accepting the LAST holder reinstates the licence; accepting one of two does not', async () => {
  const db = freshDb();
  const e = env(db);
  seedNotice(db, { uid: 'n1', status: 'responded' });
  seedNotice(db, { uid: 'n2', status: 'overdue' });
  db.prepare("UPDATE territory_licences SET status = 'suspended' WHERE id = 1").run();
  const one = await call(lic, e, SUPER, `/${LIC}/notices/n1/review`, 'POST', { decision: 'accept' });
  assert.equal(one.status, 200);
  assert.equal(one.body?.reinstated, false, 'one accepted notice lifted a freeze two were holding');
  assert.equal(licStatus(db), 'suspended');

  db.prepare("UPDATE admin_notices SET status = 'responded' WHERE uid = 'n2'").run();
  const two = await call(lic, e, SUPER, `/${LIC}/notices/n2/review`, 'POST', { decision: 'accept' });
  assert.equal(two.status, 200);
  assert.equal(two.body?.reinstated, true, 'the last outstanding notice was accepted and nothing lifted');
  assert.equal(licStatus(db), 'active');
});

test('rejecting freezes again, and freezeHoldersForLicence counts it', async () => {
  const db = freshDb();
  const e = env(db);
  seedNotice(db, { status: 'responded' });
  const r = await call(lic, e, SUPER, `/${LIC}/notices/n1/review`, 'POST',
    { decision: 'reject', note: 'No payment has reached the account.' });
  assert.equal(r.status, 200);
  assert.equal(noticeRow(db, 'n1').status, 'rejected');
  assert.equal(await freezeHoldersForLicence(e as any, 1), 1);
  const w = await call(app, e, HOLDER, WRITE_PROBE(OTHER), 'PATCH', {});
  assert.equal(w.status, 423, 'a rejected response left the account able to write');
});

/* ------------------------------------------------------------------ *
 * 4. The two guards that keep the pieces honest                       *
 * ------------------------------------------------------------------ */

test('the gate binds one placeholder per freezing status', () => {
  // `check-sql-prepare` refuses a generated placeholder list, so the `(?, ?)` is
  // literal — which means adding a third status without widening the SQL would
  // silently under-bind. The tuple type catches it at compile time; this catches
  // it if somebody widens the type and forgets the query.
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/auth.ts'), 'utf8');
  const at = src.indexOf('FROM admin_notices');
  assert.ok(at > 0, 'the freeze gate no longer reads admin_notices — re-point this guard');
  const clause = src.slice(at, at + 200);
  const m = clause.match(/status IN \(([^)]*)\)/);
  assert.ok(m, 'the gate stopped filtering on status');
  assert.equal(m![1].split(',').length, FREEZING_STATUSES.length,
    'the gate binds a different number of statuses than FREEZING_STATUSES has');
});

test('respond_by is watched by the timestamp guard, and the sweep wraps it', () => {
  // The guard has NO allowlist by design, so a deadline column outside its list
  // is a column nobody is watching. Adding the name there and the column here in
  // one commit is what keeps that true.
  const guard = readFileSync(resolve(process.cwd(), 'scripts/check-timestamp-comparisons.mjs'), 'utf8');
  assert.match(guard, /TTL_COLUMN = '\(\?:[^']*respond_by[^']*\)'/,
    'respond_by is not in TTL_COLUMN, so its comparisons are unguarded');
  const svc = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/services/complianceLadder.ts'), 'utf8');
  assert.match(svc, /datetime\(respond_by\)\s*<=\s*datetime\('now'\)/,
    'the sweep compares respond_by without normalising it');
});
