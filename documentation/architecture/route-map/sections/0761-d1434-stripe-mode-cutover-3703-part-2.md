### D1434 — Stripe mode cutover (#3703, part 2)

`GET /api/admin/stripe/cutover` (Super Admin) returns the keys' `mode`, the `stored_mode` the saved Stripe records belong to (the last cutover's target, else `test`), `last_cutover`, and `would_clear: { customers, subscriptions, plans, mirror_rows, packs }`. A count that cannot be read is 503 `cutover_unreadable`, never 0.

`POST /api/admin/stripe/cutover` `{ to_mode, reason, confirm }` takes the Super Admin write bar (TOTP session, recent step-up), a 1–500 character reason and `confirm` equal to `to_mode`. Refusals, before anything changes: 400 `reason_required`, `invalid_mode`, `confirm_mismatch`; 503 `stripe_not_configured`; 409 `cutover_keys_not_live` while the secret key is in the other mode; 409 `cutover_already_done` when the stored records are already in `to_mode`. One D1 batch then:
- resets every plan paid through a sandbox subscription to free (founder tier, investor tier and its seat colleagues, account plans, MI Pro);
- clears the stored customer and subscription ids, the saved auto-reload cards, and open payment alerts;
- marks recorded subscription amounts canceled and empties the catalogue mirror;
- archives the token packs, whose prices belong to the old mode;
- writes one `stripe_mode_cutovers` row.

Both catalogue caches are dropped and the catalogue is synced in the new mode. Each member whose plan was reset gets one notice, linking to `/pricing`. The action is audited once as `stripe_mode_cutover`, which shows in HQ's payments change log under "Stripe mode". A sync that fails after the batch is 502 `cutover_sync_failed`, with the cutover kept.

Subscription events: when a plan is switched in the Stripe customer portal (Q2 = B), the subscription item's current price wins over the plan metadata stamped at checkout, if that price sells a plan of the same family.

AI credit top-ups: the custom amount's $1 price is read for the keys' mode, `STRIPE_PRICE_AI_TOPUP_UNIT_LIVE` under live keys and `STRIPE_PRICE_AI_TOPUP_UNIT` under test keys. A live key never quotes the sandbox price.
