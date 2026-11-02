### Payments change log and webhook hours Worker contract (D1011, #2830)

Super Admin only, at `/api/admin/payments` (`routes/admin_payments.ts`); the client is `lib/api/payments.js`. Rows come from the audit rows the catalogue and Stripe settings already write (`services/paymentsChangeLog.ts`). A database that does not answer is a 503 with a sentence.

| Route | Who | What |
| --- | --- | --- |
| `GET /api/admin/payments/change-log` | Super Admin | PAY7: the changes, newest first. `what`, `who`, `product`, `from`, `to`, `limit`, `offset`. |
| `GET /api/admin/payments/change-log.csv` | Super Admin | The same rows as a CSV. `reason` (10 to 500 characters) is recorded first; no record, no file. |
| `GET /api/admin/payments/webhook-deliveries` | Super Admin | PAY5: 24-hour totals and 24 hourly buckets. An hour with no request log is null, never 0. HQ · Platform's P3 reads the same block (`services/stripeWebhookDeliveries.ts`). |

`POST /api/admin/catalog/sync` now records a failure as `catalog_sync_failed`, with who started it and Stripe's status and code (PAY6 C).

