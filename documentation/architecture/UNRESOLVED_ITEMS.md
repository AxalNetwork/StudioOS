# UNRESOLVED_ITEMS.md — the routing decisions that are not mine to make

Companion to `PROFILE_ROUTING.md`. The integration brief's rule is that this
file carries **only true blockers — not ordinary ambiguity that can be solved
by reading the code**. The bar it sets is *"would deciding this wrong cause
structural damage across multiple workspaces?"* Everything that cleared that bar
is below; everything that did not was decided and written down in
`ASSUMPTIONS_LOG.md` instead.

Eight items. Each names the evidence, what is actually blocked, and what a wrong
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

## What is deliberately not here

- **Rail naming and rail count.** Both look like conflicts and neither is; see
  `ASSUMPTIONS_LOG.md` A1 and A3 — they were settled in code before this batch.
- **Governance vs Security** as the Super Admin nav label — the canvas argues
  its own case, so it is an assumption, not a blocker (A4).
- **Partner/Operator as a sixth workspace** — the sidebar already ships it (A2).
- **The Support · Subsidiary nav arity** — 9 rows in the canvas against 8 in the
  brief, resolved by the canvas's own reasoning (A5).
