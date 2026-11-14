# pages/hq/revenue — Revenue v2: the cockpit and its governed receivable actions (D5039; #5039 parts 1 and 2)

The parts of HQ › Revenue at `/admin/revenue`, drawn to the landed canvas
(`design/incoming/Revenue v2 Page.dc.html` and `Revenue v2 · Boards.dc.html`,
boards RV01 to RV15). `../RevenuePage.jsx` is the host: it makes the page's
six reads, keeps the Period and the Scope, lays the parts out in canvas
order and re-exports their names, so callers and tests still import from the
page. Drawer history and explicit branch checks read their scoped API directly.

| File | What it is |
| --- | --- |
| `revenueModel.js` | Pure value, period, coverage and native-currency rules; receivables use the Worker's recorded Overdue observation, and push acceptance remains separate from checkout read-back. |
| `RevenueStates.jsx` | The vocabulary drawn: `StateMark` and `Figure` (word and shape, never colour alone; a figure with no value is its state's word, never 0), `CoverageMark`, `When` (the temporal label), `Why` (opens the coverage drawer at one source), `Section` and the shared table classes. |
| `RevenueHeader.jsx` | Period, Scope, Stream, read time and coverage controls; Stream explicitly filters the stream table. |
| `ExecutiveSummary.jsx` | The financial position (the four ledger figures Not recorded once, then per native currency the contracted run-rate, refunds and open disputes, then the streams without a full ledger) and `NeedsAttention`, which draws nothing when nothing needs action. |
| `RevenueStreams.jsx` | `RevenueStreams` (Coverage replaces Read; the licence row is a contracted run-rate), `RevenueTrend` (an honest no-series state) and margin-first AI economics (`AiEconomics`, also exported as D5027's `TokenPnl`). |
| `Receivables.jsx` | Receivables from the statements HQ drew (table at 1024px and up, cards below), the D514 policy state `StatementDrawHeld`, and `StatementDrawer` (RV05), which swaps its body for an action's flow and holds Escape and × while its request is out. |
| `StatementActions.jsx` | The drawer's governed payment, issue, void, dispute and due-date entry points; legacy pure payload exports remain for compatibility. |
| `StatementActionFlow.jsx` | One governed action (part 2, RV05b): Prepare → Review (before → after) → Confirm → Authenticate → Receipt for a payment, Prepare → Review → Confirm → Receipt for Mark issued, Scope → Review → Authenticate → Result for Void; `FlowOutcome` draws the six outcomes. |
| `statementActionModel.js` | The flows' pure rules: `actionAvailability`, `paymentPreview` and `statusPreview` (before → after, unknown never 0), `actionBody` (reason, revision, key), `classifyOutcome` (settled, partial, applied, refused, stale, unknown) and `createActionRunner` (no double submit; a retry resends the same key). |
| `Subsidiaries.jsx` | Reporting health first, then the period's statement per licence; Not drawn and Not reported, never 0. |
| `BillingExceptions.jsx` | Open disputes and refunds, each with loading, unreadable and empty states; the host supplies the canonical five-step `RefundReviewFlow`. The retired direct refund form is removed. |
| `Promotions.jsx` | HQ saved, push accepted, explicit checkout read-back, issued, remaining and reporting; the scoped licence picker loads only when its editor opens. |
| `StatementActionHistory.jsx` | Lazy, permission-gated, paged action receipts for the opened statement; unreadable and no recorded actions remain distinct. |
| `PromotionReadback.jsx` | A manual branch check with a dated snapshot, reset when the selected ceiling changes. |

Tested by `frontend/test/hq_revenue_v2_5039.test.mjs` (the cockpit),
`frontend/test/hq_revenue_receivable_actions_5039.test.mjs` (the governed
actions), `frontend/test/hq_revenue_receivables_5083.test.mjs` (the mounted page: sections apart, no Draw, the drawer's edits) and the
older revenue tests, which read every file here through
`frontend/test/_revenuePage.mjs`; the Worker's `?period=` by
`cloudflare-worker/test/admin_revenue_period_5039.test.ts`; the actions and
the picker by `cloudflare-worker/test/statement_actions_5039.test.ts`.

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
  pure rules go in `revenueModel.js`, or in the part's own model file when
  they are a flow of their own (`statementActionModel.js`). Type is 12px or more.
- **An empty state is one operator line** (D5083): “No statements yet”, “No Q4 2026 statements yet”, “No billing exceptions”. The window and the reason stay on the figures' labels and in the coverage drawer.
- **No Draw action while D514 holds drawing**, and no edit on a receivable row: the edits open in its drawer (D5083).
- **A write that moves money is governed:** a reason, the revision read, a
  client idempotency key, the step-up, and an outcome that is never drawn as
  success unless the Worker said so. No `window.confirm`.
