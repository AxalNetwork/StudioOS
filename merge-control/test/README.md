# Merge Control tests

| File | Purpose |
| --- | --- |
| `control.test.ts` | Real SQLite state, restart, deduplication, retries, signatures and policy. |
| `policy_check_5620.test.ts` | D5620: one classifier, refused build without `policy_version`, T0/T1 pass, T2 and every failure never pass. |
| `repair_policy_5622.test.ts` | D5622: CI repair eligibility and breaker inputs. |
| `runtime-loader.mjs` | Node-only platform base-class adapter and stand-in for the build's `policy_version` define; never imported by production. |
| `runner_scale_7889.test.ts` | D7889: simulated 1/5/10/50 stages, CAS/restart, drain races, lifecycle budgets, complete inventory and credential-free supervisor actions. |
| `ci_capacity.test.ts` | D7887: deterministic capacity, real SQLite recovery, timeout/fallback, provenance and aggregate tests. |
| `ci_capacity_auth_policy_8011.test.ts` | D8011: fake clock/network/crypto boundaries test bounded key refresh, durable reservations and verified receipt progress. |
| `ci_capacity_retention_8339.test.ts` | D8339: guarded age and count retention of the request store against real SQLite and the real publication outbox; nothing owed is removed and every identity fence survives. |
| `ci_capacity_compact_failed_8378.test.ts` | D8378: the bounded, indexed read of failed compact records against real SQLite and the real store; order, cursor, clamp, query plan and no writes. |
| `ci_capacity_compact_8348.test.ts` | D8348: handoff of a passing request to a compact record against real SQLite and the real coordinator; atomicity, caps, sticky failure, cursored expiry and paging. |

Wrangler local-runtime smoke checks and packaging are recorded in D5618.
