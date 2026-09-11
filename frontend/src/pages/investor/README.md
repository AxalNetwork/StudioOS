# Investor workspaces

Dedicated canvas landing pages for the Investor / LP role, mirroring the
pattern in `../founder/`: a role-specific component owns the page instead of
the generic route wrapper once a canvas has graduated.

- `InvestorWorkspacePage.jsx` is the shared investor workspace frame — it
  wraps a page with the investor chrome and, on the Deals route, renders
  `InvestorDealsWorkspace` inline rather than handing off to a separate page.
- `InvestorDealsWorkspace.jsx` is the deal-flow canvas rendered inside
  `InvestorWorkspacePage`, not routed directly.
- `InvestorFundLanding.jsx` owns `/funds` for the investor role (GP/admin
  keep the detailed `FundOpsWorkspace`); gated on the institutional tier via
  `fundUnlocked`.
- `InvestorPortfolioCanvas.jsx` is the investor branch rendered inside
  `PortfolioWorkspace.jsx`, the shared portfolio route both founder and
  investor land on.
- `InvestorNetworkWorkspace.jsx` owns `/network` for the investor role,
  parallel to `FounderNetworkDesk` in `../founder/` — same route, role-branched
  in `App.jsx` ahead of the founder ternary.
- `InvestorResearchWorkspace.jsx` owns `/market-intel` for the investor role,
  parallel to the founder branch (`FounderWorkspaceTabs set="research"` wrapping
  `MarketIntelPage`) on the same route.
- The CSS files beside each component are route-scoped for the same reason as
  `../founder/`'s: dense canvas layouts should not leak into shared tools.
- `deals/` holds one file per Deals artboard (ID1–ID4), each a full
  composition — strip, instrument, note, AI band — rather than the single card
  `InvestorDealsWorkspace.jsx` draws for that zone. Its own README carries the
  registry and the rule for adding to it; a zone with no file there still falls
  through to the workspace, which serves the bucket root at `/deals` either
  way.

`/network` and `/market-intel` are role-branched on one route rather than
split into two — see the comment above each `<Route>` in `App.jsx` before
changing either branch; `frontend/test/founder_network_a6_contract.test.mjs`
and `frontend/test/founder_shell.test.mjs` both pin the founder side of these
same lines.

Shell migration status and the investor zone inventory live in
[`documentation/architecture/SHELL_MIGRATION.md`](../../../documentation/architecture/SHELL_MIGRATION.md).
Guard tests: `investor_shell.test.mjs`, `investor_shell_canvas.test.mjs`.

## IP1 · Positions — check the claim before you repeat it

`portfolio/positions` carried an `unbuilt` reason saying *"only the current mark
is stored; there is no history to open"*, and the page carried a card repeating
it: *"History remains read-only on this collection."* Both were false, and the
store had been contradicting them the whole time:

- `portfolio_marks` is a **history** table — one row per marking event with the
  `as_of_date` it speaks for, the `event` behind it, the `basis` it was arrived
  at on and free-text `source` provenance.
- `GET /positions/:projectUid` was **already returning that history**, under
  `canViewLpData`, to the same readers looking at the disabled button.

So the store existed, the read existed, and the reader was entitled. Only the
control was missing. `GET /positions/marks` adds no access and no store — it
answers the one question the per-project read cannot (what happened across the
whole book, in one call) without an N+1.

**The `basis` column is why the history matters.** It is
`round_price | secondary | gp_estimate | write_down | cost`, and the schema says
why: *a round-priced mark and a GP estimate must never look alike to an LP.* A
book showing only the latest FMV hides exactly that. A NULL basis renders as
unrecorded, never as the column's default — reporting it as a GP estimate would
invent the provenance the column exists to record.

**The follow-on reason had the modelling backwards.** It said follow-ons are
"recorded on the deal, not from the ledger". A follow-on **is** a ledger row —
`portfolio_positions.round_name`, one per round — and `POST /positions` creates
it. What is true is that the write is admin-only, so an investor's book does not
offer it. A permissions reason, not a modelling one.

Guard: `frontend/test/investor_portfolio_ip1.test.mjs`, 26 mutants. It checks
the SCHEMA and the EXISTING ROUTE rather than the corrected sentence, because a
sentence can be rewritten without any of those facts changing.

## IP2 · Updates — two rule sets, and the reason only described one

`portfolio/updates` marked its `Rules` chip unbuilt for want of an extraction
layer. That reason is true about extraction and beside the point about rules,
because two different rule sets are in play and only one of them is missing:

- **Collection rules are stored.** `portfolio_kpi_definitions` holds the KPI set
  companies are held to — the key, the name, the wording, the unit, the cadence,
  whether each is required and who it applies to — seeded firm-wide by migration
  168. `GET /positions/kpi-compliance` has returned the whole set as `kpi_set`
  on **every load of this page** since the page was written. Nothing rendered
  it.
- **Extraction rules are not.** Nothing stores how *"a team of ~12"* becomes a
  headcount, so there is no parse-review state, no ambiguity flag and no
  proposal queue. Those four stay absent and the strip keeps labelling them.

So the chip was dark over data already in hand while the sentence explaining why
described a different object. This is milder than IP1's — that reason denied a
store that existed *and* a read already serving it to the same reader; this one
named a real gap and generalised one word too far.

**`Rules` is a view, not a row predicate.** `This period` and `Overdue` narrow
the inbox; there is no way to narrow an inbox *by* a rule set, and a chip that
emptied it would read as "no update breaks a rule" — which is why the two dead
`return false` predicates were removed in the first place. So it swaps the body
for the rule set and leaves the strip alone.

**Three states, not two.** An unreadable compliance source (`null`) is not an
empty rule set (`[]`): the first says nothing about what companies owe, the
second says they owe nothing. **And the table is always a slice** — the route
filters `cadence = ?` and the page reads one cadence — so the panel says which
slice it is rather than presenting its rows as the whole of what is asked for.

**"Carried by" is not a compliance rate.** It counts the stored updates on the
page, each company's latest whatever period it speaks for. A key present with a
blank value is *not* carried: an asked-for figure that arrived empty is the gap
the column exists to show.

**Half the AI band is mounted.** The artboard drafts "parse N updates … arriving
as editable proposals". The flag-don't-guess half reads what arrived against
what was asked for and names the gaps; the proposal half has no store to land
in, and accepting a draft stamps the draft and writes nowhere else. So the label
promises a read, and the instruction refuses the one substitution that would
make it dangerous — turning a hedged phrase into a reported figure.

**Two ops reasons were rewritten.** `Edit rules` said "no reminder rules are
stored", which is true of an object this desk does not have; the set it *does*
have is stored firm-wide with no write path anywhere, so the reason now names
that. `Chase all overdue` said "nothing on this desk sends mail" — too broad by
one call: `notifyProjectFollowers` runs on create and on submit and `notify()`
does dispatch email. What is missing is anything addressed to the company that
stayed silent, which is the narrower reason that stays true if a chase is built.

Guard: `frontend/test/investor_portfolio_ip2.test.mjs`, 43 mutants. Like IP1's
it reads the schema, the seed and the existing route rather than the corrected
sentence.

## IP3 · Value-add — the one whose reasons were true, so it was built

`portfolio/value-add` said *"no support ledger exists to write to"*, *"there is
no support history to export"*, and *"a company is never counted as supported
from the position book alone"*. All three were checked the way IP1 and IP2's
were — read the schema, not the sentence — and **all three held**. Every table
joining an investor to a company records the investor **gaining access** to one,
never doing work for one: `investor_introductions` is an intro *requested*
against a paid quota (with a `status` written once and updated by nothing, and
used by `_investorProjectScope` to decide what an investor may *see*),
`intro_propositions` and `intro_credit_ledger` are the peer-matching engine, and
`engagements`/`engagement_hours` are a **partner's paid delivery**. The full
table and the reasoning are in `DECISIONS.md` D70 and migration 237's header.

So this page was not corrected, it was built: `portfolio_support_entries`,
`/api/portfolio-support`, and four chips that finally have something to filter.

**`promised` is the default state, and delivering is a write.** The artboard's
point is that *"an intro offered in June and never made is worse than one never
offered"*. Without `PATCH /portfolio-support/:uid` the column would freeze at
`promised` exactly as `investor_introductions`'s does — the defect that
disqualified that table in the first place. `withdrawn` is a real terminal state
so a promise can be retired honestly; both destinations are terminal and
re-opening one is a 409.

**Hours are nullable and NULL is never 0.** The tile reads "Not recorded" rather
than "0 h" when nothing was timed, the route returns `entries_without_hours`
beside the sum, and the blank form field is sent as *absent* rather than zero.

**The write is not admin-only, unlike every write in `positions.ts`.** A mark is
a governed valuation assertion; a support entry is a record of what a person
did, and an admin-only ledger stays empty. An investor may log against a company
already in their accessible book — same scope as the read — and nobody gains a
project they could not already see.

**`By company` is a view, not a predicate**, the same shape as IP2's `Rules`;
the ops row's `Per-company view` selects it, which is how the artboard draws it.
A company with no entry appears in that rollup rather than being omitted: it is
the row an LP report needs most and the one a ledger of activity naturally
drops.

Guards: `frontend/test/investor_portfolio_ip3.test.mjs` and
`cloudflare-worker/test/portfolio_support_scope.test.ts` — 56 mutants between
them, all caught. The worker one drives the access rules against real SQLite,
because the widened write gate is the riskiest part of the change.
