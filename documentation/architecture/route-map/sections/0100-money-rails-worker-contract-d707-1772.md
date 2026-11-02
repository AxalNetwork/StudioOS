### Money rails Worker contract (D707, #1772)

`GET /api/admin/money-rails` (`admin_money_rails.ts`, admin only) answers `{ entities, kinds, stripe }`:
- `entities`: each Axal entity's key, name and role (`services/moneyRails.ts`'s `ENTITY_ROLES`);
- `kinds`: the eleven `MONEY_KINDS` rows, each with its payer, payee, rail and group;
- `stripe`: `{ account_holder: 'management', mode }`, where `mode` is `stripeMode`'s `test`, `live` or `unconfigured`.

It answers no key and no account number. `stripeCall` refuses a Stripe create with no money kind, or with a fund or intercompany kind, before any request leaves the Worker. `POST /api/payments/intent` refuses a body with no `price_id` (`money_kind_required`). Neither has a frontend method.

