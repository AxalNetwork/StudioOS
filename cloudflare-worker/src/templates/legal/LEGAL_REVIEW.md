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
| Axal VC Holdings LLC (owner: Joseph Gabriel Guillaume Lauzier) | IP holding company; member of the other two | Intercompany agreements only — never customer-facing |
| Axal VC Management LLC (Managing Partner: J.G.G. Lauzier) | Operating company; runs the platform | ToS, subscriptions, partner/advisor/customer agreements, DPA |
| Axal VC GP LLC (GP: J.G.G. Lauzier) | General partner of fund vehicles | LPA, subscription booklets, side letters, capital docs |

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

## C. Platform / GP ↔ investors and LPs

Investor NDA, accreditation self-cert, investor product subscriptions
(pro/inst), **LP Subscription Booklet + LPA**
(`subscription_booklet_lpa_v1`), co-investment side letter, SPV
joinder, strategic side letters, carried-interest allocation,
secondary purchase agreement, spin-out subsidiary SPA — **all
existing**. Newly added: **Investment Management Agreement**
(`investment_management_agreement_v1.md`, **NEW DRAFT**) between each
fund and Axal VC Management LLC. Deliberately absent: a PPM — always
counsel-drafted per offering, never templated.

## D. Platform ↔ service partners

Partner suite (`partner_msa/services/revshare/equity/capital/custom`),
white-label service agreement, partner NDA + non-solicit, referral
agency agreement, finder's-fee intro agreement, strategic scale
partnership, technology-integration JV, M&A advisory mandate, MSA
equity-for-services — **all existing**.

## E. Platform ↔ advisors / mentors

Mentor NDAs ×2, mentor disclaimers ×2 — **existing**. Newly added:
**Advisor Program Terms** (`advisor_program_terms_v1.md`, **NEW DRAFT,
DORMANT**) — describes paid sessions/take-rate that must not publish
until Stripe Connect rails ship (build queue #124).

## F. Internal / corporate

Operating agreement template, IC charter, data-access acknowledgment,
resolutions — **existing**. Newly added: **Intercompany IP License &
Services Agreement** (`intercompany_ip_services_v1.md`, **NEW
DRAFT**) — Holdings ↔ Management; execute before material revenue.
Each of the three LLCs also needs its own **executed** operating
agreement (the template is generic); still to confirm: whether
Management and GP are wholly owned by Holdings.

## Red flags for counsel — highest priority first

1. **Broker-dealer exposure.** The platform sells intro credit packs,
   holds a `finders_fee_intro_agreement_v1`, and seeds referral
   commission rules that include a percentage of deal funding
   (`routes/network.ts:76-80` — e.g. 2% of deal funding, 1% of a
   spin-out raise). Transaction-based compensation tied to securities
   transactions is the classic unregistered broker-dealer fact
   pattern. Needs a securities-law review of the entire intro/referral
   economics before scale.
2. **Adviser status.** Confirm Axal VC Management LLC's exemption
   under Advisers Act §203(l) (venture capital fund adviser) and make
   any exempt-reporting-adviser Form ADV filings before a fund admits
   outside capital.
3. **Fund docs.** `subscription_booklet_lpa_v1` and the new IMA must
   be conformed to each other and reviewed before ANY capital is
   accepted; add a PPM per offering.
4. **DMCA agent registration** (see section A) — cheap, do first.
5. **Transfer pricing** on the intercompany license fee — tax counsel.
6. **Single-member formality.** One person signs both sides of every
   intercompany document; keep resolutions and separate books to
   protect the liability walls between the three LLCs.
