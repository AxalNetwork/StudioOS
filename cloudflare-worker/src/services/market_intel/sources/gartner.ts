/**
   * Task #14 (AA-1) — Gartner Hype / Magic Quadrant connector.
   *
   * Cadence: weekly. Dimensions: sentiment, demand. Weight: 0.7.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_GARTNER=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'gartner';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'sentiment',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.65),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/gartner',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Gartner Hype / Magic Quadrant",
    category: 'analyst',
    cadence: 'weekly',
    dimensions: ['sentiment', 'demand'],
    weight: 0.7,
    paid: true,
  daily_cap: 200,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('gartner_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  