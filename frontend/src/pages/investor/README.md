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
