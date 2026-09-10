# design/incoming — new Claude Design UIs waiting to be integrated

**Drop new Claude Design exports here.** This is the intake queue: a canvas
lands in this folder, gets triaged, gets built, and then the row in
`documentation/architecture/ROUTE_MAP.md` records what shipped and what did not.

Nothing in this folder is built, bundled, imported or served. It is source
material. The app never reads it at runtime.

## Where the existing canvases live

The triaged canvases live in `design/canvases/`, sorted by whether a live route
exists for each — not by how far each has been built. Counts as of 2026-09-07:

| Folder | Meaning |
| --- | --- |
| `canvases/integrated/` | 59 — a live route exists for this canvas. **Not "it is finished"** — most are `UPGRADE`, meaning the route runs and the canvas asks for more than it does. `design/canvases/README.md` has a section on exactly this misreading; the gloss here read "the canvas is built" until 2026-09-07, which is what caused it. |
| `canvases/backlog/` | 26 — graded `NEW` or `DEFERRED`: no route yet. |
| `canvases/out-of-scope/` | 27 — deliberately not being built. |

(`canvases/uploads/` holds 3 more that were never part of the triage split, and
is not counted here. The table read 53 / 27 / 27 until 2026-09-04: one canvas
had moved from `backlog/` to `integrated/` without the count following it, and
two more moved out of this folder in the commit that corrected it. It read
57 / 26 / 27 until 2026-09-07, when the two below left. **If you move a file,
move the number.**)

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
when a newer export of it arrived; see the section above.

**Two of the eight have since left**, and what remains is the honest list:

| Canvas | Governs | Grade | Still outstanding |
| --- | --- | --- | --- |
| `Pages · Advisor Expertise.dc.html` | `/expertise`, `/expertise/{profile,services,proof,thinking,visibility}` | UPGRADE | `thinking` has no store; `visibility` needs an impression pipeline, not a table. **The file is the 2026-09-07 export**, which replaced the 2026-09-03 one in place; both gaps still stand, and the newer one adds that every zone renders only the impersonation gate card. |
| `Pages · Advisor Network.dc.html` | `/network/*` on the advisor licence | UPGRADE | `organizations` reads nothing for this licence |
| `Pages · Advisor Research.dc.html` | `/research/*` on the advisor licence | UPGRADE | only `markets` and `companies` are live |
| `Pages · Partner Network.dc.html` | `/network/*` on the partner licence | UPGRADE | `organizations` reads nothing for this licence |
| `Pages · Partner Research.dc.html` | `/research/*` on the partner licence | UPGRADE | only `markets` and `companies` are live |

## Landed 2026-09-07 — four newer exports, reported as not matching

The owner sent four artifacts, each saying the shipped subpages do not match
the design. All four are decoded and committed here as `.dc.html`, so the
comparison can be made against a file in the repository rather than against a
link:

| Canvas | Governs | Supersedes | Why it is here |
| --- | --- | --- | --- |
| `Pages · Founder Research.dc.html` | `/research/{ask,markets,companies,funds,library}` | — | Five zones, `PAGES` shape (ids fs1–fs5): `filters`, `ops`, four `adds` stat tiles, `head`/`rows` with status pills, and an AI-rail offer per zone. |
| `Pages · Partner Offers.dc.html` | `/offers/{catalog,perk-deals,visibility,proof,audience-fit}` | the `integrated/` copy | Same shape. Its `ops` match what `partnerZoneActions.js` already carries; its `filters` do **not** exist in `partnerZoneFilters.js` at all — that table has no `offers/*` key. |
| `Pages · Partner Pipeline.dc.html` | `/pipeline/{leads,proposals,negotiations,retainers,analytics}` | the `integrated/` copy | **The one that changes a standing decision.** See below. |
| `Pages · Advisor Expertise.dc.html` | `/expertise/{profile,services,proof,thinking,visibility}` | the 2026-09-03 export in this folder | Newer export of the same surface, 54K against 39K. Its `h1` per zone is not the zone name — `Practice profile`, `Service ledger`, `Evidence`, `Published thinking`, `Surfaces & funnel` — and each zone has its own blurb, where the shipped pages print Visibility's on all five. |

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
five canvases still listed above WOULD change it, and would also need
`canvasDirs` updated in both guards.

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
| Pages · Advisor Expertise / Network / Research | `incoming/` |
| Pages · Advisor Cohorts | `canvases/backlog/` |
| Pages · Partner Pipeline | `canvases/integrated/` |
| Pages · Partner Delivery / Offers | `canvases/integrated/` (moved from `incoming/`, 2026-09-04) |
| Pages · Partner Network / Research | `incoming/` |
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
| Refer & Earn | **Genuinely newer.** 67 literals added, 3 removed, every one of them in the share card — a post-and-story block the shipped page has no trace of. It is in this queue. |
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
| `Calendar.dc.html` | `/calendar`, all five licences | UPGRADE | Six boards (C1–C6) are **states of one page**, not per-profile designs; the only role variation drawn is whether the viewer may create an IC meeting, which matches `canScheduleIc` exactly. The shipped page has the providers, the push, the .ics feed and both create-flows already wired — what it lacks is the canvas's composition, and one live defect the canvas itself names. |

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
it throws. See the `ROUTE_MAP.md` row for what that means for the build.
