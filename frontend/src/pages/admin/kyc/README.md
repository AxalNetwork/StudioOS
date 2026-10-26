# KYC & KYB (D1228, #2384)

The page at `/admin/kyc`, from the owner's canvas "KYC & KYB" (KYC1–KYC17).

| File | What it is |
|---|---|
| `kycModel.js` | The four tabs and their addresses, `viewOf`, `personHref`, the canvas's status words, and the words of every block no read carries yet |
| `KycTabs.jsx` | The body under the header for each tab; Businesses, Renewals and Audit say Not read here yet |
| `peopleModel.js` | D1233: People's and the case's rules — the chips and their counts, the query the Worker reads, the figures, the checks, the screening (never clear unless the Worker says clear), HQ, what each status allows, the dialogs' words |
| `KycCase.jsx` | D1233: one person's case (`KycPersonCase`, `KycPersonView`), with its decision bar |
| `KycDialogs.jsx` | D1233: the decision dialogs (KYC5 A–D, F, G), Screen again and Assign |
| `KycViewer.jsx` | D1233: the document viewer inside the page, watermarked, with no download |

The header and its tabs are `../ConsolePages.jsx` (`KycPage`). People is `../consoles/KycConsole.jsx`, the queue and its figures; it decides nothing, and each name opens the case, where every decision is.

**Adding to it:** a block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A new address goes in `TABS` and `viewOf` first, with its `<Route>` in `App.jsx` and a door the route-reachability guard can read. A change opens a dialog in the page that says what it changes; never a browser pop-up, and a document never opens in a new tab.
