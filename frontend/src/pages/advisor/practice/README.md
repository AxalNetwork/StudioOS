# `pages/advisor/practice` — the Practice bucket, one file per artboard

`design/canvases/integrated/Advisor Detail · Practice.dc.html` draws five
artboards, and each is a full composition rather than a card: a chip row, an ops
row, a four-up strip, one or two instruments with their own notes, and an AI band
underneath. Every zone here is a **body only** — no shell, no rail. The crumb,
the `h1`, the zone pills and the Worker AI rail are drawn by
`frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx`, which mounts each of these through
its `ZONE` map.

| File | Artboard | Route | Architecture | Store |
| --- | --- | --- | --- | --- |
| `OpportunitiesZone.jsx` | PR1 · Opportunities | `/practice/opportunities` | FEED | `advisor_bookings` |
| `EngagementsZone.jsx` | PR2 · Engagements | `/practice/engagements` | WORK BOARD | `advisor_engagements` (migration 238) |
| `DeliveryZone.jsx` | PR3 · Delivery | `/practice/delivery` | COLLECTION | `advisor_deliverables` + `advisor_deliverable_versions` (migration 239) |
| `SessionsZone.jsx` | PR4 · Sessions | `/practice/sessions` | FEED | availability rules, session types, booking links (migration 240) + `advisor_bookings` amounts (205) |
| `EarningsZone.jsx` | **D4** · Earnings | `/practice/earnings` | LEDGER | the take rate, payout account, payouts and per-line cut (241) + the period note (242) + `advisor_bookings` amounts (205) + `advisor_engagements` retainers (238) |

**PR5 IS A POINTER, AND ITS ARTBOARD IS ELSEWHERE.** `Advisor Detail ·
Practice.dc.html` draws Earnings as `/practice/earnings · drawn in full as D4`,
and D4 lives in `design/canvases/backlog/Detail Layer Canvas II.dc.html`. That
file stays in `backlog/` by decision — reading it for intent is not promoting
it — so `profile_zone_actions.test.mjs` and `profile_zone_filters.test.mjs`
each read **one artboard out of it by route** (`alsoZones`) rather than
sweeping the directory, which would hand this profile artboards belonging to
cohorts and to two partner buckets.

**The Architecture column is the canvas's, and three of these five used to be
wrong.** `Advisor Detail · Practice.dc.html` tags each artboard in its own
header and repeats the set in `setIndex`; the two agree. `shellConfig.js` said
MATCH ENGINE for Opportunities and WORK BOARD for both Delivery and Sessions,
and nothing objected, because the archetype only feeds `ZoneNav` and the badge —
a wrong one makes the nav advertise the wrong kind of page and breaks nothing.
`frontend/test/advisor_shell_canvas.test.mjs` now reads the canvas and pins all
five, the way `investor_shell_canvas.test.mjs` always has for that profile.

**Three of the five replaced a tab on the legacy Advisory workspace, and each
replacement is a redirect.** `/advisor/advisory/{opportunities,engagements,delivery}`
all `<Navigate>` to their zone in `App.jsx`, because two pages answering the same
question with different instruments is worse than one. Clients and Contracts have
no artboard, so they keep their `/advisor/advisory/*` URL and the legacy
workspace with it.

**The open receipt is written on the founder's side, not here.** `DeliveryZone.jsx`
reports whether a client read something and has no control that can say so:
`GET /advisors/received/deliverables` and `POST …/:uid/open` are the client's, and
they live beside the founder-facing half of `cloudflare-worker/src/routes/advisors.ts`
because the relationship carrying a deliverable is the engagement and no grant is
involved. A work product can only be SENT to an engagement whose client has an
Axal account, and `EngagementsZone.jsx` is where that account is linked — from the
people who have booked this advisor, never by typing an id. D73.

**What a replaced tab could do that its artboard does not draw moves with it.**
Delivery's post-session review loop — sessions held, which have a review, your
average rating, and the form that files one — is a section at the bottom of
`DeliveryZone.jsx`. It arrived on that tab when `/office-hours` retired as the one
capability living nowhere else, and an artboard that does not draw a working
feature is not an instruction to delete it.

## The pure modules beside the pages

A zone with real derivations keeps them in a sibling module that imports nothing:

- `opportunityLog.js` — PR1's decision log.
- `engagementBoard.js` — PR2's lanes, renewal rules and stored **calendar days**.
- `deliveryTrail.js` — PR3's version tags, open-state tones, seam line, median
  label and nudge targets, over **instants**.
- `sessionGrid.js` — PR4's slot precedence, the four tile counts, day grouping
  and the blackout label. The first module here to hold **both** kinds of time,
  so its header says which is which.
- `earningsLedger.js` — D4's four windows, its cut note and its payout labels.
  It holds the third pairing: a period is a **calendar label** (`2026-Q3`, a
  key and a chip) whose **bounds are UTC instants**, because `created_at` is.

Two reasons, and the second is the one that matters. A guard test can import a
module and not a page — importing a page pulls React and a stylesheet through its
component tree, which the test loader cannot resolve — and a derivation that is
unit-tested in both directions is one a mutation cannot quietly break.

**A calendar day and an instant are formatted differently on purpose.**
`engagementBoard.js` parses `2026-11-04` out of the string, because
`new Date('2026-11-04')` is midnight UTC and would render "Nov 3" for every reader
west of Greenwich. `deliveryTrail.js` sends `sent_at` and `opened_at` through the
browser's own formatter, because those are written by `nowIso()` at the moment
something happened and the reader's local day is the right one. `sessionGrid.js`
holds one of each: a slot's `starts_at` is an instant, and a blackout window is a
weekday plus a clock reading that is never parsed into a `Date` at all. Each
module's header says which it holds.

**Chip narrowing stays in the page, not the module.** A chip declared live in
`frontend/src/workspaces/advisorZoneFilters.js` must be served by the page that mounts the chip
row, and `frontend/test/profile_zone_filters.test.mjs` enforces it: a predicate
one import away lets a chip be declared live over a page that cannot serve it.

## The rule for adding to this folder

One file per artboard, named `<Zone>Zone.jsx`, registered in `ZONE['/practice']`
in `frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx`. Then four things move together,
or the build fails:

1. The chip row in `frontend/src/workspaces/advisorZoneFilters.js` and the ops row in
   `frontend/src/workspaces/advisorZoneActions.js` — both read from the canvas, in its order,
   and an op with no store behind it is marked `unbuilt` with the reason that
   actually blocks it. **Check the schema before writing that reason**: two in
   this series were false on the first draft.
2. The zone's `ZONE_BLURB` line, which is the artboard's own sentence unless the
   artboard's carries a fixture count — then the count goes and the rest stays.
3. The zone leaves `excluded` in `frontend/test/profile_zone_actions.test.mjs`
   and `frontend/test/profile_zone_filters.test.mjs`, and the counts beside it
   move because an artboard landed, not because anyone edited a number.
4. A guard file, `frontend/test/advisor_practice_pr<N>.test.mjs`, that reads the
   canvas rather than remembering it.

**An absence is stated, never rendered as a plausible zero** (D56/D68): "Not
recorded" with a reason, never `0` and never an em-dash. `DeliveryZone.jsx` fixed
one it inherited on the way in.

**And the rule reaches the controls, not just the numbers.** `SessionsZone.jsx`
withholds "Change the rules" when the availability read failed, because
`PUT /me/availability` REPLACES the rule set rather than merging: saving that
form over a set the page never received would write four empty fields and an
empty blackout list over whatever the advisor configured. A control that would
destroy the thing it claims to edit is worse than no control, so the card says
why it is gone. The same read failure is why `rules` is seeded with its own
empty shape rather than `null` — `<ZoneBody>` builds its children before it
reads `loading`, so a null held there throws on the first render whatever
`loading` says (`frontend/test/_zoneGuards.mjs`, rule 2).
