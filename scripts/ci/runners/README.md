# Verified runner bootstrap (D7885)

A privileged operator prepares one Linux x64 or native ARM64 Mac with the same
profile contract. This directory does not change workflows, group permissions,
required checks, provider resources or shard counts.

| File | Purpose |
| --- | --- |
| `bootstrap.sh` | Prepare pinned tools, verify native capabilities, and manage privately approved organization registration and service lifecycle. |
| `job-container.mjs` | D7905: inactive trusted-host Linux container boundary, actual inspection adapter and exact-ID cleanup; Mac and enrollment remain blocked pending canary. |
| `executor-isolation.mjs` | D7905: binds the container boundary to the trusted executor for `linux-x64` only: a pre-checkout readiness port and the live-container adapter. Not isolation proof by itself. |
| `recovery-store.mjs` | D7905: durable exact-container ownership records in the listener's private state directory, outside run and workspace directories; removed only after the engine reports the container gone. Also holds a create intent, written before `docker create`, so an unconfirmed create is reconciled by its exact name (D7905-p6). |
| `trace-exporter.mjs` | D7905/D8010: bounded streaming USTAR reader and the supervisor's exporter: pause, `docker cp` of `/work/traces`, private 0400 stage, the completion envelope written last, then published. Never extracts. |
| `hosted-readers.mjs` | D8345: trusted OIDC/Actions acquisition, S09 readiness/live inspection and authenticated included-evidence projection; missing hosted job/denial evidence and authority producer remain refusing gates. Without a trusted JobContainer for the receipt's profile it refuses before any outbound call (D8345-p1). |
| `hosted-verification.mjs` | D8007 (S30): hosted isolation-verification port for `hosted`/`github-8`; trusted readers only, no default positive reader, returns the verified boundary identity. Never execution or dispatch authority. |
| `hosted-verification-8007.fixture.mjs` | D8007 (S30): manual behavioural fixture against pinned published sources; all provider, OIDC and native facts simulated. |
| `profiles.json` | Schema v1 profile enums, shared AND labels and reviewed archive digests; hosted Ubuntu is a separate pool. |
| `verify-capacity.mjs` | D7888/D7974: bounded GET-only timing observations and structural six-Worker pilot audit; never aggregate-check authority. |
| `ephemeral-supervisor.mjs` | D7889: pure one-job enrollment/drain proposals and filtered environment; no live issuer or process launcher. |

Start at [RUNNER_BOOTSTRAP.md](../../../documentation/operations/RUNNER_BOOTSTRAP.md).
Install/verify need no runner token, provider API or fleet manager. Register/start
require the trusted executor from #7886 on main, a recent private operator
receipt, verified job isolation, and a scheduled bounded pilot. Local preflight
is not evidence of online/idle eligibility or live CI capacity.

`catalog.mjs` translates this trusted registry into executor profiles and the coordinator approvedGroupId; unverified self-hosted groups fail closed (D7906).
