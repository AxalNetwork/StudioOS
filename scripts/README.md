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
| `check-workspace-frames.mjs` | A workspace route that crashes, renders nothing, or draws two headings or two AI rails. Renders the built `docs/` in Chromium with `/api/*` stubbed, so it sees what the source-reading suite cannot: it caught `/expertise/profile` throwing into the error boundary on every visit. Needs a browser, so it is **not** in `test:guards` — run it by hand after `npm run build`. |
| `check-frontend-builds.mjs` | A frontend that does not build. Every other check here reads the source as TEXT, so a parse error passes the whole suite and surfaces one push later in CI. Runs the real bundler into a temp directory — never `docs/`. |
| `check-folder-docs.mjs` | A folder that carries weight without explaining itself, or a README naming a file that does not exist. |
| `npm-audit-gate.mjs` | A critical advisory in a production dependency — and, separately, a registry that did not answer. `npm audit` exits 1 for both, so a 503 from the advisory endpoint went red exactly like a real CVE. The gate retries a transport failure, names the advisories on a real finding, and still fails when the database is unreachable rather than passing on a question it could not ask. |
| `check-dark-mode.mjs` | A surface with no dark variant. |

## The live probes

These two reach **production over the network**, so neither is in
`test:guards` or `test:drift`: a check that cannot run inside the suite must
never sit in the suite reporting success. Each has its own scheduled
workflow, and each has unit tests over its pure helpers that *are* in the
suite.

| File | What it proves |
| --- | --- |
| `check-spa-live.mjs` | Every SPA shell route on both hosts returns the rendered shell (200 + `<div id="root">` + a hashed `/assets/*.js`) with the static security headers `docs/_headers` sets. Run as `npm run deploy`'s `postdeploy` hook and 6-hourly by `.github/workflows/post-deploy-smoke.yml`. It probes `/api/health` and nothing more of the API — which is why it stayed green straight through the magic-link outage below. |
| `check-magic-link-live.mjs` | A **real magic-link sign-in**, end to end: POST `/api/auth/magic/start`, read the link out of a real inbox, follow it, assert a session. Three verdicts reported separately, because D74 moved the email send to `waitUntil` and so `/magic/start` can answer `202` in 200ms while the mail never arrives — a fast endpoint is necessary and nowhere near sufficient. Needs a dedicated production test account and read access to its mailbox (`MAGIC_PROBE_EMAIL`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`); **exits 2 and verifies nothing without them, never 0**. Cannot run from an agent sandbox — that proxy answers `403 CONNECT` for `axal.vc` — so its home is `.github/workflows/magic-link-probe.yml`. Guarded by `frontend/test/magic_link_probe.test.mjs`; see `documentation/architecture/DECISIONS.md` D78. |

## The pull-request preview

| File | What it does |
| --- | --- |
| `pr-preview-worker.mjs` | The script behind `wrangler.pr-preview.toml` (repo root): a Worker per pull request with no bindings, serving the PR's `docs/` build on workers.dev. Two jobs, mirroring what `cloudflare-worker/src/index.ts` does on production — a missing hashed `/assets/*` file is a plain 404, never the SPA shell, and `/api/*` is a JSON 404 because a preview has no API. Deployed and deleted by `.github/workflows/pr-preview.yml`; guarded by `frontend/test/pr_preview.test.mjs`. |

## Reading a design artifact

| File | What it does |
| --- | --- |
| `read-canvas.mjs` | Turns a published Claude Design artifact back into the `.dc.html` canvas `design/canvases/` is already full of. An artifact looks like it needs a browser and does not: it is a bundler shell with gzip+base64 assets in `<script type="__bundler/manifest">` and the design itself in `<script type="__bundler/template">`, and decoded, that template is exactly the `<x-dc>` / `DCLogic` format 124 files under `design/` already use. So a design arriving as a URL can land in `design/incoming/` where the intake pipeline handles it — reviewable in a diff, greppable, diffable against the next revision. It points the runtime at the one shared copy in `design/canvases/shared/support.js` (which every canvas references as a relative `support.js`, rather than inlining 69KB of runtime into each file), replaces the ~35 inlined `@font-face` rules with the Google Fonts link every other canvas uses (families and weights read **out of the block**, never assumed — a hard-coded Inter link silently dropped Roboto Mono from a canvas that sets its code samples in it), strips the publisher's watermark, and un-mangles the camelCase attributes a DOM round-trip flattened (`dangerouslySetInnerHTML` comes back as `sc-camel-dangerously-set-inner-h-t-m-l`, and leaving it renders the canvas without its inline SVG icons). It never substitutes an unrecognised asset uuid with a `data:` URI — it names the uuid and exits 1, because a canvas that silently drops an asset is worse than one that says which asset it could not place. `node scripts/read-canvas.mjs <artifact.html> <out.dc.html>`, then follow `design/incoming/README.md`. |

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
