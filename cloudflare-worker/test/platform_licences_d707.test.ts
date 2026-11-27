// D707 (#1772) — the two Platform IP Licence stubs (migration 471), Holdings
// as licensor, and the operating-partner agreements routed to Management, by
// name. The fixture is `legal_catalog_fund_i_d706.test.ts`'s: the production
// table shape loaded with the catalog's seed rows, then 468.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tableFromBaseline } from './_baseline.mjs';
import { axalEntityKeyForDoc, classifyDocument } from '../src/services/legalDocFormat.ts';

const MIGRATIONS = 'cloudflare-worker/sql/migrations';
const MIGRATION_471 = readFileSync(`${MIGRATIONS}/471_platform_ip_licences.sql`, 'utf8');

const LICENCES: [string, string][] = [
  ['platform_ip_licence_management_admin', 'Platform IP Licence Agreement — Management Administration'],
  ['platform_ip_licence_fund_admin', 'Platform IP Licence Agreement — Fund Administration'],
];
const PARTNER_SLUGS = ['partner_msa_v1', 'partner_services', 'partner_equity', 'partner_revshare', 'partner_custom', 'partner_nda_nonsolicit'];

function fixture() {
  const db = new DatabaseSync(':memory:');
  const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
  db.exec(tableFromBaseline(baseline, 'legal_templates'));
  for (const f of ['085_seed_legal_templates', '105_fill_legal_template_bodies', '113_refresh_legal_template_bodies', '468_legal_catalog_fund_i']) {
    db.exec(readFileSync(`${MIGRATIONS}/${f}.sql`, 'utf8'));
  }
  return db;
}
const rowsBySlug = (db: DatabaseSync) => {
  const out = new Map<string, any>();
  for (const r of db.prepare('SELECT * FROM legal_templates ORDER BY slug').all() as any[]) out.set(r.slug, { ...r });
  return out;
};

test('D707 migration 471 adds the two licences as body-less stubs in the gp layer', () => {
  const db = fixture();
  const before = rowsBySlug(db);
  for (const [slug] of LICENCES) assert.equal(before.has(slug), false, `${slug} already exists`);
  db.exec(MIGRATION_471);
  const after = rowsBySlug(db);
  assert.equal(after.size, before.size + 2);
  for (const [slug, title] of LICENCES) {
    const r = after.get(slug);
    assert.ok(r, slug);
    assert.deepEqual([r.category, r.title, r.is_stub, r.body_md, r.version, r.is_active, r.merge_fields], ['gp', title, 1, '', 1, 1, '[]'], slug);
  }
  for (const [slug, row] of before) assert.deepEqual(after.get(slug), row, `${slug} changed`);
});

test('D707 a second run of 471 adds nothing, and a row already holding the slug is untouched', () => {
  const db = fixture();
  db.exec("INSERT INTO legal_templates (slug, title, category, body_md, version, is_stub) VALUES ('platform_ip_licence_fund_admin', 'Counsel draft', 'gp', 'Counsel text', 2, 0)");
  const admin = rowsBySlug(db).get('platform_ip_licence_fund_admin');
  db.exec(MIGRATION_471);
  const once = rowsBySlug(db);
  assert.deepEqual(once.get('platform_ip_licence_fund_admin'), admin);
  db.exec(MIGRATION_471);
  assert.deepEqual(rowsBySlug(db), once);
  assert.doesNotMatch(MIGRATION_471.replace(/^--.*$/gm, ''), /\bBEGIN\b|\bCOMMIT\b/, 'no transaction of its own');
});

test('D707 the licences route to Holdings and are agreements; partner agreements route to Management', () => {
  for (const [slug] of LICENCES) {
    assert.equal(axalEntityKeyForDoc(slug), 'holdings', slug);
    assert.equal(axalEntityKeyForDoc(slug, 'gp'), 'holdings', `${slug} in the gp layer`);
    assert.equal(classifyDocument(slug), 'agreement', slug);
  }
  for (const slug of PARTNER_SLUGS) assert.equal(axalEntityKeyForDoc(slug), 'management', slug);
  assert.equal(axalEntityKeyForDoc('partner_capital'), 'management', 'a capital partnership is not routed by name');
});

test('D707 every D705 and D706 slug keeps its party (the three notices may be the Fund\'s, #1781)', () => {
  const PARTIES: Record<string, string> = {
    subscription: 'fund', investor_subscription_pro: 'fund', investor_subscription_inst: 'fund', 'subscription booklet & lpa': 'fund',
    'co-investment side letter': 'fund', safe: 'fund', term_sheet: 'fund', spa: 'fund', voting_rights: 'fund',
    lp_side_letter: 'fund', lp_interest_transfer: 'fund', investment_management_agreement: 'fund', clawback_guarantee: 'fund',
    management_rights_letter: 'fund', pro_rata_information_rights_side_letter: 'fund',
    lpa_amended_restated: 'gp', lpa_initial: 'gp', gp_closing_certificate: 'gp', lpac_charter: 'gp', gp_llc_agreement: 'gp',
    gp_fund_formation_consent: 'gp', carried_interest_award_letter: 'gp',
    ip_license: 'holdings', mgmt_company: 'gp', tos_v1: 'management',
  };
  for (const [slug, party] of Object.entries(PARTIES)) assert.equal(axalEntityKeyForDoc(slug), party, slug);
  for (const slug of ['capital_call_notice', 'distribution_notice', 'default_notice']) {
    assert.ok(['gp', 'fund'].includes(axalEntityKeyForDoc(slug)), slug);
  }
});
