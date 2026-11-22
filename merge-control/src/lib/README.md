# Merge Control policies

| File | Purpose |
| --- | --- |
| `lease.ts` | TTL lease admission, renewal/release and rising fences. |
| `classify.mjs` | D5607/D5620: the one pure path and test-weakening classifier, plain JavaScript so `scripts/merge-policy.mjs` and the Worker load the same file. Types in `classify.d.mts`. D8067: it also holds `PRIVILEGED_PATHS`, the one privileged-path list that T2, the landing bot's `PROTECTED`, CODEOWNERS and the ruleset read. |
| `repairPolicy.ts` | D5622: bounded CI repair eligibility. |
| `reconcile.ts` | Queue branch, workflow, event and head-SHA cancellation constraints. |
| `runnerScalePolicy.ts` | D7889: pure capped fleet proposals, durable reservation fences, eligibility-first drain and budget holds; no deployed router integration. |
| `ciCapacityPolicy.ts` | D7887: bounded shared-pool allocation, immutable receipts, generation fences and full expected-set authority. |
