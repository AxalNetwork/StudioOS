# pages/hq/revenue — Revenue v2, the read-only cockpit (D5039; #5039 part 1)

The parts of HQ › Revenue at `/admin/revenue`, drawn to the landed canvas
(`design/incoming/Revenue v2 Page.dc.html` and `Revenue v2 · Boards.dc.html`,
boards RV01 to RV15). `../RevenuePage.jsx` is the host: it makes the page's
seven reads, keeps the Period and the Scope, lays the parts out in canvas
order and re-exports their names, so callers and tests still import from the
page. Nothing here fetches except through the callbacks the host passes.

| File | What it is |
| --- | --- |
| `revenueModel.js` | The rules, pure for the Node test: `UNAVAILABLE`, `money` (D5029's money layer), the eight value states (`VALUE_STATES`, `valueState`, `moneyFigure`), temporal labels (`TEMPORAL`, `summaryTemporal`), quarter keys (`PERIOD_KEY_RE`, the Worker's rule, `periodOptions`), the Data coverage sources and their count, Needs attention, receivables (no due date, so no Overdue), subsidiaries (stale after `STALE_REPORT_DAYS` on the current quarter only), `ceilingFacts` (D5028), the per-currency summary and D5027's `tokenMarginView`. |
| `RevenueStates.jsx` | The vocabulary drawn: `StateMark` and `Figure` (word and shape, never colour alone; a figure with no value is its state's word, never 0), `CoverageMark`, `When` (the temporal label), `Why` (opens the coverage drawer at one source), `Section` and the shared table classes. |
| `RevenueHeader.jsx` | The header (Period, Scope, read time, the “N of M sources complete” button) and `DataCoverageDrawer` (RV11), where each explanation lives once. |
| `ExecutiveSummary.jsx` | The financial position (the four ledger figures Not recorded once, then per native currency the contracted run-rate, refunds and open disputes, then the streams without a full ledger) and `NeedsAttention`, which draws nothing when nothing needs action. |
| `RevenueStreams.jsx` | `RevenueStreams` (Coverage replaces Read; the licence row is a contracted run-rate), `RevenueTrend` (an honest no-series state) and margin-first AI economics (`AiEconomics`, also exported as D5027's `TokenPnl`). |
| `Receivables.jsx` | Receivables from the statements HQ drew (table at 1024px and up, cards below), the D514 policy state `StatementDrawHeld`, and `StatementDrawer` (RV05). |
| `StatementActions.jsx` | Today's statement entry (D453, D458, D514): the payload checks and `StatementActions`, moved here unchanged and mounted as the drawer's footer. |
| `Subsidiaries.jsx` | Reporting health first, then the period's statement per licence; Not drawn and Not reported, never 0. |
| `BillingExceptions.jsx` | Open disputes and the refunds HQ issued, each with its own loading, unreadable and empty state; today's refund form (`RefundForm`, D224, behind the step-up) unchanged beneath it. |
| `Promotions.jsx` | Promotions as badge columns (HQ saved, Branch synced, Enforced, Issued, Remaining, Reporting) with the no-ceiling state, and the D228 ceiling editor unchanged. |

Tested by `frontend/test/hq_revenue_v2_5039.test.mjs` (the cockpit) and the
older revenue tests, which read every file here through
`frontend/test/_revenuePage.mjs`; the Worker's `?period=` by
`cloudflare-worker/test/admin_revenue_period_5039.test.ts`.

## Rules

- **No figure without a store behind it.** A value that no ledger backs is Not
  recorded; a read that failed is Unavailable with Retry; a read still out is
  Loading. None of them is ever drawn as 0.
- **Currencies are never summed.** Every money line is in its own currency.
- **Every figure says what it is measured over** (`When`): the period, Live,
  Last 30 days or As of now.
- **An explanation is written once**, as a source's reason in
  `coverageSources`, and every “Why?” opens the drawer at it.
- **A new part is a new file here**, rendered by `../RevenuePage.jsx`; its
  pure rules go in `revenueModel.js`. Type is 12px or more.
