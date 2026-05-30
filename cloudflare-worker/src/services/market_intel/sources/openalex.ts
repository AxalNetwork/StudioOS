/**
 * OpenAlex research-velocity connector (P0 free source).
 *
 * Counts recent scholarly works per sector via the keyless OpenAlex Works
 * API (polite pool — we pass a `mailto`). Set MI_FLAG_OPENALEX=live to engage
 * fetchLive; otherwise the deterministic stub runs so the pipeline stays
 * exercisable in dev.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildLiveRows, contactEmail, daysAgoISO, fetchJson, saturate, UA } from './_live';

const KEY = 'openalex';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'research',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/openalex',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'OpenAlex research velocity',
  category: 'research',
  cadence: 'daily',
  dimensions: ['research'],
  weight: 0.7,
  daily_cap: 100000,
  status: 'live',
  fetchLive: async (env, { sectors }) =>
    buildLiveRows({
      sectors,
      key: KEY,
      metric_key: 'research',
      perSector: async (_sector, query) => {
        const from = daysAgoISO(30);
        const filter = `title_and_abstract.search:${query},from_publication_date:${from}`;
        const url =
          `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
          `&per_page=1&mailto=${encodeURIComponent(contactEmail(env))}`;
        const j = await fetchJson<{ meta?: { count?: number }; results?: Array<{ id?: string }> }>(
          url,
          { headers: { 'User-Agent': UA, Accept: 'application/json' } },
        );
        const count = j.meta?.count ?? 0;
        const id = j.results?.[0]?.id;
        if (!count || !id) return null;
        return { value: saturate(count, 1500), raw: count, citation_url: id };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
