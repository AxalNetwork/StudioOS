### Influencer commission on subscriptions (D4292, #4292)

No new route. `services/influencerCommission.ts` and migration `202611031345_influencer_subscription_commission.sql` add to the Stripe webhook (`POST /api/billing/stripe/webhook`) and the scheduled worker:

| Where | What it does |
| --- | --- |
| `invoice.paid` | An attributed member's paid software invoice (subscription metadata `referrer_user_id`, `handle`, `channel`; founder, investor, advisor or partner plan) earns the referrer the terms' `subscription_invoice` share of the amount paid less tax, once per invoice id, for the member's first 12 paid invoices. Written `pending`, `payable_at` 30 days after payment. Never stacked with a purchase commission. |
| `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` | Inside the hold: cancels the commission whole. After it: a refund reverses its share (`clawbackReferralCommissionForRefund`); a dispute closed `lost` reverses all of it. |
| `customer.subscription.deleted` | The member stops counting toward a milestone bonus. |
| Cron 05:30 UTC | Due `pending` commissions become `accrued` (payable); the terms' flat `influencer_bonus_10/25/50/100` triggers pay once each; 250 paid customers notifies HQ once. |
| `GET /api/network/commissions/me` | `by_currency[]` gains `held_cents`: pending, never in the balance a payout claims. |
