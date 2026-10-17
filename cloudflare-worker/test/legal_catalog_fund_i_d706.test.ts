// D706 — the template catalog lists the 28 documents Axal VC Spin-Out Lab
// Fund I LP is missing (migration 468), each a stub with no body, classified
// and routed by name.
//
// The fixture is the production table shape (schema_baseline.sql) loaded with
// the catalog's 66 existing rows from the seed migrations, so "an existing
// document does not change" is checked against the real slugs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { getActiveTemplateBody, listTemplates } from '../src/services/legalTemplateStore.ts';
import {
  AXAL_ENTITIES,
  axalEntityKeyForDoc,
  buildExecutionBlock,
  buildPreamble,
  classifyDocument,
  normalizeLegalBody,
} from '../src/services/legalDocFormat.ts';

const MIGRATIONS = 'cloudflare-worker/sql/migrations';
const MIGRATION_468 = readFileSync(`${MIGRATIONS}/468_legal_catalog_fund_i.sql`, 'utf8');

// [layer, slug, title, kind, Axal party] — the issue's table (#1718).
const D706_CATALOG: [string, string, string, string, string][] = [
  ['fund', 'certificate_of_limited_partnership_de', 'Certificate of Limited Partnership (Delaware)', 'unilateral', 'none'],
  ['fund', 'lpa_amended_restated', 'Amended and Restated Limited Partnership Agreement', 'agreement', 'gp'],
  ['fund', 'lpa_initial', 'Initial Limited Partnership Agreement', 'agreement', 'gp'],
  ['fund', 'lp_side_letter', 'LP Side Letter (Standard Form)', 'agreement', 'fund'],
  ['fund', 'mfn_election_form', 'MFN Election Form', 'unilateral', 'none'],
  ['fund', 'lp_investor_questionnaire', 'LP Investor Questionnaire', 'unilateral', 'none'],
  ['fund', 'lp_aml_kyc_certification', 'Investor AML/KYC and Beneficial Ownership Certification', 'unilateral', 'none'],
  ['fund', 'lp_tax_status_certification', 'Tax Status Certification (W-9 / W-8, FATCA and CRS)', 'unilateral', 'none'],
  ['fund', 'lp_electronic_delivery_consent', 'LP Electronic Delivery Consent', 'unilateral', 'none'],
  ['fund', 'gp_closing_certificate', 'GP Acceptance and Closing Certificate', 'resolution', 'gp'],
  ['fund', 'capital_call_notice', 'Capital Call Notice', 'resolution', 'gp'],
  ['fund', 'distribution_notice', 'Distribution Notice', 'resolution', 'gp'],
  ['fund', 'default_notice', 'Default Notice', 'resolution', 'gp'],
  ['fund', 'lp_interest_transfer', 'Transfer of LP Interest (Assignment, Joinder and GP Consent)', 'agreement', 'fund'],
  ['fund', 'lpac_charter', 'LPAC Charter and Written Consent', 'resolution', 'gp'],
  ['fund', 'investment_management_agreement', 'Investment Management Agreement', 'agreement', 'fund'],
  ['gp', 'gp_llc_agreement', 'Axal VC GP LLC — Limited Liability Company Agreement', 'agreement', 'gp'],
  ['gp', 'gp_fund_formation_consent', 'GP Written Consent — Fund I Formation and Closing Resolutions', 'resolution', 'gp'],
  ['gp', 'clawback_guarantee', 'Clawback Guarantee', 'agreement', 'fund'],
  ['gp', 'carried_interest_award_letter', 'Carried Interest Award Letter', 'agreement', 'gp'],
  ['compliance', 'form_d_filing_kit', 'Form D Notice Filing Kit (with State Notices)', 'unilateral', 'none'],
  ['compliance', 'bad_actor_questionnaire_506d', 'Rule 506(d) Bad Actor Questionnaire', 'unilateral', 'none'],
  ['compliance', 'compliance_manual_code_of_ethics', 'Compliance Manual and Code of Ethics', 'policy', 'none'],
  ['compliance', 'investor_privacy_notice_reg_sp', 'Investor Privacy Notice (Regulation S-P)', 'policy', 'none'],
  ['compliance', 'valuation_policy', 'Valuation Policy', 'policy', 'none'],
  ['compliance', 'conflicts_allocation_policy', 'Conflicts of Interest and Allocation Policy', 'policy', 'none'],
  ['portfolio', 'management_rights_letter', 'Management Rights Letter', 'agreement', 'fund'],
  ['portfolio', 'pro_rata_information_rights_side_letter', 'Pro Rata and Information Rights Side Letter', 'agreement', 'fund'],
];
const NEW_SLUGS = D706_CATALOG.map((r) => r[1]);

function fixture() {
  const db = new DatabaseSync(':memory:');
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  db.exec(tableFromBaseline(baseline, 'legal_templates'));
  for (const f of ['085_seed_legal_templates', '105_fill_legal_template_bodies', '113_refresh_legal_template_bodies']) {
    db.exec(readFileSync(`${MIGRATIONS}/${f}.sql`, 'utf8'));
  }
  return { db, env: { DB: d1Over(db) } as any };
}

function rowsBySlug(db: DatabaseSync) {
  const out = new Map<string, any>();
  for (const r of db.prepare('SELECT * FROM legal_templates ORDER BY slug').all() as any[]) out.set(r.slug, { ...r });
  return out;
}

test('D706 the issue lists 28 distinct documents, none of them already in the catalog', () => {
  assert.equal(D706_CATALOG.length, 28);
  assert.equal(new Set(NEW_SLUGS).size, 28);
  const { db } = fixture();
  const existing = rowsBySlug(db);
  assert.equal(existing.size, 66);
  assert.deepEqual(NEW_SLUGS.filter((s) => existing.has(s)), []);
});

test('D706 migration 468 adds the 28 rows as body-less stubs in their layers', () => {
  const { db } = fixture();
  db.exec(MIGRATION_468);
  const rows = rowsBySlug(db);
  assert.equal(rows.size, 66 + 28);
  for (const [layer, slug, title] of D706_CATALOG) {
    const r = rows.get(slug);
    assert.ok(r, `${slug} missing`);
    assert.deepEqual(
      [r.category, r.title, r.is_stub, r.body_md, r.version, r.is_active, r.merge_fields],
      [layer, title, 1, '', 1, 1, '[]'],
      slug,
    );
  }
});

test('D706 a second run of 468 adds nothing, and a row with the same slug is left as it is', () => {
  const { db } = fixture();
  db.exec("INSERT INTO legal_templates (slug, title, category, body_md, version, is_stub) VALUES ('valuation_policy', 'Our Valuation Policy', 'gp', 'Counsel text', 3, 0)");
  const admin = rowsBySlug(db).get('valuation_policy');
  db.exec(MIGRATION_468);
  const once = rowsBySlug(db);
  assert.equal(once.size, 67 + 27);
  assert.deepEqual(once.get('valuation_policy'), admin);
  db.exec(MIGRATION_468);
  assert.deepEqual(rowsBySlug(db), once);
});

test('D706 no existing document changes: rows, store bodies and the Templates list are identical', async () => {
  const { db, env } = fixture();
  const before = rowsBySlug(db);
  const bodies = new Map<string, string | null>();
  for (const slug of before.keys()) bodies.set(slug, await getActiveTemplateBody(env, slug));
  const listed = (await listTemplates(env)).filter((t) => before.has(t.slug));

  db.exec(MIGRATION_468);

  const after = rowsBySlug(db);
  for (const [slug, row] of before) assert.deepEqual(after.get(slug), row, slug);
  for (const [slug, body] of bodies) {
    const now = await getActiveTemplateBody(env, slug);
    assert.equal(now, body, slug);
    // What a send or preview renders from the store body: byte-identical.
    assert.equal(normalizeLegalBody(now || ''), normalizeLegalBody(body || ''), slug);
  }
  assert.deepEqual((await listTemplates(env)).filter((t) => before.has(t.slug)), listed);
  // A new stub has no store body, so no send can pick it up as text.
  for (const slug of NEW_SLUGS) assert.equal(await getActiveTemplateBody(env, slug), null, slug);
});

test('D706 every new slug classifies and routes as the table says', () => {
  for (const [, slug, , kind, party] of D706_CATALOG) {
    assert.equal(classifyDocument(slug), kind, `${slug} kind`);
    if (party !== 'none') assert.equal(axalEntityKeyForDoc(slug, null), party, `${slug} party`);
  }
});

test('D706 each new document previews with its Axal party, or with none', () => {
  for (const [, slug, title, kind, party] of D706_CATALOG) {
    // A policy has no execution block at all: pdf.ts and PaperPreview skip it.
    if (kind === 'policy') continue;
    const block = buildExecutionBlock({ kind: kind as any, axalEntityName: AXAL_ENTITIES[axalEntityKeyForDoc(slug)].name });
    const axal = block.parties.filter((p) => p.role === 'axal');
    if (party === 'none') {
      // A unilateral filing carries only the filer, and no preamble.
      assert.deepEqual(block.parties.map((p) => p.role), ['counterparty'], slug);
      continue;
    }
    assert.deepEqual(axal.map((p) => p.heading), [AXAL_ENTITIES[party as 'gp' | 'fund'].name], slug);
    if (kind === 'agreement') {
      const preamble = buildPreamble({ documentTitle: title, axalEntityKey: axalEntityKeyForDoc(slug) });
      assert.ok(preamble.includes(`by and between ${AXAL_ENTITIES[party as 'gp' | 'fund'].name}, `), slug);
    }
  }
});
