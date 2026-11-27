## Delivery › edits, reports and invoicing under concurrency (D4682, #4682)

The Worker side is `routes/partner_delivery.ts`, `routes/needs.ts` and `services/engagementInvoices.ts`, on migration 202611072115. No new route; the answers below are new.

| Route | Who | What it answers |
| --- | --- | --- |
| `PATCH /api/partner/delivery/milestones/:id`, `…/blockers/:id`, `…/deliverables/:id`, `…/seats/:id` (changed) | the engagement's firm | Each record carries `revision`. A request that read an older revision changes nothing: 409 `delivery_changed` with the current `revision`. `expected_revision` may be sent. Fields not sent come from the current row. A revoked seat is 409. |
| `DELETE /api/partner/delivery/milestones/:id`, `…/blockers/:id`, `…/deliverables/:id` (changed) | the engagement's firm | 409 `delivery_changed` when the revision moved. |
| `POST /api/partner/delivery/seats/:id/revoke` (changed) | the engagement's firm | A second revoke is 400 and never moves `revoked_at`. |
| `PUT /api/partner/delivery/engagements/:engagementId/status-reports/:period` (changed) | the engagement's firm | 409 `report_sent` once sent, 409 `delivery_changed` when the draft moved. |
| `POST /api/partner/delivery/status-reports/:id/send` (changed) | the engagement's firm | Sends the checked revision and records `sent_revision`. The same person retrying: 200 `already_sent`. Anyone else: 409 `already_sent`. A moved draft: 409 `delivery_changed`. |
| `DELETE /api/partner/delivery/status-reports/:id` (changed) | the engagement's firm | 409 once sent, including when the send landed after the read. |
| `POST /api/engagements/:id/start`, `/deliver`, `/cancel` (changed) | the parties | 409 `engagement_changed` when the status moved. Each records its actor. |
| `POST /api/engagements/:id/invoice` (changed) | the partner side | Issues the invoice and marks the engagement `invoiced` in one batch. A retry after success is 200 `already_invoiced`. An engagement that stopped being invoiceable is 409 `engagement_changed`. |
