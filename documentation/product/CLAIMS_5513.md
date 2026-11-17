# Public claims record — partner verification and the 28-day Spin-Out Lab (#5513)

A redacted record of two measurable public claims, the evidence on `main` behind each, and the wording proposed in its place. It is **proposed, pending the owner's answer** on #5513. Nothing in it is approved wording until the owner fills in the owner fields and confirms the answer. It holds no customer data.

- **Prepared:** 2026-11-16, slot S21, from `main` at the time of the draft PR.
- **Decision:** `documentation/architecture/decisions/D5513.md`.
- **Out of scope here:** pricing claims (#4655) and the homepage counters (#1549).

## Claim 1 — "verified" partners

### Where it appears

| File | Line | Wording |
|---|---|---|
| `frontend/src/pages/LandingPage.jsx` | 196 | "venture tools, a **verified global partner network**, and capital when you're ready to scale" |
| `frontend/src/pages/LandingPage.jsx` | 46 | "**Verified partners**, advisors, and operators working with founders across borders, not a vendor directory." |
| `frontend/src/pages/PublicDirectoryPage.jsx` | 189 | Filter checkbox "**KYB-verified partners only**" on the public `/directory` |
| `frontend/src/data/productPages.js` | 492 | Plan feature "Verified partner badge" (see the note below) |
| `frontend/src/pages/SettingsPage.jsx` | 4212 | Plan feature "Verified partner badge" |

### What backs it on `main`

- **The general partner network has no recorded verification.**
  - The public directory lists a partner when an admin has set `directory_listed = 1` on an active row (`DIRECTORY_LISTED_WHERE`, `cloudflare-worker/src/routes/public.ts:68`). That is an admin approval, not a recorded check of who the partner is.
  - No table records a KYB status for a partner. `routes/needs.ts:85` says so: "No `kyb_status` column exists on `partners` — nor on any table in this schema".
  - The public directory read returns `kyb_verified: false` for every row (`public.ts:611`) and ignores the `verified_only` filter (`public.ts:570`). The "KYB-verified partners only" checkbox therefore narrowed nothing.
- **The partner proof flow does not verify partners.**
  - `partner_offers.ts` (`/proof`, `partner_proof_items`, `partner_proof_consents`) records a partner's own proof items and the client's consent to show them, with a claim hash and consent events.
  - That is evidence for an individual testimonial or example (criterion 3), not a check of the partner.
- **Formation partners do have a recorded verification (#6692, merged as `db213b6c6b`).**
  - Migration `202611151734_6692_formation_partners.sql`, D6692.
  - `formation_partners.status = 'verified'` requires an unexpired licence credential for the country (type, number, regulator, expiry, who checked it and when) and a signed data agreement. It records `verified_by`, `verified_at`, `what_was_checked` and `next_review_on`.
  - This covers formation (incorporation) partners only, not the wider network of advisors and operators. Production rows were not inspected for this record.
- **"Verified partner badge" is a partner plan feature.** It is a badge awarded by the network score (`partnerEarnings.js:109`, `recomputeNetworkScore`), not an identity or licence check. It is shown to partners inside the product, not as a public claim about the network. No change is proposed; the owner may want it renamed.

### Proposed wording

The coordinator's answer A was "'verified' means the partner passed the in-product partner proof flow". The trace shows that flow is not a verification of the partner, so A does not hold as written. The proposal keeps "verified" only where a check is recorded:

- **Hero:** "venture tools, a global partner network, and capital…" ("verified" dropped).
- **Pillar:** "Partners, advisors, and operators working with founders across borders, each approved before they are listed, not a vendor directory."
- **Directory:** the "KYB-verified partners only" filter is removed until a KYB status is recorded.
- **Optional, if the owner wants "verified" back:** say what was checked, for example "formation partners are licence-checked, with a signed data agreement and a review date". That is backed by #6692.

| Field | Value |
|---|---|
| Owner | _(owner to fill)_ |
| Review date | _(owner to fill)_ |
| Re-review trigger | Any change to `directory_listed` approval, to the #6692 verification rule, or a KYB status being recorded for partners |

## Claim 2 — "28 days", idea to incorporated company

### Where it appears (public)

| File | Line | Wording |
|---|---|---|
| `frontend/src/pages/LandingPage.jsx` | 56 | "The 28-day Spin-Out Lab takes an idea to an incorporated company" |
| `frontend/src/pages/LandingPage.jsx` | 328–331 | "Spin-Out Lab · 28-day venture sprint." / "Founders arrive with a thesis and leave with an incorporated entity, clean cap table, filed 83(b), evidenced discovery, revenue proof, and a deck…" |
| `frontend/src/lib/siteDoors.js` | 84, 99 | "The 28-day Spin-Out Lab takes an idea to an incorporated company" (founders door: fact and chapter) |
| `frontend/src/lib/studioPrograms.js` | 36 | Programs page purpose: "Idea to incorporated company in 28 days." |
| `frontend/src/lib/spinoutInvestorContent.js` | 42–44 | Investor page: "28-day company-formation environment. Founders enter with an idea and leave incorporated, 83(b)-filed, cap-table-clean, with verified customer discovery and revenue proof" |
| `frontend/src/pages/docs/sections/spin-out-lab.js` | 10 | Help: "a 28-day, week-by-week sprint that takes you from a hypothesis to an incorporated, funded company" |
| `frontend/src/pages/SpinoutLabInvestorPage.jsx` | 168, 188 | "Incorporated on time — within the 28-day schedule" (a figure, see below) |
| `frontend/src/pages/templates/SpinoutDemoDayPage.jsx` | 181 | Testimonial "Yasmin T., Founder, Cohort 3": "…real incorporation docs" (see criterion 3 below) |
| Others | — | `pricing.js:49`, `LabIntro.jsx:158`, `siteMethod.js:95–96`, `MethodologyPage.jsx:330–332`, `OnboardingFounderPage.jsx:133`, `RegisterPage.jsx:357`, `spinoutBrief.js:68`, `ogRegistry.js:448`, `SpinoutLabInvestorPage.jsx:239, 312`, `spinoutFundModel.js:142, 148`, `siteFirm.js:35`. These state the programme's length ("28-day sprint", "28-day programme", "four weeks"), which is backed, and need no change. |

### What backs it on `main`

- **28 days is the programme's length.** `COHORT_WEEKS = 4` (`frontend/src/lib/spinoutLab.js:55`) sets the four-week cohort. The Lab's weeks end with "Incorporate & capital".
- **"Incorporated" is recorded at payment, not at registration.** D585: `incorporation_completed` is recorded when the founder's incorporation order is paid (`paid`, `packet_processing`, `packet_ready` or `filed`), and that also graduates the founder. A paid order is not a registered company: when the state or registry registers it depends on the jurisdiction and the filer. Owner decision 7b on #6680 may change this.
- **Measured outcomes.**
  - `SpinoutLabInvestorPage.jsx` shows "Incorporated on time" from the live programme read (`on_time_pct`), measured at payment per D585.
  - **When that read is unavailable, the page falls back to fixed figures in `frontend/src/lib/spinoutFundModel.js:130–134` (`graduates: 37`, `onTimeIncorpPct: 86`, `alumniRaisedM: 8.6`).**
  - The fund brief and quarterly report view models (`fundBriefViewModel.js:98–100`, `quarterlyReportViewModel.js`) always use those fixed figures.
  - No source for them was found. The file itself notes that they conflict with the brochure's "12 companies built to date" and "$2.4M".
  - **These are unsupported outcome figures.** They are recorded here for the owner and not changed by this PR, because the fund brief has its own owner. See the open question.
- **Per-country formation time** will come from #6692's case events (payment to registration). No measured data was read for this record.

### Proposed wording (answer A: it is the programme's length)

- **List item (homepage and founders door):** "The Spin-Out Lab is a 28-day programme from idea to an incorporation order; when the company is registered depends on eligibility and the jurisdiction".
- **Founders door chapter:** "The 28-day Spin-Out Lab works an idea through to an incorporation order."
- **Programs page purpose:** "A 28-day programme from idea to an incorporation order."
- **Homepage Lab section:** "Founders arrive with a thesis and work through to an incorporation order, a cap table, the 83(b) election, evidenced discovery and a deck built from their own data. When the company is registered depends on eligibility and the jurisdiction."
- **Investor page:** "…Founders enter with an idea and work through to an incorporation order, the 83(b) election, a clean cap table, customer discovery and revenue proof…"
- **Help:** "…takes you from a hypothesis to an incorporation order and a raise-ready record. When the company is registered depends on eligibility and the jurisdiction."
- **Not changed (admin only):** the admin Programs catalogue's purpose, "Idea to incorporated company in 28 days, one cohort a month.", is seeded by applied migration 560. Changing it needs a new migration, which the owner can ask for.

| Field | Value |
|---|---|
| Owner | _(owner to fill)_ |
| Review date | _(owner to fill)_ |
| Re-review trigger | A change to `COHORT_WEEKS`, to D585's milestone timing (decision 7b), or measured registration times from #6692 that support a stronger statement |

## Criterion 3 — endorsements and identifiable examples

- **`/lp/spinout-demo-day` (`SpinoutDemoDayPage.jsx:170–185`)** shows named testimonials ("Oliver K., Angel Investor, Frontier Tech LP"; "Yasmin T., Founder, Cohort 3, Spin-Out Lab Graduate").
  - No authorisation, consent or source for them was found.
  - The partner proof flow (`partner_offers.ts`) is the existing consent path for a testimonial.
  - **Proposed:** remove them, or replace them with consented proof items. This PR does not change them; this is for the owner.
- **No other identifiable example** backing either claim was found on the public pages.

## Open question for the owner

1. **Partners:** confirm the proposed wording ("verified" dropped; listings "approved before they are listed"; the KYB filter removed). Or say that "verified" should return only for formation partners, with the #6692 check named.
2. **28 days:** confirm A, that it is the programme's length and that incorporation is an order, with registration timing subject to eligibility and jurisdiction. Or supply cases for B (an achieved outcome).
3. **Fixed outcome figures:** the fund brief, the quarterly report view and the investor page fallback show 37 graduates, 86% incorporated on time and $8.6M raised. Supply their source, or have them removed or replaced by the live read.
4. **Demo Day testimonials:** keep them with consent and a source, or remove them.
5. **Owner and dates:** who owns these claims, and the review date for each.
