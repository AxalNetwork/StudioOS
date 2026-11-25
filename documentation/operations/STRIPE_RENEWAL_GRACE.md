# Stripe renewal retries and bounded access

D1100 (#2978) bounds a `past_due` plan's paid access to its stored period end
plus 21 days, inclusive. With no readable period end, grace is unavailable.
This is enforced by the Worker and does not rely on Stripe eventually changing
the status. Normal role bypasses and partner-grant expiry remain separate.

## Owner setup and live verification

In the Stripe Dashboard for the platform account:

1. Open **Billing → Subscriptions → Manage failed payments**.
2. Under **If all retries for a payment fail**, choose **Cancel the
   subscription** or **Mark the subscription as unpaid**. Do not leave the
   subscription indefinitely `past_due` after retries end.
3. Check the retry schedule against the 21-day application grace. A longer
   Stripe retry schedule does not extend application access.
4. In a Stripe test-mode renewal, verify access inside the window, at the
   inclusive cutoff, and after it; verify recovery to `active` restores the
   paid tier. Verify accepted investor seats carry the primary's period end.
5. Record the dashboard outcome on #1008. Do not paste customer records,
   tokens, card data or webhook payloads into the public issue.

The dashboard setting and live behavior remain **UNVERIFIED** until the owner
performs these steps. No production data or Stripe settings were accessed while
building this change.

## Webhook payload version

Two Stripe API versions decide whether renewals work (D8510, #8510):

- **The request version.** `stripeCall()` in `routes/billing.ts` sends
  `Stripe-Version` from the constant `STRIPE_API_VERSION`. The constant is
  **unset**, so no header is sent and every platform call runs on the
  account's default version, which a dashboard upgrade can change. Account
  default version: **UNVERIFIED** (owner to record on #8510).
- **The webhook destination's version.** It is configured in Stripe, not in
  the repository, and decides the shape of the events `/api/billing/webhook`
  receives. Destination version: **UNVERIFIED** (owner to record on #8510).

The renewal handlers (`invoice.paid`, `invoice.payment_failed`,
`invoice.payment_action_required`) read an invoice's subscription from both
shapes through `services/stripeInvoiceShape.ts`: `invoice.subscription`
(pre-Basil, for example `2024-06-20`) and
`invoice.parent.subscription_details.subscription` (Basil, `2025-03-31.basil`
and later). `test/stripe_api_version_8510.test.ts` runs each event in both
shapes through the real webhook. Before D8510 the Basil shape opened no alert,
sent no renewal notice and repaired no row left at `incomplete`.

Still pre-Basil only: the renewal **Pay** and **Confirm** actions read
`invoice.payment_intent` from an API response (`billingRecovery.ts`,
`billingAlerts.ts`). Basil removed that field, so setting
`STRIPE_API_VERSION` to a Basil version must move those reads in the same
change.

To record the values: in Stripe Workbench, read the account's default API
version and the API version of the event destination that points at
`/api/billing/webhook`, and post both strings on #8510 (version strings only,
never an endpoint id or key). Setting the constant is then a one-line change,
reviewed with the fixtures. Do not guess either version from a fixture.
