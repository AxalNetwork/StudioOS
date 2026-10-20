/**
 * D803 (#2240) — the Subsidiary licence agreement master template: its section
 * numbers, its merge fields, its seed (migration 514), and how D797's terms
 * read in it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/licence_template_d803.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mergeValues, pctExact, renderContract, termValues } from '../src/services/licenceContract.ts';
import { LICENCE_TERM_KEYS } from '../src/services/licenceTerms.ts';
import { COUNSEL_DRAFT_SLUGS, COUNSEL_REVIEW_SLUGS } from '../src/services/templateFormat.ts';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const TEMPLATE = read('cloudflare-worker/src/templates/legal/subsidiary_licence_agreement_v1.md');
const SEED = read('cloudflare-worker/sql/migrations/514_subsidiary_licence_agreement.sql');
const SLUG = 'subsidiary_licence_agreement';

/**
 * Every section the Licences canvas cites (`design/incoming/Licences Page.dc.html`,
 * the Contract tab's index and the Terms tab's chips), and the three more the
 * issue names (§4.1, §4.5, §6.1).
 */
const CANVAS_SECTIONS = [
  '1.1', '1.2', '1.3', '2.1', '2.4', '2.5', '3.1', '3.2', '3.3',
  '4.2', '4.3', '4.4', '4.6', '4.7', '5.1', '5.2', '5.3', '5.4', '5.5', '5.6',
  '6.2', '7.2', '7.3', '7.4', '8.1', '8.2', '8.3', '8.4', '8.5', '8.6', '19.2', '19.5', '22',
];
const ISSUE_SECTIONS = ['4.1', '4.5', '6.1'];

/** The section numbers the template defines: each `## N.` heading and each `N.M` clause. */
function definedSections(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/^## (\d+)\. /gm)) out.add(m[1]);
  for (const m of body.matchAll(/^(\d+\.\d+) /gm)) out.add(m[1]);
  return out;
}

test('every section the canvas cites, and every one the issue names, exists in the template', () => {
  // Mutation checked: renumber §5.3 → this names it.
  const defined = definedSections(TEMPLATE);
  const missing = [...CANVAS_SECTIONS, ...ISSUE_SECTIONS].filter((s) => !defined.has(s));
  assert.deepEqual(missing, []);
  // The canvas lives on #2228's branch until it merges; once it is here, its citations are read, not retyped.
  const canvas = resolve(ROOT, 'design/incoming/Licences Page.dc.html');
  if (existsSync(canvas)) {
    const cited = [...new Set([...readFileSync(canvas, 'utf8').matchAll(/§ ?(\d+(?:\.\d+)?)/g)].map((m) => m[1]))];
    assert.deepEqual(cited.filter((s) => !defined.has(s)), [], 'a section the canvas cites is not in the template');
  }
});

const LICENCE = {
  id: 1, uid: 'lic_pt', licence_ref: 'AXL-PT-01', entity_id: null,
  legal_entity_name: 'Axal VC Iberia Lda', brand_name: 'Axal VC Iberia', registered_address: 'Rua Exemplo 1, Lisboa',
  signatory_name: 'Ana Silva', signatory_title: 'Managing Director', status: 'active',
  term_years: 3, annual_fee_cents: 9000000, currency: 'EUR', revenue_share_bps: 2000, token_split_bps: 3000,
  starts_on: '2027-03-01', renews_on: '2030-03-01', suspended_at: null, terminated_at: null, status_note: null,
  created_at: '2027-01-01T00:00:00Z', kind: 'subsidiary',
} as any;

test('every merge field the template uses is a ledger value or a D797 term, and every D797 term is used', () => {
  // Mutation checked: a `{{terms.carry_share}}` that is not a D797 key → named here.
  const ledger = new Set(Object.keys(mergeValues(LICENCE, ['PT'], [{ seat_type: 'founder', seats_licensed: 15 }])));
  const fields = [...new Set([...TEMPLATE.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((m) => m[1]))];
  const stray = fields.filter((f) => !(f.startsWith('licence.') && ledger.has(f)) && !(f.startsWith('terms.') && LICENCE_TERM_KEYS.includes(f.slice(6))));
  assert.deepEqual(stray, []);
  assert.deepEqual(LICENCE_TERM_KEYS.filter((k) => !fields.includes(`terms.${k}`)), [], 'a D797 term the contract never states');
});

test('D797\'s terms read as the contract states them; one not recorded is unfilled', () => {
  // Mutation checked: bps through pctFromBps → 25 reads "0.3%"; days without the unit → "30".
  const t = termValues({
    licensor_ip_entity: 'holdings', licensor_brand_entity: 'management', exclusive: 1, non_compete_months: 12, renewal_mode: 'on_request',
    non_renewal_notice_days: 90, cure_days: 1, payment_terms_days: 30, late_interest_bps: 100,
    minimum_guarantee_cents: 0, fee_invoiced: 'annually', first_look_business_days: 10, co_invest_max_bps: 2500,
    carry_share_bps: 25, referral_fee_bps: 150, hq_approval_above_cents: 200000000, usage_report_day: 22,
    statement_period: 'quarter', data_role: 'licensee_controller', audit_right: 0, governing_law: 'Delaware',
  } as any, 'EUR');
  assert.equal(t.licensor_ip_entity, 'Axal VC Holdings LLC');
  assert.equal(t.licensor_brand_entity, 'Axal VC Management LLC');
  assert.equal(t.exclusive, 'exclusive');
  assert.equal(t.non_compete_months, '12 months');
  assert.equal(t.non_renewal_notice_days, '90 days');
  assert.equal(t.cure_days, '1 day');
  assert.equal(t.first_look_business_days, '10 business days');
  assert.equal(t.late_interest_bps, '1%');
  assert.equal(t.carry_share_bps, '0.25%');
  assert.equal(t.referral_fee_bps, '1.5%');
  assert.equal(t.minimum_guarantee_cents, 'EUR 0.00', 'zero is a guarantee of zero, not an absence');
  assert.equal(t.hq_approval_above_cents, 'EUR 2,000,000.00');
  assert.equal(t.usage_report_day, 'the 22nd day');
  assert.equal(t.statement_period, 'quarterly');
  assert.equal(t.audit_right, 'do not have');
  assert.equal(t.governing_law, 'Delaware');
  for (const k of ['termination_note', 'conflicts_note']) assert.equal(t[k], null, `${k} not recorded`);
  assert.equal(termValues(null, 'EUR').carry_share_bps, null);
  assert.equal(pctExact(2000), '20%');
  assert.equal(pctExact(3050), '30.5%');
});

test('a licence that lacks a term keeps "{{terms.<key>}}" visible and lists it; the ledger fields fill', () => {
  // Mutation checked: render a missing term as "" → the placeholder is gone.
  const values = mergeValues(LICENCE, ['ES', 'PT'], [{ seat_type: 'founder', seats_licensed: 15 }], { governing_law: 'Delaware' } as any);
  const { body, unfilled } = renderContract(TEMPLATE, values);
  assert.match(body, /Axal VC Iberia Lda, trading as Axal VC Iberia/);
  assert.match(body, /annual licence fee of EUR 90,000\.00/);
  assert.match(body, /governed by the law of Delaware\./);
  assert.match(body, /within \{\{terms\.cure_days\}\} of written notice/);
  assert.ok(unfilled.includes('terms.cure_days'));
  assert.ok(!unfilled.includes('terms.governing_law'));
  assert.ok(!unfilled.some((f) => f.startsWith('licence.')), `ledger fields unfilled: ${unfilled.filter((f) => f.startsWith('licence.'))}`);
  assert.equal(unfilled.length, LICENCE_TERM_KEYS.length - 1, 'each missing term listed once');
});

function libraryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'gp', body_md TEXT NOT NULL DEFAULT '',
    merge_fields TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, is_stub INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER, updated_by INTEGER,
    doc_kind TEXT CHECK (doc_kind IS NULL OR doc_kind IN ('agreement','corporate','resolution','unilateral','policy','notice','booklet')),
    axal_party TEXT CHECK (axal_party IS NULL OR axal_party IN ('management','holdings','gp','fund','none')));`);
  return db;
}

test('the seed inserts the file\'s text exactly, with its merge fields, and is idempotent', () => {
  // Mutation checked: drop OR IGNORE and WHERE NOT EXISTS → the second run fails on the UNIQUE slug.
  const db = libraryDb();
  db.exec(SEED);
  db.exec(SEED);
  const rows = db.prepare('SELECT * FROM legal_templates WHERE slug = ?').all(SLUG) as any[];
  assert.equal(rows.length, 1, 'a re-run adds nothing');
  const row = rows[0];
  assert.equal(row.body_md, TEMPLATE, 'the store holds the file\'s bytes');
  assert.deepEqual([row.version, row.is_active, row.is_stub, row.category, row.doc_kind], [1, 1, 0, 'gp', 'agreement']);
  const fields = [...new Set([...TEMPLATE.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]))].sort();
  assert.deepEqual(JSON.parse(row.merge_fields), fields);
  // A row an admin already holds under the slug is left as it is.
  const kept = libraryDb();
  kept.exec(`INSERT INTO legal_templates (slug, title, body_md, version) VALUES ('${SLUG}', 'Mine', 'My text', 7)`);
  kept.exec(SEED);
  assert.deepEqual({ ...(kept.prepare('SELECT title, body_md, version FROM legal_templates').get() as any) }, { title: 'Mine', body_md: 'My text', version: 7 });
  // Grepped first (D-t): no earlier migration, nor the baseline, names the slug.
  assert.ok(!read('cloudflare-worker/sql/schema_baseline.sql').includes(SLUG));
});

test('the library marks it a draft subject to counsel, and LEGAL_REVIEW.md lists what counsel must confirm', () => {
  assert.ok(COUNSEL_REVIEW_SLUGS.has(SLUG));
  assert.ok(!COUNSEL_DRAFT_SLUGS.has(SLUG), 'it has a body: not a stub');
  assert.match(TEMPLATE, /^\*\*DRAFT — SUBJECT TO COUNSEL REVIEW\. NOT FOR SIGNATURE\.\*\*/);
  const review = read('cloudflare-worker/src/templates/legal/LEGAL_REVIEW.md');
  const entry = review.slice(review.indexOf('subsidiary_licence_agreement_v1.md'));
  assert.ok(entry.length > 0 && review.includes('subsidiary_licence_agreement_v1.md'));
  for (const point of [/two-licensor structure/i, /royalty/i, /non-compete/i, /governing law/i, /data-processing roles/i]) {
    assert.match(entry.slice(0, 2000), point);
  }
  assert.match(read('cloudflare-worker/src/routes/admin_contracts.ts'), /counsel_review: COUNSEL_REVIEW_SLUGS\.has\(t\.slug\)/);
});
