# Accounts › Overview (D1304, #3401)

Admin › Accounts' Overview at `/admin/accounts`, from the owner's "Accounts" canvas (boards ACC1 and ACC8–ACC11). `../HeldAccounts.jsx` draws the header, the two tabs (`../accountsAddress.js`) and the four doors from the glance, and mounts the Overview between them.

| File | What it is |
|---|---|
| `overviewModel.js` | Pure: each block's state (ok, couldn't be read, not recorded), the four figures, the profile mix, a widget per profile with its eight weeks and facts, readiness by profile, newest accounts and needs attention in words |
| `AccountsOverview.jsx` | The Overview over D1301's `GET /api/admin/accounts/overview` (`lib/api/adminAccounts.js`): the blocks, View as table, loading, the empty studio and failures |

**Adding to it:** a figure comes from a read the Worker serves, never from the page. A block that failed says so with Try again, and one that nothing records says "Not recorded" with why; neither is ever a zero, and one failed block never blanks the page. Each person opens their record at `/admin/accounts/all/<id>` (`accountRecordHref`). Every class has its dark twin.
