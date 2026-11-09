# cloudflare-worker/sql — the canonical schema

**D1 (`studioos-db`) is the production user store.** All production accounts
live there. The SQLite file the dev FastAPI uses (`backend/app.db`) is separate
and is not kept in sync.

| Path | What it is |
| --- | --- |
| `schema_baseline.sql` | The production-derived schema for bootstrapping a fresh database. |
| `migrations/` | **Forward-only, numbered (up to 799) or stamped `YYYYMMDDHHMM_` (D4106), and the thing that actually runs.** |
| `historical/` | Legacy one-off schema scripts, kept for archaeology only. Nothing builds from them. |
| `migrations/713_pitch_decks_unique_version.sql` | #3748: preserve and renumber duplicate deck versions, choose one current row per project, and enforce unique versions/current rows. |
| `migrations/716_deck_area_batches.sql` | D1502 (#3753): a deck generation run (`deck_area_batches`, one active per deck, `idem_key` unique) and its steps (`deck_area_batch_steps`), under one quote and one parent hold. |

| `migrations/728_agent_engine.sql` | D1528 (#3847, E3 of #3742): the agent engine's six tables (runs, duties, handoffs, memory notes, custom roles, scope settings). All new tables, re-runnable; the runtime that uses them follows. |
| `migrations/730_pitch_card_blobs.sql` | D1539 (#3789, deck v2 B13): `pitch_card_blobs(hash, json, created_at)`, each card's JSON once under the SHA-256 of its canonical JSON, and `pitch_decks.card_hashes`, a version's cards as an ordered hash list. Additive; nothing backfilled; `slides` is still written during the transition. |
| `migrations/737_deck_brand_kits.sql` | D1562 (#3809, deck v2 D1): `deck_brand_kits`, one row per venture (display and body fonts, palette roles, image style, reference image uids, a logo uid). Additive; number given on the issue. |
| `migrations/760_interview_processing_failed_stage.sql` | D1456 (#4014): nullable, constrained failed processing step; existing migration ledger prevents replay. |
| `migrations/202611041613_grow_campaigns.sql` | D4447 (#4447): campaign plans, channel budgets and same-venture item links; Part A of #3722. |
| `migrations/202611041438_team_allowlists.sql` | D4422 (#4422): per-company and standalone-project model/tool lists, with actor/time; company projects inherit their parent policy. |
| `migrations/202611042009_distribution_inbox_reads.sql` | D4494: per-member, per-message Inbox receipts. |
| `migrations/202611071531_licence_revisions.sql` | D4694 (#4694): a `revision` on `licence_terms` and `licence_fee_invoices` and a `terms_revision` on `territory_licences`, so a write from a stale snapshot is refused (409) instead of replacing a newer value. Additive, default 0. |
| `migrations/202611071547_advisor_engagement_events.sql` | D4695 (#4695): `advisor_engagement_events`, an engagement's append-only renewal history (`signed`, `renewed`, `ended`), with unique indexes that make a repeated decision on one term a no-op. New table, re-runnable. |
| `migrations/202611072219_security_events_support_actor.sql` | D4691 (#4691): nullable `security_events.support_user_id`, the operator behind a gate refusal or step-up made inside a support session (0 for a branch session). Additive, nothing backfilled. |
| `migrations/202611081919_skill_release_evidence.sql` | D4533 (#4533): the release evidence of Axal's skills: a draft's declared required models, the evidence hash a review and an eval result were given on, and an HQ version's manifest in its own row. Triggers keep versions, cases, results and decided reviews as written. Additive, nothing backfilled. |
| `migrations/202611082048_ticket_filing_snapshot.sql` | D5030 (#5030): `tickets.filed_persona`, `filed_role`, `filed_licence_uid`, `filed_branch_code`, the support context a ticket was filed in, written once by the INSERT. Additive, nothing backfilled. |
| `migrations/202611082049_support_sla_policy_version.sql` | D5032 (#5032): `support_sla_policy_state`, the version of the ticket SLA tiers on this database (HQ's own, or the copy a branch applied). New table, re-runnable, no seed. |
| `migrations/202611090953_meeting_bot_runtime_startup.sql` | D5153 (#5153): `meeting_bots.runtime_stage`, `runtime_stage_at`, `runtime_version`, `runtime_error_code`, `runtime_callback_seen_at`, `runtime_start_ms`, the operator's startup facts for a run (closed code lists, no meeting content). Additive, nothing backfilled. |

## Adding a change

1. Write a new file in `migrations/` named by the UTC minute you write it:
   YYYYMMDDHHMM_short_name.sql (D4106), for example
   202611021015_add_widgets.sql. No number to pick, so two parallel PRs never
   collide; it sorts after every numbered file (they stop at 799) and the
   ledger applies it once. `scripts/check-sql-migrations.mjs` refuses a
   malformed name and two files sharing a number or a stamp, naming both.
2. Prefer idempotent statements: `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`. `node scripts/migrate-d1.mjs --audit` reports
   which files are safely re-runnable. `ALTER TABLE ... ADD COLUMN` is not (SQLite
   has no `IF NOT EXISTS` for columns) and that is fine — the ledger stops the
   replay — but it must be a deliberate choice.
3. Update the production-derived baseline when a fresh database must match the
   migrated schema. The old one-off scripts live in `historical/` for archaeology
   only and are not build inputs.
4. Migrations apply automatically: `predeploy` runs `scripts/migrate-d1.mjs
   --remote` before `wrangler deploy`. This is why the deploy must go through
   `npm run deploy`.

## Conventions

- **Additive.** Nullable columns, no backfill of a fact nobody recorded. An
  older row with no value genuinely has no value; filling one in invents data.
- **Money is `*_cents INTEGER`.** Never a float, never a string.
- Every table gets a `uid TEXT NOT NULL UNIQUE` for external reference, and
  `created_at` / `updated_at` as `TEXT NOT NULL DEFAULT (datetime('now'))`.
- **A data correction deactivates; it does not delete.** When rows that should
  never have been shown must go, set them inactive and say why in the
  migration's header, so an audit can still see they existed. Migration 433
  (D643) does this for the sample wellbeing experts.
- Index what you filter on. The public-feed and per-owner lookups are the hot
  paths.

D1168 (#3081), migration 605, adds measured sizes and missing-object markers to
five existing record tables, profile-file metadata in `member_files`, and the
resumable discovery checkpoints in `member_file_size_backfill_state`. It leaves
legacy sizes NULL and adds no users column. The operator backfill measures R2
HEAD metadata after deployment; the migration never reads or deletes objects.

| `migrations/202611041900_grow_campaign_details.sql` | D4483 (#4483): nullable audience/channel budget details and plain creative text; ALTERs apply once through the ledger. |
| `migrations/202611072340_platform_capacity_history.sql` | D4559 (#4559) part 2: daily deployment-metric snapshots (NULL when unreadable, never 0) and capacity alert episodes with one open row per metric. No tenant data. |
