-- 514 — the Subsidiary licence agreement master template (D803, #2240).
--
-- HQ instantiates a licence's contract from a master template
-- (`POST /api/admin/licences/:uid/contract`, D110). No territory licence
-- agreement was in the library, so the Licences canvas's "Subsidiary licence
-- agreement" had no source. This seeds it.
--
-- THE TEXT is `src/templates/legal/subsidiary_licence_agreement_v1.md`,
-- copied verbatim (`licence_template_d803.test.ts` holds the two equal). It is
-- a DRAFT SUBJECT TO COUNSEL: engineering wrote it from the canvas, counsel has
-- not reviewed it, and `LEGAL_REVIEW.md` lists what counsel must confirm.
-- HQ's library marks it so (`COUNSEL_REVIEW_SLUGS`, services/templateFormat.ts).
--
-- MERGE FIELDS are `licence.<name>` (the ledger, migration 187, as
-- `services/licenceContract.ts` formats it) and `terms.<key>` (D797's terms,
-- migration 512). A field a licence has not recorded stays visible in the
-- stored contract and is listed in `unfilled_fields`.
--
-- Grepped first (D689 D-t): the slug `subsidiary_licence_agreement` exists in
-- no earlier migration and not in schema_baseline.sql.
--
-- IDEMPOTENT: inserted only when the slug is absent (WHERE NOT EXISTS, plus
-- OR IGNORE), so a re-run, or a row an admin made under the same slug, is left
-- as it is. Data only, no BEGIN/COMMIT.

INSERT OR IGNORE INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub, doc_kind)
SELECT 'subsidiary_licence_agreement', 'Subsidiary Licence Agreement', 'gp',
       '**DRAFT — SUBJECT TO COUNSEL REVIEW. NOT FOR SIGNATURE.** This text was drafted by engineering from the Licences canvas (D803). Counsel has not reviewed it. Bracketed text marks a choice the owner or counsel still has to make; a merge field the licence has not recorded stays visible as written, and HQ''s screen marks it "[not filled]".

# Subsidiary Licence Agreement

Licence reference: {{licence.licence_ref}}

This Subsidiary Licence Agreement (the "Agreement") starts on {{licence.starts_on}} (the "Start Date").

## 1. Parties

1.1 The licensors are {{terms.licensor_ip_entity}}, which holds the platform''s software and its other intellectual property and licenses it under this Agreement (the "Platform Licensor"), and {{terms.licensor_brand_entity}}, which holds the Axal VC trademarks and brand and licenses them under this Agreement (the "Brand Licensor"). Together they are the "Licensors". The Licensors'' contracting entity for notices and invoices under this Agreement is the Platform Licensor.

1.2 The licensee is {{licence.legal_entity_name}}, trading as {{licence.brand_name}}, with its registered address at {{licence.registered_address}} (the "Licensee").

1.3 This Agreement is signed for the Licensee by {{licence.signatory_name}}, {{licence.signatory_title}}, who confirms that they are authorised to bind the Licensee.

## 2. Territory and exclusivity

2.1 The Licensors grant the Licensee a {{terms.exclusive}} licence to operate the platform under the Licensors'' brand in the following countries: {{licence.territory}} (the "Territory").

2.2 The Licensee operates only in the Territory. It may serve a member who lives outside the Territory only where that member was referred under clause 2.5.

2.3 The Licensors may change the Territory only by a written amendment signed by all parties.

2.4 For {{terms.non_compete_months}} after this Agreement ends, the Licensee will not operate, or help another person to operate, a venture studio, accelerator or investment platform in the Territory that competes with the platform. Counsel is to confirm that this restriction is enforceable in each country of the Territory.

2.5 A prospective member from outside the Territory who contacts the Licensee is referred to the Licensors, and a prospective member from inside the Territory who contacts the Licensors is referred to the Licensee. The Licensors'' headquarters are "HQ". Referrals from outside the Territory: {{terms.referrals_note}}.

## 3. Term and renewal

3.1 This Agreement runs for {{licence.term_years}} years from the Start Date (the "Term"). The first renewal date is {{licence.renews_on}}.

3.2 At the end of the Term, this Agreement renews {{terms.renewal_mode}}, for a further period of the same length, on the terms then in force.

3.3 A party that does not want this Agreement to renew gives the other parties written notice at least {{terms.non_renewal_notice_days}} before the renewal date.

## 4. Fees

4.1 The Licensee pays the Licensors an annual licence fee of {{licence.annual_fee}}, invoiced {{terms.fee_invoiced}}.

4.2 The Licensee pays the Licensors a revenue share of the net revenue it earns in the Territory from each of these streams, at the share stated for it: (a) member subscriptions, {{terms.share_subscriptions_bps}}; (b) licence fees, {{terms.share_licence_fees_bps}}; and (c) the margin on AI tokens, {{terms.share_token_margin_bps}}. A stream with no share stated here takes the licence''s revenue share of {{licence.revenue_share}}.

4.3 Of the price members in the Territory pay for AI tokens, {{licence.token_split}} is the Licensee''s share, and the rest is the Licensors''.

4.4 Whatever revenue share is due, the Licensee pays the Licensors at least {{terms.minimum_guarantee_cents}} for each year of the Term (the "Minimum Guarantee"). Any shortfall is invoiced at the end of that year.

4.5 Promotions the Licensee offers to members in the Territory, including free credits and discounts, may not exceed [amount] in any statement period without the Licensors'' written approval.

4.6 Each invoice is payable within {{terms.payment_terms_days}} of its date. An amount paid late carries interest of {{terms.late_interest_bps}} per month from its due date until it is paid, or the highest rate the law allows, if lower.

4.7 Where the Licensee sells a licence to the platform to a third party in the Territory, with the Licensors'' approval, it pays the Licensors a royalty of {{terms.royalty_platform_licence_bps}} of each licence fee it receives.

## 5. Deal terms

5.1 Before the Licensee or any of its affiliates invests in, or arranges an investment in, a venture it has sourced in the Territory, it offers that investment to HQ first. HQ has {{terms.first_look_business_days}} from the offer to accept it (the "First Look").

5.2 Where HQ funds a venture the Licensee sourced, the Licensee may co-invest alongside the Axal VC Fund in that round, up to {{terms.co_invest_max_bps}} of the round.

5.3 On a venture the Licensee sourced and HQ funded, the Licensee receives {{terms.carry_share_bps}} of the carried interest the Licensors'' fund vehicles receive on that investment, on the terms of the relevant fund documents.

5.4 Where the Licensee refers a venture or an investor to the Licensors and the referral leads to an investment, the Licensors pay the Licensee a referral fee of {{terms.referral_fee_bps}} of the amount invested, where the law allows such a fee to be paid.

5.5 The Licensee obtains HQ''s written approval before committing to any single transaction above {{terms.hq_approval_above_cents}}.

5.6 The Licensee declares to HQ, in writing and before it acts, any conflict of interest it or its officers have in a venture, an investor or a transaction under this Agreement. {{terms.conflicts_note}}

## 6. Seats

6.1 The Licensee may hold {{licence.seats_total}} seats on the platform in total, by role as recorded in the Licensors'' ledger for this licence.

6.2 What a seat includes: {{terms.seat_includes}}. A seat may not be shared between people.

## 7. Brand and platform

7.1 The Licensee uses the platform and the Licensors'' brand only as this Agreement allows and only in the Territory.

7.2 The Licensee presents the platform with the brand kit the Licensors approve for this licence: {{terms.brand_kit}}. The Licensee does not change the Licensors'' marks.

7.3 The Platform Licensor owns the platform''s intellectual property, and the Brand Licensor owns the Axal VC trademarks and brand. This Agreement licenses them to the Licensee for the Term and transfers no ownership. Anything the Licensee builds on the platform that is derived from it belongs to the Platform Licensor, except the Licensee''s own content and its members'' data.

7.4 Personal data about members in the Territory is processed with {{terms.data_role}}, as set out in clause 8.4.

## 8. Compliance and reporting

8.1 The Licensee sends HQ a usage report for each month by {{terms.usage_report_day}} of the following month.

8.2 HQ issues the Licensee a statement of fees, revenue share and token split {{terms.statement_period}}. The Licensee may dispute a statement in writing within [30] days of receiving it.

8.3 The Licensee carries out know-your-customer and anti-money-laundering checks on every investor and member it onboards, as the law of the Territory and the Licensors'' policies require, and keeps the records.

8.4 Each party complies with the data protection law that applies to it. The parties will sign a data processing agreement that records their roles, with {{terms.data_role}}. Counsel is to confirm the roles for each country of the Territory.

8.5 The Licensors {{terms.audit_right}} the right to audit the Licensee''s records under this Agreement on {{terms.audit_notice_days}}'' written notice, at most once in each year unless an audit finds a material error.

8.6 HQ responds to the Licensee''s requests within the times it publishes for each kind of request, and the Licensee responds to HQ''s within [72] hours.

## 19. Termination

19.1 Either party may end this Agreement as clause 3 allows.

19.2 A party may end this Agreement by written notice if another party materially breaches it and does not cure the breach within {{terms.cure_days}} of written notice describing it.

19.3 A party may end this Agreement at once by written notice if another party becomes insolvent or ceases to trade.

19.4 Ending this Agreement does not affect rights and obligations that arose before it ended.

19.5 When this Agreement ends: the Licensee stops using the platform and the Licensors'' brand; the members'' data is handed over as clause 8.4 provides; and the members'' accounts move to HQ. {{terms.termination_note}}

## 22. Governing law

22.1 This Agreement and any dispute arising from it are governed by the law of {{terms.governing_law}}.

22.2 The parties submit to the courts of that jurisdiction. [Counsel is to confirm the forum, and whether disputes go to arbitration.]

Signed for the Platform Licensor, Axal VC Holdings LLC:

Signed for the Brand Licensor, Axal VC Management LLC:

Signed for the Licensee, {{licence.legal_entity_name}}, by {{licence.signatory_name}}, {{licence.signatory_title}}:
',
       '["licence.annual_fee", "licence.brand_name", "licence.legal_entity_name", "licence.licence_ref", "licence.registered_address", "licence.renews_on", "licence.revenue_share", "licence.seats_total", "licence.signatory_name", "licence.signatory_title", "licence.starts_on", "licence.term_years", "licence.territory", "licence.token_split", "terms.audit_notice_days", "terms.audit_right", "terms.brand_kit", "terms.carry_share_bps", "terms.co_invest_max_bps", "terms.conflicts_note", "terms.cure_days", "terms.data_role", "terms.exclusive", "terms.fee_invoiced", "terms.first_look_business_days", "terms.governing_law", "terms.hq_approval_above_cents", "terms.late_interest_bps", "terms.licensor_brand_entity", "terms.licensor_ip_entity", "terms.minimum_guarantee_cents", "terms.non_compete_months", "terms.non_renewal_notice_days", "terms.payment_terms_days", "terms.referral_fee_bps", "terms.referrals_note", "terms.renewal_mode", "terms.royalty_platform_licence_bps", "terms.seat_includes", "terms.share_licence_fees_bps", "terms.share_subscriptions_bps", "terms.share_token_margin_bps", "terms.statement_period", "terms.termination_note", "terms.usage_report_day"]', 1, 1, 0, 'agreement'
 WHERE NOT EXISTS (SELECT 1 FROM legal_templates WHERE slug = 'subsidiary_licence_agreement');
