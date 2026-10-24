# Payments

D1008 (#2386): Payments at `/admin/platform/payments`, HQ only, built to the
owner's canvas (PAY1–PAY13, `design/incoming/Payments Page.dc.html`) under the
shared admin page header (D936). It sits under Platform; its tabs are
sub-paths: Catalogue and `/stripe`. The Admin Console's `?tab=payments`
forwards here with `?moved=payments`, in `../LegacyContractsRedirect.jsx`.

- `Payments.jsx` — the page inside `AdminBoardFrame` (board H29, "Payments
  catalogue"): the header, Catalogue's Needs you, tiles and grouped table, and
  Stripe connection's account, key, webhook, deliveries and mirror. Today's
  editor (`../consoles/PaymentsConsole.jsx`) opens on request at the foot of
  Catalogue until D1008 parts 4 to 6.
- `payModel.js` — pure. The addresses and tabs, the moved sentence, the words
  for kinds, modes and prices, the groups and counts, keys match and Needs you.

## Rules

- Each of the four reads answers alone; a failed one is said, never drawn as
  "not set up" or as a match.
- Amounts are shown in their own currency and never added across currencies.
- The page never shows or takes a secret key.
- Token packs are read only here; they are managed on Platform › AI allowances.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
