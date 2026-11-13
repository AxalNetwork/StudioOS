/**
 * D5052 (#5052, part 5 of #5047) — agreement strategies, the legal activation gate, replacement without
 * mutation, attributable history, end to end. The thirteen cases of the issue, numbered as it numbers them,
 * plus the strategy freeze and the before-grant gate.
 *
 * REAL SQLITE ON THE REAL SCHEMA (every migration, this one included), the real routes (program grants,
 * licence agreements, the D5052 policies, Contracts), the real e-sign send (`createAndSendEnvelope`), and the
 * real completion hook. A signature is the D5049 harness's: the recipient signs, a signed copy is filed, the
 * envelope completes, the hook runs.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_agreement_policies_d5052.test.ts
 */
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import licenceRoute from '../src/routes/licence.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import agreementsRoute from '../src/routes/admin_licence_agreements.ts';
import policiesRoute from '../src/routes/admin_licence_agreement_policies.ts';
import contractsRoute from '../src/routes/admin_contracts.ts';
import { onAgreementEnvelopeCompleted } from '../src/services/programAgreements.ts';
import { programCopy, studioPrograms, parseProgramCopy } from '../src/services/licencePrograms.ts';
import { requirementFor, programLegalStatus, gateSyncStatements, readLicenceLegal } from '../src/services/agreementPolicies.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

// The fixture signs at a fixed 2026-11-09T12:00:00Z (`sign`), and the routes
// stamp drafts and sends with the clock. Freeze the clock before that
// signature, or every run after noon UTC on 9 Nov 2026 has a draft newer than
// its execution and the history-order assertion fails on the date alone.
mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-09T09:00:00Z') });

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, SIGNER = 3;
const LIC = 'lic_live';
const REASON = 'Agreed at the November HQ review.';
const BODY = '# {{program.name}}\n\nBetween Axal and {{entity.legal_name}} ({{licence.licence_ref}}). Signed by {{signer.name}}.';
const PKG_BODY = '# Package agreement\n\nBetween Axal and {{entity.legal_name}} ({{licence.licence_ref}}). Signed by {{signer.name}}.';

const BUILT = (() => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const out = (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
  db.close();
  return out;
})();
const SEED = (() => {
  const sql = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/553_program_grants.sql'), 'utf8');
  const at = sql.indexOf('INSERT OR IGNORE INTO program_grant_defaults');
  return sql.slice(at, sql.indexOf(';', at) + 1);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  db.prepare(`INSERT INTO program_packages (uid, package_key, version, name, status, base_annual_fee_cents, effective_from, created_at)
    VALUES ('example-core-v1', 'core_network', 1, 'Core Network', 'active', 100, '2026-01-01', '2026-01-01T00:00:00Z')`).run();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, signatory_name, signatory_title, status, renews_on)
              VALUES (1, ?, 'AXL-001', 'Studio North SAS', 'Studio North', 'Lee Licensee', 'Managing Director', 'active', '2027-10-31')`).run(LIC);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  const t = db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES (?, ?, 'compliance', ?, 1, 1, 0)");
  for (const [slug, title] of [['program_learning_licence', 'Learning Programme Licence'], ['program_perks_licence', 'Perks Programme Licence'], ['program_mentor_access_licence', 'Mentor Access Programme Licence']]) t.run(slug, title, BODY);
  t.run('package_core_network_master', 'Core Network Package Agreement', PKG_BODY);
  t.run('package_venture_building_master', 'Venture Building Package Agreement', PKG_BODY);
  return db;
}

const app = new Hono<any>();
app.route('/api/licence', licenceRoute);
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/admin/licence-agreements', agreementsRoute);
app.route('/api/admin/licence-agreement-policies', policiesRoute);
app.route('/api/admin/contracts', contractsRoute);
async function call(db: DatabaseSync, method: string, path: string, body?: unknown, userId = SUPER) {
  const token = await new SignJWT(userId === SUPER ? { user_id: SUPER, role: 'admin', jti: `totp-${SUPER}` } : { user_id: userId }).setProtectedHeader({ alg: 'HS256' })
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

const P = '/api/admin/licence-agreement-policies';
const A = '/api/admin/licence-agreements';
const G = `/api/admin/program-grants/licences/${LIC}`;
const NO_SCHEDULE = { requires_signed_schedule: 0 };

const policy = (db: DatabaseSync, kind: 'program' | 'package', key: string, b: Record<string, unknown>) =>
  call(db, 'POST', `${P}/${kind}/${key}`, { reason: 'Set by HQ legal at the November review.', ...b });
const grant = (db: DatabaseSync, program: string, terms: Record<string, unknown> = NO_SCHEDULE) =>
  call(db, 'POST', `${G}/${program}`, { reason: 'Granted at the November HQ review.', terms });
const accept = (db: DatabaseSync, packageKey: string, offer: string | null = null) =>
  call(db, 'POST', `${P}/licences/${LIC}/package-acceptances`, { package_key: packageKey, package_offer_uid: offer, reason: 'The studio accepted the package offer.' });
const legal = async (db: DatabaseSync) => (await call(db, 'GET', `${P}/licences/${LIC}`)).body;
const statusOf = async (db: DatabaseSync, program: string) => (await legal(db)).programs.find((p: any) => p.program_key === program);
const draft = (db: DatabaseSync, o: Record<string, unknown>) => call(db, 'POST', `${A}/licences/${LIC}/drafts`, { reason: REASON, ...o });
const send = (db: DatabaseSync, uid: string, revision: number) => call(db, 'POST', `${A}/${uid}/send`, { revision, reason: REASON });
const version = (db: DatabaseSync, uid: string) => ({ ...(db.prepare('SELECT * FROM licence_program_agreements WHERE uid = ?').get(uid) as any) });
const count = (db: DatabaseSync, sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).n);

// The completion is stamped now, after the draft and send (which the routes stamp with the real clock): a fixed time
// here sorted before them once the day passed it, and history's oldest-first order read wrong.
async function sign(db: DatabaseSync, uuid: string, fileSha: string, at = new Date().toISOString()) {
  const e = db.prepare('SELECT id FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid) as any;
  db.prepare("UPDATE esign_recipients SET status = 'signed', signed_at = ? WHERE envelope_id = ?").run(at, e.id);
  const r = db.prepare('SELECT id FROM esign_recipients WHERE envelope_id = ?').get(e.id) as any;
  db.prepare(`INSERT INTO legal_document_files (uid, kind, envelope_id, recipient_id, file_sha256, file_bytes, content_type, renderer, paper_sha256)
              VALUES (?, 'signed_copy', ?, ?, ?, 100, 'application/pdf', 'pdf_lib', ?)`).run(`f_${uuid}`, e.id, r.id, fileSha, 'p'.repeat(64));
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = ? WHERE id = ?").run(at, e.id);
  const saved = [console.warn, console.log]; console.warn = () => {}; console.log = () => {};
  try { return await onAgreementEnvelopeCompleted({ DB: d1Over(db) } as any, uuid, at); } finally { [console.warn, console.log] = saved; }
}

/** Draft, send and sign one agreement; answers its uid. */
async function execute(db: DatabaseSync, o: Record<string, unknown>, fileSha: string) {
  const d = await draft(db, o);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const s = await send(db, d.body.agreement.uid, d.body.agreement.revision);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const v = version(db, d.body.agreement.uid);
  await sign(db, v.envelope_uuid, fileSha);
  return d.body.agreement.uid as string;
}
const LEARNING_LICENCE = { agreement_kind: 'program_licence', program_key: 'learning', template_slug: 'program_learning_licence' };
const CORE_MASTER = { agreement_kind: 'package_master', package_key: 'core_network', template_slug: 'package_core_network_master', package_version: 1 };
const coreAddendum = (program: string) => ({ agreement_kind: 'package_addendum', package_key: 'core_network', addendum_key: program, template_slug: 'package_core_network_master', package_version: 1 });

async function branchSees(db: DatabaseSync, program: string) {
  const copy = parseProgramCopy(JSON.stringify(await programCopy({ DB: d1Over(db) } as any, 1)))!;
  const licence = { uid: LIC, licence_ref: 'AXL-001', brand_name: 'Studio North', kind: 'subsidiary', status: 'active', renews_on: '2027-10-31' } as any;
  return studioPrograms(copy, licence, '2026-11-09').find((p) => p.program_key === program)!;
}

// ═══════════════════════════════════════════════════════════════════ 1, 4, 5, 6

test('1/4/5/6. per-program agreement required: the grant exists before signature, an unsigned agreement holds it, the signature puts it in force', async () => {
  const db = fixture();
  assert.equal((await policy(db, 'program', 'learning', { strategy: 'per_program', legal_gate: 'required_before_in_force' })).status, 201);
  // 4. The grant is made before any signature.
  assert.equal((await grant(db, 'learning')).status, 201);
  let s = await statusOf(db, 'learning');
  assert.equal(s.status, 'granted_agreement_required');
  assert.equal(s.word, 'Granted — agreement required');
  assert.equal(s.legally_in_force, false);
  assert.deepEqual(s.missing, ['program_licence:learning']);
  const holding = (await legal(db)).holdings.find((h: any) => h.scope_key === 'learning');
  assert.equal(holding.policy_version, 1, 'the grant froze the program’s policy version');
  // HQ's own reads agree: the licence page and the grid hold the grant on the agreement.
  const g = (await call(db, 'GET', `${G}`)).body.grants.find((x: any) => x.program_key === 'learning');
  assert.equal(g.in_force, false, 'HQ’s licence page read an unsigned required agreement as in force');
  assert.ok(g.waiting_on.includes('agreement_executed'));
  const grid = (await call(db, 'GET', '/api/admin/program-grants')).body;
  assert.equal(grid.licences[0].grants.learning.in_force, false, 'the grid read an unsigned required agreement as in force');
  assert.equal(grid.tiles.in_force, 0);

  // 5. Sent but unsigned: awaiting signature, still not in force anywhere.
  const d = await draft(db, LEARNING_LICENCE);
  await send(db, d.body.agreement.uid, d.body.agreement.revision);
  s = await statusOf(db, 'learning');
  assert.equal(s.status, 'awaiting_signature');
  assert.equal(s.legally_in_force, false);
  const held = await branchSees(db, 'learning');
  assert.equal(held.standing, 'granted', 'the branch read an unsigned required agreement as in force');
  assert.ok(held.grant.waiting_on.includes('agreement_executed'));

  // 6. The signature: in force, at HQ and on the branch; the gate's satisfaction is recorded once.
  await sign(db, version(db, d.body.agreement.uid).envelope_uuid, 'a'.repeat(64));
  s = await statusOf(db, 'learning');
  assert.equal(s.status, 'in_force');
  assert.equal(s.legally_in_force, true);
  assert.equal((await branchSees(db, 'learning')).standing, 'in_force');
  assert.equal((await call(db, 'GET', '/api/admin/program-grants')).body.tiles.in_force, 1);
  const gates = db.prepare("SELECT action FROM licence_legal_events WHERE program_key = 'learning' AND action LIKE 'gate_%' ORDER BY id").all().map((r: any) => r.action);
  assert.deepEqual(gates, ['gate_unsatisfied', 'gate_satisfied']);
});

// ═══════════════════════════════════════════════════════════════════ 2, 7

test('2/7. package master + schedules: the master is needed by every program, a schedule only by those listed; with 2 of 3 schedules executed, only the third waits', async () => {
  const db = fixture();
  const r = await policy(db, 'package', 'core_network', {
    strategy: 'package_master', legal_gate: 'required_before_in_force',
    programs: ['learning', 'perks', 'mentor-cohorts'], required_schedules: ['learning', 'perks', 'mentor-cohorts'],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await accept(db, 'core_network', 'offer_1')).status, 201);
  for (const p of ['learning', 'perks', 'mentor-cohorts']) assert.equal((await grant(db, p)).status, 201);
  let s = await statusOf(db, 'learning');
  assert.equal(s.requirement.basis, 'package');
  assert.deepEqual(s.missing.sort(), ['package_addendum:learning', 'package_master']);

  await execute(db, CORE_MASTER, 'b'.repeat(64));
  await execute(db, coreAddendum('learning'), 'c'.repeat(64));
  await execute(db, coreAddendum('perks'), 'd'.repeat(64));
  const all = (await legal(db)).programs;
  const by = Object.fromEntries(all.map((p: any) => [p.program_key, p.status]));
  assert.deepEqual(by, { learning: 'in_force', perks: 'in_force', 'mentor-cohorts': 'granted_agreement_required' });
  s = all.find((p: any) => p.program_key === 'mentor-cohorts');
  assert.deepEqual(s.missing, ['package_addendum:mentor-cohorts']);

  // A master executed for ANOTHER package does not count.
  const other = requirementFor('learning', [{ scope_kind: 'package', scope_key: 'venture_building', superseded_at: null, policy_uid: 'x', policy_version: 1,
    policy: { strategy: 'package_master', legal_gate: 'required_before_in_force', programs: ['learning'], required_schedules: [] } } as any]);
  const rows = db.prepare('SELECT * FROM licence_program_agreements').all() as any[];
  const st = programLegalStatus({ program_key: 'learning', state: 'granted', requires_signed_schedule: 0 }, rows, other, { grantInForce: true });
  assert.equal(st.status, 'granted_agreement_required', 'a core_network master satisfied a venture_building requirement');
});

// ═══════════════════════════════════════════════════════════════════ 3

test('3. a no-agreement program is in force with no agreement, and no gate line is written for it', async () => {
  const db = fixture();
  assert.equal((await policy(db, 'program', 'perks', { strategy: 'none' })).status, 201);
  assert.equal((await policy(db, 'program', 'perks', { strategy: 'none', legal_gate: 'required_before_in_force' })).status, 400, 'nothing to sign cannot gate');
  await grant(db, 'perks');
  const s = await statusOf(db, 'perks');
  assert.equal(s.status, 'in_force');
  assert.deepEqual(s.requirement.documents, []);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM licence_legal_events WHERE action LIKE 'gate_%'"), 0);
});

// ═══════════════════════════════════════════════════════════════════ before-grant gate, and the freeze

test('required_before_grant refuses the grant until the agreement is executed; then the grant is made', async () => {
  const db = fixture();
  await policy(db, 'program', 'learning', { strategy: 'per_program', legal_gate: 'required_before_grant' });
  const refused = await grant(db, 'learning');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'agreement_required_before_grant');
  assert.deepEqual(refused.body.missing, ['program_licence:learning']);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM program_grants'), 0);
  await execute(db, LEARNING_LICENCE, 'e'.repeat(64));
  assert.equal((await grant(db, 'learning')).status, 201);
  assert.equal((await statusOf(db, 'learning')).status, 'in_force');
});

test('a later strategy change reaches no existing holder: the licence keeps the version it froze', async () => {
  const db = fixture();
  await policy(db, 'program', 'learning', { strategy: 'per_program', legal_gate: 'required_before_in_force' });
  await grant(db, 'learning');
  const v2 = await policy(db, 'program', 'learning', { strategy: 'none' });
  assert.equal(v2.body.policy.version, 2);
  assert.equal(v2.body.reaches_existing_holders, false);
  const l = await legal(db);
  const h = l.holdings.find((x: any) => x.scope_key === 'learning');
  assert.equal(h.policy_version, 1);
  assert.equal(h.behind_latest, true);
  assert.equal(l.programs[0].status, 'granted_agreement_required', 'the new strategy rewrote an existing holder');
  assert.throws(() => db.prepare("UPDATE licence_agreement_policies SET strategy = 'none' WHERE version = 1").run(), /versioned/);
  assert.throws(() => db.prepare('UPDATE licence_agreement_policy_holdings SET policy_version = 2').run(), /never changes/);
  const scope = (await call(db, 'GET', `${P}/program/learning`)).body;
  assert.deepEqual(scope.versions.map((v: any) => v.version), [2, 1]);
  assert.deepEqual(scope.holders_by_version, [{ policy_version: 1, licences: 1 }]);
});

// ═══════════════════════════════════════════════════════════════════ 8, 9

test('8/9. a terms change marks the executed agreement replacement-required, leaves it exactly as signed, and a replacement supersedes it only on signature', async () => {
  const db = fixture();
  await policy(db, 'program', 'learning', { strategy: 'per_program', legal_gate: 'required_before_in_force' });
  await grant(db, 'learning', { ...NO_SCHEDULE, capacity_cap: 40 });
  const old = await execute(db, LEARNING_LICENCE, 'f'.repeat(64));
  const before = version(db, old);
  assert.equal(before.status, 'executed');

  const patch = await call(db, 'PATCH', `${G}/learning`, { reason: 'Capacity raised at the review.', terms: { capacity_cap: 60 } });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const l = await legal(db);
  assert.deepEqual(l.replacements_required.map((r: any) => [r.agreement_uid, r.why]), [[old, 'grant_terms_changed']]);
  // 9. Not voided, not superseded, not edited.
  const after = version(db, old);
  assert.deepEqual([after.status, after.signed_document_sha256, after.body_sha256, after.revision], [before.status, before.signed_document_sha256, before.body_sha256, before.revision]);
  const lines = db.prepare("SELECT agreement_uid, terms_revision, actor_user_id, reason FROM licence_legal_events WHERE action = 'replacement_required'").all() as any[];
  assert.equal(lines.length, 1);
  assert.deepEqual({ ...lines[0] }, { agreement_uid: old, terms_revision: 2, actor_user_id: SUPER, reason: 'Capacity raised at the review.' });

  // The replacement: a new draft of the same slot while the old one stands; nothing is sent by itself.
  const repl = await draft(db, LEARNING_LICENCE);
  assert.equal(repl.status, 201);
  const prepared = db.prepare("SELECT agreement_uid, actor_user_id, detail_json FROM licence_legal_events WHERE action = 'replacement_prepared'").all() as any[];
  assert.equal(prepared.length, 1);
  assert.deepEqual([prepared[0].agreement_uid, prepared[0].actor_user_id, JSON.parse(prepared[0].detail_json).replaces], [repl.body.agreement.uid, SUPER, old]);
  assert.equal(version(db, old).status, 'executed', 'drafting a replacement touched the executed agreement');
  await send(db, repl.body.agreement.uid, repl.body.agreement.revision);
  await sign(db, version(db, repl.body.agreement.uid).envelope_uuid, '1'.repeat(64));
  const superseded = version(db, old);
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.signed_document_sha256, 'f'.repeat(64), 'the old signed document’s hash changed');
  assert.equal(version(db, repl.body.agreement.uid).status, 'executed');
  assert.deepEqual((await legal(db)).replacements_required, []);
});

// ═══════════════════════════════════════════════════════════════════ 10

test('10. Contracts shows the same canonical document once: one row, its envelope, the agreement uid', async () => {
  const db = fixture();
  await policy(db, 'program', 'learning', { strategy: 'per_program' });
  await grant(db, 'learning');
  const uid = await execute(db, LEARNING_LICENCE, '2'.repeat(64));
  const items = (await call(db, 'GET', '/api/admin/contracts?limit=200')).body.items as any[];
  const rows = items.filter((r) => r.agreement?.agreement_uid === uid);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'esign');
  assert.equal(rows[0].uid, version(db, uid).envelope_uuid);
  const required = (await statusOf(db, 'learning')).requirement.documents.find((d: any) => d.slot_key === 'program_licence:learning');
  assert.equal(required.executed_agreement_uid, uid, 'Program access and Contracts name different documents');
});

// ═══════════════════════════════════════════════════════════════════ 11

test('11. the branch copy carries legal readiness: a package move holds its programs until the new master is executed', async () => {
  const db = fixture();
  await policy(db, 'package', 'core_network', { strategy: 'package_master', programs: ['learning'] });
  await policy(db, 'package', 'venture_building', { strategy: 'package_master', programs: ['learning'] });
  await accept(db, 'core_network');
  await grant(db, 'learning');
  await execute(db, CORE_MASTER, '3'.repeat(64));
  assert.equal((await branchSees(db, 'learning')).standing, 'in_force');
  // The licence moves package: the old master stays executed, needs replacing, and no longer counts.
  const moved = await accept(db, 'venture_building');
  assert.equal(moved.status, 201);
  const l = await legal(db);
  assert.equal(l.programs[0].status, 'granted_agreement_required');
  assert.equal(l.replacements_required[0].why, 'package_changed');
  assert.equal(l.holdings.filter((h: any) => h.scope_kind === 'package' && h.current).length, 1);
  assert.equal((await branchSees(db, 'learning')).standing, 'granted');
  const ev = db.prepare("SELECT detail_json FROM licence_legal_events WHERE action = 'replacement_required'").get() as any;
  assert.deepEqual(JSON.parse(ev.detail_json), { why: 'package_changed', from_package: 'core_network', to_package: 'venture_building' });
});

// ═══════════════════════════════════════════════════════════════════ 12

test('12. a legacy grant with only schedule_contract_uid stays readable: not recorded, the schedule rule as before', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO program_grants (uid, licence_id, program_key, state, requires_signed_schedule, schedule_contract_uid, schedule_signed_at, set_at)
              VALUES ('g_legacy', 1, 'learning', 'granted', 1, 'env-legacy-1', '2026-06-01T10:00:00Z', '2026-06-01T10:00:00Z')`).run();
  const s = await statusOf(db, 'learning');
  assert.equal(s.requirement.basis, 'not_recorded');
  assert.equal(s.status, 'in_force', 'a signed legacy schedule was not read');
  const g = await call(db, 'GET', `${G}`);
  const row = g.body.grants.find((x: any) => x.program_key === 'learning');
  assert.equal(row.schedule.contract_uid, 'env-legacy-1');
  db.prepare("UPDATE program_grants SET schedule_signed_at = NULL WHERE uid = 'g_legacy'").run();
  assert.equal((await statusOf(db, 'learning')).status, 'granted_agreement_required', 'an unsigned legacy schedule read as in force');
});

// ═══════════════════════════════════════════════════════════════════ 13

test('13. no duplicate rows from repeated send, acceptance, grant or gate sync', async () => {
  const db = fixture();
  await policy(db, 'package', 'core_network', { strategy: 'package_master', programs: ['learning'] });
  assert.equal((await accept(db, 'core_network', 'offer_9')).status, 201);
  const again = await accept(db, 'core_network', 'offer_9');
  assert.equal(again.status, 200);
  assert.equal(again.body.unchanged, true);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM licence_agreement_policy_holdings'), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM licence_legal_events WHERE action = 'policy_frozen'"), 1);

  await grant(db, 'learning');
  const d = await draft(db, CORE_MASTER);
  const first = await send(db, d.body.agreement.uid, d.body.agreement.revision);
  assert.equal(first.status, 200);
  const retry = await send(db, d.body.agreement.uid, d.body.agreement.revision);
  assert.notEqual(retry.status, 200, 'a retried send was accepted twice');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM licence_program_agreements WHERE slot_key = 'package_master'"), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM esign_envelopes'), 1);
  const uuid = version(db, d.body.agreement.uid).envelope_uuid;
  await sign(db, uuid, '4'.repeat(64));
  await sign(db, uuid, '4'.repeat(64)).catch(() => null); // a second completion
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM licence_program_agreements WHERE status = 'executed'"), 1);

  const gates = () => count(db, "SELECT COUNT(*) AS n FROM licence_legal_events WHERE action LIKE 'gate_%'");
  const n = gates();
  const lic = { id: 1, uid: LIC, licence_ref: 'AXL-001', brand_name: 'Studio North', kind: 'subsidiary', status: 'active', renews_on: '2027-10-31' } as any;
  const env = { DB: d1Over(db) } as any;
  for (let i = 0; i < 2; i++) {
    const l = await readLicenceLegal(env, lic, '2026-11-09');
    await env.DB.batch(gateSyncStatements(env, LIC, l.programs, { actorId: SUPER, at: '2026-11-09T13:00:00Z', reason: 'resync' }));
  }
  assert.equal(gates(), n, 'a repeated gate sync added lines');
});

// ═══════════════════════════════════════════════════════════════════ history and refusals

test('history: one list, oldest first, every line attributable and in context', async () => {
  const db = fixture();
  await policy(db, 'program', 'learning', { strategy: 'per_program' });
  await grant(db, 'learning');
  await execute(db, LEARNING_LICENCE, '5'.repeat(64));
  const h = (await call(db, 'GET', `${P}/licences/${LIC}/history`)).body.items as any[];
  const actions = h.map((x) => `${x.source}:${x.action}`);
  for (const a of ['legal:policy_frozen', 'legal:gate_unsatisfied', 'agreement:drafted', 'agreement:sent', 'agreement:executed', 'legal:gate_satisfied']) {
    assert.ok(actions.includes(a), `${a} is missing from ${actions.join(', ')}`);
  }
  assert.ok(actions.indexOf('agreement:drafted') < actions.indexOf('agreement:executed'));
  const frozen = h.find((x) => x.action === 'policy_frozen');
  assert.deepEqual([frozen.actor_user_id, frozen.program_key, frozen.policy_version, frozen.reason], [SUPER, 'learning', 1, 'Granted at the November HQ review.']);
  const drafted = h.find((x) => x.action === 'drafted');
  assert.deepEqual([drafted.program_key, drafted.slot_key, drafted.template_slug, drafted.reason], ['learning', 'program_licence:learning', 'program_learning_licence', REASON]);
  assert.throws(() => db.prepare('DELETE FROM licence_legal_events').run(), /append-only/);
});

test('a policy is refused when it does not fit its scope', async () => {
  const db = fixture();
  const bad = async (kind: 'program' | 'package', key: string, b: Record<string, unknown>) => (await policy(db, kind, key, b)).status;
  assert.equal(await bad('program', 'learning', { strategy: 'package_master' }), 400);
  assert.equal(await bad('package', 'core_network', { strategy: 'package_master' }), 400, 'a package with no programs');
  assert.equal(await bad('package', 'core_network', { strategy: 'package_master', programs: ['learning'], required_schedules: ['perks'] }), 400);
  assert.equal(await bad('package', 'core_network', { strategy: 'per_program', programs: ['learning'], required_schedules: ['learning'] }), 400);
  assert.equal(await bad('program', 'learning', { strategy: 'per_program', reason: 'short' }), 400);
  assert.equal((await accept(db, 'core_network')).status, 409, 'a package with no policy was frozen');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM licence_agreement_policies'), 0);
});

test('requirementFor reads only current holdings: a superseded package no longer decides what a program needs', () => {
  const pkg = (key: string, superseded: string | null) => ({ scope_kind: 'package', scope_key: key, superseded_at: superseded, policy_uid: key, policy_version: 1,
    policy: { strategy: 'package_master', legal_gate: 'required_before_in_force', programs: ['learning'], required_schedules: [] } }) as any;
  const r = requirementFor('learning', [pkg('core_network', '2026-11-01T00:00:00Z'), pkg('venture_building', null)]);
  assert.equal(r.package_key, 'venture_building');
  assert.equal(r.documents[0].package_key, 'venture_building', 'a superseded package decided the master');
  assert.equal(requirementFor('learning', [pkg('core_network', '2026-11-01T00:00:00Z')]).basis, 'not_recorded');
});

test('the studio agreement read is scoped and exposes a completed PDF through the existing e-sign route', async () => {
  const db = fixture();
  assert.equal((await policy(db, 'program', 'learning', { strategy: 'per_program', legal_gate: 'required_before_in_force' })).status, 201);
  assert.equal((await grant(db, 'learning')).status, 201);
  const url = '/api/licence/mine/program-agreements';
  const read = () => call(db, 'GET', `${url}?licence_uid=unrelated`, undefined, SIGNER);
  assert.equal((await call(db, 'GET', url)).status, 404, 'an HQ account without licence membership has no studio read');
  const prepared = await draft(db, LEARNING_LICENCE);
  assert.equal(prepared.status, 201);
  assert.deepEqual((await read()).body.agreements, [], 'the studio cannot read an HQ draft');

  const { uid, revision } = prepared.body.agreement;
  assert.equal((await send(db, uid, revision)).status, 200);
  const awaiting = await read();
  assert.equal(awaiting.status, 200);
  assert.deepEqual(awaiting.body.programs.map((p: any) => [p.status, p.waiting_on]), [
    ['awaiting_signature', ['Program licence agreement']],
  ]);
  assert.equal(awaiting.body.agreements[0].signed_envelope_id, null);

  const { envelope_uuid } = version(db, uid);
  await sign(db, envelope_uuid, 'a'.repeat(64));
  db.prepare("UPDATE esign_envelopes SET signed_r2_key = 'esign/signed/example.pdf' WHERE envelope_uuid = ?").run(envelope_uuid);
  const executed = await read();
  assert.equal(executed.body.programs[0].legally_in_force, true);
  assert.ok(executed.body.agreements[0].signed_envelope_id > 0);
  assert.deepEqual(Object.keys(executed.body.agreements[0]).sort(), [
    'agreement_kind', 'effective_from', 'package_key', 'program_key', 'signed_at', 'signed_envelope_id', 'status', 'uid',
  ]);
});
