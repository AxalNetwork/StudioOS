# UNRESOLVED_ITEMS.md — the routing decisions that are not mine to make

Companion to `PROFILE_ROUTING.md`. The integration brief's rule is that this
file carries **only true blockers — not ordinary ambiguity that can be solved
by reading the code**. The bar it sets is *"would deciding this wrong cause
structural damage across multiple workspaces?"* Everything that cleared that bar
is below; everything that did not was decided and written down in
`ASSUMPTIONS_LOG.md` instead.

Eleven items. Each names the evidence, what is actually blocked, and what a wrong
guess would cost — because "blocked" without a cost is just a to-do. U9 and
U10 are operations questions rather than routing ones — who serves `axal.vc`
is settled (`DECISIONS.md` D34). Both were resolved on 2026-09-03: U9 (the
Pages mirror) by retiring it (D36), and U10 (whether the Worker-served HTML
carries its security headers) by measuring it — smoke run 33774445968 found
the headers present on twenty-six shell routes across both hosts. They stay
here because `CLAUDE.md` fact 4 points at them, and because how U10 was
answered is the point: by a request to the edge, not a reading of the tree.

---

## U1 — There is one `admin` sidebar, and the brief needs two

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

**Blocks:** #202 (queues + seat usage), #203 (Contracts · Subsidiary), #210
(Support · Subsidiary), and U2 below.

---

## U2 — "Subsidiary Admin › Approvals" is a destination that does not exist

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

**Still not modeled, and named so it stays visible:** the client roster's
private notes.

**Unblocked:** #124.

---

## U6 — A cohort's founders never learn that an advisor can read them

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

**RESOLVED 2026-09-03 — retired** (`DECISIONS.md` D36). The owner chose
Workers Static Assets as the only host. `.github/workflows/cloudflare-pages-deploy.yml`
and `frontend/public/_worker.js` are deleted, `scripts/build-frontend.mjs` no
longer writes the `.assetsignore` that hid the entry script from the Worker
upload, and every document that called the project a mirror now dates it.
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

**STATUS 2026-09-08 (task #107, `DECISIONS.md` D66) — the guard half is done;
the sweep half is open.** The guard this item asked for, in its own words — "a
guard that fails a NEW undeclared `axal-*` class, so the number can only go
down" — now exists. It was not a new script: `frontend/test/ui_design_tokens.test.mjs`
already asserted exactly this invariant and walked only `frontend/src/ui/`,
which was the one directory that did not need it. It walks `pages/` and
`workspaces/` too, with a shrink-only allowlist of the eight tokens in use
today, and it runs under `test:drift` already.

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

**WHY THE SWEEP IS STILL OPEN, and it is a bigger job than this item estimated.**
Not one of the 397 call sites has a `dark:` counterpart — `grep
"dark:text-axal|dark:bg-axal|dark:border-axal"` returns zero. So declaring the
eight tokens is not sufficient: eight light values would flip the whole
workspace surface to light-only in dark mode. The two branches are (a) declare
eight colours in BOTH themes, obeying D2's palette rule, or (b) move 397 call
sites to Tailwind's own greys — a restyle across four licences needing its own
render pass. `frontend/src/workspaces/bucketOverview.css:45,51,57` is the only
place in the tree that assigns concrete values to `ink-2`/`ink-3`/`border`
(#4b5563 / #6b7280 / #e5e7eb), and is the anchor either way.

**Blocks:** nothing ships wrong today — this is a visual-fidelity debt, not a
correctness one. It blocks trusting the workspace layer's colour in dark mode,
and it blocks any claim that the `@theme` block is the single source of truth
for colour, which D2 and `theme_token_census.test.mjs` otherwise enforce.

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
