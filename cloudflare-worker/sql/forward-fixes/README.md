# cloudflare-worker/sql/forward-fixes — rehearsed recovery for manual migrations

Some migrations the release-window rollback classifier calls `manual`: a trigger, a drop, a rename, a unique index on
an existing table. Each must name its forward fix in its own text as `-- forward-fix: <repo path>.sql`
(D8532, `documentation/operations/DEPLOY.md` §3). The fix is the SQL that puts a database back in working order when
the Worker is rolled back, or a recovery is done by hand, while D1 keeps the migration. The rehearsal runs each fix on
the migrated database and on a clean build (`scripts/lib/releaseWindow.mjs`, step 5).

**These files are not migrations.** Nothing applies them on deploy, and the migration ledger never records them. An
operator runs one only during a recovery the runbook calls for. Name a fix after its migration,
`<migration stem>.fix.sql`, and make it idempotent (`IF EXISTS`, `IF NOT EXISTS`), because a recovery may run it more
than once. A fix never deletes rows.

| File | Fixes |
| --- | --- |
| `202611260837_5585_release_render_ceiling.fix.sql` | D5585-p15: drops the render ceiling pairing trigger, so a rolled-back Worker can record render approvals again. |
| `202611260840_5585_swarm_admission_events_render_codes.fix.sql` | D5585-p15: re-creates the rebuilt audit table's index and append-only triggers. |
| `202611260844_7927_census_cbp_source.fix.sql` | D7927: keeps the `census-cbp` source disabled, so a rolled-back Worker that has no importer for it imports nothing. |
| `202611270508_7744_research_fund_size_currency_and_kind.fix.sql` | D7744: puts back the fund list defaults table and the currency and kind triggers if a hand recovery dropped them; a rolled-back Worker needs nothing else. |
| `202611261004_5585_release_line_names.fix.sql` | D5585-p16: re-creates the line names table's index and its four triggers. |
| `202611270444_7928_bls_ce_source.fix.sql` | D7928: keeps the `bls-ce` source disabled, so a rolled-back Worker that has no importer for it imports nothing. |
| `202611272117_9034_cf_dlq_mirror_once.fix.sql` | D9034: skips a duplicate `cf_dlq_mirror` insert without an error, so a rolled-back Worker's plain INSERT of an already mirrored dead letter is acknowledged, not retried. |
