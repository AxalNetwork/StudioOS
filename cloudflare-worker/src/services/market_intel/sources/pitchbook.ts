/**
   * Task #14 (AA-1) — PitchBook deal flow connector.
   *
   * Cadence: daily. Dimensions: capital, supply. Weight: 0.9.
 * Paid contract — fetchLive throws until billing engaged.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_PITCHBOOK=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'pitchbook';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'capital',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.6),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/pitchbook',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "PitchBook deal flow",
    category: 'capital_market',
    cadence: 'daily',
    dimensions: ['capital', 'supply'],
    weight: 0.9,
    paid: true,
  daily_cap: 500,
    fetchLive: async () => {
      // Paid contract — refuse to call provider until billing wired up.
      throw new Error('pitchbook_paid_contract_not_signed');
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  