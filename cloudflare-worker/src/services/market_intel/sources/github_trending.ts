/**
   * Task #14 (AA-1) — GitHub trending repositories connector.
   *
   * Cadence: daily. Dimensions: supply, research. Weight: 0.6.
   *
   * The stub emits one normalised row per sector per run, derived from a
   * deterministic seed so the aggregator produces stable composites in
   * dev. Set MI_FLAG_GITHUB_TRENDING=live in production env to engage fetchLive.
   */
  import { registerSource, type CommonRow } from '../registry';
  import { row, seededAround, doy } from './_helpers';
  import { buildLiveRows, daysAgoISO, fetchJson, optEnv, saturate, UA } from './_live';

  const KEY = 'github_trending';

  function buildRows(sectors: string[], now: Date): CommonRow[] {
    const day = doy(now);
    return sectors.map((sector) =>
      row({
        source_key: KEY,
        sector,
        metric_key: 'supply',
        metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.6),
        ts: now.toISOString(),
        citation_url: 'https://axal.vc/market-intel/sources/github_trending',
      })
    );
  }

  registerSource({
    key: KEY,
    display_name: "GitHub trending repositories",
    category: 'web_signals',
    cadence: 'daily',
    dimensions: ['supply', 'research'],
    weight: 0.6,
    daily_cap: 5000,
    status: 'live',
    fetchLive: async (env, { sectors }) =>
      buildLiveRows({
        sectors,
        key: KEY,
        metric_key: 'supply',
        perSector: async (_sector, query) => {
          const q = `"${query}" in:name,description created:>=${daysAgoISO(30)}`;
          const url =
            `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
            `&sort=stars&order=desc&per_page=1`;
          const headers: Record<string, string> = {
            'User-Agent': UA,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          };
          // Optional PAT raises the search rate limit from 10/min to 30/min.
          const token = optEnv(env, 'GITHUB_TOKEN');
          if (token) headers.Authorization = `Bearer ${token}`;
          const j = await fetchJson<{ total_count?: number; items?: Array<{ html_url?: string }> }>(url, { headers });
          const count = j.total_count ?? 0;
          const repoUrl = j.items?.[0]?.html_url;
          if (!count || !repoUrl) return null;
          return { value: saturate(count, 300), raw: count, citation_url: repoUrl };
        },
      }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
  });
  