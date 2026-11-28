# Merge Control policies

| File | Purpose |
| --- | --- |
| `lease.ts` | TTL lease admission, renewal/release and rising fences. |
| `classify.mjs` | D5607/D5620: the one pure path and test-weakening classifier, plain JavaScript so `scripts/merge-policy.mjs` and the Worker load the same file. Types in `classify.d.mts`. D8067: it also holds `PRIVILEGED_PATHS`, the one privileged-path list that T2, the landing bot's `PROTECTED`, CODEOWNERS and the ruleset read. |
| `repairPolicy.ts` | D5622: bounded CI repair eligibility. |
| `patchGuard.mjs` | D5622-p2: the red-PR repair patch guard, pure. `validate()` refuses a change to a test, fixture, baseline, allowlist, guard, shard list or timeout, a deletion or rename, an added skip/only/todo, fewer tests or assertions, binary or mode changes, privileged paths and anything over the owner's limits (unset refuses all). Plain JavaScript, like `classify.mjs`, so the Actions apply job loads it. |
| `reconcile.ts` | Queue branch, workflow, event and head-SHA cancellation constraints. |
| `runnerScalePolicy.ts` | D7889: pure capped fleet proposals, durable reservation fences, eligibility-first drain and budget holds; no deployed router integration. |
| `ciCapacityPolicy.ts` | D7887: bounded shared-pool allocation, immutable receipts, generation fences and full expected-set authority. |
| `ciCapacityAuthPolicy.ts` | D8011: inactive bounded issuer-key cache and atomic-store admission budgets; verified owned-receipt continuation never caches token authority. |
