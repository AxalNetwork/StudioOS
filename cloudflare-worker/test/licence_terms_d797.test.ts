/**
 * D797 (#2230) — a licence's terms schedule: HQ writes it, the Administrator
 * reads it, and the branch copy carries it.
 *
 * WHAT IS PINNED.
 *   · A Super Admin with a TOTP session and a fresh step-up saves the terms and
 *     reads them back; a plain admin is refused, and so is a stale step-up.
 *   · A bad enum, a bps over 10000, negative days, an unknown key and a missing
 *     reason are refused, each naming the field.
 *   · `null` clears a term, and a key the save leaves out keeps its value.
 *   · Every save appends exactly one `terms_changed` event, with its reason and
 *     each changed key's before and after.
 *   · `/mine` returns the caller's own licence's terms, for a principal and a
 *     delegate alike, and another licence's never; no terms read `null` with a
 *     reason, never zeros.
 *   · The push carries the terms, the branch writes them beside its copy, and
 *     a copy pushed without them reads `null` with "not pushed yet".
 *   · Migration 512's CHECKs refuse what the route refuses.
 *
 * `licence_terms` and the branch column are read from MIGRATION 512, never
 * hand-copied, so a column renamed there breaks this suite instead of passing it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_terms_d797.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import licences from '../src/routes/admin_licences.ts';
import licence from '../src/routes/licence.ts';
import { assembleLicenceRecord } from '../src/services/licencePush.ts';
import { applyLicenceCopy } from '../src/rpc/branchOps.ts';
import { LICENCE_TERM_FIELDS, LICENCE_TERM_KEYS, TERMS_REASON, validateTermsBody } from '../src/services/licenceTerms.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const HOLDER = 2;
const DELEGATE = 3;
const OTHER = 4;
const LIC = 'lic_d797';
const LIC2 = 'lic_d797_b';
const MIGRATION = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/512_licence_terms.sql'), 'utf8');
const TERMS_DDL = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS licence_terms'), MIGRATION.indexOf('\n);', MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS licence_terms')) + 3);
const BRANCH_ALTER = MIGRATION.slice(MIGRATION.indexOf('ALTER TABLE branch_licence'), MIGRATION.indexOf(';', MIGRATION.indexOf('ALTER TABLE branch_licence')) + 1);

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
  Unauthorized: 401, 'Admin required': 403, 'Super admin required': 403, 'TOTP required': 403, step_up_required: 403,
} as Record<string, 401 | 403>;
function appFor(router: any, base: string) {
  const a = new Hono<any>();
  a.route(base, router);
  a.onError((err: any, c) => {
    const s = ERRORS[String(err?.message || '')];
    if (s) return c.json({ detail: err.message, code: err.message }, s);
    throw err;
  });
  return a;
}
const hq = appFor(licences, '/admin/licences');
const mineApp = appFor(licence, '/licence');

const BRANCH_LICENCE = `CREATE TABLE branch_licence (
    id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL, licence_ref TEXT,
    legal_entity TEXT, brand_name TEXT,
    territory TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', seats_json TEXT,
    revenue_share_bps INTEGER, token_split_bps INTEGER, annual_fee_cents INTEGER,
    currency TEXT, term_start TEXT, term_end TEXT,
    renewal_at TEXT, template_version TEXT, suspended_at TEXT, suspended_note TEXT,
    registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
    term_years INTEGER, terminated_at TEXT, kind TEXT,
    pushed_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`;

function freshDb({ terms = true }: { terms?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, name TEXT, email TEXT, uid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE super_admins (user_id INTEGER PRIMARY KEY, granted_by_user_id INTEGER, granted_at TEXT, note TEXT);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, jti TEXT, factor TEXT,
      assurance_level TEXT, revoked_at TEXT, step_up_due_at TEXT, last_seen_at TEXT, last_step_up_at TEXT,
      created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT,
      user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE admin_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT,
      viewed_user_id INTEGER, filters_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE territory_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, licence_ref TEXT, entity_id INTEGER,
      legal_entity_name TEXT, brand_name TEXT, registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
      status TEXT NOT NULL DEFAULT 'active', term_years INTEGER, annual_fee_cents INTEGER, currency TEXT,
      revenue_share_bps INTEGER, token_split_bps INTEGER, starts_on TEXT, renews_on TEXT, suspended_at TEXT,
      terminated_at TEXT, status_note TEXT, updated_at TEXT, kind TEXT NOT NULL DEFAULT 'subsidiary',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL UNIQUE, admin_role TEXT NOT NULL DEFAULT 'principal', granted_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, country_code TEXT);
    CREATE TABLE licence_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER, seat_type TEXT, seats_licensed INTEGER);
    CREATE TABLE licence_contracts (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, template_version INTEGER);
    CREATE TABLE licence_events (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_id INTEGER NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('created', 'territory_changed', 'seats_changed', 'terms_changed', 'activated',
                                           'suspended', 'reinstated', 'renewed', 'terminated')),
      detail_json TEXT, note TEXT, actor_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE licence_domains (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT, hostname TEXT, status TEXT);
    CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT UNIQUE, code TEXT,
      hostname TEXT, status TEXT, status_note TEXT);
  `);
  if (terms) db.exec(TERMS_DDL);
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?,?,?,?)');
  u.run(SUPER, 'admin', 'Sue', 'sue@axal.example');
  u.run(HOLDER, 'admin', 'Hana', 'hana@axal.example');
  u.run(DELEGATE, 'admin', 'Dev', 'dev@axal.example');
  u.run(OTHER, 'admin', 'Otto', 'otto@axal.example');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const id of [SUPER, HOLDER, DELEGATE, OTHER]) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))")
      .run(id, `totp-${id}`);
  }
  const lic = db.prepare("INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, status) VALUES (?,?,?,?,'active')");
  lic.run(LIC, 'AXL-001', 'Axal VC France SAS', 'Axal VC France');
  lic.run(LIC2, 'AXL-002', 'Nordics Holdings AB', 'Axal VC Nordics');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(HOLDER);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'delegate')").run(DELEGATE);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (2, ?, 'principal')").run(OTHER);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.vc', DB: makeD1(db), ...extra });

async function call(a: any, e: any, actor: number, path: string, method = 'GET', body?: unknown) {
  const tok = await new SignJWT({ user_id: actor, role: 'admin', jti: `totp-${actor}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await a.request(path, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, e);
  let out: any = null;
  try { out = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: out };
}
const save = (e: any, body: unknown, actor = SUPER, uid = LIC) => call(hq, e, actor, `/admin/licences/${uid}/terms`, 'PUT', body);
const events = (db: any) => db.prepare("SELECT event, detail_json, note, actor_user_id FROM licence_events WHERE event = 'terms_changed' ORDER BY id").all();

const TERMS = {
  licensor_entity: 'holdings', governing_law: 'Delaware', exclusive: true, renewal_mode: 'auto',
  non_renewal_notice_days: 90, cure_days: 30, carry_share_bps: 2000, minimum_guarantee_cents: 2_500_000,
  usage_report_day: 5, statement_period: 'quarter', data_role: 'licensee_controller', audit_right: false,
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('a Super Admin saves the terms and reads them back; every other key reads null', async () => {
  // Mutations checked: a term dropped from the upsert; a boolean stored as true/false text.
  const db = freshDb();
  const r = await save(env(db), { terms: TERMS, sections: { carry_share_bps: '§7.3' }, reason: 'Signed 2026-10-20' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const back = await call(hq, env(db), SUPER, `/admin/licences/${LIC}/terms`);
  assert.equal(back.status, 200);
  const want = Object.fromEntries(LICENCE_TERM_KEYS.map((k) => [k, null]));
  Object.assign(want, { ...TERMS, exclusive: 1, audit_right: 0 });
  assert.deepEqual(back.body.terms, want);
  assert.deepEqual(back.body.sections, { carry_share_bps: '§7.3' });
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('a plain admin\'s PUT is refused, and so is a Super Admin whose step-up has gone stale', async () => {
  // Mutations checked: requireSuperAdminWriteBar replaced by requireSuperAdmin; by requireAdmin.
  const db = freshDb();
  const plain = await save(env(db), { terms: TERMS, reason: 'r' }, HOLDER);
  assert.equal(plain.status, 403);
  db.prepare("UPDATE user_sessions SET created_at = datetime('now','-3 hours') WHERE user_id = ?").run(SUPER);
  const stale = await save(env(db), { terms: TERMS, reason: 'r' });
  assert.equal(stale.status, 403);
  assert.equal(stale.body?.code, 'step_up_required');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_terms').get().n, 0, 'a refused save wrote');
  assert.equal(events(db).length, 0);
  assert.equal((await call(hq, env(db), HOLDER, `/admin/licences/${LIC}/terms`)).status, 403, 'a plain admin read HQ\'s copy');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('a bad enum, a bps over 10000, negative days, an unknown key and no reason are refused, naming the field', async () => {
  // Mutations checked: the bps ceiling removed; the days floor removed; unknown keys ignored; the reason optional.
  const db = freshDb();
  const cases: Array<[unknown, string]> = [
    [{ terms: { renewal_mode: 'sometimes' }, reason: 'r' }, 'renewal_mode'],
    [{ terms: { carry_share_bps: 10001 }, reason: 'r' }, 'carry_share_bps'],
    [{ terms: { cure_days: -1 }, reason: 'r' }, 'cure_days'],
    [{ terms: { usage_report_day: 29 }, reason: 'r' }, 'usage_report_day'],
    [{ terms: { late_interest_bps: 1.5 }, reason: 'r' }, 'late_interest_bps'],
    [{ terms: { carry_share: 2000 }, reason: 'r' }, 'carry_share'],
    [{ terms: { exclusive: 'yes' }, reason: 'r' }, 'exclusive'],
    [{ sections: { not_a_term: '§1' }, reason: 'r' }, 'sections.not_a_term'],
  ];
  for (const [body, field] of cases) {
    const r = await save(env(db), body);
    assert.equal(r.status, 400, `${field} was accepted`);
    assert.equal(r.body.error, 'invalid_terms');
    assert.equal(r.body.errors[0].field, field);
    assert.match(r.body.message, new RegExp(`^${field.replace('.', '\\.')} `));
  }
  const noReason = await save(env(db), { terms: { cure_days: 30 } });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.error, 'reason_required');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM licence_terms').get().n, 0);
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('null clears a term, a key left out keeps its value, and each save appends one event with its reason and diff', async () => {
  // Mutations checked: a save replacing the whole row; the diff carrying unchanged keys; the event without its reason; two events per save.
  const db = freshDb();
  await save(env(db), { terms: { cure_days: 30, renewal_mode: 'auto' }, sections: { cure_days: '§9.1' }, reason: 'Signed' });
  const r = await save(env(db), { terms: { cure_days: null }, sections: { cure_days: null }, reason: 'Cure struck in amendment 1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT cure_days, renewal_mode, sections_json, updated_by_user_id FROM licence_terms').get();
  assert.deepEqual([row.cure_days, row.renewal_mode, JSON.parse(row.sections_json), row.updated_by_user_id], [null, 'auto', {}, SUPER]);
  const ev = events(db);
  assert.equal(ev.length, 2, 'one event per save');
  const last = JSON.parse(ev[1].detail_json);
  assert.equal(ev[1].note, 'Cure struck in amendment 1');
  assert.equal(last.reason, 'Cure struck in amendment 1');
  assert.deepEqual(last.changed, { cure_days: { before: 30, after: null }, 'sections.cure_days': { before: '§9.1', after: null } });
  assert.equal(ev[1].actor_user_id, SUPER);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('/mine returns the caller\'s own licence\'s terms, the same for a delegate, and another licence\'s never', async () => {
  // Mutations checked: /mine reading the first licence_terms row; the delegate left out; terms read as zeros when absent.
  const db = freshDb();
  await save(env(db), { terms: TERMS, sections: { carry_share_bps: '§7.3' }, reason: 'Signed' });
  await save(env(db), { terms: { carry_share_bps: 1500 }, reason: 'Signed' }, SUPER, LIC2);
  const principal = await call(mineApp, env(db), HOLDER, '/licence/mine');
  assert.equal(principal.status, 200, JSON.stringify(principal.body));
  assert.equal(principal.body.terms.carry_share_bps, 2000);
  assert.equal(principal.body.terms.governing_law, 'Delaware');
  assert.deepEqual(principal.body.sections, { carry_share_bps: '§7.3' });
  assert.equal(principal.body.terms_reason, null);
  const delegate = await call(mineApp, env(db), DELEGATE, '/licence/mine');
  assert.deepEqual(delegate.body.terms, principal.body.terms, 'a delegate reads what the principal reads');
  const other = await call(mineApp, env(db), OTHER, '/licence/mine');
  assert.equal(other.body.terms.carry_share_bps, 1500, 'another licence\'s terms leaked');
  assert.equal(other.body.terms.governing_law, null);

  const bare = freshDb();
  const none = await call(mineApp, env(bare), HOLDER, '/licence/mine');
  assert.equal(none.status, 200);
  assert.deepEqual([none.body.terms, none.body.terms_reason], [null, TERMS_REASON.not_recorded]);
  const broken = freshDb({ terms: false });
  const unread = await call(mineApp, env(broken), HOLDER, '/licence/mine');
  assert.equal(unread.status, 200, 'an unreadable terms table cost the page more than its terms');
  assert.deepEqual([unread.body.terms, unread.body.terms_reason], [null, TERMS_REASON.unreadable]);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('the push carries the terms, the branch writes them, and a copy without them reads null with its reason', async () => {
  // Mutations checked: the assembler leaving terms_json out; applyLicenceCopy not writing it; the branch reading SQL NULL as "not recorded".
  const hqDb = freshDb();
  await save(env(hqDb), { terms: TERMS, sections: { carry_share_bps: '§7.3' }, reason: 'Signed' });
  const lic = hqDb.prepare('SELECT * FROM territory_licences WHERE uid = ?').get(LIC);
  const record = await assembleLicenceRecord(env(hqDb) as any, lic, '2026-10-20T10:00:00Z');
  assert.equal(typeof record.terms_json, 'string');

  const branchDb = freshDb();
  branchDb.exec(BRANCH_LICENCE);
  branchDb.exec(BRANCH_ALTER);
  const FR = env(branchDb, { BRANCH_CODE: 'fr', APP_URL: 'https://fr.axal.vc' });
  await applyLicenceCopy(FR as any, record);
  const read = await call(mineApp, FR, HOLDER, '/licence/mine');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.source, 'hq_copy');
  assert.equal(read.body.terms.carry_share_bps, 2000);
  assert.equal(read.body.terms.exclusive, 1);
  assert.deepEqual(read.body.sections, { carry_share_bps: '§7.3' });

  // A copy pushed before D797: the row is there, its terms column is not filled.
  branchDb.prepare('UPDATE branch_licence SET terms_json = NULL').run();
  const old = await call(mineApp, FR, HOLDER, '/licence/mine');
  assert.deepEqual([old.body.terms, old.body.terms_reason], [null, TERMS_REASON.not_pushed]);
  // A push from a licence HQ holds no terms for.
  const bare = await assembleLicenceRecord(env(freshDb()) as any, lic, '2026-10-20T11:00:00Z');
  await applyLicenceCopy(FR as any, bare);
  const noTerms = await call(mineApp, FR, HOLDER, '/licence/mine');
  assert.deepEqual([noTerms.body.terms, noTerms.body.terms_reason], [null, TERMS_REASON.not_recorded]);
  // An older push arriving late never overwrites newer terms.
  await applyLicenceCopy(FR as any, { ...record, pushed_at: '2026-10-19T09:00:00Z' });
  assert.equal(JSON.parse(branchDb.prepare('SELECT terms_json FROM branch_licence').get().terms_json), null);
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the store refuses what the route refuses: migration 512\'s CHECKs hold every enum and range', () => {
  // Mutations checked: a CHECK removed from the migration; a range widened in the service.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(TERMS_DDL);
  const bad: Array<[string, unknown]> = [
    ['licensor_entity', 'subsidiary'], ['renewal_mode', 'sometimes'], ['fee_invoiced', 'monthly'],
    ['statement_period', 'week'], ['data_role', 'nobody'], ['exclusive', 2], ['audit_right', -1],
    ['carry_share_bps', 10001], ['late_interest_bps', -1], ['cure_days', -1], ['payment_terms_days', 3651],
    ['usage_report_day', 0], ['usage_report_day', 29], ['minimum_guarantee_cents', -1], ['non_compete_months', 121],
  ];
  for (const [col, v] of bad) {
    assert.throws(() => db.prepare(`INSERT INTO licence_terms (licence_uid, ${col}) VALUES ('x', ?)`).run(v as any), /CHECK/, `${col} = ${String(v)} was stored`);
    // And the service refuses the same value.
    assert.equal(validateTermsBody({ [col]: v }, undefined).ok, false, `${col} = ${String(v)} passed the service`);
  }
  assert.equal(LICENCE_TERM_FIELDS.length, 22, "the schedule is the issue's 22 terms");
  for (const k of LICENCE_TERM_KEYS) assert.match(TERMS_DDL, new RegExp(`\\n  ${k} (TEXT|INTEGER)`), `${k} has no column`);
});
