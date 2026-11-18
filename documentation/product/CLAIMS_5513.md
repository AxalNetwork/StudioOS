# Public claims record — partner verification and the 28-day Spin-Out Lab (#5513)

A redacted record of two measurable public claims, the evidence on `main` behind each, and the approved wording. It holds no customer data.

- **Status: approved.** The owner answered all five questions on 2026-11-17 (#5513). The wording for claims 1 and 2 shipped in #6929. The fixed outcome figures and the Demo Day testimonials came down in the follow-up PR (D5513-p2).
- **Prepared:** 2026-11-16, slot S21. **Updated:** 2026-11-17.
- **Decisions:** `documentation/architecture/decisions/D5513.md`, `D5513-p2.md`.
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

### Approved wording

The coordinator's answer A was "'verified' means the partner passed the in-product partner proof flow". The trace shows that flow is not a verification of the partner, so A does not hold as written. The approved wording keeps "verified" only where a check is recorded:

- **Hero:** "venture tools, a global partner network, and capital…" ("verified" dropped).
- **Pillar:** "Partners, advisors, and operators working with founders across borders, each approved before they are listed, not a vendor directory."
- **Directory:** the "KYB-verified partners only" filter is removed until a KYB status is recorded.
- **Optional, if the owner wants "verified" back:** say what was checked, for example "formation partners are licence-checked, with a signed data agreement and a review date". That is backed by #6692.

| Field | Value |
|---|---|
| Approved wording | The hero and pillar wording above; no KYB filter (shipped in #6929) |
| Owner | The owner (Axal VC), per the 2026-11-17 answer on #5513 |
| Review date | The next quarterly review after 2026-11-17 |
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
  - **Until 2026-11-17, when that read was unavailable, the page fell back to fixed figures** in `spinoutFundModel.js` (`graduates: 37`, `onTimeIncorpPct: 86`, `alumniRaisedM: 8.6`). So did the LP workspace hero and the fund brief, through `programFigures`. The investor page's studio-proof tiles also carried fixed figures: 92%, "34 of 37 graduates", 89%, 62%, 24 days, 30%, "11 of 37 graduates backed". No source was found for any of them.
  - **Removed (owner, 2026-11-17; D5513-p2).** `PROGRAM` is gone from `spinoutFundModel.js` and the tiles carry no values. Every one of those figures now comes from the `GET /api/spinout-lab/fund-metrics` program block, or reads "Not recorded" ("Unreadable" when the read failed), until a source is recorded.
  - The quarterly report view model never printed these three. It still draws other fixed tables from the model (cohort graduation counts, NAV and IRR progression, sector exposure). Those are fund-reporting figures outside this record, raised separately.
- **Per-country formation time** will come from #6692's case events (payment to registration). No measured data was read for this record.

### Approved wording (answer A: it is the programme's length)

- **List item (homepage and founders door):** "The Spin-Out Lab is a 28-day programme from idea to an incorporation order; when the company is registered depends on eligibility and the jurisdiction".
- **Founders door chapter:** "The 28-day Spin-Out Lab works an idea through to an incorporation order."
- **Programs page purpose:** "A 28-day programme from idea to an incorporation order."
- **Homepage Lab section:** "Founders arrive with a thesis and work through to an incorporation order, a cap table, the 83(b) election, evidenced discovery and a deck built from their own data. When the company is registered depends on eligibility and the jurisdiction."
- **Investor page:** "…Founders enter with an idea and work through to an incorporation order, the 83(b) election, a clean cap table, customer discovery and revenue proof…"
- **Help:** "…takes you from a hypothesis to an incorporation order and a raise-ready record. When the company is registered depends on eligibility and the jurisdiction."
- **Not changed (admin only):** the admin Programs catalogue's purpose, "Idea to incorporated company in 28 days, one cohort a month.", is seeded by applied migration 560. Changing it needs a new migration, which the owner can ask for.

| Field | Value |
|---|---|
| Approved wording | "a 28-day programme from idea to an incorporation order; when the company is registered depends on eligibility and the jurisdiction" (shipped in #6929) |
| Owner | The owner (Axal VC), per the 2026-11-17 answer on #5513 |
| Review date | The next quarterly review after 2026-11-17 |
| Re-review trigger | A change to `COHORT_WEEKS`, to D585's milestone timing (decision 7b), or measured registration times from #6692 that support a stronger statement |

## Criterion 3 — endorsements and identifiable examples

- **`/lp/spinout-demo-day` (`SpinoutDemoDayPage.jsx:170–185`)** shows named testimonials ("Oliver K., Angel Investor, Frontier Tech LP"; "Yasmin T., Founder, Cohort 3, Spin-Out Lab Graduate").
  - No authorisation, consent or source for them was found.
  - The partner proof flow (`partner_offers.ts`) is the existing consent path for a testimonial.
  - **Removed (owner, 2026-11-17; D5513-p2).** The "Past Attendees" section and its three named testimonials are off the page. They return only with recorded consent and a source, through the partner proof flow.
- **No other identifiable example** backing either claim was found on the public pages.

## Owner answers (2026-11-17)

1. **Partners:** drop "verified". Listings read "approved before they are listed", and the KYB filter is removed. Shipped in #6929.
2. **28 days:** the programme's length, with the wording in claim 2. Shipped in #6929.
3. **Fixed outcome figures** (37 graduates, 86%, $8.6M): removed. Only the live read is shown, or nothing, until a source is recorded. The investor page's other fixed studio-proof figures follow the same rule. Done in D5513-p2.
4. **Demo Day testimonials:** taken down until consent and a source are recorded. Done in D5513-p2.
5. **Owner and review date:** the owner, with review at the next quarterly review. Recorded in the tables above.
