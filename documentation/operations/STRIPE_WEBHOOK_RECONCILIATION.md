# Stripe webhook reconciliation (D8512)

Production has recorded no Stripe webhook receipt yet (#8512). From the
receipt table alone, "no event was expected" and "the path is broken" look
the same. This runbook says how to tell them apart with a read-only check.

## What the check compares

`GET /api/admin/stripe/reconciliation` (Super Admin,
`cloudflare-worker/src/services/stripeReconciliation.ts`) reads two sides
over the last 72 hours:

- **Stripe**: one `GET /v1/events` page (100 events) of the types the webhook
  destination subscribes to (`REQUIRED_EVENTS` in `routes/admin_stripe.ts`),
  with the key the Worker already holds.
- **This Worker**: the receipts in `stripe_webhook_events`, unfinished
  receipts of the current mode, and the subscriptions on record that Stripe
  would bill.

An event younger than 15 minutes may still be in flight and counts for
neither side.

| State | Meaning | What to do |
|---|---|---|
| `no_events_expected` | Stripe created no event and no paying subscription is on record. | Nothing. This is today's expected state. |
| `reconciled` | Every settled event has a finished receipt. | Nothing. |
| `delivery_failed_or_absent` | Stripe created an event no receipt holds. | In Stripe Workbench, check the destination's URL (`/api/billing/stripe/webhook`), mode, enabled events and recent deliveries. A signing secret from the other mode answers 400. |
| `accepted_state_missing` | A receipt was taken and never finished, so its entitlement, alert or ledger row is not known to exist. | Read the Worker log for `webhook_processing_failed`. Stripe retries a 503 for three days; a fix deployed in that time completes it. |
| `unreadable` | A side could not be read, or no key is set. | Never read this as clean. Fix the read first. |

The answer is the state, the window and counts. It never holds an event id, a
customer, a payload or a key. Do not paste any of those into an issue: the
repository is public.

`truncated: true` means Stripe had more than one page. The state then covers
the first 100 events only.

## The post-deploy smoke

`.github/workflows/post-deploy-smoke.yml` runs
`scripts/check-stripe-reconciliation.mjs` as a warning step. It always exits
0. A clean state prints a `✓` line; any other state, or no read, prints a
GitHub warning.

The smoke holds no secret, so today its line reads "not read". Giving it a
read credential is new access and the owner's decision (#8512). Until then an
operator can run the check by hand:

```sh
# A Super Admin session, from a signed-in HQ browser:
STRIPE_RECONCILIATION_HOST=https://axal.vc \
STRIPE_RECONCILIATION_COOKIE='<session cookie>' \
  node scripts/check-stripe-reconciliation.mjs
# Or the JSON the route answered, saved to a file:
node scripts/check-stripe-reconciliation.mjs reconciliation.json
```

The line fails no release. Making it fail waits for the owner to record the
state as known-good on #8512.

## Proving one delivery (owner)

Steps 1 and 2 of #8512 are the owner's: read the destination's settings in
Stripe Workbench, then send one signed test event that the handler ignores
safely. Afterwards the check should answer `reconciled`, and
`stripe_webhook_events` should hold one row with `handled_at` set.
