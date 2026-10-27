# components/checkout — the checkout sheet

D1048 (#2451): the owner's "Checkout" canvas (PAYX1–PAYX21). One payment sheet
that opens in place, over the page the member is on, to buy a plan.

| File | What it is |
|---|---|
| `checkoutModel.js` | Pure functions: who may pay here (`sheetMode`), each interval's price with the `price_id` from the plans read, the Worker's yearly saving, and the "Included" lines. No React. |
| `CheckoutSheet.jsx` | The sheet: a modal dialog with the plan summary on the left and the payment on the right, on D1051's quote, start and status routes (D1053). Below `sm` (D1055, PAYX20) it is full screen with "‹ Back", the summary as one row with Details, and Pay held at the bottom; every target is 44px. |
| `PlanCardForm.jsx` | The card form (D1053): a Payment Element on a deferred intent, Apple Pay first, lazy-loaded with the sheet. It hands the sheet `submit()` and `confirm(clientSecret)`. `mode="payment"` takes a pack's one-time payment (D1287). |
| `packModel.js` | D1287: pack mode's pure rules — the pack rows and offers, the balance line, the totals, the one-line intent body, the pack rules' sentences, the landing after Pay, the count-up frames and auto-reload's words. |
| `PackSheet.jsx` | D1287: the sheet in pack mode, "Add tokens" (CRP2–CRP5, CRP7, CRP8, CRP15, CRP17), with its History tab. Opened by Models' Add tokens and each pack's Buy on `/pricing`. |
| `AddTokensHost.jsx` | D1288: the one Add tokens. Mounted beside `CheckoutHost` in `App.jsx`, it opens `PackSheet` over the page the member is on, on `openAddTokens` (`../../lib/aiTokens.js`) or a click on any link to `ADD_TOKENS_PATH`. It also holds `TokensRedirect`, which `App.jsx` puts round the old token addresses. |
| `stripeBridge.js` | Confirming without the card form (D1053): a saved card, and an upgrade's invoice. Loaded on Pay. |
| `checkoutEntry.js` | D1054: `openCheckout` (the one way any page opens the sheet), the plan an Upgrade or Change plan offers, the renewal banner's words, and Billing's cancel words. No React. |
| `CheckoutHost.jsx` | D1054: the one host of the sheet outside Pricing, mounted beside the paywall in `App.jsx`. It reads the plans, an Advisor's or Partner's plan status, and a Super Admin's test mode, only when a plan is asked for. |
| `RenewalBanner.jsx` | D1054 (PAYX10): the banner over the shell for a failed renewal, a payment to confirm, or a plan that ended, with its small payment sheet. |
| `RenewalPayForm.jsx` | D1054: the card form for that sheet, a Payment Element on the Worker's own intent. Lazy: Stripe loads on a press. |

The rule for adding here: a figure is one the Worker sent, never one worked out
in the browser. Nothing is made in Stripe until Pay: the card form is a
deferred intent, and `POST /api/billing/checkout/start` makes the
subscription (D1053). A decline is one of `checkoutModel.declineFamily`'s
five families of words, never a raw code, and every failure says whether
money moved. Pricing opens the sheet itself; every other entry point (the
paywall, Billing, Usage, Perks, any Upgrade) calls `openCheckout`, never a
page of its own and never Stripe's hosted checkout (D1054).

D1133 passes D1049’s Pricing plan read into the sheet: Reading and Unreadable with Try again cannot start a payment; a held account plan uses the existing change mode. D1051’s changed-field status contract was extended on #2902; D1053 draws it (Accepted, Scheduled, Failed).

D1167 fills the catalogue's storage fields. The existing Included line formats
those bytes in binary GB, matching the owner's storage table.
