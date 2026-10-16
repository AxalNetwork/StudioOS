# scripts/lib — the pure half of the scripts

Every file here is a module with no side effects: no `spawnSync`, no network,
and filesystem reads only where the thing being described *is* a file tree.
The CLI that owns each one does the effects and the arguing with the operator;
this is the part that can be unit-tested and, more importantly, the part that
can be read to find out what a rule actually is.

| File | What it decides |
| --- | --- |
| `migrationPlan.mjs` | The migration ledger's shape, the baseline cutoff, and what to do with each file — apply, mark, or skip. Owned by `../migrate-d1.mjs`. |
| `migrationTargets.mjs` | Which database a migration run touches, and which database may never be bootstrapped. One `--branch <code>` target per subsidiary, each naming the config that declares it. |
| `branchConfig.mjs` | A branch Worker's whole `wrangler.toml`, derived from HQ's `[env.production]` table, plus what a registry entry must contain and what a rendered config must never say. Owned by `../gen-branch-wrangler.mjs` and `../check-branch-config.mjs`. |
| `rpcSurface.mjs` | The RPC surface between HQ and a branch, read off the source (D207, D209): which methods each entrypoint class declares and takes, and which of them anything in the Worker calls across the tier boundary. Read as text, because `cloudflare-worker/src/rpc/index.ts` imports a module only the Workers runtime has. Two readers: `rpcEntrypoints.test.mjs` and `cloudflare-worker/test/topology_d209.test.ts`, which holds HQ's Topology page and a branch's S14 to the same facts. |
| `assetGeneration.mjs` | The assets ONE build's shells reach — what the no-ledger seed keeps, so `docs/assets` stops growing (D183). |
| `assetRetention.mjs` | Which hashed assets in `docs/` a build keeps and which it may prune, and (D529) whether the build had a restored previous build to carry the window forward or restarted it. |
| `sourceTreeHash.mjs` | The content hash of `frontend/src` that `docs/.build-source` records, so "is this bundle built from this source" is answerable (D103). |
| `assetsIgnore.mjs` | What `docs/.assetsignore` withholds from the Worker's asset upload, and why each file stays private: the retention ledger, the build stamp, and a stray Pages entry script — never `_headers`, which wrangler reads to set the security headers. One literal file per line, refused otherwise. Owned by `../build-frontend.mjs` (D271). |
| `accessComments.mjs` | Which comments in the Worker may say "Cloudflare Access": a small lexer that tells a comment from a string, a template literal or a regex, and the rule that every mention must be quoted by an entry in `../access-comment-allowlist.json`. Owned by `../check-access-comments.mjs`. |
| `migrationImmutability.mjs` | Which changes may land under `cloudflare-worker/sql/migrations/`: an addition, and nothing that alters a file already on the base. It parses `git diff --name-status -z`, refuses a status letter it does not know, and resolves the base — a pull request's base branch, or on a push to main the commit main pointed at before it — refusing any branch name or commit id git could read as something else. Owned by `../migration-immutability-gate.mjs` (D269). |
| `apiModules.mjs` | Which files hold the SPA's client calls — `frontend/src/lib/api.js` and every module under `frontend/src/lib/api/` — whether `api.js`'s re-export block names exactly those modules in alphabetical order, and whether each `request()` call has a Worker route (D527). Owned by `../check-api-drift.mjs`. |
| `secEdgarCompanies.mjs` | What a SEC EDGAR company row carries and how a migration is written from EDGAR's company_tickers_exchange.json: one row per CIK, the first listing as its ticker, nothing EDGAR does not record, every row citing its source and licence, `INSERT OR IGNORE` in batches of 100. The header number is the leading digits of `--out` (404 created the table; 412 holds the rows). Owned by `../import-sec-edgar.mjs` (D595). |
| `claudeReview.mjs` | The advisory Claude review's rules: its settings and their bounds, which pull requests may be reviewed (never a fork or Dependabot), the diff parse, which files are sent and in what order, the prompt with its nonce-fenced untrusted data, the output schema and the validation of every finding against the diff, the cost estimate and the per-review and monthly caps, the artifact-name ledger, and the escaped summary and annotations. Owned by `../claude-review/review.mjs`. |
| `claudeReviewRun.mjs` | The whole review run with git, the GitHub API and the Anthropic client handed in, so a missing secret, a fork, an empty or oversized diff, a repeat, a budget refusal, an API failure, a refusal and a malformed answer are all tested with fakes. |

## Tests

`npm run test:retention` runs every `*.test.mjs` in this folder. Thirteen of the
fourteen modules are covered here; `migrationPlan.mjs` is the exception, and
deliberately so — its behaviour is pinned against a real SQLite database by
`cloudflare-worker/test/migrate_d1_plan.test.ts` and
`cloudflare-worker/test/migrations_fresh_build.test.ts`, which run the actual
migrations rather than a model of them.

`rpcEntrypoints.test.mjs` is where `rpcSurface.mjs` is exercised. It holds
`branchConfig.mjs`'s two entrypoint names against the RPC classes in
`cloudflare-worker/src/rpc/index.ts` and against every call that crosses the
tier boundary, derived from the source rather than pinned (D207), with a
floor of known call sites so a harvest that stops matching fails rather than
passing over nothing.

## The rule for adding to it

A module belongs here when a CLI's *decision* is worth testing separately from
its *effects* — which is most of them, and all the dangerous ones. If it needs
to spawn something or talk to Cloudflare, that part stays in the script above.
