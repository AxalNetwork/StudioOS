# KYC & KYB (D1228, #2384)

The page at `/admin/kyc`, from the owner's canvas "KYC & KYB" (KYC1–KYC17).

| File | What it is |
|---|---|
| `kycModel.js` | The four tabs and their addresses, `viewOf`, `personHref`, the canvas's status words, and the words of every block no read carries yet |
| `KycTabs.jsx` | The live body under the header for People, Businesses, Renewals and Audit, and each person/business case |
| `peopleModel.js` | D1233: People's and the case's rules — the chips and their counts, the query the Worker reads, the figures, the checks, the screening (never clear unless the Worker says clear), HQ, what each status allows, the dialogs' words |
| `KycCase.jsx` | D1233: one person's case (`KycPersonCase`, `KycPersonView`), with its decision bar |
| `KycDialogs.jsx` | D1233: the decision dialogs (KYC5 A–D, F, G), Screen again and Assign |
| `KycViewer.jsx` | D1233: the document viewer inside the page, watermarked, with no download; D1234 passes a business's own loader (`fetchDoc`) |
| `businessModel.js` | D1234: Businesses' and a business's case's rules — kinds, statuses, the chips, the tiles, a row, the blocks, owners of 25% or more, what each case allows, Approve's body and what stops it, the request text, refusals |
| `KycBusinesses.jsx` | D1234: Businesses, the queue (KYC6, KYC17a); each legal name opens the case |
| `BusinessCase.jsx` | D1234: one business's case (`KycBusinessCase`, `KycBusinessView`), with its decision bar |
| `BusinessDialogs.jsx` | D1234: a business's decisions (KYC8 A, B, C, E) and Link to an account, each sending the case's review token |
| `governanceModel.js` | D1235: Renewals', Audit's, the periods' and the export's rules — the tiles (Not recorded, never 0, when a read did not count), the chart, the rows, the period changes, the audit window and filters, and who may export |
| `KycRenewals.jsx` | D1235: Renewals (KYC9) and how long a check lasts (KYC17c), editable only when the Worker says `can_change` |
| `KycAudit.jsx` | D1235: Audit (KYC10), with HQ's export (KYC17d) for a Super Admin at HQ and one sentence for anyone else (KYC14b) |
| `KycParts.jsx` | D1235: the tile, the unreadable block, the chips, the pager and the two-series columns that Renewals and Audit share |

The header and its tabs are `../ConsolePages.jsx` (`KycPage`). People is `../consoles/KycConsole.jsx`, the queue and its figures; it decides nothing, and each name opens the case, where every decision is.

**Adding to it:** a block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A new address goes in `TABS` and `viewOf` first, with its `<Route>` in `App.jsx` and a door the route-reachability guard can read. A change opens a dialog in the page that says what it changes; never a browser pop-up, and a document never opens in a new tab.
