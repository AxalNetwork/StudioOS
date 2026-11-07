### Licence termination and branch synchronisation, durable (D4686, #4686)

Backed by `services/licencePush.ts`, `rpc/branchOps.ts` and migration `202611071545_licence_sync_revision` (`licence_sync_state`, `licence_termination_ops`, and revision columns on `licence_push_pending` and `branch_licence`).

| Route | Who | What changed |
| --- | --- | --- |
| `POST /api/admin/licences/:uid/terminate` | Super Admin, TOTP and fresh step-up | The status, the territory release, the one `terminated` event, a revision bump, a pending-push row and the operation ledger commit in ONE batch. Answers gain `operation: { status: 'complete' \| 'incomplete', steps, failure_step, failure_code }`. On an already terminated licence whose ledger row is `incomplete` it RESUMES the steps not `done` (200, `resumed: true`, no note needed, no second event); 409 `operation_in_progress` while another request holds the lease; 409 `bad_transition` when every step is done or no ledger row exists (a licence terminated before D4686). |
| `GET /api/admin/licences/:uid` | Super Admin | Gains `sync`: `{ available, hq_revision, branch_revision, last_success_at, pending: { revision, failure_code, attempts, last_attempt_at } \| null, termination: { status, steps, failure_step, failure_code, attempts, created_at, completed_at } \| null }`. A figure nobody recorded is null, never 0; failures are short codes, never error text. |
| Branch `applyLicence` (RPC) | HQ | A numbered copy (`hq_revision`) is ordered by revision alone; an older one answers `{ applied: false, stale: true, hq_revision }`. A copy whose sections did not all write answers `{ ok: false, partial: true, failed_sections, reason }`. |
