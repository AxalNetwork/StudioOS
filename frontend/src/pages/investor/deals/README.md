# `pages/investor/deals` — the Deals bucket, one file per artboard

**All four artboards are built.** ID1–ID4 each have their file below; the
bucket root (`pages/investor/InvestorDealsWorkspace.jsx`) now draws only the
deal-invitation queue, which no artboard covers.

`design/canvases/integrated/Pages · Investor Deals.dc.html` draws four
artboards — **ID1 Pipeline**, **ID2 Screening**, **ID3 Commit**, **ID4
Closing** — and each is a full composition rather than a card: a four-up strip,
a chip row, an ops row, an instrument with its own columns and note, and the AI
band underneath.

| File | Artboard | Route | Architecture |
| --- | --- | --- | --- |
| `PipelineZone.jsx` | ID1 · Deals · Pipeline | `/deals/pipeline` | WORK BOARD |
| `ScreeningZone.jsx` | ID2 · Deals · Screening | `/deals/screening` | ANALYTICS |
| `CommitZone.jsx` | ID3 · Deals · Commit | `/deals/commit` | LEDGER |
| `ClosingZone.jsx` | ID4 · Deals · Closing | `/deals/closing` | COLLECTION |

## The rule for adding to this folder

One file per artboard, named `<Zone>Zone.jsx`, and register it in `ZONES` in
`frontend/src/workspaces/investor/InvestorDealsRoutes.jsx`. A slug that is not
in that registry falls through to `pages/investor/InvestorDealsWorkspace.jsx`,
which is what shipped before the artboards and still serves the bucket root at
`/deals` where all four sections stack.

**The chip and ops rows are declared, not written here.**
`workspaces/investorZoneFilters.js` and `workspaces/investorZoneActions.js`
carry them, and a label with no store behind it is marked `unbuilt` with its
reason — the builder drops the control rather than drawing one that does
nothing. Add the label there, not to the page.

**Absent is stated, never defaulted.** A figure the record does not carry
renders `Not recorded` in the cell that would have held it, and a tile the
PRODUCT has no store for is not drawn at all — its absence goes in the
`StatedLimit` block at the foot of the zone (D56/D68).

## Check the claim before you repeat it — it failed THREE times out of four

**ID2.** The screening ops row said *"no scoring run is stored"* and *"no
rubric is stored"*. Both were false: `score_snapshots` carries six dimensions
per snapshot with their sub-scores, a tier, an `admin_review_status` and
`anomaly_flags`.

**ID3.** The commit ops row said *"no vote is opened here, so none can be
closed"*. Also false, and in two lines of the same file it was written about:
`POST /api/ic/:uid/vote` moves a decision `draft` → `voting` on the first vote,
and `PUT /api/ic/:uid` with a `decision` forces `decided` and stamps
`decided_at`. What is missing is a screen — which is the narrower true thing,
and the idiom this table already had four rows down (*"served by the API; no
screen offers the form yet"*).

**ID4.** The closing ops row said *"no closing templates are stored"*.
`legal_templates` holds 21 seeded rows with merge fields and versioning, and
three of them are the closing paper the artboard names by name: `safe`, `spa`
and `subscription`. The gap is one layer ABOVE the templates — nothing stores a
closing CHECKLIST for one to be applied to. Its *"wires are not a stored
record"* was true but imprecise enough to cost the same lookup twice:
`capital_calls` carries an amount and a `paid_date`, but that is an LP paying
INTO the fund, not the fund wiring OUT to a company.

An `unbuilt` reason that overstates the gap is as misleading as a control that
does nothing — it tells the next reader not to look. **Three of the four zones
shipped one.** If you take one thing from this folder, take that: read the
schema before you trust a sentence about it, including the sentences here.

## What ID3 would not draw, and why it matters more here than elsewhere

`ic_votes.vote` is `yes | no | abstain`. The ID3 artboard's instrument note is
entirely about a partner who **recused** and was therefore excluded from the
denominator — and an abstention is not that. An abstention is a vote cast: the
voter was counted and declined. A recusal is a declared conflict.

Rendering one as the other would put a false statement about a conflict of
interest on a fund's screen, so no vote is drawn as recused, no denominator is
reduced, and the AI instruction forbids the word outright — that surface is the
one most likely to reach for it, because every IC memo ever written says it.
Conditions, quorum and minutes are absent for the same kind of reason and are
stated in `StatedLimit` rather than drawn.

## One scoped read, and only one

`ic_decisions` is tenant data. `routes/ic.ts` exports `scopedDecisions`, and
both readers — the `/api/ic/commit-room` route and the `deals/commit` AI
gather — go through it. A second `SELECT ... FROM ic_decisions` written
anywhere else is how the hole migration 219 closed gets reopened, and an AI
gather is the worst place for it: `UNSCOPED_ROLES` is `{'admin'}`, so a
hard-coded `role: 'admin'` in a scope call quietly turns the predicate into
`1=1` and puts every firm's deliberations into one caller's prompt.
`frontend/test/investor_deals_id3.test.mjs` pins both.

## What ID4 would not draw, and the rule it followed instead

The artboard's instrument is a **Closing checklist** — Item / State / Owner /
Note — and nothing stores a closing checklist. Two tables look like candidates
and neither is: `dd_checklist_items` and `diligence_checklists` belong to
DILIGENCE, a different stage with a different owner, and drawing them here
would relabel diligence work as closing work on a document a fund hands to
counsel. D56 also forbids drawing the table as rows of "Not recorded".

So the instrument is the collection the stage really has — the executed paper
and its signature state — and the checklist's absence is stated rather than
mimed. **Executed means `status === 'completed'` and nothing else:** a
signature count reaching its recipient count is a different fact, and an
envelope with no recipients at all satisfies that ratio trivially.

## ID4 added no endpoint, and that was the point

ID3 ended on the rule that a second copy of a scoped query is how a tenancy
hole reopens. ID4 needed no new route and no new `api.js` method: `listDeals`
and `esignList` were both already served and already scoped —
`esign.get('/')` opens its WHERE clause with `esignEnvelopeScope`
unconditionally — so the zone composes two existing reads and joins them on
`deal_id` in the browser. `frontend/test/investor_deals_id4.test.mjs` pins the
API surface at exactly those two calls, so a third would fail the build.
