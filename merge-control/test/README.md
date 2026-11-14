# Merge Control tests

| File | Purpose |
| --- | --- |
| `control.test.ts` | Real SQLite state, restart, deduplication, retries, signatures and policy. |
| `runtime-loader.mjs` | Node-only platform base-class adapter; never imported by production. |

Wrangler local-runtime smoke checks and packaging are recorded in D5618.
