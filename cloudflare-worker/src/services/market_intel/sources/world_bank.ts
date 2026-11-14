/**
 * World Bank macro-capital connector (P1 free source).
 *
 * Fetches gross capital formation (% of GDP, WLD aggregate, most-recent
 * value) once and replicates it across every sector as an honest macro
 * backdrop. Set MI_FLAG_WORLD_BANK=live to engage fetchLive; otherwise the
 * deterministic stub keeps the pipeline exercisable in dev.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, UA } from './_live';

const KEY = 'world_bank';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'capital',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/world_bank',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'World Bank macro indicators',
  category: 'public_data',
  cadence: 'weekly',
  dimensions: ['capital'],
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
          'https://api.worldbank.org/v2/country/WLD/indicator/NE.GDI.TOTL.ZS' +
          '?format=json&per_page=1&mrv=1';
        const j = await fetchJson<[unknown, Array<{ value: number | null }> | null]>(
          url,
          { headers: { 'User-Agent': UA, Accept: 'application/json' } },
        );
        const v = j?.[1]?.[0]?.value;
        if (v == null || !isFinite(v)) return null;
        return {
          value: clamp01(v / 50),
          raw: v,
          citation_url: 'https://data.worldbank.org/indicator/NE.GDI.TOTL.ZS',
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
