# Payments — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`c661bdbb4e` by S21 for #2386, before D1008 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`.

The canvas is `design/incoming/Payments Page.dc.html`, boards PAY1–PAY13 (with
PAY2c, PAY3a–d, PAY4a–c, PAY6a–f, PAY8a–b, PAY10b and PAY12a–d). #2386's body
maps the page as it was on `537f646a3f`; this map re-checks what D1008 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| PAY1 header | crumb, one h1, HQ only, moved notice, tabs | the Admin Console's h1 and dropdown; `?tab=payments` open to any admin (`fe/pages/AdminPage.jsx`) | D936's header behind `hqOnly`; the tab forwards (D1008) |
| PAY1 Needs you | keys, webhook, catalogue checks | `GET /api/admin/stripe/webhook` (`missing_events` against `REQUIRED_EVENTS`, fixed by #2393); the key's mode on the Platform summary; no catalogue checks | keys and webhook drawn (D1008); checks part 2 |
| PAY1 tiles | mode and keys, products, last sync, webhook 24h | `GET /api/admin/stripe/config`; `GET /api/admin/catalog/products`; `GET /api/admin/platform/summary` → `payments_catalog` | drawn (D1008) |
| PAY1 table | grouped products, prices, allowance, shows on, audience, status | the catalogue read: kind, prices, categories, active; `planOf` and the allowance are Worker logic (`wk/services/aiCredits.ts`) | product, kind, prices, audience, status drawn (D1008); shows on and allowance part 2 |
| PAY2 | the product lightbox | the same read; members per plan need the price ID stored (`member_subscription_amounts`) | parts 2, 4 |
| PAY3, PAY4, PAY6 | dialogs and the step-up | the catalogue and Stripe writes (`wk/routes/catalog.ts`, `wk/routes/admin_stripe.ts`), `requireAdmin` except register; `confirm()` in `PaymentsConsole.jsx` | today's editor kept on request (D1008); gates part 1; dialogs part 5 |
| PAY5 | account, key, webhook, deliveries, mirror | the config, webhook and summary reads; no hourly buckets | drawn (D1008); hourly part 3 |
| PAY7 | change log | audit rows exist; nothing reads them back; failed syncs leave no record | parts 3, 6 |
| PAY8–PAY13 | empty, loading, errors, no permission, phone, dark | each block's own states; `hqOnly` | parts 4, 6 |

## B. What D1008 rests on, re-checked at HEAD

- **The Worker gates are `requireAdmin`** on every catalogue route, the config
  read and write, and the events update; `register` alone takes
  `requireSuperAdminWriteBar`. Part 1 changes them.
- **The Platform summary is `requireSuperAdmin`** and carries the publishable
  key's own mode (`publishableKeyMode`), so it can be compared with the
  account's mode (`stripeMode`) from the config read.
- **`REQUIRED_EVENTS` now lists the refund and dispute events** (#2393), so the
  webhook read's `missing_events` is what the handler acts on.
- **A price's `interval_count` is not checked at checkout** (`wk/services/catalog.ts`),
  so a quarterly price is drawn as "every 3 months" here and flagged by part 2.
