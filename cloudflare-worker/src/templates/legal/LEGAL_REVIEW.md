# Legal template library — counsel review checklist

Working inventory of every legal document the platform holds or needs,
mapped to the entity that signs it. Maintained by engineering as
documents are added; the review columns are for Delaware counsel.
Nothing in this directory is legal advice, and the six files marked
**NEW DRAFT** were machine-drafted and must not be sent to a
counterparty before counsel sign-off.

**Entities** (all at 16192 Coastal Hwy, Lewes, DE 19958, United States):

| Entity | Role | Signs |
| --- | --- | --- |
| Axal VC Holdings LLC (owner: Joseph Gabriel Guillaume Lauzier) | IP holding company; member of the other two (to confirm, §F). Axal VC Holdings LLC licenses the software IP platform to Axal VC Management LLC for management administration, and to Axal VC GP LLC for fund administration. | Intercompany agreements only — never customer-facing |
| Axal VC Management LLC (Managing Partner: J.G.G. Lauzier) | Operating company; runs the platform. Axal VC Management LLC operates between the different partners as Managing Partner under the Spin-Out Lab, and manages the other operating partners across the platform. | ToS, subscriptions, partner/advisor/customer agreements, DPA |
| Axal VC GP LLC (GP: J.G.G. Lauzier) | General partner of fund vehicles. Axal VC GP LLC is the General Partner that manages the Fund's investors, and the founders getting funding through Axal VC Spin-Out Lab Fund I LP. | LPA, subscription booklets, side letters, capital docs |

## A. Platform ↔ every user (click-accept)

| Document | File | Status |
| --- | --- | --- |
| Terms of Service (incl. AUP §8.1, billing, disputes) | `tos_v2.md` (v1 retained) | Existing — address stamped into §16.6 |
| Privacy Policy | `privacy_v1.md` | Existing — address stamped |
| Data Processing Addendum + subprocessor schedule | `dpa_v1.md` | **NEW DRAFT** |
| Copyright / DMCA policy | `dmca_policy_v1.md` | **NEW DRAFT** — safe harbor requires registering a designated agent with the U.S. Copyright Office first |
| E-sign consent (ESIGN/UETA) | `esign_consent_v1.md` | **NEW DRAFT** — wire into the signing page before first signature |
| Risk disclosures / no-advice page | frontend `/risk-disclosures` | Existing — see red flag 1 |

## B. Platform ↔ founders

Incorporation engagement (`engagement_letter_spin_out_package_v1`),
co-founder agreement, founder NDA, 3-way NDA, founder collaboration
agreement, FAST advisory (`venture_share_agreement_fast_v1`), SAFE /
term sheet / SPA / bylaws / 83(b) (in `routes/legal.ts` doc sets),
IP background schedule, member consent, founding resolutions — **all
existing**.
**Needed (D578):** a **SAFE**, post-money with a valuation cap and no
discount (#1205, S1's Q1 A for the owner). The Capital page records each
investor's terms (`safe_issuances`, migration 410), but nothing can be sent:
`services/esignOriginators.ts` keeps SAFE as `NO_BODY`, and the send route
refuses until an approved text is registered in `services/legalTemplates.ts`.
The widely used public SAFE forms carry their own licence terms; counsel
should confirm the text may be used and adapted, or supply our own.

**Needed (D586):** Wyoming **Articles of Incorporation** for a C-Corp
(template key `articles_of_incorporation_wy`). Nothing generates it until
counsel supplies an approved body and it is published to the D1 template
store; the wizard lists it as `pending_counsel` instead. Counsel should also
confirm that the bylaws, founders' stock purchase agreement and 83(b) bodies
hold for a Wyoming corporation.

## C. Platform / GP ↔ investors and LPs

Investor NDA, accreditation self-cert, investor product subscriptions
(pro/inst), **LP Subscription Booklet + LPA**
(`subscription_booklet_lpa_v1`), co-investment side letter, SPV
joinder, strategic side letters, carried-interest allocation,
secondary purchase agreement, spin-out subsidiary SPA — **all
existing**. Newly added: **Investment Management Agreement**
(`investment_management_agreement_v1.md`, **NEW DRAFT**) between each
fund and Axal VC Management LLC. **It contradicts the owner's model
(D707 decision 5):** the 2% management fee is paid by the Fund to Axal VC
GP LLC, not to Management, and the live `mgmt_company` body says the same
as the IMA. The IMA stays a stub until counsel conforms both. Deliberately absent: a PPM — always
counsel-drafted per offering, never templated.

## D. Platform ↔ service partners

Partner suite (`partner_msa/services/revshare/equity/capital/custom`),
white-label service agreement, partner NDA + non-solicit, referral
agency agreement, finder's-fee intro agreement, strategic scale
partnership, technology-integration JV, M&A advisory mandate, MSA
equity-for-services — **all existing**.

**Needed (D803):** the **Subsidiary Licence Agreement**
(`subsidiary_licence_agreement_v1.md`, slug `subsidiary_licence_agreement`,
migration 514), **NEW DRAFT, SUBJECT TO COUNSEL**. Engineering wrote it from
the Licences canvas; HQ instantiates it per territory licence, with the
ledger's values and D797's terms merged in. Counsel must confirm:
- the **two-licensor structure**: Axal VC Holdings LLC licenses the platform IP
  and Axal VC Management LLC the trademark and brand (§1.1, §7.3);
- the **royalty** on platform licences the licensee sells (§4.7), and the
  revenue share per stream (§4.2);
- whether the **non-compete** after the term (§2.4) is enforceable in each
  territory;
- the **governing law** and forum (§22), recorded per licence;
- the **data-processing roles** of the licensors and the licensee (§7.4, §8.4),
  per territory.

## E. Platform ↔ advisors / mentors

Mentor NDAs ×2, mentor disclaimers ×2 — **existing**. Newly added:
**Advisor Program Terms** (`advisor_program_terms_v1.md`, **NEW DRAFT,
DORMANT**) — describes paid sessions/take-rate that must not publish
until Stripe Connect rails ship (build queue #124).

## F. Internal / corporate

Operating agreement template, IC charter, data-access acknowledgment,
resolutions — **existing**. The two **Platform IP Licence Agreements**
(D707), catalog stubs for counsel to draft, replace the one Holdings ↔
Management licence: `platform_ip_licence_management_admin` (Holdings →
Management, management administration) and
`platform_ip_licence_fund_admin` (Holdings → GP, fund administration).
`intercompany_ip_services_v1.md` (**NEW DRAFT**) is not issued: its §3.1
grants Management an exclusive licence, which leaves no room for the GP's.
Each of the three LLCs also needs its own **executed** operating
agreement (the template is generic); still to confirm: whether
Management and GP are wholly owned by Holdings.

**Operating Partner Agreement (Spin-Out Lab)** (`operating_partner_agreement_spin_out_lab`,
D758, migration 484) — catalog stub for counsel to draft; the canvas draws
it for Axal VC Management LLC, as Managing Partner. Question for counsel:
does it replace "MSA + Equity-for-Services (Operating Partner)"
(`msa_equity_for_services_v1.md`), or is it a separate document?

## Seed skeletons (D758)

These 24 files hold the old plain-text templates exactly as migration 085
seeded them; until D758 the text existed only in that migration. Each is a
**seed skeleton, counsel to expand**. They keep the flat merge tokens the
incorporation wizard fills — `{{company_name}}`, `{{incorporation_date}}`,
`{{registered_agent_name}}` and `{{registered_agent_address}}` — which are not
in `LEGAL_MERGE_SCHEMA`, so a preview shows them as written. Expanding one is
a new `_v2` file and a new store version, never an edit of the `_v1` file.

- Compliance: `aml_kyc_v1.md`, `ee_e_residency_application_kit_v1.md`,
  `ein_application_kit_v1.md`, `form_adv_v1.md`, `section_83b_v1.md`,
  `sg_acra_form_45_kit_v1.md`, `uk_form_in01_kit_v1.md`.
- Fund: `lpa_v1.md`, `mgmt_company_v1.md`, `ppm_v1.md`, `subscription_v1.md`.
- Portfolio: `bylaws_v1.md`, `certificate_of_incorporation_de_v1.md`,
  `ee_articles_of_association_v1.md`, `equity_split_v1.md`, `ip_license_v1.md`,
  `safe_v1.md`, `sg_constitution_v1.md`, `spa_v1.md`,
  `stock_purchase_agreement_v1.md`, `term_sheet_v1.md`,
  `uk_articles_of_association_v1.md`, `uk_memorandum_of_association_v1.md`,
  `voting_rights_v1.md`.

## Red flags for counsel — highest priority first

1. **Broker-dealer exposure.** The platform sold intro credit packs
   until 2026-10-18, when they were retired (D755, #1915; credits already
   bought still spend), holds a `finders_fee_intro_agreement_v1`, and seeds referral
   commission rules that include a percentage of deal funding
   (`routes/network.ts:76-80` — e.g. 2% of deal funding, 1% of a
   spin-out raise). Transaction-based compensation tied to securities
   transactions is the classic unregistered broker-dealer fact
   pattern. Needs a securities-law review of the entire intro/referral
   economics before scale.
2. **Adviser status.** The owner's model (D707) has the Fund pay the
   management fee to Axal VC GP LLC, so counsel must say which entity
   is the fund's adviser, confirm its exemption under Advisers Act
   §203(l) (venture capital fund adviser), and make any
   exempt-reporting-adviser Form ADV filings before a fund admits
   outside capital.
3. **Fund docs.** `subscription_booklet_lpa_v1` and the new IMA must
   be conformed to each other and reviewed before ANY capital is
   accepted; add a PPM per offering.
4. **DMCA agent registration** (see section A) — cheap, do first.
5. **Transfer pricing** on the intercompany licence fees (two platform
   IP licences, D707) — tax counsel.
6. **Single-member formality.** One person signs both sides of every
   intercompany document; keep resolutions and separate books to
   protect the liability walls between the three LLCs.
