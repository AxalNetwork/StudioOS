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
