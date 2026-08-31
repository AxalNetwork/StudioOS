# UNRESOLVED_ITEMS.md — the routing decisions that are not mine to make

Companion to `PROFILE_ROUTING.md`. The integration brief's rule is that this
file carries **only true blockers — not ordinary ambiguity that can be solved
by reading the code**. The bar it sets is *"would deciding this wrong cause
structural damage across multiple workspaces?"* Everything that cleared that bar
is below; everything that did not was decided and written down in
`ASSUMPTIONS_LOG.md` instead.

Five items. Each names the evidence, what is actually blocked, and what a wrong
guess would cost — because "blocked" without a cost is just a to-do.

---

## U1 — There is one `admin` sidebar, and the brief needs two

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

## U4 — Advisory Practice needs `/office-hours` to change, and `/office-hours` is frozen

**Evidence.** Two standing instructions point opposite ways. One: *"Keep
`/studio`, `/office-hours` untouched."* The other: the Advisory Practice canvas
(`design/canvases/integrated/Advisory Practice.dc.html`, ROUTE_MAP status
`UPGRADE`) is routed to `/office-hours` and adds a session-type/pricing catalog
with per-type take-rate, the founder-side four-step booking-and-pay flow, an
earnings ledger, a client roster with private notes, and weekly capacity.

**Why it is a blocker and not a judgement call.** This is not design ambiguity —
it is a conflict between two things the same person asked for. Neither is
guessable from the code, and the work is a payments flow: shipping it against a
freeze would put money movement on a surface that was explicitly fenced off.

**Blocks:** #124.

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

## What is deliberately not here

- **Rail naming and rail count.** Both look like conflicts and neither is; see
  `ASSUMPTIONS_LOG.md` A1 and A3 — they were settled in code before this batch.
- **Governance vs Security** as the Super Admin nav label — the canvas argues
  its own case, so it is an assumption, not a blocker (A4).
- **Partner/Operator as a sixth workspace** — the sidebar already ships it (A2).
- **The Support · Subsidiary nav arity** — 9 rows in the canvas against 8 in the
  brief, resolved by the canvas's own reasoning (A5).
