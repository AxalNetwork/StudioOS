# pages/admin/fundAdmin — the fund administration console (D714)

`/admin/fund-admin` and its tab sub-paths (D1157: `/funds`, `/lps`, `/calls`,
`/distributions`, `/performance`, `/fees`, `/reports`, `/banking`,
`/banking/reconciliation`, `/banking/books`), behind `guard(['admin'])` and not `hqOnly(...)`: the Super
Admin and every Admin on HQ work here (#1779 decision 7). On a branch it shows
one sentence and makes no read.

| File | What it is |
| --- | --- |
| `FundAdminConsole.jsx` | The page: the two reads every tab shares (`fundAdminApi.access()` and `overview()`), the tab links and Banking's parts (D1157: each an address; a D714 `?tab=` link forwards there), `?fund=`, NAV & performance's read (`fundPerformanceApi.list`, drawn by `FundPerformanceView`), and the Not-read-here-yet card on Funds, LPs and Books. `FundAdminConsoleView` takes the user and the APIs, so its test stubs every read. |
| `OverviewTab.jsx` | Decision 9's overview, one group per block; a block whose store failed is Unreadable alone. |
| `BankingTabs.jsx` | Banking (#1834's `MercuryEntityConnections`, #1775's accounts and paged transactions, the payment-instructions link or sentence) and Reconciliation (#1775's matches, Confirm, Reject with a reason, a manual proposal). |
| `FundTabs.jsx` | Capital calls, Distributions, Management fees and Reports, each on one administered fund. The Calls tab's "Proof of funds shared by LPs" panel (D752) reads only on Show, because each read is audited and counts a view. |
| `MercuryEntitySheet.jsx` | D880 (#2553): Axal VC's own Mercury, the four entity connections (D710, D715), moved here from `pages/account/`. `MercuryEntityConnections` (the rows and their acts: the Super Admin connects, replaces and disconnects, any admin syncs; one audited read on mount, none on a branch) is drawn by this console's Banking tab; `MercuryEntitySheet` is opened by HQ's Bank accounts console. No member page imports it |
| `mercuryEntityModel.js` | D880 (#2553): the entity rows' words, pure: `ENTITY_KEYS` (Holdings, Management, GP, Fund), `entityRows`, `entityState`, `entityErrorWords`, the sheet's sentences and `retryAfterSentence`. The Overview tab reads its state and error words. `accountLine` stays in `../../account/mercuryModel.js`, which the investor's proof of funds also reads |
| `fundAdminModel.js` | The tabs and their addresses (`TABS`, `BANKING_PARTS`, `viewFrom`, `viewHref`, `legacyHref`; D1157), the console's own sentences, and the money and act-table helpers. |
| `useRead.js` | One read's `loading` / `ready` / `unreadable` state. |
| `parts.jsx` | The drawing parts, from the August canvas "Fund Administration": `Section`, `Panel`, `Line`, `Tiles` and `Table` (which stacks, each cell labelled, below `sm`). |

## Rules

- **The act table draws the controls.** Every Super Admin act sits in
  `FundActControl` (`../../../lib/fundActs.js`): an act the viewer may not take is
  its sentence, never a disabled button. A failed access read keeps the
  controls and says so; the Worker decides every act.
- **Reuse, never fork.** The call ledger (`/funds/calls`, `InvestorFundCalls.jsx`),
  the books (`/funds/ledger`, `FundLedgerPanel.jsx`) and a report period's pack
  (`FundReportPeriodPage.jsx`) are opened for the chosen fund, not copied.
- **Money is integer cents.** A value no store holds is Not recorded with its
  reason; a read that failed is Unreadable, never 0. Bank text is drawn as text.
- **Laid out to S1's brief** for "Fund Administration · Admin" (#1779,
  2026-10-18), in the August canvas's visual system, through `parts.jsx` and
  the theme's tokens, with no new CSS. A new tab draws with those parts; a
  dialog is the shared `Lightbox`. The owner's export landed on 2026-10-25
  (`design/incoming/Fund Admin Console Page.dc.html`, D1157): it wins where
  it differs, and no act moves across the table.
