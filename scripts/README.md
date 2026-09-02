# scripts — build, deploy, and the guards that keep CI honest

## The two you will run

| Command | What it does |
| --- | --- |
| `npm run build` | `build-frontend.mjs` — compiles the SPA into `docs/`, prerenders public routes, and prunes old hashed assets on a retention window. **Always build through this, never a bare `vite build`**: that empties `docs/` and deletes the retained assets and the hand-maintained changelogs living there. |
| `npm run deploy` | Applies pending D1 migrations (`migrate-d1.mjs --remote`) and then deploys the worker. The migration step is a `predeploy` hook, which is why deploying by hand ships the worker ahead of its schema. |

## The guards

`npm run test:guards` runs every `check-*.mjs`. They exist because each one
represents a bug that reached production once:

| Guard | What it catches |
| --- | --- |
| `check-api-drift.mjs` | The SPA calling an endpoint the worker does not serve — resolved against the real mount table, not a regex. |
| `check-sqlite-columns.mjs` | SQL naming a column that does not exist. D1 rejects the whole statement, so this renders as an empty screen rather than an error. |
| `check-sqlite-tables.mjs` | SQL against a table nothing creates. |
| `check-migration-column-shapes.mjs` | A migration reading a column that only SOME definitions of a multiply-defined table have — D1 keeps one table per name, so it cannot apply unless that shape happened to win. Exceptions live in `migration-column-shapes-baseline.json`. |
| `check-sql-prepare.mjs` | A `${}` inside `DB.prepare()`. Exceptions live in `sql-prepare-baseline.json` and are argued one at a time. |
| `check-money-cents.mjs` | Money parsed as a float. |
| `check-wrangler-binding-parity.mjs` | A binding added to one `wrangler.toml` table but not the other — the worker then boots without it in production only. |
| `check-docs-fresh.mjs` | A committed `docs/` older than `frontend/src`, i.e. a deploy that would ship a stale bundle. |
| `check-frontend-builds.mjs` | A frontend that does not build. Every other check here reads the source as TEXT, so a parse error passes the whole suite and surfaces one push later in CI. Runs the real bundler into a temp directory — never `docs/`. |
| `check-folder-docs.mjs` | A folder that carries weight without explaining itself, or a README naming a file that does not exist. |
| `check-dark-mode.mjs` | A surface with no dark variant. |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `lib/` | Shared helpers (`migrationPlan.mjs`, `assetRetention.mjs`) and their unit tests. |
| `ci/` | CI-only entry points. |
| `og-assets/` | Open Graph image sources. |
| `__pycache__/` | Python bytecode. Not source. |

## Adding a guard

Write the failure first — a guard that cannot fail on the bug it was written for
is decoration. Several here were rewritten after passing cleanly over the exact
code that motivated them.
