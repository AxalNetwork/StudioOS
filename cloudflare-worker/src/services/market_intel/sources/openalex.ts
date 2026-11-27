/**
 * OpenAlex research-velocity connector (P0 free source).
 *
 * Counts recent scholarly works per sector via the keyless OpenAlex Works
 * API (polite pool — we pass a `mailto`). Set MI_FLAG_OPENALEX=live to engage
 * fetchLive; otherwise the deterministic stub runs so the pipeline stays
 * exercisable in dev.
 *
 * D7707 — each row's period is the window queried, to the day:
 * `from_publication_date` 30 days back to the retrieval day. OpenAlex is sent
 * no end bound, so the end is the day it was asked, not a bound it applied.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildLiveRows, contactEmail, fetchJson, saturate, windowPeriod, UA } from './_live';

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
  fetchLive: async (env, { sectors }) => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const period = windowPeriod(from, now.toISOString().slice(0, 10));
    return buildLiveRows({
      sectors,
      key: KEY,
      metric_key: 'research',
      now,
      perSector: async (_sector, query) => {
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
        return {
          value: saturate(count, 1500),
          raw: count,
          citation_url: id,
          observed_period: period?.observed_period ?? null,
          observed_period_end: period?.observed_period_end ?? null,
        };
      },
    });
  },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
