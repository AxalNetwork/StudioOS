// D706 — the admin preview's mirror of legalDocFormat classifies and routes the
// 28 Fund I catalog entries (migration 468) exactly as the worker does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AXAL_ENTITIES,
  axalEntityKeyForDoc,
  buildExecutionBlock,
  buildPreamble,
  classifyDocument,
} from '../src/lib/legalDocFormat.js';

// [slug, kind, Axal party] — the issue's table (#1718).
const D706 = [
  ['certificate_of_limited_partnership_de', 'unilateral', 'none'],
  ['lpa_amended_restated', 'agreement', 'gp'],
  ['lpa_initial', 'agreement', 'gp'],
  ['lp_side_letter', 'agreement', 'fund'],
  ['mfn_election_form', 'unilateral', 'none'],
  ['lp_investor_questionnaire', 'unilateral', 'none'],
  ['lp_aml_kyc_certification', 'unilateral', 'none'],
  ['lp_tax_status_certification', 'unilateral', 'none'],
  ['lp_electronic_delivery_consent', 'unilateral', 'none'],
  ['gp_closing_certificate', 'resolution', 'gp'],
  ['capital_call_notice', 'resolution', 'gp'],
  ['distribution_notice', 'resolution', 'gp'],
  ['default_notice', 'resolution', 'gp'],
  ['lp_interest_transfer', 'agreement', 'fund'],
  ['lpac_charter', 'resolution', 'gp'],
  ['investment_management_agreement', 'agreement', 'fund'],
  ['gp_llc_agreement', 'agreement', 'gp'],
  ['gp_fund_formation_consent', 'resolution', 'gp'],
  ['clawback_guarantee', 'agreement', 'fund'],
  ['carried_interest_award_letter', 'agreement', 'gp'],
  ['form_d_filing_kit', 'unilateral', 'none'],
  ['bad_actor_questionnaire_506d', 'unilateral', 'none'],
  ['compliance_manual_code_of_ethics', 'policy', 'none'],
  ['investor_privacy_notice_reg_sp', 'policy', 'none'],
  ['valuation_policy', 'policy', 'none'],
  ['conflicts_allocation_policy', 'policy', 'none'],
  ['management_rights_letter', 'agreement', 'fund'],
  ['pro_rata_information_rights_side_letter', 'agreement', 'fund'],
];

test('D706 the JS mirror classifies and routes every new slug as the table says', () => {
  assert.equal(D706.length, 28);
  for (const [slug, kind, party] of D706) {
    assert.equal(classifyDocument(slug), kind, `${slug} kind`);
    if (party !== 'none') assert.equal(axalEntityKeyForDoc(slug, null), party, `${slug} party`);
  }
});

test('D706 the preview names the Fund or the GP as the Axal party, and none on a filing', () => {
  for (const [slug, kind, party] of D706) {
    if (kind === 'policy') continue; // no execution block on a policy
    const block = buildExecutionBlock({ kind, axalEntityName: AXAL_ENTITIES[axalEntityKeyForDoc(slug)].name });
    if (party === 'none') {
      assert.deepEqual(block.parties.map((p) => p.role), ['counterparty'], slug);
      continue;
    }
    assert.deepEqual(block.parties.filter((p) => p.role === 'axal').map((p) => p.heading), [AXAL_ENTITIES[party].name], slug);
    if (kind === 'agreement') {
      assert.ok(buildPreamble({ documentTitle: 'X', axalEntityKey: axalEntityKeyForDoc(slug) }).includes(`by and between ${AXAL_ENTITIES[party].name}, `), slug);
    }
  }
});

// The two files are kept in lock-step by hand; read the worker's D706 sets
// from its source and hold the mirror to the same members.
function setMembers(src, name) {
  const m = src.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert.ok(m, `${name} not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

test('D706 the worker and the mirror list the same slugs in every set', () => {
  const ts = readFileSync('cloudflare-worker/src/services/legalDocFormat.ts', 'utf8');
  const js = readFileSync('frontend/src/lib/legalDocFormat.js', 'utf8');
  for (const name of ['FUND_PARTY_SLUGS_D706', 'GP_PARTY_SLUGS_D706', 'POLICY_SLUGS', 'UNILATERAL_SLUGS', 'RESOLUTION_SLUGS']) {
    assert.deepEqual(setMembers(js, name), setMembers(ts, name), name);
  }
});
