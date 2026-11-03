# Deck builder v2 (the Grid): switch off a model, refund, unstick and purge

D1547 (#3792, deck v2 B16). This runbook holds the four procedures HQ runs on
the deck builder's generation path:

1. Switch off a model.
2. Refund a batch.
3. Unstick a batch.
4. Purge an image, including a DMCA takedown.

Each procedure first says which tool to use: an HQ screen, then a Worker
route, then D1 SQL. It also says how to check the result and how to undo it.

**What is checked, and how.**
- Every SQL statement in this file is run by
  `cloudflare-worker/test/deck_grid_runbook_d1547.test.ts` against the real
  migrated schema, in the situation it is written for (the acceptance
  fixtures).
- That test also pins each route, refusal code and constant this file cites
  to the code.
- **Not yet run on staging:** every step marked **UNVERIFIED (staging)**.
  These steps have not been run against a live Worker. Whoever first runs
  one on staging records the date and the outcome on #3792.

**Conventions.**
- SQL placeholders are named, like `:batch_uid`. With
  `wrangler d1 execute studioos-db --remote --env production --command "…"`,
  replace each placeholder with a quoted literal you have just read back from
  a SELECT. Never paste a value from a member's message.
- Run every read before its write. Keep the read's output in the incident or
  takedown record, not in an issue.
- No name, email or prompt goes in an issue, a commit or a log. Use counts,
  uids and outcomes only.

---

## 1. Switch off a model

Use this when a model is misbehaving, unsafe, too expensive, or withdrawn by
its provider. It takes effect on the **next call**, with no deploy (D4251).

### The tool

**HQ › Decks › AI models**, at `/admin/platform/decks/models` (Super Admin,
HQ only; a branch deployment is refused).

1. Find the model's row and press **Change…**.
2. Switch it **off**. Alternatively, set a **plan floor** (`free`, `growth` or
   `studio`) to keep the model from plans below that floor.
3. Optionally, add a note of up to 500 characters. It is shown on the row.
4. Write the **reason**, 10 to 500 characters. It goes into the audit row,
   not to members.
5. Confirm.

The screen calls `PUT /api/admin/ai/element-models` with
`{ model_id, enabled, plan_min?, note?, reason }`. It answers
`{ ok, model_id, policy }`. It refuses:

| Code | When |
| --- | --- |
| 400 `unknown_model` | The id is not in the catalogue (`services/ai/catalogue.ts`). |
| 400 `invalid_enabled` | `enabled` is not a boolean. |
| 400 `invalid_plan_min` | The plan floor is not `free`, `growth` or `studio`. |
| 400 `invalid_note` | The note is longer than 500 characters. |
| 400 `reason_required` | The reason is shorter than 10 characters. |
| 409 `model_required` | The model is `@cf/meta/llama-guard-3-8b`, the safety check every run uses (`REQUIRED_MODELS`). It cannot be switched off or given a floor above `free`. |

### What happens

- **The run path.** `featureFlags.modelsOffFor` reads `ai_model_policy` on
  every call, with no cache. The catalogue then refuses the model with
  `model_not_offered`.
- **Every reply that offers models.** The rail, the deck's element models and
  the lightbox chips read `flagsFor`, which applies the same policy.
- **A member's saved pick.** It is kept, not cleared.
  `GET /api/decks/:id/element-models` shows "<Model> is unavailable. Using
  <next>." and the run uses the next model.
- **The audit.** One `ai_model_policy_set` audit row records who made the
  change, the reason, and the policy before and after (`activity_logs` and
  `admin_audit_log`).

### Check it

```sql
SELECT model_id, enabled, plan_min, note, updated_by, updated_at FROM ai_model_policy WHERE model_id = :model_id;
```

```sql
SELECT admin_user_id, action, exported_at AS logged_at FROM admin_audit_log WHERE action = 'ai_model_policy_set' ORDER BY id DESC LIMIT 5;
```

Then check the live behaviour. **UNVERIFIED (staging)**:
- On a staging deck that picked the model, the element-models reply shows the
  "unavailable" notice.
- A new run of an area that used it runs on the next model, and its step row
  names that model in `model_used`.

### Undo

Run the same **Change…** with the model switched **on**, and give a reason.
The route has no delete; a row with `enabled = 1` and no floor is the same as
no row.

### The other switch, and why not to use it for this

A `feature_flags` row with key `model:<id>`, set on **HQ › Decks › Feature
flags** (`PUT /api/admin/feature-flags`, admin), also switches a model off.
Use it only to switch a model off for one role or one person (`scope: role`
or `user`).

That route does **not** check `REQUIRED_MODELS`, so it would accept switching
off the safety model, which stops every run. Do not use it on
`@cf/meta/llama-guard-3-8b`. Its reads are also cached for up to 60 seconds.

---

## 2. Refund a batch

A **batch** is one generation run: a row in `deck_area_batches`, with one row
per quoted line in `deck_area_batch_steps`. It takes one parent hold in
`ai_budget_reservations` (`reservation_uid`). Each step charges against that
hold (`ai_usage_logs.reservation_uid`, `record_ref = deckstep:<uid>:<seq>`).
When the run ends, it settles the hold **once**, at the sum its steps
charged.

### What is already refunded on its own

You do not need to act in these cases:
- **A step that never started.** It is `stopped` and charges nothing.
- **A run that charged nothing.** It settles at zero as a refund.
- **Stop.** Stop (`POST /api/decks/areas/batches/:uid/cancel`, the starter
  only) charges only the steps that started.
- **A run that stalled.** Its hold expires 5 minutes after it was last
  extended (`HOLD_TTL_MS`). The member's next budget read releases it at zero
  (`releaseExpired`).

### Read the run first

```sql
SELECT uid, deck_id, state, runtime, quote_microusd, charged_microusd, reservation_uid, created_by, created_at, started_at, settled_at FROM deck_area_batches WHERE uid = :batch_uid;
```

```sql
SELECT seq, element, kind, state, quote_microusd, charged_microusd, error_code, started_at, ended_at FROM deck_area_batch_steps WHERE batch_uid = :batch_uid ORDER BY seq;
```

```sql
SELECT uid, status, included_microusd, topup_microusd, actual_included_microusd, actual_topup_microusd, expires_at FROM ai_budget_reservations WHERE uid = :reservation_uid;
```

The deck has no batch-level refund route. Which tool you use depends on the
hold's `status`:

| Hold status | What to do |
| --- | --- |
| `pending` | The run has not ended. Unstick it first (§3); it settles when it ends. |
| `review` | The recorded cost was above the hold. On **HQ › AI allowances › Reviews** (`/admin/platform/allowances`), choose **Refund** (`POST /api/ai-budget/reviews/:uid/refund`, Super Admin, reason of 10 or more characters). |
| `settled` | Give the money back as an **adjustment**: **HQ › AI allowances**, the member's page, **Adjust** (`POST /api/ai-budget/members/:userId/adjustments` with `{ amount_usd, reason, idempotency_key }`, Super Admin). See below. |
| `refunded` | Already refunded. Do nothing. |

### An adjustment for a settled run

1. Compute the amount from the run's own rows: the batch's
   `charged_microusd`, or only the steps you are refunding.
2. Divide microdollars by 1,000,000 to get dollars.
3. Make the reason name the batch uid and the cause, for example "deck run
   <uid>: steps 3–5 failed on a provider outage". Use no person's name.
4. Use a fresh `idempotency_key` of 8 to 64 characters per refund. A retry
   with the same key does not pay twice.

The route caps one adjustment at **$100** and an operator at **$250 added per
30 days** (`AI_TOKEN_PACKS.md`, "Adjust a member's balance"). A larger refund
is the owner's decision.

`ai_credit_ledger` is append-only, and its triggers refuse UPDATE and DELETE.
**Never edit a hold or a ledger row by hand.** The routes above are the only
writes.

### Check it

The member's **History** (`/api/ai-budget/history`) shows the adjustment or
the refund. The reservation reads `refunded` (a review refund), or the ledger
shows an `adjustment` row. **UNVERIFIED (staging).**

---

## 3. Unstick a batch

A deck has at most one active run (`deck_area_batches_one_active`: `queued`,
`running` or `cancelling`). A stuck run therefore answers `409 deck_busy` to
every new run on that deck.

**Who drives a run.**
- **The `do` runtime (the default, `DECK_GEN_RUNTIME = "do"`).** The deck's
  `DeckGenRoom` alarm drives it and rebuilds it after a crash.
- **The `queue` runtime** (`JOB_QUEUE`, used for runs of more than 18 variant
  steps). Slices of 5 minutes drive it, up to `MAX_SLICES` (500). At that cap
  the run is left active and nothing drives it.

No sweeper, cron or HQ route cancels a run, so this procedure is the tool.

### Find stuck runs

```sql
SELECT uid, deck_id, state, runtime, created_by, created_at, started_at FROM deck_area_batches WHERE state IN ('queued', 'running', 'cancelling') AND created_at < datetime('now', '-30 minutes') ORDER BY created_at;
```

For each stuck run, read its steps (§2) and look for a step left `running`
with no answer:

```sql
SELECT s.seq, s.state, s.started_at, (SELECT COUNT(*) FROM ai_usage_logs u WHERE u.reservation_uid = b.reservation_uid AND u.record_ref = 'deckstep:' || s.batch_uid || ':' || s.seq AND u.refusal IS NULL) AS answered FROM deck_area_batch_steps s JOIN deck_area_batches b ON b.uid = s.batch_uid WHERE s.batch_uid = :batch_uid AND s.state = 'running';
```

### Step 1: ask the starter to press Stop

**Stop** (`POST /api/decks/areas/batches/:uid/cancel`) can be pressed only by
the member who started the run; anyone else gets `403 not_your_run`.

- **A run with no step in flight** ends at once. It settles what started
  (`finish`). This covers the queue run at its slice cap.
- **A run with a step left `running`** stays `cancelling`, because `finish`
  waits for the step to land. Go to step 2.

### Step 2: settle an orphaned step the way the code does after a crash

This applies `rebuild`'s rule to a step that is `running` with no driver:
- a step whose model answered becomes `done`, at what it charged (capped at
  its quote);
- a step with no answer goes back to `waiting`.

Nothing is charged twice.

```sql
UPDATE deck_area_batch_steps SET state = 'done', charged_microusd = MIN(quote_microusd, (SELECT COALESCE(SUM(u.charged_microusd), 0) FROM ai_usage_logs u JOIN deck_area_batches b ON b.reservation_uid = u.reservation_uid WHERE b.uid = deck_area_batch_steps.batch_uid AND u.record_ref = 'deckstep:' || deck_area_batch_steps.batch_uid || ':' || deck_area_batch_steps.seq)), ended_at = datetime('now') WHERE batch_uid = :batch_uid AND state = 'running' AND EXISTS (SELECT 1 FROM ai_usage_logs u JOIN deck_area_batches b ON b.reservation_uid = u.reservation_uid WHERE b.uid = deck_area_batch_steps.batch_uid AND u.record_ref = 'deckstep:' || deck_area_batch_steps.batch_uid || ':' || deck_area_batch_steps.seq AND u.refusal IS NULL);
```

```sql
UPDATE deck_area_batch_steps SET state = 'waiting', started_at = NULL WHERE batch_uid = :batch_uid AND state = 'running';
```

Then ask the starter to press **Stop** again. The run is already
`cancelling`, so Stop goes straight to `finish`. That stops the waiting
steps, closes the run as `cancelled` and settles the hold at what the steps
charged. **UNVERIFIED (staging).**

### Step 3: only when the starter cannot press Stop — close it by hand

This ends the run without the code's settlement:
- the run is marked `failed`;
- every step not `done` is `stopped`.

The hold is left to expire. Within 5 minutes of its last extension, the
member's next budget read releases it **at zero**, so the member is not
charged for this run. That includes the steps that did finish. Record that
on the incident.

Run step 2's first statement first, so the finished steps keep their charge
on the run's own record.

```sql
UPDATE deck_area_batch_steps SET state = 'stopped', ended_at = datetime('now') WHERE batch_uid = :batch_uid AND state IN ('waiting', 'running');
```

```sql
UPDATE deck_area_batches SET state = 'failed', charged_microusd = (SELECT COALESCE(SUM(charged_microusd), 0) FROM deck_area_batch_steps WHERE batch_uid = :batch_uid), settled_at = datetime('now') WHERE uid = :batch_uid AND state IN ('queued', 'running', 'cancelling');
```

### Check it

- The batch row reads `cancelled` or `failed`, with `settled_at` set.
- The "Find stuck runs" query no longer lists it.
- A new run on the deck is admitted instead of answering `409 deck_busy`.
  **UNVERIFIED (staging).**

### Undo

There is none, and none is needed. The member starts a new run, or uses
**Retry failed** (`POST /api/decks/areas/batches/:uid/retry-failed`, the
starter only), which quotes only the failed areas.

---

## 4. Purge an image, including a DMCA takedown

**Where an image lives.**
- **The row:** `deck_images` (state `proposed`, `kept` or `discarded`).
- **The file:** R2 bucket `studioos-files` (binding `FILES`), key
  `deck-images/<project>/<uid>.<ext>`, in the row's `r2_key`.
- **How it is served:** `GET /api/decks/images/:uid/file`.
  - The route answers **404** once the row is `discarded`, before it reads R2.
  - A **kept** image is public to anyone with the URL, with
    `cache-control: public, max-age=31536000, immutable`.

**Why the normal paths do not purge.**
- The member's **Discard** refuses a kept image (`409 image_kept`).
- The daily sweep (03:00 UTC) never removes a kept image, nor one any saved
  version, draft, proposal or derivative still names (the view
  `deck_images_named`).
- No HQ purge route exists.

So a purge is the three steps below.

### Find the image and every deck that names it

The uid is the 36-character id in the reported URL
(`/api/decks/images/<uid>/file`).

```sql
SELECT uid, project_id, card_uid, source, model, state, r2_key, mime, sha256, created_at FROM deck_images WHERE uid = :image_uid;
```

```sql
SELECT d.id AS deck_id, d.project_id FROM pitch_decks d JOIN deck_images i ON i.project_id = d.project_id WHERE i.uid = :image_uid AND (instr(COALESCE(d.slides, ''), i.uid) > 0 OR instr(COALESCE(d.theme_json, ''), i.uid) > 0);
```

```sql
SELECT 'proposal' AS store, COUNT(*) AS n FROM pitch_deck_proposals p JOIN deck_images i ON i.project_id = p.project_id WHERE i.uid = :image_uid AND instr(COALESCE(p.slides, ''), i.uid) > 0 UNION ALL SELECT 'derivative', COUNT(*) FROM deck_derivatives v JOIN deck_images i ON i.project_id = v.project_id WHERE i.uid = :image_uid AND instr(COALESCE(v.slides, ''), i.uid) > 0 UNION ALL SELECT 'card draft', COUNT(*) FROM pitch_deck_cards c JOIN pitch_decks d ON d.id = c.deck_id JOIN deck_images i ON i.project_id = d.project_id WHERE i.uid = :image_uid AND instr(c.json, i.uid) > 0;
```

The same picture can sit under a second uid. Another venture may have
uploaded the same bytes, or the edit tools may have made a copy. Look these
up by `sha256` and `parent_uid`, and purge each match the notice covers:

```sql
SELECT uid, project_id, state, parent_uid FROM deck_images WHERE (sha256 = :sha256 AND uid <> :image_uid) OR parent_uid = :image_uid;
```

### Step 1: stop serving it (the row)

```sql
UPDATE deck_images SET state = 'discarded', discarded_at = datetime('now') WHERE uid = :image_uid;
```

From the next request, the file route answers 404, and the editor, Present,
share links and published links show the card without the picture. Exports
fetch each image when they are made, so a new export leaves it out and says
so on that card.

A discarded row also gives up its `sha256`, so a re-upload of the same bytes
is stored as a new image and does not reuse this one. Watch the venture for
that after a DMCA takedown.

### Step 2: delete the file (R2)

```sh
npx wrangler r2 object delete "studioos-files/<r2_key>" --remote
```

Run this from `cloudflare-worker/`, with the `r2_key` from the first SELECT.
It is needed because the sweep keeps a file that a deck still names.
**UNVERIFIED (staging):** the command's flags on the pinned wrangler.

### Step 3: tell the venture

The venture's decks still name the uid, and now show a missing picture. Tell
the venture's owner which card and why, through the takedown record's contact
channel, not an issue. Ask them to remove the picture from the card.

### What a purge cannot reach

- **Copies already downloaded.** A PDF, PowerPoint, .odp or HTML export
  embeds the picture, and the HTML embeds it as a data URI. Exports are not
  stored by us (`DATA_RETENTION.md`).
- **Browser caches.** A kept image was served `immutable` for a year. The
  Worker does not put these responses in Cloudflare's edge cache (the repo
  has no `caches.default` use for them), so there is no CDN purge to run. A
  browser or proxy that already holds the file keeps it.

Say both plainly in the takedown reply.

### A DMCA notice

The policy that names the designated agent
(`cloudflare-worker/src/templates/legal/dmca_policy_v1.md`, legal@axal.vc)
is still a **draft** (`LEGAL_REVIEW.md`). The agent has not been registered
with the Copyright Office, and nothing sends the policy (D706). Until counsel
finishes it, every notice goes to counsel first. This runbook covers only the
operator's part.

1. **Log it.** Record the notice in the takedown record (not an issue): the
   date received, the reported URL or URLs, and whether the notice has the
   statutory elements (17 U.S.C. §512(c)(3)): identification of the work, of
   the material, contact details, a good-faith statement, an accuracy
   statement under penalty of perjury, and a signature. Counsel decides
   whether an incomplete notice is acted on.
2. **Purge.** On counsel's go-ahead, purge each image the notice identifies:
   steps 1 to 3 above, including the `sha256` and `parent_uid` matches.
   Record the uids and the time of step 1.
3. **Notify.** Tell the venture's owner that the material was removed and
   that they may send a counter-notice. Counsel supplies the wording.
4. **Counter-notice.** If one arrives, counsel decides on reinstatement. A
   purged file is gone from R2 and cannot be restored by us. The venture
   re-uploads it.
5. **Repeat infringers.** Count takedowns per venture in the takedown record.
   The repeat-infringer policy is counsel's to set.

An image the Grid **drew** (`source = 'generated'`) is purged the same way.
Its row's `model` names the model that drew it, which counsel may need.

### Undo

- **Step 1** can be undone while the R2 file still exists, with the
  statement below. Do this only on counsel's word.
- **Step 2** cannot be undone.

```sql
UPDATE deck_images SET state = 'kept', discarded_at = NULL WHERE uid = :image_uid AND state = 'discarded';
```

---

## Known gaps

These are listed on #3792 rather than built under this docs task.

- **No HQ route to stop someone else's run.** Unsticking a run whose starter
  is away means the SQL in §3, step 3, which settles at zero.
- **No HQ purge route.** A purge is SQL plus wrangler, and writes no
  `deck_r2_tombstones` row: its `reason` CHECK allows only `discarded` and
  `unkept_proposal`.
- **`PUT /api/admin/feature-flags` accepts `model:@cf/meta/llama-guard-3-8b`.**
  The model policy route refuses it (`409 model_required`); the flag route
  does not.
- **The DMCA policy is a draft.** The designated agent is not registered.
