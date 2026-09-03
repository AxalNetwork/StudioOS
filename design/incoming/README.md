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
