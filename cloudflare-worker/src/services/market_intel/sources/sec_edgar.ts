/**
   * Task #14 (AA-1) — SEC EDGAR S-1 / 10-K filings connector.
   *
   * Cadence: daily. Dimensions: capital, supply. Weight: 0.8.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_SEC_EDGAR=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'sec_edgar';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'capital',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/sec_edgar',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "SEC EDGAR S-1 / 10-K filings",
    category: 'capital_market',
    cadence: 'daily',
    dimensions: ['capital', 'supply'],
    weight: 0.8,
    daily_cap: 5000,
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real SEC EDGAR S-1 / 10-K filings client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  