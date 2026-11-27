/**
 * Eurostat regional series connector (P1 free source).
 *
 * Fetches EU27 GERD (% of GDP, latest period) once from the JSON-stat
 * dissemination API and replicates it across every sector as a macro
 * capital/talent backdrop. Set MI_FLAG_EUROSTAT=live to engage fetchLive;
 * otherwise the deterministic stub keeps the pipeline exercisable in dev.
 *
 * D7707 — the stored figure is R&D spending as a share of GDP (rd_e_gerdtot,
 * `PC_GDP`, EU27_2020), stored under the key `capital`. Its period is read
 * from the time index of the SAME key as the value: JSON-stat value keys are
 * sparse, so the last value is not necessarily the last year listed.
 * `published_at` is the response's `updated`. A response without a readable
 * time dimension stores a null period.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, normalisePeriod, publishedDate, UA } from './_live';

const KEY = 'eurostat';
const SERIES = 'rd_e_gerdtot sectperf=TOTAL unit=PC_GDP geo=EU27_2020';
const SERIES_NAME = 'Gross domestic expenditure on R&D (GERD), % of GDP, EU27';
/** Fixed divisor: 6 % of GDP maps to 1.0 before clamping to 0.05..0.95. */
const DIVISOR = 6;

type JsonStat = {
  value?: Record<string, number> | number[];
  id?: string[];
  size?: number[];
  updated?: string;
  dimension?: Record<string, { category?: { index?: Record<string, number> | string[] } }>;
};

/**
 * D7707 — the period of flat value key `key` in a JSON-stat 2.0 dataset: its
 * position on the `time` dimension, from `id`, `size` and the time
 * category's index. Null when the response does not describe it.
 */
export function eurostatValuePeriod(j: JsonStat | undefined, key: string | undefined): ReturnType<typeof normalisePeriod> {
  if (!j || key === undefined) return null;
  const ids = j.id, sizes = j.size;
  if (!Array.isArray(ids) || !Array.isArray(sizes) || ids.length !== sizes.length) return null;
  const at = ids.indexOf('time');
  if (at < 0) return null;
  const flat = Number(key);
  if (!Number.isInteger(flat) || flat < 0) return null;
  let stride = 1;
  for (let i = at + 1; i < sizes.length; i++) stride *= Number(sizes[i]) || 0;
  if (!stride || !sizes[at]) return null;
  const pos = Math.floor(flat / stride) % sizes[at];
  const index = j.dimension?.time?.category?.index;
  const label = Array.isArray(index)
    ? index[pos]
    : index ? Object.keys(index).find((k) => index[k] === pos) : undefined;
  return normalisePeriod(label);
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
      citation_url: 'https://axal.vc/market-intel/sources/eurostat',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'Eurostat regional series',
  category: 'public_data',
  cadence: 'weekly',
  dimensions: ['capital', 'talent'],
  weight: 0.5,
  daily_cap: 1000,
  status: 'live',
  fetchLive: async (_env, { sectors }) =>
    buildUniformRows({
      sectors,
      key: KEY,
      metric_key: 'capital',
      unit: 'pct',
      coverage_area: 'EU27',
      fetchOne: async () => {
        const url =
          'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/rd_e_gerdtot' +
          '?format=JSON&sectperf=TOTAL&unit=PC_GDP&geo=EU27_2020';
        const j = await fetchJson<JsonStat>(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        // The same value as before D7707 (the last one), now with its own key.
        const keys = j?.value ? Object.keys(j.value) : [];
        const lastKey = keys.length ? keys[keys.length - 1] : undefined;
        const v = lastKey !== undefined ? (j!.value as Record<string, number>)[lastKey] : undefined;
        if (v == null || !isFinite(v)) return null;
        const period = eurostatValuePeriod(j, lastKey);
        return {
          value: clamp01(v / DIVISOR),
          raw: v,
          citation_url: 'https://ec.europa.eu/eurostat/databrowser/view/rd_e_gerdtot/',
          observed_period: period?.observed_period ?? null,
          observed_period_end: period?.observed_period_end ?? null,
          published_at: publishedDate(j?.updated),
          payload: { series: SERIES, series_name: SERIES_NAME, divisor: DIVISOR },
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
