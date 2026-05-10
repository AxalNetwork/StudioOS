/**
   * Task #14 (AA-1) — Reddit subreddit volume connector.
   *
   * Cadence: daily. Dimensions: sentiment, demand. Weight: 0.45.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_REDDIT=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'reddit';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'sentiment',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/reddit',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Reddit subreddit volume",
    category: 'web_signals',
    cadence: 'daily',
    dimensions: ['sentiment', 'demand'],
    weight: 0.45,
    daily_cap: 1000,
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real Reddit subreddit volume client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  