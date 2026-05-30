/**
 * Crossref publication-velocity connector (P1 free source, NEW).
 *
 * Counts recent scholarly works per sector via the keyless Crossref Works
 * API (polite pool — we pass a `mailto`). One real count + DOI citation per
 * sector. Set MI_FLAG_CROSSREF=live to engage fetchLive; otherwise the
 * deterministic stub keeps the pipeline exercisable in dev.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildLiveRows, contactEmail, daysAgoISO, fetchJson, saturate, UA } from './_live';

const KEY = 'crossref';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'research',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.55),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/crossref',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'Crossref publication velocity',
  category: 'research',
  cadence: 'daily',
  dimensions: ['research'],
  weight: 0.6,
  daily_cap: 50000,
  status: 'live',
  fetchLive: async (env, { sectors }) =>
    buildLiveRows({
      sectors,
      key: KEY,
      metric_key: 'research',
      perSector: async (_sector, query) => {
        const from = daysAgoISO(30);
        const url =
          `https://api.crossref.org/works?query=${encodeURIComponent(query)}` +
          `&filter=from-pub-date:${from}&rows=1&mailto=${encodeURIComponent(contactEmail(env))}`;
        const j = await fetchJson<{
          message?: { 'total-results'?: number; items?: Array<{ DOI?: string }> };
        }>(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        const count = j.message?.['total-results'] ?? 0;
        const doi = j.message?.items?.[0]?.DOI;
        if (!count || !doi) return null;
        return {
          value: saturate(count, 800),
          raw: count,
          citation_url: `https://doi.org/${doi}`,
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
