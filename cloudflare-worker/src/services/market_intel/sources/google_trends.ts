/**
   * Task #14 (AA-1) — Google Trends interest-over-time connector.
   *
   * Cadence: daily. Dimensions: demand, sentiment. Weight: 0.6.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_GOOGLE_TRENDS=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'google_trends';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'demand',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/google_trends',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Google Trends interest-over-time",
    category: 'web_signals',
    cadence: 'daily',
    dimensions: ['demand', 'sentiment'],
    weight: 0.6,
    daily_cap: 1000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real Google Trends interest-over-time client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  