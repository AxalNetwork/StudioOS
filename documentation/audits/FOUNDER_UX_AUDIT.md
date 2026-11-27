# Founder Experience — UX/UI Audit & Redesign Roadmap

**Scope**: the full founder panel at axal.vc — Studio, Command Center, Team, Metrics, Brand & Landing, Customer Discovery, Advisory, Capital, Legal Engine — reviewed as one connected product system.
**Constraints honored**: the top-level sidebar sections (Studio / Build / Validate / Raise / Launch) are unchanged; the Idea→Startup lifecycle is designed **only as a module inside Command Center**; no new sidebar sections or top-level pages are proposed.
**Method**: every claim below was verified against the shipping code (`frontend/src/`, `cloudflare-worker/src/routes/`, `cloudflare-worker/sql/`). File references are included so each finding is actionable.

---

## Executive summary

StudioOS has strong bones — a real lead-capture pipeline, a genuine conversational AI advisor, a 33-template legal engine, and working booking/matching/jobs marketplaces — but the founder experience is assembled from studio-operator parts and nav-level merges, so founders see an admin console wearing a founder costume. Five systemic problems drive nearly all of the overload:

1. **Two "homes", and neither is a command center.** `/studio` (the landing page, `Dashboard.jsx`) greets the founder with "your venture studio at a glance" but shows no venture state. The page *named* Command Center (`/build/command-center`) is a 4-tab wrapper around internal studio tooling — Founder Portal intake, Execution, Studio Ops, Spin-Outs — written in operator language ("scored against the studio rubric", "Decision Gate", AI verdicts including "kill").

2. **The lifecycle exists in the database but not in the UI.** `projects.stage/status/playbook_week`, onboarding's "Where are you in your journey?" (Idea / Prototype / MVP / Revenue / Scaling), and traction signals all exist — but the stage fields are privileged (admin/partner-editable only, `projects.ts:569`) and no surface answers the founder's two core questions: *where am I?* and *what should I do next?*

3. **Duplicate concepts everywhere.** Two advisor systems that don't share tables (the bookable office-hours marketplace in Team vs. a private CRM directory in Advisory Suite); two customer-discovery pages (the in-nav one has no leads; the one with the lead CRM is off-nav); two lead stores written on every signup; three legal surfaces; and a fake "AI Advisor" tab (hardcoded templates — `advisory.ts:76` always returns `ai_generated: false`) while the real conversational AI (`routes/advisor.ts`, 2,400+ lines) appears only on the Dashboard.

4. **Half-built lifecycles.** Landing-page signups are already audience-typed (customer / investor / partner / advisor / mentor / cofounder) and auto-routed into a Contacts hub — but co-founder and partner leads dead-end with no destination; the Raise Pipeline has no way to add an investor directly; the Legal Engine's status pills are hardcoded placeholders and its jurisdiction picker is decorative (`LegalEnginePage.jsx:30-39`, marked TODO).

5. **Consolidation ≠ simplification.** The `?tab=` shells reduced sidebar rows but preserved every embedded page's internal sub-structure, producing 3-level nesting (Command Center → Studio Ops → Strategic Oversight; Team → Co-Founder → browse/connections/profile), an Execution tab that stacks three whole pages in one scroll, and three different empty-state, filter-bar, and accent-color treatments inside a single "workspace".

**The fix is not more pages.** It is one lifecycle spine in Command Center, one lead lifecycle from Brand & Landing into typed destinations, one advisor model, one discovery workspace, and a founder-language naming pass.

---

## Section-by-section audit

### 1) Studio — the starting point (`/studio` → `frontend/src/pages/Dashboard.jsx`)

**What's there.** Welcome header, semantic search, notification bell, a "Refresh Scores" button, `PersonalAdvisor` (the real AI), `ProfileFitSection`, and two conditional cards (operator tasks, independent subsidiaries) most founders never see. The onboarding checklist panel was deliberately removed (2026-05-22, comment at `Dashboard.jsx:12-15`). No venture state, no metrics, no next actions.

**Critique.** Pleasant but inert. It tells the founder nothing about their company and points nowhere. The one differentiating asset — the conversational Personal Advisor — is well placed; everything else is chrome. "Refresh Scores" is operator language acting on data the founder can't see from here.

**Recommendation** (Studio remains the early-founder starting point; the lifecycle itself lives in Command Center):
- Studio = *you + your direction*. PersonalAdvisor stays primary. Add one compact **venture card**: startup name, lifecycle-stage chip, and a single next-best action that deep-links into Command Center's lifecycle module. A founder with no venture yet sees "Shape your first venture" → the Command Center intake flow.
- Remove "Refresh Scores" from the founder view (it belongs with the venture snapshot in Command Center).
- Do **not** rebuild the removed checklist here. The checklist belongs to the lifecycle module; Studio links to it. One progression, one home.

### 2) Command Center (`/build/command-center` → `CommandCenterPage.jsx`)

**What's there.** A tab shell over four legacy pages: **Founder Portal** (`FounderPortal.jsx` — 3-step intake wizard with auto-scoring), **Execution** (`ExecutionPage.jsx` — Startups + Pipeline Board + Roadmap stacked vertically in one scroll), **Studio Ops** (`StudioOpsPage.jsx` — ops kanban plus a "Strategic Oversight" sub-tab whose AI verdicts include *continue / iterate / spin-out / kill*), and **Spin-Outs** (`SpinOutsPage.jsx` — a read-only status-filtered grid).

**Critique.** This is the studio's internal ops console shown to founders. The labels are supply-side ("Founder Portal", "Studio Ops", "Spin-Outs"); the Execution tab is an anti-pattern (three pages of scroll, no local nav); depth reaches three levels; and nothing anywhere says where the venture stands or what to do next. It is a dashboard of *tools*, not a command center of *state*. "Kill" is not a word a product should show a founder about their own company.

**Recommendation** — restructure to four founder-language tabs, lifecycle first:

- **Overview** (new, default): the **Startup Lifecycle module** (spec below), a venture snapshot card (status, score, playbook week — the data behind "Refresh Scores"), and a read-only 4-tile metrics strip (MRR, active users, runway, traction) sourced from the latest `metrics_snapshots` + signals, linking to `/build/metrics`.
- **Startups** (rename of Execution's ProjectsPage; the Pipeline Board becomes a *view toggle* here, not a second stacked page).
- **Roadmap** (`RoadmapPage` promoted out of the stack).
- **Operations** (Studio Ops renamed; "Strategic Oversight" verdicts reframed as a "Focus recommendation").
- **Founder Portal stops being a tab.** Intake is an event, not a place you revisit — it becomes the "New startup" action launched from Overview/Startups.
- **Spin-Outs folds into Startups** as a status filter (it already is one: `status ∈ {spinout, spinout_ready, incorporated, active}`).

### The Startup Lifecycle module (inside Command Center → Overview only)

Six founder-facing stages, each mapped to what already exists:

| Stage | Founder's goal | Most relevant existing pages | Top action | System surfaces first |
|---|---|---|---|---|
| **Idea** | Shape and capture the concept | Studio (PersonalAdvisor), Command Center intake | Create + score the startup | Intake status, concept summary |
| **Validate** | Prove someone wants it | Customer Discovery, Brand & Landing, Signals | Publish a landing page; log 5 interviews | Waitlist count, interviews logged, validated hypotheses |
| **Build** | Ship the MVP with the right people | Team (co-founder, advisors, hiring), Roadmap, Metrics | Set the 90-day roadmap; fill the key role | OKR progress, open team gaps |
| **Launch** | Get to market | Brand & Landing, Events, Co-Marketing, Articles | Launch page + first campaign | Pageviews/signups, launch checklist |
| **Grow** | Find repeatable traction | Metrics, Customer Discovery (segments), Marketplace | Connect Stripe / log weekly metrics | MRR and active-user trend |
| **Raise** | Fund the next stage | Pitch, Capital (pipeline / cap table / model), Legal Engine | Add 10 investors to the pipeline | Pipeline by stage, round status, document readiness |

**Mechanics** (validated against the code):

- New founder-editable **`projects.lifecycle_stage`** column (D1 migration `139_lifecycle_stage.sql`; verified no such column exists today). Deliberately separate from the privileged `stage / status / playbook_week` trio (`projects.ts:569`), which remain the studio's internal pipeline — no permission changes there. Default derived once from `company_profiles.stage` (Idea/Prototype → idea, MVP → build, Revenue → grow, Scaling → raise).
- Worker route first (per `CLAUDE.md`): `GET/PUT /api/progress/lifecycle/:projectId` in `progress.ts`, which already has `loadProject` / `ensureCanView` / `ensureCanEdit` per-project auth and already aggregates the needed signals. `GET` returns `{ stage, suggestions, checklist }` where checklist completion is **derived at read time** from real data — landing published (`landing_pages.published`), interviews ≥ 5 (`discovery_interviews`), MRR > 0 (latest `metrics_snapshots`), active raise prospects (`raise_prospects`) — not stored, so it is always accurate and needs no new checklist table. Only non-derivable items ("talked to 3 potential co-founders") are manual check-offs in a small JSON column.
- **Advancement is suggested, never automatic.** When derived signals satisfy the next stage, a suggestion chip appears ("Looks like you're validating — move to Validate?"); the founder confirms via `PUT`.
- **UI**: a compact horizontal 6-segment stage rail (clickable) + one "Next best action" card + a collapsed checklist (3–5 items per stage, each a deep link into an existing page). No wizard, no new sidebar entry, no full-screen takeover.
- Matching `api.js` methods are required — `npm run test:drift` enforces route parity.

### 3) Team (`/build/team` → `TeamBuildingPage.jsx`)

**What's there.** A tab shell: **Advisor** (growth-gated → `AdvisorsPage`, a bookable office-hours marketplace), **Co-Founder** (studio-gated → `CofounderPage`, which hides its own second level of tabs: browse / connections / profile, plus a profile gate before browsing), **Jobs** (ungated → `MyJobsPage`).

**Critique.** The shell is fine; the contents diverge. Three filter-bar implementations, two card-grid stacks, different accent colors (violet vs. blue), three empty-state treatments. The worst UX bug is the default-tab logic: because Advisor and Co-Founder are tier-locked, **a free founder lands on Jobs** — the least strategic feature becomes the default face of "Team". Label mismatch: the sidebar says "Team", the H1 says "Team Building". Click depth: booking an advisor is 4 clicks (fine); a first-time co-founder search is 5+ because the profile gate blocks even *seeing* the browse grid.

**Recommendation.**
- One workspace, three tabs — **Advisors / Co-Founder / Hiring** — on shared `FilterBar` + `PersonCard` primitives, one accent color.
- **Locked tabs show a preview** (blurred/sample cards + upgrade CTA) and **Advisors is always the default tab.** A paywall you can see into converts better than a dump onto Jobs.
- Co-Founder: kill the inner tabs. One view — the browse grid — with "My profile" as a right-hand side panel and "Connections" as a section that appears above the grid when non-empty. Let founders browse anonymized cards *before* the profile gate; gate the "I'm interested" action instead.
- Add a **Leads strip**: cofounder-audience signups from landing pages surface here (closing today's dead end — see the lead lifecycle below).
- Rename the H1 to "Team".

### 4) Metrics (`/build/metrics` → `MetricsPage.jsx`)

**What's there.** Startup picker, Stripe import, manual snapshots; four stat tiles (MRR, active users, LTV/CAC, traction score); two trend charts; snapshot history; a traction-signals card that feeds the scoring engine.

**Critique.** One of the cleanest pages in the app. The problem is placement and visibility, not design: nothing on Studio or Command Center reflects it, so metrics are out of sight and out of mind, and the traction score that drives the studio's scoring engine is buried at the bottom of a page nobody is routed to.

**Recommendation — keep it standalone.** Data entry, history, and charts need room; folding the full page into Command Center would recreate the Execution-stack anti-pattern. Instead, surface a **read-only 4-tile strip in Command Center → Overview** with a "View metrics →" link. One source of truth, one summary view. This is the simplest and most useful placement.

### 5) Brand & Landing (`/build/brand` → `BrandBuilderPage.jsx`)

**What's there.** A genuinely good audience-first 4-step wizard (startup & audience → template → brand & content → share), 16 catalog templates + 21 visual styles, AI assists for logo/palette/copy. But: **one landing page per project** (`landing_pages.project_id UNIQUE`, `brand.ts:36`); slugs are **`{name}-{random 6 chars}`** (`brand.ts:76`) — `northwind-labs-x7k2p9`, generated once, never editable; no way to save a configured page as a reusable template; the in-page signups viewer shows only the last 25 with no export.

What already works well and must be preserved: every signup is audience-typed and **dual-written** to `waitlist_signups` and the Contacts hub (`ingestContact`, `contacts.ts:149`) with `source` and `landing_page_id` retained — the attribution spine already exists.

**Recommendation.**
- **Projects → pages → templates.** Drop the UNIQUE constraint (migration). Add a "Pages" list per project (audience, status, signups per page). "Save as template" writes a founder-owned template into a new custom-templates store, selectable in step 2 alongside the catalog. This is the create → save → reuse loop the product is missing.
- **Branded URLs**: `axal.vc/p/{startup-slug}/{page-slug}`. The startup slug is claimed once per project (availability check; editable with a redirect from the old slug), and the page slug defaults from the template/audience ("investors", "waitlist", "beta"). The URL now carries the startup's identity and the page's purpose. Legacy `/landing/:slug` URLs 301-redirect forever.
- **Complete the lead taxonomy** (see lifecycle model below): cofounder → Team leads strip; partner → Marketplace/Network intro queue; mentor → the advisor pipeline. `routed_to` already exists on contacts — extend `routeFor()` and render the destinations.
- Show **source** (which page, which template) on every lead row in every destination, and add CSV export to the Contacts hub.

### 6) Customer Discovery (`/build/discovery` → `DiscoveryPage.jsx`)

**What's there.** The in-nav page is a strong Mom-Test interview log (interviews, hypotheses with validated/invalidated status, 0–5 solution-fit ratings, pain themes, traction signals) — and nothing else. The actual lead lifecycle — the waitlist CRM with statuses New → Invited → Followed up → Promoted and invite / follow-up / promote actions — lives on an **off-nav page** (`/customer-discovery` → `CustomerDiscoveryPage.jsx`, reachable only from Spin-Out Lab links or by knowing the URL) and partially inside `/network?tab=contacts`.

**Critique.** The flagship Validate page cannot receive the leads the flagship Build page (Brand & Landing) generates. Founders manage the discovery journey by URL knowledge. Two interview forms, two stores, two promote endpoints — one journey.

**Recommendation** — one workspace, three tabs:
- **Leads**: contacts with `audience=customer` + the waitlist view — status, source (landing page/template), segment, next action; actions: invite to interview, log interview, send follow-up, promote into the interview log. This is where template signups land automatically.
- **Interviews**: the existing Mom-Test log, unchanged — it's good.
- **Insights**: pain themes + traction signals (today buried at the bottom).
- Retire `/customer-discovery` behind a redirect; converge on the contacts promote endpoint (`POST /api/contacts/:uid/promote`) as the single lead→interview flow.

### 7) Advisory Suite (`/advisory` → `AdvisoryPage.jsx`)

**What's there.** Four tabs: **AI Advisor** (hardcoded template responses — `advisory.ts` always returns `ai_generated: false`), **Financial Planner** (deterministic calculator), **Diligence Checker** (deterministic checks), **Advisors** (a founder-owned CRM directory, `advisor_profiles`, fed by "From your waitlist" promotions). Meanwhile the *bookable* advisor marketplace (`advisors` / `advisor_bookings` / reviews) lives in Team, and the *real* conversational AI (`PersonalAdvisor`, `routes/advisor.ts`) appears only on the Dashboard.

**Critique.** Labeled a suite, leads with a fake. AI dominates the layout three tabs to one, and the AI shown isn't AI — while the genuine article exists elsewhere in the codebase. The human experience — finding, evaluating, and building relationships with advisors — is split across two systems that don't share data, with the relationship-management half buried as the fourth tab.

**Recommendation** — human-first inversion:
- Tab order: **My Advisors** (the CRM directory + waitlist promotions — first), **Find Advisors** (the Team booking marketplace: one mental model — *find & book* in Team, *manage the relationship* here, with a promote path Booking → My Advisors after a completed session), **Tools** (Financial Planner + Diligence Checker, honestly labeled as calculators), **Ask AI** (the real PersonalAdvisor conversation, replacing the template stub).
- Trust and conversation quality: advisor cards gain "last session", notes, and next follow-up (reuse `contact_tasks`); session reviews already exist on the booking side — surface them in My Advisors.

### 8) Capital (`/raise/capital` → `CapitalWorkspacePage.jsx`)

**What's there.** Three tabs: **Financial Model** (`FinancialsPage`), **Cap Table** (`CapTablePage` — solid SAFE/priced-round/dilution/waterfall modeling), **Raise Pipeline** (`RaisePipelinePage` — a flat card list over `raise_prospects` with six stages: to_contact → contacted → meeting → diligence → committed → passed).

**Critique.** The modeling tabs are good. The Raise Pipeline is a stub wearing a CRM's name: **no way to add an investor directly** (prospects arrive only via the Contacts hub's Promote — a path founders won't discover), no next actions on prospects (tasks live on the contact object, invisible here), no round context (target / committed / close date), no offers, no investor-updates loop. Note: `/capital` ("Capital & Investment Ops", capital calls, LP management) is the *fund's* console and correctly hidden from founders — but the founder side lacks its own equivalents.

**Recommendation** (smallest coherent v1):
- A **Round header card** above the pipeline: round name, target, committed (sum over committed-stage prospects or explicit amounts), stage, target close.
- **Add-investor form** + CSV import on the pipeline; **kanban-by-stage** as the default view (the six existing stages are right).
- A **per-prospect drawer** that links prospect ↔ contact so the already-built follow-ups, replies, and tasks appear in place; add "amount" and "next step + date" fields to prospects.
- **Investor updates**: a lightweight composer (subject / body / send log) — v1 can be a log without new email infrastructure.
- Capital calls remain fund-side; founders don't issue capital calls at this stage — explicitly out of scope.

### 9) Legal Engine (`/raise/legal-engine` → `LegalEnginePage.jsx`)

**What's there.** Three parallel legal surfaces: this founder hub (four cards — Incorporation / Founders & Agreements / Compliance / 83(b) — with **hardcoded placeholder status pills** and a **decorative jurisdiction dropdown**, both marked TODO); `/legal` (`LegalPage`, a VC-firm template library organized by GP / Fund / Portfolio / Compliance layers, accessible to founders but framed for fund managers); and `/legal-capital` (spin-out tooling). The underlying engine is real: ~33 merge-field templates in D1 (`migration 085`), a genuine 5-jurisdiction catalog with costs/timelines/tax metadata (`legal.ts:69`, used only by the Incorporate wizard), entities, filings, and a compliance calendar.

**Critique.** The engine is organized by *the studio's* org chart, not the founder's needs, and the founder-facing hub is a façade over it. Founder-essential documents are missing entirely: **NDA, ESOP agreement, IP assignment, offer letters, employment contracts, HR policies, privacy policy, trademark/IP kit**.

**Recommendation.**
- Make `/raise/legal-engine` THE founder legal home: a **jurisdiction-aware document checklist** grouped by the company's lifecycle, not by layer:
  1. **Formation** — incorporation docs, bylaws/constitution per jurisdiction, EIN/filing kits
  2. **Founders & Equity** — founder/co-founder agreement, restricted stock, 83(b), co-founder exit clause, ESOP*
  3. **Team & Employment** — offer letter*, employment contract*, HR policies*
  4. **IP & Confidentiality** — NDA*, IP assignment*, trademark kit*
  5. **Fundraising** — SAFE, term sheet, shareholders'/investors'-rights agreement, subscription docs; pitch deck and financial model appear as *links to their own tools*, not duplicated documents
  6. **Policies & Compliance** — terms of service, privacy policy*, compliance calendar
  (* = new template seeds, one migration.)
- **Wire the jurisdiction select** to the existing `GET /api/legal/jurisdictions`, persist the choice per company, and let it drive which checklist variants, document names, and compliance assumptions show — the catalog already carries the per-country metadata.
- **Make the status pills real**: derive them from `documents`, incorporation orders, and compliance events (all queryable today). Each checklist row: status → Generate / Upload / View → e-sign hook where available. A legal *engine and checklist*, not a file list.
- Scope `/legal` (the VC 4-layer library) away from the founder role; it remains for admin/fund users.

---

## What should be merged, removed, or relocated

| Action | What | Destination |
|---|---|---|
| Merge | `/customer-discovery` (off-nav) | `/build/discovery` → Leads tab (redirect) |
| Merge | Spin-Outs tab | Startups status filter in Command Center |
| Merge | Pipeline Board | View toggle inside Startups |
| Merge | Advisor CRM + booking promote path | Advisory → My Advisors (Team keeps find/book) |
| Relocate | Founder Portal intake wizard | "New startup" action, not a tab |
| Relocate | Metrics summary tiles | Command Center → Overview (page stays standalone) |
| Relocate | Waitlist signups viewer (Brand step 4) | Discovery Leads / Contacts hub (Brand keeps a count + link) |
| Remove (founder scope) | `/legal` VC 4-layer library | Admin/fund roles only |
| Remove | Fake "AI Advisor" template UI | Replaced by the real PersonalAdvisor |
| Remove | "Refresh Scores" on Studio (founder view) | Command Center venture snapshot |
| Rename | "Founder Portal", "Studio Ops", "Execution", "Team Building" H1, "kill" verdict copy | Founder-language pass |

## Recommended founder information architecture (sidebar unchanged)

```
Studio            you + AI advisor + one venture card (stage chip + next action)
Build
  Command Center  Overview (LIFECYCLE + snapshot + metrics strip) · Startups · Roadmap · Operations
  Signals         unchanged
  Team            Advisors · Co-Founder · Hiring   (+ cofounder-leads strip)
  Metrics         unchanged (source of truth)
  Brand & Landing Pages (multiple per project) · Templates (catalog + saved) · Leads summary
Validate
  Customer Discovery  Leads · Interviews · Insights
  Marketplace         unchanged (+ partner-leads intro queue)
  Advisory            My Advisors · Find Advisors · Tools · Ask AI
  Network             unchanged (Contacts hub remains the cross-audience inbox)
Raise
  Pitch           unchanged
  Capital         Round + Pipeline (kanban) · Cap Table · Financial Model
  Legal Engine    jurisdiction-aware lifecycle checklist (6 groups)
Launch / More / Account   unchanged
```

## The unified lead lifecycle (templates → people → destinations)

```
Landing page (project + template + audience) — branded URL /p/{startup}/{page}
  └─ signup (email + audience + source + landing_page_id)
       └─ Contacts hub (status: new → invited → contacted → replied → qualified → active → passed)
            ├─ customer   → Discovery Leads → invite → interview → survey / pitch flow
            ├─ investor   → Raise Pipeline prospect → stages → committed
            ├─ advisor    → Advisory "My Advisors" (→ book via Team)
            ├─ mentor     → Advisory pipeline (tagged mentor)
            ├─ cofounder  → Team leads strip → co-founder connection flow   (NEW)
            └─ partner    → Marketplace / Network intro queue               (NEW)

Source attribution (template + page) rendered on every lead row, in every destination.
```

Today's plumbing already covers capture, audience typing, dual-write, and three of the six destinations — this model completes the taxonomy and surfaces it in the founder-visible workspaces instead of only the Network tab.

## High-impact redesign recommendations (the short list)

1. **Ship the lifecycle module** — one stage rail + next-best-action in Command Center Overview turns 130 pages into one journey.
2. **Put the leads where the founders are** — Discovery gets its Leads tab; Team and Marketplace get their strips; every lead shows its source.
3. **Default to the valuable thing** — Advisors-first in Team (with locked previews), My Advisors-first in Advisory, Overview-first in Command Center.
4. **Say it in founder language** — no "Studio Ops", no "rubric", no "kill".
5. **Brand the URLs** — `/p/{startup}/{page}` makes every shared link an asset instead of an embarrassment.
6. **One of each** — one discovery workspace, one advisor model, one legal home, one metrics source of truth.

## Prioritized redesign roadmap

Effort: S = day-scale, M = multi-day, L = week+. Risk notes flag shared surfaces — many pages also serve admin/investor/partner, so changes must be founder-scoped or role-aware.

### Critical — the product thesis
1. **Lifecycle module + Command Center restructure** — migration `139_lifecycle_stage.sql`, `progress.ts` lifecycle route, Overview tab; rename tabs, unstack Execution, founder-language pass. *(L — the embedded pages are founder-only via redirects, low role risk; keep legacy `?tab=` redirects working)*
2. **Discovery unification** — Leads tab in `/build/discovery`; retire `/customer-discovery` behind a redirect; converge on the contacts promote endpoint. *(M — Spin-Out Lab links to the old page; update them)*
3. **Complete lead routing** — extend `routeFor()` (`contacts.ts`) for cofounder/partner/mentor + destination strips in Team/Marketplace/Advisory; render `source`/`landing_page_id` on every lead row. *(M — purely additive)*
4. **Team defaults + flattening** — locked-preview default tab, remove Co-Founder inner tabs, browse-before-profile-gate. *(M — AdvisorsPage/CofounderPage also render standalone for other roles; keep `embedded`-prop behavior separate)*

### Important — finish the lifecycles
5. **Branded URLs + multi-page + saved templates** — drop the `landing_pages.project_id` UNIQUE (migration), add `/p/{startup}/{page}` beside `/landing/:slug` (301 legacy forever), startup-slug claim with availability check, custom-templates store + picker slot. *(L — biggest schema change; do this before lead-routing polish so attribution URLs are stable)*
6. **Raise Pipeline v1** — add-investor form, round header card (minimal `rounds` table or round fields on projects), kanban view, prospect↔contact drawer reusing `contact_tasks`/`contact_replies`. *(M/L)*
7. **Legal Engine** — wire jurisdiction to the existing catalog + persist; real status pills from `documents`/orders/compliance events; regroup into the 6 founder-lifecycle groups; seed the missing templates (NDA, ESOP, IP assignment, offer letter, employment, HR policies, privacy) in one migration; scope `/legal` to admin. *(L)*
8. **Advisory human-first inversion** — reorder tabs, swap the template stub for the real PersonalAdvisor, "Tools" grouping. *(M — keep the `/advisory/ask` endpoint until the UI is fully cut over)*

### Nice to have
9. Metrics strip on Command Center Overview + venture card on Studio. *(S once #1 lands)*
10. Shared Tabs / FilterBar / PersonCard primitives; single accent color. *(M, incremental)*
11. CSV export on the Contacts hub; Stripe-metrics nudge in the Grow stage. *(S)*
12. PageExplainer copy dedupe + naming sweep ("Team" vs "Team Building", "Refresh Scores", verdict copy). *(S)*
