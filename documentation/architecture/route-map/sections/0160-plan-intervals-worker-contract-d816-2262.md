### Plan intervals Worker contract (D816, #2262)

Every paid plan sells monthly or yearly (the owner, 2026-10-20: the yearly price is 15% off; existing yearly subscribers keep theirs). The prices live in the Stripe catalogue, made from HQ's catalogue console; these routes sell and show them. No migration.

| Route | Who | What it answers |
| --- | --- | --- |
| `POST /api/billing/tier/checkout` | signed in (founder) | `{ tier, interval? }`. `interval` is `month` or `year`; absent is `month`; anything else is 400 `invalid_interval`. The price is the catalogue's for that tier at that interval. None: 502 `catalog_price_missing` with `interval`. |
| `POST /api/billing/investor/checkout` | investor, TOTP with a recent step-up | `{ plan, interval? }`. An `interval` chooses the price over the plan key's own; absent, the key's stands. The plan Stripe records (`subscription_data[metadata][plan]`) is the one sold. None: 502 `catalog_price_missing` with `interval`. |
| `POST /api/billing/plan/checkout` | signed in (advisor, partner) | Unchanged, but for `interval` on its `catalog_price_missing`. |
| `GET /api/billing/tier/status`, `/investor/status`, `/plan/status` | signed in | Each adds `interval`: how often the held plan is charged (`month` or `year`), from the charge the webhook recorded (`member_subscription_amounts`, migration 505); null when none is recorded or the subscription is canceled. |
| `GET /api/public/plans-and-packs` | anyone | Each plan adds `monthly` and `yearly` (`{ unit_amount, currency, allowance_microusd }` or null) and `yearly_saving_percent`, computed from the two (1 − yearly ÷ 12 × monthly, a whole percent), null without both or without a saving. Active prices of active products only. |

