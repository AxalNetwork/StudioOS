/**
 * D5057 (#5057, user licences 1/4) — one licence identity for the operator and user licence families.
 *
 *   1. The migration applies on a database that already holds territory licences: exactly one shared row each,
 *      with the territory licence's own uid and ref, its kind as the type, its entity (or the territory licence
 *      itself when no entity row is named) as the holder. Applying it again changes nothing. No territory,
 *      contract, invoice, terms or agreement row changes.
 *   2. The family, type and holder constraints refuse a bad row: a user licence as a territory, an
 *      "administrator" family or type, a family that disagrees with its type, an operator licence held by a
 *      user, a territory mapping under another uid. User licences are first-class rows with no territory row.
 *   3. The identity is frozen, every write moves the revision by one, and nothing deletes.
 *   4. A territory licence issued through the HQ route gets its shared row in the same statement; a reference a
 *      user licence holds is refused as a clash; the territory row's status and dates are followed.
 *   5. `licence_program_agreements` resolve through the shared uid: a backfilled schedule and a new send both
 *      name a shared licence, and an agreement naming no shared licence is refused.
 *
 * The database is the baseline plus every migration (`_schema_once.mjs`); test 1 builds it without this issue's
 * migration and applies the file itself. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/shared_licences_d5057.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licencesRoute from '../src/routes/admin_licences.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import agreementsRoute from '../src/routes/admin_licence_agreements.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const THIS = '202611090932_shared_licences.sql';
const MIGRATION = readFileSync(resolve(MIGRATIONS, THIS), 'utf8');
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const SHA = (c: string) => c.repeat(64).slice(0, 64);

const DDL = (below?: number) => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db, below ? { below } : {});
  const out = (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
};
const BUILT = DDL();
const SEED = (() => {
  const sql = readFileSync(resolve(MIGRATIONS, '553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture(ddl = BUILT) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of ddl) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, entity_id, legal_entity_name, brand_name, status, starts_on, renews_on, annual_fee_cents, revenue_share_bps, created_by_user_id, created_at)
              VALUES (1, ?, 'AXL-001', 40, 'Studio North SAS', 'Studio North', 'active', '2026-01-01', '2027-10-31', 5000000, 3500, ?, '2026-01-01T09:00:00Z')`).run(LIVE, SUPER);
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  return db;
}

const app = new Hono<any>();
app.route('/api/admin/licences', licencesRoute);
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/admin/licence-agreements', agreementsRoute);

async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: `totp-${SUPER}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}

const rows = (db: DatabaseSync, sql: string, ...binds: any[]) => (db.prepare(sql).all(...binds) as any[]).map((r) => ({ ...r }));
const shared = (db: DatabaseSync) => rows(db, 'SELECT * FROM licences ORDER BY territory_licence_id, uid');
/** Every row of the tables this issue must not change. */
const untouched = (db: DatabaseSync) => Object.fromEntries(
  ['territory_licences', 'licence_territories', 'licence_seats', 'licence_events', 'licence_contracts', 'licence_fee_invoices',
    'licence_terms', 'licence_program_agreements', 'licence_agreement_events', 'program_grants']
    .map((t) => [t, rows(db, `SELECT * FROM ${t} ORDER BY rowid`)]),
);
const USER_LICENCE = `INSERT INTO licences (uid, licence_ref, licence_family, licence_type, holder_type, holder_id, status, territory_licence_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '2026-11-09T00:00:00Z')`;

// ─────────────────────────────────────────────── 1. the backfill

test('1. the migration gives each existing territory licence exactly one shared row, changes nothing else, and applies twice', () => {
  const db = fixture(DDL(202611090932));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'licences'").get() as any).n, 0);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, kind, status, created_at)
              VALUES (2, 'lic_wl', 'AXL-WL-002', 'Brand Two Ltd', 'Brand Two', 'white_label', 'draft', '2026-03-01T00:00:00Z')`).run();
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, terminated_at, created_at)
              VALUES (3, 'lic_old', 'AXL-003', 'Old Studio BV', 'Old Studio', 'terminated', '2026-06-01', '2025-01-01T00:00:00Z')`).run();
  // A master contract, an invoice, terms and a schedule agreement already on file.
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, status, envelope_uid, signed_at)
              VALUES ('c1', ?, 'territory_master', 3, 'Territory licence', 'body', 'signed', 'env-c1', '2026-01-02')`).run(LIVE);
  db.prepare(`INSERT INTO licence_fee_invoices (uid, licence_uid, period_label, period_start, period_end, amount_cents, currency, reference, issued_at, due_at, figures_json, figures_sha256)
              VALUES ('i1', ?, '2026', '2026-01-01', '2026-12-31', 5000000, 'EUR', 'AXL-001-2026', '2026-01-02', '2026-02-01', '{}', ?)`).run(LIVE, SHA('f'));
  db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, status, envelope_uuid, created_at, signed_at)
              VALUES ('a1', ?, 'program_schedule', 'program_schedule:learning', 'learning', 'program_schedule', 'executed', 'env-a1', '2026-02-01', '2026-02-02')`).run(LIVE);
  const before = untouched(db);

  db.exec(MIGRATION);

  const after = shared(db);
  assert.equal(after.length, 3, 'one shared row per territory licence');
  assert.deepEqual(after.map((r) => [r.territory_licence_id, r.uid, r.licence_ref, r.licence_family, r.licence_type, r.holder_type, r.holder_id, r.status, r.origin]), [
    [1, LIVE, 'AXL-001', 'operator', 'territory', 'entity', '40', 'active', 'backfill_d5057'],
    [2, 'lic_wl', 'AXL-WL-002', 'operator', 'white_label', 'entity', 'territory_licence:lic_wl', 'draft', 'backfill_d5057'],
    [3, 'lic_old', 'AXL-003', 'operator', 'territory', 'entity', 'territory_licence:lic_old', 'terminated', 'backfill_d5057'],
  ], 'the territory uid and ref are the shared ones; a licence naming no entity row is held by the party its territory row names');
  assert.deepEqual([after[0].starts_on, after[0].renews_on, after[0].ends_on, after[0].revision, after[0].created_at, after[0].created_by_user_id],
    ['2026-01-01', '2027-10-31', null, 0, '2026-01-01T09:00:00Z', SUPER]);
  // One-to-one, both ways.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM territory_licences t JOIN licences s ON s.territory_licence_id = t.id AND s.uid = t.uid').get() as any).n, 3);
  assert.equal((db.prepare('SELECT COUNT(DISTINCT territory_licence_id) AS n FROM licences').get() as any).n, 3);
  // No commercial or territory field is copied.
  const cols = (db.prepare('PRAGMA table_info(licences)').all() as any[]).map((c) => c.name);
  for (const c of ['annual_fee_cents', 'revenue_share_bps', 'token_split_bps', 'currency', 'term_years', 'legal_entity_name', 'brand_name', 'kind'])
    assert.ok(!cols.includes(c), `${c} stays on territory_licences only`);
  assert.deepEqual(untouched(db), before, 'no territory, contract, invoice, terms or agreement row changes');

  db.exec(MIGRATION);
  assert.deepEqual(shared(db), after, 'a second application changes nothing');
  assert.deepEqual(untouched(db), before);
  db.close();
});

// ─────────────────────────────────────────────── 2. families, types, holders

test('2. family, type and holder constraints refuse a bad row; user licences stand on their own', () => {
  const db = fixture();
  const ins = db.prepare(USER_LICENCE);
  // The four user licences are first-class rows, with no territory row.
  ins.run('ul_f', 'FDR-001', 'user', 'founder', 'user', '7', null);
  ins.run('ul_i', 'INV-001', 'user', 'investor', 'user', '8', null);
  ins.run('ul_o', 'OPP-001', 'user', 'operating_partner', 'user', '9', null);
  ins.run('ul_a', 'ADV-001', 'user', 'advisor', 'user', '10', null);
  ins.run('ol_m', 'MF-001', 'operator', 'master_franchise', 'entity', '41', null);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM licences WHERE licence_family = 'user'").get() as any).n, 4);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM territory_licences').get() as any).n, 1, 'no user licence became a territory licence');

  assert.throws(() => ins.run('x3', 'X-3', 'administrator', 'founder', 'user', '7', null), /CHECK/, 'administrator is a binding, not a family');
  assert.throws(() => ins.run('x4', 'X-4', 'user', 'administrator', 'user', '7', null), /CHECK/, 'nor a type');
  assert.throws(() => ins.run('x5', 'X-5', 'operator', 'founder', 'entity', '41', null), /CHECK/, 'the family is the type\'s');
  assert.throws(() => ins.run('x6', 'X-6', 'user', 'territory', 'user', '7', null), /CHECK/, 'a territory is never a user licence');
  assert.throws(() => ins.run('x7', 'X-7', 'operator', 'territory', 'user', '7', null), /CHECK/, 'an operator licence is held by an entity');
  assert.throws(() => ins.run('x8', 'X-8', 'user', 'founder', 'team', '7', null), /CHECK/, 'a holder is an entity or a user');
  assert.throws(() => ins.run('x9', 'FDR-001', 'user', 'investor', 'user', '7', null), /UNIQUE/, 'a reference is unique across families');
  // Mapping a territory row under another uid or ref is refused (lic_five already holds its own, by the insert trigger).
  db.exec('DROP TRIGGER territory_licences_shared_identity');
  db.prepare("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (6, 'lic_six', 'AXL-006', 'Six SAS', 'Six', 'draft')").run();
  assert.throws(() => ins.run('not_six', 'AXL-006', 'operator', 'territory', 'entity', '41', 6), /takes its uid and licence_ref/);
  assert.throws(() => ins.run('lic_six', 'AXL-6', 'operator', 'territory', 'entity', '41', 6), /takes its uid and licence_ref/);
  // With the uid and ref right, the family and type still decide: a user licence is never a territory.
  assert.throws(() => ins.run('lic_six', 'AXL-006', 'user', 'founder', 'user', '7', 6), /CHECK/, 'a user licence is never a territory');
  assert.throws(() => ins.run('lic_six', 'AXL-006', 'operator', 'master_franchise', 'entity', '41', 6), /CHECK/, 'only a territory or white-label licence maps a territory row');
  ins.run('lic_six', 'AXL-006', 'operator', 'territory', 'entity', '41', 6);
  db.close();
});

// ─────────────────────────────────────────────── 3. frozen identity, revision, no delete

test('3. the identity never changes, every write moves the revision by one, and nothing deletes', () => {
  const db = fixture();
  db.prepare(USER_LICENCE).run('ul_f', 'FDR-001', 'user', 'founder', 'user', '7', null);
  const upd = (set: string) => db.prepare(`UPDATE licences SET ${set} WHERE uid = 'ul_f'`).run();
  upd("status = 'suspended', revision = revision + 1");
  assert.throws(() => upd("status = 'active'"), /revision/, 'a write that does not move the revision is refused');
  assert.throws(() => upd("status = 'active', revision = revision + 2"), /revision/);
  for (const [what, set] of [
    ['the uid', "uid = 'other'"], ['the reference', "licence_ref = 'FDR-999'"], ['the family', "licence_family = 'operator', licence_type = 'territory'"],
    ['the holder', "holder_id = '99'"], ['the holder type', "holder_type = 'entity'"], ['the territory row', 'territory_licence_id = 1'],
    ['the origin', "origin = 'backfill_d5057'"],
  ]) assert.throws(() => upd(`${set}, revision = revision + 1`), /never changes|CHECK/, `${what} never changes`);
  assert.throws(() => db.prepare("DELETE FROM licences WHERE uid = 'ul_f'").run(), /keeps every licence/);
  assert.throws(() => db.prepare('DELETE FROM licences WHERE territory_licence_id = 1').run(), /keeps every licence/);
  assert.equal((db.prepare("SELECT revision FROM licences WHERE uid = 'ul_f'").get() as any).revision, 1);
  db.close();
});

// ─────────────────────────────────────────────── 4. new territory licences

test('4. a territory licence issued by HQ gets its shared row in the same statement, and its lifecycle is followed', async () => {
  const db = fixture();
  assert.equal(shared(db).length, 1, 'the fixture\'s own territory licence has its shared row, from the insert trigger');
  const made = await call(db, 'POST', '/api/admin/licences', { licence_ref: 'axl-010', legal_entity_name: 'Studio Ten GmbH', entity_id: 77, kind: 'white_label' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const t = db.prepare('SELECT id, uid, licence_ref FROM territory_licences WHERE uid = ?').get(made.body.uid) as any;
  const s = rows(db, 'SELECT * FROM licences WHERE territory_licence_id = ?', t.id);
  assert.equal(s.length, 1, 'exactly one shared row');
  assert.deepEqual([s[0].uid, s[0].licence_ref, s[0].licence_family, s[0].licence_type, s[0].holder_type, s[0].holder_id, s[0].status, s[0].origin, s[0].created_by_user_id],
    [t.uid, 'AXL-010', 'operator', 'white_label', 'entity', '77', 'draft', 'territory_licence', SUPER]);

  // A reference a user licence holds is a clash, refused as one.
  db.prepare(USER_LICENCE).run('ul_f', 'FDR-001', 'user', 'founder', 'user', '7', null);
  const clash = await call(db, 'POST', '/api/admin/licences', { licence_ref: 'FDR-001', legal_entity_name: 'Clash SAS' });
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM territory_licences WHERE licence_ref = 'FDR-001'").get() as any).n, 0);

  // The territory row stays authoritative; its status and dates are followed in the same statement.
  const r = db.prepare("UPDATE territory_licences SET status = 'suspended', renews_on = '2028-01-31', revision = revision + 1 WHERE id = 1").run();
  assert.equal(Number(r.changes), 1, 'the lifecycle write still changes exactly one row, as its revision guard reads');
  const live = rows(db, 'SELECT status, renews_on, starts_on, revision FROM licences WHERE uid = ?', LIVE)[0];
  assert.deepEqual(live, { status: 'suspended', renews_on: '2028-01-31', starts_on: '2026-01-01', revision: 1 });
  db.prepare("UPDATE territory_licences SET annual_fee_cents = 6000000, brand_name = 'Studio N' WHERE id = 1").run();
  assert.equal((rows(db, 'SELECT revision FROM licences WHERE uid = ?', LIVE)[0]).revision, 1, 'a commercial edit is not the shared row\'s');
  db.close();
});

// ─────────────────────────────────────────────── 5. agreements anchor on the shared uid

test('5. licence_program_agreements resolve through the shared uid', async () => {
  const db = fixture();
  const reason = 'Granted at the November HQ review.';
  assert.equal((await call(db, 'POST', `/api/admin/program-grants/licences/${LIVE}/learning`, { reason, terms: {} })).status, 201);
  const sent = await call(db, 'POST', `/api/admin/program-grants/licences/${LIVE}/learning/schedule/send`, { reason: 'Send the schedule agreed at the November review.' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const joined = rows(db, `SELECT a.agreement_kind, s.uid, s.licence_family, s.licence_type, t.licence_ref
                             FROM licence_program_agreements a
                             JOIN licences s ON s.uid = a.licence_uid
                             JOIN territory_licences t ON t.id = s.territory_licence_id`);
  assert.deepEqual(joined, [{ agreement_kind: 'program_schedule', uid: LIVE, licence_family: 'operator', licence_type: 'territory', licence_ref: 'AXL-001' }],
    'the schedule a send writes names the shared licence, and reaches the territory row through it');
  const read = await call(db, 'GET', `/api/admin/licence-agreements/licences/${LIVE}`);
  assert.equal(read.status, 200);
  assert.deepEqual([read.body.licence_uid, read.body.licence_identity, read.body.agreements.length], [LIVE, 'shared_licence', 1]);

  // A user licence can anchor an agreement too; a uid naming no shared licence cannot.
  db.prepare(USER_LICENCE).run('ul_f', 'FDR-001', 'user', 'founder', 'user', '7', null);
  const ins = db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, status, created_at)
                          VALUES (?, ?, 'program_licence', 'program_licence:perks', 'perks', 'program_perks_licence', 'draft', '2026-11-09')`);
  ins.run('u1', 'ul_f');
  assert.throws(() => ins.run('u2', 'lic_nowhere'), /names a shared licence/);
  db.close();
});
