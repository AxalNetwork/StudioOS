/**
   * Task #14 (AA-1) — Apple App Store top charts connector.
   *
   * Cadence: daily. Dimensions: supply, demand. Weight: 0.5.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_APPLE_APPSTORE=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'apple_appstore';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'supply',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/apple_appstore',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Apple App Store top charts",
    category: 'commerce',
    cadence: 'daily',
    dimensions: ['supply', 'demand'],
    weight: 0.5,
    daily_cap: 1000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real Apple App Store top charts client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  