# Payments

D1008 (#2386): Payments at `/admin/platform/payments`, HQ only, built to the
owner's canvas (PAY1–PAY13, `design/incoming/Payments Page.dc.html`) under the
shared admin page header (D936). It sits under Platform; its tabs are
sub-paths: Catalogue, `/stripe` and `/log` (D1014). The Admin Console's `?tab=payments`
forwards here with `?moved=payments`, in `../LegacyContractsRedirect.jsx`.

- `Payments.jsx` — the page inside `AdminBoardFrame` (board H29, "Payments
  catalogue"): the header, its reads, and Catalogue's Needs you, tiles and
  grouped table (on a phone, cards that open the product as a sheet), New
  product, and the product sheet that opens a product's dialogs (D1013). The
  retired editor (`PaymentsPanel`) is gone; `?new=product` is the storefront's
  door to New product.
- `StripeConnection.jsx` — PAY5 (D1014): the account, the key, the webhook,
  deliveries per hour (the no-log hour dashed; a table on request and on a
  phone) and the mirror, with the doors to the Stripe dialogs (D1013).
- `ChangeLog.jsx` — PAY7 (D1014): the change log, its filters and pages, and
  the CSV export behind an in-page reason dialog.
- `ProductDialogs.jsx` — PAY3 and PAY4 (D1013): New product, Add a price,
  Change a price (part 2's route), Archive a price or a product, and Edit
  details.
- `StripeDialogs.jsx` — PAY6 (D1013): Replace key, Register a new endpoint,
  Add the missing events, and Sync from Stripe with its result or failure.
- `dialogModel.js` — pure. The plan levels (`/pricing`'s cards), the clash,
  amounts, the price preview with the allowance and saving, the reason rules,
  the key check, the sync's new and gone, and a refusal in words.
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
- Every write says what changes, where members see it and that it is
  recorded, and sends the admin's reason (D1009). A write that changes what
  members pay meets the step-up through the platform's own prompt
  (`StepUpModal`); cancelling it changes nothing.
- Only the Super Admin is drawn a change; anyone else is told who can make it.
