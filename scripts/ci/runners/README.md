# Verified runner bootstrap (D7885)

A privileged operator prepares one Linux x64 or native ARM64 Mac with the same
profile contract. This directory does not change workflows, group permissions,
required checks, provider resources or shard counts.

| File | Purpose |
| --- | --- |
| `bootstrap.sh` | Prepare pinned tools, verify native capabilities, and manage privately approved organization registration and service lifecycle. |
| `job-container.mjs` | D7905: inactive trusted-host Linux container boundary, actual inspection adapter and exact-ID cleanup; Mac and enrollment remain blocked pending canary. |
| `profiles.json` | Schema v1 profile enums, shared AND labels and reviewed archive digests; hosted Ubuntu is a separate pool. |

Start at [RUNNER_BOOTSTRAP.md](../../../documentation/operations/RUNNER_BOOTSTRAP.md).
Install/verify need no runner token, provider API or fleet manager. Register/start
require the trusted executor from #7886 on main, a recent private operator
receipt, verified job isolation, and a scheduled bounded pilot. Local preflight
is not evidence of online/idle eligibility or live CI capacity.
