/**
 * D139 — the licence's state machine, and the notices a termination renders moot.
 *
 * TWO THINGS THAT EXISTED ONLY IN PROSE. Migration 187 wrote down what the three
 * statuses mean — `active` trading, `suspended` not trading but still holding
 * its territory, `terminated` over and territory released — and only
 * `reinstate` ever checked. `suspend`, `renew` and `terminate` accepted ANY
 * status, so a terminated licence could be suspended, or renewed onto a future
 * date it will never reach.
 *
 * AND THE LADDER MADE ONE OF THEM URGENT. `auth.ts`'s compliance gate reads
 * `admin_notices` by `user_id` and never consults the licence's status, so after
 * D135 shipped, an `overdue` or `rejected` notice went on freezing an
 * administrator's account after HQ terminated the very licence the notice was
 * about — and answering it could not help, because there was nothing left to
 * comply with. Migration 264 already had the word: `withdrawn`.
 *
 * NOTHING HERE HAS EVER FIRED IN PRODUCTION: it holds zero `territory_licences`
 * and zero `licence_events`. These are latent defects on shipped surfaces, which
 * is why they are cheap now.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/licence_state_machine_d139.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licences from '../src/routes/admin_licences.ts';
import { FREEZING_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const HOLDER = 2;
const LIC = 'lic_d139';

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

/** `licence_events` with the CHECK 266 widened, never a relaxed copy. */
const licenceEventsDdl = () => ddlFrom(
  '266_licence_event_contract.sql', 'CREATE TABLE IF NOT EXISTS licence_events_266',
).replace('licence_events_266', 'licence_events');

/** Migration 264's `admin_notices`, with its own CHECKs. */
const noticesDdl = () => ddlFrom('264_admin_notices.sql', 'CREATE TABLE IF NOT EXISTS admin_notices');

function freshDb({ withNotices = true, status = 'active' } = {}) {
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
      terminated_at TEXT, status_note TEXT, updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal',
      granted_by_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, code TEXT, hostname TEXT, status TEXT);
  `);
  db.exec(licenceEventsDdl());
  if (withNotices) db.exec(noticesDdl());

  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, HOLDER]) {
    db.prepare(
      `INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at)
       VALUES (?, ?, 'totp', 'totp', datetime('now'))`,
    ).run(id, `totp-${id}`);
  }
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status, term_years, renews_on, suspended_at, terminated_at)
     VALUES (?, 'AXL-001', 'Axal VC France SAS', 'Axal VC France', ?, 3, '2027-01-01', ?, ?)`,
  ).run(
    LIC, status,
    status === 'suspended' ? '2026-01-05 09:00:00' : null,
    status === 'terminated' ? '2026-01-05 09:00:00' : null,
  );
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db) });

async function token(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function post(db: any, path: string, body?: any) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token(SUPER)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}

/** A notice in whatever status, stamped in the writer's own SQL format. */
function seedNotice(db: any, uid: string, status: string, licenceId: number | null = 1) {
  db.prepare(
    `INSERT INTO admin_notices (uid, user_id, licence_id, kind, subject, body, issued_by_user_id, respond_by, status, froze_at)
     VALUES (?, ?, ?, 'fees', 'Fee outstanding', 'The Q3 licence fee is outstanding.', ?,
             datetime('now', '-3 days'), ?, datetime('now', '-1 days'))`,
  ).run(uid, HOLDER, licenceId, SUPER, status);
}
const statusOf = (db: any, uid: string) =>
  db.prepare('SELECT status FROM admin_notices WHERE uid = ?').get(uid)?.status;

// ── the state machine ────────────────────────────────────────────────────────

test('a terminated licence cannot be suspended, renewed or terminated again', async () => {
  for (const verb of ['suspend', 'renew', 'terminate']) {
    const db = freshDb({ status: 'terminated' });
    const { status, body } = await post(db, `/${LIC}/${verb}`, { note: 'a reason long enough' });
    assert.equal(status, 409, `${verb} accepted a terminated licence`);
    assert.equal(body.error, 'bad_transition');
    assert.match(String(body.message), /terminated/i);
    // And the ledger is untouched — a refusal that half-wrote would be worse
    // than the transition it refused.
    const row = db.prepare('SELECT status FROM territory_licences WHERE uid = ?').get(LIC) as any;
    assert.equal(row.status, 'terminated');
  }
});

test('an already-suspended licence is not re-suspended, because that would restart its clock', async () => {
  // `suspended_at` is what HQ's Team table and the addressee's own page read as
  // "frozen since". Overwriting it silently is the defect, not the refusal.
  const db = freshDb({ status: 'suspended' });
  const before = (db.prepare('SELECT suspended_at FROM territory_licences WHERE uid = ?').get(LIC) as any).suspended_at;
  const { status, body } = await post(db, `/${LIC}/suspend`, { note: 'a different reason entirely' });
  assert.equal(status, 409);
  assert.match(String(body.message), /already suspended/i);
  const after = (db.prepare('SELECT suspended_at FROM territory_licences WHERE uid = ?').get(LIC) as any).suspended_at;
  assert.equal(after, before, 'the suspended-since clock was restarted by a refused call');
});

test('the transitions a licence CAN make still make them', async () => {
  // The control. A guard that refuses everything passes every refusal test.
  const active = freshDb();
  const s = await post(active, `/${LIC}/suspend`, { note: 'the annual fee is outstanding' });
  assert.equal(s.status, 200, 'a live licence can no longer be suspended');
  assert.equal(s.body.status, 'suspended');

  const suspended = freshDb({ status: 'suspended' });
  const r = await post(suspended, `/${LIC}/reinstate`);
  assert.equal(r.status, 200, 'reinstate broke');

  const renewable = freshDb();
  const n = await post(renewable, `/${LIC}/renew`, {});
  assert.equal(n.status, 200, 'an active licence can no longer be renewed');
  assert.equal(n.body.renews_on, '2030-01-01', 'the term was not added to the current renewal date');
});

test('reinstate keeps its own refusal — the new guard did not replace it', async () => {
  const db = freshDb();  // active, not suspended
  const { status, body } = await post(db, `/${LIC}/reinstate`);
  assert.equal(status, 409);
  assert.match(String(body.error || body.message), /only a suspended licence/i);
});

// ── the notices a termination renders moot ───────────────────────────────────

test('terminating withdraws the open notices against that licence', async () => {
  const db = freshDb();
  seedNotice(db, 'n-issued', 'issued');
  seedNotice(db, 'n-overdue', 'overdue');
  seedNotice(db, 'n-responded', 'responded');
  seedNotice(db, 'n-rejected', 'rejected');
  const { status, body } = await post(db, `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(status, 200);
  assert.equal(body.notices_withdrawn.ok, true);
  assert.equal(body.notices_withdrawn.count, 4);
  for (const uid of ['n-issued', 'n-overdue', 'n-responded', 'n-rejected']) {
    assert.equal(statusOf(db, uid), 'withdrawn', `${uid} still stands against a terminated licence`);
  }
});

test('a closed notice is left exactly as it closed', async () => {
  // Rewriting `accepted` to `withdrawn` would lose which way it closed, and the
  // trail is the point of keeping it.
  const db = freshDb();
  seedNotice(db, 'n-accepted', 'accepted');
  seedNotice(db, 'n-withdrawn', 'withdrawn');
  seedNotice(db, 'n-open', 'overdue');
  const { body } = await post(db, `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(body.notices_withdrawn.count, 1, 'a closed notice was rewritten');
  assert.equal(statusOf(db, 'n-accepted'), 'accepted');
  assert.equal(statusOf(db, 'n-withdrawn'), 'withdrawn');
});

test('another licence\'s notices are not touched', async () => {
  const db = freshDb();
  db.prepare(
    "INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, status) VALUES ('lic_other','AXL-002','Other SAS','active')",
  ).run();
  seedNotice(db, 'n-mine', 'overdue', 1);
  seedNotice(db, 'n-theirs', 'overdue', 2);
  const { body } = await post(db, `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(body.notices_withdrawn.count, 1);
  assert.equal(statusOf(db, 'n-mine'), 'withdrawn');
  assert.equal(statusOf(db, 'n-theirs'), 'overdue', 'a termination reached another licence\'s notices');
});

test('after termination nothing freezes the administrator any more', async () => {
  // The user-visible claim, asserted as the gate itself asks it:
  // `auth.ts` looks for a notice against this USER in a freezing status.
  const db = freshDb();
  seedNotice(db, 'n-freeze', 'overdue');
  const frozenBefore = db.prepare(
    `SELECT COUNT(*) AS n FROM admin_notices WHERE user_id = ? AND status IN (${FREEZING_STATUSES.map(() => '?').join(',')})`,
  ).get(HOLDER, ...FREEZING_STATUSES) as any;
  assert.equal(frozenBefore.n, 1, 'the fixture does not actually freeze anyone');
  await post(db, `/${LIC}/terminate`, { note: 'the agreement has ended' });
  const frozenAfter = db.prepare(
    `SELECT COUNT(*) AS n FROM admin_notices WHERE user_id = ? AND status IN (${FREEZING_STATUSES.map(() => '?').join(',')})`,
  ).get(HOLDER, ...FREEZING_STATUSES) as any;
  assert.equal(frozenAfter.n, 0, 'the administrator is still frozen over a licence that no longer exists');
});

test('a database with no notices table still terminates, and says what it could not do', async () => {
  // Migration 264 not applied. The termination is the thing being asked for; a
  // missing notices table must not fail it, and must not be silent either.
  const db = freshDb({ withNotices: false });
  const { status, body } = await post(db, `/${LIC}/terminate`, { note: 'the agreement has ended' });
  assert.equal(status, 200, 'a missing notices table took the termination down with it');
  assert.equal(body.status, 'terminated');
  assert.equal(body.notices_withdrawn.ok, false);
  assert.match(String(body.notices_withdrawn.reason), /may still be frozen/i);
  const row = db.prepare('SELECT status FROM territory_licences WHERE uid = ?').get(LIC) as any;
  assert.equal(row.status, 'terminated', 'the termination did not land');
});

// ── the event the constraint used to reject ──────────────────────────────────

test('migration 266 admits contract_instantiated and still refuses nonsense', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  db.exec(licenceEventsDdl());
  db.prepare('INSERT INTO territory_licences (id) VALUES (1)').run();
  db.prepare("INSERT INTO licence_events (licence_id, event) VALUES (1, 'contract_instantiated')").run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM licence_events WHERE event = 'contract_instantiated'").get() as any).n,
    1, 'the event the contract route writes is still refused',
  );
  // THE CONSTRAINT SURVIVED THE REBUILD. Dropping it would have "fixed" the
  // route and taken the guard with it — and that guard is the only reason this
  // defect was findable at all.
  assert.throws(
    () => db.prepare("INSERT INTO licence_events (licence_id, event) VALUES (1, 'nonsense')").run(),
    /CHECK constraint failed/,
    'migration 266 dropped the CHECK instead of widening it',
  );
});

test('migration 266 copies the rows it rebuilds around', () => {
  // The table is append-only and empty in production today, so the copy moves
  // nothing NOW. It is asserted with rows anyway: the next database to run this
  // migration may not be empty, and a rebuild that silently dropped the audit
  // trail is the one failure this must not have.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  db.exec(ddlFrom('187_territory_licences.sql', 'CREATE TABLE IF NOT EXISTS licence_events'));
  db.prepare('INSERT INTO territory_licences (id) VALUES (1)').run();
  for (const ev of ['created', 'activated', 'suspended', 'reinstated']) {
    db.prepare(
      "INSERT INTO licence_events (licence_id, event, note, created_at) VALUES (1, ?, ?, '2026-01-01 00:00:00')",
    ).run(ev, `note ${ev}`);
  }
  db.exec(readFileSync(
    resolve(process.cwd(), 'cloudflare-worker/sql/migrations/266_licence_event_contract.sql'), 'utf8',
  ));
  const rows = db.prepare('SELECT event, note, created_at FROM licence_events ORDER BY id').all() as any[];
  assert.equal(rows.length, 4, 'the rebuild lost rows');
  assert.deepEqual(rows.map((r) => r.event), ['created', 'activated', 'suspended', 'reinstated']);
  assert.equal(rows[2].note, 'note suspended', 'a column shifted in the copy');
  assert.equal(rows[0].created_at, '2026-01-01 00:00:00', 'the stamp was rewritten by the copy');
  // 187's index is back, by name.
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_licence_events_licence'").get() as any).n,
    1, 'the rebuild dropped the index and did not recreate it',
  );
});
