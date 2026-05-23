/**
   * Task #14 (AA-1) — arXiv preprints connector.
   *
   * Cadence: daily. Dimensions: research. Weight: 0.55.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_ARXIV=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'arxiv';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'research',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/arxiv',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "arXiv preprints",
    category: 'research',
    cadence: 'daily',
    dimensions: ['research'],
    weight: 0.55,
    daily_cap: 5000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real arXiv preprints client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  