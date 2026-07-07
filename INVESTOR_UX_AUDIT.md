# Investor Experience — UX/UI Audit & Redesign Roadmap

**Scope**: the full investor panel at axal.vc — the Studio home, Sourcing (Deal Flow, Pipeline Board, AI Matches, Watchlist & Journal), Diligence (Scoring, Due Diligence, Market Intelligence, Risk Matrix), Commit (IC Decisions, Legal & Capital, Capital & Investment), Support (the 8 portfolio/fund pages), Account, onboarding, and the tier/quota system — reviewed as one connected product system.
**Constraints honored** (mirroring the founder audit): the top-level investor sidebar groups (Home / Sourcing / Diligence / Commit / Support / Account) are unchanged; the investment lifecycle is designed as a **module on the investor home**, not a new sidebar section; simplification is preferred over new pages.
**Method**: every claim verified against the shipping code (`frontend/src/`, `cloudflare-worker/src/routes/`, `cloudflare-worker/sql/`). File references included so each finding is actionable. Companion document: `FOUNDER_UX_AUDIT.md`.

---

## Executive summary

The investor panel has the opposite disease from the founder panel. The founder saw studio-operator tools wearing a founder costume; the investor sees **a seat at the studio's own console with the investor-shaped product left unplugged**. The parts of the codebase built specifically for investors — a scored proprietary deal-flow payload, quota meters, a 9-step thesis onboarding, syndication tools — are computed and then never rendered, while the pages the investor actually lands on are shared admin/partner surfaces with studio-grade write access. Six systemic problems:

1. **The investor home renders none of its investor data.** `/studio` (`Dashboard.jsx`) is byte-for-byte the founder page plus a trial banner. Meanwhile the dashboard API (`dashboard.ts`) assembles `proprietary_deal_flow` (scored, NDA-masked), `ai_scored_opportunities`, `quick_stats`, and `syndication_tools` for investors on every load — **and `Dashboard.jsx` reads none of them**. The quota meters (`InvestorQuotaBars`) are mounted only on `/partner-portal`, from which investors are redirected away (`App.jsx:1443`): an investor can never see their own intro/deal-room usage.

2. **There is no deal spine.** Nothing answers the investor's core questions: *which deals am I in, at what stage, and what's my next action?* Deal Flow is a firm-wide funnel of **all** deals (not "mine") whose only action is a stage-advance button; Pipeline Board is the studio's internal MVP kanban; AI Match cards are read-only dead ends (no pass / intro / add-to-watchlist); the Decision Journal's `next_check_at` follow-up field exists in the worker but is never surfaced. Four sourcing pages, zero next actions.

3. **The thesis is captured twice and used for neither.** Onboarding's 9 steps write `investor_profiles` (sectors, stages, geos, thesis, anti-thesis, value weights) — which feeds the *founder's* investor-match view, **not** the investor's own deal filtering. The Matches page has a second "Investor Preferences" modal writing a separate `user_preferences` table. The two stores overlap ~80% and are never synced. Worse, onboarding collects `accreditation_status`, `country`, `firm_name`, and LP intent and **silently drops them** (never passed to `saveInvestorProfile`).

4. **Role bleed in both directions.** Investors get studio-operator write powers they shouldn't want: dragging the studio's MVP pipeline, creating pipeline startups, triggering AI reviews, and deciding **Kill** gates (`pipeline.ts` `ADVANCE_ROLES` includes investor); a single unauthenticated-by-context "advance" button on every deal in Deal Flow. Meanwhile Due Diligence lives at an `/admin/*` URL in the investor nav. The investor is treated as staff, not as a customer with a funnel.

5. **The Support group is 8 pages where ~4 workspaces would do.** The LP holdings table renders identically in **Funds** and **Liquidity**; TVPI/DPI is computed live in Funds and hand-authored in LP Reporting; capital calls appear in Funds *and* Capital; **Reserve Allocation and Exit Waterfall are two pages over the same simulator engine, the same fund selector, and the same `fund_scenarios` table, with StatCard/SliderInput components duplicated verbatim**; the exit lifecycle is split across three destinations (model in Waterfall, execute in Liquidity, distribute in Funds).

6. **Quality erosion at the edges.** Watchlist/Journal frontend fields (`source`, `tags`, `external_*`, statuses `passed_on/archived`, outcomes `hit/miss/partial`) don't match the worker's persisted schema (`watching|passed|converted`, `win|loss|pending`) — silent data loss; the Account group is an 11-item bucket where **Advisors** (a mentee-facing booking directory) and **Jobs** (a job board) have no investor purpose; deal/score cards are re-implemented ~5 times with different status pills and color maps.

**The fix is not more pages.** It is one deal-centric lifecycle spine on the investor home, one preference store, sourcing pages that act on deals instead of describing them, a Support group consolidated around Portfolio / Fund Ops / Modeling / Liquidity, and a clean split between "investor as customer" and "studio operator" permissions.

---

## Section-by-section audit

### 1) Home — `/studio` (`frontend/src/pages/Dashboard.jsx`)

**What's there.** The same component all five roles get: welcome header, semantic search, notification bell, "Refresh Scores", PersonalAdvisor, ProfileFitSection, and two conditional operator cards. Investor-specific rendering is exactly one component: `InvestorTrialBanner` (trial countdown → `/pricing/investor`). `RoleBadge` doesn't even have an investor style (falls through to gray).

**Critique.** The dashboard API already does the hard work — `dashboard.ts` builds a scored, NDA-masked `proprietary_deal_flow`, `ai_scored_opportunities`, `quick_stats` (earnings, syndicates, avg AI score), and `syndication_tools` for investors — and the page throws it all away. This is the single highest-leverage gap in the panel: the investor-shaped home exists in the API and just needs a front end. Separately, `InvestorQuotaBars` (intro + deal-room usage meters) renders only for investors but is mounted only on `PartnerPortal`, which redirects investors to `/studio` — dead UI.

**Recommendation** — make `/studio` the investor's **deal desk** (role-conditional composition inside the existing page, no new route):
- **Deal Lifecycle module** (spec below): my deals by stage + next best action.
- **Scored opportunities strip**: render the already-computed `proprietary_deal_flow` / `ai_scored_opportunities` as actionable cards (open deal room, add to watchlist, request intro).
- **Quota + plan card**: mount `InvestorQuotaBars` here (it was built for this); one glance = intros left, deal rooms used, plan, upgrade path.
- Keep PersonalAdvisor and search; drop ProfileFitSection for investors (skills/values radar is a founder/talent concept).

### 2) Onboarding & preferences

**What's there.** A genuinely good 9-step wizard (`OnboardingInvestorPage.jsx`): investor type, accreditation, check size, stages, sectors, geos, thesis paragraph, anti-thesis exclusions, value-weight sliders, LP intent. Saved via `PUT /api/investor-profile/me` → `investor_profiles`.

**Critique.** Three defects: (a) `accreditation_status`, `country`, `firm_name`, `lp_intent`, `lp_target_usd` are collected and **never persisted** (not passed to `saveInvestorProfile`); (b) the profile powers the *founder-side* matcher (`matches.ts POST /investor-match`) but **not the investor's own deal flow** — that reads a second store, `user_preferences`, edited in the Matches "Investor Preferences" modal; (c) nothing after onboarding ever shows the investor their own thesis or lets them edit it (the wizard is one-shot).

**Recommendation.**
- **One preference store.** Make `investor_profiles` canonical; the Matches preferences modal reads/writes it; migrate `user_preferences` investor rows once and retire that path. Every scored surface (Deal Flow, Matches, dashboard strip) filters by the same thesis.
- Persist the dropped fields (accreditation/firm/LP intent — LP intent should pre-fill the Funds LP portal).
- Add a compact **"My thesis" card** in Settings (or the Matches header) so the thesis is visible and editable after day one.

### 3) Sourcing — Deal Flow, Pipeline Board, AI Matches, Watchlist & Journal

**What's there.**
- **Deal Flow** (`DealsPage.jsx`, 234 lines): firm-wide funnel (`applied → scored → funded`) over the `deals` table; per-row trust/risk badges and an NDA-gated founder reveal; the only action is a stage-**advance** button (any investor can advance any deal); no pass, no intro request, no score shown, not scoped to "my" deals. Professional-tier gated.
- **Pipeline Board** (`PipelinePage.jsx`, 743 lines): the **studio's** MVP-development kanban over `projects` (Idea → MVP Dev → Traction Review → Decision Gate → Spin-Out Ready → Iterate) — a different stage taxonomy from Deal Flow. Investors have full write access: drag cards, create startups, add tasks, trigger AI review, decide Spin-Out/Iterate/**Kill** gates.
- **AI Matches** (`MatchesPage.jsx`, 481 lines): three investor tabs (Deal Flow / Co-Investment / Referral Quality) of scored, LLM-explained cards — **all read-only**; the only mutation is the preferences modal.
- **Watchlist & Journal** (`WatchlistJournalPage.jsx`, 749 lines): the best-designed investor surface — watchlist (internal + external targets, conviction, convert/pass), decision journal (thesis-before-vote, expected vs actual multiple, record-outcome), and an **Anti-Portfolio** tab (vindicated/regret analysis). But the frontend writes fields the worker never persists (`source`, `tags`, `external_*`, sector/stage) and uses enums the worker doesn't have (`defer`, `hit/miss/partial` vs `follow`, `win/loss/pending`); `next_check_at` exists in the route but has no UI and no reminder.

**Critique.** Four pages, four data models, ~5 different deal-card implementations, and **no concept of "my deals"** anywhere. The funnel language ("Deal Flow Pipeline", "Pipeline Board") describes the *studio's* funnels, not the investor's. Matches generate interest and then strand it — a scored match card with no action is a brochure.

**Recommendation.**
- **Make matches actionable**: every scored card (Matches, dashboard strip) gets three verbs — *Add to watchlist*, *Request intro* (consumes the intro quota, finally connecting the quota system to a user-visible loop), *Open/join deal room*. Watchlist becomes the investor's inbox for interest.
- **Scope Deal Flow to the investor**: default filter "My deals" (deals where the investor is in the deal room / has an intro / has committed), with the firm-wide view as a secondary toggle. Replace the naked advance button with per-deal actions appropriate to the viewer's relationship (view room, pass with reason → auto-journal entry, advance only for deals they own).
- **Pipeline Board off the investor nav's mental model**: keep the route for genuinely operator-investors, but strip investor write access to the studio's gates (`ADVANCE_ROLES`: remove investor, or gate behind an explicit operator flag). An investor deciding "Kill" on a studio startup is a permissions bug wearing a feature costume.
- **Fix the Watchlist/Journal contract**: align worker enums/fields with the UI (persist `source`, `tags`, external target fields; support `defer`, partial outcomes), surface `next_check_at` as a visible "next check" date + notification — this is the cheapest path to the "next action" concept the whole panel is missing.

### 4) Diligence — Scoring Engine, Due Diligence, Market Intelligence, Risk Matrix

*(Section pending final exploration pass — findings and recommendations slot in here.)*

### 5) Commit — IC Decisions, Legal & Capital, Capital & Investment

*(Section pending final exploration pass — findings and recommendations slot in here.)*

### 6) Support — the portfolio & fund-ops eight

**What's there.** Eight pages: **Portfolio Health** (computed daily score per company: runway/growth/churn/sentiment; rich), **Company Updates** (founder-submitted KPI+narrative reports, investor read-only; thin), **Cap Table** (`portfolio_positions` — the investor's recorded rounds per company + Carta holder snapshot; thin), **Funds** (`vc_funds`/`limited_partners`: admin fund-ops + a genuinely good LP portal view with TVPI/DPI charts, capital calls, LPA signing; 597 lines), **LP Reporting** (GP-authored quarterly statements; thin), **Reserve Allocation** + **Exit Waterfall** (two views of the same `fund_simulator.ts` engine and `fund_scenarios` table, with duplicated components), **Liquidity & Exits** (secondary listings, AI valuation/matching, exit pipeline; "Mock real settlement" placeholder on proceeds).

**Critique.** The information is good; the packaging triples it. An LP asks "what am I in, what's it worth, what's been called, what came back?" — today that's **Funds** (holdings + calls + distributions), **Cap Table** (positions), **Portfolio Health** (a separate CSV-imported holdings card), **LP Reporting** (the same TVPI/DPI hand-written), and **Liquidity** (the same holdings table again). A GP asks "how do I model the fund?" — that's two nearly identical simulator pages. Exit is three places.

**Recommendation** — same eight destinations' content, four coherent workspaces (sidebar rows can stay and deep-link to tabs, mirroring the founder-audit pattern):
- **Portfolio** = Health + Company Updates + Positions as tabs of one company-centric workspace (select company → health drawer, updates, my position — today three pages).
- **Fund Ops** = Funds (admin view) + LP Reporting authoring + capital calls (single home for calls — remove the duplicate in `/capital`).
- **My LP Portal** = the Funds LP view + published LP reports + my capital calls; one canonical holdings table (kill the copies in Liquidity and Portfolio Health; the CSV-import card merges into positions).
- **Fund Modeling** = Reserve Allocation + Exit Waterfall as tabs sharing the fund selector, StatCard/SliderInput primitives, and the scenarios panel (they already share everything else).
- Liquidity keeps secondary-market execution but reads holdings from the canonical source; label the mock settlement as simulation until real.

### 7) Account group, tiers & quotas

**What's there.** Eleven items. Genuinely account-ish: Trust & Identity, Settings, Activity, Docs, Support. Cross-persona carryovers with no investor behavior: **Advisors** (mentee-facing booking directory), **Jobs** (job board), Articles, Partners; Calendar/Events are generic. Tiers (free/professional/institutional) are well-built in the worker (`requireInvestorTier.ts`: quotas 3/25/100 intros, 1/5/unlimited deal rooms, 402s with checkout paths; seat management in `investor_seats.ts`) and well-priced on `/pricing/investor` — but the *experience* of the tier system is only lock icons and paywalls: quotas are invisible (unreachable component), and nothing shows consumption or value received.

**Recommendation.**
- Trim the Account group to account things (Trust & Identity, Calendar, Events, Activity, Docs, Support, Settings); drop Advisors/Jobs/Articles/Partners from the investor nav (routes stay live).
- Surface the quota card on the home (see §1); pair every 402 with the same card so the upgrade ask always shows current usage.
- Locked Sourcing items (Deal Flow, Pipeline Board on free) should preview like the founder-audit pattern — blurred deal cards behind the paywall convert better than a lock icon.

---

## The Deal Lifecycle module (on the investor home)

Six investor-facing stages, mapped to what already exists:

| Stage | Investor's goal | Existing surfaces | Top action | System surfaces first |
|---|---|---|---|---|
| **Source** | Fill the funnel with thesis-fit deals | AI Matches, dashboard deal strip, Watchlist | Add 3 matches to watchlist | New scored matches vs thesis |
| **Screen** | Decide what deserves work | Deal Flow ("my deals"), Watchlist, Scoring | Pass or open deal room | Score, trust/risk badges, conviction |
| **Diligence** | Verify before committing | Due Diligence cases, Market Intelligence, Risk Matrix, reference checks | Open/complete a DD case | Open checklist items, doc requests |
| **Commit** | Decide and paper it | IC Decisions, Legal & Capital, journal ("thesis before the vote") | Record IC decision + journal entry | Pending IC votes, unsigned docs |
| **Support** | Track and help the position | Portfolio (health/updates/positions), Funds/LP portal | Read latest company update | Health alerts, new updates, calls due |
| **Exit** | Realize returns | Exit Waterfall (model), Liquidity (execute), Funds (distribute) | Model or list a position | Open listings, distributions, outcomes vs journal |

**Mechanics** (validated against the code):
- The spine is the **deal relationship**, not a new stage column: derive "my deals" from existing tables — `investor_dealroom_members` (rooms joined), `investor_introductions` (intros), `watchlist`/`journal_entries` (interest + decisions), `dd_cases`, `ic_decisions`, `portfolio_positions` (committed), `secondary_listings` (exiting). A single worker aggregation route (e.g. `GET /api/dashboard/investor-lifecycle` beside the existing unused payload in `dashboard.ts`) returns deals bucketed by stage + one next action each.
- **Next actions come from data that already exists**: journal `next_check_at` (surface it), open DD checklist items, pending IC votes, capital calls due, unread company updates. No new task system.
- **UI**: compact horizontal stage rail (counts per stage) + "Next best action" list (3–5 items, each a deep link) + the scored-opportunities strip. No wizard, no new sidebar entry — this is the investor twin of the founder audit's Startup Lifecycle module, reusing its rail/checklist components.

---

## What should be merged, removed, or relocated

| Action | What | Destination |
|---|---|---|
| Render | Dead dashboard investor payload (`proprietary_deal_flow`, `quick_stats`, `syndication_tools`) | Investor home deal desk |
| Relocate | `InvestorQuotaBars` | Investor home (from unreachable PartnerPortal) |
| Merge | `user_preferences` (Matches modal) | `investor_profiles` (one thesis store) |
| Merge | Reserve Allocation + Exit Waterfall | One Fund Modeling workspace (tabs) |
| Merge | Health + Company Updates + Positions | One Portfolio workspace (tabs) |
| Merge | Duplicate LP holdings tables (Liquidity, Portfolio Health card) | Canonical holdings in LP portal/Positions |
| Merge | Capital calls in `/capital` + Funds | One capital-calls home (Fund Ops) |
| Remove (investor scope) | Pipeline Board write access (gates, Kill, create) | Operator roles only |
| Remove (investor nav) | Advisors, Jobs, Articles, Partners | Routes stay live for other roles |
| Relocate | Due Diligence off `/admin/*` framing | Investor-facing diligence home (see §4) |
| Fix | Watchlist/Journal field & enum mismatches | Worker schema aligned with UI |
| Rename | "Deal Flow Pipeline" vs "Pipeline Board" collision | Deal Flow = my funnel; Pipeline = studio ops |

## Recommended investor information architecture (sidebar unchanged)

```
Studio       deal desk: LIFECYCLE RAIL + next actions + scored matches strip + quota card
Sourcing
  Deal Flow        "My deals" default view · firm-wide toggle · per-deal actions
  Pipeline Board   read-only studio context for investors (write = operators)
  AI Matches       actionable cards (watchlist / intro / deal room), one preference store
  Watchlist & Journal  unchanged concept + fixed persistence + next-check reminders
Diligence    (see §4 — pending)
Commit       (see §5 — pending)
Support
  Portfolio        Health · Updates · Positions (tabs)
  Fund Ops         Funds admin · LP Reporting · Capital calls
  My LP Portal     holdings · reports · calls (canonical tables)
  Fund Modeling    Reserves · Waterfall (shared engine, shared scenarios)
  Liquidity        secondary market (reads canonical holdings)
Account      Trust & Identity · Calendar · Events · Activity · Docs · Support · Settings
```

## Prioritized redesign roadmap

*(Finalized after §4–5 land; drafted priorities below.)*

### Critical
1. **Investor deal desk on `/studio`** — render the existing dashboard payload, mount the quota bars, add the lifecycle rail + next actions aggregation route.
2. **One preference store** — canonicalize `investor_profiles`, migrate `user_preferences`, persist the dropped onboarding fields.
3. **Actionable matches + investor-scoped Deal Flow** — watchlist/intro/deal-room verbs on cards; "My deals" default; per-relationship actions replacing the naked advance button.
4. **Permissions split** — remove investor from `ADVANCE_ROLES`/gate decisions on the studio pipeline.

### Important
5. **Support consolidation** — Fund Modeling merge (cheapest, same engine), then Portfolio workspace, then canonical holdings/capital-calls.
6. **Watchlist/Journal contract fix + next-check reminders.**
7. **Diligence & Commit flow** (pending §4–5 findings).

### Nice to have
8. Account-group trim; locked-tab previews; investor RoleBadge style; shared DealCard/ScorePill primitive replacing the ~5 copies.
