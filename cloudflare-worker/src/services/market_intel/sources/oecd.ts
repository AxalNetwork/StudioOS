/**
 * OECD productivity + R&D connector (P1 free source).
 *
 * Fetches GERD (% of GDP, OECD aggregate, latest observation) once from the
 * SDMX-JSON MSTI dataflow and replicates it across every sector as a macro
 * research/capital backdrop. Set MI_FLAG_OECD=live to engage fetchLive;
 * otherwise the deterministic stub keeps the pipeline exercisable in dev.
 *
 * NOTE: OECD's SDMX endpoint REQUIRES an `Accept-Language` header — without
 * it the API 500s with `languageTag1`.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, UA } from './_live';

const KEY = 'oecd';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'capital',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/oecd',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'OECD productivity + R&D',
  category: 'public_data',
  cadence: 'weekly',
  dimensions: ['capital', 'research'],
  weight: 0.55,
  daily_cap: 1000,
  status: 'live',
  fetchLive: async (_env, { sectors }) =>
    buildUniformRows({
      sectors,
      key: KEY,
      metric_key: 'capital',
      unit: 'pct',
      fetchOne: async () => {
        const url =
          'https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_MSTI@DF_MSTI,1.0/' +
          'OECD.A.G.PT_B1GQ._Z._Z?lastNObservations=1&format=jsondata' +
          '&dimensionAtObservation=AllDimensions';
        const j = await fetchJson<{
          data?: { dataSets?: Array<{ observations?: Record<string, Array<number | null>> }> };
        }>(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' },
        });
        const obs = j?.data?.dataSets?.[0]?.observations;
        const first = obs ? Object.values(obs)[0] : undefined;
        const v = first?.[0];
        if (v == null || !isFinite(v)) return null;
        return {
          value: clamp01(v / 6),
          raw: v,
          citation_url:
            'https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_MSTI%40DF_MSTI',
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
