### D1433 — Stripe mode safety (#3703, part 1)

`POST /api/billing/checkout/quote`, `/checkout/start` and the legacy `/tier/checkout`, `/investor/checkout`, `/plan/checkout` require matching secret/public key modes, a signing secret and the selected current-mode interval price before any Stripe call. Unready configuration or price returns 409 `checkout_not_ready`, with the top-level `reason` and “This plan can't be bought just now. Nothing was charged.” `POST /api/orders/intent` applies the same key readiness before pricing a token pack.

`GET /api/public/plans-and-packs` reads only current-mode mirror rows and includes every sellable plan with `checkout: { monthly: 'ready'|'not_ready', yearly: 'ready'|'not_ready' }`. No private refusal reason is returned. `GET /api/admin/catalog/products` adds `sellable_plan_unpriced`, `pack_not_ready` and signing-secret checks. Catalogue caches are mode-scoped; unknown-mode rows cannot be sold.

`POST /api/billing/stripe/webhook` verifies the signature and its 300-second timestamp tolerance before D1. Authenticated event ids are recorded in migration 691's receipt table. Completed duplicates acknowledge without dispatch; wrong-mode events acknowledge without dispatch; concurrent unfinished delivery gets 409 and a failed handler gets 503 so Stripe can retry. Only a successful handler completes its owned receipt. Both existing customer portal sessions return to `/account/billing`. D1434's owner-run cutover and S12's screens are separate.

