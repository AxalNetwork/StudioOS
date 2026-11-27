/**
 * OECD productivity + R&D connector (P1 free source).
 *
 * Fetches GERD (% of GDP, OECD aggregate, latest observation) once from the
 * SDMX-JSON MSTI dataflow and replicates it across every sector as a macro
 * research/capital backdrop. Set MI_FLAG_OECD=live to engage fetchLive;
 * otherwise the deterministic stub keeps the pipeline exercisable in dev.
 *
 * D7707 — the stored figure is R&D spending as a share of GDP (MSTI GERD,
 * `PT_B1GQ`, OECD aggregate), stored under the key `capital`. Its period is
 * the observation's position on the response's TIME_PERIOD dimension; the
 * API sends no publication date, so `published_at` stays null. A response
 * without a readable time dimension stores a null period.
 *
 * NOTE: OECD's SDMX endpoint REQUIRES an `Accept-Language` header — without
 * it the API 500s with `languageTag1`.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, normalisePeriod, UA } from './_live';

const KEY = 'oecd';
const SERIES = 'DSD_MSTI@DF_MSTI OECD.A.G.PT_B1GQ';
const SERIES_NAME = 'Gross domestic expenditure on R&D (GERD), % of GDP, OECD aggregate';
/** Fixed divisor: 6 % of GDP maps to 1.0 before clamping to 0.05..0.95. */
const DIVISOR = 6;

type SdmxDimension = { id?: string; role?: string; values?: Array<{ id?: string }> };
type SdmxStructure = { dimensions?: { observation?: SdmxDimension[] } };

/**
 * D7707 — the period of observation `key` ('0:0:0:0:0:0:0'): the key's
 * position on the TIME_PERIOD dimension, read from the response's own
 * structure (SDMX-JSON 2.0 `structures[0]`, 1.0 `structure`). Null when the
 * response does not describe it.
 */
export function oecdObservationPeriod(
  data: { structures?: SdmxStructure[]; structure?: SdmxStructure } | undefined,
  key: string | undefined,
): ReturnType<typeof normalisePeriod> {
  if (!data || !key) return null;
  const dims = (data.structures?.[0] ?? data.structure)?.dimensions?.observation;
  if (!Array.isArray(dims)) return null;
  const at = dims.findIndex((d) => d?.id === 'TIME_PERIOD' || d?.role === 'time');
  if (at < 0) return null;
  const parts = key.split(':');
  if (parts.length !== dims.length) return null;
  const pos = Number(parts[at]);
  if (!Number.isInteger(pos) || pos < 0) return null;
  return normalisePeriod(dims[at].values?.[pos]?.id);
}

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
      coverage_area: 'OECD aggregate',
      fetchOne: async () => {
        const url =
          'https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_MSTI@DF_MSTI,1.0/' +
          'OECD.A.G.PT_B1GQ._Z._Z?lastNObservations=1&format=jsondata' +
          '&dimensionAtObservation=AllDimensions';
        const j = await fetchJson<{
          data?: {
            dataSets?: Array<{ observations?: Record<string, Array<number | null>> }>;
            structures?: SdmxStructure[];
            structure?: SdmxStructure;
          };
        }>(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' },
        });
        const obs = j?.data?.dataSets?.[0]?.observations;
        const firstKey = obs ? Object.keys(obs)[0] : undefined;
        const first = obs && firstKey !== undefined ? obs[firstKey] : undefined;
        const v = first?.[0];
        if (v == null || !isFinite(v)) return null;
        const period = oecdObservationPeriod(j?.data, firstKey);
        return {
          value: clamp01(v / DIVISOR),
          raw: v,
          citation_url:
            'https://data-explorer.oecd.org/vis?df[ds]=dsDisseminateFinalDMZ&df[id]=DSD_MSTI%40DF_MSTI',
          observed_period: period?.observed_period ?? null,
          observed_period_end: period?.observed_period_end ?? null,
          published_at: null,
          payload: { series: SERIES, series_name: SERIES_NAME, divisor: DIVISOR },
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
