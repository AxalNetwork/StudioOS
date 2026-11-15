# Merge Control policies

| File | Purpose |
| --- | --- |
| `lease.ts` | TTL lease admission, renewal/release and rising fences. |
| `classify.mjs` | D5607/D5620: the one pure path and test-weakening classifier, plain JavaScript so `scripts/merge-policy.mjs` and the Worker load the same file. Types in `classify.d.mts`. |
| `repairPolicy.ts` | D5622: bounded CI repair eligibility. |
| `reconcile.ts` | Queue branch, workflow, event and head-SHA cancellation constraints. |
