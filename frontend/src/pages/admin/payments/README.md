# Payments

D1008 (#2386): Payments at `/admin/platform/payments`, HQ only, built to the
owner's canvas (PAY1–PAY13, `design/incoming/Payments Page.dc.html`) under the
shared admin page header (D936). It sits under Platform; its tabs are
sub-paths: Catalogue, `/stripe` and `/log` (D1014). The Admin Console's `?tab=payments`
forwards here with `?moved=payments`, in `../LegacyContractsRedirect.jsx`.

- `Payments.jsx` — the page inside `AdminBoardFrame` (board H29, "Payments
  catalogue"): the header, its reads, and Catalogue: Needs you from part 2's
  checks, the tiles, and the table with every column, Filters, Sort, a pager
  and archived products in their own group (on a phone, cards that open the
  product's address); PAY8–PAY10's states (D1012). Today's editor
  (`../consoles/PaymentsConsole.jsx`) opens on request at the foot of
  Catalogue until D1008 part 5.
- `ProductLightbox.jsx` — PAY2 (D1012): one product as a lightbox over
  Catalogue, at `/admin/platform/payments/products/[id]` (a bottom sheet on a
  phone). Where members see it, its prices, the members on the plan, the
  promo codes that apply, its checks, its recent changes and Technical
  details. It reads members (plans only), promo codes and the product's
  change log when open, each answering alone.
- `StripeConnection.jsx` — PAY5 (D1014): the account, the key, the webhook,
  deliveries per hour (the no-log hour dashed; a table on request and on a
  phone) and the mirror. Part 5's three buttons are drawn disabled until its
  dialogs exist (#2832).
- `ChangeLog.jsx` — PAY7 (D1014): the change log, its filters and pages, and
  the CSV export behind an in-page reason dialog.
- `payUi.jsx` — the shared classes (each with its dark colour, PAY13), the
  read states, `PayDialog` (a bottom sheet on a phone, PAY12) and Technical
  details.
- `payModel.js` — pure. The addresses and tabs, the moved sentence, the words
  for kinds, modes and prices, the groups and counts, keys match and Needs you,
  the hourly deliveries, and the change log's words, ranges and reason rule.

## Rules

- Each read answers alone; a failed one is said, never drawn as
  "not set up" or as a match.
- Amounts are shown in their own currency and never added across currencies.
- The page never shows or takes a secret key.
- Token packs are read only here; they are managed on Platform › AI allowances.
- Each tab is a literal `HeaderTab`, so the reachability walk finds its door.
- An hour the request log is silent on is "no log", never 0; an unread
  change log is never drawn as an empty one.
- Codes (actions, IDs, raw details) only under Technical details.
- Every dialog is in-page; nothing uses a browser pop-up.
