/**
   * Task #14 (AA-1) — USPTO patent grants connector.
   *
   * Cadence: weekly. Dimensions: research, supply. Weight: 0.55.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_PATENT_USPTO=live in production env to engage fetchLive.
   */
  import type { Env } from '../../../types';
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';
  import { buildLiveRows, daysAgoISO, fetchJson, optEnv, saturate, UA } from './_live';

  const KEY = 'patent_uspto';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'research',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/patent_uspto',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "USPTO patent grants",
    category: 'research',
    cadence: 'weekly',
    dimensions: ['research', 'supply'],
    weight: 0.55,
    daily_cap: 1000,
    status: 'live',
    fetchLive: async (env, { sectors }) =>
      buildLiveRows({
        sectors,
        key: KEY,
        metric_key: 'research',
        perSector: async (_sector, query) => {
          const q = JSON.stringify({
            _and: [
              { _text_phrase: { patent_title: query } },
              { _gte: { patent_date: daysAgoISO(120) } },
            ],
          });
          const f = JSON.stringify(['patent_id', 'patent_title']);
          const o = JSON.stringify({ size: 1 });
          const url =
            `https://search.patentsview.org/api/v1/patent/?q=${encodeURIComponent(q)}` +
            `&f=${encodeURIComponent(f)}&o=${encodeURIComponent(o)}`;
          const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json' };
          // PatentsView's modern search API requires a free key; when unset
          // the request 403s and the source degrades to its stub.
          const apiKey = optEnv(env, 'PATENTSVIEW_API_KEY');
          if (apiKey) headers['X-Api-Key'] = apiKey;
          const j = await fetchJson<{
            total_hits?: number;
            count?: number;
            patents?: Array<{ patent_id?: string }>;
          }>(url, { headers });
          const count = j.total_hits ?? j.count ?? j.patents?.length ?? 0;
          const id = j.patents?.[0]?.patent_id;
          if (!count || !id) return null;
          return { value: saturate(count, 20), raw: count, citation_url: `https://patents.google.com/patent/US${id}` };
        },
      }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  