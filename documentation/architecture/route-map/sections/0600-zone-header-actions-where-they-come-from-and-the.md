## Zone-header actions — where they come from, and the two canvases that give none

Every `Pages · *` artboard carries an `ops:` array — the actions its zone header
draws. They are the source for the header action rows, and they are copied
verbatim rather than paraphrased: `frontend/src/workspaces/founderZoneActions.js`
re-derives from the canvases in `frontend/test/founder_zone_actions.test.mjs`, so
the table cannot drift from the design without failing the build.

**Founder — twenty-one zones, fifty-eight actions.** Fifteen are exports that
run against the rows the page has loaded, seventeen are links to a route that
already performs the action and that a founder is allowed to open, and
twenty-six are stated gaps. A gap renders as a sentence, never as a button.

**Investor — fourteen zones, forty-two actions, and only ten of them run.** Nine
exports, one link, thirty-two stated gaps. The investor SCREENS are read-only:
`InvestorDealsWorkspace` calls `listDeals` and two invitation methods,
Fund Ops (retired by D1160) called `capitalCalls` and `fundsLpPortal`, and
`InvestorFundCalls` and `InvestorFundAccounting` call no API at all.

**But a read-only screen is not a missing capability, and two of these labels
are exactly that difference.** `api.fundAddLP` and `api.fundCapitalCall` both
exist and both reach a worker route that serves them — `routes/funds.ts`
declares `post('/:id/lps')` and `post('/:id/capital-call')`. "Add LP" and "New
call" are missing a FORM, not a store, and their notes say so. The first version
of this section called the whole bucket "read-only shells" with "no flow
anywhere", which was read off the pages' imports without following the chain to
`api.js`; it is corrected here because a reader deciding what to build next is
the person that error misleads.

The other ten Deals and Fund gaps are gaps in the store as well as the screen —
no rubric, no minutes, no conditions, no wire record, no journal source, no
reconciliation state. ("Configure stages" is one of them: `advanceDeal` moves
one deal between stages; the label asks to edit the stage set, which nothing
stores.)

**The same label is not the same answer across profiles.** `/network/*` serves
every licence and the investor artboard's ops are word-for-word the founder's —
but a route one licence may open can be closed to another, so an identical
label can be a link on one zone and a stated gap on another. "Request an intro"
was the example, a link to `/matches` on the investor's zone only; `/matches`
was deleted with the AI Matching Engine and the label is a gap on both. That is
why each profile keeps its own table and only the builder is shared.

**The canvas's Fund routes are not the live ones.** `Pages · Investor Fund`
names `/fund/lps`, `/fund/calls`, `/fund/accounting`, `/fund/reporting`; the
router mounts `/funds/lps`, `/funds/calls`, `/funds/ledger`, `/funds/reporting`,
and `shellConfig.js` agrees with the router. The tables key on the live routes
and `frontend/test/profile_zone_actions.test.mjs` carries the mapping explicitly, rather
than fuzzy-matching a canvas route to a page that is not at it.

**Partner — ten zones, thirty actions, and every one of the ten can export.**
Ten exports, no links, twenty stated gaps. This is the first bucket set in the
pass where an export is the rule rather than the exception, because migrations
208 and 209 gave Delivery and Offers real stores. The writes are the gaps, and
each has a reason its own zone already documents: `opened_at` and
`signed_off_at` are the CLIENT'S to set, so "Chase unopened" would be the firm
writing a metric about itself; no cadence is stored, so "Draft all" has nothing
to schedule; consent belongs to the founder, so "Ask for consent" needs a
founder-side surface that does not exist.

Three partner bucket sets are absent from the table and none is an oversight.
`/pipeline` is the `ops:`-less canvas recorded below. `/network`'s three zones
render `NetworkPage`, whose bodies are three further shared components used by
more than one licence — threading a partner-only row through four such files is
the shared-surface pass, not this one. `/research` is that same shared surface.

**Advisor — four zones, twelve actions.** One link, four exports, seven gaps.
Four zones is the whole advisor scope, and that is a fact about the canvases
rather than a shortfall: only `Pages · Advisor Expertise` (in `design/canvases/integrated/`
since 2026-09-26) carries
an `ops:` array at all. `Advisor Detail · Practice`, `Advisor Canvas` and the
backlog `Pages · Advisor Cohorts` are rendered exports with no header actions on
any artboard, so Practice's five zones and Cohorts' five have nothing to copy.

Three of the seven gaps are the good kind — the thing the label asks for is on
the page already, so the note points down rather than apologising: every profile
field is editable in place, a service is added from the form below, consent is
requested from each proof's own row.

`expertise/visibility` is the fifth artboard and is deliberately excluded from the
action tables. (Since D1424 it is a zone body, `VisibilityZone.jsx` over D1597's
read, and its artboard's ops are still not carried: none of them has a store.)
It was not a zone body at all but the one card left in `AdvisorBucketRoutes`' `COPY`,
and its whole page is already the gap statement — nothing in this product counts
a profile view, for anyone, and that needs an impression pipeline rather than a
table. Three more "not stored" lines above a page headed *"Nothing counts profile
views"* would be noise rather than honesty. The exclusion is listed in
`frontend/test/profile_zone_actions.test.mjs`, which checks the excluded set
exactly, so it cannot quietly grow.

**The shared surfaces are done too, and they are the reason each profile keeps
its own table.** `/network/*` and `/research/*` are single components answering
four licences. Their zone BODIES are identical and their zone ACTIONS are not:
`/research/markets` says "Cite in deck" to a founder, "Cite in a memo" to an
investor, "Add source" to an advisor and "Attach to proposal" to a partner, from
one line of code. So the body stays shared and `workspaces/zoneActionsByRole.js`
picks the table by the role the shell has already resolved. An unknown role gets
an EMPTY list rather than a default profile's — a header quietly showing a
founder's actions to an operator is the same broken promise as a dead button and
much harder to notice.

Those bodies take the row as a RENDER PROP called with the rows they loaded
(`AskZone`, `LibraryZone`, `SignalsPage`, `CompetitorAnalysis`,
`RelationshipsPanel`, `IntroductionsPanel`), so each page renders what it is
handed and learns nothing about licences. `/signals`, `/build/competitors`,
`/relationships` and `/network` for an operator pass nothing and get nothing.

