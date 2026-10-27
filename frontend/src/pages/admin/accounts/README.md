# Accounts › Overview (D1304, #3401) and All accounts (D1305, #3402)

Admin › Accounts' Overview at `/admin/accounts`, from the owner's "Accounts" canvas (boards ACC1 and ACC8–ACC11). `../HeldAccounts.jsx` draws the header, the two tabs (`../accountsAddress.js`) and the four doors from the glance, and mounts the Overview between them.

| File | What it is |
|---|---|
| `overviewModel.js` | Pure: each block's state (ok, couldn't be read, not recorded), the four figures, the profile mix, a widget per profile with its eight weeks and facts, readiness by profile, newest accounts and needs attention in words |
| `allAccountsModel.js` | Pure (D1305): All accounts' state, the query it sends D1300's list read, the filter chips, saved views under D1303's keys, each row and ⋯ menu in the canvas's words, the bulk resend's and export's words |
| `AllAccounts.jsx` | The All accounts table (ACC2, ACC3, ACC12) that `../consoles/UsersConsole.jsx` mounts: chips, Views, search, Filters, Sort, Columns, the bulk bar and its two dialogs, each row's menu, paging, and the no-match, reading, trust-unreadable and failed states. The record and the row actions stay the console's |
| `AccountsOverview.jsx` | The Overview over D1301's `GET /api/admin/accounts/overview` (`lib/api/adminAccounts.js`): the blocks, View as table, loading, the empty studio and failures |

**Adding to it:** a figure comes from a read the Worker serves, never from the page; All accounts filters, sorts and counts on the server, never over the rows on screen. A block that failed says so with Try again, and one that nothing records says "Not recorded" with why; neither is ever a zero, and one failed block never blanks the page. Each person opens their record at `/admin/accounts/all/<id>` (`accountRecordHref`). Every class has its dark twin.
