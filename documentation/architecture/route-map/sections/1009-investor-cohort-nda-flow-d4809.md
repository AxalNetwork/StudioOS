## Investor cohort NDA flow (D4809, #4809)

The Worker side is `routes/admin_investor_cohorts.ts` and `services/investorCohortAccess.ts`, plus `esign.voidEnvelopeForResend`, on migration `202611071835`. The screen is Programs › Investor cohorts (`pages/admin/programs/InvestorCohorts.jsx`).

| Route | Who | What changed |
| --- | --- | --- |
| `POST /api/admin/investor-cohorts/:uid/nda` (changed) | an admin | Takes `{ void_previous? }`. A failed send is recorded on the grant (`nda_delivery: failed`; 502 `envelope_send_failed` when no envelope was made). Sending again voids a still-open envelope first. A delivered one needs `void_previous: true`, else 409 `already_sent`. 409 `signature_in_progress` once signing has started. |
| `GET /api/admin/investor-cohorts?nda=` (changed) | an admin | `nda` (filter and field) is one of `signed`, `delivery_failed`, `declined`, `voided`, `sent`, `not_sent`. Each grant carries `nda: { sent_at, signed_at, delivery, delivery_at }`. |
