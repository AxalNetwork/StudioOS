# market_intel/sources — where signals come from

One module per external source. `../registry.ts` decides which are enabled and
`../aggregator.ts` runs them.

A source module fetches, normalises, and hands raw material to the extractors.
It does not score, rank or interpret — that happens downstream, so that the
same source can feed several extractors without one of them biasing the fetch.

## Adding a source

1. Fetch defensively. Every source is a third party that can be slow, rate-limit
   you, change its shape, or return nothing. None of those may take down a
   request — return empty and log.
2. Respect the quota in `../quota.ts`.
3. Attach provenance to everything you return. A signal that cannot say where it
   came from will not be rendered, by design.
4. Never invent a field to fill a gap in a response. A missing value stays
   missing all the way to the screen, where it reads as unknown.

## What a stored row says it measures (D7707)

`ts` is the fetch time, as it always was, and the scorer reads it. Beside it a
row from `_live.ts`'s builders carries:

- `retrieved_at`: the same fetch time, in its own column.
- `observed_period` and `observed_period_end`: the period the provider says the
  figure measures, as `YYYY`, `YYYY-Qn`, `YYYY-MM`, or `YYYY-MM-DD/YYYY-MM-DD`
  for a queried window, and its last day. Read it with `normalisePeriod` or
  `windowPeriod`. A response whose period cannot be read stores null, never a
  guess.
- `published_at`: the provider's own last-updated date (`publishedDate`), or
  null. Never the fetch time.
- `scope`: `sector` from `buildLiveRows`, `context` from `buildUniformRows`,
  which also takes the figure's `coverage_area`.

Per source: World Bank reads the row's `date` and the header's `lastupdated`;
OECD reads the observation's `TIME_PERIOD` position and sends no publication
date; Eurostat reads the time index of the same key as the value (value keys
are sparse) and `updated`. Crossref, OpenAlex and arXiv store the window
queried, to the day. Crossref and OpenAlex are sent no end bound, so the end
of their window is the retrieval day, not a bound the provider applied.

A macro connector puts its series code, the series' real name and its fixed
divisor in `payload` (stored as `payload_json`) and in a comment beside the
divisor. The World Bank figure is gross capital formation; OECD and Eurostat
are R&D spending as a share of GDP, stored under the key `capital`.
