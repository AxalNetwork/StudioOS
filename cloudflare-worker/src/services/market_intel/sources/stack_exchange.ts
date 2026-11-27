/**
   * Task #14 (AA-1) — Stack Exchange tag activity connector.
   *
   * Cadence: daily. Dimensions: talent, sentiment. Weight: 0.4.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_STACK_EXCHANGE=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'stack_exchange';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'talent',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/stack_exchange',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Stack Exchange tag activity",
    category: 'web_signals',
    cadence: 'daily',
    dimensions: ['talent', 'sentiment'],
    weight: 0.4,
    daily_cap: 5000,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real Stack Exchange tag activity client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  