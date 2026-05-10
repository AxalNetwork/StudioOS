/**
   * Task #14 (AA-1) — Indeed job postings connector.
   *
   * Cadence: daily. Dimensions: talent. Weight: 0.55.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_INDEED=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'indeed';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'talent',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/indeed',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Indeed job postings",
    category: 'jobs',
    cadence: 'daily',
    dimensions: ['talent'],
    weight: 0.55,
    paid: true,
  daily_cap: 500,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('indeed_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  