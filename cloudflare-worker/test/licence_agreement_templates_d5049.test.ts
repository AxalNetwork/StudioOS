/**
 * D5049 (#5049, part 2 of #5047) — package and program agreements: templates, namespaced merge fields, and
 * one frozen e-sign lifecycle that reuses D4671's guarantees.
 *
 *   1. Hash equality: the previewed body is the stored body is the envelope's body, and the three hashes are
 *      one value. Nothing reaches `licence_contracts`.
 *   2. Merge completeness: a value nobody recorded and an ad hoc flat key both stay visible, are named in the
 *      readiness, and block the send before any envelope exists. A missing template, a template for another
 *      program or kind, and a schedule are refused at the draft.
 *   3. Version freezing: a draft keeps the template version and the values it was rendered from when the
 *      template or the licence changes later; a tampered stored body is refused; the text of a sent version is
 *      frozen at the database.
 *   4. A send racing another write loses, links nothing and voids the envelope it made; the version that won is
 *      untouched.
 *   5. A signature racing a void wins; the void loses whole.
 *   6. An amendment is sent while the executed version stays in force, and supersedes it only when it is
 *      executed; the earlier signed document's hash never changes. A completion on a voided version records the
 *      signature and stays voided.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_agreement_templates_d5049.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import grantsRoute from '../src/routes/admin_program_grants.ts';
import agreementsRoute from '../src/routes/admin_licence_agreements.ts';
import { onAgreementEnvelopeCompleted } from '../src/services/programAgreements.ts';
import { AGREEMENT_TEMPLATES, agreementMergeValues, readinessOf } from '../src/services/agreementTemplates.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, SIGNER = 3;
const LIVE = 'lic_live';
const REASON = 'Agreed at the November HQ review.';
const SLUG = 'program_learning_licence';
const BODY_V1 = [
  '# {{program.name}} Programme Licence',
  '',
  'Between Axal and {{entity.legal_name}} (licence {{licence.licence_ref}}), for {{licence.territory}}.',
  'Capacity under the grant: {{grant.capacity_cap}}.',
  'Signed for the licensee by {{signer.name}}, {{signer.title}}.',
].join('\n');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

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

function fixture(body = BODY_V1) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.exec(SEED);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SIGNER, 'partner', 'Lee Licensee', 'lee@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(SUPER, `totp-${SUPER}`);
  db.prepare(`INSERT INTO territory_licences (id, uid, licence_ref, legal_entity_name, brand_name, signatory_name, signatory_title, status, renews_on)
              VALUES (1, ?, 'AXL-001', 'Studio North SAS', 'Studio North', 'Lee Licensee', 'Managing Director', 'active', '2027-10-31')`).run(LIVE);
  db.prepare("INSERT INTO licence_territories (licence_id, country_code) VALUES (1, 'FR')").run();
  db.prepare("INSERT INTO licence_admins (licence_id, user_id, admin_role) VALUES (1, ?, 'principal')").run(SIGNER);
  db.prepare("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active, is_stub) VALUES (?, 'Learning Programme Licence', 'compliance', ?, 1, 1, 0)").run(SLUG, body);
  return db;
}

type Race = { match: string; run: () => void };
function wrap(db: DatabaseSync, race?: Race) {
  const d1: any = d1Over(db);
  let pending = race ?? null;
  return {
    ...d1,
    prepare(sql: string) { const api = d1.prepare(sql); api.sql = sql; return api; },
    batch: async (stmts: any[]) => {
      if (pending && String(stmts[0]?.sql).includes(pending.match)) { const r = pending; pending = null; r.run(); }
      return d1.batch(stmts);
    },
  };
}

const app = new Hono<any>();
app.route('/api/admin/program-grants', grantsRoute);
app.route('/api/admin/licence-agreements', agreementsRoute);
async function call(db: DatabaseSync, method: string, path: string, body?: unknown, race?: Race) {
  const token = await new SignJWT({ user_id: SUPER, role: 'admin', jti: `totp-${SUPER}` }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error, console.log]; console.warn = () => {}; console.error = () => {}; console.log = () => {};
  try {
    const res = await withThrownResponses(() => app.request(path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { JWT_SECRET, ENVIRONMENT: 'development', DB: wrap(db, race) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error, console.log] = saved; }
}
const A = '/api/admin/licence-agreements';
const grantLearning = (db: DatabaseSync, terms: Record<string, unknown> = { capacity_cap: 40 }) =>
  call(db, 'POST', `/api/admin/program-grants/licences/${LIVE}/learning`, { reason: 'Granted at the November HQ review.', terms });
const draft = (db: DatabaseSync, o: Record<string, unknown> = {}) =>
  call(db, 'POST', `${A}/licences/${LIVE}/drafts`, { agreement_kind: 'program_licence', program_key: 'learning', template_slug: SLUG, reason: REASON, ...o });
const send = (db: DatabaseSync, uid: string, revision: number, race?: Race) => call(db, 'POST', `${A}/${uid}/send`, { revision, reason: REASON }, race);
const voidIt = (db: DatabaseSync, uid: string, revision: number, race?: Race) => call(db, 'POST', `${A}/${uid}/void`, { revision, reason: 'The studio asked for new terms.' }, race);
const version = (db: DatabaseSync, uid: string) => ({ ...(db.prepare('SELECT * FROM licence_program_agreements WHERE uid = ?').get(uid) as any) });
const envelope = (db: DatabaseSync, uuid: string) => ({ ...(db.prepare('SELECT * FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid) as any) });
const envelopes = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM esign_envelopes').get() as any).n;
/** The signer signs: the recipient row, a signed copy, the envelope completed; then the completion hook. */
async function sign(db: DatabaseSync, uuid: string, fileSha: string, at = '2026-11-05T12:00:00Z') {
  const e = db.prepare('SELECT id FROM esign_envelopes WHERE envelope_uuid = ?').get(uuid) as any;
  db.prepare("UPDATE esign_recipients SET status = 'signed', signed_at = ? WHERE envelope_id = ?").run(at, e.id);
  const r = db.prepare('SELECT id FROM esign_recipients WHERE envelope_id = ?').get(e.id) as any;
  db.prepare(`INSERT INTO legal_document_files (uid, kind, envelope_id, recipient_id, file_sha256, file_bytes, content_type, renderer, paper_sha256)
              VALUES (?, 'signed_copy', ?, ?, ?, 100, 'application/pdf', 'pdf_lib', ?)`).run(`f_${uuid}`, e.id, r.id, fileSha, 'p'.repeat(64));
  db.prepare("UPDATE esign_envelopes SET status = 'completed', completed_at = ? WHERE id = ?").run(at, e.id);
  return onAgreementEnvelopeCompleted({ DB: d1Over(db) } as any, uuid, at);
}

test('1. hash equality: preview, stored body and envelope are one document with one hash', async () => {
  const db = fixture();
  assert.equal((await grantLearning(db)).status, 201);
  const d = await draft(db);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const v = d.body.agreement;
  assert.equal(v.status, 'ready', 'every field filled and a signer on file: ready');
  assert.equal(v.template_version, 1);
  assert.match(v.body_md, /Between Axal and Studio North SAS \(licence AXL-001\), for FR\./);
  assert.match(v.body_md, /Capacity under the grant: 40\./);
  assert.match(v.body_md, /Signed for the licensee by Lee Licensee, Managing Director\./);
  assert.equal(v.body_sha256, sha(v.body_md));
  const preview = await call(db, 'GET', `${A}/${v.uid}/preview`);
  assert.equal(preview.status, 200);
  assert.deepEqual([preview.body.body_md, preview.body.body_sha256, preview.body.body_matches, preview.body.readiness.ready], [v.body_md, v.body_sha256, true, true]);

  const s = await send(db, v.uid, v.revision);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const e = envelope(db, s.body.envelope.uuid);
  assert.equal(e.document_body, preview.body.body_md, 'the envelope carries the previewed body, byte for byte');
  assert.equal(e.body_sha256, preview.body.body_sha256, 'and its hash');
  assert.equal(e.document_type, SLUG);
  assert.equal(e.template_version, 1);
  const sent = version(db, v.uid);
  assert.deepEqual([sent.status, sent.envelope_uuid, sent.body_sha256, sent.revision], ['sent', e.envelope_uuid, e.body_sha256, 1]);
  assert.deepEqual((db.prepare('SELECT action FROM licence_agreement_events WHERE agreement_uid = ? ORDER BY id').all(v.uid) as any[]).map((x) => x.action), ['drafted', 'sent']);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action IN ('licence_agreement_drafted', 'licence_agreement_sent')").get() as any).n, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM licence_contracts').get() as any).n, 0, 'no program agreement reaches licence_contracts');

  const done = await sign(db, e.envelope_uuid, 's'.repeat(64));
  assert.equal(done!.executed, true);
  const ex = version(db, v.uid);
  assert.deepEqual([ex.status, ex.signed_document_sha256, ex.body_sha256], ['executed', 's'.repeat(64), e.body_sha256], 'the signed document is recorded beside the body it signed');
  db.close();
});

test('2. merge completeness: unrecorded values and flat keys block the send; templates are checked at the draft', async () => {
  const db = fixture('# {{program.name}}\n\nFee: {{grant.fee_cents}}. Brand: {{brand_name}}. Package: {{package.name}}.');
  await grantLearning(db);
  const d = await draft(db);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const v = d.body.agreement;
  assert.equal(v.status, 'draft', 'an unfilled field keeps it a draft');
  assert.match(v.body_md, /Fee: \{\{grant\.fee_cents\}\}\. Brand: \{\{brand_name\}\}\./, 'an unfilled field stays visible, never blanked');
  assert.deepEqual(v.readiness.unresolved_fields, ['grant.fee_cents', 'brand_name', 'package.name']);
  assert.deepEqual(v.readiness.non_namespaced_fields, ['brand_name'], 'an ad hoc flat key is named as one');
  assert.deepEqual(v.readiness.missing_terms, ['grant.fee_cents', 'package.name']);
  assert.equal(v.readiness.ready, false);
  assert.equal(v.readiness.counsel_review.required, true);
  const before = envelopes(db);
  const s = await send(db, v.uid, v.revision);
  assert.equal(s.status, 409);
  assert.equal(s.body.error, 'agreement_incomplete');
  assert.deepEqual(s.body.unresolved_fields, ['grant.fee_cents', 'brand_name', 'package.name']);
  assert.equal(envelopes(db), before, 'no envelope was made');
  assert.equal(version(db, v.uid).status, 'draft');

  // The template must exist, be this program's, and draft this kind; a schedule is never drafted here.
  assert.equal((await draft(db, { template_slug: 'program_perks_licence' })).body.error, 'wrong_template');
  assert.equal((await draft(db, { template_slug: 'program_spinout_lab_licence', program_key: 'spinout-lab' })).body.error, 'missing_template');
  assert.equal((await draft(db, { agreement_kind: 'package_master', program_key: null, package_key: 'core_network' })).body.error, 'wrong_template');
  assert.equal((await draft(db, { agreement_kind: 'program_schedule' })).body.error, 'schedule_from_program_access');
  assert.equal((await draft(db, { reason: 'short' })).body.error, 'reason_required');

  // No signer on file: the signer's address is missing and the version is not ready.
  const r = readinessOf({ unresolved: [], slug: SLUG, signerKnown: false });
  assert.deepEqual([r.ready, r.missing_signatory_fields], [false, ['signer.email']]);
  // Only namespaced keys are produced.
  const values = agreementMergeValues({
    licence: { uid: LIVE, licence_ref: 'AXL-001', legal_entity_name: 'X', brand_name: 'Y', currency: 'EUR' } as any, territories: [], seats: [],
    licenceTerms: null, grant: null, program_key: null, package_key: 'core_network', package_version: null, signer: null,
    agreement: { kind: 'package_master', prepared_on: '2026-11-08' },
  });
  assert.ok(Object.keys(values).every((k) => k.includes('.')), 'no flat key is ever filled');
  assert.deepEqual([values['package.name'], values['package.version']], ['Core Network', null]);
  assert.equal(AGREEMENT_TEMPLATES.length, new Set(AGREEMENT_TEMPLATES.map((t) => t.slug)).size);
  db.close();
});

test('3. version freezing: later template and licence changes never reach a draft or a sent version', async () => {
  const db = fixture();
  await grantLearning(db);
  const v = (await draft(db)).body.agreement;
  // HQ publishes template version 2, and the licence's legal name changes, after the draft.
  db.prepare("UPDATE legal_templates SET body_md = '# Rewritten {{program.name}}', version = 2 WHERE slug = ?").run(SLUG);
  db.prepare("UPDATE territory_licences SET legal_entity_name = 'Studio North Holdings' WHERE uid = ?").run(LIVE);
  const s = await send(db, v.uid, v.revision);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const e = envelope(db, s.body.envelope.uuid);
  assert.equal(e.template_version, 1, 'the envelope names the version the draft was rendered from');
  assert.match(e.document_body, /Studio North SAS/, 'the values frozen at the draft, never the live ones');
  assert.doesNotMatch(e.document_body, /Rewritten|Holdings/);
  const sent = version(db, v.uid);
  assert.equal(JSON.parse(sent.merge_values_json)['entity.legal_name'], 'Studio North SAS');
  // The database refuses to change the text of a sent version.
  for (const set of ["body_md = 'x'", "title = 'x'", "merge_values_json = '{}'", "unresolved_fields_json = '[\"x\"]'", 'template_version = 2', `body_sha256 = '${'b'.repeat(64)}'`]) {
    assert.throws(() => db.prepare(`UPDATE licence_program_agreements SET ${set}, revision = revision + 1 WHERE uid = ?`).run(v.uid), /frozen/, set);
  }
  // A draft whose stored text was edited after drafting is refused at the send.
  const d2 = (await draft(db, { agreement_kind: 'program_addendum', addendum_key: 'capacity' })).body.agreement;
  db.prepare("UPDATE licence_program_agreements SET body_md = body_md || ' (edited)', revision = revision + 1 WHERE uid = ?").run(d2.uid);
  const tampered = await send(db, d2.uid, d2.revision + 1);
  assert.deepEqual([tampered.status, tampered.body.error], [409, 'agreement_body_changed']);
  // A second draft for a slot supersedes the first draft, keeping it as history.
  const d3 = (await draft(db, { agreement_kind: 'program_addendum', addendum_key: 'capacity' })).body.agreement;
  assert.deepEqual([version(db, d2.uid).status, version(db, d2.uid).superseded_by_uid, version(db, d3.uid).status], ['superseded', d3.uid, 'ready']);
  db.close();
});

test('4. a send that loses a race links nothing and voids the envelope it made', async () => {
  const db = fixture();
  await grantLearning(db);
  const v = (await draft(db)).body.agreement;
  // Another send wins between this one's envelope and its link.
  const s = await send(db, v.uid, v.revision, {
    match: "SET status = 'sent', envelope_uuid = ?",
    run: () => db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, document_type, document_title, document_body, body_sha256, status, created_by) VALUES ('env-winner', ?, 't', 'b', ?, 'sent', 1)`).run(SLUG, v.body_sha256)
      && db.prepare("UPDATE licence_program_agreements SET status = 'sent', envelope_uuid = 'env-winner', sent_at = 'now', revision = revision + 1 WHERE uid = ?").run(v.uid),
  });
  assert.deepEqual([s.status, s.body.error], [409, 'agreement_changed']);
  const row = version(db, v.uid);
  assert.deepEqual([row.status, row.envelope_uuid], ['sent', 'env-winner'], 'the winner is untouched');
  const loser = db.prepare("SELECT status FROM esign_envelopes WHERE envelope_uuid <> 'env-winner'").all() as any[];
  assert.deepEqual(loser.map((x) => x.status), ['void'], 'the losing envelope signs nothing and is voided');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM licence_agreement_events WHERE action = 'sent'").get() as any).n, 0, 'the loser wrote no history');
  // Sending again is refused: it is out already. So is a new draft while it is out.
  assert.equal((await send(db, v.uid, row.revision)).body.error, 'not_sendable');
  const again = await draft(db);
  assert.deepEqual([again.status, again.body.error, again.body.agreement_uid], [409, 'in_flight', v.uid]);
  db.close();
});

test('5. a signature racing a void wins; the void loses whole', async () => {
  const db = fixture();
  await grantLearning(db);
  const v = (await draft(db)).body.agreement;
  const uuid = (await send(db, v.uid, v.revision)).body.envelope.uuid as string;
  const r = await voidIt(db, v.uid, 1, {
    match: "SET status = 'voided'",
    run: () => db.prepare("UPDATE esign_recipients SET status = 'signing' WHERE envelope_id = (SELECT id FROM esign_envelopes WHERE envelope_uuid = ?)").run(uuid),
  });
  assert.deepEqual([r.status, r.body.error], [409, 'agreement_changed']);
  assert.deepEqual([version(db, uuid && v.uid).status, envelope(db, uuid).status], ['sent', 'sent'], 'neither the version nor its envelope was voided');
  assert.equal((await sign(db, uuid, 'a'.repeat(64)))!.executed, true);
  assert.equal(version(db, v.uid).status, 'executed');
  db.close();
});

test('6. an amendment supersedes the executed version only when it is executed; a voided version stays voided', async () => {
  const db = fixture();
  await grantLearning(db);
  const a = (await draft(db)).body.agreement;
  const ua = (await send(db, a.uid, a.revision)).body.envelope.uuid as string;
  await sign(db, ua, '1'.repeat(64));
  // Drafting and sending the amendment leaves A executed.
  const b = (await draft(db)).body.agreement;
  assert.equal(version(db, a.uid).status, 'executed');
  const ub = (await send(db, b.uid, b.revision)).body.envelope.uuid as string;
  assert.deepEqual([version(db, a.uid).status, version(db, b.uid).status], ['executed', 'sent']);
  // A cannot be sent again, and a late second completion of A changes nothing.
  assert.equal((await send(db, a.uid, version(db, a.uid).revision)).body.error, 'not_sendable');
  await onAgreementEnvelopeCompleted({ DB: d1Over(db) } as any, ua, '2026-11-09T00:00:00Z');
  assert.equal(version(db, a.uid).signed_at, '2026-11-05T12:00:00Z');
  // B executes: A is superseded by it, its signed hash kept.
  await sign(db, ub, '2'.repeat(64), '2026-11-07T10:00:00Z');
  const [va, vb] = [version(db, a.uid), version(db, b.uid)];
  assert.deepEqual([va.status, va.superseded_by_uid, va.signed_document_sha256, va.effective_to], ['superseded', b.uid, '1'.repeat(64), '2026-11-07']);
  assert.deepEqual([vb.status, vb.signed_document_sha256], ['executed', '2'.repeat(64)]);

  // A version voided before its signature lands records the signature and stays voided.
  const c = (await draft(db)).body.agreement;
  const uc = (await send(db, c.uid, c.revision)).body.envelope.uuid as string;
  assert.equal((await voidIt(db, c.uid, version(db, c.uid).revision)).status, 200);
  assert.equal(envelope(db, uc).status, 'void');
  await sign(db, uc, '3'.repeat(64));
  assert.deepEqual([version(db, c.uid).status, version(db, c.uid).signed_at !== null, version(db, b.uid).status], ['voided', true, 'executed'],
    'a signature on a voided version replaces nothing');
  db.close();
});

test('7. an envelope already pending for this signer, built from other text, is never linked', async () => {
  const db = fixture();
  await grantLearning(db);
  const v = (await draft(db)).body.agreement;
  const id = version(db, v.uid).id;
  // An earlier envelope for the same document, sender, signer and version id, still out, with other text.
  const e = db.prepare(`INSERT INTO esign_envelopes (envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by)
                        VALUES ('env-old', ?, ?, ?, 't', 'older text', ?, 'sent', ?) RETURNING id`).get(SIGNER, id, SLUG, sha('older text'), SUPER) as any;
  db.prepare("INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, signing_token, token_expires_at, status) VALUES (?, ?, 'lee@example.test', 'tok-old', '2099-01-01', 'pending')").run(e.id, SIGNER);
  const s = await send(db, v.uid, v.revision);
  assert.deepEqual([s.status, s.body.error, s.body.envelope_uuid], [409, 'envelope_body_mismatch', 'env-old']);
  const row = version(db, v.uid);
  assert.deepEqual([row.status, row.envelope_uuid, row.revision], ['ready', null, v.revision], 'nothing was linked');
  db.close();
});
