# pages/admin/fundAdmin — the fund administration console (D714)

`/admin/fund-admin`, behind `guard(['admin'])` and not `hqOnly(...)`: the Super
Admin and every Admin on HQ work here (#1779 decision 7). On a branch it shows
one sentence and makes no read.

| File | What it is |
| --- | --- |
| `FundAdminConsole.jsx` | The page: the two reads every tab shares (`fundAdminApi.access()` and `overview()`), the `?tab=` bar and `?fund=`. `FundAdminConsoleView` takes the user and the APIs, so its test stubs every read. |
| `OverviewTab.jsx` | Decision 9's overview, one group per block; a block whose store failed is Unreadable alone. |
| `BankingTabs.jsx` | Banking (#1834's `MercuryEntityConnections`, #1775's accounts and paged transactions, the payment-instructions link or sentence) and Reconciliation (#1775's matches, Confirm, Reject with a reason, a manual proposal). |
| `FundTabs.jsx` | Capital calls, Distributions, Management fees and Reports, each on one administered fund. |
| `fundAdminModel.js` | The tab order, the console's own sentences, and the money and act-table helpers. |
| `useRead.js` | One read's `loading` / `ready` / `unreadable` state. |

## Rules

- **The act table draws the controls.** Every Super Admin act sits in
  `FundActControl` (`lib/fundActs.js`): an act the viewer may not take is
  its sentence, never a disabled button. A failed access read keeps the
  controls and says so; the Worker decides every act.
- **Reuse, never fork.** The call ledger (`/funds/calls`, `InvestorFundCalls.jsx`),
  the books (`/funds/ledger`, `FundLedgerPanel.jsx`) and a report period's pack
  (`FundReportPeriodPage.jsx`) are opened for the chosen fund, not copied.
- **Money is integer cents.** A value no store holds is Not recorded with its
  reason; a read that failed is Unreadable, never 0. Bank text is drawn as text.
- **No canvas covers it yet.** It is drawn only from the Connectors sheet's and
  the Account center's parts, with no new CSS. The canvas PR lays it out.
