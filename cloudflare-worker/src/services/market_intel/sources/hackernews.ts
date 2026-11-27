/**
   * Task #14 (AA-1) — Hacker News story velocity connector.
   *
   * Cadence: daily. Dimensions: sentiment, demand. Weight: 0.45.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_HACKERNEWS=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';
  import { buildLiveRows, daysAgoUnix, fetchJson, saturate, UA } from './_live';

  const KEY = 'hackernews';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'sentiment',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/hackernews',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "Hacker News story velocity",
    category: 'web_signals',
    cadence: 'daily',
    dimensions: ['sentiment', 'demand'],
    weight: 0.45,
    daily_cap: 5000,
    status: 'live',
    fetchLive: async (_env, { sectors }) =>
      buildLiveRows({
        sectors,
        key: KEY,
        metric_key: 'sentiment',
        perSector: async (_sector, query) => {
          const url =
            `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
            `&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${daysAgoUnix(30)}`)}&hitsPerPage=1`;
          const j = await fetchJson<{ nbHits?: number; hits?: Array<{ objectID?: string }> }>(url, {
            headers: { 'User-Agent': UA, Accept: 'application/json' },
          });
          const count = j.nbHits ?? 0;
          const id = j.hits?.[0]?.objectID;
          if (!count || !id) return null;
          return { value: saturate(count, 25), raw: count, citation_url: `https://news.ycombinator.com/item?id=${id}` };
        },
      }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  