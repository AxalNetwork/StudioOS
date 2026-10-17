# Axal VC — Legal entity map

Canonical reference for which Axal VC entity signs what. This file is the
source of truth — agreements, code constants, and frontend copy should
match the bucketing below. When in doubt, defer to this file and update
the document/code to match.

## The four entities

| Entity                    | Type | Jurisdiction | Role                                                                                              | Signatory (D705)                                   |
| ------------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Axal VC Holdings LLC**  | LLC  | Delaware     | Passive holding company. Owns IP, brand, domains, subsidiaries, treasury.                         | Managing Partner, until the owner gives another   |
| **Axal VC Management LLC**| LLC  | Delaware     | Operating company. Operates the platform, signs platform/customer/vendor/employment contracts.     | Managing Partner                                   |
| **Axal VC GP LLC**        | LLC  | Delaware     | General Partner of Axal VC Spin-Out Lab Fund I LP. Manages the Fund, makes investment decisions.  | General Partner                                    |
| **Axal VC Spin-Out Lab Fund I LP** | LP | Delaware | The Fund itself. Limited partnership pooling LP capital; managed exclusively by Axal VC GP LLC.   | General Partner, signing "By: Axal VC GP LLC, its general partner" |

The Fund's legal name is **Axal VC Spin-Out Lab Fund I LP**, as the owner gave
it on 2026-10-17 (D705). If the Certificate of Limited Partnership on file reads
differently, the certificate wins. Both LLCs the owner signs for are at 16192
Coastal Hwy, Lewes, DE 19958, United States. The `vc_funds` row's display name
("Spin-Out Fund I") is an admin-editable label, not the legal name.

## Under Axal VC Holdings LLC

Passive / ownership layer. Belongs here:

- Ownership of Axal VC Management LLC.
- Ownership of Axal VC GP LLC (if the HoldCo owns the GP entity).
- IP ownership: brand IP, platform IP, trademarks, copyrighted content,
  logos, product assets.
- Domains and digital property: `axal.vc`, subdomains, and key platform
  domains.
- Equity holdings in subsidiaries and SPVs.
- Passive investments, reserves, treasury assets, and other long-term
  holdings.
- Licenses of IP down to the operating company (Axal VC Management LLC)
  for platform operation.

## Under Axal VC Management LLC

Operating / active business layer. Belongs here:

- Employment and contractor agreements.
- Founder services agreements.
- Advisor, mentor, and partner service agreements.
- Software / SaaS customer contracts.
- **Platform Terms of Service and Privacy Policy** (the platform is
  operated by the management company).
- Data Processing Agreements (DPAs).
- Vendor agreements.
- Marketing, operations, and customer support contracts.
- Day-to-day partnership, service, and operational obligations.

## Axal VC GP LLC role

- General Partner of Axal VC Spin-Out Lab Fund I LP.
- Authority to manage the Fund, make investment decisions, approve exits,
  and oversee fund governance.
- Carries the fiduciary responsibility to act in the best interest of
  the LPs.
- Tied to carry economics rather than day-to-day platform operations.

### What it is NOT

- It is **not** the company that signs platform terms, customer
  contracts, or vendor agreements.
- It is **not** the main employment or operating entity for the Axal
  platform.
- It should **not** be mixed into the passive HoldCo bucket except as an
  ownership interest held by the HoldCo if you choose that structure.

## Where this is reflected in code

| Concern                                     | File                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Document architecture (preamble, exec block, entity routing, Markdown normalize) — worker | `cloudflare-worker/src/services/legalDocFormat.ts` |
| Document architecture — frontend mirror (live preview) | `frontend/src/lib/legalDocFormat.js` |
| Legal PDF renderer (header/CONFIDENTIAL, title, footer, signature) | `cloudflare-worker/src/services/pdf.ts` |
| Entity constants (frontend)                 | `frontend/src/brand/gvpn.ts` (`LEGAL_ENTITIES`)                       |
| Terms of Service (user-facing)              | `frontend/src/pages/TermsPage.jsx`                                    |
| Terms of Service (signable template)        | `cloudflare-worker/src/templates/legal/tos_v1.md`                     |
| Privacy Policy (user-facing)                | `frontend/src/pages/PrivacyPage.jsx`                                  |
| Privacy Policy (signable template)          | `cloudflare-worker/src/templates/legal/privacy_v1.md`                 |
| Risk Disclosures (user-facing)              | `frontend/src/pages/RiskDisclosuresPage.jsx`                          |
| Founder / Investor / Mentor mutual NDAs     | `cloudflare-worker/src/templates/legal/{founder,investor,mentor}_nda_v1.md` |
| Three-way founder ↔ investor ↔ Axal NDA     | `cloudflare-worker/src/templates/legal/nda_3way_founder_investor_axal_v1.md` |
| Partner Master Services Agreement           | `cloudflare-worker/src/templates/legal/partner_msa_v1.md`             |
| Accredited Investor self-certification      | `cloudflare-worker/src/templates/legal/accreditation_v1.md`           |
| Mentor disclaimer                           | `cloudflare-worker/src/templates/legal/mentor_disclaimer_v1.md`       |
| Partner Equity / Services / Revenue deals   | `cloudflare-worker/src/services/partnerDeals.ts`                      |
| IP Assignment / Equity Allocation templates | `cloudflare-worker/src/routes/legalcap.ts` (`TEMPLATES.IP_license`)   |
| Spin-out wizard subsidiary defaults         | `cloudflare-worker/src/routes/legalcap.ts` (`subsidiaries.holding_company_id`) |
| Esign intro boilerplate                     | `cloudflare-worker/src/routes/esign.ts` (`buildTemplateBody`)         |
| Public footer entity attribution            | `frontend/src/components/PublicFooter.jsx`                            |

## Default rules of thumb

1. If the agreement governs **use of the platform** (ToS, Privacy,
   NDAs, MSAs, vendor contracts, mentor / advisor / partner deals,
   customer contracts) → **Axal VC Management LLC** is the
   counterparty.
2. If the agreement is **IP-related at the platform/brand level**
   (trademark assignment, brand-IP licence, domain transfer, platform
   source-code assignment) → **Axal VC Holdings LLC** is the owner /
   counterparty.
3. If the agreement is an **LP's subscription to Axal VC Spin-Out Lab Fund I
   LP** or that LP's co-investment side letter → **the Fund** is the party,
   signing through its general partner Axal VC GP LLC ("By: Axal VC GP LLC,
   its general partner"; Title: General Partner). Other fund formation and
   governance documents (LPA, PPM, SPV joinder, strategic side letter,
   capital calls, distributions, carried interest) → **Axal VC GP LLC**, as
   general partner of the Fund.
4. If the agreement is for **investment in a portfolio company** (SAFE,
   term sheet, SPA, voting rights), the counterparty is the **portfolio
   company itself**, with **the Fund** (or an SPV) as investor, signing
   through its general partner — not any of the Axal VC management or
   holding entities directly.

The routing lives in `axalEntityKeyForDoc` (both `legalDocFormat` files).
Counsel confirms rules 3 and 4 before any of these documents is sent to an
LP (D705).

When adding a new legal document or contract type, update this file and
the entity-constant map in `frontend/src/brand/gvpn.ts` together.
