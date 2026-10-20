# AI token packs — runbook

D755 (#1870). A member's AI top-up balance is bought as token packs through
Stripe. It is kept apart from Perk credits and Introduction credits: nothing
converts between them.

Every movement of the balance is one row of the append-only
`ai_credit_ledger` (migration 486). For every member, the ledger's sum equals
`ai_topup_accounts.balance_microusd`; **Reconcile** lists anyone for whom it
does not. Amounts are micro-USD: $1 is 1,000,000.

Who does what:
- **The owner** holds the Stripe account, the keys, the webhook endpoint and
  its events (`documentation/architecture/PRODUCTION.md`, "AI token packs").
- **The Super Admin** creates, adopts, prices and archives packs, adjusts a
  member's balance, and reconciles, all on HQ › AI allowances
  (`/admin/platform/allowances`).
- **Only the verified Stripe webhook** credits a purchase, or takes one back.
  HQ never credits.

## Before the first sale

1. `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`
   are set on the Worker, all three in the same Stripe mode (live with live).
   A mismatch makes every pack read `not_ready` with reason `mode_mismatch`.
2. In Stripe › Developers › Webhooks, the endpoint
   `https://axal.vc/api/billing/stripe/webhook` sends:
   - `payment_intent.succeeded`, which credits a pack;
   - `charge.refunded`, `charge.dispute.created` and
     `charge.dispute.closed`, which take tokens back.
3. CR1, CR2 and CR3 are deployed (#1905, #1919, #1920). Migration 486 must
   appear in the deploy's migration step.

## Create a pack

1. HQ › AI allowances › Token packs › **New pack**.
2. Enter whole dollars from $5 to $500. The label is derived: "$25 of tokens".
3. Press **Create**. The Worker
   (`POST /api/admin/catalog/token-packs`) creates the Stripe product
   ("$N of tokens", metadata `kind=token_pack`, `decision=D755`,
   `seller=management`) and its one-time USD price, each with an
   Idempotency-Key, then the pack row. The pack starts **off sale**.
4. If Create fails, press it again with the same form. Stripe answers the
   repeated key with the same product and price, so a retry never makes two.
5. Check its line on the Token packs list, then switch **On sale**. A pack is
   offered to members only when it is on sale and its Stripe price, read from
   the catalog mirror, is active, one-time, USD and equal to its face value.
   Otherwise its line gives the reason: `off_sale`, `price_mismatch`,
   `product_mismatch`, `missing_from_catalog`, `inactive`, `not_one_time`,
   `not_usd` or `bad_amount`.

**Never create a pack, or edit its metadata, in the Stripe dashboard.** The
list of packs is D1's `ai_token_packs`, not Stripe metadata, and the generic
catalog writes refuse a pack (`token_pack_managed_on_hq`).

**The bonus.** A pack may carry a bonus of up to 10% of its face value
(`PATCH /api/admin/catalog/token-packs/:uid`, `bonus_usd`). It is credited as
its own `bonus` row. Keep every bonus at $0 while AI is billed at Cloudflare's
cost: a bonus is then a straight loss.

**An amount never changes.** A new amount is a new pack; archive the old one.

## Adopt an existing price

Use **Adopt a price** for a price made outside HQ, or for the
`STRIPE_PRICE_AI_TOPUP` fallback, whose line shows **Adopt**
(`POST /api/admin/catalog/token-packs/adopt`). The price must be one-time,
USD, active and whole dollars from $5 to $500. Once the fallback is adopted,
delete the `STRIPE_PRICE_AI_TOPUP` variable.

## Archive a pack

**Archive** (`POST /api/admin/catalog/token-packs/:uid/archive`) takes the pack
off sale first, then archives its Stripe price, then marks it archived. If
Stripe fails, the pack is already off sale; press Archive again. Purchases
already made are untouched, and an archived pack's price is still refused on
every direct payment route.

## How a purchase is credited

1. The member buys one pack, alone, at face value, with no promo code, through
   checkout (`POST /api/orders/intent`). The order is refused when:
   - it has another line or a quantity above 1 (`token_pack_alone`);
   - it carries a promo code (`promo_not_for_token_packs`);
   - the pack is not on sale (`token_pack_not_on_sale`);
   - the member has placed 5 pack orders in 24 hours (`token_pack_daily_limit`);
   - balance + uncredited packs + this pack would pass $1,000
     (`token_balance_ceiling`);
   - a dispute is open, or a shortfall was recorded in the last 90 days
     (`token_packs_on_hold`).
2. VAT, where it applies, is added on top and is never part of the tokens.
3. Stripe's `payment_intent.succeeded` webhook credits it once: a `purchase`
   row, a `bonus` row when the pack has one, the balance increase and an
   in-app notice, "Tokens added: $X". A repeated delivery changes nothing.

## An overdue credit

A purchase paid more than an hour ago and not credited is **overdue**. It shows
on the member's Usage page and in HQ's **Reconcile** list. The usual cause is a
webhook delivery that failed.

1. Open Reconcile (`GET /api/ai-budget/reconcile`). Each overdue line names
   the member and the PaymentIntent.
2. In Stripe › Developers › Events, find that PaymentIntent's
   `payment_intent.succeeded` event and press **Resend**.
3. Reconcile again. The line is gone once the webhook credits it.

**HQ never credits a purchase by hand.** Do not use an adjustment to stand in
for a missing credit: the resend would then credit it a second time.

## A refund

Refund in the Stripe dashboard, or through the admin refund route. The
`charge.refunded` webhook then takes the tokens back, under the owner's rule
of 2026-10-18 ("take back"):

- It takes the refunded share of the pack and its bonus,
  `ceil((credit + bonus) × amount refunded / amount paid)`, less what was
  already taken back. VAT is shared pro rata, so a full refund takes exactly
  the tokens.
- It takes at most the member's current balance. What was already spent is
  recorded on the row as `shortfall_microusd`. A shortfall holds the member's
  pack purchases for 90 days.
- A second partial refund is its own row, keyed on the cumulative amount
  refunded, so a resent event changes nothing.
- The member gets an in-app notice, for example "Refunded: $7.50 was taken off
  your top-up balance. $20.00 of these tokens had already been used."

## A dispute

- **Opened** (`charge.dispute.created`): the disputed share is taken back as a
  `dispute` row, by the same calculation, and the purchase's dispute is open.
  While it is open, the member cannot buy packs.
- **Won, or a warning closed** (`charge.dispute.closed`): a `dispute_won` row
  returns exactly what the dispute took, never its shortfall, and the hold
  lifts.
- **Lost**: nothing more moves. The dispute is closed and the hold lifts,
  unless a shortfall keeps it for 90 days.

A dispute event that arrives before its purchase was credited is answered with
an error, so Stripe retries it.

## Auto-reload (D794)

A member can turn on auto-reload on Billing: a pack, a threshold and a saved
card. When a settled run takes their token balance below the threshold, the
`ai_auto_reload` queue job charges the card off-session for that pack.

- **A reload is an ordinary pack order.** Its PaymentIntent carries
  `metadata[kind] = cart_order` and `metadata[auto_reload] = 1`. It is credited
  by `payment_intent.succeeded` as above, listed under the member's orders with
  its invoice, and refunded or disputed exactly as any pack.
- **The limits count it**: five orders a day, the $1,000 ceiling, the dispute
  and shortfall holds. A reload refused by one is recorded in the member's
  `member_ai_auto_reload.last_outcome`, and nothing is charged.
- **A card that fails turns auto-reload off** (`disabled_reason`:
  `card_declined`, `authentication_required`, `card_unusable`, or
  `pack_unavailable` for an archived pack) and tells the member once, in the
  app and by email. The member turns it back on after updating the card.
- **One crossing, one charge.** Stripe's idempotency key is
  `reload:<user>:<crossing>:<settings version>`. A retry of the same attempt
  returns the same payment.
- **Archiving a pack** turns off every member's auto-reload set to it, at their
  next reload, with a notice to choose another pack.
- **The job is safe to re-run.** Re-delivering `ai_auto_reload` for a member
  charges nothing while their last reload is pending.

## Adjust a member's balance

HQ › AI allowances › one member's AI account › **Adjust balance**
(`POST /api/ai-budget/members/:userId/adjustments`). Looking a member up is
logged.

- At most $100 either way per adjustment, and at most $250 added to one member
  in 30 days. A balance never goes below zero.
- A reason of 10 to 500 characters, which only HQ sees. The member's notice
  gives the amount, never the reason.
- One row per idempotency key: pressing the button twice records one
  adjustment.
- An adjustment is a cost: count bonus and adjustment rows as "tokens given",
  never as revenue.

Refusals answer `ai_adjustment_out_of_bounds`. A freshly recovered account is
paused from adjusting during the cool-off.

## Reconcile

`GET /api/ai-budget/reconcile` lists:
- **mismatched**: members whose balance differs from their ledger's sum. This
  should never happen. Report it with the member ID; do not adjust it away.
- **overdue**: see "An overdue credit".
- **open disputes**.

## The live check after a deploy

`scripts/check-ai-credits-live.mjs` runs read-only in the post-deploy smoke: it
reads `GET /api/public/plans-and-packs` and checks that `/plans-and-pricing`
serves the SPA shell. It never signs in, buys or calls Stripe. A route that is
not deployed yet is a warning, and a malformed answer fails the check.

**The owner's purchase-and-refund check (#1008 item 30),** once, after CR1, CR2
and CR3 are live:

1. On HQ, create a $10 pack with a $0 bonus, and put it on sale.
2. As a member, buy it with a real card from `/plans-and-pricing#token-packs`.
3. Check that the confirmation page, the rail and Usage › Top-ups say "Tokens
   added", and that the balance rose by $10.00.
4. Refund the payment in the Stripe dashboard.
5. Check that Usage › Top-ups shows the refund row, the balance went back down
   by $10.00, and the member got the notice.
6. Run Reconcile: no line for that member.
