# Merge Control tests

| File | Purpose |
| --- | --- |
| `control.test.ts` | Real SQLite state, restart, deduplication, retries, signatures and policy. |
| `policy_check_5620.test.ts` | D5620: one classifier, refused build without `policy_version`, T0/T1 pass, T2 and every failure never pass. |
| `repair_policy_5622.test.ts` | D5622: CI repair eligibility and breaker inputs. |
| `runtime-loader.mjs` | Node-only platform base-class adapter and stand-in for the build's `policy_version` define; never imported by production. |
| `ci_capacity.test.ts` | D7887: deterministic capacity, real SQLite recovery, timeout/fallback, provenance and aggregate tests. |
| `ci_capacity_auth_policy_8011.test.ts` | D8011: fake clock/network/crypto boundaries test bounded key refresh, durable reservations and verified receipt progress. |

Wrangler local-runtime smoke checks and packaging are recorded in D5618.
