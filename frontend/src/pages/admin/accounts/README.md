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
