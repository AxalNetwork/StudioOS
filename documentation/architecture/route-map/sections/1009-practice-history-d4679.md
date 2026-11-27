## Practice › Earnings and billing history (D4679, #4679)

The Worker side is `routes/advisors.ts` and `services/advisorConnect.ts`; no migration. The screen is Practice › Earnings (`pages/advisor/practice/EarningsZone.jsx`).

| Route | Who | What it answers |
| --- | --- | --- |
| `PATCH /api/advisors/me/bookings/:id/billing` (changed) | the booking's advisor | A status-only update keeps the stored amount, rate and cut. A different amount on a priced line needs `reprice: true` (409 `reprice_required`); a `collected` or `written_off` line cannot be repriced (409 `settled_price`); a row that changed under the request is 409 `booking_changed`. |
| `POST /api/advisors/bookings/:id/pay` (changed) | the booking's client | Charges the line's stored fee, never today's rate. A line with no stored fee is 409 `fee_snapshot_missing`, before any Stripe call. |
| `GET /api/advisors/me/ledger` (changed) | the advisor | Adds `states` (billed, collected, written_off, unpriced, refunds_owed, refunded, paid_out_cents, void_sessions) and `totals.received_cents`. Cancelled or missed sessions never collected leave the totals. |
| `GET /api/advisors/me/earnings` (changed) | the advisor | Billed, collected and written-off totals leave out cancelled or missed sessions that were never collected. |
| `GET /api/advisors/me/tax-summary` (changed) | the advisor | Same exclusion. |
| `PUT /api/advisors/me/period-notes/:key` (changed) | the advisor | A body `period_key` other than `:key` is 409 `period_mismatch` and nothing is saved. |
