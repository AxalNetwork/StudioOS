/**
   * Task #14 (AA-1) — Semrush organic + paid connector.
   *
   * Cadence: weekly. Dimensions: demand. Weight: 0.5.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_SEMRUSH=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'semrush';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'demand',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/semrush',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Semrush organic + paid",
    category: 'web_signals',
    cadence: 'weekly',
    dimensions: ['demand'],
    weight: 0.5,
    paid: true,
  daily_cap: 500,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('semrush_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  