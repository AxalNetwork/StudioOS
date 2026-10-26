# components/checkout — the checkout sheet

D1048 (#2451): the owner's "Checkout" canvas (PAYX1–PAYX21). One payment sheet
that opens in place, over the page the member is on, to buy a plan.

| File | What it is |
|---|---|
| `checkoutModel.js` | Pure functions: who may pay here (`sheetMode`), each interval's price with the `price_id` from the plans read, the Worker's yearly saving, and the "Included" lines. No React. |
| `CheckoutSheet.jsx` | The sheet: a modal dialog with the plan summary on the left and the payment on the right, on D1051's quote, start and status routes (D1053). |
| `PlanCardForm.jsx` | The card form (D1053): a Payment Element on a deferred intent, Apple Pay first, lazy-loaded with the sheet. It hands the sheet `submit()` and `confirm(clientSecret)`. |
| `stripeBridge.js` | Confirming without the card form (D1053): a saved card, and an upgrade's invoice. Loaded on Pay. |

The rule for adding here: a figure is one the Worker sent, never one worked out
in the browser. Nothing is made in Stripe until Pay: the card form is a
deferred intent, and `POST /api/billing/checkout/start` makes the
subscription (D1053). A decline is one of `checkoutModel.declineFamily`'s
five families of words, never a raw code, and every failure says whether
money moved. Pricing's Upgrade
opens the sheet today; every other entry point (the paywall, Billing, Usage)
opens the same sheet, never a page of its own.

D1133 passes D1049’s Pricing plan read into the sheet: Reading and Unreadable with Try again cannot start a payment; a held account plan uses the existing change mode. D1051’s changed-field status contract was extended on #2902; D1053 draws it (Accepted, Scheduled, Failed).

D1167 fills the catalogue's storage fields. The existing Included line formats
those bytes in binary GB, matching the owner's storage table.
