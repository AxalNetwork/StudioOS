/**
 * D716 (#1781, the start-now part) — the `notice` and `booklet` document kinds
 * in services/legalDocFormat.ts and its mirror, and migration 478's stores.
 * Every name here is made up; no account number appears.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/legal_notice_kinds_d716.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import * as W from '../src/services/legalDocFormat.ts';
import * as M from '../../frontend/src/lib/legalDocFormat.js';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(here, '../sql');
const MIG = resolve(SQL, 'migrations');
const M478 = '478_fund_notices_booklets.sql';

const NOTICES = [
  ['capital_call_notice', 'fund'], ['distribution_notice', 'fund'], ['default_notice', 'fund'],
  ['management_fee_statement', 'fund'], ['management_fee_invoice', 'gp'], ['platform_licence_fee_invoice', 'holdings'],
] as const;

// Every slug the sets on main listed before D716, with its kind and party
// then, minus the three Fund notices this task moves. None may change.
const BEFORE: Array<[string, string, string]> = [
  ['accreditation_v1', 'unilateral', 'gp'],
  ['aml_kyc', 'policy', 'management'],
  ['bad_actor_questionnaire_506d', 'unilateral', 'management'],
  ['bylaws', 'corporate', 'management'],
  ['carried_interest_award_letter', 'agreement', 'gp'],
  ['certificate_of_incorporation_de', 'corporate', 'management'],
  ['certificate_of_limited_partnership_de', 'unilateral', 'management'],
  ['clawback_guarantee', 'agreement', 'fund'],
  ['co-investment side letter', 'agreement', 'fund'],
  ['compliance_manual_code_of_ethics', 'policy', 'management'],
  ['conflicts_allocation_policy', 'policy', 'management'],
  ['data_access_acknowledgment_admin', 'unilateral', 'management'],
  ['ee_articles_of_association', 'corporate', 'management'],
  ['ee_e_residency_application_kit', 'unilateral', 'management'],
  ['ee_founding_resolution', 'corporate', 'management'],
  ['ein_application_kit', 'unilateral', 'management'],
  ['equity_split', 'corporate', 'management'],
  ['form_adv', 'policy', 'management'],
  ['form_d_filing_kit', 'unilateral', 'management'],
  ['gp_closing_certificate', 'resolution', 'gp'],
  ['gp_fund_formation_consent', 'resolution', 'gp'],
  ['gp_llc_agreement', 'agreement', 'gp'],
  ['ic_charter', 'resolution', 'management'],
  ['investment_management_agreement', 'agreement', 'fund'],
  ['investor_privacy_notice_reg_sp', 'policy', 'management'],
  ['investor_subscription_inst', 'agreement', 'fund'],
  ['investor_subscription_pro', 'agreement', 'fund'],
  ['ip_background_schedule', 'corporate', 'holdings'],
  ['ip_license', 'corporate', 'holdings'],
  ['lp_aml_kyc_certification', 'unilateral', 'management'],
  ['lp_electronic_delivery_consent', 'unilateral', 'management'],
  ['lp_interest_transfer', 'agreement', 'fund'],
  ['lp_investor_questionnaire', 'unilateral', 'management'],
  ['lp_side_letter', 'agreement', 'fund'],
  ['lp_tax_status_certification', 'unilateral', 'management'],
  ['lpa_amended_restated', 'agreement', 'gp'],
  ['lpa_initial', 'agreement', 'gp'],
  ['lpac_charter', 'resolution', 'gp'],
  ['management_rights_letter', 'agreement', 'fund'],
  ['member_consent', 'corporate', 'management'],
  ['mentor_engagement_disclaimer', 'unilateral', 'management'],
  ['mfn_election_form', 'unilateral', 'management'],
  ['operating_agreement', 'corporate', 'management'],
  ['privacy_v1', 'policy', 'management'],
  ['pro_rata_information_rights_side_letter', 'agreement', 'fund'],
  ['safe', 'agreement', 'fund'],
  ['section_83b', 'unilateral', 'management'],
  ['sg_acra_form_45_kit', 'unilateral', 'management'],
  ['sg_constitution', 'corporate', 'management'],
  ['sg_first_directors_resolution', 'corporate', 'management'],
  ['spa', 'agreement', 'fund'],
  ['stock_purchase_agreement', 'corporate', 'management'],
  ['subscription', 'agreement', 'fund'],
  ['subscription booklet & lpa', 'agreement', 'fund'],
  ['term_sheet', 'agreement', 'fund'],
  ['tos_v1', 'policy', 'management'],
  ['uk_articles_of_association', 'corporate', 'management'],
  ['uk_form_in01_kit', 'unilateral', 'management'],
  ['uk_memorandum_of_association', 'corporate', 'management'],
  ['valuation_policy', 'policy', 'management'],
  ['voting_rights', 'agreement', 'fund'],
];

test('the seven notice types classify as notice and the packet as booklet, in the Worker and the mirror', () => {
  for (const [slug, party] of NOTICES) {
    for (const lib of [W, M] as any[]) {
      assert.equal(lib.classifyDocument(slug), 'notice', slug);
      assert.equal(lib.axalEntityKeyForDoc(slug), party, `${slug} routes to ${party}`);
    }
  }
  for (const lib of [W, M] as any[]) {
    assert.equal(lib.classifyDocument('payment_instructions_letter'), 'notice');
    assert.equal(lib.classifyDocument('subscription_booklet'), 'booklet');
    assert.equal(lib.axalEntityKeyForDoc('subscription_booklet'), 'fund');
    // The letter is in no party set: its builder takes the purpose's payee.
    assert.equal(lib.axalEntityKeyForDoc('payment_instructions_letter'), 'management');
  }
});

test('every other slug keeps its kind and its party', () => {
  assert.ok(BEFORE.length > 50);
  for (const [slug, kind, party] of BEFORE) {
    assert.equal(W.classifyDocument(slug), kind, `${slug} kind`);
    assert.equal(W.axalEntityKeyForDoc(slug), party, `${slug} party`);
  }
  // The `subscription booklet & lpa` doc type stays an agreement: an inline e-sign body, not this packet.
  assert.equal(W.classifyDocument('subscription booklet & lpa'), 'agreement');
});

test('the mirror gives the same kind, party and block for every slug', () => {
  const slugs = [...BEFORE.map((r) => r[0]), ...NOTICES.map((n) => n[0]), 'payment_instructions_letter', 'subscription_booklet', 'securities_legend', 'service_agreement'];
  for (const slug of slugs) {
    assert.equal(M.classifyDocument(slug), W.classifyDocument(slug), slug);
    assert.equal(M.axalEntityKeyForDoc(slug), W.axalEntityKeyForDoc(slug), slug);
    const opts = { kind: W.classifyDocument(slug), axalEntityKey: W.axalEntityKeyForDoc(slug) };
    assert.deepEqual(M.buildExecutionBlock(opts as any), W.buildExecutionBlock(opts as any), slug);
  }
  assert.deepEqual(M.SUBSCRIPTION_BOOKLET_PARTS, W.SUBSCRIPTION_BOOKLET_PARTS);
  for (const a of [{ to: 'Ada Quill', lpNumber: 12 }, { to: 'Axal VC Spin-Out Lab Fund I LP', from: 'gp' }, { to: null }]) {
    assert.deepEqual(M.buildAddresseeBlock(a as any), W.buildAddresseeBlock(a as any));
  }
});

test('a notice block is the sender alone, issued not signed; the Fund\'s has its through line; a booklet has none', () => {
  const fund = W.buildExecutionBlock({ kind: 'notice', axalEntityKey: 'fund' });
  assert.equal(fund.recital, '');
  assert.equal(fund.parties.length, 1);
  const [p] = fund.parties;
  assert.deepEqual([p.role, p.heading, p.through, p.by, p.isSigner],
    ['axal', 'Axal VC Spin-Out Lab Fund I LP', 'By: Axal VC GP LLC, its general partner', '', false]);
  assert.match(p.name, /^Name: /);
  assert.equal(p.title, 'Title: General Partner');
  assert.match(p.date, /^Date: /);
  const gp = W.buildExecutionBlock({ kind: 'notice', axalEntityKey: 'gp' });
  assert.equal(gp.parties[0].through, undefined);
  assert.equal(gp.parties.some((x) => x.role === 'counterparty'), false, 'no Counterparty line');
  assert.deepEqual(W.buildExecutionBlock({ kind: 'booklet' }), { recital: '', parties: [] });
  // Today's kinds are untouched.
  assert.equal(W.buildExecutionBlock({ kind: 'resolution' }).parties[0].by, 'By: ___________________________');
});

test('the addressee lines, to an LP and between Axal entities', () => {
  assert.deepEqual(W.buildAddresseeBlock({ to: 'Ada Quill', lpNumber: 12 }), ['To: Ada Quill', 'Limited partner no. L12']);
  assert.deepEqual(W.buildAddresseeBlock({ to: 'Axal VC Spin-Out Lab Fund I LP', from: 'gp' }),
    [`From: Axal VC GP LLC, ${W.AXAL_LEGAL_ADDRESS}`, 'To: Axal VC Spin-Out Lab Fund I LP']);
  assert.deepEqual(W.buildAddresseeBlock({ to: '  ' }), ['To: [Addressee]']);
});

test('securities_legend is a policy in both; the booklet lists nine parts in order with Part 9 last', () => {
  assert.equal(W.classifyDocument('securities_legend'), 'policy');
  assert.equal(M.classifyDocument('securities_legend'), 'policy');
  const parts = W.SUBSCRIPTION_BOOKLET_PARTS;
  assert.deepEqual(parts.map((p) => p.part), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(parts.map((p) => p.slug), [
    'securities_legend', null, 'subscription', 'lp_investor_questionnaire', 'lp_aml_kyc_certification',
    'lp_tax_status_certification', 'lp_electronic_delivery_consent', 'lpa_amended_restated', 'gp_closing_certificate',
  ]);
  assert.deepEqual([parts[0].block, parts[1].block], [null, null]);
  const part8 = W.buildExecutionBlock({ ...parts[7].block!, counterpartyName: 'Ada Quill' });
  assert.deepEqual(part8.parties.map((p) => p.role), ['counterparty'], 'Part 8: the applicant alone');
  const part9 = W.buildExecutionBlock(parts[8].block!);
  assert.equal(part9.parties[0].through, 'By: Axal VC GP LLC, its general partner', 'Part 9: the Fund, through its GP');
  const part3 = W.buildExecutionBlock({ ...parts[2].block!, counterpartyName: 'Ada Quill' });
  assert.deepEqual(part3.parties.map((p) => p.heading), ['Axal VC Spin-Out Lab Fund I LP', 'Ada Quill']);
});

// ---------------------------------------------------------------------------
// Migration 478
// ---------------------------------------------------------------------------

const FILES = readdirSync(MIG).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations)
  .filter((f) => migrationNumber(f) > BASELINE_CUTOFF);
function build(upTo?: string) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const f of FILES) { if (upTo && f >= upTo) break; db.exec(readFileSync(resolve(MIG, f), 'utf8')); }
  return db;
}
const one = (db: DatabaseSync, sql: string, ...a: any[]) => ({ ...(db.prepare(sql).get(...a) as any) });
const HASH = 'a'.repeat(64);

function seeded() {
  const db = build();
  db.exec(`INSERT INTO users (id, email, name, role) VALUES (1, 'admin@example.test', 'Ari Admin', 'admin'), (2, 'lp@example.test', 'Ada Quill', 'founder');
    INSERT INTO lp_applications (id, user_id, investor_type, status) VALUES (1, 2, 'individual', 'approved');`);
  return db;
}

test('478 applies over a fresh build, creates nothing that existed, stores no account number, and adds the stub once', () => {
  const before = build(M478);
  for (const t of ['legal_notices', 'legal_notice_files', 'fund_subscription_booklets', 'fund_booklet_answers']) {
    assert.equal(before.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(t), undefined, `${t} is new`);
  }
  assert.equal(before.prepare("SELECT 1 FROM legal_templates WHERE slug = 'securities_legend'").get(), undefined);
  const db = build();
  const cols = (db.prepare("SELECT name FROM pragma_table_info('legal_notices')").all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('account_last4') && cols.includes('bank_account_uid'));
  assert.equal(cols.some((c) => c.includes('account_number') || c.endsWith('_enc')), false, 'no account number column');
  const stub = one(db, "SELECT title, category, body_md, version, is_active, is_stub FROM legal_templates WHERE slug = 'securities_legend'");
  assert.deepEqual(stub, { title: 'Securities Legend — Fund I Offering Documents', category: 'fund', body_md: '', version: 1, is_active: 1, is_stub: 1 });
  db.exec(readFileSync(resolve(MIG, M478), 'utf8'));
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM legal_templates WHERE slug = 'securities_legend'").n, 1, 'a second run adds nothing');
});

function notice(db: DatabaseSync, o: Record<string, unknown> = {}) {
  const v: Record<string, any> = { uid: 'n1', notice_type: 'capital_call_notice', source_ref: 'call_line:1', sender_entity: 'fund', account_last4: '0000',
    reference: 'AXAL-CC-1-L1-1', supersedes_id: null, reason: null, figures_sha256: HASH, ...o };
  return db.prepare(`INSERT INTO legal_notices (uid, notice_type, source_ref, sender_entity, account_last4, reference, figures_json, figures_sha256, supersedes_id, reason, issued_by)
    VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 1)`).run(v.uid, v.notice_type, v.source_ref, v.sender_entity, v.account_last4, v.reference, v.figures_sha256, v.supersedes_id, v.reason);
}

test('legal_notices and legal_notice_files are append-only; one first issue per source and a linear chain', () => {
  const db = seeded();
  notice(db);
  assert.throws(() => notice(db, { uid: 'n2' }), /UNIQUE/, 'one first issue per source');
  assert.throws(() => notice(db, { uid: 'n2', supersedes_id: 1 }), /CHECK/, 'a superseding notice needs its reason');
  notice(db, { uid: 'n2', supersedes_id: 1, reason: 'Corrected due date' });
  assert.throws(() => notice(db, { uid: 'n3', supersedes_id: 1, reason: 'A fork' }), /UNIQUE/, 'the chain stays linear');
  for (const bad of [{ account_last4: '12345' }, { account_last4: '12a4' }, { reference: 'axal-cc' }, { notice_type: 'reminder' }, { sender_entity: 'bank' }]) {
    assert.throws(() => notice(db, { uid: 'nx', source_ref: 'call_line:9', ...bad }), /CHECK/, JSON.stringify(bad));
  }
  assert.throws(() => db.exec("UPDATE legal_notices SET reference = 'X' WHERE id = 1"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM legal_notices WHERE id = 1'), /append-only/);
  const file = db.prepare(`INSERT INTO legal_notice_files (uid, notice_id, stamp, file_sha256, file_bytes, page_size, renderer, paper_sha256, r2_key)
    VALUES (?, 1, 'issued', ?, 10, 'letter', 'browser_run', ?, 'fund-notices/n1/f.pdf')`);
  file.run('f1', HASH, HASH);
  assert.throws(() => file.run('f2', HASH, HASH), /UNIQUE/, 'one file per notice and stamp');
  assert.throws(() => db.exec("UPDATE legal_notice_files SET r2_key = 'x'"), /append-only/);
  assert.throws(() => db.exec('DELETE FROM legal_notice_files'), /append-only/);
});

test('a booklet moves open -> submitted -> withdrawn only, freezes at submit, and its ticks change only while open', () => {
  const db = seeded();
  db.exec("INSERT INTO fund_subscription_booklets (id, uid, application_id) VALUES (1, 'b1', 1)");
  assert.throws(() => db.exec("INSERT INTO fund_subscription_booklets (uid, application_id) VALUES ('b2', 1)"), /UNIQUE/, 'one live booklet per application');
  db.exec("INSERT INTO fund_booklet_answers (booklet_id, field_id, checked, answered_by) VALUES (1, 'lp_investor_questionnaire:1:abcdef012345', 1, 2)");
  db.exec('UPDATE fund_booklet_answers SET checked = 0');
  assert.throws(() => db.exec("UPDATE fund_subscription_booklets SET status = 'submitted' WHERE id = 1"), /CHECK/, 'submit carries the frozen copy');
  db.prepare("UPDATE fund_subscription_booklets SET status = 'submitted', frozen_json = '{}', digest = ?, submitted_at = datetime('now') WHERE id = 1").run(HASH);
  assert.throws(() => db.exec('UPDATE fund_booklet_answers SET checked = 1'), /not open/);
  assert.throws(() => db.exec("INSERT INTO fund_booklet_answers (booklet_id, field_id, checked) VALUES (1, 'x:2:abcdef012345', 1)"), /not open/);
  assert.throws(() => db.exec('DELETE FROM fund_booklet_answers'), /not open/);
  assert.throws(() => db.exec("UPDATE fund_subscription_booklets SET frozen_json = '[]' WHERE id = 1"), /frozen/);
  assert.throws(() => db.exec("UPDATE fund_subscription_booklets SET status = 'open' WHERE id = 1"), /moves only/);
  assert.throws(() => db.exec("UPDATE fund_subscription_booklets SET status = 'withdrawn' WHERE id = 1"), /CHECK/, 'a withdrawal names who and why');
  db.exec("UPDATE fund_subscription_booklets SET status = 'withdrawn', withdrawn_by = 1, withdrawn_reason = 'Applicant asked to restart' WHERE id = 1");
  db.exec("INSERT INTO fund_subscription_booklets (uid, application_id) VALUES ('b2', 1)");
  assert.throws(() => db.exec('DELETE FROM fund_subscription_booklets'), /never deleted/);
  assert.throws(() => db.exec("INSERT INTO fund_subscription_booklets (uid, application_id, fund_slug) VALUES ('b3', 1, 'other-fund')"), /CHECK/);
});

test('D716 #1776\'s paper for a capital call notice prints no signature line and no counterparty block', async () => {
  const { paperModel, paperHtml } = await import('../src/services/legalPaper.ts');
  const html = paperHtml(paperModel({
    title: 'Capital Call Notice', body: 'The Fund calls capital.', slug: 'capital_call_notice', bodySha256: 'a'.repeat(64), state: { kind: 'draft' },
  }), { pageSize: 'letter', cover: 'light', medium: 'screen', fonts: 'omit' });
  assert.ok(!html.includes('By: ___'), 'no signature line');
  assert.ok(!html.includes('[Counterparty Legal Name]'), 'no counterparty block');
  assert.ok(html.includes('Axal VC Spin-Out Lab Fund I LP') && html.includes('By: Axal VC GP LLC, its general partner'), 'the sender, through its GP');
});
