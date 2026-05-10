/**
   * Task #14 (AA-1) — NewsAPI English headlines connector.
   *
   * Cadence: hourly. Dimensions: sentiment. Weight: 0.4.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_NEWSAPI=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'newsapi';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'sentiment',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/newsapi',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "NewsAPI English headlines",
    category: 'web_signals',
    cadence: 'hourly',
    dimensions: ['sentiment'],
    weight: 0.4,
    paid: true,
  daily_cap: 1000,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('newsapi_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  