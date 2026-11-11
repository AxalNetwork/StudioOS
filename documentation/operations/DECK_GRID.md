# The Grid — deck builder v2 operations runbook (D1547, #3792)

**Who this is for.** An HQ operator (Super Admin) handling one of four things
on deck builder v2: a model that must stop, a member owed money for a run, a
run that will not finish, or an image that must come down. Each procedure says
what exists today, what to do, how to check it worked, and what does not exist
yet. Where no route exists, the SQL is given and marked as such.

**Read first.** `CLAUDE.md` (production is the Worker on `axal.vc`, D1 is
`studioos-db`). Run D1 statements with
`npx wrangler d1 execute studioos-db --remote --env production --command "…"`
from `cloudflare-worker/`, and read before you write: every write below is
preceded by the read that shows what it will touch.

**Staging.** There is no staging Worker yet. `[env.preview]` in `wrangler.toml`
has placeholder ids and no CI deploys it, and `branch-provision.yml` has never
run. Until one of them is live, each step is marked with how it was verified,
and **none is marked "tested on staging"**. Two guards read this page.
`cloudflare-worker/test/deck_grid_runbook_3792.test.ts` checks that every
route, table, state and limit named here is still in the code.
`cloudflare-worker/test/deck_grid_runbook_d1547.test.ts` runs every SQL
block below on the migrated schema, in the situation it is written for.
The page fails the build when either drifts.

| # | Procedure | Route today | Verified |
| --- | --- | --- | --- |
| 1 | Switch off a model | yes, HQ page and `PUT` | code read; guard test. Not on staging |
| 2 | Refund a batch | `POST /api/ai-budget/deck-batches/:uid/refund`, or a member adjustment | code read; guard test. Not on staging |
| 3 | Unstick a batch | no repair route; SQL and the DLQ | code read; guard test. Not on staging |
| 4 | Purge an image, incl. DMCA | HQ takedown route; SQL, R2 and the cache if the object remains | code read; guard test. Not on staging |

---

## 1. Switch off a model (D4251)

**What exists.** `ai_model_policy` (migration `202611030919_ai_model_policy.sql`):
one row per model, `enabled`, `plan_min` (`free`, `growth`, `studio` or null),
`note`, `updated_by`, `updated_at`. No row means no policy. The routes are
`routes/admin_ai_element_models.ts`, mounted at `/api/admin/ai/element-models`,
Super Admin on HQ's deployment only (a branch's Super Admin is 403).

**Steps.**
1. Open **HQ › Decks › AI models** (`/admin/platform/decks/models`), find the
   model, switch it off and give a reason (10 to 500 characters). The note members see is optional and up to 500 characters. Or call
   `PUT /api/admin/ai/element-models` with
   `{ "model_id": "<id>", "enabled": false, "reason": "<why>", "note": "<what members see, optional>" }`.
2. Check: `GET /api/admin/ai/element-models` shows it off, and a deck's
   `GET /api/decks/:id/element-models` leaves it out of every list.

**What happens.**
- It takes effect on the next call: the policy is read from D1 on every run, with
  no cache and no deploy.
- A run that names it is refused `model_not_offered`. A member's saved pick is
  kept, and the page says "<model> is unavailable. Using <next>.".
- **Not checked:** what a step already running in a batch does when its model is
  switched off mid-run. Watch the batch (procedure 3) after switching off a
  model that is in use.

**Refusals.** 400 `unknown_model`, `invalid_enabled`, `invalid_plan_min`,
`invalid_note` or `reason_required`. 409 `model_required` for `@cf/meta/llama-guard-3-8b`: the
guard cannot be switched off.

**Turn it back on.** The same `PUT` with `"enabled": true` and a reason. There
is no `DELETE`: the row stays, as the record.

**Audit.** Each write logs `ai_model_policy_set` with the model, the reason and
the before and after, in `admin_audit_log` and `activity_logs`.

---

## 2. Refund a batch (D1502, D755)

**What exists.**
- A run is a `deck_area_batches` row (migration 716): `state` is `queued`,
  `running`, `cancelling`, `done`, `cancelled` or `failed`. It also carries
  `quote_microusd`, `reservation_uid`, `charged_microusd` and `settled_at`. Its
  steps are `deck_area_batch_steps` (`waiting`, `running`, `done`, `failed`,
  `stopped`).
- Each run holds once: an `ai_budget_reservations` row keyed
  `deck-batch:<key>`, `operation = 'deck.generate'`, `execution_id` the batch
  uid, status `pending`, `review`, `settled` or `refunded`.
- When the run finishes, the hold settles once, at the sum of the steps'
  charges. A run that charged nothing releases the hold in full. The ledger is
  `ai_credit_ledger` (append only: `hold`, `release`, `spend`, `adjustment`);
  each step's charge is in `ai_usage_logs` with the hold's `reservation_uid`.
- **HQ refunds a whole run in one press** (D4373):
  `POST /api/ai-budget/deck-batches/:uid/refund` with
  `{ "reason": "<10 to 400 characters>" }`. HQ Admin or Super Admin.

**Find the run and what it charged.**
```sql
SELECT b.uid, b.deck_id, b.state, b.quote_microusd, b.charged_microusd, b.settled_at,
       r.status AS hold_status, r.user_id
  FROM deck_area_batches b
  LEFT JOIN ai_budget_reservations r ON r.uid = b.reservation_uid
 WHERE b.uid = :batch_uid;
```

```sql
SELECT id, model, charged_microusd, created_at FROM ai_usage_logs WHERE reservation_uid = :reservation_uid;
```

**Steps, by what the hold says.**
- **`review`** (the run went over its hold): HQ's review queue decides it.
  `GET /api/ai-budget/reviews`, then `POST /api/ai-budget/reviews/:uid/refund`
  with `{ "reason": "<at least 10 characters>" }`. Super Admin.
- **`settled`** (the run charged, and the member is owed it): refund the batch.
  `POST /api/ai-budget/deck-batches/<batch uid>/refund` with
  `{ "reason": "<why, 10 to 400 characters>" }`. Every step that charged goes
  back to the founder's AI tokens as its own `adjustment` row
  (`source_ref = 'adj:deck-refund:<batch uid>:<seq>'`), each with one
  `admin_audit_log` row (`deck_batch_refund`), never more in all than the hold
  settled. The answer lists each charge (`refunded`, `already_refunded`).
  A second press refunds nothing again. It sits behind the recovery cool-off,
  like every adjustment, and the member gets one notice with the amount.
  To give back only part of a run, use an adjustment instead:
  `POST /api/ai-budget/members/:userId/adjustments` with
  `{ "amount_usd": <positive, at most 100>, "reason": "Deck batch <uid>: <why>", "idempotency_key": "deck-batch-<uid>" }`.
- **Not settled** (`pending`, `review`, `refunded`, or no hold): the refund
  route refunds 0 and says why (`nothing_settled: true`). Then:
  - **`pending`** past its `expires_at`: nothing to do. The member's next
    budget read refunds it (`releaseExpired`).
  - **`review`**: decide it in the review queue, as above.
  - **`refunded`**: nothing is owed. Check the ledger's `release` row.

**Check.** The member's `GET /api/ai-budget/me` balance moved by the amount,
and `ai_credit_ledger` has the `adjustment` row with your reason.

**Token packs** bought through Stripe are refunded as `AI_TOKEN_PACKS.md` says,
not here.

---

## 3. Unstick a batch (D1536, D1502)

**What drives a run.** `deck_area_batches.runtime`:
- **`do`**: the `DeckGenRoom` Durable Object's alarm runs each active run in
  10-minute slices and re-arms after a second. Its list of runs is the storage
  key `active`.
- **`queue`**: a `deck_gen_slice` message on `studioos-job-queue` runs a
  5-minute slice and sends the next, up to `MAX_SLICES` (500) slices, and up to 500 slices in all. At the cap it logs
  `[deck-gen-queue] slice cap reached` and sends nothing more. A message that
  fails three times goes to `studioos-job-queue-dlq`, mirrored to
  `cf_dlq_mirror`.

**What "stuck" means.** A run in `queued`, `running` or `cancelling` that
nothing drives any more: the DO lost it from `active`, its slice went to the
DLQ, or it reached the slice cap. One active run per deck is enforced by an
index, so **a stuck run also blocks its deck** from a new one (`409 deck_busy`). There is no lease
or heartbeat on a run (D1536 lists one as not built); the hold expires 5 minutes after it was last extended (the five-minute TTL,
`HOLD_TTL_MS`, renewed at each step) and that is the nearest thing.

**The sweep (D4374).** The daily cleanup (`runCleanupJobs` in
`models/jobs.ts`) runs `sweepStuckBatches` (`services/decks/batchSweep.ts`).
A run is stuck when it is still active and no step has started or ended for
`STUCK_AFTER_MS` (30 minutes, a constant whose comment gives the reason). For
each one it:
- ends its steps by rebuild's rule: a `running` step whose usage row exists
  under the hold is `done` at what that row charged (clamped to its quote);
  any other `running` or `waiting` step is `stopped` with `error_code =
  'timed_out'`;
- closes the run `cancelled` with `stop_reason = 'timed_out'`, in one
  compare-and-set on its state, so of two sweeps (or a sweep and a late driver)
  only one closes it;
- settles the hold once, through `settleAiReservation`, at what the steps
  charged, releasing the rest. A hold no longer pending is counted as
  `already_released` and not touched.

It writes one `activity_logs` row per sweep (`action = 'deck.batch_sweep'`,
actor `system`) with its counts. The batch read shows the run as
"Stopped · timed out" (`state_line`), and the deck is free for a new run.

**Find stuck runs** between sweeps. This lists the runs with no step started
in the window; the sweep (`stuckRuns`) also leaves a run whose last step ended
inside it, so treat a row here as a candidate, not a verdict:
```sql
SELECT b.uid, b.deck_id, b.state, b.runtime, b.created_at, b.started_at, r.status AS hold_status, r.expires_at
  FROM deck_area_batches b
  LEFT JOIN ai_budget_reservations r ON r.uid = b.reservation_uid
 WHERE b.state IN ('queued', 'running', 'cancelling')
   AND datetime(COALESCE(b.started_at, b.created_at)) < datetime('now', '-30 minutes')
   AND NOT EXISTS (SELECT 1 FROM deck_area_batch_steps s WHERE s.batch_uid = b.uid
         AND datetime(s.started_at) >= datetime('now', '-30 minutes'));
```

A run that is still active and was created more than 30 minutes ago is the
row the acceptance fixture settles. It is a candidate, not the sweep's verdict:
```sql
SELECT uid, deck_id, state, runtime, created_by, created_at, started_at FROM deck_area_batches WHERE state IN ('queued', 'running', 'cancelling') AND created_at < datetime('now', '-30 minutes') ORDER BY created_at;
```

A step left `running` with an answer, and one with none:
```sql
SELECT s.seq, s.state, s.started_at, (SELECT COUNT(*) FROM ai_usage_logs u WHERE u.reservation_uid = b.reservation_uid AND u.record_ref = 'deckstep:' || s.batch_uid || ':' || s.seq AND u.refusal IS NULL) AS answered FROM deck_area_batch_steps s JOIN deck_area_batches b ON b.uid = s.batch_uid WHERE s.batch_uid = :batch_uid AND s.state = 'running';
```

**Steps.**
1. **The owner can Stop it**: `POST /api/decks/areas/batches/:uid/cancel`. Only
   the run's owner may (another account is 403 `not_your_run`). Ask them first:
   it settles the hold at once; otherwise the daily sweep does.
   A run with a step still `running` stays `cancelling`, because finish waits
   for that step. Settle the orphan the way `rebuild` does after a crash, then
   ask for Stop again. A step whose model answered becomes `done`, at what it
   charged and capped at its quote. A step with no answer goes back to `waiting`.
   Nothing is charged twice, and this SQL does not settle the hold:
   ```sql
   UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = MIN(quote_microusd, (SELECT COALESCE(SUM(u.charged_microusd), 0) FROM ai_usage_logs u JOIN deck_area_batches b ON b.reservation_uid = u.reservation_uid WHERE b.uid = deck_area_batch_steps.batch_uid AND u.record_ref = 'deckstep:' || deck_area_batch_steps.batch_uid || ':' || deck_area_batch_steps.seq)), ended_at = datetime('now') WHERE batch_uid = :batch_uid AND state = 'running' AND EXISTS (SELECT 1 FROM ai_usage_logs u JOIN deck_area_batches b ON b.reservation_uid = u.reservation_uid WHERE b.uid = deck_area_batch_steps.batch_uid AND u.record_ref = 'deckstep:' || deck_area_batch_steps.batch_uid || ':' || deck_area_batch_steps.seq AND u.refusal IS NULL);
   ```
   ```sql
   UPDATE deck_area_batch_steps SET state = 'waiting', started_at = NULL WHERE batch_uid = :batch_uid AND state = 'running';
   ```
2. **A queue run in the DLQ**: `GET /api/infra/dlq` lists it, and
   `POST /api/infra/dlq/:id/retry?source=cf|d1` sends it again (admin). Retry
   once; a second failure is a bug to file, not to retry.
3. **Neither works**: wait for the next daily sweep, which does this right.
   There is no repair route to run it by hand. Do **not** settle the hold by
   hand in SQL: settling is a compare-and-set over two tables plus the ledger
   trigger, and only `settleAiReservation` does it right.
   - If the hold is already `refunded` (it expired), marking the run `failed`
     is bookkeeping only, and frees the deck:
     Run the answered-step statement above first, so finished steps keep
     their charge on the run's own record, then stop the rest and close the run.
     The hold is left to expire: within 5 minutes of its last extension the
     member's next budget read releases it at zero.
     ```sql
     UPDATE deck_area_batch_steps SET state = 'stopped', ended_at = datetime('now') WHERE batch_uid = :batch_uid AND state IN ('waiting', 'running');
     ```
     ```sql
     UPDATE deck_area_batches SET state = 'failed', charged_microusd = (SELECT COALESCE(SUM(charged_microusd), 0) FROM deck_area_batch_steps WHERE batch_uid = :batch_uid), settled_at = datetime('now') WHERE uid = :batch_uid AND state IN ('queued', 'running', 'cancelling');
     ```
     Then check the steps that ran: they may have charged while the hold says
     refunded. Any charge in `ai_usage_logs` for this hold is a charge the
     member did not pay; record it on the issue, and do not bill it back.
   - If the hold is still `pending` and not expired, wait out its TTL, then do
     the above.
4. File an issue with the batch uid, its runtime and which of the three causes
   it was, and whether the sweep closed it (its `deck.batch_sweep` row).

**Check.** The query above no longer returns the run, and the deck starts a
new one.

---

## 4. Purge an image, including a DMCA takedown (D1508, D1543)

**What exists.**
- An image is a `deck_images` row and one R2 object on the `FILES` binding,
  bucket `studioos-files`, key `deck-images/<project>/<uid>.<ext>`
  (`studioos-files/<r2_key>`).
- `GET /api/decks/images/:uid/file` serves a **kept** image publicly with
  `cache-control: public, max-age=31536000, immutable`, and any other state
  `private, no-store` (a discarded one is 404). The URL never changes and is not
  signed, so **a browser or edge copy of a kept image outlives a purge** until
  the cache is purged too.
- A member can discard an image that is not kept
  (`POST /api/decks/images/:uid/discard`; a kept one is 409 `image_kept`). The
  daily 03:00 sweep (`sweepDeckImages`) deletes discarded images after 24 hours,
  and proposals nobody kept after 14 days, writing `deck_r2_tombstones`. **It
  never deletes a kept or named image.**
- Logos: `DELETE /api/decks/:id/logos/:key`, or `PATCH` with
  `{ "permitted": false }`, removes or withdraws the `deck_logos` row only; the
  image object stays.
- **HQ takedown (#4375, D4375).** `POST /api/admin/deck-images/:uid/takedown`
  `{ reason }`, HQ admins only, does in one audited press what used to be
  steps 2 to 5:
  - deletes the R2 object;
  - marks the row `taken_down_at` with the admin and the reason;
  - from then on, the file URL answers a neutral placeholder ("Image removed
    by Axal HQ") instead of the bytes, so every version, draft, proposal and
    export that names the image shows the placeholder (nothing is rewritten);
  - tells the venture's founders, with the reason;
  - writes the admin audit row.

  HQ › Decks › Reports offers it on each image a report names. The daily
  sweep never removes a taken-down row, because the row is the record.
- The DMCA policy (`cloudflare-worker/src/templates/legal/dmca_policy_v1.md`)
  is a draft that nothing serves, and no designated agent is registered
  (D706). Until counsel finishes it, a takedown notice goes to the owner first;
  this page does not decide whether a notice is valid.

**Find the image, the decks that name it, and a copy of the same bytes.**
The uid is the 36-character id in `/api/decks/images/<uid>/file`.
```sql
SELECT uid, project_id, card_uid, source, model, state, r2_key, mime, sha256, created_at FROM deck_images WHERE uid = :image_uid;
```
```sql
SELECT d.id AS deck_id, d.project_id FROM pitch_decks d JOIN deck_images i ON i.project_id = d.project_id WHERE i.uid = :image_uid AND (instr(COALESCE(d.slides, ''), i.uid) > 0 OR instr(COALESCE(d.theme_json, ''), i.uid) > 0);
```
```sql
SELECT 'proposal' AS store, COUNT(*) AS n FROM pitch_deck_proposals p JOIN deck_images i ON i.project_id = p.project_id WHERE i.uid = :image_uid AND instr(COALESCE(p.slides, ''), i.uid) > 0 UNION ALL SELECT 'derivative', COUNT(*) FROM deck_derivatives v JOIN deck_images i ON i.project_id = v.project_id WHERE i.uid = :image_uid AND instr(COALESCE(v.slides, ''), i.uid) > 0 UNION ALL SELECT 'card draft', COUNT(*) FROM pitch_deck_cards c JOIN pitch_decks d ON d.id = c.deck_id JOIN deck_images i ON i.project_id = d.project_id WHERE i.uid = :image_uid AND instr(c.json, i.uid) > 0;
```
```sql
SELECT uid, project_id, state, parent_uid FROM deck_images WHERE (sha256 = :sha256 AND uid <> :image_uid) OR parent_uid = :image_uid;
```
Setting the row `discarded` makes `GET /api/decks/images/:uid/file` answer 404
before it reads R2. That is the file route's rule. The HQ takedown below is
the procedure to use: it also deletes the object, marks the row and tells the
venture. The discard write is what the acceptance fixture runs, and what you
use only if the takedown route cannot be reached:
```sql
UPDATE deck_images SET state = 'discarded', discarded_at = datetime('now') WHERE uid = :image_uid;
```
While the R2 object still exists, counsel can undo that one write:
```sql
UPDATE deck_images SET state = 'kept', discarded_at = NULL WHERE uid = :image_uid AND state = 'discarded';
```

**Steps (owner-approved takedown, or an image that must go).**
1. Record the notice on a private issue, never in a public comment: it names
   a person and a work. Note the image uid, the deck, the venture and who
   approved the takedown.
2. Take it down: from the report in HQ › Decks › Reports (Take down image),
   or by calling the route with the reason the founder will read. The reason
   is 10 to 1,000 characters. A second takedown is 409 `already_taken_down`.
   If the answer says `r2_deleted: false`, delete the object by hand:
   `npx wrangler r2 object delete <FILES bucket>/deck-images/<project>/<uid>.<ext> --remote`,
   then record the key, as the sweep would:
   ```sql
   INSERT INTO deck_r2_tombstones (key, project_id, bytes, reason)
   VALUES ('deck-images/1/00000000-0000-4000-8000-000000000001.png', 1, NULL, 'discarded');
   ```
   The table only takes `discarded` or `unkept_proposal` as a reason; the
   takedown's own reason is on the row (`taken_down_reason`) and the private
   issue. The file route never serves the bytes either way, because it reads
   the mark before R2.
3. Purge the edge cache for `https://axal.vc/api/decks/images/<uid>/file` and
   the same path on `app.axal.vc` (Cloudflare dashboard › Caching › Purge by
   URL). A kept image was served `public, max-age=31536000, immutable`, so a
   copy cached before the takedown can outlive it until it is purged. A
   browser that already cached it keeps it until its own cache clears, and
   that cannot be reached from here. Files a founder exported before the
   takedown are their own and are not reached either.

**Check.** The file URL answers the placeholder (`x-axal-image-state:
taken-down`) on both hosts, the row has `taken_down_at`, and the admin audit
log has a `deck_image_taken_down` row.

**Retention.** The rules for these stores are in `DATA_RETENTION.md` (D1508),
which `scripts/check-deck-retention.mjs` checks.

---

## What is not built (for whoever builds it next)

- A button in HQ for the batch refund (the route is built, D4373).
- An HQ list of stuck runs, and a lease on a queue slice (D1536). The sweep is
  built (D4374).
- Purging the edge cache from the image takedown itself (D4375): it needs a
  Cloudflare API token with cache purge, which the Worker does not hold.
- A live staging Worker, so each procedure can be run end to end before a
  release.
