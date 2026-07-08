# Service-Partner Experience — UX/UI Audit & Redesign Roadmap

**Scope**: the full service-partner panel at axal.vc — the login landing, the Sourcing group (My Services, AI Matches, Needs Board, Marketplace, Demand Insights), the Engage group (My Office Hours, Calendar, Network, Co-Marketing, Events, Jobs), the Account group, partner onboarding, and the marketplace economy the partner sells through — reviewed as one connected product system.
**Constraints honored** (mirroring the other three audits): the partner sidebar groups (Home / Sourcing / Engage / Account) are unchanged; the partner lifecycle is designed as a **module on the partner's home**, not a new sidebar section; simplification is preferred over new pages.
**Method**: claims verified against the shipping code (`frontend/src/`, `cloudflare-worker/src/routes/`, `cloudflare-worker/sql/`), with the contract and schema findings re-verified line-by-line first-hand. Companion documents: `FOUNDER_UX_AUDIT.md` (merged, #133), `INVESTOR_UX_AUDIT.md`, `ADVISOR_UX_AUDIT.md` (#134).

---

## Executive summary

The four-persona pattern completes: founders got studio tools in a founder costume; investors got their product left unplugged; advisors got a facade; **service partners got three storefronts on two foundations, with a cash register that prints the word "stub"**. Six systemic problems:

1. **Partners land on the wrong desk — twice.** `ROLE_DEFAULT_PATH` (`App.jsx:219`) sends partners to `/partner-portal` → `PartnerPortal.jsx`, a page titled **"Partner / Investor Portal"** whose tabs are Deals / Capital Calls / LP Investors / Portfolio — an LP-investor console with almost nothing a *service* partner does. Meanwhile their sidebar Home says **Studio** (`/studio` → the founder-identical Dashboard, whose partner-lens payload — `dashboard.ts` computes `proprietary_deal_flow`, `quick_stats`, and `syndication_tools` for `isPartner` — is never rendered, as established in the investor audit). Two homes; neither is a service-partner workspace.

2. **One economy, three marketplaces, two schemas.** The Sourcing group points at three different backends for the same job:
   - **My Services** (`/services` → `ServiceCatalogPage.jsx`) → `services.ts` offerings + `service_engagements` "engage" requests;
   - **Needs Board** (`/needs` → `NeedsBoardPage.jsx`) → `needs.ts`, the full RFP economy (`founder_needs / rfps / quotes / engagements / engagement_reviews`);
   - **Marketplace** (`/marketplace` → `MarketplacePage.jsx`) → `catalog.ts`, a third system of providers / inquiries / inquiry-messages / provider-reviews.
   Worse, the repo carries **two conflicting `CREATE TABLE IF NOT EXISTS service_offerings` definitions** — `schema.sql:724` (`owner_user_id / summary / price_usd`, the shape `services.ts` queries) versus `t13_t14_t15.sql:377` (`partner_id / description / price_min / price_max`). Both are `IF NOT EXISTS`: whichever ran first on the production database won, and the other code path's columns simply don't exist.

3. **The drift disease, fourth appearance.** `ServiceCatalogPage` renders `o.description` and `o.partner_name` (`ServiceCatalogPage.jsx:74,137`) while `services.ts` serializes `summary` and `owner_user_id` (`services.ts:19-46`) — descriptions render blank, partner names never appear, and the create form's Description field is **silently dropped** (POST reads `summary`, `services.ts:83`). `PartnerOfficeHoursPage` is broken **identically to the advisor page**: it sends `start_at`/`duration_min` (`PartnerOfficeHoursPage.jsx:13,23-24`) where `partner_office_hours.ts` requires `starts_at`/`ends_at` (`:60`) — **slot creation 400s every time** — and the booking status vocabulary mismatches the UI's action gates. No founder-facing page renders partner slots anyway (verified in the advisor audit): the system has supply-side management for inventory nobody can browse.

4. **The win-work lifecycle exists — buried in one page, ending in a stub.** `needs.ts` implements a genuinely complete chain: need → RFP → quote (accept / reject / withdraw) → engagement with a proper status machine (accepted → in_progress → delivered → invoiced / reviewed / cancelled), correctly gated partner-side transitions, delivery notes, and two-sided reviews. But the partner's entire workflow — browsing demand, quotes sent (`GET /quotes/me`), active engagements (`GET /engagements`) — lives inside the **910-line `NeedsBoardPage`**; there is no engagements home, no pipeline view, no next actions. And the terminal step is fake: the invoice transition writes **`invoice_id = 'stub-…'`** with the in-code comment *"Stripe Connect not in worker port"* (`needs.ts:431`). No money ever moves — while the wellbeing-experts system (as documented in the advisor audit) runs full Stripe Connect one door over.

5. **The front door is an invite token; the side door mislabels people.** Real partner onboarding is `partner_onboarding.ts` — an invite-token wizard (`/:token/profile → propose → select → finalize`) writing `partner_profiles` + `partner_deals`, managed through `PartnerDealPortal.jsx` — invite-only deal formation. Meanwhile persona onboarding funnels every **"Operator / Advisor"** signup into the partner role (`personas.ts:178-181`, the same mislabel flagged in the advisor audit) with **no setup path at all**: no profile prompt, no first-offering prompt, dropped onto the LP portal.

6. **Bright spots exist and point the way.** **Demand Insights** (`PartnerInsightsPage.jsx`) is real aggregation — demand feed, heatmap, newsletter subscription — the one partner-native signal surface. And the partner sidebar is the best-curated of the four personas (deliberate Sourcing/Engage verbs, documented removals of investor-shaped noise). The failure isn't the information architecture; it's that the surfaces behind it are fragmented across three backends, drifted off their contracts, and unpaid.

**The fix**: one marketplace backend, one reconciled schema, one Partner Desk to land on, an engagements workspace for won work, and real invoicing on rails the product already owns.

---

## Section-by-section audit

### 1) Home — where a partner lands

**What's there.** Login → `/partner-portal` ("Partner / Investor Portal": Deals, Capital Calls, LP Investors, Portfolio, referral-code copy — `PartnerPortal.jsx:79-87`). The sidebar's Home group points elsewhere (Studio → `Dashboard.jsx`), which shows a partner the founder's welcome page; the partner-lens data the dashboard API computes for them goes unrendered.

**Critique.** A service partner's first screen is capital calls and LP investors — another persona's furniture. The nav and the landing disagree about where home is, and both candidates are wrong.

**Recommendation.** A **Partner Desk** via role-conditional composition on `/studio` (the same pattern as the founder venture card and investor deal desk): partner lifecycle rail + open needs matching the partner's categories + quotes awaiting decision + active engagements + an insights digest. Point `ROLE_DEFAULT_PATH` for service partners at `/studio`; `/partner-portal` remains for genuinely investor-type partners (its actual audience) and gets retitled accordingly.

### 2) The marketplace — supply side (`My Services`)

**What's there.** `ServiceCatalogPage` CRUD over `services.ts` offerings. Fields drift (description ↔ summary; partner_name never returned); the double-`CREATE TABLE` schema conflict sits underneath.

**Recommendation.** Reconcile the contract worker-out (one schema migration resolving the two `service_offerings` shapes; the DTO carries the `description`/`partner_name` the page was designed for), and make My Services the partner's **storefront**: offerings with categories and price ranges, publish/unpublish, view counts.

### 3) The marketplace — demand side and the buried lifecycle

**What's there.** `NeedsBoardPage` (910 lines) holds everything: needs browsing, RFPs, quote submission, "My quotes", and the engagements list. `catalog.ts` duplicates the inquiry half under `MarketplacePage`. The engagement status machine is sound; invoicing is stubbed.

**Recommendation.**
- **`needs.ts` becomes the canonical economy.** `catalog.ts` inquiries fold in (an inquiry is a lightweight need); `services.ts` engage-requests become need-creation prefilled from an offering. One backend, one review model (`engagement_reviews`).
- **An Engagements tab** inside the existing marketplace workspace (no new sidebar item): quotes sent → active engagements → history, with the partner-side actions (start / deliver / invoice) surfaced as next actions. The data is already served by `/quotes/me` and `/engagements`; it needs a room of its own, not a corner of the Needs Board.
- `FounderMarketplacePage` keeps its two tabs, reading the same canonical backend.

### 4) Office hours

Same break, same fix as the advisor audit (§1 there): contract-fix worker-out, then unify `partner_office_hours.ts` with the advisors engine (one parameterized office-hours service — partners gain reviews for free). Add the missing demand side: render partner slots on `PublicPartnerProfilePage` and in Network contexts so founders can actually discover and book them.

### 5) Money

Invoicing writes stub IDs; nothing collects payment; the only Stripe Connect within partners' reach is the referral program. **Adopt the wellbeing rails for engagement invoicing**: quote amount → invoice → payment intent → payout, with an Earnings panel on the Partner Desk. This is the same recommendation as the advisor audit's ⑤ — one payments integration serves both personas.

### 6) Onboarding, leads, and the Engage group

- **Self-serve "Offer services" path**: after persona onboarding (partner alignment), a first-run setup — profile, categories, first offering — instead of a drop onto the LP portal. The invite-token deal wizard stays for equity/deal partners. Fix the "Operator / Advisor" mislabel jointly with the advisor audit's ③.
- **Partner-audience landing leads** finally get a destination (completing the founder audit's lead taxonomy): an intro queue on the Partner Desk, with a "Promote to marketplace inquiry" action in the Contacts hub.
- Engage group: Co-Marketing and Calendar are fine; **Demand Insights** deserves a cross-link from the Desk (it's the growth loop); Network inherits the lead fix above.

---

## The Partner Lifecycle module (on the Partner Desk)

| Stage | Partner's goal | Existing surfaces | Top action | System surfaces first |
|---|---|---|---|---|
| **Join** | Get set up to sell | persona onboarding + first-run setup (new) | Complete profile + first offering | setup completeness |
| **List** | Publish a storefront | My Services (contract fixed) | Publish 3 offerings | offering views |
| **Win** | Convert demand into work | Needs Board, quotes, AI Matches | Quote 2 open needs | matching needs, quotes pending |
| **Deliver** | Complete engagements well | Engagements tab (new), office hours | Advance an engagement | active work, due milestones |
| **Get paid** | Invoice and collect | Stripe rails (new) replacing the stub | Send an invoice | unpaid invoices, earnings |
| **Grow** | Compound reputation and reach | Reviews, Demand Insights, Co-Marketing, Articles | Ask for a review; check the heatmap | rating, demand trends |

Mechanics: the same compact rail + next-best-action components as the founder, investor, and advisor modules; stages derive from existing data (`partner_profiles`, offerings count, quote/engagement statuses, `engagement_reviews`, Stripe status). No wizard, no new sidebar entries.

---

## What should be merged, removed, or relocated

| Action | What | Destination |
|---|---|---|
| **Fix** | `service_offerings` double-CREATE schema conflict | one reconciliation migration |
| **Fix** | ServiceCatalogPage ↔ services.ts drift (`description`/`partner_name`) | reconciled contract, worker-out |
| **Fix** | PartnerOfficeHoursPage contract (same as advisor audit ①) | worker-out contract fix |
| Merge | `catalog.ts` providers/inquiries + `services.ts` engage-requests | `needs.ts` canonical economy |
| Surface | Quotes sent + engagements workspace | tab in the existing marketplace workspace |
| Replace | `stub-` invoicing (`needs.ts:431`) | Stripe Connect rails (wellbeing pattern) |
| Relocate | Service-partner default landing | Partner Desk on `/studio`; LP portal keeps its true audience |
| Render | `dashboard.ts` partner payload (unrendered) | Partner Desk |
| Add | Self-serve offer-services onboarding | first-run setup after persona flow |
| Wire | Partner-audience landing leads (dead-end) | Desk intro queue + Contacts promote path |
| Merge | Partner office-hours engine into the advisors engine | one parameterized service |
| Surface | Partner slots for founders | PublicPartnerProfilePage + Network |
| Rename | "Partner / Investor Portal" | named for its real (investor-partner) audience |

## Recommended partner information architecture (sidebar unchanged)

```
Home
  Studio → PARTNER DESK: lifecycle rail + matching needs + quotes pending
           + active engagements + earnings + insights digest
Sourcing
  My Services      storefront CRUD (contract fixed) + view counts
  AI Matches       unchanged
  Needs Board      demand only (quotes/engagements move to their own tab)
  Marketplace      reads the canonical economy (catalog.ts retired into needs)
  Demand Insights  unchanged — cross-linked from the Desk
Engage
  My Office Hours  contract fixed · unified engine · discoverable by founders
  Calendar · Network (+ lead intro queue) · Co-Marketing · Events · Jobs   unchanged
Account            unchanged
```

## High-impact redesign recommendations (the short list)

1. **One marketplace, one schema** — resolve the double-CREATE and the three-backend split before anything else; every other fix builds on it.
2. **Land partners at their own desk** — stop opening the LP console for people who sell design sprints.
3. **Give won work a home** — the engagement lifecycle is built; it needs a workspace, not a corner of a 910-line page.
4. **Make the invoice real** — replace the `stub-` with the Stripe rails the product already runs for experts.
5. **Open a self-serve front door** — profile + first offering at signup, not an invite token or a silent role drop.
6. **Let founders find partner office hours** — supply-side management for undiscoverable inventory helps no one.

## Prioritized redesign roadmap

Effort: S = day-scale, M = multi-day, L = week+.

### Critical — the marketplace has to be real
1. **Marketplace contract + schema reconciliation** — resolve the `service_offerings` double-CREATE (migration), fix the ServiceCatalogPage field drift worker-out. *(M)*
2. **Partner Desk** — role-conditional `/studio` composition (render the existing dashboard partner payload, lifecycle rail, matching needs, quotes pending); `ROLE_DEFAULT_PATH` change for service partners. *(M/L)*
3. **Engagements workspace tab** — quotes sent / active / history with partner-side actions; data already served. *(M)*
4. **Office-hours contract fix** — shared work item with the advisor audit's ①. *(S when done together)*

### Important — finish the lifecycles
5. **Stripe invoicing** replacing the stub (shared rails with advisor ⑤). *(L)*
6. **Marketplace consolidation** — `catalog.ts` + `services.ts` engage-requests into `needs.ts`. *(L)*
7. **Self-serve onboarding + persona fix** (shared with advisor ③). *(M)*
8. **Partner-lead destination + slot discovery** on the public profile. *(M)*

### Nice to have
9. Partner lifecycle rail on the Desk (reuses the shared rail). *(M)*
10. Insights/Co-Marketing cross-links from the Desk. *(S)*
11. Shared marketplace/booking primitives (with advisor ⑨). *(M)*
12. Retitle "Partner / Investor Portal"; copy pass on Sourcing labels. *(S)*
