/**
   * Task #14 (AA-1) — Crunchbase rounds + companies connector.
   *
   * Cadence: daily. Dimensions: capital, supply. Weight: 0.75.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_CRUNCHBASE=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'crunchbase';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'capital',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/crunchbase',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Crunchbase rounds + companies",
    category: 'capital_market',
    cadence: 'daily',
    dimensions: ['capital', 'supply'],
    weight: 0.75,
    daily_cap: 1000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real Crunchbase rounds + companies client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  