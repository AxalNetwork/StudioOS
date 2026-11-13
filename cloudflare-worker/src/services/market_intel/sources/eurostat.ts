/**
 * Eurostat regional series connector (P1 free source).
 *
 * Fetches EU27 GERD (% of GDP, latest period) once from the JSON-stat
 * dissemination API and replicates it across every sector as a macro
 * capital/talent backdrop. Set MI_FLAG_EUROSTAT=live to engage fetchLive;
 * otherwise the deterministic stub keeps the pipeline exercisable in dev.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, UA } from './_live';

const KEY = 'eurostat';

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
      fetchOne: async () => {
        const url =
          'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/rd_e_gerdtot' +
          '?format=JSON&sectperf=TOTAL&unit=PC_GDP&geo=EU27_2020';
        const j = await fetchJson<{ value?: Record<string, number> }>(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        const vals = j?.value ? Object.values(j.value) : [];
        const v = vals.length ? vals[vals.length - 1] : undefined;
        if (v == null || !isFinite(v)) return null;
        return {
          value: clamp01(v / 6),
          raw: v,
          citation_url: 'https://ec.europa.eu/eurostat/databrowser/view/rd_e_gerdtot/',
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
