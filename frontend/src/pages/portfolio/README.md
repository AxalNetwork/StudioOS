# Portfolio v2 frame and shared patterns

D4817 part 1 (#5311, canvas PF-01): the investor's Portfolio v2, drawn to
`design/incoming/Portfolio v2 Page.dc.html` and its boards. PF-01 (the
Overview, `../investor/InvestorPortfolioCanvas.jsx` at `/portfolio` and
`/portfolio/health`) is the first board built in this frame; PF-02 to PF-08
draw in the same frame with the same parts. Decision notes:
`documentation/architecture/decisions/D4817-p1.md`.

- `PortfolioFrame.jsx` — the one frame: skip link, the content as a named
  section (the app owns the one `<main>`), the crumb, the heading, the basis
  context, the local navigation (Overview · Positions · Reports · Performance
  · Value-add, the shell's `ZoneNav` with Performance added through
  `row.extra`), the route-aware document title (`portfolioTitle`) and the
  rail slot. A board passes its own `WorkerRail` as `rail`.
- `PortfolioParts.jsx` — the patterns built once (canvas PF-11): the financial
  metric (`FinancialMetric`, `MetricValue`), the basis strip, health status,
  the reporting obligation, a source that could not be read, a summary tile,
  and the attention item.
- `portfolioModel.js` — the pure model: a read's three states (`readOf`,
  `SHAPES`), the formatters, performance with its basis (`performanceOf`),
  health and reporting per company, the evidence rules and the Needs
  attention queue, the company table and its filters.
- `usePortfolioReads.js` — each source read, committed and retried on its own.
- `portfolio.css` — the frame's tokens (redefined under `.dark`) and its
  tablet (1100px, 850px) and phone (600px) layouts.

D4817 part 2 (canvas PF-02) draws Positions
(`../investor/InvestorPortfolioPositions.jsx` at `/portfolio/positions`) in
the same frame (`tab="positions"`). It adds to the model, not a second one: a
position's mark kind (`markOf`: marked, none, unusable), one basis vocabulary
(`basisLabel`), the date mark age is measured at (`markReference`, never the
browser clock), the register's rows, counts and total, one company's mark
history, and the attention rules with their evidence (`attentionRulesOf`).
Decision notes: `documentation/architecture/decisions/D4817-p2.md`.

## Rules

- A failed read reads **Unreadable** with a Retry for that source alone; a
  read that answered with nothing reads **Not recorded** with its reason; a
  measured zero stays 0. Never a zero or an empty book for a failure.
- No issue number, decision id or build-phase name in member copy (#5365 F-09).
- The rail's structure is #5130's; the Account-menu move is #4473's. The frame
  places the rail and links Portfolio's own routes, and changes neither.
