# cloudflare-worker/sql — the canonical schema

**D1 (`studioos-db`) is the production user store.** All production accounts
live there. The SQLite file the dev FastAPI uses (`backend/app.db`) is separate
and is not kept in sync.

| Path | What it is |
| --- | --- |
| `schema.sql` | The full schema, for bootstrapping a fresh database. |
| `migrations/` | **Forward-only, numbered, and the thing that actually runs.** |
| everything else | Historical one-off scripts, kept for provenance. Not part of the ledger. |

## Adding a change

1. Write a new numbered file in `migrations/` — `NNN_short_name.sql`, one higher
   than the current maximum.
2. Prefer idempotent statements: `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`. `node scripts/migrate-d1.mjs --audit` reports
   which files are safely re-runnable. `ALTER TABLE ... ADD COLUMN` is not (SQLite
   has no `IF NOT EXISTS` for columns) and that is fine — the ledger stops the
   replay — but it must be a deliberate choice.
3. Mirror new tables into `schema.sql` so a fresh database matches a migrated one.
4. Migrations apply automatically: `predeploy` runs `scripts/migrate-d1.mjs
   --remote` before `wrangler deploy`. This is why the deploy must go through
   `npm run deploy`.

## Conventions

- **Additive.** Nullable columns, no backfill of a fact nobody recorded. An
  older row with no value genuinely has no value; filling one in invents data.
- **Money is `*_cents INTEGER`.** Never a float, never a string.
- Every table gets a `uid TEXT NOT NULL UNIQUE` for external reference, and
  `created_at` / `updated_at` as `TEXT NOT NULL DEFAULT (datetime('now'))`.
- Index what you filter on. The public-feed and per-owner lookups are the hot
  paths.
