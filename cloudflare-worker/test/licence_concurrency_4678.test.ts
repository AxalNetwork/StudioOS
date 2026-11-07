import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licences from '../src/routes/admin_licences.ts';
import { freezeOverdueNotices } from '../src/services/complianceLadder.ts';
import { APPOINTABLE, ENTERS_ACTIVE, FROM, TO, allows, appliedGuard, transition } from '../src/services/licenceTransitions.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const HOLDER = 2;
const LIC = 'lic_4678';
const MEMBER = 3;
const MIGRATION_4678 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611071540_licence_revision.sql'), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
/**
 * A D1 whose reads can be followed by "another request finishing": `afterRead(re, fn)` runs `fn` once, right
 * after the first `.first()`/`.all()` whose SQL matches `re` returns. That is the interleaving the audit
 * describes: this request has read a status, and another one completes before this one writes.
 * `batch` is one transaction, like D1's.
 */
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const hooks: Array<{ re: RegExp; fn: () => void; done: boolean }> = [];
  const fire = (sql: string) => { for (const h of hooks) if (!h.done && h.re.test(sql)) { h.done = true; h.fn(); } };
  const d1: any = {
    afterRead(re: RegExp, fn: () => void) { hooks.push({ re, fn, done: false }); },
    prepare(sql: string) {
      let b: any[] = [];
      const exec = (): any => ({
        meta: (() => { const r = db.prepare(sql).run(...b); return { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) }; })(),
      });
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const r = db.prepare(sql).get(...b) ?? null; fire(sql); return r; },
        async all() { const r = { results: db.prepare(sql).all(...b) }; fire(sql); return r; },
        async run() { return exec(); },
        runSync: exec,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) {
      db.exec('BEGIN');
      try { const out = x.map((st) => st.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return d1;
}

const ERRORS = {
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'HQ only': 403,
} as Record<string, 401 | 403>;
const app = new Hono<any>();
app.route('/', licences);
app.onError((err: any, c) => {
  const s = ERRORS[String(err?.message || '')];
  if (s) return c.json({ detail: err.message, code: err.message }, s);
  throw err;
});

/** One table's CREATE, sliced off the migration that declares it. */
function ddlFrom(file: string, marker: string): string {
  const sql = readFileSync(resolve(process.cwd(), `cloudflare-worker/sql/migrations/${file}`), 'utf8');
  const at = sql.indexOf(marker);
  assert.ok(at > 0, `${file} no longer declares ${marker} — re-point this fixture`);
  const end = sql.indexOf(');', at);
  assert.ok(end > at, `${file}: the CREATE does not terminate`);
  return sql.slice(at, end + 2);
}


/** D4707 — the columns 202611062240 adds to licence_events, from the migration itself. */
const EVENT_CHANGE_COLUMNS = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611062240_licence_event_changes.sql'), 'utf8',
).split('\n').filter((l) => /^ALTER TABLE licence_events ADD COLUMN/.test(l)).join('\n');

/** `licence_events` with the CHECK 266 widened, never a relaxed copy. */
const licenceEventsDdl = () => ddlFrom(
  '266_licence_event_contract.sql', 'CREATE TABLE IF NOT EXISTS licence_events_266',
).replace('licence_events_266', 'licence_events') + '\n' + EVENT_CHANGE_COLUMNS;

/** Migration 264's `admin_notices`, with its own CHECKs. */
const noticesDdl = () => ddlFrom('264_admin_notices.sql', 'CREATE TABLE IF NOT EXISTS admin_notices');


function freshDb({ status = 'active', complete = true, memberRole = 'exploring', accountLicences = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT,
      uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT DEFAULT 'subsidiary',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT UNIQUE, created_at TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER, created_at TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, code TEXT, hostname TEXT, status TEXT);
  `);
  db.exec(licenceEventsDdl());
  db.exec(noticesDdl());
  // The migration under test: the revision column and the triggers, from the file itself.
  db.exec(MIGRATION_4678);
  if (accountLicences) db.exec(readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/202611041822_account_licences.sql'), 'utf8'));

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  u.run(MEMBER, memberRole, 'Mo Member', 'mo@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, HOLDER]) {
    db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))`)
      .run(id, `totp-${id}`);
  }
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, term_years, renews_on, suspended_at, terminated_at, annual_fee_cents, revenue_share_bps)
     VALUES (?, 'AXL-001', 'Axal VC France SAS', 'Axal VC France', ?, 3, ?, ?, ?, ?, ?)`,
  ).run(LIC, status, complete ? '2027-01-01' : null, status === 'suspended' ? '2026-01-05 09:00:00' : null,
    status === 'terminated' ? '2026-01-05 09:00:00' : null, complete ? 100000 : null, complete ? 1000 : null);
  if (complete) {
    db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
    db.prepare("INSERT INTO licence_seats (licence_id, seat_type, seats_licensed) VALUES (1, 'founder', 5)").run();
  }
  return db;
}

type Db = ReturnType<typeof freshDb> & { __d1?: any };
const world = (opts: Parameters<typeof freshDb>[0] = {}) => {
  const raw = freshDb(opts);
  const d1 = makeD1(raw);
  return { raw, d1 };
};
const envOf = (w: { d1: any }) => ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: w.d1 });
async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(w: { d1: any }, method: string, path: string, body?: any) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(SUPER)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, envOf(w));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

const row = (raw: any) => { const r = raw.prepare('SELECT status, revision FROM territory_licences WHERE id = 1').get() as { status: string; revision: number }; return { status: r.status, revision: r.revision }; };
const territories = (raw: any) => Number((raw.prepare('SELECT COUNT(*) AS n FROM licence_territories WHERE licence_id = 1').get() as any).n);
const roleOf = (raw: any, id: number) => (raw.prepare('SELECT role FROM users WHERE id = ?').get(id) as any).role;
const bindings = (raw: any) => Number((raw.prepare('SELECT COUNT(*) AS n FROM licence_admins').get() as any).n);
/** What "another request completed first" does to the row: a real termination, as the route would leave it. */
const terminateBehindTheBack = (raw: any) => () => {
  raw.exec("DELETE FROM licence_territories WHERE licence_id = 1");
  raw.exec("UPDATE territory_licences SET status = 'terminated', terminated_at = datetime('now'), status_note = 'ended', revision = revision + 1 WHERE id = 1");
};
const READ_LICENCE = /FROM territory_licences WHERE uid = \?/;

// ── a stale request loses to a completed termination ─────────────────────────

for (const [verb, from, body] of [
  ['activate', 'draft', undefined],
  ['suspend', 'active', { note: 'the annual fee is outstanding' }],
  ['reinstate', 'suspended', undefined],
  ['renew', 'active', {}],
] as const) {
  test(`a stale ${verb} cannot overwrite a completed termination`, async () => {
    const w = world({ status: from });
    // The blockers (activate, reinstate) are read after the licence; the other request completes after the last of them.
    w.d1.afterRead(verb === 'activate' || verb === 'reinstate' ? /COALESCE\(SUM\(seats_licensed\)/ : READ_LICENCE, terminateBehindTheBack(w.raw));
    const r = await call(w, 'POST', `/${LIC}/${verb}`, body);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, 'licence_changed');
    assert.equal(r.body.current_status, 'terminated');
    assert.equal(row(w.raw).status, 'terminated', 'the termination was reversed');
    assert.equal(territories(w.raw), 0, 'territory came back to a terminated licence');
    assert.equal(w.raw.prepare("SELECT renews_on FROM territory_licences WHERE id = 1").get()?.renews_on, '2027-01-01', 'a stale renew moved the date');
  });
}

test('a stale terminate cannot release the territory of a licence that is active again', async () => {
  const w = world({ status: 'suspended' });
  // Another request reinstates it between this one's read and its write.
  w.d1.afterRead(READ_LICENCE, () => w.raw.exec("UPDATE territory_licences SET status = 'active', suspended_at = NULL, revision = revision + 1 WHERE id = 1"));
  const r = await call(w, 'POST', `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'licence_changed');
  assert.deepEqual(row(w.raw), { status: 'active', revision: 1 });
  assert.equal(territories(w.raw), 1, 'an active licence lost its territory to a termination that did not happen');
});

test('two terminations racing: one wins, the other is a 409, territory is released once', async () => {
  const w = world({ status: 'active' });
  w.d1.afterRead(READ_LICENCE, terminateBehindTheBack(w.raw));
  const r = await call(w, 'POST', `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(r.status, 409);
  assert.deepEqual(row(w.raw), { status: 'terminated', revision: 1 });
});

test('a caller who decided on an older revision is refused before anything is written', async () => {
  const w = world({ status: 'active' });
  const r = await call(w, 'POST', `/${LIC}/suspend?expected_revision=7`, { note: 'the annual fee is outstanding' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'licence_changed');
  assert.equal(r.body.revision, 0);
  assert.equal(row(w.raw).status, 'active');
  const ok = await call(w, 'POST', `/${LIC}/suspend?expected_revision=0`, { note: 'the annual fee is outstanding' });
  assert.equal(ok.status, 200);
  assert.equal((await call(w, 'POST', `/${LIC}/renew?expected_revision=x`, {})).status, 400);
});

test('every move bumps the revision by one, and a sequential walk still works', async () => {
  const w = world({ status: 'draft' });
  assert.equal((await call(w, 'POST', `/${LIC}/activate`)).status, 200);
  assert.deepEqual(row(w.raw), { status: 'active', revision: 1 });
  assert.equal((await call(w, 'POST', `/${LIC}/suspend`, { note: 'the annual fee is outstanding' })).status, 200);
  assert.equal((await call(w, 'POST', `/${LIC}/reinstate`)).status, 200);
  assert.equal((await call(w, 'POST', `/${LIC}/renew`, {})).status, 200);
  assert.deepEqual(row(w.raw), { status: 'active', revision: 4 });
  const t = await call(w, 'POST', `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(t.status, 200);
  assert.deepEqual(row(w.raw), { status: 'terminated', revision: 5 });
  assert.equal(territories(w.raw), 0);
});

// ── terminated is terminal ───────────────────────────────────────────────────

test('terminated is terminal, in the routes and under them', async () => {
  for (const verb of ['activate', 'suspend', 'reinstate', 'renew', 'terminate']) {
    const w = world({ status: 'terminated' });
    const r = await call(w, 'POST', `/${LIC}/${verb}`, { note: 'a reason long enough' });
    assert.ok(r.status === 409, `${verb}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(row(w.raw).status, 'terminated', verb);
  }
  const w = world({ status: 'terminated' });
  assert.throws(() => w.raw.exec("UPDATE territory_licences SET status = 'active' WHERE id = 1"), /licence_terminated/);
  assert.equal(row(w.raw).status, 'terminated');
});

// ── every way into `active` meets the prerequisites ──────────────────────────

test('an incomplete draft cannot become active through suspend and reinstate', async () => {
  const w = world({ status: 'draft', complete: false });
  const s = await call(w, 'POST', `/${LIC}/suspend`, { note: 'the annual fee is outstanding' });
  assert.equal(s.status, 409, 'a draft was suspended');
  assert.equal(row(w.raw).status, 'draft');
  const r = await call(w, 'POST', `/${LIC}/reinstate`);
  assert.equal(r.status, 409);
  assert.equal(row(w.raw).status, 'draft');
  const a = await call(w, 'POST', `/${LIC}/activate`);
  assert.equal(a.status, 409);
  assert.equal(a.body.error, 'blocked');
});

test('a suspended licence that is incomplete is not reinstated into an active one', async () => {
  const w = world({ status: 'suspended', complete: false });
  const r = await call(w, 'POST', `/${LIC}/reinstate`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'blocked');
  assert.ok(r.body.blockers.length >= 3, 'the blockers were not listed');
  assert.equal(row(w.raw).status, 'suspended');
});

test('the prerequisites are checked in SQL as well: territory removed between the check and the write', async () => {
  const w = world({ status: 'suspended' });
  // The blockers pass on what was read; then territory is edited away, which bumps the revision.
  w.d1.afterRead(/SELECT COUNT\(\*\) AS n FROM licence_territories/, () => {
    w.raw.exec("DELETE FROM licence_territories WHERE licence_id = 1");
    w.raw.exec('UPDATE territory_licences SET revision = revision + 1 WHERE id = 1');
  });
  const r = await call(w, 'POST', `/${LIC}/reinstate`);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(row(w.raw).status, 'suspended', 'reinstated without territory');
});

test('editing territory, seats or terms bumps the revision, so an activation on the old one loses', async () => {
  const w = world({ status: 'draft' });
  const before = row(w.raw).revision;
  for (const [m, path, body] of [['PUT', 'territories', { countries: ['FR', 'DE'] }], ['PUT', 'seats', { seats: { founder: 3 } }], ['PATCH', 'terms', { annual_fee_cents: 120000 }]] as const) {
    const r = await call(w, m, `/${LIC}/${path}`, body);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(row(w.raw).revision, before + 3);
});

test('territory and seat edits cannot land on a licence terminated since they were read', async () => {
  const w = world({ status: 'active' });
  w.d1.afterRead(READ_LICENCE, terminateBehindTheBack(w.raw));
  const t = await call(w, 'PUT', `/${LIC}/territories`, { countries: ['FR', 'DE'] });
  assert.ok([200, 409].includes(t.status), `${t.status} ${JSON.stringify(t.body)}`);
  assert.equal(territories(w.raw), 0, 'a terminated licence took territory back');
  const w2 = world({ status: 'active' });
  w2.d1.afterRead(READ_LICENCE, terminateBehindTheBack(w2.raw));
  await call(w2, 'PUT', `/${LIC}/seats`, { seats: { founder: 9 } });
  assert.equal(Number((w2.raw.prepare('SELECT SUM(seats_licensed) AS n FROM licence_seats').get() as any).n), 5, 'seats were rewritten on a terminated licence');
});

test('the compliance sweep bumps the revision, so a reinstate decided before it loses', async () => {
  const w = world({ status: 'active' });
  w.raw.prepare(`INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, issued_by_user_id, respond_by, status)
    VALUES ('n1', ?, 1, 'fees', 'Fee outstanding', 'The Q3 fee is outstanding.', ?, datetime('now', '-3 days'), 'overdue')`).run(HOLDER, SUPER);
  await freezeOverdueNotices(envOf(w) as any, { notify: async () => 1 });
  assert.deepEqual(row(w.raw), { status: 'suspended', revision: 1 });
  const stale = await call(w, 'POST', `/${LIC}/renew?expected_revision=0`, {});
  assert.equal(stale.status, 409);
});

// ── administrator appointment and detachment ─────────────────────────────────

const appoint = (w: any) => call(w, 'POST', `/${LIC}/admins`, { email: 'mo@example.com', reason: 'Appointed as the principal of the licence' });

test('appointment to a terminated licence changes neither the role nor the binding', async () => {
  const w = world({ status: 'terminated' });
  const r = await appoint(w);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'licence_cannot_administer');
  assert.equal(roleOf(w.raw, MEMBER), 'exploring');
  assert.equal(bindings(w.raw), 0);
});

test('an appointment racing a termination leaves no admin without a licence: role and binding both unchanged', async () => {
  const w = world({ status: 'active' });
  w.d1.afterRead(/SELECT id, email, role FROM users/, terminateBehindTheBack(w.raw));
  const r = await appoint(w);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(roleOf(w.raw, MEMBER), 'exploring', 'the account was promoted on a licence that was terminated first');
  assert.equal(bindings(w.raw), 0);
  assert.equal(Number((w.raw.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'role_changed'").get() as any).n), 0, 'an audit line was written for an appointment that did not happen');
});

test('the same race on the retained-primary path (a founder keeps the primary licence)', async () => {
  const w = world({ status: 'active', memberRole: 'founder', accountLicences: true });
  w.raw.prepare("INSERT INTO account_licences (user_id, licence, source, granted_by) VALUES (?, 'founder', 'signup', NULL)").run(MEMBER);
  w.d1.afterRead(/SELECT \* FROM users WHERE id = \?/, terminateBehindTheBack(w.raw));
  const r = await appoint(w);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(roleOf(w.raw, MEMBER), 'founder');
  assert.equal(bindings(w.raw), 0);
});

test('appointment still works on a licence that can administer, and is idempotent', async () => {
  const w = world({ status: 'active' });
  const a = await appoint(w);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(roleOf(w.raw, MEMBER), 'admin');
  assert.equal(bindings(w.raw), 1);
  const again = await appoint(w);
  assert.equal(again.status, 200);
  assert.equal(bindings(w.raw), 1);
});

test('an account bound to another licence is not appointed here, even if the check raced', async () => {
  const w = world({ status: 'active' });
  w.raw.exec("INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, revision) VALUES ('lic_other', 'AXL-002', 'Other SAS', 'Other', 'active', 0)");
  // The check "is this account already bound elsewhere?" passed; then another appointment bound it.
  w.d1.afterRead(/FROM licence_admins la\s+JOIN territory_licences l/, () => {});
  w.d1.afterRead(/SELECT id, email, role FROM users/, () => w.raw.exec("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (2, 3, 'principal')"));
  const r = await appoint(w);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(roleOf(w.raw, MEMBER), 'exploring');
  assert.deepEqual(w.raw.prepare('SELECT licence_id FROM licence_admins WHERE user_id = 3').all().map((x: any) => x.licence_id), [2]);
});

test('detaching races a promotion: the account ends bound and admin, never admin and unbound', async () => {
  const w = world({ status: 'active' });
  w.raw.exec("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, 3, 'principal')");
  // This detach read the account as a non-admin; another request promotes it before the DELETE.
  w.d1.afterRead(/FROM licence_admins la JOIN users u/, () => w.raw.exec("UPDATE users SET role = 'admin' WHERE id = 3"));
  const r = await call(w, 'DELETE', `/${LIC}/admins/${MEMBER}`);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'still_an_admin');
  assert.equal(roleOf(w.raw, MEMBER), 'admin');
  assert.equal(bindings(w.raw), 1, 'an admin was left with no binding');
  // Detaching an account that really is not an admin still works.
  const w2 = world({ status: 'active' });
  w2.raw.exec("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, 3, 'delegate')");
  assert.equal((await call(w2, 'DELETE', `/${LIC}/admins/${MEMBER}`)).status, 200);
  assert.equal(bindings(w2.raw), 0);
});

test('the database refuses a binding on a terminated licence, whatever route made it', () => {
  const w = world({ status: 'terminated' });
  assert.throws(() => w.raw.exec("INSERT INTO licence_admins (licence_id, user_id) VALUES (1, 3)"), /licence_terminated/);
});

test('appoint, detach and terminate in every order end in a valid role + binding state', async () => {
  const orders: Array<Array<'appoint' | 'detach' | 'terminate'>> = [
    ['appoint', 'terminate', 'detach'], ['terminate', 'appoint', 'detach'], ['appoint', 'detach', 'terminate'], ['detach', 'appoint', 'terminate'],
  ];
  for (const order of orders) {
    const w = world({ status: 'active' });
    for (const step of order) {
      if (step === 'appoint') await appoint(w);
      else if (step === 'detach') {
        // The route's own order: demote, then detach.
        if (roleOf(w.raw, MEMBER) === 'admin') w.raw.exec("UPDATE users SET role = 'exploring' WHERE id = 3");
        await call(w, 'DELETE', `/${LIC}/admins/${MEMBER}`);
      } else await call(w, 'POST', `/${LIC}/terminate`, { note: 'the agreement has ended' });
    }
    const admins = w.raw.prepare("SELECT id FROM users WHERE role = 'admin' AND id = 3").all();
    const bound = bindings(w.raw);
    assert.ok(!(admins.length > 0 && bound === 0), `${order.join(' > ')}: an admin with no binding`);
    if (row(w.raw).status === 'terminated') assert.equal(admins.length, 0, `${order.join(' > ')}: a terminated licence still has an admin`);
  }
});

// ── the state machine itself, and the floor under the routes ─────────────────

test('the table: terminated starts nothing, only an active licence is suspended, and the ways into active are the two that re-check', () => {
  for (const [verb, from] of Object.entries(FROM)) assert.ok(!from.includes('terminated'), `${verb} can start from terminated`);
  assert.deepEqual([...FROM.suspend], ['active']);
  assert.deepEqual([...FROM.reinstate], ['suspended']);
  assert.deepEqual([...FROM.activate], ['draft', 'pending_activation']);
  assert.deepEqual(Object.entries(TO).filter(([, to]) => to === 'active').map(([v]) => v).sort(), ['activate', 'reinstate']);
  assert.deepEqual([...ENTERS_ACTIVE].sort(), ['activate', 'reinstate']);
  assert.ok(!allows('suspend', 'draft') && !allows('activate', 'terminated') && allows('terminate', 'suspended'));
  assert.ok(!APPOINTABLE.includes('terminated') && APPOINTABLE.includes('active') && APPOINTABLE.includes('draft'));
});

test('the SQL re-checks the prerequisites even when the revision was not bumped', async () => {
  const w = world({ status: 'suspended' });
  // A territory removed by a writer that does not bump the revision (an older deployment, a manual repair).
  w.raw.exec('DELETE FROM licence_territories WHERE licence_id = 1');
  const held = { id: 1, status: 'suspended', revision: 0 };
  const r = await transition(envOf(w) as any, held, 'reinstate', { now: new Date().toISOString() });
  assert.equal(r.ok, false);
  assert.equal(row(w.raw).status, 'suspended');
  const ok = world({ status: 'suspended' });
  assert.equal((await transition(envOf(ok) as any, { id: 1, status: 'suspended', revision: 0 }, 'reinstate', { now: new Date().toISOString() })).ok, true);
});

test('a move the table does not allow is refused without touching the database', async () => {
  const w = world({ status: 'draft' });
  const r = await transition(envOf(w) as any, { id: 1, status: 'draft', revision: 0 }, 'suspend', { note: 'x', now: new Date().toISOString() });
  assert.deepEqual(r, { ok: false, code: 'bad_transition', current: { status: 'draft', revision: 0 } });
  assert.deepEqual(row(w.raw), { status: 'draft', revision: 0 });
});

test('statements after a move run only if that move applied, even when another request left the same revision', async () => {
  const w = world({ status: 'suspended' });
  // Another request reinstated it first: revision 1, active. A terminate that read revision 0 would also "become" revision 1.
  w.raw.exec("UPDATE territory_licences SET status = 'active', revision = 1 WHERE id = 1");
  const guard = appliedGuard(1, 1, 'terminated');
  const r = await transition(envOf(w) as any, { id: 1, status: 'suspended', revision: 0 }, 'terminate', {
    note: 'ended', now: new Date().toISOString(),
    after: [w.d1.prepare(`DELETE FROM licence_territories WHERE licence_id = ? AND ${guard.sql}`).bind(1, ...guard.binds)],
  });
  assert.equal(r.ok, false);
  assert.equal(territories(w.raw), 1);
});
