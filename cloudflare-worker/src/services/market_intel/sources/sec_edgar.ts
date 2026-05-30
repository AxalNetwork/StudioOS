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
  import { buildLiveRows, contactEmail, daysAgoISO, fetchJson, saturate, UA } from './_live';

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
    status: 'live',
    fetchLive: async (env, { sectors }) =>
      buildLiveRows({
        sectors,
        key: KEY,
        metric_key: 'capital',
        perSector: async (_sector, query) => {
          const url =
            `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}` +
            `&forms=S-1,10-K&startdt=${daysAgoISO(90)}&enddt=${daysAgoISO(0)}`;
          const j = await fetchJson<{
            hits?: {
              total?: { value?: number };
              hits?: Array<{ _id?: string; _source?: { ciks?: string[] } }>;
            };
          }>(url, {
            headers: { 'User-Agent': `${UA} ${contactEmail(env)}`, Accept: 'application/json' },
          });
          const count = j.hits?.total?.value ?? 0;
          const top = j.hits?.hits?.[0];
          if (!count || !top?._id) return null;
          const [accession, file] = top._id.split(':');
          const cik = top._source?.ciks?.[0];
          if (!accession || !cik) return null;
          const citation_url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${file ?? ''}`;
          return { value: saturate(count, 8), raw: count, citation_url };
        },
      }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  