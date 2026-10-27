# Accounts — the account drawer

D1306 (#3403, #2377 Accounts part 7): one account's record over All accounts
(`../consoles/UsersConsole.jsx`'s `UserDetailModal`) — its tabs, and the
in-page dialog every account change opens (ACC4–ACC7, ACC13). The list, the
tiles and the record's address stay where D1299 put them.

- `accountDrawerModel.js` — pure. The profile names (`partner` reads
  "Operating Partner") and the picker's choices, the drawer's tabs, the
  support session's length (held to `cloudflare-worker/src/routes/auth.ts`'s
  constants by its test), every change's dialog (`accountDialog`), the
  refusal sentences, and the lines the Profile, Sub-accounts and Notes tabs
  draw.
- `AccountDialog.jsx` — the one in-page dialog for a change: what it does,
  who is told, a reason where the Worker wants one, and a refusal kept inside
  the dialog in one sentence. It closes only when the change answered.
- `AccountSubAccounts.jsx` — the Sub-accounts tab: the Product tester record
  and the LP status from D1302's `GET /api/admin/sub-accounts/accounts/:userId`.
  Read only; each decision is linked to the page that makes it.

## Rules

- No change uses `window.confirm`, `window.prompt` or `alert`; the D1306
  test greps this folder and the console for them.
- A read that fails says so with Try again; it is never drawn as "none" or 0.
- An administrator's record is the Super Admin's (D133): the drawer says so
  in one panel, and draws no controls the Worker would refuse.
# Accounts › Overview (D1304, #3401)

Admin › Accounts' Overview at `/admin/accounts`, from the owner's "Accounts" canvas (boards ACC1 and ACC8–ACC11). `../HeldAccounts.jsx` draws the header, the two tabs (`../accountsAddress.js`) and the four doors from the glance, and mounts the Overview between them.

| File | What it is |
|---|---|
| `overviewModel.js` | Pure: each block's state (ok, couldn't be read, not recorded), the four figures, the profile mix, a widget per profile with its eight weeks and facts, readiness by profile, newest accounts and needs attention in words |
| `AccountsOverview.jsx` | The Overview over D1301's `GET /api/admin/accounts/overview` (`lib/api/adminAccounts.js`): the blocks, View as table, loading, the empty studio and failures |

**Adding to it:** a figure comes from a read the Worker serves, never from the page. A block that failed says so with Try again, and one that nothing records says "Not recorded" with why; neither is ever a zero, and one failed block never blanks the page. Each person opens their record at `/admin/accounts/all/<id>` (`accountRecordHref`). Every class has its dark twin.
