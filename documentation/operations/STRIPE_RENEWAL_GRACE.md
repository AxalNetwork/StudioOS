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

The billing handler reads `invoice.subscription` and `invoice.payment_intent`,
which are the pre-Basil invoice shape (for example Stripe API `2024-06-20`).
The actual webhook destination API version is **UNVERIFIED**: it is configured
in Stripe, not pinned by `routes/billing.ts`. Its Stripe REST client also sends
no `Stripe-Version` header. The connector's separate version header is not
proof of the billing destination's version.

The owner must inspect the billing webhook destination's configured API
version in Stripe's Developers/Workbench event destinations and record that
version on #1008. If the endpoint uses Basil (`2025-03-31.basil`) or later,
verify/adapt the invoice relationship fields before changing or confirming the
payload contract. Do not guess a live endpoint version from a fixture.
