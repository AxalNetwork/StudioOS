# Checkout — the canvas against the code, 2026-10-25

S21's map for D1048 (#2451). It reads the owner's "Checkout" canvas against `origin/main` at `9e6ee1c20c`. The canvas has boards PAYX1–PAYX21 with lettered boards, in `design/incoming/Checkout Page.dc.html` and `Checkout · Boards.dc.html`. It is true as of that date: re-check the code before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2451 called broken, re-checked

| # | #2451's finding | Today | Where |
|---|---|---|---|
| 1 | A plan bought from `/pricing` may never be granted | **Fixed** (D892, #2453): the intent stamps the plan's metadata, and the webhook falls back to the price's product | `wk/services/planSubscription.ts` |
| 2 | Upgrading starts a second subscription | **Fixed** (D892): 409 `subscription_exists`, with the swap route | `wk/routes/payments.ts` |
| 3 | Typed prices disagree with the owner | **Open**: `$149` and `$599` in the paywall, `$29`, `$99`, `$149/mo` and `$599/mo` on Billing | `fe/components/PaywallModal.jsx` ~60, ~75; `fe/pages/SettingsPage.jsx` ~4673, ~4682, ~5158 |
| 4 | A paying Advisor or Operating Partner is marked "Current plan" on Basic | **Open** | `fe/lib/pricingModel.js` ~125-126 |
| 5 | A failed renewal cuts access and says nothing | **Half**: D892 sends a notice per failed renewal attempt; access still ends at `past_due` (owner question 4) | `wk/routes/billing.ts` ~1989; `wk/middleware/requireTier.ts` |
| 6 | Step-up is uneven | **Open** (owner question 8) | `wk/routes/billing.ts`; `wk/routes/payments.ts` |
| 7 | The paywall uses `alert()` | **Open** | `fe/components/PaywallModal.jsx` ~152 |
| 8 | Investor Plus cannot be sold | **Open by decision** (owner question 5) | D786 |
| 9 | The webhook event list misses events | `invoice.payment_failed` is listed; `invoice.payment_action_required` is not | `wk/routes/admin_stripe.ts` ~50 |

## 2. The reads on `main`

| Read | Shape | Boards |
|---|---|---|
| `GET /api/public/plans-and-packs` | Per plan: `family`, `licence_key`, `product_id`, `plan_name`, `prices[]` (with `price_id`, `unit_amount`, `currency`, `interval`, `allowance_microusd`), `monthly` and `yearly` without an id, `yearly_saving_percent`. No storage. | PAYX1–PAYX3, PAYX13, PAYX14 |
| `POST /api/payments/intent` | A client secret for the Payment Element, or `{ free: true }`. It is made when called, so only on Continue. | PAYX2, PAYX6 |
| `POST /api/payments/promo/validate` | The promo preview, with its reasons in words | PAYX5 |
| `GET /api/payments/methods` | Saved cards | PAYX3 (not drawn yet) |
| `/api/billing/subscription/swap/preview`, `/swap/confirm` | Proration and step-up | PAYX4 (not drawn yet) |

Not read anywhere yet:
- a quote with tax and the amount due today;
- the plan's status after payment;
- storage per plan;
- what changed on the plan;
- the renewal alerts;
- the test-mode flag in the sheet.

## 3. Board by board

| Board | Drawn by D1048 | Waits for |
|---|---|---|
| PAYX1 Pricing | Upgrade and "Get …" open the sheet in place; no second pricing page | — |
| PAYX2 New plan | Plan pill, name, tagline, interval switch with the saving, price, Included (AI allowance; storage "not read"), subtotal; Continue into today's Payment Element with promo; the secure and seller lines | the quote's tax, discount and due today (part 3); the decline map (part 5) |
| PAYX3 Yearly, saved card | Yearly price; saved cards not drawn | parts 3, 5 |
| PAYX4 Change plan | "You already pay for a plan in this group" with Billing | parts 3, 5 |
| PAYX5 Promo | Today's field inside the payment form | part 5 |
| PAYX6 Processing, 3-D Secure | Today's form, inline | part 5 |
| PAYX7, PAYX8 Accepted, Activating | "Payment received" and the activating line | the status route (part 3), the designed states (part 5) |
| PAYX9 Refused | Today's form shows Stripe's or the server's message | the decline map (part 5) |
| PAYX10 Renewal failed | — | parts 4, 6 |
| PAYX11, PAYX12 Billing, paywall, Usage | — | part 6 |
| PAYX13–PAYX16 Investor, Advisor, Partner, Explorer, staff | The same sheet per family; Explorer, staff and another profile's plan say why | Investor Plus (owner question 5); the "Current plan" fix (part 1) |
| PAYX17–PAYX19 Loading, error, no permission | "Loading payment form…", the unsellable line | part 5 |
| PAYX20 phone, PAYX21 dark | The sheet is full screen below 640px | part 7 |
