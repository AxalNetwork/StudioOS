// D717 (#1782) decision 7 — the Fund I documents panel above the Templates
// tab's layers, in signing order. Pure: states and counts, no copy.
//
// "Ready" means a recorded publication, because New envelope offers only
// published versions (D647). A slug the catalog does not return is flagged
// `missing`; the screen prints "Not in the catalog" for it.

import { templateState } from './templateCatalogModel.js';

export const FUND_I_DOCUMENTS = Object.freeze([
  { stage: 'formation', slugs: ['certificate_of_limited_partnership_de', 'gp_llc_agreement', 'gp_fund_formation_consent', 'lpa_initial',
    'investment_management_agreement', 'mgmt_company'] },
  { stage: 'offering', slugs: ['investor_nda_axal', 'ppm', 'lpa_amended_restated', 'lpa'] },
  { stage: 'booklet', slugs: ['Subscription Booklet & LPA', 'subscription', 'investor_subscription_pro', 'investor_subscription_inst',
    'lp_investor_questionnaire', 'accreditation_v1', 'lp_aml_kyc_certification', 'lp_tax_status_certification',
    'lp_electronic_delivery_consent'] },
  { stage: 'closing', slugs: ['lp_side_letter', 'Co-Investment Side Letter', 'mfn_election_form', 'gp_closing_certificate', 'carried_interest',
    'carried_interest_award_letter', 'clawback_guarantee'] },
  { stage: 'operations', slugs: ['capital_call_notice', 'distribution_notice', 'default_notice', 'lp_interest_transfer', 'lpac_charter',
    'management_rights_letter', 'pro_rata_information_rights_side_letter'] },
  { stage: 'compliance', slugs: ['form_d_filing_kit', 'bad_actor_questionnaire_506d', 'compliance_manual_code_of_ethics',
    'investor_privacy_notice_reg_sp', 'valuation_policy', 'conflicts_allocation_policy', 'form_adv', 'aml_kyc'] },
].map((s) => Object.freeze({ ...s, slugs: Object.freeze(s.slugs) })));

export const FUND_I_SLUGS = Object.freeze(FUND_I_DOCUMENTS.flatMap((s) => s.slugs));
export const FUND_I_TOTAL = FUND_I_SLUGS.length;

/**
 * The panel for a catalog: each stage's rows in signing order, each with its
 * catalog row (or `missing`), its state and whether it is ready to send, and
 * the ready count out of FUND_I_TOTAL.
 */
export function fundIPanel(rows) {
  const bySlug = new Map((rows || []).map((r) => [r?.slug, r]));
  const stages = FUND_I_DOCUMENTS.map(({ stage, slugs }) => ({
    stage,
    items: slugs.map((slug) => {
      const row = bySlug.get(slug) || null;
      if (!row) return { slug, row: null, missing: true, ready: false, state: null, action: null };
      const s = templateState(row);
      return { slug, row, missing: false, ready: s.publishedVersion != null, state: s.state, action: s.action };
    }),
  }));
  const ready = stages.reduce((n, st) => n + st.items.filter((i) => i.ready).length, 0);
  return { stages, ready, total: FUND_I_TOTAL };
}
