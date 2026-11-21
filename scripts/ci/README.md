# CI helpers

These helpers run inside repository CI. They collect test evidence, enforce
provider boundaries, check queue refs and install pinned test or scanner tools.
They do not change production application state.

| File | Purpose |
| --- | --- |
| `download-test-timings.sh` | Load timing evidence only from an eligible main artifact. |
| `install-age-linux.sh` | Install the pinned and verified age CLI used by encryption tests. |
| `install-scanner.mjs` | Expose reviewed scanner metadata and job-private installation without caller-controlled versions or URLs (D5531). |
| `merge-test-deps.mjs` | Merge test dependency and timing artifacts deterministically (D5608). |
| `no-anthropic-in-prod.mjs` | Enforce the production Advisor provider boundary (D5339). |
| `queue-ref-alive.sh` | Distinguish a missing merge-queue ref from an unavailable remote. |
| `scanner-acquisition.mjs` | Verify cached and downloaded scanner archives before extraction or execution (D5531). |
| `scanner-tools.json` | Record the reviewed release URLs, versions and SHA256 pins. |
| `test-tracer-hooks.mjs` | Collect module dependency evidence through off-thread loader hooks (D5608). |
| `test-tracer-sqlite.mjs` | Record file-database dependencies while preserving the SQLite module interface (D5608). |
| `test-tracer.mjs` | Collect opt-in dependency and timing evidence from test processes (D5608). |
| `runners/` | Verified native runner bootstrap/profile contract and private enrollment runbook (D7885). |
| `runner-admission.mjs` | D7886: independently verify durable receipt, original source/plan, every merge-group constituent and exact child identity; unavailable authority denies. |
| `runner-execution.mjs` | D7886: exact-plan Worker execution, verified runtime/source, actual test-result truth and owned-run cleanup. |
| `macbook-admission.mjs` | Verify exact parent CI identity, active delegation and same-repository source provenance before the Mac runs candidate code (D7881). |
| `macbook-worker.mjs` | Delegate one Worker shard with startup/completion bounds, real-failure propagation and standard hosted fallback (D7881). |
| `agent-provenance.mjs` | Check the identity-chain trailers on every commit an `agent/**` pull request adds and write its provenance artifact (D8068). |
| `agent-provenance.test.mjs` | Hold the trailer parser to AGENTS.md § "Identity trailers" and run the check on fixture repositories (D8068). |

Scanner callers load the installer and pins from the trusted base commit,
never from a pull request checkout or cached executable. Archive reuse still
requires digest verification. Fast CI skips acquisition with its duplicate scan
in merge groups; the separate required scan remains responsible for the candidate.
