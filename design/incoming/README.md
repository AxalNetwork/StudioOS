# design/incoming — new Claude Design UIs waiting to be integrated

**Drop new Claude Design exports here.** This is the intake queue: a canvas
lands in this folder, gets triaged, gets built, and then the row in
`documentation/architecture/ROUTE_MAP.md` records what shipped and what did not.

Nothing in this folder is built, bundled, imported or served. It is source
material. The app never reads it at runtime.

## Where the existing canvases live

The triaged canvases live in `design/canvases/`, sorted by whether a live route
exists for each — not by how far each has been built. Counts as of 2026-10-06:

| Folder | Meaning |
| --- | --- |
| `canvases/integrated/` | 83 — a live route exists for this canvas. **Not "it is finished"** — most are `UPGRADE`, meaning the route runs and the canvas asks for more than it does. `design/canvases/README.md` has a section on exactly this misreading; the gloss here read "the canvas is built" until 2026-09-07, which is what caused it. |
| `canvases/backlog/` | 28 — graded `NEW` or `DEFERRED`: no route yet. |
| `canvases/out-of-scope/` | 26 — deliberately not being built. |

(`canvases/uploads/` holds 3 more that were never part of the triage split, and
is not counted here. The table read 53 / 27 / 27 until 2026-09-04: one canvas
had moved from `backlog/` to `integrated/` without the count following it, and
two more moved out of this folder in the commit that corrected it. It read
57 / 26 / 27 until 2026-09-07, when the two below left, and 59 / 26 / 27 until
2026-09-12, when the Partner four were resolved — see the section on them below.
It then read 61 / 26 / 27 until 2026-09-26, while the folders moved to
66 / 25 / 27. Five arrivals and one graduation went uncounted here, which is
exactly the drift this rule exists to prevent. 74 / 29 / 27 was counted on
2026-09-26, after Calendar and the three Advisor canvases left this queue and
eight new canvases arrived, four into each folder (D305). It read 74 / 29 / 27
until 2026-10-05, when `Advisor Studio` moved from `out-of-scope/` to
`backlog/` after the owner brought the Advisor Program into scope (#975, D565),
and 74 / 30 / 26 until 2026-10-06, when `Pages · Company analysis` moved from
`backlog/` to `integrated/`: its route had been live since D313 (D593). It read
75 / 29 / 26 until `Founder Studio` moved the same way the same day, when the
founder's `/studio` was built to it (D564), and 76 / 28 / 26 until
`Help Ticket Screen` arrived beside `Help Center`, whose new export imports it
(D599), 77 / 28 / 26 until `Ops · Boards` and `Ops Page` graduated with
all five of their areas built (D607), and 79 / 28 / 26 until the Eadwyn
Tickets canvas's two files arrived with their routes built (D606).
**If you move a file, move the number.**)

**A canvas whose bodies are built does not belong in this folder.** Move it to
`canvases/integrated/`; this queue should only ever hold work that is still
outstanding.

**The bar is the bodies, not the route.** A canvas whose zone routes all resolve
but whose zones still render "no store behind this yet" is exactly what this
queue is for — that is the state most of the list below is in. Moving it on the
strength of a live route would empty the queue of the work it exists to track.

## The pipeline

1. **Land it.** Save the export here as `<Surface Name>.dc.html`, keeping the
   name Claude Design gave it so it can be matched against the design source
   later. One file per canvas.
2. **Triage it** into one of six grades, and add a row to
   `documentation/architecture/ROUTE_MAP.md`:

   | Grade | Meaning |
   | --- | --- |
   | CURRENT | The shipped surface already matches. Nothing to do. |
   | RESKIN | Backend exists and is wired; this is presentation only. |
   | UPGRADE | Surface exists; the canvas adds zones or fields to it. |
   | NEW | No surface exists yet. |
   | DEFERRED | Real, but not this pass. Say what it is waiting on. |
   | OUT OF SCOPE | Not being built. Say why. |

3. **Check the data before the pixels.** For every number, name or figure the
   canvas shows, find the column it comes from. This is the step that decides
   the work:
   - the column exists and something already writes it → wire it;
   - the column exists and *nothing reads it* → that is the common case here,
     and it is a wiring job, not a backend job;
   - the column does not exist → it is a migration, and a migration is a
     decision, not a detail. Raise it before building around it.
4. **Build it**, worker route first (`cloudflare-worker/src/routes/`), then the
   page.
5. **Record the gap.** Whatever the canvas asks for that you did not build,
   write the reason into the `ROUTE_MAP.md` row *and* into the page, where the
   user can see it.
6. **Move the file** out of this queue once step 5 is done. Which folder is
   decided by ONE question — *is there a live route for this canvas?* — so
   `integrated/` if there is and `backlog/` if there is not, and nothing else
   enters into it. **Not "is it finished":** an `UPGRADE` whose route runs and
   whose extra asks are unbuilt still goes to `integrated/`, and its row in
   `ROUTE_MAP.md` is what records the part that is outstanding. This clause read
   "into `backlog/` if it is triaged but not yet built" until 2026-09-07, which
   contradicts `design/canvases/README.md` for every `UPGRADE` — live route,
   unbuilt canvas, both clauses firing at once — and on 2026-09-07 it sent
   `Trust Center v2.dc.html` to `backlog/` for a day, next to the `NEW` canvases
   that have no route, and away from the v1 of its own page.

## In the queue now — the four-profile layout pass (2026-09-03)

Eleven canvases landed here from the layout pass. Everything else the owner
sent in that batch was already committed under `design/canvases/`, byte for
byte, so only what the repository did not already hold is here.

**Eight the repository had never seen.** Each governs a bucket whose zone
routes are live and whose bodies have not yet been built up to the canvas —
which is exactly what this queue is for. Partner · Pipeline was the one bucket
of the four whose canvas was already committed — it is in
`design/canvases/integrated/` and was not repeated here **until 2026-09-07**,
when a newer export of it arrived; that duplicate is gone again as of
2026-09-12, see "The Partner four" below.

**Four of the eight had left by 2026-09-12** — two on 2026-09-07 and the two
Partner ones on 2026-09-12. **The three below left on 2026-09-26**, graduating
to `canvases/integrated/` once their routes were confirmed live (D305). The
table stays as the record of what each governed when it left:

| Canvas | Governs | Grade | Still outstanding |
| --- | --- | --- | --- |
| `Pages · Advisor Expertise.dc.html` | `/expertise`, `/expertise/{profile,services,proof,thinking,visibility}` | UPGRADE | `thinking` has no store; `visibility` needs an impression pipeline, not a table. **The file is the 2026-09-07 export**, which replaced the 2026-09-03 one in place; both gaps still stand, and the newer one adds that every zone renders only the impersonation gate card. |
| `Pages · Advisor Network.dc.html` | `/network/*` on the advisor licence | UPGRADE | `organizations` reads nothing for this licence |
| `Pages · Advisor Research.dc.html` | `/research/*` on the advisor licence | UPGRADE | only `markets` and `companies` are live |

## Landed 2026-09-07 — four newer exports, reported as not matching

The owner sent four artifacts, each saying the shipped subpages do not match
the design. All four were decoded and committed here as `.dc.html`, so the
comparison could be made against a file in the repository rather than against a
link. **Two of them — Offers and Pipeline — turned out to be raw re-exports of
canvases already processed in `integrated/`, identical in design data, and were
deleted on 2026-09-12; see "The Partner four" above.** The rows stay because the
comparison they record is what the reports were about:

| Canvas | Governs | Supersedes | Why it is here |
| --- | --- | --- | --- |
| `Pages · Founder Research.dc.html` *(deleted 2026-10-05 — raw twin, D546)* | `/research/{ask,markets,companies,funds,library}` | — | Five zones, `PAGES` shape (ids fs1–fs5): `filters`, `ops`, four `adds` stat tiles, `head`/`rows` with status pills, and an AI-rail offer per zone. The processed copy in `canvases/integrated/` carries the same logic and markup; this one differed only by its runtime uuid, 35 inlined `@font-face` rules and the Claude Design badge, the #155 case. |
| `Pages · Partner Offers.dc.html` *(deleted 2026-09-12 — duplicate)* | `/offers/{catalog,perk-deals,visibility,proof,audience-fit}` | **nothing — it was the same canvas** as the `integrated/` copy | Same shape. Its `ops` match what `partnerZoneActions.js` already carries; its `filters` do **not** exist in `partnerZoneFilters.js` at all — that table has no `offers/*` key, and that gap is still open. |
| `Pages · Partner Pipeline.dc.html` *(deleted 2026-09-12 — duplicate)* | `/pipeline/{leads,proposals,negotiations,retainers,analytics}` | **nothing — it was the same canvas** as the `integrated/` copy | **The one that changes a standing decision**, and that decision is still open. See below; the canvas it describes is now only in `integrated/`. |
| `Pages · Advisor Expertise.dc.html` | `/expertise/{profile,services,proof,thinking,visibility}` | the 2026-09-03 export in this folder | Newer export of the same surface, 54K against 39K. Its `h1` per zone is not the zone name — `Practice profile`, `Service ledger`, `Evidence`, `Published thinking`, `Surfaces & funnel` — and each zone has its own blurb, where the shipped pages print Visibility's on all five. |

### The Partner four — resolved 2026-09-12 (#155)

`design/incoming/` held four Partner canvases. The task read as a four-file move;
**it was two moves and two deletions**, because two of the four already existed
in `integrated/` under the same name with different bytes.

| Canvas | What it was | What happened |
| --- | --- | --- |
| `Pages · Partner Network.dc.html` | processed (its runtime is `src="./support.js"`), no `integrated/` twin | **moved** to `canvases/integrated/` |
| `Pages · Partner Research.dc.html` | same | **moved** to `canvases/integrated/` |
| `Pages · Partner Offers.dc.html` | **raw** export (runtime still an artifact asset uuid), twin already in `integrated/` | **deleted**; the processed twin stays |
| `Pages · Partner Pipeline.dc.html` | same | **deleted**; the processed twin stays |

**Why deletion was right rather than adopting the newer bytes.** The two
`incoming/` copies looked newer and larger — 52K against 37K, 74K against 59K —
and the obvious reading was that they carried a corrected design the shipped
pages did not match. They did not. The whole of the difference is the intake
normalisation `scripts/read-canvas.mjs` performs: the raw copies still name the
artifact's asset uuid as their runtime (`<script src="a408a8e7-…">`) where the
processed copies name `src="./support.js"`, and they carry the un-collapsed markup the
decoder reflows. **The design data is identical** — one `text/x-dc` block each,
23994 characters for Offers and 26183 for Pipeline, the same in both directories
after whitespace normalising, and the same `route:` / `filters:` / `ops:`
declarations. So the raw copies were duplicates that would have overwritten a
working canvas with one whose runtime reference cannot resolve.

**The duplicates were also causing a live inconsistency, which is the real reason
this mattered.** Both guards merge canvases with `out[live(route)] = labels` —
last write wins — and their `canvasDirs` are in **opposite order**
(`filters` reads `incoming` then `integrated`; `actions` reads `integrated` then
`incoming`). With a twin in each directory, the filters guard was deriving Offers
and Pipeline from the *processed* copy and the actions guard from the *raw* one.
Nothing failed, because the data matched — but two guards reading different files
for the same canvas is a coincidence holding a contract together. One copy per
canvas removes it by construction.

**What did NOT change, and must not be read as settled by this.** The Pipeline
`ops` question is exactly where it was: the canvas is shape B (`sc-` markup, no
`route:`), the seven ops are still unbuilt, and integrating them still needs
either the guard's parser to learn that shape or a re-export in the `PAGES` shape
— see the section below, which stands unamended. Nothing here adopted an op,
changed a filter table, or touched a rendered page.

**What the two moved canvases still ask for**, stated here because the canvases
left the queue and the asks did not — the same treatment Delivery and Offers got
on 2026-09-04: Partner Network's `organizations` reads nothing for this licence
(its artboard's empty state *is* the page, per #128), and Partner Research still
has zones whose store is absent, tracked as `RESEARCH_STORE_GAPS` in
`frontend/src/workspaces/noStoreCopy.js` rather than held open here.

**Eight references were repointed**, all of them `const CANVAS = raw('…')` in
tests that read these canvases as the source of truth for their expectations
(`frontend/test/network_*.test.mjs`, `frontend/test/offers_*.test.mjs`), plus one
comment in `profile_zone_filters.test.mjs`.

**Three citations still name the old path, each left alone on purpose.**

`cloudflare-worker/sql/migrations/221_research_ask_sessions.sql` names it in a
comment, and `scripts/migrate-d1.mjs` records a **checksum** per migration file —
editing an applied migration to chase a path rename risks the production ledger
for a comment, which is the worse trade.

The other two are the docblocks of `frontend/src/workspaces/canvasKit.jsx` and
`partnerZoneFilters.js`, and the reason is a **gap in `check-docs-fresh`** worth
recording. That guard is deliberately commit-based — `docsTs >= srcTs`, the
newest commit touching `docs/` against the newest touching `frontend/src` — so
ANY commit touching `frontend/src` without one touching `docs/` fails it under
`--strict`, which CI uses. A comment-only edit produces a **byte-identical**
bundle: the fix the guard itself prints (`npm run build && git add docs`) leaves
`docs/` with nothing to commit, verified here — the root build ran clean and
`git status docs/` came back empty. So the guard has no satisfiable fix for a
comment change in `frontend/src`, and a correct one-line citation fix is
unshippable on its own. Both edits were made, found to trip exactly that, and
reverted. **Fixing the guard is its own task**; the two comments are wrong about
a path and right about everything else, which is the cheaper of the two wrongs.

### Partner Pipeline: the exemption that expired, and the one that has not

`partnerZoneActions.js` carried a paragraph saying `/pipeline` "specifies NO
zone-header actions … left alone until the canvas gains an `ops:` array". This
export **has** one — seven ops across the five zones:

| Zone | Chips | Ops |
| --- | --- | --- |
| Leads | Open · Strong fit · Warm intros · Passed · All sources | `Edit capability weights` |
| Proposals | All · Opened, unanswered · Never opened · Won · Lost | `Bulk: nudge unopened` · `Export win/loss CSV` |
| Negotiations | All · Awaiting you · Awaiting them · Stalled 7d+ | `WIP limit: 5 per stage` |
| Retainers | All · Renewing 30d · Under-consuming · Over scope | `Export MRR schedule` |
| Analytics | Q3 2026 · Q2 2026 · Year to date · By shape | `Export chart` · `Save benchmark` |

**But the table cannot adopt them yet, and the reason is a shape difference
rather than a judgement.** `profile_zone_actions.test.mjs` derives the expected
ops by globbing `canvases/integrated/` and parsing `route:'…'` plus `ops:[…]`
out of a `PAGES` declaration. This export does not use that shape: its labels
live in the `__bundler/template` as `sc-` markup (`<sc-for list="{{ l_views }}">`,
`class="vm"` on each op) and its data in a single `text/x-dc` block keyed by
zone prefix — `l_` Leads, `pr_` Proposals, `n_` Negotiations, `r_` Retainers,
`a_` Analytics. Adding the ops to the table without a canvas the guard can read
was tried and correctly rejected: 21 zones against the 16 the canvases declare.

So integrating this one needs a decision that is not a styling call: either the
guard's parser learns the `sc-` shape, or the surface is re-exported in the
`PAGES` shape the other three use. Until then the ops stay unbuilt, and the
five Pipeline zones keep the empty header they have had since the exemption was
written.

**What each of the four named ops would need**, checked against the stores
rather than guessed:

| Op | Needs | State |
| --- | --- | --- |
| `Export win/loss CSV` | the loaded proposal rows | **buildable now** — `kind: 'export'`, same as every other zone's |
| `Export MRR schedule` | the loaded retainer rows | **buildable now** |
| `Export chart` | the loaded analytics rows | **buildable now** |
| `Edit capability weights` | a capability register and a weight per capability | neither is stored |
| `Bulk: nudge unopened` | a send mechanism, and `opened_at` set by the client | nothing here sends mail, and `opened_at` is the client's column with no surface to set it — "unopened" means "we do not know" |
| `WIP limit: 5 per stage` | a per-stage limit stored for this firm | not stored; the canvas's 5 is its own sample, and adopting it would police the board with an invented number, the same call `delivery/capacity` makes about the hardcoded 40 |
| `Save benchmark` | a figure with a source and a sample | `research_benchmarks` (216/217) exists but stores what the reader entered *with* its provenance; this page has neither to give it |

**Moved to `canvases/integrated/` on 2026-09-04**, both by #431, which built
their stores (migrations 208 and 209) and their bodies:

| Canvas | Governs |
| --- | --- |
| `Pages · Partner Delivery.dc.html` | `/delivery`, `/delivery/{board,deliverables,capacity,status-reports,health}` |
| `Pages · Partner Offers.dc.html` | `/offers`, `/offers/{catalog,perk-deals,visibility,proof,audience-fit}` |

**Moved on 2026-09-07**, each because the one thing this queue was holding it
for now exists — checked against the store, not the route, per the bar above:

| Canvas | Was waiting on | What closed it |
| --- | --- | --- |
| `Pages · Founder Validate.dc.html` | "`hypotheses` and `verdict` have no store" | Migrations 211 and 214. `founder_validate.ts` serves `POST /board/:projectId/hypotheses`, `PATCH /hypotheses/:id` and `POST /hypotheses/:id/links`; `api.createHypothesis` and `api.linkHypothesisPain` are called from `FounderValidateWorkspace.jsx`; no Validate surface renders a `NoStoreYet` card. |
| `Navigation Shell · Anatomy.dc.html` | "the rail's model card" | `WorkerRail.jsx` reads `ASSIST_SURFACES[WORKSPACE_SURFACE]` and imports `modelsForTask` / `priceForTask`. The registration gap that made the card unshippable is closed, so it names a model for a page that does call one. |

**Both carry zero `filters:` and zero `ops:` rows, which is why the move was a
file move.** `profile_zone_filters.test.mjs` and `profile_zone_actions.test.mjs`
glob `integrated/` for `Pages · Founder *`, so a canvas arriving there with zone
rows would change the founder profile's expected zone count. These two do not:
the set stayed 26 zones and 108 labels across what is now six files. Any of the
five canvases still listed above WOULD change it.

**The rest of that sentence used to say such a move "would also need
`canvasDirs` updated in both guards", and that is no longer true.** Both guards
were widened since, and each names a `canvasDirs` list holding **both**
directories — `profile_zone_filters.test.mjs:232` and `:300`,
`profile_zone_actions.test.mjs:145` — so a canvas moving between `incoming/` and
`integrated/` needs no guard edit at all. The actions guard says so in its own
comment: *"Both are read, so a canvas that moves between them does not"* matter.
Verified on 2026-09-12 by moving two and deleting two: both guards stayed green
at 58 and 45 with no change to either `canvasDirs`.

Two things those two canvases asked for were **not** built, and are stated on
the pages themselves rather than held open here: nothing records a firm's
capacity **cap**, so Capacity shows real hours and seats and marks nobody over;
and `opened_at` on a deliverable is the client's to set, so Deliverables does not
claim it. Both are absent facts, not unbuilt bodies — which is why the canvases
moved rather than staying in the queue for them.

**Three are newer exports of canvases already in `canvases/backlog/`** —
`AIRail.dc.html`, `Founder Workspaces Canvas.dc.html` and
`Investor LP Canvas.dc.html`. They land here rather than overwriting the
backlog copies, which is the same route the newer `Support Security · Super`
export took. Triage decides whether each replaces its predecessor; until it
does, **the backlog copy is still the one that was built against**, so read
both before treating a difference as intent.

`AIRail.dc.html` is the one to read first. It, `PartnerRail.dc.html` and
`EmberRail.dc.html` specify the same rail in the same block order — Mode, a
fill-the-blanks toggle, **Model · this page**, Batch, Usage, and a Screened
footer — differing only in profile accent. The shipped rail has Mode,
Coverage, Unavailable here, Usage and the guardrail footer. **The model card
cannot honestly ship yet**: it names a model and a per-million rate, and those
come from the aiRouter task class a surface is bound to through
`ASSIST_SURFACES`. No workspace surface on any of the four licences is
registered there, so the card would name a model for a page that never calls
one. That is a registration gap behind a content gap, not a layout defect, and
`frontend/test/workspace_frame_contract.test.mjs` pins the rail shut against it
in the meantime.

**What already shipped against these**, so nobody re-derives it: the frame
itself. All eleven specify the same `.frame` / `.side` / `.main` / `.rail`
geometry with exactly one crumb, one `<h1>`, one sub-line, one zone-pill row
and one rail, and that contract is now enforced across all four licences —
including `.main`'s padding, which lives on `WorkspaceShell` rather than on
the page container it used to come from. What remains per profile is the
BODIES: the cards, tables and empty states inside the frame.

## The 2026-09-04 batch — forty-two artifact links, forty already committed

The owner sent forty-four `claude.ai/code/artifact/...` links (forty-two
unique; two were pasted twice) and asked what was there, what matched and what
was missing. **Forty of the forty-two are canvases this repository already
holds**, and the checking is worth recording so nobody repeats it.

**How they were matched.** An artifact is a bundled *render* of a canvas, not
the canvas file. Its source sits in a `<script type="__bundler/template">` JSON
string, and the bundler rewrites it on the way in: the Google Fonts `<link>`
becomes ~17 KB of inlined `@font-face` rules pointing at asset ids, camelCase
attributes are hyphenated (`onClick` → `sc-camel-on-click`,
`dangerouslySetInnerHTML` → `sc-camel-dangerously-set-inner-h-t-m-l`), bare
attributes gain `=""`, entities resolve (`&amp;` → `&`), and a fixed
"Made with Claude Design" badge is appended. Undo those four and the artifact
matches the committed `.dc.html` exactly — verified character by character, not
by eye.

**So an artifact link is good enough to identify and diff a canvas, and not
good enough to land one.** Two of the rewrites are lossy: a component canvas's
`data-props="{&quot;page&quot;:…}"` schema is truncated at its first quote (the
AIRail and ForgeRail artifacts both arrive as `data-props="{`), and self-closing
void tags are normalised in a direction this repository is not consistent about
(`<input …/>` appears 81 times and `<input …>` 98 times across these files).
Reconstructing a file from an artifact would therefore commit a component whose
props schema is gone. **Send a `.dc.html` export, not an artifact link, when the
intent is to land a canvas.**

**Where the forty already live**

| Canvas | Folder |
| --- | --- |
| Pages · Founder Build / Grow / Raise / Network / Research | `canvases/integrated/` |
| Pages · Founder Validate | `canvases/integrated/` (moved from `incoming/`, 2026-09-07) |
| Pages · Investor Deals / Portfolio / Fund / Research | `canvases/integrated/` |
| Pages · Advisor Expertise / Network / Research | `canvases/integrated/` (moved from `incoming/`, 2026-09-26) |
| Pages · Advisor Cohorts | `canvases/backlog/` |
| Pages · Partner Pipeline | `canvases/integrated/` |
| Pages · Partner Delivery / Offers | `canvases/integrated/` (moved from `incoming/`, 2026-09-04) |
| Pages · Partner Network / Research | `canvases/integrated/` (moved from `incoming/`, 2026-09-12, #155) |
| Founder Workspaces Canvas, Investor LP Canvas, AIRail | `incoming/` |
| Advisor Canvas | `canvases/integrated/` |
| Partner Operator Canvas, ForgeRail | `canvases/backlog/` |
| Account, Company Settings, Team, Trust Center v2, Get Paid &amp; Invoicing, Emails, Help Center, Contracts · Super, Contracts · Subsidiary, Support · Subsidiary, Support Security · Super | `canvases/integrated/` |
| Team · Authority (sent twice, byte-identical), Funds · Fabric, Send for Signature | `canvases/backlog/` |

**The two the repository does not hold.** One is landed here; the other cannot
be, and the difference is instructive.

1. **`Navigation Shell · Anatomy.dc.html` — LANDED**, and moved on to
   `canvases/integrated/` on 2026-09-07 once the rail's model card shipped.
   Five artboards: N1 shell
   anatomy (one chrome, six role fills), N2 company switcher in three states,
   N3 admin tiers (subsidiary and HQ), N4 founder and investor/LP, N5 advisor
   and service partner. It carries no `data-props`, so nothing about it was
   lost in the bundle, and it reconstructs cleanly.

   It is a **different document** from the committed
   `canvases/integrated/Navigation Shell.dc.html`, which is a single rendered
   shell with no artboards — a name lookup would have said "already have it".
   Hence the distinct filename; do not overwrite the other one.

   One thing is NOT byte-faithful and is worth knowing before it is diffed
   against a fresh export: the bundler normalises self-closing void tags, so
   an `<img … />` in the original arrives as `<img …>`. This repository is
   itself inconsistent about that — 81 `<input … />` against 98 `<input …>`
   across these files — so there is nothing to restore it to. The markup is
   semantically identical.

2. **The second AIRail export — NOT landed, and it cannot be.** Same six
   blocks in the same order as `AIRail.dc.html` in this folder, differing in
   two lines: the Manual blurb reads "Tables, boards and models work alone. No
   tokens." rather than "No tokens. Page works alone.", and the Usage cap is
   bound — `of {{ plan }}` — where the committed copy hardcodes `of $40.00`.

   Its artifact is corrupt, not merely lossy. `data-props="{` truncates at its
   first quote, and because that quote opens an HTML attribute the rest of the
   document is swallowed into it: the canvas source extracts to 5,406 bytes
   against the committed file's 16,068, with the entire `<script
   type="text/x-dc">` logic block — every value behind every `{{ }}` — inside
   an attribute value. The markup survives; the component does not.

   Grafting the committed file's logic onto the recovered markup would not
   reproduce it either, and the reason is exactly the change that makes this
   export interesting: the committed logic returns no `plan` key at all and
   hardcodes `/ 40` in its `spendPct`. `{{ plan }}` would render unresolved.
   **A `.dc.html` export is the only way to land this one.**

   **The shipped code is already on the right side of that difference** and
   must not be "corrected" toward the older canvas: `WorkerRail.jsx` reads
   `spend.month.cap_usd` from the router and renders no cap at all when the
   server does not give one. A hardcoded $40.00 would be a fabricated fact of
   exactly the kind the rule below exists to stop.

**Zone coverage is complete.** Counting the two the batch did not include but
the repository holds — `Pages · Investor Network` and
`Advisor Detail · Practice`, both in `canvases/integrated/` — there is a canvas
for all twenty-one workspace buckets across the four licences. Nothing in the
four-profile layout pass is now waiting on a missing design.

## The rule that matters most

**A canvas is a proposal, not a specification.** These designs are drawn with
plausible sample content — named companies, advisors with specialities, reach
figures, conversion rates. If the platform does not store the fact behind one of
those, the surface must say it is not recorded. It must not render the sample.

That is not a style preference. The audit that started this integration found
whole surfaces — a partner's "portfolio", an advisor's "practice", a fund's
performance — that were canvas sample data shipped as fact, and a public
directory naming three advisors who do not exist. Every one of them looked
finished.

## Do not touch

Two constraints carry over from the current pass, both deliberate:

- **The Spin-Out Lab's TOOL pages are not a target.** Not for diffs, not for
  upgrades, not for re-routing. The one exception, taken deliberately and on
  the owner's instruction, is `/spinout-lab` itself — the programme
  introduction on both the public and the signed-in surface, re-integrated
  from the Spin-Out Lab · Intro canvas. Its four gates still render from
  `PIPELINE_PHASES` in `frontend/src/lib/spinoutLab.js`, never from a canvas's
  own list, and nothing behind the Lab's gates moved. See DECISIONS D38.
- **`/studio`, `/founder`, `/partner-portal` and `/office-hours` are untouched**
  in this pass.

And do not create `/founder`, `/investor`, `/advisor` or `/partner` as new
top-level roots — the persona is a role gate on an existing route, not a URL
prefix.

## Three artifacts, one new canvas — 2026-09-07

Three Claude Design artifact URLs arrived together, reported as designs the
shipped pages did not match: Refer & Earn, Trust Center and Help Center.
**Only one of the three is a canvas this repository did not already hold.**

`scripts/read-canvas.mjs` decodes a published artifact back into a `.dc.html`.
An artifact is a bundler shell: gzip+base64 assets in
`<script type="__bundler/manifest">`, the design itself in
`<script type="__bundler/template">`. Decoded, it is exactly this format — so an
artifact never needed a browser to read, and does not need to stay in one.

Decoding all three and diffing them against `canvases/` gave the triage:

| Artifact | Verdict |
| --- | --- |
| Refer & Earn | **Genuinely newer.** 67 literals added, 3 removed, every one of them in the share card — a post-and-story block the shipped page had no trace of at triage (#477 built one the same day). It was in this queue until 2026-09-26, when it replaced the `integrated/` copy in place (D305). |
| Trust Center | **Already held.** Identical to `Trust Center v2.dc.html`, which was already committed. |
| Help Center | **Already held.** Identical to `Help Center.dc.html`, which was already committed. |

"Identical" is measured, not eyeballed: normalising only HTML serialisation —
`<input>` versus `<input />`, `data-dc-script` versus `data-dc-script=""`, and
line breaks a DOM round-trip cannot preserve — the decoded output and the
committed file are the same bytes. Publishing also adds a dismissible "Made with
Claude Design" badge and mangles camelCase attributes
(`dangerouslySetInnerHTML` → `sc-camel-dangerously-set-inner-h-t-m-l`); the
decoder undoes both, which is what made a byte comparison possible at all.

**So the mismatch being reported is not a stale canvas. It is unbuilt work.**
That is worth saying plainly, because "the design changed" and "the design was
never built" call for completely different responses.

**`Trust Center v2.dc.html` is filed correctly, and the table above was not —
that is the correction this triage found.** The two are worth separating,
because the first thing this triage did was get it backwards.

The canvas is genuinely unbuilt. `ROUTE_MAP.md` grades it UPGRADE, and the
shipped page is still v1 on the two points v2 turns on: v2 says *"Identity data
is managed in Account Settings · this page reports status only"*, while
`TrustCenterPage.jsx:819` renders an editable `<KycVerification embedded />`,
and v2's multi-company selector appears nowhere — the string `company` does not
occur in that file.

So it was moved to `canvases/backlog/`, on the strength of this table's line
reading *"the canvas is built"*. **That was wrong and has been reverted.**
`design/canvases/README.md` is the README of the folder being sorted, it states the
sort key as *"is there a live route for this canvas?"*, and it carries a section
headed *"A file in `integrated/` does not mean 'finished'"* saying that most of
`integrated/` is `UPGRADE` — a live route that the canvas asks more of. `/trust`
is live. `backlog/` is *"graded `NEW` or `DEFERRED`. No route yet"*, so filing
an UPGRADE there makes that description false. And v1 — `Trust Center.dc.html`,
graded CURRENT — sits in `integrated/`; splitting the two versions of one route
across two folders would stop the folder answering its own question.

The defect was this table's one-line gloss, which said something narrower than
the folder means. It has been rewritten to match. **Counts unchanged: 59 / 26 /
27, recounted rather than assumed.** A canvas that is triaged but not built is
recorded in its `ROUTE_MAP.md` row, which is where "what shipped from this
canvas" lives — never by moving the file.

`Help Center.dc.html` stays in `integrated/`, because its ROUTE_MAP row already
records precisely what shipped and what is blocked on an absent store, and it
governs **`/docs`** — not `/help`, which is `TicketsPage`. D39 renamed the menu
label "Support" to "Help Center" and moved `/tickets` to `/help`; the component
was never touched. Anyone reading that design at `/help` is reading it at the
wrong address.

## Landed 2026-09-10 — Calendar, and why it took three asks

`Calendar.dc.html` governs **`/calendar`** on every licence. It is here because
the owner asked for it more than once — *"I told you many times to integrate
the new Calendar page … which was never done"* — and the reason it kept not
happening is recorded in step 1 of the pipeline above: **the canvas was never
landed.** Three requests each pointed at a `claude.ai/code/artifact` link, and
every one of them was worked from the link or not at all, so there was nothing
in the repository to compare the page against and no file for a guard to parse.

**It is a bundled export, which is why it did not decode like the others.** The
artifact ships as a loader plus a gzipped `__bundler/manifest`: sixteen assets,
fourteen of them Inter `woff2` faces, and the design itself as a 34 KB
`__bundler/template` string. Decompressed, that template is byte-for-byte the
shape every other file in this folder has — `<x-dc>`, a `helmet` with
`design_doc_mode: canvas`, and one `text/x-dc` script. The published bundle also
appends a "Made with Claude Design" branding widget, which is host chrome rather
than canvas source and is not in the committed file.

| Canvas | Governs | Grade | Still outstanding |
| --- | --- | --- | --- |
| `Calendar.dc.html` | `/calendar`, all five licences | UPGRADE — **built 2026-09-10**; graduated to `canvases/integrated/` 2026-09-26 (D305) | Six boards (C1–C6) are **states of one page**, not per-profile designs; the only role variation drawn is whether the viewer may create an IC meeting, which matches `canScheduleIc` exactly. All six states are now in `CalendarPage.jsx` and parsed back out of this file by `frontend/test/calendar_page_c1.test.mjs`. **Two deliberate departures, both recorded there:** the page draws six kinds where the canvas draws five (see below), and it withholds the push control on a Calendly event, which the canvas draws and `PUSHABLE_KINDS` refuses with a 400. |

**The canvas caught a bug that was actually there.** It says its kind list
exists *"so `partner_office_hour` cannot lose its chip again"* — and on
`CalendarPage.jsx:366` it has: the filter row lists `advisor_booking`,
`ic_meeting`, `founder_checkin` and `calendly_event`, and office hours are
reachable only under **All**. The kinds are hardcoded in three separate places
in that file (`KIND_LABEL`, `KIND_COLOR`, the filter array), which is how one of
them drifted.

**And one claim in it is wrong about this repository**, which is worth writing
down because the canvas states it as fact: *"expert_booking is in the type union
and produced by nothing, so it is absent here."* It **is** produced —
`services/wellbeing/bookings.ts:267` writes a `calendar_events` row on a
confirmed booking. It never arrives, but for a different reason: that INSERT
names four columns the table does not have and omits three `NOT NULL` ones, so
it throws.

**So the built page draws six kinds, not five** — migration 235 gave
`calendar_events` the four columns those writers name, and with the row
arriving the kind is real, so it gets a chip, a legend row and a dot. Its mark
is derived in the canvas's own idiom rather than borrowed: a distinct shape
first (`0 50% 0 50%`, against the drawn circle / square / pill / hard square /
teardrop) and one low-saturation hue second (`#be123c`, lifting to `#fda4af`
in dark), asserted by the guard to reuse neither a drawn shape, nor a drawn
hue, nor the violet accent. The guard also re-reads the canvas's own sentence
about `expert_booking`, so if this file is ever re-exported saying something
different, the note above stops being true out loud instead of quietly.

See the `ROUTE_MAP.md` row for the rest.

## Landed 2026-10-05 — the Research rebuild's seven canvases (D546)

The owner asked on 2026-10-05 to "wire the wireframes". That approves the
canvas #1079–#1082 cite, `https://claude.ai/artifact/NzuiaEyGymWqABC1kd8Nyj`,
which Session 1 drew from what the platform records (AGENTS.md, "Missing UI").
Its seven page files are committed here byte for byte. They were already in
this folder's format: the shared runtime
(`design/canvases/shared/support.js`) and no inlined fonts.

| Canvas | Governs | Grade | Issue |
| --- | --- | --- | --- |
| `Research · Main.dc.html` | the overview panel on `/research` (founder desk, investor workspace, advisor and partner board) | UPGRADE | #1082 |
| `Research · Companies.dc.html` | `/research/companies` | UPGRADE | #1079 |
| `Research · Company.dc.html` | `/research/companies/company/:uid` | UPGRADE | #1079 |
| `Research · Markets.dc.html` | `/research/markets` | UPGRADE | #1080 |
| `Research · Sector.dc.html` | `/research/markets/sector/:slug`, one page per tracked sector | UPGRADE | #1080 |
| `Research · Geography.dc.html` | `/research/geographies`, `/research/geographies/:code` | NEW | #1080 |
| `Research · Funds.dc.html` | `/research/funds`, `/research/funds/catalog/:id` | UPGRADE | #1081 |

**How to build from them.**
- Put each body inside `WorkspaceShell`, with its zone pills, in the app's
  type: the signed-in app sets Space Grotesk on `body` through `--font-app`
  (`html.app-type` in `frontend/src/index.css`), and figures take Roboto
  Mono. Don't copy the canvas's own font rules, and drop its public top bar.
- The figures drawn are 4 October counts. A screen prints the API's `total`,
  source and coverage, never a number copied from a canvas.
- The 24px logo in each header is an artifact asset (`/_blob/…`) that no repo
  file resolves. `scripts/read-canvas.mjs` would have reported it rather than
  inline it; nothing depends on it.
- Each canvas draws its loading, no-result, `Not recorded` and `Unreadable`
  states. Build all four.

**The four pages the owner shared on 2026-10-04 are not new canvases.** Each is
byte-identical to one already committed, for a route that is already built:
Companies is `canvases/integrated/Pages · Company analysis` (in `backlog/`
until 2026-10-06, D593; `/research/companies/:id`), Funds is `canvases/integrated/Pages · Fund dossier`
(`/research/funds/:uid`), Markets is `canvases/integrated/Pages · Market reading`
(`/research/markets/:uid`) and the Research overview is this folder's
`Founder Workspaces Canvas` (its A7 is `/research` for founders). They stay the
reference for those routes. Two later pages drawn from #1077's prompt are one
design in two layouts with their own sidebar and type; they are not committed.

**Calls Session 1 made for the build (D546).**
- The `/research` panel follows `Research · Main`, since A7 draws none of
  #1082's zones.
- The sector page is one per tracked sector (the twelve market-intelligence
  sectors), because the six index series exist only per sector. Its
  sub-markets are the taxonomy markets under it. A market slug that is not a
  sector slug redirects to its sector's page; a market that maps to no
  tracked sector keeps today's page.
- Geographies get their own zone pill.
- Named comparables on a market reading ("Add an engagement") stay unbuilt:
  `ROUTE_MAP.md` records that choice, and no canvas changes it.
- #1083's three questions and #1081's currency question stay with the owner.
  Until they are answered, those parts of the screens print `Not recorded`
  with the reason.

Each build PR adds or updates its `ROUTE_MAP.md` row (pipeline step 5). A
canvas leaves this folder for `canvases/integrated/` once its route is live.

## Landed 2026-10-06 — the Ops canvas: five areas of screens for stored data (D566)

**Graduated 2026-10-06 (D607).** Both files, and `ops-data.js` beside them,
moved to `canvases/integrated/`: all five areas run on main (D567 to D571).
The owner then sent a newer export of the same page
(`https://claude.ai/artifact/M9fKUxwvHAipiYQcof8ApV`; the three other links
sent with it carry the same `Ops Page`, and `XACu9r2t6YmMSXRcdLrJDr` is the
earlier one). It replaced `Ops Page.dc.html` there. Its one change is the
Account center's section list on a phone: one "Section ▾" row instead of a
sideways row of chips, built on `/account` by D607. The board file did not
change. This section is kept as the record of the landing.

The owner approved `https://claude.ai/artifact/AZQC6nqkCj4ewoaJUvTH7F` on
2026-10-06 and asked for the event organiser to be built first. It was drawn
from the five prompts on #1165. It is one design with two files, both in this
folder's format:

| File | What it is |
| --- | --- |
| `Ops · Boards.dc.html` | The board: rows of artboards at 1440 and 390, chosen by its `set` property (`events`, `account`, `partner`, `wellbeing`, `advisor`, and since 2026-10-07 `deals`, `hq` and `pieces`). Each artboard imports `Ops Page` with one `screen`. |
| `Ops Page.dc.html` | Every screen's markup, one `sc-if` block per screen id: `evo-eligibility`, `evo-queue`, `ev-mine` and `evo-agenda` for events; `ac-*` for the Account center; `pe-*` and `pea-*` for partner earnings; `wb-*`, `wbx-*` and `wba-*` for Wellbeing; `adv-*` and `advpub-*` for the advisor's practice. Since 2026-10-07: `dr-*`, `fd-*`, `sy-close`, `ct-variants` and `st-*` for area 6, `hq-*` for area 7, and `sp-*` for area 8. |

| Area | Screens | Governs | Grade | Issue |
| --- | --- | --- | --- | --- |
| Event organiser | E1 Eligibility, E2 Registrations queue, E3 My registration (phone), E4 Agenda editor | `/events/:id/manage`, `/events/:id/manage/registrations`, `/events/:id`, `/events/:id/manage/agenda` | UPGRADE | #1173 |
| Account center, partner earnings, Wellbeing, advisor practice | the `ac-`, `pe-`/`pea-`, `wb-`/`wbx-`/`wba-` and `adv-`/`advpub-` screens | `/account`; `/partner/earnings`, `/partner/referrals`, `/partner/leaderboard`, `/partner/relationships/:id` and `/admin/commissions`; `/wellbeing`, `/wellbeing/book`, `/wellbeing/practice` and `/admin/wellbeing/resources`; `/practice/*` and `/advisors/:uid` | UPGRADE — built (D568 to D571) | #1174, #1183 |

**The sample text.** The first export had no copy of the script that holds
`Ops Page`'s text. A newer export of the same page, published 2026-10-06 at
`https://claude.ai/artifact/LH7tQqy7UZJ8vE52o63PRh`, carries it. That page
replaced `Ops Page.dc.html` here, and its script is committed beside it as
`ops-data.js` (the page loads it by that name). Every label, count and state
each screen draws is now in the repository; the figures are bracketed
placeholders, never data.

**Areas 6 to 8 arrived on 2026-10-07 (#1387).** They were drawn from #1165's
prompts for those areas, and they replaced all three files in place in
`canvases/integrated/`. `design/canvases/README.md` has the record. None of
their 25 screens is built yet. Each row's task builds them, and each task owns
its own pages.

| Area | Screens | Governs | Grade | Issue |
| --- | --- | --- | --- | --- |
| Deal rooms | D1–D4, M5 References, F3 Close a syndicate | `/deals`; `/deals/:dealId`, its header and three tabs | UPGRADE | #1388 (D630) |
| Funds | F1 Fund page (phone), F2 Quarterly report editor | a fund's page and its reporting period | NEW | #1389 (D631) |
| Cap table variants and colleague seats | V1, S1, S2 (phone) | the cap table's variants; seats; `/invite/:token` | NEW (V1, S1), UPGRADE (S2) | #1390 (D632) |
| HQ: registry, credits, obligations | Q1–Q3 | `/admin/contracts`, `/admin/team`, `/admin/security` | UPGRADE | #1391 (D633) |
| HQ: content, revenue, identity | Q4–Q6 | `/admin/articles`, `/admin/revenue`, the KYC and partner-profile review windows | UPGRADE | #1392 (D634) |
| Founder Validate | M1 (phone), M2 (phone), M3 | `/validate/verdict`, `/validate/interviews`, `/validate/hypotheses` | UPGRADE | #1393 (D635) |
| Brand and watchlist | M4, M6 | `/spinout-lab/brand`, `/watchlist` | UPGRADE | #1394 (D636) |
| Delivery, co-founders, co-marketing | M7, M8 (phone), M9 | `/delivery/health`, `/delivery/capacity`, `/build/team`, `/comarketing` | UPGRADE | #1395 (D637) |

## Landed 2026-10-06 — the Learning canvas (#1157)

The owner approved the Learning design on 2026-10-06
(`https://claude.ai/artifact/M7oxbLxb94CQhfjM8kHbNA`, the newest of three
exports of it) and asked for it to be built: backend by S07, S08 and S09,
frontend by Session 1. `Learning.dc.html` is that export, decoded with
`scripts/read-canvas.mjs`.

| Rows | Screens | Routes | Grade | Issues |
| --- | --- | --- | --- | --- |
| Learner | Learning home and tabs, course, lesson player, webinar, exercise, exam, Articles and Publications, My learning | `/learning`, `/learning/courses/:slug`, `/learning/courses/:slug/:lesson`, `/learning/webinars/:slug`, `/learning/exercises/:slug`, `/learning/exams/:slug`, `/learning/me` | NEW | #1158, #1160, #1161, #1162, #1163 |
| Super Admin | Learning studio and its editors, regional programs | `/learning/studio`, `/learning/studio/programs`, `/learning/studio/programs/:program` | NEW | #1158, #1159, #1163 |
| Admin | An assigned program's members against its content | `/learning/programs`, `/learning/programs/:program` | NEW | #1159, #1163 |

The two earlier exports (`G8nEx8nxtggBJbPBei5rc4`, `BbW5Sze3zEzDC9nnRgpn3c`)
draw the same screens as a component board split by role. They are not
committed. Build to the app's own styling: the pages in the left sidebar are
the reference, as with every canvas here.

## Landed 2026-10-06 — three Research page re-exports (D593)

The owner sent three canvases on 2026-10-06. Each one re-exports a canvas
already committed for a live route, and adds one note board plus imports of
the Research Page canvas, which is this folder's `Research · *` set (D546).
Nothing new needed a file here, so none is kept in this folder:

| Export (Claude Design name) | Committed as | New boards | Grade | Issue |
| --- | --- | --- | --- | --- |
| Pages · Founder Research Fund | `canvases/integrated/Pages · Fund dossier` | F0 (note), F1 and F2 (the funds directory and fund profile) | UPGRADE | #1220 |
| Pages · Research Market Reading | `canvases/integrated/Pages · Market reading` | M0 (note), M1 to M3 (the Markets index, a sector page, a geography page) | UPGRADE | #1220 |
| Pages · Founder Research Analysis | `canvases/integrated/Pages · Company analysis` (in `backlog/` until this change) | C0 (note), C1 and C2 (the company directory and company profile) | UPGRADE | #1220 |

The new boards were added to the committed files, which keep their names and
their processed logo path; every other board was already there byte for byte.
Match a later export to these files by the Claude Design names above.

What was built, and what waits on the owner, is in
`documentation/architecture/decisions/D593.md` and the `ROUTE_MAP.md` rows
for each route.
