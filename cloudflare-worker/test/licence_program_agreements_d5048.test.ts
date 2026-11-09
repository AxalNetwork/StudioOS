/**
 * D5048 (#5048, part 1 of #5047) — the canonical store for package and program agreements.
 *
 *   1. The backfill gives every schedule envelope already sent one canonical version, with its status read
 *      from the envelope and the schedule row, keeps `schedule_contract_uid` as it was, writes nothing to
 *      `licence_contracts`, and can be applied twice.
 *   2. A slot holds one version in flight and one executed version; history of any length coexists; the slot
 *      is the kind and its scope, never a free label; package-level and program-level scopes both fit.
 *   3. A sent or signed version is frozen at the database: template, version, body hash, envelope and
 *      signature; a terminal version never reopens; every write moves the revision by one; nothing deletes.
 *   4. The schedule send writes a canonical version with the envelope's hash in the send's own batch, the
 *      completion executes it with the signed document's hash, and a terms change supersedes it. No row
 *      reaches `licence_contracts`.
 *   5. An envelope for superseded terms that completes later records its signature on its superseded version,
 *      which stays superseded.
 *   6. A person's status change names the revision it read: a stale one loses whole.
 *   7. The five states of a program are read apart: grant, required, sent, executed, legally in force.
 *
 * The database is the baseline plus every migration (schema only, `_schema_once.mjs`); test 1 builds it
 * without this issue's migration and applies the file itself. Every studio, person and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_program_agreements_d5048.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import agreementsRoute from '../src/routes/admin_licence_agreements.ts';
import { onProgramScheduleEnvelopeCompleted } from '../src/services/programSchedule.ts';
import { programLegalState, slotKeyOf, transitionStatements } from '../src/services/programAgreements.ts';
import { clearGuard, decisionGuard, runDecision } from '../src/services/decisionBatch.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const THIS = '202611082025_licence_program_agreements.sql';
const MIGRATION = readFileSync(resolve(MIGRATIONS, THIS), 'utf8');
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const REASON = 'Send the schedule agreed at the November review.';
const SIGNED_AT = '2026-11-05T12:00:00Z';
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
  db.prepare('INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status, renews_on) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(1, LIVE, 'AXL-001', 'Studio North SAS', 'Studio North', 'active', '2027-10-31');
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  return db;
}

const app = new Hono<any>();
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
const G = '/api/admin/program-grants';
const grant = (db: DatabaseSync, terms: Record<string, unknown> = {}) => call(db, 'POST', `${G}/licences/${LIVE}/learning`, { reason: 'Granted at the November HQ review.', terms });
const send = (db: DatabaseSync) => call(db, 'POST', `${G}/licences/${LIVE}/learning/schedule/send`, { reason: REASON });
const change = (db: DatabaseSync, terms: Record<string, unknown>) => call(db, 'PATCH', `${G}/licences/${LIVE}/learning`, { reason: 'Capacity raised after the November review.', terms });
const complete = (db: DatabaseSync, uuid: string, at = SIGNED_AT) => onProgramScheduleEnvelopeCompleted({ DB: d1Over(db) } as any, uuid, at);
const agreements = (db: DatabaseSync) => (db.prepare('SELECT * FROM licence_program_agreements ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const agreementEvents = (db: DatabaseSync) => (db.prepare('SELECT agreement_uid, action, from_status, to_status, revision FROM licence_agreement_events ORDER BY id').all() as any[]).map((r) => ({ ...r }));
const contracts = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM licence_contracts').get() as any).n;
/** A signed copy on file for an envelope, and the envelope completed, as the in-house signing route leaves them before its hook runs. */
function signedCopy(db: DatabaseSync, uuid: string, sha: string) {
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = ? WHERE envelope_uuid = ?").run(SIGNED_AT, uuid);
  const e = db.prepare('SELECT id FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid) as any;
  const r = db.prepare('SELECT id FROM esign_recipients WHERE envelope_id = ?').get(e.id) as any;
  db.prepare(`INSERT INTO legal_document_files (uid, kind, envelope_id, recipient_id, file_sha256, file_bytes, content_type, renderer, paper_sha256)
              VALUES (?, 'signed_copy', ?, ?, ?, 100, 'application/pdf', 'pdf_lib', ?)`).run(`f_${uuid}`, e.id, r?.id ?? 1, sha, SHA('p'));
}

// ─────────────────────────────────────────────── 1. the backfill

test('1. the backfill reaches every schedule envelope, keeps schedule_contract_uid, and can run twice', () => {
  const db = fixture(DDL(202611082025));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'licence_program_agreements'").get() as any).n, 0);
  db.prepare("INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, status) VALUES (2, 'lic_two', 'AXL-002', 'Studio Two SAS', 'Studio Two', 'active')").run();
  const grant = db.prepare(`INSERT INTO program_grants (id, uid, licence_id, program_key, state, schedule_contract_uid, schedule_signed_at, set_at, terms_revision, signed_revision)
                            VALUES (?, ?, ?, ?, 'granted', ?, ?, '2026-10-01T00:00:00Z', ?, ?)`);
  const env = db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
                          VALUES (?, 'program_schedule', 'Program schedule', 'body', ?, ?, 1, ?)`);
  const sched = db.prepare('INSERT INTO program_grant_schedules (grant_id, revision, terms_hash, envelope_uuid, sent_at, signed_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // Grant 10 (learning): revision 1 signed then superseded, revision 2 signed and current.
  grant.run(10, 'g10', 1, 'learning', 'env-l2', '2026-10-20T00:00:00Z', 2, 2);
  env.run('env-l1', SHA('a'), 'completed', '2026-10-05T00:00:00Z');
  env.run('env-l2', SHA('b'), 'completed', '2026-10-20T00:00:00Z');
  sched.run(10, 1, 'legacy', 'env-l1', '2026-10-02T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-10T00:00:00Z');
  sched.run(10, 2, SHA('h'), 'env-l2', '2026-10-11T00:00:00Z', '2026-10-20T00:00:00Z', null);
  // Grant 11 (perks): one voided envelope, then one out for signature.
  grant.run(11, 'g11', 1, 'perks', 'env-p2', null, 1, null);
  env.run('env-p1', SHA('c'), 'void', null);
  env.run('env-p2', SHA('d'), 'sent', null);
  sched.run(11, 1, SHA('h'), 'env-p1', '2026-10-03T00:00:00Z', null, null);
  sched.run(11, 1, SHA('h'), 'env-p2', '2026-10-04T00:00:00Z', null, null);
  // Grant 12 (licence two, spin-out lab): an envelope only the grant names, with no envelope row on file.
  grant.run(12, 'g12', 2, 'spinout-lab', 'env-orphan', null, 1, null);
  // A signed copy for env-l2.
  const e2 = (db.prepare("SELECT id FROM esign_envelopes WHERE envelope_uuid = 'env-l2'").get() as any).id;
  db.prepare(`INSERT INTO legal_document_files (uid, kind, envelope_id, recipient_id, file_sha256, file_bytes, content_type, renderer, paper_sha256)
              VALUES ('f1', 'signed_copy', ?, 1, ?, 10, 'application/pdf', 'pdf_lib', ?)`).run(e2, SHA('s'), SHA('p'));
  const grantsBefore = (db.prepare('SELECT id, schedule_contract_uid, schedule_signed_at FROM program_grants ORDER BY id').all() as any[]).map((r) => ({ ...r }));
  const contractsBefore = contracts(db);

  db.exec(MIGRATION);

  const rows = agreements(db);
  const by = Object.fromEntries(rows.map((r) => [r.envelope_uuid, r]));
  for (const uuid of ['env-l1', 'env-l2', 'env-p1', 'env-p2', 'env-orphan']) assert.ok(by[uuid], `${uuid} is reachable from a canonical version`);
  assert.equal(rows.length, 5);
  assert.deepEqual([by['env-l1'].status, by['env-l1'].signed_at, by['env-l1'].superseded_at], ['superseded', '2026-10-05T00:00:00Z', '2026-10-10T00:00:00Z'],
    'a signed revision a newer one replaced is superseded, and keeps its signature');
  assert.deepEqual([by['env-l2'].status, by['env-l2'].signed_at, by['env-l2'].body_sha256, by['env-l2'].signed_document_sha256],
    ['executed', '2026-10-20T00:00:00Z', SHA('b'), SHA('s')], 'the signed current revision is executed, with the envelope\'s and the signed copy\'s hashes');
  assert.deepEqual([by['env-p1'].status, by['env-p1'].superseded_at], ['voided', null]);
  assert.equal(by['env-p2'].status, 'sent');
  assert.deepEqual([by['env-orphan'].status, by['env-orphan'].licence_uid, by['env-orphan'].slot_key, by['env-orphan'].body_sha256],
    ['sent', 'lic_two', 'program_schedule:spinout-lab', null], 'an envelope only the grant names is still reached; its hash is not invented');
  for (const r of rows) {
    assert.equal(r.origin, 'backfill_d5048');
    assert.equal(r.agreement_kind, 'program_schedule');
    assert.equal(r.licence_uid === LIVE ? r.program_grant_id !== 12 : r.program_grant_id === 12, true);
  }
  assert.equal(agreementEvents(db).filter((e) => e.action === 'backfilled').length, 5);
  assert.deepEqual((db.prepare('SELECT id, schedule_contract_uid, schedule_signed_at FROM program_grants ORDER BY id').all() as any[]).map((r) => ({ ...r })), grantsBefore,
    'schedule_contract_uid stays as it was: the read-through');
  assert.equal(contracts(db), contractsBefore, 'no program agreement reaches licence_contracts');

  db.exec(MIGRATION);
  assert.equal(agreements(db).length, 5, 'a second application adds nothing');
  assert.equal(agreementEvents(db).length, 5);
  db.close();
});

// ─────────────────────────────────────────────── 2. slots

const INSERT = `INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, package_key, addendum_key,
  template_slug, status, envelope_uuid, created_at, signed_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?, 't', ?, ?, '2026-11-01', ?, ?)`;

test('2. one version in flight and one executed per slot; history coexists; the slot is the scope', () => {
  const db = fixture();
  const ins = db.prepare(INSERT);
  ins.run('a1', LIVE, 'package_master', 'package_master', null, 'venture_building', null, 'executed', 'e1', '2026-11-01', null);
  ins.run('a2', LIVE, 'package_master', 'package_master', null, 'venture_building', null, 'sent', 'e2', null, null);
  assert.throws(() => ins.run('a3', LIVE, 'package_master', 'package_master', null, 'venture_building', null, 'draft', null, null, null), /UNIQUE/,
    'a second version in flight for the slot is refused');
  assert.throws(() => ins.run('a4', LIVE, 'package_master', 'package_master', null, 'core_network', null, 'executed', 'e4', '2026-11-02', null), /UNIQUE/,
    'a second executed version in force for the slot is refused');
  for (let i = 0; i < 3; i++) ins.run(`h${i}`, LIVE, 'package_master', 'package_master', null, 'venture_building', null, 'superseded', `eh${i}`, '2026-10-01', '2026-10-02');
  ins.run('v1', LIVE, 'package_master', 'package_master', null, 'venture_building', null, 'voided', null, null, null);
  // Another licence, and the program scopes, are other slots.
  ins.run('b1', 'lic_other', 'package_master', 'package_master', null, 'venture_building', null, 'draft', null, null, null);
  ins.run('p1', LIVE, 'program_licence', 'program_licence:spinout-lab', 'spinout-lab', null, null, 'draft', null, null, null);
  ins.run('p2', LIVE, 'program_schedule', 'program_schedule:spinout-lab', 'spinout-lab', null, null, 'draft', null, null, null);
  ins.run('p3', LIVE, 'program_addendum', 'program_addendum:spinout-lab:ip', 'spinout-lab', null, 'ip', 'draft', null, null, null);
  ins.run('k1', LIVE, 'package_addendum', 'package_addendum:pricing', null, 'venture_building', 'pricing', 'draft', null, null, null);
  // The slot must be what the kind and scope say; each kind needs its scope.
  assert.throws(() => ins.run('x1', LIVE, 'program_licence', 'program_licence:perks', 'spinout-lab', null, null, 'draft', null, null, null), /CHECK/);
  assert.throws(() => ins.run('x2', LIVE, 'program_licence', 'program_licence:', null, null, null, 'draft', null, null, null), /CHECK|NOT NULL/);
  assert.throws(() => ins.run('x3', LIVE, 'package_master', 'package_master', null, null, null, 'draft', null, null, null), /CHECK/);
  assert.throws(() => ins.run('x4', LIVE, 'program_addendum', 'program_addendum:perks:', 'perks', null, null, 'draft', null, null, null), /CHECK/);
  assert.throws(() => ins.run('x5', LIVE, 'program_licence', 'program_licence:perks', 'perks', null, null, 'sent', null, null, null), /CHECK/, 'a sent version names its envelope');
  assert.throws(() => ins.run('x6', LIVE, 'program_licence', 'program_licence:perks', 'perks', null, null, 'executed', 'ex6', null, null), /CHECK/, 'an executed version has its signature time');
  assert.throws(() => ins.run('x7', LIVE, 'program_licence', 'program_licence:perks', 'perks', null, null, 'sent', 'e1', null, null), /UNIQUE/, 'one envelope is one version');
  // The service derives the same slots.
  assert.equal(slotKeyOf({ agreement_kind: 'program_addendum', program_key: 'spinout-lab', addendum_key: 'ip' }), 'program_addendum:spinout-lab:ip');
  assert.equal(slotKeyOf({ agreement_kind: 'package_master', package_key: 'venture_building' }), 'package_master');
  assert.equal(slotKeyOf({ agreement_kind: 'package_master' }), null);
  assert.equal(slotKeyOf({ agreement_kind: 'program_licence', program_key: 'spinout_lab' }), null, 'a program key is the registry\'s slug');
  assert.equal(slotKeyOf({ agreement_kind: 'program_schedule', program_key: 'perks', addendum_key: 'x' }), null);
  db.close();
});

// ─────────────────────────────────────────────── 3. frozen

test('3. a sent or signed version is frozen at the database, and nothing is deleted', () => {
  const db = fixture();
  db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, template_version,
              status, created_at, body_sha256) VALUES ('d1', ?, 'program_licence', 'program_licence:perks', 'perks', 'program_perks_licence', 2, 'draft', '2026-11-01', ?)`).run(LIVE, SHA('a'));
  const upd = (set: string, ...binds: any[]) => db.prepare(`UPDATE licence_program_agreements SET ${set} WHERE uid = 'd1'`).run(...binds);
  // While a draft, the body and version may be re-rendered (one revision at a time).
  upd('body_sha256 = ?, template_version = 3, revision = revision + 1', SHA('b'));
  assert.throws(() => upd('body_sha256 = ?, revision = revision + 2', SHA('c')), /frozen/, 'a write moves the revision by exactly one');
  assert.throws(() => upd('body_sha256 = ?', SHA('c')), /frozen/, 'a write that does not move the revision is refused');
  upd("status = 'sent', envelope_uuid = 'env-d1', revision = revision + 1");
  for (const [what, set] of [
    ['the body hash', `body_sha256 = '${SHA('c')}'`],
    ['the template version', 'template_version = 4'],
    ['the template', "template_slug = 'other'"],
    ['the envelope', "envelope_uuid = 'env-other'"],
    ['the licence', "licence_uid = 'lic_other'"],
    ['back to draft', "status = 'draft'"],
  ]) assert.throws(() => upd(`${set}, revision = revision + 1`), /frozen/, `${what} cannot change once sent`);
  upd(`status = 'executed', signed_at = '2026-11-03', signed_document_sha256 = '${SHA('s')}', revision = revision + 1`);
  assert.throws(() => upd(`signed_document_sha256 = '${SHA('t')}', revision = revision + 1`), /frozen/, 'the signed hash is set once');
  assert.throws(() => upd("signed_at = '2026-11-04', revision = revision + 1"), /frozen/, 'the signature time is set once');
  assert.throws(() => upd("status = 'voided', revision = revision + 1"), /frozen/, 'an executed version is only ever superseded');
  upd("status = 'superseded', superseded_at = '2026-11-09', revision = revision + 1");
  assert.throws(() => upd("status = 'executed', revision = revision + 1"), /frozen/, 'a superseded version never reopens');
  assert.throws(() => db.prepare("DELETE FROM licence_program_agreements WHERE uid = 'd1'").run(), /keeps every version/);
  db.prepare("INSERT INTO licence_agreement_events (agreement_uid, licence_uid, action, to_status, revision, created_at) VALUES ('d1', ?, 'drafted', 'draft', 0, '2026-11-01')").run(LIVE);
  assert.throws(() => db.prepare("UPDATE licence_agreement_events SET action = 'sent'").run(), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM licence_agreement_events').run(), /append-only/);
  db.close();
});

// ─────────────────────────────────────────────── 4. the schedule lifecycle writes the canonical version

test('4. send, sign and change terms: the canonical version follows in the same batches; licence_contracts is untouched', async () => {
  const db = fixture();
  assert.equal((await grant(db, { capacity_cap: 60 })).status, 201);
  const sent = await send(db);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const uuid1 = sent.body.grant.schedule.contract_uid as string;
  let [v1] = agreements(db);
  const envSha = (db.prepare('SELECT body_sha256 FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid1) as any).body_sha256;
  assert.deepEqual([v1.status, v1.envelope_uuid, v1.slot_key, v1.licence_uid, v1.body_sha256, v1.origin, v1.created_by_user_id],
    ['sent', uuid1, 'program_schedule:learning', LIVE, envSha, 'app', SUPER], 'the version carries the envelope and the hash the envelope carries');
  assert.equal(v1.program_grant_id, (db.prepare("SELECT id FROM program_grants WHERE program_key = 'learning'").get() as any).id);

  signedCopy(db, uuid1, SHA('9'));
  assert.equal((await complete(db, uuid1))!.changed, true);
  [v1] = agreements(db);
  assert.deepEqual([v1.status, v1.signed_at, v1.signed_document_sha256, v1.effective_from], ['executed', SIGNED_AT, SHA('9'), '2026-11-05']);
  assert.equal((await complete(db, uuid1, '2026-11-09T00:00:00Z'))!.changed, false);
  assert.equal(agreements(db)[0].signed_at, SIGNED_AT, 'a second completion changes nothing');

  assert.equal((await change(db, { capacity_cap: 80 })).status, 200);
  [v1] = agreements(db);
  assert.deepEqual([v1.status, v1.signed_at, v1.effective_to], ['superseded', SIGNED_AT, v1.superseded_at.slice(0, 10)],
    'the executed version no longer covers the grant\'s terms; its signature stays');

  const resent = await send(db);
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  const rows = agreements(db);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].status, rows[1].envelope_uuid], ['sent', resent.body.grant.schedule.contract_uid]);
  assert.deepEqual(agreementEvents(db).map((e) => [e.agreement_uid === rows[0].uid ? 1 : 2, e.action, e.from_status, e.to_status, e.revision]), [
    [1, 'sent', null, 'sent', 0], [1, 'executed', 'sent', 'executed', 1], [1, 'superseded', 'executed', 'superseded', 2], [2, 'sent', null, 'sent', 0],
  ], 'one history line per write, each naming the status it left and the revision it made');
  assert.equal(contracts(db), 0, 'no program agreement writes to licence_contracts');
  db.close();
});

test('4b. a resend after a voided envelope closes the voided version and writes a new one', async () => {
  const db = fixture();
  await grant(db);
  const uuid1 = (await send(db)).body.grant.schedule.contract_uid as string;
  db.prepare("UPDATE esign_envelopes SET status = 'void' WHERE envelope_uuid = ?").run(uuid1);
  const again = await send(db);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const [a, b] = agreements(db);
  assert.deepEqual([a.status, a.voided_at !== null, b.status], ['voided', true, 'sent']);
  db.close();
});

// ─────────────────────────────────────────────── 5. a signature on superseded terms

test('5. an envelope for superseded terms records its signature on its superseded version', async () => {
  const db = fixture();
  await grant(db, { capacity_cap: 60 });
  const uuid1 = (await send(db)).body.grant.schedule.contract_uid as string;
  assert.equal((await change(db, { capacity_cap: 80 })).status, 200);
  assert.equal(agreements(db)[0].status, 'superseded');
  const done = await complete(db, uuid1);
  assert.equal(done!.stale, true);
  const [v1] = agreements(db);
  assert.deepEqual([v1.status, v1.signed_at], ['superseded', SIGNED_AT], 'signed (it was), and still superseded: it covers no current terms');
  assert.equal(agreementEvents(db).filter((e) => e.action === 'signed_after_supersede').length, 1);
  db.close();
});

// ─────────────────────────────────────────────── 6. revision-safe writes

test('6. a status change names the revision it read; a stale one loses whole', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO licence_program_agreements (uid, licence_uid, agreement_kind, slot_key, program_key, template_slug, status, created_at)
              VALUES ('r1', ?, 'program_licence', 'program_licence:perks', 'perks', 'program_perks_licence', 'draft', '2026-11-01')`).run(LIVE);
  const env = { DB: d1Over(db) } as any;
  const at = '2026-11-02T00:00:00Z';
  const ready = transitionStatements(env, { uid: 'r1', fromRevision: 0, from: 'draft', to: 'ready', actorId: SUPER, at });
  assert.equal((await runDecision(env, [ready.update, decisionGuard(env), ready.event, clearGuard(env)])).lost, false);
  const back = transitionStatements(env, { uid: 'r1', fromRevision: 1, from: 'ready', to: 'draft', actorId: SUPER, at });
  assert.equal((await runDecision(env, [back.update, decisionGuard(env), back.event, clearGuard(env)])).lost, false);
  // The status it read (draft) is the row's again; the revision it read (0) is not.
  const stale = transitionStatements(env, { uid: 'r1', fromRevision: 0, from: 'draft', to: 'voided', actorId: SUPER, at });
  assert.equal((await runDecision(env, [stale.update, decisionGuard(env), stale.event, clearGuard(env)])).lost, true, 'the revision it read is gone');
  const row = agreements(db)[0];
  assert.deepEqual([row.status, row.revision, row.voided_at], ['draft', 2, null]);
  assert.deepEqual(agreementEvents(db).map((e) => [e.action, e.from_status, e.to_status, e.revision]), [['readied', 'draft', 'ready', 1], ['drafted', 'ready', 'draft', 2]],
    'the loser wrote no history');
  assert.throws(() => transitionStatements(env, { uid: 'r1', fromRevision: 2, from: 'draft', to: 'executed', actorId: SUPER, at }), /cannot become/,
    'a person cannot mark a version executed: only a signature does');
  db.close();
});

// ─────────────────────────────────────────────── 7. the five states

test('7. grant, required, sent, executed and legally in force are read apart', async () => {
  const db = fixture();
  await grant(db);
  const read = async () => (await call(db, 'GET', `/api/admin/licence-agreements/licences/${LIVE}`)).body;
  let s = (await read()).programs[0];
  assert.deepEqual([s.grant_exists, s.agreement_required, s.agreement_sent, s.agreement_executed, s.legally_in_force], [true, true, false, false, false],
    'a grant exists and is not in force: its agreement is required and not sent');
  const uuid = (await send(db)).body.grant.schedule.contract_uid as string;
  s = (await read()).programs[0];
  assert.deepEqual([s.agreement_sent, s.agreement_executed, s.legally_in_force], [true, false, false]);
  await complete(db, uuid);
  const body = await read();
  s = body.programs[0];
  assert.deepEqual([s.agreement_sent, s.agreement_executed, s.legally_in_force, s.executed_agreement_uid], [true, true, true, body.agreements[0].uid]);
  assert.equal(body.slots[0].executed, body.agreements[0].uid);
  assert.equal(body.licence_identity, 'territory_licence');
  const one = await call(db, 'GET', `/api/admin/licence-agreements/${body.agreements[0].uid}`);
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.events.map((e: any) => e.action), ['sent', 'executed']);
  // Pausing the grant leaves the agreement executed and takes the program out of force.
  await call(db, 'POST', `${G}/licences/${LIVE}/learning/pause`, { reason: 'Paused for the studio\'s audit.' });
  s = (await read()).programs[0];
  assert.deepEqual([s.grant_exists, s.agreement_executed, s.legally_in_force], [true, true, false]);
  // The rule off: no agreement is required. The rule on: a grant otherwise in force is not legally in force without one.
  assert.equal(programLegalState({ program_key: 'perks', state: 'granted', requires_signed_schedule: 0 }, [], { grantInForce: true }).legally_in_force, true);
  const unsigned = programLegalState({ program_key: 'perks', state: 'granted', requires_signed_schedule: 1 }, [], { grantInForce: true });
  assert.deepEqual([unsigned.agreement_required, unsigned.agreement_executed, unsigned.legally_in_force], [true, false, false]);
  assert.equal((await call(db, 'GET', '/api/admin/licence-agreements/licences/lic_none')).status, 404);
  db.close();
});
