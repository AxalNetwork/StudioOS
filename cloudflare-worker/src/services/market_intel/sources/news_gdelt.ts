/**
   * Task #14 (AA-1) — GDELT global news graph connector.
   *
   * Cadence: hourly. Dimensions: sentiment. Weight: 0.45.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_NEWS_GDELT=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'news_gdelt';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'sentiment',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/news_gdelt',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "GDELT global news graph",
    category: 'web_signals',
    cadence: 'hourly',
    dimensions: ['sentiment'],
    weight: 0.45,
    daily_cap: 5000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real GDELT global news graph client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  