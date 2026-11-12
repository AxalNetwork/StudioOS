/**
 * D5050 (#5050, part 3 of #5047) — the Contracts registry indexes the licence agreements: the master territory
 * licence agreement, the package agreements and the program agreements.
 *
 *   1. One canonical document appears once: a version with an envelope is that envelope's row (no second
 *      row, no duplicate envelope); a version with no envelope is a row of its own; the existing sources stay.
 *   2. Filters isolate package and program agreements, by type, legal state, licence, program, package and
 *      signed date; an unknown value is refused.
 *   3. The licence, territory, program and package context is on the row, with deep links.
 *   4. The row's legal state is the document's: a paused grant leaves its executed schedule executed, and an
 *      executed version a newer one replaced reads superseded even though its envelope reads signed.
 *
 * The database is the baseline plus every migration (`_schema_once.mjs`). Every studio, person and figure is
 * made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contracts_licence_agreements_d5050.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import contractsRoute from '../src/routes/admin_contracts.ts';
import grantsRoute from '../src/routes/admin_program_grants.ts';
import agreementsRoute from '../src/routes/admin_licence_agreements.ts';
import { onProgramScheduleEnvelopeCompleted } from '../src/services/programSchedule.ts';
import { onAgreementEnvelopeCompleted } from '../src/services/programAgreements.ts';
import { programAgreementLegalStatus, licenceContractLegalStatus } from '../src/services/contractAgreementSources.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const REASON = 'Agreed at the November HQ review.';

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

const app = new Hono<any>();
app.route('/api/admin/contracts', contractsRoute);
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
const list = async (db: DatabaseSync, q = '') => {
  const r = await call(db, 'GET', `/api/admin/contracts?limit=200${q}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items as any[];
};

/**
 * A licence holding: a master licence agreement (executed); a learning schedule executed, then superseded by a
 * terms change and a second schedule out for signature; and a Venture Building package agreement drafted, not
 * sent. Beside them, rows of the existing sources: a legacy document and a pairwise NDA.
 */
async function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  db.prepare(`INSERT INTO program_packages (uid, package_key, version, name, status, base_annual_fee_cents, effective_from, created_at)
    VALUES ('example-venture-v2', 'venture_building', 2, 'Venture Building', 'active', 100, '2026-01-01', '2026-01-01T00:00:00Z')`).run();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  u.run(4, 'investor', 'Ivy Investor', 'ivy@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, signatory_name, signatory_title, status, renews_on)
              VALUES (1, ?, 'AXL-001', 'Studio North SAS', 'Studio North', 'Lee Licensee', 'Managing Director', 'active', '2027-10-31')`).run(LIVE);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES ('package_venture_building_master', 'Venture Building Package Agreement', 'compliance', '# {{package.name}} for {{entity.legal_name}}', 3, 1, 0)").run();
  // The master licence agreement, executed through its envelope.
  db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at, signed_r2_key, created_at)
              VALUES ('env-master', ?, 'subsidiary_licence_agreement', 'Subsidiary Licence Agreement', 'body', ?, 'completed', 1, '2026-09-01T00:00:00Z', 'esign/signed/env-master/f.pdf', '2026-08-20T00:00:00Z')`).run(SIGNER, 'm'.repeat(64));
  db.prepare(`INSERT INTO licence_contracts (uid, licence_uid, template_slug, template_version, template_title, body_md, body_sha256, unfilled_fields, status, envelope_uid, created_at, updated_at, sent_at)
              VALUES ('lc-1', ?, 'subsidiary_licence_agreement', 3, 'Subsidiary Licence Agreement', 'body', ?, '[]', 'sent', 'env-master', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z', '2026-08-20T00:00:00Z')`).run(LIVE, 'm'.repeat(64));
  // Existing sources.
  db.prepare("INSERT INTO documents (uid, title, doc_type, status, template_name, created_at) VALUES ('doc-1', 'SAFE — Acme', 'safe', 'generated', 'safe', '2026-07-01T00:00:00Z')").run();
  db.prepare("INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id, status) VALUES (3, 4, 'pending')").run();

  const G = '/api/admin/program-grants';
  assert.equal((await call(db, 'POST', `${G}/licences/${LIVE}/learning`, { reason: 'Granted at the November HQ review.', terms: { capacity_cap: 40 } })).status, 201);
  const s1 = await call(db, 'POST', `${G}/licences/${LIVE}/learning/schedule/send`, { reason: REASON });
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const env1 = s1.body.grant.schedule.contract_uid as string;
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = '2026-10-02T00:00:00Z', signed_r2_key = 'esign/signed/x.pdf' WHERE envelope_uuid = ?").run(env1);
  await onProgramScheduleEnvelopeCompleted({ DB: d1Over(db) } as any, env1, '2026-10-02T00:00:00Z');
  assert.equal((await call(db, 'PATCH', `${G}/licences/${LIVE}/learning`, { reason: 'Capacity raised after the November review.', terms: { capacity_cap: 60 } })).status, 200);
  const s2 = await call(db, 'POST', `${G}/licences/${LIVE}/learning/schedule/send`, { reason: REASON });
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  const env2 = s2.body.grant.schedule.contract_uid as string;
  const pkg = await call(db, 'POST', `/api/admin/licence-agreements/licences/${LIVE}/drafts`, {
    agreement_kind: 'package_master', package_key: 'venture_building', template_slug: 'package_venture_building_master', package_version: 2, reason: REASON,
  });
  assert.equal(pkg.status, 201, JSON.stringify(pkg.body));
  return { db, env1, env2, pkgUid: pkg.body.agreement.uid as string };
}

test('1. one canonical document appears once; no envelope is listed twice; the existing sources stay', async () => {
  const { db, env1, env2, pkgUid } = await fixture();
  const items = await list(db);
  const envelopesOnFile = (db.prepare('SELECT envelope_uuid FROM esign_envelopes').all() as any[]).map((r) => r.envelope_uuid);
  const esign = items.filter((r) => r.source === 'esign');
  assert.deepEqual(esign.map((r) => r.uid).sort(), [...envelopesOnFile].sort(), 'each envelope once');
  const envelopeUids = items.map((r) => r.source === 'esign' ? r.uid : r.envelope_uuid).filter(Boolean);
  assert.equal(new Set(envelopeUids).size, envelopeUids.length, 'no envelope reaches the list through two sources');
  const versions = [
    ...(db.prepare('SELECT uid FROM licence_program_agreements').all() as any[]).map((r) => r.uid),
    ...(db.prepare('SELECT uid FROM licence_contracts').all() as any[]).map((r) => r.uid),
  ];
  const listed = items.filter((r) => r.agreement).map((r) => r.agreement.agreement_uid);
  assert.deepEqual([...listed].sort(), [...versions].sort(), 'every licence agreement version is listed, each once');
  // Versions with an envelope ride on its row; the unsent draft is its own row.
  assert.equal(items.find((r) => r.uid === env1).agreement.agreement_kind, 'program_schedule');
  assert.equal(items.find((r) => r.uid === env2).agreement.agreement_kind, 'program_schedule');
  assert.equal(items.find((r) => r.uid === 'env-master').agreement.agreement_type, 'territory_licence');
  const draft = items.find((r) => r.agreement?.agreement_uid === pkgUid);
  assert.deepEqual([draft.source, draft.uid, draft.status, draft.agreement.legal_status, draft.envelope_uuid], ['licence_agreement', `licence_agreement:${pkgUid}`, 'draft', 'draft', null],
    'a draft reads Draft, never as a signed agreement');
  assert.deepEqual([...new Set(items.map((r) => r.source))].sort(), ['documents', 'esign', 'licence_agreement', 'pairwise_nda']);
  const r = await call(db, 'GET', '/api/admin/contracts?limit=1');
  assert.ok(r.body.meta.sources.includes('licence_program_agreements') && r.body.meta.sources.includes('licence_contracts'));
  assert.equal((await call(db, 'GET', '/api/admin/contracts/stats')).status, 200);
  // An envelope's row still opens as an envelope.
  assert.equal((await call(db, 'GET', `/api/admin/contracts/${env2}`)).status, 200);
  db.close();
});

test('2. filters isolate package and program agreements', async () => {
  const { db, env1, env2, pkgUid } = await fixture();
  const uids = async (q: string) => (await list(db, q)).map((r) => r.agreement?.agreement_uid ?? r.uid);
  assert.deepEqual(await uids('&agreement_type=package'), [pkgUid]);
  const schedules = await list(db, '&agreement_type=program_schedule_addendum');
  assert.deepEqual(schedules.map((r) => r.uid).sort(), [env1, env2].sort());
  assert.deepEqual((await list(db, '&agreement_type=territory_licence')).map((r) => r.uid), ['env-master']);
  assert.equal((await list(db, '&agreement_type=program_licence')).length, 0);
  assert.deepEqual((await list(db, '&program=learning')).map((r) => r.uid).sort(), [env1, env2].sort());
  assert.deepEqual(await uids('&package=venture_building'), [pkgUid]);
  assert.equal((await list(db, '&licence=AXL-001')).length, 4, 'by licence reference');
  assert.equal((await list(db, `&licence=${LIVE}`)).length, 4, 'by licence uid');
  assert.equal((await list(db, '&licence=AXL-999')).length, 0);
  assert.deepEqual((await list(db, '&agreement_status=superseded')).map((r) => r.uid), [env1]);
  assert.deepEqual((await list(db, '&agreement_status=awaiting_signature')).map((r) => r.uid), [env2]);
  assert.deepEqual((await list(db, '&agreement_status=executed')).map((r) => r.uid), ['env-master']);
  assert.deepEqual(await uids('&template=package_venture_building_master'), [pkgUid]);
  assert.deepEqual((await list(db, '&signed_from=2026-08-01&signed_to=2026-09-30')).map((r) => r.uid), ['env-master']);
  assert.deepEqual((await list(db, '&q=venture building')).map((r) => r.agreement?.agreement_uid), [pkgUid], 'search reaches the package name');
  for (const bad of ['agreement_type=lease', 'agreement_status=signed', 'program=Spin Out', 'signed_from=yesterday', 'licence=a%20b']) {
    const r = await call(db, 'GET', `/api/admin/contracts?${bad}`);
    assert.equal(r.status, 400, bad);
  }
  db.close();
});

test('3. the licence, territory, program and package context is on the row, with deep links', async () => {
  const { db, env2, pkgUid } = await fixture();
  const items = await list(db);
  const sched = items.find((r) => r.uid === env2).agreement;
  assert.deepEqual([sched.licence_ref, sched.territory, sched.program_name, sched.counterparty, sched.agreement_type_label, sched.template_slug, sched.provider],
    ['AXL-001', ['FR'], 'Learning', 'Studio North SAS', 'Program schedule / addendum', 'program_schedule', 'native']);
  assert.deepEqual(sched.links, { licence: `/admin/licences/${LIVE}`, program_access: `/admin/licences/programs/studio/${LIVE}`, package: null, package_reason: null });
  assert.equal(sched.document_available, false);
  const pkg = items.find((r) => r.agreement?.agreement_uid === pkgUid).agreement;
  assert.deepEqual([pkg.package_name, pkg.package_version, pkg.template_version, pkg.links.program_access, pkg.links.package], ['Venture Building', 2, 3, null, null]);
  assert.match(pkg.links.package_reason, /no package page/);
  assert.match(pkg.document_reason, /Not sent/);
  const master = items.find((r) => r.uid === 'env-master').agreement;
  assert.deepEqual([master.legal_status_label, master.document_available, master.template_version], ['Executed', true, 3]);
  db.close();
});

test('4. the legal state is the document\'s, not the grant\'s', async () => {
  const { db, env1, env2 } = await fixture();
  // The superseded executed schedule: its envelope reads signed; the document is superseded.
  const old = (await list(db)).find((r) => r.uid === env1);
  assert.deepEqual([old.status, old.agreement.legal_status, old.agreement.is_current], ['signed', 'superseded', false]);
  // Sign the current schedule, then pause the grant: the schedule stays executed.
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = '2026-11-03T00:00:00Z' WHERE envelope_uuid = ?").run(env2);
  await onProgramScheduleEnvelopeCompleted({ DB: d1Over(db) } as any, env2, '2026-11-03T00:00:00Z');
  assert.equal((await call(db, 'POST', `/api/admin/program-grants/licences/${LIVE}/learning/pause`, { reason: 'Paused for the studio audit.' })).status, 200);
  const now = (await list(db)).find((r) => r.uid === env2).agreement;
  assert.deepEqual([now.legal_status, now.is_current], ['executed', true]);
  // An envelope voided outside the agreement flow reads voided on a version still marked sent.
  assert.equal(programAgreementLegalStatus('sent', 'void'), 'voided');
  assert.equal(programAgreementLegalStatus('sent', 'completed'), 'executed');
  assert.equal(programAgreementLegalStatus('ready', null), 'draft');
  assert.equal(programAgreementLegalStatus('executed', null), 'executed', 'an executed version whose envelope row is missing (a backfilled schedule) is still executed');
  assert.equal(licenceContractLegalStatus('2026-10-01', 'completed', 'sent'), 'superseded');
  assert.equal(licenceContractLegalStatus(null, null, 'draft'), 'draft');
  assert.equal(typeof onAgreementEnvelopeCompleted, 'function');
  db.close();
});
