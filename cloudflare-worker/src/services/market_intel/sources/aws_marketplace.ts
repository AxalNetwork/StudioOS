/**
   * Task #14 (AA-1) — AWS Marketplace listings connector.
   *
   * Cadence: weekly. Dimensions: supply. Weight: 0.45.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_AWS_MARKETPLACE=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';

  const KEY = 'aws_marketplace';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'supply',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/aws_marketplace',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "AWS Marketplace listings",
    category: 'commerce',
    cadence: 'weekly',
    dimensions: ['supply'],
    weight: 0.45,
    daily_cap: 500,
    status: 'draft',
    fetchLive: async (_env, { sectors }) => {
      // TODO: wire real AWS Marketplace listings client. Falls back to stub semantics
      // until a contract / API token is in place — keeps the read pipeline
      // exercisable without exposing a half-finished provider in prod.
      return buildRows(sectors, new Date());
    },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  