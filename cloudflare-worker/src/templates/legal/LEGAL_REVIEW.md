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
| Terms of Service v4 (adds §4C, AI features and output) | `tos_v4.md` | **NEW DRAFT** (A19, #3763) — see section G; not imported, `tos_v3.md` stays live |
| Privacy Policy v3 (adds §3A, AI features) | `privacy_v3.md` | **NEW DRAFT** (A19, #3763) — see section G; not imported, `privacy_v2.md` stays live |
| Data Processing Addendum v2 (adds the Cloudflare AI and platform rows) | `dpa_v2.md` | **NEW DRAFT** (A19, #3763) — see section G |
| AI-image marking and attribution (specification) | `ai_image_marking_spec_v1.md` | **NEW DRAFT** (A19, #3763) — see section G; a spec, not a counterparty document |

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

## G. AI features (A19, #3763) — drafts for counsel

Four drafts for the deck builder v2's AI features (plan #3716, §5.10).
**Nothing here is published.** No file imports them; publishing is B17
(#3793), after the owner's decisions below. Each versioned draft is the
live text plus only the new section, so a diff against the live file
shows exactly what changes (`cloudflare-worker/test/legal_drafts_a19.test.ts`
checks this).

| Draft | What it adds | Counsel to confirm |
| --- | --- | --- |
| `tos_v4.md` | §4C, AI features and output: the member owns Output as between the parties; §4A does not reach Output; Input and Output are used only to provide the Service and not to train models; no warranty of accuracy, originality or non-infringement; the member is responsible for what a deck tells investors, and figures come from records, not models; providers' use policies flow down; no depicting a real person without agreement; marking must not be removed. | Whether ownership "to the extent any rights exist" is the right framing for machine output; the flow-down mechanism (linked policies "as if part of these Terms"); whether §4C.6 is enforceable. Re-acceptance uses the existing gate (`cloudflare-worker/test/terms_reacceptance_gate.test.ts`). |
| `privacy_v3.md` | §3A, AI features: what is sent to a model, Workers AI's statement that it does not train on customer content, other providers named before use, no training by Axal, and the run record (model, feature, cost, time; no content). The generated-asset deletion periods are in brackets. | The no-training sentence against Cloudflare's current Workers AI terms; the bracketed periods (decision W). |
| `dpa_v2.md` | Four Cloudflare rows in the Sub-processor Schedule: Workers AI and AI Gateway; Vectorize; Browser Rendering; Queues, Durable Objects and Analytics Engine. `dpa_v1.md` listed Cloudflare for Workers, D1, R2 and KV only, although all of these are bound in production (`wrangler.toml`). | Whether these are new sub-processors needing §6.1's ten days' notice, or the same sub-processor (Cloudflare) under an existing listing. **Not added:** Anthropic, which runs only behind a switch that is off (`AI_PROVIDER_ANTHROPIC`), and third-party image models (Bria, Recraft), which need decision M and the ten-day notice before any row is added. |
| `ai_image_marking_spec_v1.md` | How generated images (`deck_image`, `brand_logo`, `article_image`) are marked: XMP `DigitalSourceType = trainedAlgorithmicMedia` plus the model id and date, stamped after the image check and before storage, kept by every export; one on-screen attribution line, the existing `placedLine`, led by "AI image" when marking is on. | EU AI Act Article 50(2); whether C2PA is required; any visible label on slides; per-licence attribution (for example "Built with Llama"). |

**Owner decisions these drafts wait on** (S1's picks, all pending):

- **V · Marking AI images.** A: XMP `DigitalSourceType` and the model id (S1's pick); B: A plus a C2PA manifest, if counsel requires it; C: none.
- **W · Retention periods for generated assets.** S1's pick: plan §5.9.5's periods (discarded images 24 hours, unreferenced proposals 14 days, text proposals 30 days), confirmed by counsel. The plan's decision text also names snapshots "hourly for 7 days then daily"; §5.9.5 itself gives no snapshot period, so `privacy_v3.md` does not state one.
- **X · Model provider terms.** A: the owner accepts each provider's terms after a counsel summary in `documentation/architecture/MODEL_TERMS.md` (to be written under X), with "Built with Llama" shown if counsel confirms (S1's pick); B: Workers AI's terms only.
- **Y · ToS v4 AI-output clause.** A: ship before the beta, with re-acceptance (S1's pick); B: after the beta.

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
