# Service-Partner Experience — UX/UI Audit & Redesign Roadmap

**Scope**: the full service-partner panel at axal.vc — landing/home surfaces, the three marketplace systems (My Services, Needs Board, Marketplace), partner office hours, engagement invoicing, onboarding (both the invite-token wizard and persona self-signup), Demand Insights, and the partner lead pipeline — reviewed as one connected product system. This is the fourth and final persona audit, following the founder (merged), investor, and advisor audits.
**Constraints honored**: no new top-level sidebar sections are proposed; the partner lifecycle is designed as a module on the partner's landing surface; consolidations reuse existing workspaces and tabs.
**Method**: every claim below was verified first-hand against the shipping code (`frontend/src/`, `cloudflare-worker/src/routes/`, `cloudflare-worker/sql/`). File references are included so each finding is actionable. A verification appendix lists the exact reads.

A note on personas: "partner" in StudioOS covers two different people. The **service partner** sells services to founders (the subject of this audit). The **investor-type partner** participates in deals, capital calls, and LP relationships (served by `/partner-portal`). Much of what follows is the product conflating the two.

---

## Executive summary — six systemic problems

The partner experience has the best-curated sidebar of the four personas and one genuinely partner-native surface (Demand Insights) — and almost everything behind the navigation is fragmented, drifted, or fake. Six systemic problems:

1. **Partners land on the wrong desk — twice.** `ROLE_DEFAULT_PATH` (`App.jsx:219`) sends every partner to `/partner-portal` → `PartnerPortal.jsx`, a 491-line console titled **"Partner / Investor Portal"** whose tabs are Deals / Capital Calls / LP Investors / Portfolio — an LP-investor cockpit with almost nothing for someone who sells services. Meanwhile the partner sidebar's Home entry says **Studio** and points at `/studio` — the founder-identical `Dashboard.jsx`, whose partner-specific payload (`dashboard.ts` computes `proprietary_deal_flow`, `quick_stats`, and `syndication_tools` for `isPartner` users) is **never rendered by any component**, as already established in the investor audit. The service partner therefore has two "homes": one built for a different persona, and one that ignores the data computed for them. Neither shows their services, their quotes, their engagements, or their earnings.

2. **One economy, three marketplaces, two schemas.** The partner's Sourcing group points at three different backends for the same job — selling services to founders:
   - **My Services** (`/services` → `ServiceCatalogPage` → `services.ts`): service offerings plus `service_engagements` "engage" requests.
   - **Needs Board** (`/needs` → `NeedsBoardPage` → `needs.ts`): a full RFP economy over `founder_needs` / `rfps` / `quotes` / `engagements` / `engagement_reviews`.
   - **Marketplace** (`/marketplace` → `MarketplacePage` → `catalog.ts`): providers / inquiries / messages / provider-reviews.

   None of the three share tables. Worse, the repo carries **two conflicting `CREATE TABLE IF NOT EXISTS service_offerings` definitions**: `schema.sql:724` declares `owner_user_id` / `summary` / `price_usd` (the shape `services.ts` queries), while `t13_t14_t15.sql:377` declares `partner_id` / `description` / `price_min` / `price_max`. Because both use `IF NOT EXISTS`, whichever ran first on production won — and the other code path's columns simply don't exist on the live table.

3. **The drift disease, again.** The same frontend↔worker contract drift documented in the investor and advisor audits recurs on both partner-facing surfaces:
   - `ServiceCatalogPage` renders `o.description` and `o.partner_name`; `services.ts` serializes `summary` and `owner_user_id` (`services.ts:19-46`). Result: every offering's description renders blank, and the create form's Description field is **silently dropped** — the POST handler reads `summary` (`services.ts:83`), which the form never sends.
   - `PartnerOfficeHoursPage` is broken **identically to the advisor page**: it sends `start_at` / `duration_min` (`PartnerOfficeHoursPage.jsx:13,23-24`) where `partner_office_hours.ts` requires `starts_at` / `ends_at` (`partner_office_hours.ts:60`) — so slot creation 400s every time. The status vocabulary mismatches too (worker bookings are born `pending`; the UI gates on a different vocabulary), so bookings can never be confirmed from the UI. And even if a partner somehow published slots, **no founder-facing page renders partner office-hours slots at all** (verified in the advisor audit: partner office hours has no discovery surface).

4. **The win-work lifecycle exists — buried in one page, ending in a stub.** `needs.ts` implements a real, properly-gated chain: need → RFP → quote (accept / reject / withdraw) → engagement (accepted → in_progress → delivered → invoiced), with partner-side transitions permission-checked, delivery notes, and reviews. This is the best backend the partner has. But the entire partner workflow — browsing demand, tracking quotes sent, advancing active engagements — lives inside the 910-line `NeedsBoardPage`. There is no "My engagements" home, no pipeline view, no next-action surface. And the terminal step is fake: the invoice action writes **`invoice_id = 'stub-…'`** with the comment "Stripe Connect not in worker port" (`needs.ts:431`). No money ever moves through the partner economy — while the wellbeing-experts system, one door over, has the complete Stripe Connect kit (accounts, payment intents, payouts) already shipped.

5. **The front door is an invite token; the side door mislabels people.** Real partner onboarding is `partner_onboarding.ts` — a token-gated wizard (`GET /:token` → `/profile` → `/propose` → `/select` → `/finalize`) that writes `partner_profiles` + `partner_deals` and hands off to the e-sign envelope flow, managed afterward via `PartnerDealPortal.jsx`. That flow is solid — but it is invite-only deal formation for equity/deal partners. Meanwhile persona onboarding funnels **every "Operator / Advisor" self-signup into the partner role** (`personas.ts:178-181`) with **no setup path at all**: no profile prompt, no "list your first service" step, no category selection — the new partner is simply dumped onto the LP-investor portal (problem 1). There is no self-serve way to become a *service* partner.

6. **Bright spots exist and point the way.** **Demand Insights** (`PartnerInsightsPage`, 299 lines) is real aggregation — a demand feed, a category heatmap, a newsletter subscribe — and is the one partner-native signal surface in the product. The partner sidebar itself is the best-curated of the four personas: deliberate "Sourcing" / "Engage" verb groups and documented removals rather than accidental accretion. The failure is not the information architecture — it's that the surfaces behind it are fragmented (problem 2), drifted (problem 3), and unpaid (problem 4).

**The fix is not more pages.** It is one marketplace economy with one schema, one partner desk that shows the win-work pipeline, working office-hours and invoicing contracts, and a self-serve path into all of it.

---

## Section-by-section audit

### 1) Home (`/partner-portal` → `PartnerPortal.jsx`; sidebar Home → `/studio`)

**What's there.** `PartnerPortal.jsx` (491 lines) is titled "Partner / Investor Portal" and offers tabs Deals / Capital Calls / LP Investors / Portfolio plus a referral-code copy widget (`PartnerPortal.jsx:79-87`). It is a reasonable console — for an LP or deal partner. The sidebar Home simultaneously points at `/studio`, the founder-identical Dashboard; `dashboard.ts` computes a partner payload (`proprietary_deal_flow` / `quick_stats` / `syndication_tools`) for `isPartner` users that no component renders.

**Critique.** Wrong persona's furniture on one home; computed-but-invisible data on the other. A service partner opening the app sees capital calls and LP tables they will never use, and a Studio dashboard that greets them like a founder. Nothing anywhere shows the things a service partner actually tracks: open needs matching their categories, quotes awaiting a response, active engagements, unpaid invoices, their rating.

**Recommendation.** Partners land on a **Partner Desk** — `/studio` with role-conditional composition, matching the founder/investor pattern established in the prior audits: a lifecycle rail (module below), open needs matching the partner's categories, quotes awaiting response, active engagements with next actions, and an insights digest from Demand Insights. `/partner-portal` **stays** for genuinely investor-type partners — it already serves them well — but is dropped from `ROLE_DEFAULT_PATH` for service partners. Align the sidebar Home label with wherever the partner actually lands, and render the `dashboard.ts` partner payload that already exists.

### 2) Marketplace consolidation — the core recommendation (`/services`, `/needs`, `/marketplace`)

**What's there.** Three parallel systems over two conflicting schemas (executive summary, problem 2). `services.ts` has offerings + a lightweight "engage" request table. `needs.ts` has the complete RFP economy with gated lifecycle transitions and reviews. `catalog.ts` has providers, inquiries, message threads, and provider reviews. `FounderMarketplacePage` gives founders a two-tab view over parts of this.

**Critique.** One economy, three inboxes, zero shared state. A founder can "engage" a partner in `services.ts`, open an RFP against them in `needs.ts`, and message them via a `catalog.ts` inquiry — three threads about the same piece of work, none aware of the others. The double-`CREATE` on `service_offerings` means one of the two code paths is querying columns that don't exist in production; which path is broken depends on migration order, which is exactly the kind of latent breakage no one notices until a partner asks where their listing went.

**Recommendation.** One economy needs one system, and **`needs.ts` (the RFP economy) becomes canonical** — it is the only one with a full lifecycle and reviews.
- `services.ts` offerings fold in as the partner's public **storefront listings**: migrate to the one true `service_offerings` shape and resolve the double-CREATE with a reconciliation migration that reconciles the columns explicitly (no more `IF NOT EXISTS` roulette).
- `catalog.ts` providers/inquiries retire into **needs-inquiries** — an inquiry is a lightweight need.
- UI: **My Services** = storefront CRUD with fixed field contracts; **Needs Board** = demand only (browse + quote); a new **Engagements** tab *inside the existing marketplace workspace* (not a new sidebar item) = quotes sent + active work + delivery actions — the data is already served by `/quotes/me` and `/engagements`.
- `FounderMarketplacePage` keeps its two tabs, reading the same canonical backend.

### 3) Office hours (`PartnerOfficeHoursPage.jsx` ↔ `partner_office_hours.ts`)

**What's there.** A worker route (`partner_office_hours.ts`) that mirrors the advisors engine but keyed on `partner_id`: slot CRUD, capacity-checked booking with race handling, a proper status machine (`pending → confirmed → completed / cancelled / no_show`), and calendar-sync hooks. A partner-facing page (`PartnerOfficeHoursPage.jsx`) for managing slots and bookings.

**Critique.** The same two-sided contract failure as the advisor audit's finding ①, in a copy of the same file pair: the page sends `start_at` / `duration_min`; the worker validates `starts_at` / `ends_at` (`partner_office_hours.ts:60`) — slot creation 400s. The booking-status vocabularies disagree, so nothing can be confirmed from the UI. And the demand side is missing entirely: no founder-facing surface lists partner slots, so even a working supply side would have zero discovery.

**Recommendation.** Apply the identical contract fix as the advisor audit ① (align field names and status vocabulary to the worker's contract — worker-out, per the established convention); then **unify with the advisor office-hours engine** as one parameterized service (already roadmapped as advisor audit ⑥) — partners gain session reviews from the shared engine for free. Add the founder-facing discovery surface: render partner slots on the partner's public profile (`PublicPartnerProfilePage`) and in Team/Network contexts where partners already appear.

### 4) Money (`needs.ts` invoicing; Refer & Earn)

**What's there.** The engagement lifecycle's terminal step writes `invoice_id = 'stub-…'` (`needs.ts:431`, comment: "Stripe Connect not in worker port"). Meanwhile the wellbeing-experts system has the full Stripe Connect kit — connected accounts, payment intents, payouts — shipped and working. Refer & Earn is a separate, functioning referral program with payout tracking.

**Critique.** The partner economy is unpaid by design. A partner can win an RFP, deliver the work, mark it delivered, click invoice — and the system fabricates an ID and stops. There is no path from "work delivered" to "money received", which makes every upstream investment (storefront, quotes, engagements) economically pointless. The irony is that the hard part — Stripe Connect onboarding, payment intents, payouts — is already built one door over for wellbeing experts.

**Recommendation.** Adopt the wellbeing Stripe Connect rails for engagement invoicing, replacing the stub: quote amount → real invoice → payment intent → payout to the partner's connected account. Surface an **Earnings panel** on the Partner Desk (unpaid invoices, paid this month, lifetime). **Refer & Earn stays a separate program** — it works, and conflating referral payouts with service revenue would muddy both.

### 5) Onboarding (`partner_onboarding.ts` wizard; persona self-signup)

**What's there.** Two doors. The front door is the invite-token wizard in `partner_onboarding.ts` (`/:token` → profile → propose → select → finalize → e-sign), writing `partner_profiles` + `partner_deals`, managed via `PartnerDealPortal.jsx` — genuinely well-built, with expiry/revocation gating before any state mutation and idempotent finalize. The side door is persona onboarding, which maps every "Operator / Advisor" signup to the partner role (`personas.ts:178-181`) and then… nothing: no profile, no service listing, no categories — dumped on the LP portal.

**Critique.** The well-built flow is invite-only and deal-shaped (equity, MSAs, tiers). The self-serve flow assigns a role and abandons the user. There is no path where a service provider signs up, describes what they sell, and appears in the marketplace — which is the single most common partner journey the product should support.

**Recommendation.** Build the self-serve **"Offer services"** path: persona onboarding (partner alignment) flows into a first-run setup — profile + first offering + service categories — landing on the Partner Desk, not the LP portal. The invite-token deal wizard remains the door for equity/deal partners. Fix the "Operator / Advisor" → partner mislabel jointly with the advisor audit's ③ (the two personas are currently funneled into one role).

### 6) Leads & network (landing-page partner leads; Contacts hub)

**What's there.** The founder audit (③) established the lead taxonomy: landing-page signups are audience-typed (customer / investor / partner / advisor / mentor / cofounder) and dual-written into the Contacts hub — but the partner-audience branch dead-ends: partner leads land in `/network` with no destination surface and no next action.

**Critique.** A founder whose landing page attracts a would-be service partner has no way to convert that interest into a marketplace relationship, and a partner has no inbound channel at all. The taxonomy's plumbing exists; the partner branch just was never given a destination.

**Recommendation.** Complete the partner branch of the lead taxonomy: partner-audience signups get a real destination — an **intro queue on the Partner Desk** and/or a marketplace inquiry (which, post-consolidation, is a lightweight need). The Contacts hub gains a **"Promote to partner inquiry"** action, mirroring the promote paths that already exist for customers (Discovery) and investors (Raise Pipeline).

---

## The Partner Lifecycle module (on the Partner Desk)

Six stages, each mapped to what already exists:

| Stage | Partner's goal | Existing surfaces | Top action | System surfaces first |
|---|---|---|---|---|
| **Join** | Get set up to sell | persona onboarding + first-run setup (new) | Complete profile + first offering | setup completeness |
| **List** | Publish a storefront | My Services (fixed fields) | Publish 3 offerings | offering views |
| **Win** | Convert demand | Needs Board, quotes, AI Matches | Quote 2 open needs | matching needs, quotes pending |
| **Deliver** | Complete engagements | Engagements tab (new), office hours | Advance an engagement | active work, next milestones |
| **Get paid** | Invoice & collect | Stripe rails (new), invoice flow | Send invoice | unpaid invoices, earnings |
| **Grow** | Compound reputation & reach | Reviews, Demand Insights, Co-Marketing, Articles | Ask for a review; check heatmap | rating, demand trends |

**Mechanics**: the same rail / next-action components as the other three personas' lifecycle modules — this is the fourth consumer of a shared primitive, not a new pattern. Stages are derived at read time from `partner_profiles`, offerings, quotes, engagements, reviews, and Stripe account status — not stored, so always accurate. No new sidebar sections.

---

## What should be merged, removed, or relocated

| Action | What | Destination |
|---|---|---|
| Fix | `ServiceCatalogPage` ↔ `services.ts` field drift (`description`→`summary`, `partner_name`) | one reconciled contract |
| Fix | `service_offerings` double-CREATE schema conflict (`schema.sql:724` vs `t13_t14_t15.sql:377`) | reconciliation migration |
| Fix | `PartnerOfficeHoursPage` contract (same as advisor audit ①) | worker-out contract fix |
| Merge | `catalog.ts` providers/inquiries + `services.ts` engage-requests | `needs.ts` canonical economy |
| Surface | Engagements/quotes workspace | tab in the existing marketplace workspace |
| Replace | `stub-` invoicing (`needs.ts:431`) | Stripe Connect rails (wellbeing pattern) |
| Relocate | Service-partner default landing off "Partner / Investor Portal" | Partner Desk on `/studio` (role-conditional) |
| Render | `dashboard.ts` partner payload (computed, unrendered) | Partner Desk |
| Add | Self-serve offer-services onboarding | first-run setup after the persona flow |
| Wire | partner-audience landing leads (dead-end in `/network`) | intro queue / marketplace inquiry |
| Merge | partner office-hours engine into the advisors engine | one parameterized service (advisor audit ⑥) |
| Surface | partner slots for founders | `PublicPartnerProfilePage` + Network |

---

## Prioritized redesign roadmap

Effort: S = day-scale, M = multi-day, L = week+. Several items are shared with the advisor audit and are cheapest done together.

### Critical — make the economy real
1. **Marketplace contract + schema reconciliation** — fix the `ServiceCatalogPage` ↔ `services.ts` field drift; reconcile the `service_offerings` double-CREATE with an explicit migration. *(M)*
2. **Partner Desk landing** — role-conditional `/studio` composition for service partners; drop the LP-portal default from `ROLE_DEFAULT_PATH` for them; render the existing `dashboard.ts` partner payload. *(M/L)*
3. **Engagements workspace tab** — quotes sent / active work / history inside the existing marketplace workspace; the data is already served by `/quotes/me` + `/engagements`. *(M)*
4. **Office-hours contract fix** — same fix as advisor audit ①, same file-pair shape. *(S when done together with the advisor fix)*

### Important — finish the lifecycles
5. **Stripe invoicing replacing the stub** — adopt the wellbeing Connect rails end-to-end (invoice → payment intent → payout) + Earnings panel. *(L)*
6. **Marketplace system consolidation** — retire `catalog.ts` inquiries and `services.ts` engage-requests into the canonical `needs.ts` economy; `FounderMarketplacePage` reads the same backend. *(L)*
7. **Self-serve onboarding + persona fix** — "Offer services" first-run setup; fix the "Operator / Advisor" → partner funnel jointly with advisor audit ③. *(M)*
8. **Partner-lead destination + slot discovery** — intro queue for partner-audience leads; render partner slots on `PublicPartnerProfilePage` and in Network. *(M)*

### Nice to have
9. **Partner lifecycle rail** on the Desk — reuses the shared rail primitive. *(M)*
10. **Co-Marketing / Demand Insights cross-links** from the Desk. *(S)*
11. **Shared primitives** with the advisor surfaces (cards, filter bars — advisor audit ⑨). *(M)*
12. **Retitle "Partner / Investor Portal"** for its real audience (investor-type partners). *(S)*

---

## Verification appendix

Contract and behavior claims verified first-hand against the shipping code:

- `services.ts:19-46,78-95` (serializes `summary` / `owner_user_id`; POST reads `summary` at `:83`) vs `ServiceCatalogPage.jsx:74,137,307,357` (renders `description` / `partner_name`; form sends `description`).
- `schema.sql:724` vs `t13_t14_t15.sql:377` — two conflicting `CREATE TABLE IF NOT EXISTS service_offerings` definitions.
- `needs.ts:400-442` — engagement lifecycle transitions; stub invoice write at `:431` ("Stripe Connect not in worker port").
- `PartnerOfficeHoursPage.jsx:13-46` (sends `start_at` / `duration_min`) vs `partner_office_hours.ts:18,32,45,60` (requires `starts_at` / `ends_at`; bookings born `pending`).
- `App.jsx:219-232` — `ROLE_DEFAULT_PATH` sends partners to `/partner-portal`.
- `PartnerPortal.jsx:79-87` — LP-console tabs (Deals / Capital Calls / LP Investors / Portfolio).
- `partner_onboarding.ts:94-294` — token-gated wizard (profile → propose → select → finalize) writing `partner_profiles` + `partner_deals`.
- `personas.ts:178-181` — "Operator / Advisor" persona funnels into the partner role.
- `PartnerInsightsPage` API calls — real aggregation (demand feed, heatmap, newsletter subscribe).
- The unrendered `dashboard.ts` partner payload and the absence of any founder-facing partner-slot surface were established in the investor and advisor audits respectively.
