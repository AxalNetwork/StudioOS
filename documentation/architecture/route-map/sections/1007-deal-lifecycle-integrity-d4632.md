## Deal lifecycle integrity (D4632, #4632)

The Worker side is `routes/deals.ts`, `services/dealTransitions.ts` and `services/dealFlow.ts`. No migration.

| Route | Who | What changed |
| --- | --- | --- |
| `POST /api/deals` (changed) | the venture's founder, or an admin | A founder's deal is born `applied`. Refusals:<br>- 403 `initial_status_not_allowed` for another stage;<br>- 403 `partner_staff_only` for a `partner_id`;<br>- 400 `pass_needs_reason` for `rejected`;<br>- 400 `unknown_status`.<br>An admin may name a pipeline stage. The deal and its first history row are one batch. |
| `POST /api/deals/draft` (changed) | an admin | An unknown stage is now 400 `unknown_status`, not drafted as `applied`. `rejected` is 400. The deal and its first history row are one batch. |
| `PUT /api/deals/:id` (changed) | the round's lead partner, or an admin | Every field is one UPDATE: the request lands whole or not at all. With a stage change, that UPDATE and its history row are conditional on the stage read. 409 `deal_moved` when another move landed meanwhile, with nothing written. Sending the current stage again is not a move. |
| `POST /api/deals/:id/advance` (changed) | as above | Takes an optional `{ from }`, the stage the page shows. 409 `deal_moved` when the round is no longer there, so a retry cannot advance twice. |
| `POST /api/deals/:id/pass` (changed) | as above | The pass, its reason and its history row are one conditional batch. 409 `deal_moved` when a move or pass landed meanwhile; the first reason stands. |
| `POST /api/deals/:id/commitments/:uid/withdraw` (retired) | an investor | 410 `route_retired`. Nothing changes. Withdraw through `POST /api/deals/:id/commitments/:uid/withdrawal`, which records the reason, the status and the audit row in one batch. |
| `PATCH /api/deals/flow/:dealId`, `POST /api/deals/flow/:dealId/pass`, `POST /api/deals/flow` (changed) | an investor, for their own or their firm's flow | A move, with its owner, note and history, is conditional on the row's stage and `stage_changed_at`. 409 `flow_changed` writes nothing. A second add in flight is 409 `already_in_flow` and writes no history. |
