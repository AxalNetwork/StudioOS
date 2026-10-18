// D717 (#1782) decisions 3, 4 and 7 — the Templates tab's rules, before its
// screens (PR 2a): frontend/src/lib/templateCatalogModel.js and
// frontend/src/lib/fundIDocuments.js. PR 2 adds the rendered tab to this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  LAYER_ORDER, STATE_FILTERS, templateState, matchesStateFilter, filterCatalog, layerSections, stateCounts,
} from '../src/lib/templateCatalogModel.js';
import { FUND_I_DOCUMENTS, FUND_I_SLUGS, FUND_I_TOTAL, fundIPanel } from '../src/lib/fundIDocuments.js';

// Rows as GET /templates/store?recorded=true answers them. Synthetic titles.
const row = (slug, layer, o = {}) => ({
  slug, title: o.title || slug.replace(/_/g, ' '), layer, layer_label: `Layer ${layer}`, body_md: 'Body.', is_stub: 0,
  version: 1, published_version: null, has_unpublished_changes: true, usage_count: 0, ...o,
});
const ROWS = [
  row('gp_partnership', 'gp', { published_version: 2, version: 2, has_unpublished_changes: false }),
  row('gp_carry', 'gp', { published_version: 1, version: 3, has_unpublished_changes: true }),
  row('ppm', 'fund', { body_md: '   ', is_stub: 0 }),
  row('lpa_initial', 'fund', { body_md: '', is_stub: 1 }),
  row('safe_note', 'portfolio'),
  row('aml_policy', 'compliance', { is_stub: 1, body_md: '', published_version: 1, has_unpublished_changes: true }),
  row('house_rule', 'branch_only'),
];

test('D717 each row has one state; a publication replaces "has a body" but never "stub"', () => {
  const s = Object.fromEntries(ROWS.map((r) => [r.slug, templateState(r)]));
  assert.equal(s.gp_partnership.state, 'published');
  assert.equal(s.gp_partnership.changesNotPublished, false);
  assert.equal(s.gp_carry.state, 'published');
  assert.equal(s.gp_carry.changesNotPublished, true, 'shown beside Published');
  assert.equal(s.ppm.state, 'stub', 'a blank body is a stub');
  assert.equal(s.lpa_initial.state, 'stub');
  assert.equal(s.safe_note.state, 'has_body');
  assert.equal(s.safe_note.changesNotPublished, false, 'nothing to compare without a publication');
  assert.equal(s.aml_policy.state, 'stub');
  assert.equal(s.aml_policy.publishedVersion, 1, 'a stub keeps its publication, so the screen can offer Withdraw');
  assert.deepEqual(ROWS.map((r) => templateState(r).action), ['open', 'open', 'add_body', 'add_body', 'open', 'add_body', 'open']);
});

test('D717 the five state filters select the right rows', () => {
  assert.deepEqual(STATE_FILTERS, ['all', 'has_body', 'stub', 'unpublished', 'published']);
  const pick = (f) => ROWS.filter((r) => matchesStateFilter(r, f)).map((r) => r.slug);
  assert.deepEqual(pick('all'), ROWS.map((r) => r.slug));
  assert.deepEqual(pick('has_body'), ['gp_partnership', 'gp_carry', 'safe_note', 'house_rule']);
  assert.deepEqual(pick('stub'), ['ppm', 'lpa_initial', 'aml_policy']);
  assert.deepEqual(pick('unpublished'), ['gp_carry', 'ppm', 'lpa_initial', 'safe_note', 'aml_policy', 'house_rule']);
  assert.deepEqual(pick('published'), ['gp_partnership', 'gp_carry', 'aml_policy']);
  assert.throws(() => matchesStateFilter(ROWS[0], 'draft'), RangeError);
  const counts = stateCounts(ROWS);
  assert.equal(counts.all, ROWS.length);
  assert.equal(counts.has_body + counts.stub, counts.all, 'every row is a stub or has a body');
});

test('D717 search, layer and state combine; the layer sections keep the tab\'s order and their counts add up', () => {
  assert.deepEqual(filterCatalog(ROWS, { q: 'GP ', state: 'published' }).map((r) => r.slug), ['gp_partnership', 'gp_carry']);
  assert.deepEqual(filterCatalog(ROWS, { layer: 'fund' }).map((r) => r.slug), ['ppm', 'lpa_initial']);
  assert.deepEqual(filterCatalog(ROWS, { q: 'PPM' }).map((r) => r.slug), ['ppm'], 'search is case-insensitive');
  const titled = [row('ppm', 'fund', { title: 'Private Placement Memorandum' })];
  assert.deepEqual(filterCatalog(titled, { q: 'placement memo' }).map((r) => r.slug), ['ppm'], 'a lower-case query finds a title-case title');
  assert.deepEqual(filterCatalog(ROWS, { layer: 'fund', state: 'has_body' }), []);

  assert.deepEqual(LAYER_ORDER, ['gp', 'fund', 'portfolio', 'compliance']);
  const shuffled = [...ROWS].reverse();
  const sections = layerSections(shuffled);
  assert.deepEqual(sections.map((s) => s.layer), ['gp', 'fund', 'portfolio', 'compliance', 'branch_only'], 'a layer outside the order follows');
  assert.deepEqual(sections.map((s) => s.count), [2, 2, 1, 1, 1]);
  assert.equal(sections.reduce((n, s) => n + s.count, 0), shuffled.length);
  assert.deepEqual(layerSections(filterCatalog(ROWS, { state: 'stub' })).map((s) => [s.layer, s.count]), [['fund', 2], ['compliance', 1]],
    'a section with no rows is left out');
});

test('D717 the Fund I panel keeps its signing order and its 41 documents, every one seeded by a migration', () => {
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.stage), ['formation', 'offering', 'booklet', 'closing', 'operations', 'compliance']);
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.slugs.length), [6, 4, 9, 7, 7, 8]);
  assert.equal(FUND_I_TOTAL, 41);
  assert.equal(new Set(FUND_I_SLUGS).size, 41, 'no document twice');
  // Decision 7's order, every stage in full.
  assert.deepEqual(FUND_I_DOCUMENTS.map((s) => s.slugs), [
    ['certificate_of_limited_partnership_de', 'gp_llc_agreement', 'gp_fund_formation_consent', 'lpa_initial', 'investment_management_agreement', 'mgmt_company'],
    ['investor_nda_axal', 'ppm', 'lpa_amended_restated', 'lpa'],
    ['Subscription Booklet & LPA', 'subscription', 'investor_subscription_pro', 'investor_subscription_inst', 'lp_investor_questionnaire',
      'accreditation_v1', 'lp_aml_kyc_certification', 'lp_tax_status_certification', 'lp_electronic_delivery_consent'],
    ['lp_side_letter', 'Co-Investment Side Letter', 'mfn_election_form', 'gp_closing_certificate', 'carried_interest', 'carried_interest_award_letter',
      'clawback_guarantee'],
    ['capital_call_notice', 'distribution_notice', 'default_notice', 'lp_interest_transfer', 'lpac_charter', 'management_rights_letter',
      'pro_rata_information_rights_side_letter'],
    ['form_d_filing_kit', 'bad_actor_questionnaire_506d', 'compliance_manual_code_of_ethics', 'investor_privacy_notice_reg_sp', 'valuation_policy',
      'conflicts_allocation_policy', 'form_adv', 'aml_kyc'],
  ]);
  const dir = new URL('../../cloudflare-worker/sql/migrations/', import.meta.url);
  const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const slug of FUND_I_SLUGS) assert.ok(sql.includes(`'${slug.replace(/'/g, "''")}'`), `${slug} is seeded`);
});

test('D717 the panel counts only published rows "of 41" and flags a slug the catalog does not return', () => {
  const rows = [
    row('gp_llc_agreement', 'gp', { published_version: 1 }),
    row('ppm', 'fund', { published_version: 3, version: 4, has_unpublished_changes: true }),
    row('lpa_initial', 'fund', { is_stub: 1, body_md: '' }),
    row('investor_nda_axal', 'fund'),
  ];
  const panel = fundIPanel(rows);
  assert.equal(panel.total, 41);
  assert.equal(panel.ready, 2, 'only a recorded publication is ready to send');
  const items = panel.stages.flatMap((s) => s.items);
  assert.equal(items.length, 41);
  assert.deepEqual(items.map((i) => i.slug), FUND_I_SLUGS, 'signing order');
  const by = Object.fromEntries(items.map((i) => [i.slug, i]));
  assert.deepEqual([by.gp_llc_agreement.ready, by.gp_llc_agreement.action], [true, 'open']);
  assert.deepEqual([by.lpa_initial.state, by.lpa_initial.action, by.lpa_initial.ready], ['stub', 'add_body', false]);
  assert.deepEqual([by.investor_nda_axal.state, by.investor_nda_axal.ready], ['has_body', false]);
  assert.deepEqual([by.mgmt_company.missing, by.mgmt_company.row, by.mgmt_company.action], [true, null, null]);
  assert.equal(items.filter((i) => i.missing).length, 41 - rows.length);
  assert.equal(fundIPanel([]).ready, 0);
});
