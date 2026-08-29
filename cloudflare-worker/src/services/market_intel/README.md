# services/market_intel — market-intelligence ingestion

Pulls from external sources, extracts structured signals, scores and caches
them. Served by `cloudflare-worker/src/routes/market_intel.ts` (authenticated, tier-gated) and
`cloudflare-worker/src/routes/market_intel_public.ts`.

| File | What it does |
| --- | --- |
| `registry.ts` | Which sources are enabled. |
| `aggregator.ts` | Runs the sources and collects results. |
| `reducer.ts` | Folds raw results into signals. |
| `scoring.ts` | Ranks them. |
| `digest.ts` | The periodic digest. |
| `cache.ts` | Caching layer. |
| `quota.ts` | Per-caller budgets. |
| `schema.ts`, `extractor_schema.ts` | The stored shapes. |
| `sources/` | Where signals come from — see its README. |
| `extractors/` | What is pulled out of a source — see its README. |

## The rule

**Every signal carries its provenance.** A claim on screen traces to the source
that produced it, and a signal with no source does not render. An inference
drawn from signals is labelled as inferred, separately from the evidence — the
distinction is the product, and collapsing it turns intelligence into assertion.
