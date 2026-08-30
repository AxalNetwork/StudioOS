# ASSUMPTIONS_LOG.md — routing decisions taken without being told

Companion to `PROFILE_ROUTING.md` and `UNRESOLVED_ITEMS.md`.

The integration brief's non-stop execution rule says to decide and continue
wherever an ambiguity can be settled from the code, and to escalate only what
would cause structural damage across multiple workspaces. This file is the
receipt for the first half: every call made here without an explicit
instruction, what it was decided from, and what would have to be true for it to
be wrong. The brief's own priority order applies throughout — **existing role
canvas structure first**, then file naming, then page semantics, then nav
labels, then tier governance, then surface depth.

---

## A1 — The AI is called **Eadwyn**. `ForgeRail` is a filename, not a name.

Six canvases in the corpus name `ForgeRail`, and this looked like a naming
conflict. It
is not: it was settled before this batch. `DECISIONS.md` **D3** resolved the
assistant's name as Eadwyn, and `frontend/src/ui/AssistRail.jsx` records the
distinction in the component itself —

> *"(D3 resolved the AI's name as "Eadwyn"; ForgeRail is the source canvas's own
> filename and is unchanged.)"*

**Decided:** canvas filenames and component names in the design corpus are
design-side identifiers and are never renamed to match product copy; product
copy is never renamed to match a canvas filename. `design/canvases/` is
read-only by its own README, so the two can differ permanently without drift.

**Wrong if:** the user rules that the corpus should be re-exported under
Eadwyn naming, which is a Claude Design action, not a repository one.

---

## A2 — Partner/Operator is a sixth workspace, not a missing one

The brief names five role workspaces: Founder, Advisor, LP/Investor, Subsidiary
Admin, Super Admin. This codebase ships **six** role sidebars — `SIDEBAR_GROUPS`
has a `partner` key with its own five-group lifecycle layout, and an earlier
standing instruction put Partner/Operator alongside the other four on `/studio`.

**Decided:** Partner/Operator is carried as its own workspace in
`PROFILE_ROUTING.md` rather than folded into another. Deleting it to match the
list of five would strand eight canvases and a live role.

**Wrong if:** the brief's five were meant as a replacement set rather than the
subset it was addressing. Nothing was built on this assumption — it changes
only how the map groups rows.

---

## A3 — Eight rails collapse to one `AssistRail`; the canvases' four are the same component

The batch proposes `ForgeRail`, `AdminRail`, `PartnerRail` and `AIRail` as
separate rails. Phase 1d had already consolidated **eight** of them into one,
and the reason is recorded where it can be checked:

> *"AIRail, InvRail, AdminRail, AdvRail, PartnerRail, DetailRail, EmberRail and
> ForgeRail contain **zero route links** between them… What varies across the
> eight is entirely config; what is identical is this skeleton."*
> — `frontend/src/ui/AssistRail.jsx`

`assistCost.js` carries the sharper half of the argument: all eight ship a
byte-identical cost function, and *"two functions drifting apart is exactly how
a user is quoted one price and shown another."*

**Decided:** the four rails in this batch route to `AssistRail` with config,
not to four components. `PROFILE_ROUTING.md` marks them surface type **Embedded
rail**, with no route and no nav row, which is what they are.

**Wrong if:** a rail needs behaviour the config cannot express. None in this
batch does.

---

## A4 — Super Admin's nav row is **Security**, widening the former Governance

The brief's nav list says Governance; `Support Security · Super` renames it. The
canvas argues its own case rather than asserting it:

> *"'Governance' described the audit log and nothing else; the compliance
> officer and the security engineer are the same headcount at this size, and
> splitting the row would split one job across two destinations. The word is
> Security because that is what someone opens it worried about — the audit log
> is what they find inside, not what they came for."*

**Decided:** adopt Security. Under the brief's own priority order the canvas
outranks the nav label, and this is a **label change only** — no route moves, no
permission changes, and the audit log keeps its URL.

**Wrong if:** "Governance" is externally committed language (a policy document,
an auditor's checklist). Nothing in the repository suggests it is.

---

## A5 — Security at the subsidiary tier is placed, not housed

`Support · Subsidiary`'s nav carries nine rows where the brief lists eight, and
the extra row is Support itself. The canvas then declines to add the row this
batch might have implied:

> *"One row, and deliberately not two. Security alerts for the territory surface
> on Home and as row actions in Accounts rather than as their own destination —
> a licensee is not a security engineer, and a full security surface at the
> tenant tier widens the attack surface it claims to defend."*

**Decided:** no subsidiary security destination. Security appears as a Home zone
and as Accounts row actions. The arity difference resolves in the canvas's
favour for the same reason as A4.

**Wrong if:** a licensee is contractually required to hold their own security
console. That is a licence-terms question, and it lands inside U1's scoping
work rather than this batch.

---

## A6 — The routing map is **generated**, not written

The brief asks for a `profile-routing-map.md`. Every fact it wants already lives
in `ROUTE_MAP.md` (canvas → persona → route → backend → status) and
`sidebarConfig.js` (role → group → destination), both of which are already
guarded. Hand-copying them into a third document creates a third thing to keep
in sync — and this repository has paid for that exact mistake three times in one
day: a deploy runbook that hardcoded a migration range, a cutover document that
hardcoded a route-table size, and a production document that cited a line
number. All three were true when written and wrong within a week.

**Decided:** `PROFILE_ROUTING.md` and `PAGE_INVENTORY.md` are projections
emitted by `scripts/build-profile-routing.mjs`, and
`frontend/test/profile_routing_fresh.test.mjs` fails the build if either falls
behind its sources. `ROUTE_MAP.md` stays the single authority on what shipped
from each canvas; the generated pair answers the different question of *who sees
it and where*.

**Wrong if:** the brief wanted a hand-curated narrative rather than a map. The
narrative parts — the blockers and these assumptions — are hand-written, in the
two files that should be.

---

## A7 — Surface type defaults to full page, and the exceptions live in one table

The brief's rule is full page for dashboards, tables, reporting, settings,
workflows, approvals, contracts and analytics; modal or drawer only for a
confirmation, a short form, a quick review, or an accept/decline. Applied as
written, that default is correct for all but seven canvases.

**Decided:** the default is applied mechanically and the seven exceptions are
declared in `SURFACE_OVERRIDES` in the generator — one table, with a stated
reason each, rather than judgements scattered through prose. Three are print
artefacts (Fund Brief One-Pager, Quarterly Report, Graduation Certificate), two
are not surfaces at all (Emails, System Sheet), one is a page-plus-wizard (Send
for Signature) and one is the brief's own drawer case (GP Application Review:
a queue page, with the accept/decline in a drawer).

---

## A8 — Where a re-uploaded canvas differs from the stored one, the **stored** copy wins

Forty-two canvases were re-dropped during this batch. Every one resolves to a
file already in `design/canvases/`, and where bytes differ, the difference runs
one way: the uploads are **older** exports. Two examples, both checked rather
than inferred — the stored `Deal Flow` says "Axal VC Ventures Fund II" where the
upload still says "Axal Ventures Fund II"; the stored `Customer Discovery` has a
full ICP definition module (85,264 bytes) where the upload has a stub working
definition (59,759 bytes).

**Decided:** nothing under `design/canvases/` was overwritten and no upload was
promoted into `design/incoming/`. The store is newer in every case examined.

**Wrong if:** a newer export was made outside this session. The README's rule
covers that: a changed design lands in `design/incoming/`, and that folder is
empty.

---

## A9 — The brief's four filenames map onto the repository's casing

Asked for `profile-routing-map.md`, `page-inventory.md`, `unresolved-items.md`
and `assumptions-log.md`. `documentation/architecture/` names every file in
SCREAMING_SNAKE (`ROUTE_MAP.md`, `DECISIONS.md`, `GOTCHAS.md`, `PRODUCTION.md`).

**Decided:** `PROFILE_ROUTING.md`, `PAGE_INVENTORY.md`, `UNRESOLVED_ITEMS.md`,
`ASSUMPTIONS_LOG.md`, indexed in that folder's README. Same four documents,
house casing.

---

## A10 — A canvas serving two workspaces is listed under both

Thirteen of the 107 ROUTE_MAP rows carry a compound persona ("founder + investor-LP",
"shared (founder + GP/admin)", "investor-LP / partner / admin"). Forcing each to
a single owner would hide a surface from a workspace that genuinely reaches it.

**Decided:** such canvases appear under every workspace they serve, which is why
the map lists more rows than the 107-canvas corpus. This does **not** weaken the
one-company rule in `CLAUDE.md` — that governs whose *data* a page may show, not
which roles may open it, and company context still changes only through
`CompanySwitcher`.
