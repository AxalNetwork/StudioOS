# design/incoming — new Claude Design UIs waiting to be integrated

**Drop new Claude Design exports here.** This is the intake queue: a canvas
lands in this folder, gets triaged, gets built, and then the row in
`documentation/architecture/ROUTE_MAP.md` records what shipped and what did not.

Nothing in this folder is built, bundled, imported or served. It is source
material. The app never reads it at runtime.

## Where the existing canvases live

The 107 canvases from the first integration pass are in `design/canvases/`,
sorted by whether a live route exists for them:

| Folder | Meaning |
| --- | --- |
| `canvases/integrated/` | 53 — a route is running on main for this canvas. |
| `canvases/backlog/` | 27 — triaged, no route yet. |
| `canvases/out-of-scope/` | 27 — deliberately not being built. |

**A canvas that is already implemented does not belong in this folder.** Once
its route is live, move it to `canvases/integrated/`; this queue should only
ever hold work that is still outstanding.

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
6. **Move the file** into `design/canvases/integrated/` once its route is live
   — or into `backlog/` if it is triaged but not yet built. This queue holds
   only what has not been triaged.

## In the queue now — the four-profile layout pass (2026-09-03)

Eleven canvases landed here from the layout pass. Everything else the owner
sent in that batch was already committed under `design/canvases/`, byte for
byte, so only what the repository did not already hold is here.

**Eight the repository had never seen.** Each governs a bucket whose zone
routes are live and whose bodies have not yet been built up to the canvas —
which is exactly what this queue is for. Partner · Pipeline is the one bucket
of the four whose canvas was already committed — it is in
`design/canvases/integrated/` and is not repeated here.

| Canvas | Governs | Grade |
| --- | --- | --- |
| `Pages · Founder Validate.dc.html` | `/validate`, `/validate/{interviews,pain-map,hypotheses,verdict}` | UPGRADE |
| `Pages · Advisor Expertise.dc.html` | `/expertise`, `/expertise/{profile,services,proof,thinking,visibility}` | UPGRADE |
| `Pages · Advisor Network.dc.html` | `/network/*` on the advisor licence | UPGRADE |
| `Pages · Advisor Research.dc.html` | `/research/*` on the advisor licence | UPGRADE |
| `Pages · Partner Delivery.dc.html` | `/delivery`, `/delivery/{board,deliverables,capacity,status-reports,health}` | UPGRADE |
| `Pages · Partner Offers.dc.html` | `/offers`, `/offers/{catalog,perk-deals,visibility,proof,audience-fit}` | UPGRADE |
| `Pages · Partner Network.dc.html` | `/network/*` on the partner licence | UPGRADE |
| `Pages · Partner Research.dc.html` | `/research/*` on the partner licence | UPGRADE |
| `Navigation Shell · Anatomy.dc.html` | the shell itself — chrome, company switcher and the six role fills (2026-09-04 batch) | UPGRADE |

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
| Pages · Founder Validate | `incoming/` |
| Pages · Investor Deals / Portfolio / Fund / Research | `canvases/integrated/` |
| Pages · Advisor Expertise / Network / Research | `incoming/` |
| Pages · Advisor Cohorts | `canvases/backlog/` |
| Pages · Partner Pipeline | `canvases/integrated/` |
| Pages · Partner Delivery / Offers / Network / Research | `incoming/` |
| Founder Workspaces Canvas, Investor LP Canvas, AIRail | `incoming/` |
| Advisor Canvas | `canvases/integrated/` |
| Partner Operator Canvas, ForgeRail | `canvases/backlog/` |
| Account, Company Settings, Team, Trust Center v2, Get Paid &amp; Invoicing, Emails, Help Center, Contracts · Super, Contracts · Subsidiary, Support · Subsidiary, Support Security · Super | `canvases/integrated/` |
| Team · Authority (sent twice, byte-identical), Funds · Fabric, Send for Signature | `canvases/backlog/` |

**The two the repository does not hold.** One is landed here; the other cannot
be, and the difference is instructive.

1. **`Navigation Shell · Anatomy.dc.html` — LANDED.** Five artboards: N1 shell
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

- **The Spin-Out Lab is not a target.** Not for diffs, not for upgrades, not for
  re-routing.
- **`/studio`, `/founder`, `/partner-portal` and `/office-hours` are untouched**
  in this pass.

And do not create `/founder`, `/investor`, `/advisor` or `/partner` as new
top-level roots — the persona is a role gate on an existing route, not a URL
prefix.
