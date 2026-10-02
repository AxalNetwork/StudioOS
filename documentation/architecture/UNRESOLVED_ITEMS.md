# UNRESOLVED_ITEMS.md — the routing decisions that are not mine to make

Companion to `PROFILE_ROUTING.md`. The integration brief's rule is that this
file carries **only true blockers — not ordinary ambiguity that can be solved
by reading the code**. The bar it sets is *"would deciding this wrong cause
structural damage across multiple workspaces?"* Everything that cleared that bar
is below; everything that did not was decided and written down in
`ASSUMPTIONS_LOG.md` instead.

Eleven historical items. Each names the evidence, what is actually blocked, and what a wrong
guess would cost — because "blocked" without a cost is just a to-do. U9 and
U10 are operations questions rather than routing ones — who serves `axal.vc`
is settled (`DECISIONS.md` D34). Both were resolved on 2026-09-03: U9 (the
Pages mirror) by retiring it (D36), and U10 (whether the Worker-served HTML
carries its security headers) by measuring it — smoke run 33774445968 found
the headers present on twenty-six shell routes across both hosts. They stay
here because `CLAUDE.md` fact 4 points at them, and because how U10 was
answered is the point: by a request to the edge, not a reading of the tree.

## Current review — 2026-10-02

Checked against the current source and decision records, rather than treating
the original findings as a fresh backlog. The dated updates below supersede the
historical evidence in each item. Read-only Cloudflare API inventory now verifies
HQ's custom domains and the retired Pages project's absence. A fresh public smoke
run also verifies live response headers. Authenticated branch isolation and open
GitHub issues remain outside that evidence.

| Item | Current status | Remaining work |
| --- | --- | --- |
| U1 | Branch isolation and read-only verification command implemented; no branch target found in registry or API inventory | A real branch declaration/deployment is still needed. D1 read access is denied by the current token. Public smoke checks and authenticated isolation remain separate evidence requirements. |
| U2 | Implemented | The subsidiary has an Approvals destination and an eleven-lane board; do not build another. |
| U3 | Implemented with recorded decisions | Model choices, meaningful mode controls, router-sourced rates/caps, and the document-type registry already exist. |
| U4 | Retirement resolved; private client notes implemented locally | Migration 369 and the advisor-owned note editor require the normal migration/deployment flow to reach production. |
| U5 | Firm information implemented; candidate offering document inspected and unsuitable for public reuse | The retrieved booklet contains placeholders, is marked confidential, and names a different fund/GP from the canonical entity map. Supply or approve a completed public summary, allocation weights and any response-time commitment. |
| U6 | Implemented on current main under D492 | Existing and later cohort members receive notices; founders can hide themselves from individual advisors in Account → Security & Privacy. |
| U7 | UI/API mismatch fixed | Advisors can open Market Intelligence from Research under the existing API entitlement. |
| U8 | Implemented on current main under D493 | New records require acceptance; existing records remain accepted and their subjects receive a notice. Preserve the request workflow. |
| U9 | Resolved in code and verified externally | The complete Cloudflare Pages inventory has no `studioos` project. |
| U10 | Verified again by live measurement | Public smoke passes on both production hosts; this is independent of authenticated branch verification. |
| U11 | Resolved | Keep the undeclared-token regression guard. |

The unresolved policy choices are not permission to select commercial terms,
publish a response-time promise, or infer consent from an existing database row.

**Validation of the integrated follow-up — 2026-10-02.** After integrating
current main (`fa370069bb`) and preserving its D492/D493 implementations,
`npm run test:drift` exits 0: 9,352 tests pass and three are skipped. Schema/API
guards, a temporary frontend build, Worker/frontend type checks, lint and
dark-mode checks all pass. Migration 369 was applied only to the local emulator,
alongside current main's migrations 367/368. Current main's independent fix for
the timestamp-dependent fund-registry privacy assertion is retained. Public
live smoke evidence is recorded separately under U10. The follow-up is prepared
on a task branch and has not been deployed by this session.

---

## U1 — There is one `admin` sidebar, and the brief needs two

**API VERIFICATION 2026-10-02 — Cloudflare is connected; no branch found.**
The configured API token verifies as active. The configured account-ID value
was initially invalid; the account-list API returned one account, whose actual ID was used
only as a command-scoped override for read-only checks. The environment draft
now suggests the correct ID and allows `axal.vc` and `app.axal.vc` for public
smoke checks. Subsequent commands observe a valid account ID and public smoke
requests succeed through the configured proxy. The runtime readiness metadata
currently says `unknown`, so those successful requests are the evidence, not a
claim that setup readiness is confirmed. No credential values are recorded here.

The Workers inventory includes HQ `studioos`, PR previews and the tail consumer,
but no other `studioos-<code>` branch candidate. The complete custom-domain
inventory has exactly the two HQ domains for StudioOS, both attached to
`studioos` in production. HQ's settings expose its D1/KV bindings and no branch
service binding. These observations support the missing-target finding; they
do not prove tenant isolation. The D1 database-list API returned HTTP 401,
Cloudflare code 10000 (`Authentication error`), so database inventory is
unverified and needs D1 read permission. `HQ_RPC_SECRET` and
`BRANCH_SECRET_BUNDLE` remain unconfigured. No resource was provisioned, changed,
deleted, migrated remotely or deployed during these checks.

**VERIFICATION WORKFLOW 2026-10-02 — repeatable without provisioning.**
`scripts/check-branch-live.mjs` validates real declarations, refuses storage
shared with HQ or another branch, and invokes the existing public live-smoke
runner only for declared live/provisioning hosts. `--plan` performs no network
requests. The current example-only checkout returns exit 2 with a missing-target
explanation, not a passing zero-target result. `infra/branches/README.md` now
documents how to run it and what separate authenticated evidence is required.
At that point there was no real branch or configured Cloudflare identity to
verify. The API check above supersedes the credential finding; supplying a
declaration is not itself proof of deployment.

**EARLIER OPERATIONAL CHECK 2026-10-02 — no live target declared.**
`infra/branches/` contains only `_example.json` and its README. The attached
environment declares no credentials, and the runtime has no
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HQ_RPC_SECRET` or
`BRANCH_SECRET_BUNDLE` binding. Local branch-isolation checks run in the
repository gate; they do not prove that a subsidiary exists in production.
Live verification needs a real branch declaration and configured read access.
Provisioning would be a separate external action, not an inferred setup step.

**REVIEW 2026-10-01 — implementation and operations are separate.** The old
title no longer describes the UI: `frontend/src/sidebarConfig.js` has a branch
shell, and branch approvals, contracts, seats and support have their own routes.
D130, D150 and D215 record work that supersedes the old blanket blocker below.
The chosen tenancy boundary remains a Worker and D1 per branch (D.2), not a new
`licence_id` filter on every HQ query. `infra/branches/README.md` documents the
provisioning workflow. Repository code and local tests cannot prove a branch is
provisioned or that its production credentials work. Do not call U1 fully
closed without that operational evidence, and do not block existing branch
pages on the historical HQ schema limitation.

**STATUS 2026-09-03 — the sidebar half is done; the scoping half is still open.** #416 split the shells: `shellRoleFor(role, user, hqView)` in `frontend/src/lib/shellRole.js` picks the eight-row HQ sidebar for a `super_admins` holder and the subsidiary sidebar for every other admin, and View-as lets the holder preview the subsidiary shell without impersonating. Nothing below this line about scoping has changed: no row names its licence, so every per-subsidiary figure on `/hq` (#417) and `/admin/security` (#418) renders Not recorded with this item as the reason, and the tenant switcher on `/hq` narrows the loaded payload client-side and says so.

**Evidence.** `SIDEBAR_GROUPS` in `frontend/src/sidebarConfig.js` has six role
keys: `founder`, `advisor`, `investor`, `partner`, `admin`, `exploring`. The
single `admin` key carries 48 destinations across six populated groups (Home ·
Admin · Studio · Capital & Legal · Network & Growth · More) and is served to
*both* the territory licensee and HQ. `PAGE_INVENTORY.md` lists it in full.

Building that inventory also turned up a live defect and it is already fixed:
a seventh group, `Account`, was declared with **zero items** — commit
`7c93b83e` moved its last destination to the user menu and left the declaration
behind — and `SidebarNav.jsx` only skipped empty groups *while searching*. Every
admin saw an "ACCOUNT" header that expanded to nothing. The guard now drops the
`q &&`, and `frontend/test/sidebar_empty_group.test.mjs` holds it.

**What the brief needs.** Two distinct admin workspaces, with a contract split
along them — Contracts · Super holding the registry, templates and policy at
HQ; Contracts · Subsidiary holding execution and local records — plus Fund
Administration owned by Super Admin alone.

**Why it cannot be done by deciding.** Splitting the sidebar is the easy half.
The hard half is that every query must learn *which licence the account belongs
to*, and nothing does. The licence LEDGER shipped (migration 187 —
`territory_licences`, `licence_territories`, `licence_seats`, `licence_events`,
surfaced at `/admin/licences`), but the SCOPING half deliberately did not: **no
row in any other table carries a `licence_id`**, and the repo rule in
`CLAUDE.md` is that tenancy goes through one middleware, never ad-hoc `WHERE`
clauses.

**Cost of guessing.** A half-applied scope reads as enforced and is not, which
is worse than none — a licensee sees HQ's rows while the UI says the view is
scoped. This is also why seat usage, accounts-per-subsidiary and revenue-per-
subsidiary are reported as *unavailable with the reason* rather than as zero.

**UPDATE 2026-09-16 (D132) — the gap has a measured counter-example now, and
knowing where it is does not make it smaller.** Until D132 this item was stated
as a schema fact ("no row carries a `licence_id`"). It also had a *reachable*
instance, which is a different and more actionable thing: three routes on
`/api/monitoring/analytics` — `/audit`, `/audit/export.csv` and
`/exports/recent` — sat behind plain `requireAdmin` over `admin_audit_log a
LEFT JOIN users u ON u.id = a.admin_user_id`, so **every admin read every other
admin's export and view history, by name and email**, and the CSV served up to
10,000 rows of it as a download. That was admin-over-admin visibility that was
*symmetric* where the model says it is *hierarchical*, and D132 closed it by
raising all three to `requireSuperAdmin`.

**What that does NOT close, stated so the update is not mistaken for progress
on this item.** D132 moved three specific routes. It did not add a scope, and
`services/tenancyScope.ts:64` still reads `UNSCOPED_ROLES = new Set(['admin'])`
— so on HQ, where every admin still lives, every other admin query returns
every row. The closure for that is **physical, not row-level** (D.2): each
subsidiary is its own Worker over its own D1, so "there is no global view
underneath to leak" becomes literally true rather than enforced. That arrives
when the first branch is *provisioned*, which is blocked on repository secrets
only the owner can set (`BRANCH_SECRET_BUNDLE`, `HQ_RPC_SECRET`, a widened
`CLOUDFLARE_API_TOKEN`), not on more code. **Within one branch there is
deliberately no partition either** — `DECISIONS.md` D.2 records that as
territory-scoping by construction.

**So the useful reading of this item is now:** the schema gap is unchanged and
still priced at "a programme across 151 route files"
(`migrations/199_super_admin.sql:66-71`); what changed is that a specific
reachable instance of it was found by audit and fixed, and the next such
instance should be looked for the same way — by asking which reads join
`admin_audit_log` or `users` without a scope, rather than by re-reading this
paragraph.

**Blocks:** #202 (queues + seat usage), #203 (Contracts · Subsidiary), #210
(Support · Subsidiary), and U2 below.

---

## U2 — "Subsidiary Admin › Approvals" is a destination that does not exist

**RESOLVED IN CODE — reviewed 2026-10-01.** The branch sidebar links to
`/branch/approvals`; `frontend/src/pages/branch/BranchApprovals.jsx` reads the
board served by `cloudflare-worker/src/routes/branch_approvals.ts`. D130 built
the board and D215 widened it to eleven lanes. Decisions stay with each lane's
existing console, including the LP application console; the board is not a
second writer. Covered by the `branch_approvals_d130` and
`branch_approvals_s16_d215` Worker tests and their frontend counterparts.
The evidence and dependency on U1 below describe the original state.

**Evidence.** The brief routes GP Application Review to *Subsidiary Admin ›
Approvals, never LP*. Grepping `sidebarConfig.js` for `Approvals` returns
nothing: **no role has an Approvals group.** The surface itself is live at
`/admin/lp-applications` (`admin_lp_applications.ts`), sitting in the `admin`
role's **Admin** group.

**Why it is not just a rename.** "Never LP" is already satisfied — the route is
admin-gated and no investor sidebar links it, so the honesty requirement holds
today. What does not hold is *which* admin: with one shared `admin` sidebar
(U1), moving it under a new Approvals group would place HQ's GP review inside
what the brief calls the subsidiary's workspace. The five approval queues the
Admin · Subsidiary canvas collapses into one SLA board are the natural contents
of that group, and they are themselves gated on U1.

**Cost of guessing.** Creating an Approvals group now means either duplicating
it into both admin workspaces later, or moving a live admin route twice.

**Blocked behind:** U1.

---

## U3 — The five canvas-vs-code collisions (task #199)

**RESOLVED IN CODE — reviewed 2026-10-01.** These are no longer five unanswered
decisions. The implemented contracts are:

1. **Model choice:** D45 supersedes D13's removal. `aiRouter.ts` validates
   requested models against each task's `alternates`, refuses unlisted models,
   and offers no alternatives for safety or embedding. `railModels.js` derives
   the menu from `/api/ai/pricing`.
2. **Mode controls:** D17 permits a control only where behaviour branches.
   `eadwynConfig.js` now declares real choice surfaces and desk-specific
   behaviour (D424); other surfaces remain fixed. Do not add a toggle to every
   page merely to match the old canvas.
3. **Rates:** `/api/ai/pricing` exposes the router's own price table. The rail
   consumes it; it does not maintain the canvas's separate dollar figures.
4. **Contract taxonomy:** D454 implemented `/api/admin/contracts/doc-types`
   and HQ's read-only registry over the existing four governance layers.
5. **Caps:** `/api/ai/me/spend` returns the enforced caps through `aiSpend.ts`;
   `eadwynConfig.js` reads `month.cap_usd`. This is the configured cap, not a new
   fixed $40/month billing promise.

Existing coverage includes `worker_rail_models`, `worker_rail_honesty_d400`,
`founder_desk_rail_anatomy_d424`, `ai_spend_self`, `ai_router_prices`, and
`admin_contracts_doc_types_d454`. The collision table below is historical.

Recorded in full in `DECISIONS.md`; restated here because they gate three
integration tasks and none can be settled by reading the repository.

| # | Collision | Why it needs a ruling |
| --- | --- | --- |
| 1 | Per-page **model picker** in the AI rail | Exposes model choice, and therefore cost, to end users. A pricing decision. |
| 2 | Rail **mode toggle** | Changes what the assistant is permitted to do per surface. A policy decision. |
| 3 | **Hardcoded $/M costs** in the canvases | Real prices change; `services/aiRouter.ts` holds the caps but publishes no user-facing rate. Publishing a stale price is a commercial claim. |
| 4 | Contracts **layer taxonomy** | Whether a doc-type registry sits above the existing four governance layers, or replaces them. Decides the Contracts · Super vs · Subsidiary split shape. |
| 5 | Spend **cap surfaced to the user** ($40/mo in the canvases) | A billing commitment, not a UI string. |

**Blocks:** #199, #200 (Funds · Fabric), #208 (Legal & Capital Engine).

---

## U4 — RESOLVED 2026-09-02 — the `/office-hours` freeze is lifted, and the page is retired

**IMPLEMENTATION 2026-10-02 — the remaining private-client-notes request.**
Migration 369 and the fresh-database baseline now declare
`advisor_client_notes`, one note per advisor-user/client-user pair. The new
`GET`/`PUT`/`DELETE /api/advisors/me/client-notes/:clientId` routes take the owner
only from authentication, require the current advisor role and an owned advisor
profile, and admit only clients in that advisor's booking history. Empty or
oversized writes are refused; deletion is explicit. Another advisor who has
booked the same client has their own independent note. Neither founders nor
admins can use these routes, and the shared booking DTO is unchanged.

The existing Clients slide-over now loads, edits and deletes the private note.
Switching clients resets the editor; load failures block writing, and save
failures retain the draft. The note is not added to client briefs, public
profiles, notifications or sent work products. Actual-route SQLite tests verify
cross-advisor isolation, role changes, profile ownership, validation, deletion,
and absence from founder booking responses. These are local source changes;
the ordinary migration and deployment flow is still required for production.

**What it was.** Two standing instructions pointed opposite ways. One: *"Keep
`/studio`, `/office-hours` untouched."* The other: the Advisory Practice canvas
(`design/canvases/integrated/Advisory Practice.dc.html`) is routed to
`/office-hours` and adds a session-type/pricing catalog with per-type
take-rate, the founder-side booking-and-pay flow, an earnings ledger, a client
roster with private notes, and weekly capacity. Neither was guessable from the
code, and the work read as a payments flow — money movement on a surface that
had been explicitly fenced off.

**How it resolved.** The owner lifted the freeze. Two things then made the
conflict smaller than it looked:

- **The payments objection was already answered.** The decision taken before
  any of this was built is *record only, no money moves through Axal*: prices
  and billing states are the advisor's own bookkeeping, in integer cents, with
  no payment provider, no invoice and no payout obligation. There is no
  take-rate to ship, so nothing here puts money movement anywhere.
- **`/office-hours` was not worth upgrading.** It read five keys the DTOs have
  never emitted — `start_at`, `duration_min`, `location_kind`, `status`,
  `scheduled_start` — and gated Confirm/Decline on `'requested'`, a booking
  status the worker has never written. Every slot rendered "Invalid Date", the
  cancel button never appeared, and **an advisor could not accept a booking
  there at all.** Upgrading it would have meant fixing it first.

So it was retired rather than upgraded. The storefront half is `/expertise/*`
(profile, services, proof — migrations 202-204) and the booking half is
`/practice/*`, both of which already read the real contract. `/office-hours`
redirects to `/practice/opportunities`; its one capability that lived nowhere
else, the advisor's own review of a session, moved to Practice · Delivery.

**Historical gap, addressed by the implementation above:** the client roster's
private notes were not modeled at retirement.

**Unblocked:** #124.

---

## U6 — A cohort's founders never learn that an advisor can read them

**IMPLEMENTED ON MAIN 2026-10-02 — D492 supersedes the earlier local notice work.**
PRs #964 and #966 implement the owner's notify-and-opt-out decision. Migration
367 declares the notice ledger and per-founder/advisor visibility choices.
`cohortAdvisorAccess.ts` handles existing assignments, later entrants and ended
access, with sweeps on relevant reads and a nightly job. The Settings page
provides the founder's access list and hide/undo control; advisor cohort reads
exclude hidden founders. This session's simpler local notices and duplicate
access list were removed when reconciling with current main, so there is one
implementation. The new private client notes remain separate from cohort access.

**HISTORICAL REVIEW 2026-10-01 — still open at that time.** The assignment create/reactivate and end
handlers in `cloudflare-worker/src/routes/advisors.ts` record the advisor,
cohort, assigning admin and timestamps, but do not notify the affected founders
or obtain their individual consent. Existing proof consents and client grants
are different grants; their presence does not close this item. A decision must
also cover existing assignments, later cohort entrants and ended access.

> **UPDATE 2026-09-07 — the precedent this item wanted now ships.** U6's third
> reading proposes that founders consent per advisor, and names
> `advisor_proof_consents` (204) as the shape to copy. Migration 218
> `advisor_client_grants` (D50) is a closer one: a founder names an advisor and
> opens three scopes individually, the read re-checks the role on every request,
> and the brief returns `withheld[]` naming every scope that was NOT opened.
> That is a founder-made, per-scope grant already in production. It does not
> resolve U6 — migration 206's cohort assignments are admin-made and still tell
> the founder nothing — but it removes the "this would be new machinery"
> objection, because the machinery exists one bucket over.

**Evidence.** `advisor_cohort_assignments` (migration 206) lets an admin grant
one advisor read access to the **names and email addresses** of every founder
in a Lab cohort, through `GET /api/advisors/me/cohort/:cycleId/founders`. The
grant is audited on the advisor's side — who assigned it, when, and it survives
being ended — but there is **no notice to the founder and no consent record
anywhere**. A founder cannot discover that an advisor can see them, cannot
object, and is not told when the access ends.

**Why it is a blocker and not a judgement call.** It is the most sensitive
thing this bucket does, and the answer is a product and possibly a legal
decision rather than a missing table. Three readings are all defensible and
they build differently:

| Reading | Consequence |
|---|---|
| The Lab's terms already cover it | Nothing to build; write it down so the next reader stops asking. |
| Founders are notified, not asked | A notification on grant, and the access list on the founder's own surface. |
| Founders consent per advisor | The grant becomes a request, and `advisor_proof_consents` (204) is the shape to copy. |

Guessing wrong is expensive in both directions: building consent nobody wanted
delays every cohort, and shipping silent access that should have been consented
is not something a later migration undoes.

**Blocks:** nothing today — the access works. It is recorded here because it
shipped without the question being asked, not because a surface is waiting.

---

## U5 — Fund I terms are facts only the firm holds

**SOURCE CHECK 2026-10-02 — the candidate booklet does not settle this item.**
Retrieved the repository's Git LFS object for
`attached_assets/StudioOS_AI_Fund_I_Subscription_Booklet_LPA_1777726603311.docx`
using existing Git authentication and verified its SHA-256 against the tracked
LFS pointer:
`7cee47a8236198e1be0cbd3882b895d33c83c4b30d05efa5f1b36107f01b76e0`.
The document names **StudioOS AI Venture Fund I, LP** and **StudioOS AI GP, LLC**,
where the canonical legal entity map names **Axal VC Fund I, LP** and
**Axal VC GP LLC**. Its target-size and effective-date fields are unfilled, and
it is marked **CONFIDENTIAL — NOT FOR DISTRIBUTION**. Repository presence and
successful retrieval do not establish completed, approved public offering
terms. No document contents or financial terms were added to the public page.

To close the content gap, provide a completed public summary for the intended
fund, with its source/effective date, confirmed allocation weights (or a
decision to omit them), and any approved contact-response commitment. This is
an input requirement; neither the confidential template nor the Spin-Out Fund
model establishes which terms belong on the firm's public page.

**IMPLEMENTATION 2026-10-02 — the existing firm narrative is retained.**
`TeamPage.jsx`, served at `/about`, already contains a manifesto, investment
thesis and the managing partner's account of the firm's mission. It now also
identifies the operator, IP owner and general partner using the entity roles
already recorded in `CLAUDE.md` and the privacy page. Its philosophy section
summarises the existing manifesto, states that theme allocation weights are not
recorded, and directs visitors to the team for applicable offering documents
instead of copying another fund's terms onto this page. The existing public
contact form is linked from there.

`ContactPage.jsx` no longer promises a one-business-day reply. No replacement
deadline is published: the old five-day brief and the former one-day page are
not evidence of an approved or enforced SLA. Remaining work is to confirm the
intended Fund I, approve its public terms and allocation weights, and specify
any response-time commitment. The founder and partner application pages have
separate review-time copy; this change does not establish a policy for them.

**REVIEW 2026-10-01 — the claim that no fund terms exist is stale.**
`frontend/src/lib/spinoutFundModel.js` already holds the Spin-Out Fund I model;
`fundBriefViewModel.js` derives the brief from it and `fund_brief_model` tests
that contract. That does not establish that the broader firm's requested Fund I
is the same offering or that its terms may be republished on the public firm
page. At the time of this review, `ContactPage.jsx` promised a reply within **one** business day,
while this brief asks for **five**. The contact route submits to a GitHub team
queue; that is not evidence of an enforced response SLA. Confirm the intended
fund, approved narrative and response promise before adding more public claims.

**Evidence.** The Axal VC Website canvas asks for the Firm narrative — mission,
a weighted investment philosophy, and Fund I terms — plus a contact form
promising a five-business-day reply. None of that exists anywhere in the
repository, and `CLAUDE.md`'s funds honesty rule is explicit: an unset
fiduciary fact shows "Not recorded" and is never invented.

**Why it is a blocker.** Fund terms are a fiduciary statement about a real fund
offered to real LPs. Drafting plausible ones from the codebase would be
inventing them. The reply-time promise is a commitment, not a field —
`contact.ts` stores submissions and nothing measures a response time.

**Blocks:** #189 (Wave 3 Website/Pricing).

---

## U7 — The worker grants advisors the full market lens; the UI does not let them in

**IMPLEMENTATION 2026-10-02 — aligned with the existing API entitlement.**
The `/market-intel` route now admits advisors and renders the page without a
founder workspace wrapper. The advisor's Research overview links to it. The
API tier predicate and its existing advisor bypass are unchanged: this fixes
a UI restriction on access the server already grants, rather than creating a
new API entitlement.

**HISTORICAL REVIEW 2026-10-01 — reproducible at that time.**
`util/marketIntelTier.ts` and `MarketIntelPage.jsx` both include advisors in the
full-lens bypass, while the `/market-intel` route in `App.jsx` still guards
`labRoles(['admin', 'partner', 'investor'])`. The disagreement is at the route
boundary, not a missing page or missing tier implementation. Preserve the
existing entitlement until its intended direction is confirmed.

**Evidence.** `util/marketIntelTier.ts:20-23` lists the roles that bypass the
tier gate on market intelligence:

```ts
const FULL_LENS_BYPASS_ROLES = ['admin', 'partner', 'advisor'] as const;
```

`routes/market_intel.ts:201-202` repeats it, and `/investor-lens` bypasses for
advisors too. So the API's own policy says an advisor sees everything. The route
that renders it, `App.jsx:1732`, guards `labRoles(['admin', 'partner',
'investor'])` — no advisor — and nothing in the advisor shell links there.
Research · Markets reads the separate `signals` family instead.

**Why it is a blocker.** These two statements cannot both be the policy, and
which one is wrong is a commercial call, not a wiring one. Opening the route
gives a licence with no market-intel entitlement in its pricing the full lens on
aggregated data drawn from other users' survey answers. Removing `advisor` from
the bypass list silently narrows an API grant that has been in place long enough
that something may rely on it. Guessing either way changes what a paying licence
can see.

**What is NOT blocked by it.** Research · Markets, which is live and does not
touch `market_intel`.

---

## U8 — One person writes a relationship record about another, and nobody asks them

**IMPLEMENTED ON MAIN 2026-10-02 — D493 supersedes the earlier local creation notice.**
PRs #964 and #966 implement relationship requests and acceptance under migration
368. Pending requests remain outside the shared books, scores and interactions
until accepted. The counterpart may accept or decline; withdrawal and removal
have explicit routes. Existing rows stay accepted under the recorded owner
choice and receive a legacy notice. This session's immediate shared-record
creation notice was removed, preserving that workflow and its regression tests.

**HISTORICAL REVIEW 2026-10-01 — consent remained open; the schema warning was stale.**
`partnernet.ts` still creates a relationship without the other party's response
and lists it for either participant. D465 subsequently added interaction logs
and reminders; those do not supply relationship consent. Before changing this
contract, define visibility for existing rows, pending rows and their associated
events and interactions, rather than backfilling acceptance that never occurred.

The adjacent schema problem below is already addressed: `schema_baseline.sql`
declares both `partner_relationships` and `relationship_events` and their
indexes; `partnernet.ts` uses `MIGRATED`, a `WeakMap` keyed by `bindingKey(env)`,
with `runSchemaBootstrap`. A runtime safety net over declared baseline tables
is allowed by D235. There is no reason to add duplicate tables or restore the
old module-global latch as part of this item.

**Evidence.** `POST /api/partnernet/relationships` (`routes/partnernet.ts:236`)
is `requireAuth` with a rate limit and no consent step. It verifies the other
user exists (`:246-247`) and inserts a row carrying a `relationship_type` and a
`strength_score`. `GET /relationships` (`:223`) returns rows where **either**
side matches, so the row — and the score — appears in the other person's book
immediately. They are not notified, cannot decline it, and the only history the
store keeps is `created` and `updated` (`:76-83`).

**Why it is a blocker.** It is the same question as U6 one surface over: a
record about a person, readable by someone else, with no consent artefact
anywhere. There are three defensible answers and they build very differently — a
row is private to its author until the other side accepts; a row is mutual and
its creation notifies; or a row is one-sided by design and the score is simply
never shown to the subject. Choosing wrong is expensive in both directions, and
the current behaviour is the third answer arrived at by omission rather than by
decision.

**What this branch did about it.** Nothing, deliberately. Network ·
Relationships **reads** the book and edits rows the caller is already a member
of; it does not offer creation. The page says why: there is no person picker
either, so the only way to add a row today is to type another user's internal
id (`RelationshipsPage.jsx:140`), and shipping that into a new surface would
have propagated both defects.

**Adjacent, and worth fixing whatever is decided:** `partner_relationships` and
`relationship_events` are created by no migration at all — `ensureSchema` builds
them lazily at `routes/partnernet.ts:59-70`, guarded by a module-global
(`let migrated = false`, `:18-20`) rather than the per-binding cache
`GOTCHAS.md` requires. That is the same class of gap migration 201 closed for
`advisors`.

---

## U9 — The Cloudflare Pages mirror and its workflow: keep as a preview/rollback copy, or retire

**VERIFIED EXTERNALLY 2026-10-02.** The read-only Cloudflare Pages project-list
API succeeded for the same account holding the HQ Worker. Its response reports
one page, two projects and two total projects, with no `studioos` project or
`studioos-2p8.pages.dev` domain. The Worker-domain inventory independently maps
both production hosts to `studioos`. The retired Pages project is absent at
the time of this check; no deletion was needed or performed.

**RESOLVED 2026-09-03 — retired** (`DECISIONS.md` D36). The owner chose
Workers Static Assets as the only host. `.github/workflows/cloudflare-pages-deploy.yml`
and `frontend/public/_worker.js` are deleted, `scripts/build-frontend.mjs` no
longer writes the `.assetsignore` that hid the entry script from the Worker
upload, and every document that called the project a mirror now dates it.
*(2026-09-25, D271: the build writes a `docs/.assetsignore` again — for a
different reason. It withholds the retention ledger and the build stamp from the
upload, and lists `/_worker.js` because its presence switches off wrangler's own
refusal of one. The entry script itself stays deleted.)*
Deleting the Pages project itself is a dashboard act for the owner — the
Worker carries the same name, `studioos`, so the entry of type *Pages* is the
one to remove. The evidence and the two cases below stay as the record of why
it was open.

**Evidence (as recorded before the decision).** The `studioos` Pages project
(`studioos-2p8.pages.dev`) serves no production hostname. Since 2026-09-01 (`1d320dda9`) both `axal.vc` and
`app.axal.vc` are whole-host Workers Custom Domains of the `studioos` Worker,
and the Pages dashboard's Production card lists only `studioos-2p8.pages.dev`
under Domains — a Pages custom domain on `axal.vc` would appear there and
would have blocked the Worker binding. The project still exists, and
`.github/workflows/cloudflare-pages-deploy.yml` (added 2026-09-02,
`eda67173d`) Direct-Uploads a freshly built `docs/` to it on every push to
`main`; `frontend/public/_worker.js` (Pages Advanced Mode) runs only there.
Its dashboard-side Git integration is "retained for previews" — that is what
the "This project is disconnected from your Git account" banner refers to,
and it has no bearing on `axal.vc`. `DECISIONS.md` D34 has the record.

**Why it is not decided here.** On 2026-09-03 the Worker deploys after #413
and #414 failed in the migration step, so `wrangler deploy` never ran and
both hosts stayed at run #27's build (`96a6e5769`) — while the mirror
advanced twice. The dashboard showed "Production" deployments for commits
whose Worker never shipped, and misled the operators for a morning. That is
the case for retiring it. The case for keeping it is that it is an
independently built copy of every `main` build on a hostname nothing depends
on — a preview and a rollback reference that costs one workflow. Which
matters more is the owner's call: an operations decision rather than a
routing one, recorded here because `CLAUDE.md` fact 4 points at it.

**Cost of guessing.** Retiring it means removing the workflow, the Pages
project and `frontend/public/_worker.js` together, plus every mention of the
mirror in the documents corrected on 2026-09-03 — leaving any of them behind
recreates a surface that looks live and is not. Keeping it means the next
reader of the Pages dashboard can be misled the same way, unless every
document that mentions it keeps saying "mirror".

**Blocks:** nothing. The Worker deploy and both hosts are unaffected either
way.

---

## U10 — Whether the Worker-served SPA HTML carries the security headers cannot be read from this repository

**VERIFIED AGAIN 2026-10-02.** Ran the repository's public smoke command through
the configured environment proxy:
`node --use-env-proxy scripts/check-spa-live.mjs`. It exited 0 and reported
57 SPA shell/security-header passes across `axal.vc` and `app.axal.vc`, 32
referenced asset passes, and four API health/rate-limit-routing passes. It also
checked the public subscription routing exception. This is direct evidence of
HSTS, nosniff, DENY framing and the required referrer policy on those shell
responses. It does not establish authenticated admin access, branch isolation,
or deployment of the local implementation changes recorded elsewhere here.

**RESOLVED 2026-09-03 — the headers ARE on the live SPA HTML, measured.**
`frontend/public/_headers` (built to `docs/_headers`) is read natively by
Workers static assets and applied to the responses the `[assets]` binding
serves. The evidence is a run, not a reading of this tree:
[post-deploy SPA smoke 33774445968](https://github.com/AxalNetwork/StudioOS/actions/runs/33774445968),
2026-09-03 15:45Z, on `f51433d8f`, against production carrying the 15:17:58Z
deploy (version `e78e2960`). **Twenty-six shell routes across both hosts** —
`/login`, `/dashboard`, `/studio`, `/articles/:slug`, `/admin/licences`,
`/spinout-lab` and the rest, on `axal.vc` and `app.axal.vc` — each reported
`PASS … (SPA shell + security headers)`, which is `scripts/check-spa-live.mjs`
asserting HSTS with a max-age, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin`
on the live response. So the Worker-side fallback below is **not** needed:
nothing has to be routed through the Hono app.

**What the run does not cover, stated rather than glossed.** The apex root
`https://axal.vc/` is a `shell: false` route in that script — a leniency from
when a separate marketing site answered `/` and its asset manifest could not
be mixed with the Worker's — so it is checked for a healthy HTML 200 and not
for headers. `https://app.axal.vc/` *is* asserted in full and passes, and both
hosts serve the same build from one deploy, so there is no reason to think the
apex root differs; but it has not been measured, and tightening that route to
`shell: true` is a one-line change nobody has made. Re-checked on every
6-hourly smoke run from here on.

**A recurring transient worth knowing.** Both hosts' first `/api/health` probe
in that run came back `HTTP 403` with an HTML body and passed on the retry —
identical on `axal.vc` and `app.axal.vc`, which is why the script's retry
exists. It is an edge challenge on a cold runner IP, not a routing fault; a
403 that does *not* clear on retry would be.

**Evidence (as recorded 2026-09-03, before the fix).** Two files set HSTS,
`X-Content-Type-Options: nosniff`, `X-Frame-Options` and `Referrer-Policy`:
`frontend/public/_worker.js`, which ran only on the Pages mirror (both now
retired, D36), and `cloudflare-worker/src/middleware/securityHeaders.ts`,
which runs on API responses. On `axal.vc` and `app.axal.vc`, requests for
paths outside `run_worker_first` (`/api/*`, `/landing/*`, `/p/*`,
`/assets/*`) are answered by the Worker's `[assets]` binding without invoking
the Hono app — so neither file ran for `/login` or `/dashboard` there.

**Why it is a blocker and not a judgement call.** Whether those responses
carry the headers is a property of the Cloudflare edge, not of anything in
this tree, so it cannot be read from the code — and it is exactly the kind of
fact that gets asserted from a document. `GOTCHAS.md` already records the
marketing surface having had no enforced headers at all while three documents
said it did. The one-line live check is:

```sh
curl -sI https://axal.vc/login
```

Until someone runs it and records the answer here, nothing in this repository
may claim the headers are present or absent on the SPA HTML. If they turn out
to be absent, the fix is itself a decision — route the shell through the Hono
app so `securityHeaders.ts` applies, or set them at the edge — and it is not
taken here. *(That fallback was never needed: the run above found them
present.)*

**Blocks:** nothing, and nothing did. API responses were covered by
`securityHeaders.ts` throughout. Kept rather than deleted because the item's
value is the method: the question was answerable only by a request to the
edge, and it stayed unanswered in this file — with `CLAUDE.md` fact 4,
`GOTCHAS.md` and `frontend/public/_headers` all pointing here — until
something actually made that request.

---

## U11 — Tailwind classes naming tokens that are declared nowhere

**RESOLVED 2026-09-13 — both halves. The sweep is taken and the allowlist is
empty.** All eight names are gone from the tree: 575 utilities across 53 files
were consolidated onto the five neutrals `@theme` already declares, and
`UNDECLARED_TODAY` in `frontend/test/ui_design_tokens.test.mjs` is now
`new Set([])`, so any reappearance fails `test:drift`. Verified in the built
bundle rather than assumed: `.text-axal-faint{color:var(--color-axal-faint)}`
and its four siblings emit real declarations, and a grep of
`docs/assets/index-*.css` for each old name returns zero.

**STATUS 2026-09-08 (task #107, `DECISIONS.md` D66) — the guard half was done
first.** The guard this item asked for, in its own words — "a guard that fails a
NEW undeclared `axal-*` class, so the number can only go down" — was not a new
script: `frontend/test/ui_design_tokens.test.mjs` already asserted exactly this
invariant and walked only `frontend/src/ui/`, which was the one directory that
did not need it. It was widened to `pages/` and `workspaces/` with a shrink-only
allowlist of the eight tokens then in use.

**THE NUMBER IN THIS ITEM'S TITLE WAS WRONG, AND SO WAS ITS TABLE.** The census
for #107 counted **397 occurrences across 8 tokens in 50 files**, comments
excluded. Two corrections:

- The table below lists six tokens; there are eight. `axal-line` (8 uses — the
  entire HQ shell added by PRs #417/#418) and `axal-blue` (2 —
  `pages/AdminPage.jsx:845`) were missed, because the grep behind this item ran
  before that shell existed.
- `border-axal-border: 16` **double-counts**. A `\b`-terminated grep for
  `axal-border` also matches `axal-border-soft`, which the next row lists
  separately as 11. The bare count is 5, so the honest 2026-09-07 total was
  ~379 rather than 390.

The three sibling docblocks disagreed with it and with each other too
(`BucketBoard.jsx` said ~410, `ZoneToolbar.jsx` and `ZoneActions.jsx` ~400),
which is what a number nobody could re-derive looks like.

**HOW THE SWEEP WENT — a third branch this item did not consider.** The two it
named were (a) declare eight colours in BOTH themes, and (b) move every call site
to Tailwind's own greys, a restyle across four licences. It rejected (a) for a
good reason: not one call site had a `dark:` counterpart, so eight light values
would flip the whole workspace surface to light-only in dark mode. The third
branch — move the call sites onto the five neutrals ALREADY declared — that
objection does not reach, because the same branch that took this sweep first gave
`axal-ink`, `-muted`, `-faint`, `-hairline` and `-ground` dark counterparts in the
`index.css` auto-skin. A call site landing on one is skinned the moment it lands,
so this was a rename, not a restyle.

The mapping came from how each name was applied, not from its digits: `ink-1` only
ever wrapped `<strong>` emphasis inside muted prose (→ `ink`), `ink-2` was
11.5–12.5px `leading-relaxed` body copy (→ `muted`), `ink-3` was 9–11px uppercase
micro-labels, captions and empty states (→ `faint`), `surface-2` was the tint
already paired with hairline borders (→ `ground`), `border`/`border-soft`/`line`
were one hairline under three names, and `blue` was a single link (→ `violet`).
Decisive evidence that they were synonyms rather than a finer ramp: **no file in
the tree used both vocabularies** — 52 used `ink-n` only, 5 used `muted`/`faint`
only. Two authoring eras, not two scales.

`frontend/src/workspaces/bucketOverview.css:45,51,57` was the only place assigning
concrete values, and it is the one piece of evidence NOT followed: its fallbacks
(#4b5563 / #6b7280 / #e5e7eb) read as a tighter pair than role does, putting
`ink-2` and `ink-3` one step apart where `muted`→`faint` is two. Role won, on the
grounds that one component's fallbacks are not the system's ramp — so 9px
micro-labels are now visibly fainter than body copy. Those three were raw `var()`
in a plain stylesheet, so they were repointed to `var(--color-axal-*)`, the real
`@theme` variable name, keeping their fallbacks.

**THE DEBT WAS GROWING WHILE THIS ITEM SAT OPEN.** The honest 2026-09-07 total was
~379; by 2026-09-13 it was 597 bare occurrences (575 utilities, 22 in prose). The
guard added on 09-08 stopped NEW token names, not new uses of the eight already
allowlisted — worth remembering the next time an allowlist is described as
holding a number down.

---

### The original finding, 2026-09-07

**Found 2026-09-07, closing out the C series.** `frontend/src/index.css`'s
`@theme` block declares ten `--color-axal-*` tokens: `amber`, `amber-deep`,
`faint`, `ground`, `hairline`, `ink`, `lavender`, `muted`, `violet`,
`violet-deep`. The workspace layer uses six that are **not** among them, and
Tailwind v4 does not derive a numbered variant from a base token — so
`text-axal-ink-2` is not a dimmer `axal-ink`, it is a class that emits no CSS
at all:

| Class | `className` usages |
| --- | --- |
| `text-axal-ink-3` | 234 |
| `text-axal-ink-2` | 99 |
| `bg-axal-surface-2` | 28 |
| `border-axal-border` | 16 |
| `border-axal-border-soft` | 11 |
| `text-axal-ink-1` | 2 |

**390 in all, across 20+ files** — including `WorkspaceShell.jsx`, the frame
every workspace route renders, and `BucketOverview`, `ResearchWorkspace`,
`AskZone`, `FundsZone` and most of the partner Delivery and Offers zones. Text
meant to be muted inherits its parent's colour; borders meant to be hairlines
are absent. It reads as "slightly wrong" rather than broken, which is why it
has survived.

**Half of it is already known and was fixed in one place.** The C2 lift
(`NoStoreYet.jsx:24-25`) removed exactly these classes from the three copies of
that component on the grounds that they "are declared in no `@theme` block",
and `BucketBoard.jsx:52` and `ZoneToolbar.jsx:34` carry a NO UNDECLARED TOKENS
rule in their docblocks. The rule was written and applied locally; the other
390 usages were never swept.

**Why it is recorded rather than fixed here.** Two open questions, and both are
decisions rather than details. Either the six tokens get declared — which means
choosing six colours in both themes, and `axal-ink` alone is already a
correction of its own spec (`index.css:57` notes the shipped value differs from
what the canvas asked for) — or 390 call sites move to Tailwind's own greys,
which is a restyle of the whole workspace surface and needs its own render
pass across four licences. Doing either inside a documentation commit would be
a large uninspected visual change.

**What would make it safe to start:** a guard that fails a NEW undeclared
`axal-*` class, so the number can only go down. That is cheap; an allowlist of
390 to get it green is not, which is why it waits on the sweep rather than
leading it.


---

## What is deliberately not here

- **Rail naming and rail count.** Both look like conflicts and neither is; see
  `ASSUMPTIONS_LOG.md` A1 and A3 — they were settled in code before this batch.
- **Governance vs Security** as the Super Admin nav label — the canvas argues
  its own case, so it is an assumption, not a blocker (A4).
- **Partner/Operator as a sixth workspace** — the sidebar already ships it (A2).
- **The Support · Subsidiary nav arity** — 9 rows in the canvas against 8 in the
  brief, resolved by the canvas's own reasoning (A5).
