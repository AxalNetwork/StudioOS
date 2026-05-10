/**
   * Task #14 (AA-1) — BuiltWith tech adoption connector.
   *
   * Cadence: weekly. Dimensions: demand, supply. Weight: 0.5.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_BUILTWITH=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'builtwith';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'demand',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/builtwith',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "BuiltWith tech adoption",
    category: 'web_signals',
    cadence: 'weekly',
    dimensions: ['demand', 'supply'],
    weight: 0.5,
    paid: true,
  daily_cap: 500,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('builtwith_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  