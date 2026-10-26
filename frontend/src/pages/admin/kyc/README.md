# KYC & KYB (D1228, #2384)

The page at `/admin/kyc`, from the owner's canvas "KYC & KYB" (KYC1–KYC17).

| File | What it is |
|---|---|
| `kycModel.js` | The four tabs and their addresses, `viewOf`, `personHref`, the canvas's status words, a person's facts, and the words of every block no read carries yet |
| `KycTabs.jsx` | The body under the header for each tab, and one person's case (`KycPersonCase`, `KycPersonView`) |

The header and its tabs are `../ConsolePages.jsx` (`KycPage`). People keeps D648's queue, `../consoles/KycConsole.jsx`, whose Review still approves and rejects.

**Adding to it:** a block with no read says "Not read here yet" with its reason from `WAITS`, never a zero. A new address goes in `TABS` and `viewOf` first, with its `<Route>` in `App.jsx` and a door the route-reachability guard can read.
