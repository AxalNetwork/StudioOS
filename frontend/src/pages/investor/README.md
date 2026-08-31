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

`/network` and `/market-intel` are role-branched on one route rather than
split into two — see the comment above each `<Route>` in `App.jsx` before
changing either branch; `frontend/test/founder_network_a6_contract.test.mjs`
and `frontend/test/founder_shell.test.mjs` both pin the founder side of these
same lines.
