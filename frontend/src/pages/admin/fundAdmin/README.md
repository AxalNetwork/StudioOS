# pages/admin/fundAdmin — the fund administration console (D714)

`/admin/fund-admin` and its tab sub-paths (D1157: `/funds`, `/lps`, `/calls`,
`/distributions`, `/performance`, `/fees`, `/reports`, `/banking`,
`/banking/reconciliation`, `/banking/books`), behind `guard(['admin'])` and not `hqOnly(...)`: the Super
Admin and every Admin on HQ work here (#1779 decision 7). On a branch it shows
the canvas's refusal (FND20a) and makes no read. Fund Ops is retired (D1160):
an admin's `/funds` and `/funds/performance` forward here.

| File | What it is |
| --- | --- |
| `FundAdminConsole.jsx` | The page: the two reads every tab shares (`fundAdminApi.access()` and `overview()`), the shared header (D1160, FND1/FND2: `AdminPageHeader` with the title, the profile pill, the act table's one primary, More, the line, the as-of chip, the moved notice, the tabs and their counts) and the fund filter kept as `?fund=`, Banking's parts (D1157: each an address; a D714 `?tab=` link forwards there), NAV & performance (`PerformanceTab`, D1164), the LPs tab (D1162), and the Not-read-here-yet card on Funds. `FundAdminConsoleView` takes the user and the APIs, so its test stubs every read. |

| `FundOpsRedirect.jsx` | D1160 (FND16): an admin's `/funds` and `/funds/performance` forward here with "Fund Ops is now Fund administration, under Fund admin.", the query and hash kept; it counts each forward under #2301's `ROLE_REDIRECTS`, since the same addresses are an investor's pages. |
| `Refusal.jsx` | D1160 (FND20): the centred refusals in the canvas's words — a branch admin, a support session, anyone who is not an admin — and `FundAdminBoundary`, the route guard's panel for `/admin/fund-admin`. |
| `OverviewTab.jsx` | Decision 9's overview, one group per block; a block whose store failed is Unreadable alone. |
| `BankingTabs.jsx` | Banking (#1834's `MercuryEntityConnections`, #1775's accounts and paged transactions, the payment-instructions link or sentence) and Reconciliation (#1775's matches, Confirm, Reject with a reason, a manual proposal). |
| `PerformanceTab.jsx` | D1164 (#3071, FND10–FND12): NAV & performance. For the fund `?fund=` names: the NAV line, the seven tiles (each missing one Not recorded with its reason), the quarterly charts (`QuarterLines`: a quarter with no NAV is a dashed bridge, never a dip to 0) and the positions chart (`PairBars`: a position with no mark is a dashed "No mark" bar, never its cost), each with View as table, and the positions table with Record a mark and Move to another fund (act `fund.valuation`, through `FundActControl`, each an in-page `Lightbox`). For All funds: Funds side by side. Each block reads alone. |
| `performanceModel.js` | D1164: NAV & performance, pure: `navTiles`, `quarterCharts`, `positionsChart`, `positionRows`, `sideBySide`, `checkMark` (a date not in the future, dollars to cents with 0 allowed, a source of 1 to 500 characters, before the call) and `moveOptions`. |
| `FundTabs.jsx` | Capital calls and Distributions on one administered fund, chosen in the header’s fund filter (D1160), plus compatibility exports of Fees and Reports from `FeesReportsTabs.jsx` (D1165). The Calls tab's "Proof of funds shared by LPs" panel (D752) reads only on Show, because each read is audited and counts a view. |

| `MercuryEntitySheet.jsx` | D880 (#2553): Axal VC's own Mercury, the four entity connections (D710, D715), moved here from `pages/account/`. `MercuryEntityConnections` (the rows and their acts: the Super Admin connects, replaces and disconnects, any admin syncs; one audited read on mount, none on a branch) is drawn by this console's Banking tab; `MercuryEntitySheet` is opened by HQ's Bank accounts console. No member page imports it |
| `mercuryEntityModel.js` | D880 (#2553): the entity rows' words, pure: `ENTITY_KEYS` (Holdings, Management, GP, Fund), `entityRows`, `entityState`, `entityErrorWords`, the sheet's sentences and `retryAfterSentence`. The Overview tab reads its state and error words. `accountLine` stays in `../../account/mercuryModel.js`, which the investor's proof of funds also reads |
| `LpsTab.jsx` | D1162 (FND5): every LP of every administered fund from `GET /api/fund-admin/lps` — the tiles, commitment by LP type (Not recorded a dashed outline), the table with its filters, search, sort and pages kept in the address, the row menu and Add LP. It mounts the drawer at `/lps/:id`. |
| `LpDrawer.jsx` | D1162 (FND6): one LP's drawer — Summary, Calls & receipts (Record receipt), Distributions, Notices (PDF), Booklet (Open is audited, Withdraw with a reason, the Super Admin sends to the General Partner) and the Contact log; each tab reads only when opened. |
| `LpDialogs.jsx` | D1162: Add LP (a first call through `FundActControl`), Set LP type and Log a contact, shared by the row menu and the drawer. |
| `lpsModel.js` | D1162: the LPs tab's words and arithmetic, pure: the roster query from the address, `cell` (never a zero for a missing value), the tiles, the type bars, Add LP's and Record receipt's bodies, the drawer's tabs and sentences. |
| `fundAdminModel.js` | The tabs and their addresses (`TABS`, `BANKING_PARTS`, `viewFrom`, `viewHref`, `legacyHref`; D1157), the header's rules (D1160: `headerPrimary`, `tabCounts`, `fundFilter`, `withFund`, `moreItems`, `fundsCsv`, `profilePill`, `fundOpsTarget`, `REFUSALS`), the console's own sentences, and the money and act-table helpers. |
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

## D1165 (#3072): remaining layouts and states

`FeesReportsTabs.jsx` owns Fees and the three Reports subpaths. `FundTabs.jsx`
keeps its exports compatible; new Fees/Reports layout work belongs in the new
file. Statements, pack figures and notice figures read on Open. Period editing
reuses the existing `FundReportPeriodPage` rather than another editor.
`BooksTab.jsx` mounts the injected ledger API only on Books and reuses
`FundLedgerView`; individual reconciliation facts never imply agreement with
Mercury. Keep Mercury stubbed in all tests.

`ReadFailure` supplies Unreadable and Try again per block. `useRead` generations
exclude stale responses. All nested console Lightboxes inherit the phone sheet
form; the global step-up opts in separately at the route boundary. See D1165
for what still needs the owner's live check and other parts' final content.
