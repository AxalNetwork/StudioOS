/**
   * Task #14 (AA-1) — US BLS occupational stats connector.
   *
   * Cadence: weekly. Dimensions: talent. Weight: 0.6.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_BLS=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'bls';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'talent',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/bls',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "US BLS occupational stats",
    category: 'public_data',
    cadence: 'weekly',
    dimensions: ['talent'],
    weight: 0.6,
    daily_cap: 1000,
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real US BLS occupational stats client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  