### AI credits and token packs Worker contract (D755, #1870)

D755 sells the AI top-up balance as token packs (`ai_token_packs`, migration 486) and records every movement of it in the append-only `ai_credit_ledger`. The routes below are Worker routes; the screens that draw them are CR4–CR8.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/ai-budget/top-up` | signed in | `state` (`unset`, `not_ready`, `ready`), `packs` on sale, `on_hold`, and `latest` (the last purchase in 24 hours: `waiting`, `overdue`, `credited`, `refunded` or `disputed`). D750's `configured` and `product` stay, deprecated. Never a reason. |
| `GET /api/ai-budget/prices` | signed in | D1278 (#3304): `{ version, operations }` from `METERING_POLICY`, in its order: each `{ operation, label, source ('axal', 'connector' or 'remote_mcp'), price_microusd, unit, ai }`. A free operation is a known 0; `ai: true` means its model run is charged at that run's own cost. |
| `GET /api/ai-budget/holds` | signed in | D1278: `{ holds }`, the caller's own pending and review holds, oldest first: `uid`, `created_at`, the stored `expires_at` (the Worker's five-minute rule), `status`, `included_microusd`, `topup_microusd`, and what took it (`surface`, `operation`, `api_key_uid`, `execution_id`, migration 632; NULL when not recorded). An expired pending hold is released first, never listed. |
| `GET /api/ai-budget/history?before=&limit=&runs=1` | signed in | The member's own ledger, newest first, paged on `(created_at, uid)`, with `pending` purchases on the first page. `runs=1` adds hold, release and spend. Never an adjustment's reason. |
| `GET /api/ai-budget/limit`, `PUT /api/ai-budget/limit` | signed in; `PUT` needs a recent sign-in (TOTP, stepped up) | D788: the member's own monthly AI spend limit. `GET` answers `limit_microusd` (null for none), this UTC month's `charged_microusd`, `share_used`, `resets_on`, `notify` and the plan's `allowance`. `PUT {monthly_limit_usd: number\|null, notify: {50, 80, 100}}`: `null` removes it; a negative amount, more than two decimals or more than $100,000 is 400 `invalid_spend_limit` with `field`. A run past the limit is refused at its hold: 402 `spend_limit`. D805 (#2243): `GET` also answers `pack_orders` (`today`, `per_day`, `window_hours`, `resets_at`): the member's token-pack orders in the rolling 24 hours, auto-reloads included, counted by `recentPackOrders`, the function the purchase check refuses with. D792 part 2 (#2270): that count is read on its own; when it cannot be read, `GET` still answers 200 with the limit and allowance, `pack_orders: null` and `pack_orders_reason: 'pack_orders_unreadable'`. A limit that cannot be read is 503 `ai_spend_limit_unreadable`. |
| `GET /api/ai-budget/top-up/status` | Super Admin | D750's single line, plus `packs`: one line per pack with its state, reason, the last six characters of its price ID, and `adoptable` for the `STRIPE_PRICE_AI_TOPUP` fallback. |
| `GET /api/ai-budget/members/:userId` | Super Admin | One member's allowance, balance, held top-up, ledger (with reasons), purchases and shortfalls. Each read is logged. |
| `POST /api/ai-budget/members/:userId/adjustments` | Super Admin | `{amount_usd, reason, idempotency_key}`: at most $100 either way, at most $250 added in 30 days, never below zero, a reason of 10–500 characters. In the D248 cool-off list. |
| `GET /api/ai-budget/reconcile` | Super Admin | Balances that differ from their ledger, purchases paid over an hour ago and not credited, and open disputes. It credits nothing. |
| `GET /api/ai-budget/auto-reload` | signed in, TOTP with a recent step-up | D794 (#2219): the member's auto-reload settings, and the saved card's brand and last four (only a card on their own Stripe customer). |
| `PUT /api/ai-budget/auto-reload` | signed in, TOTP with a recent step-up; 423 during a recovery cool-off | `{ enabled, pack_uid, threshold_usd, setup_intent_id? }`. A pack HQ sells and has not archived, on sale to turn it on; a threshold from $0 to $500 with two decimals at most; a card only from this member's completed auto-reload SetupIntent, read back from Stripe. Logged without the card. |
| `POST /api/ai-budget/auto-reload/setup` | as above | An off-session SetupIntent on the member's own Stripe customer for auto-reload; only its client secret is returned. |
| `GET /api/ai-budget/members/:userId/runs?month=` | HQ Admin or Super Admin | D776 PR 2 (#2093): one member's month by option within a page, with totals, and each run (newest first, at most 100) with its model, page, option, cost and charge. Each read is logged (`ai_member_runs_read`, the member's id and the month). |
| `POST /api/admin/catalog/token-packs` | Super Admin | `{amount_usd, idempotency_key}`: the Worker creates the product and its one-time USD price in Stripe with Idempotency-Keys, then the pack row, off sale. |
| `POST /api/admin/catalog/token-packs/adopt` | Super Admin | `{price_id}`: records an existing one-time USD price of whole dollars from $5 to $500. |
| `PATCH /api/admin/catalog/token-packs/:uid` | Super Admin | `on_sale`, `bonus_usd` (0–10% of face) and `sort`. The amount never changes. |
| `POST /api/admin/catalog/token-packs/:uid/archive` | Super Admin | Off sale for good, and the Stripe price archived. |
| `GET /api/public/plans-and-packs` | anyone | Every plan with its price and AI allowance, the packs on sale, `covers` and `resets`. D1 only, cached five minutes at the edge (D816), its own rate-limit bucket, no person named. D816 adds each plan's `monthly`, `yearly` and `yearly_saving_percent` (below). |

D806 (#2245): Billing's invoices and the card's address (`routes/billing.ts`, `services/billingInvoices.ts`).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/billing/invoices?page=1&per=25` | signed in | The member's own invoices in one list, newest first, then paged (`per` 1–100, default 25), with `page`, `per` and `total`. Each row is `{ kind: 'order'\|'stripe', id, date, description, amount_cents, currency, status, pdf_url }`; `status` is `paid`, `refunded`, `partly_refunded`, `open` or `void`. Orders are the paid ones in D1: "AI tokens, $25 pack", "AI tokens, auto-reload $25" (a line marked `origin: 'auto_reload'`), else the items' names; refunds are read for token packs only, from the ledger's refund rows; the PDF is `/api/orders/:ref/invoice`. Plan invoices are each Stripe customer the member has (founder, investor, read once if the same), at most 100 per customer: "[plan] · monthly", their credit notes, and Stripe's `invoice_pdf` passed through as an https URL. When Stripe cannot be read the orders still list, with `degraded: ['stripe']`. |
| `GET /api/billing/overview?scope=` | signed in | Unchanged but for D806: each of `payment_methods` carries `billing_address` (`line1`, `line2`, `city`, `postal_code`, `country`) from Stripe's `billing_details.address`, or `null` when Stripe holds none. |

A pack is bought only through `POST /api/orders/intent`, alone, at face value, with no promo code. `POST /api/payments/intent`, `/api/payments/alacarte/intent`, `/api/payments/promo/validate` and `/api/billing/subscription/swap/preview|confirm` answer 400 `token_pack_checkout_only` for a pack price, and the generic `/api/admin/catalog` writes answer 409 `token_pack_managed_on_hq`. `/api/admin/catalog` is in the cool-off prefixes.

The Stripe webhook (`POST /api/billing/stripe/webhook`) credits a pack only on `payment_intent.succeeded`, once, with its bonus. Three new events take tokens back (`services/aiCreditReversals.ts`): `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`. Each acts only on a token pack's charge.

Introduction packs retire with CR5 (#1915): `POST /api/payments/intro-credits/intent` answers 410 `intro_packs_retired`, and `GET /api/introductions/packs` answers `{packs: [], on_sale: false}`. Credits already bought still spend.

**`/plans-and-pricing` (CR5, #1915).** Every plan card shows its AI allowance from `GET /api/public/plans-and-packs` (PR 2, #2045), and the Token packs section (`#token-packs`) is CR7's (#1985). Since PR 3 the page opens without sign-in (D755 §13; `isPublicPath` lists it):
- a visitor sees the plan cards, built from the public read because `/api/catalog/products` needs a session, and the Token packs with Sign in to buy (`/login?next=%2Fplans-and-pricing%23token-packs`);
- Subscribe and Preview go to `/login?next=%2Fplans-and-pricing`;
- the promo box, the cart, the add-ons, active licences, the product modal, the admin tools and the phone's account bar are not drawn for a visitor, and their reads are not made;
- `/plans-and-pricing/:productId` (retired D2319), `/checkout` and `/checkout/confirmation` still need sign-in;
- `/products` (retired D2319) redirects with its query and hash, so `/products#token-packs` (retired D2319) lands on the packs.

The `/pricing` page (D786 part 2) takes every card's price from the same read; a plan the read does not sell says "Not offered yet". A visitor reads it in the public site's frame, a member inside the app's top bar and left sidebar. The door pages' tokens block links to `/pricing/products#token-packs`.

