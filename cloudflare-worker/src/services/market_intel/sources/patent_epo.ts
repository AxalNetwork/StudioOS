/**
   * Task #14 (AA-1) — EPO patent grants connector.
   *
   * Cadence: weekly. Dimensions: research, supply. Weight: 0.5.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_PATENT_EPO=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'patent_epo';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'research',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/patent_epo',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "EPO patent grants",
    category: 'research',
    cadence: 'weekly',
    dimensions: ['research', 'supply'],
    weight: 0.5,
    daily_cap: 1000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real EPO patent grants client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  