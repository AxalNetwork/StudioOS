# services/market_intel — market-intelligence ingestion

Pulls from external sources, extracts structured signals, scores and caches
them. Served by `cloudflare-worker/src/routes/market_intel.ts` (authenticated, tier-gated) and
`cloudflare-worker/src/routes/market_intel_public.ts`.

D670 retired the `/market-intel` page and its weekly and monthly sector digest
(its module is deleted). Research and the Spinout Lab's market page still read
what this folder gathers, so ingestion, the reducer and the index recompute
keep running on their crons.

| File | What it does |
| --- | --- |
| `liveRows.ts` | Which rows and indexes are real (D538). Every read of `market_intel_rows` goes through `liveRowSql()`, every read of `market_intel_indexes` through `liveIndexSql()`. |
| `registry.ts` | Which sources are enabled. |
| `aggregator.ts` | Runs the sources and collects results. |
| `reducer.ts` | Folds raw results into signals. |
| `scoring.ts` | Ranks them. |
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

**No stub row is read (D538).** Every connector ships a synthetic `fetchStub`
for development; a stub row cites `https://axal.vc/market-intel/sources/<key>`
instead of a provider. A read of `market_intel_rows` filters with
`liveRowSql()`, a read of `market_intel_indexes` with `liveIndexSql()`
(indexes computed from live rows carry `basis = 'live'`, migration 379), and
`market_intel_live_rows_d538.test.ts` fails on any query in the Worker that
reads either table without it. A sector or dimension with no live data is
`null` with the reason, never a neutral 50.

**No stub row is stored in production (D538).** A source that is off, out of
quota or failing stores nothing, and the run logs why (`flag_off`,
`no_live_client`, `quota_exhausted`, `no_live_rows`, `fetch_failed`). The
stub runs only where `MI_STUB_ROWS = "on"`: put that in `.dev.vars` for local
data. A draft connector whose `fetchLive` still answers with stub rows stores
nothing either, because outside development only rows passing `isLiveRow` are
kept. Flipping a source live is `MI_FLAG_<KEY> = "live"` in BOTH var tables of
`wrangler.toml`; `market_intel_live_sources_d538.test.ts` fails on a flag in
one table only, or on a flagged source that reads a key or answers with stubs.
