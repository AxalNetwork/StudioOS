# components/checkout — the checkout sheet

D1048 (#2451): the owner's "Checkout" canvas (PAYX1–PAYX21). One payment sheet
that opens in place, over the page the member is on, to buy a plan.

| File | What it is |
|---|---|
| `checkoutModel.js` | Pure functions: who may pay here (`sheetMode`), each interval's price with the `price_id` from the plans read, the Worker's yearly saving, and the "Included" lines. No React. |
| `CheckoutSheet.jsx` | The sheet: a modal dialog with the plan summary on the left and, once the member presses Continue, today's payment form (`../AxalCheckout.jsx`, lazy-loaded) on the right. |

The rule for adding here: a figure is one the Worker sent, never one worked out
in the browser, and the payment form mounts only on Continue, because
`POST /api/payments/intent` makes a subscription in Stripe. Pricing's Upgrade
opens the sheet today; every other entry point (the paywall, Billing, Usage)
opens the same sheet, never a page of its own.

D1133 passes D1049’s Pricing plan read into the sheet: Reading and Unreadable with Try again cannot start a payment; a held account plan uses the existing change mode. D1051’s changed-field status contract was extended on #2902; the status UI still belongs to D1053.

D1167 fills the catalogue's storage fields. The existing Included line formats
those bytes in binary GB, matching the owner's storage table.
