# scripts/lib — the pure half of the scripts

Every file here is a module with no side effects: no `spawnSync`, no network,
and filesystem reads only where the thing being described *is* a file tree.
The CLI that owns each one does the effects and the arguing with the operator;
this is the part that can be unit-tested and, more importantly, the part that
can be read to find out what a rule actually is.

| Folder | What lives there |
| --- | --- |
| `fixtures/` | Evidence-backed replay inputs; no invented historical results. |

## Tests

`npm run test:retention` runs every `*.test.mjs` in this folder. Fourteen of the
fifteen modules are covered here; `migrationPlan.mjs` is the exception, and
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

## The files

<!-- index: generated -->

Each module and test says what it decides, or what it proves, in its own
header comment, and the list below is generated from those headers (#6470, as
#4104 does for routes and services): `node scripts/check-folder-docs.mjs
--write` fills it in your working tree and `--clean` empties it; it is never
committed. So a new module needs a header comment and no edit here, and a file
without one fails the build. A data file here (`*.json`) takes no comment and
is not listed: the script that reads it describes it (`../build-rail-matrix.mjs`
for `railMatrixOverrides.json`).

<!-- files:begin -->
<!-- files:end -->
| `fileRecoveryHealth.mjs` | D6653: pure heartbeat/workflow health decisions without inferring recovery from unavailable evidence. |
| `fileRecoveryHealth.test.mjs` | D6653: freshness/failure, metadata privacy and once-per-episode alert fixtures. |
| `runnerSupervisor.test.mjs` | D7889: ephemeral enrollment, credential inheritance and eligibility-first drain actions; kept outside the Merge Control import boundary. |
| `ciFailures.mjs` | D5502: bounded test identities, safe reproductions and exact-base evidence attribution. |
| `ciFailureReporter.mjs` | D5502: node:test JSONL evidence beside TAP without assertion values or stacks. |
| `ciFailureCollector.mjs` | D5502: bounded Actions artifact reads, archive validation and tested-base comparison. |
| `ciFailures.test.mjs` | D5502: identity, missing evidence, archive, cancellation and real runner exit regressions. |
| `guardCatalog.mjs` | D5505: ordered catalog access shared by guard readers and wiring tests. |
| `guardRunner.mjs` | D5505: independent guard execution, prerequisites, process-group interruption and bounded metadata. |
| `guardRunner.test.mjs` | D5505: multi-failure, prerequisite, real signal, clean-run and preserved-command contracts. |
| `guardEvidence5505.test.mjs` | D5505: guard evidence normalization, exact-command inheritance and rest-part continuation. |
| `queueDeadline.mjs` | D5974: bounded native queue membership and exact-head check evidence for the response-deadline warning. |
| `queueTimeoutReport.test.mjs` | D5975: deterministic per-SHA latency, coverage gaps and unknown outcome regression checks. |
