-- 468_legal_catalog_fund_i.sql — D706: the template catalog lists the 28
-- documents Axal VC Spin-Out Lab Fund I LP is missing.
--
-- Adds one CATALOG ENTRY per document to `legal_templates` (084): a stub row
-- with no body (is_stub = 1, body_md = '', version 1, active), so the admin
-- Templates tab lists it in its layer, marked as having no body yet. Counsel
-- writes every body; nothing here is legal text. A stub has no store body
-- (`getActiveTemplateBody` requires is_stub = 0 and a non-empty body), and
-- contract publication (D647) skips stubs, so no existing send, preview or
-- usage count changes.
--
-- Each row is inserted only when its slug does not exist yet (WHERE NOT
-- EXISTS, plus OR IGNORE, which `migrate-d1.mjs --audit` asks for), so a row
-- an admin already created under the same slug is left as it is, and a
-- re-run adds nothing. The slug is the join key for
-- esign_envelopes.document_type and the usage counts (084:14-17).
--
-- Kinds and Axal parties for these slugs are listed explicitly in
-- services/legalDocFormat.ts and frontend/src/lib/legalDocFormat.js. The
-- eleven body files the catalog does not list, and the source each of the 25
-- existing stubs is sent from, are recorded in D706.md, not changed here.
--
-- STANDS ALONE and idempotent under the runner: data only, no BEGIN/COMMIT.

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
SELECT v.column1, v.column2, v.column3, '', '[]', 1, 1, 1
  FROM (VALUES
    ('certificate_of_limited_partnership_de', 'Certificate of Limited Partnership (Delaware)', 'fund'),
    ('lpa_amended_restated', 'Amended and Restated Limited Partnership Agreement', 'fund'),
    ('lpa_initial', 'Initial Limited Partnership Agreement', 'fund'),
    ('lp_side_letter', 'LP Side Letter (Standard Form)', 'fund'),
    ('mfn_election_form', 'MFN Election Form', 'fund'),
    ('lp_investor_questionnaire', 'LP Investor Questionnaire', 'fund'),
    ('lp_aml_kyc_certification', 'Investor AML/KYC and Beneficial Ownership Certification', 'fund'),
    ('lp_tax_status_certification', 'Tax Status Certification (W-9 / W-8, FATCA and CRS)', 'fund'),
    ('lp_electronic_delivery_consent', 'LP Electronic Delivery Consent', 'fund'),
    ('gp_closing_certificate', 'GP Acceptance and Closing Certificate', 'fund'),
    ('capital_call_notice', 'Capital Call Notice', 'fund'),
    ('distribution_notice', 'Distribution Notice', 'fund'),
    ('default_notice', 'Default Notice', 'fund'),
    ('lp_interest_transfer', 'Transfer of LP Interest (Assignment, Joinder and GP Consent)', 'fund'),
    ('lpac_charter', 'LPAC Charter and Written Consent', 'fund'),
    ('investment_management_agreement', 'Investment Management Agreement', 'fund'),
    ('gp_llc_agreement', 'Axal VC GP LLC — Limited Liability Company Agreement', 'gp'),
    ('gp_fund_formation_consent', 'GP Written Consent — Fund I Formation and Closing Resolutions', 'gp'),
    ('clawback_guarantee', 'Clawback Guarantee', 'gp'),
    ('carried_interest_award_letter', 'Carried Interest Award Letter', 'gp'),
    ('form_d_filing_kit', 'Form D Notice Filing Kit (with State Notices)', 'compliance'),
    ('bad_actor_questionnaire_506d', 'Rule 506(d) Bad Actor Questionnaire', 'compliance'),
    ('compliance_manual_code_of_ethics', 'Compliance Manual and Code of Ethics', 'compliance'),
    ('investor_privacy_notice_reg_sp', 'Investor Privacy Notice (Regulation S-P)', 'compliance'),
    ('valuation_policy', 'Valuation Policy', 'compliance'),
    ('conflicts_allocation_policy', 'Conflicts of Interest and Allocation Policy', 'compliance'),
    ('management_rights_letter', 'Management Rights Letter', 'portfolio'),
    ('pro_rata_information_rights_side_letter', 'Pro Rata and Information Rights Side Letter', 'portfolio')
  ) AS v
 WHERE NOT EXISTS (SELECT 1 FROM legal_templates t WHERE t.slug = v.column1);
