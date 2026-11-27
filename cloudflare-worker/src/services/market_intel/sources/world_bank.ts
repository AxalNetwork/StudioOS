/**
 * World Bank macro-capital connector (P1 free source).
 *
 * Fetches gross capital formation (% of GDP, WLD aggregate, most-recent
 * value) once and replicates it across every sector as an honest macro
 * backdrop. Set MI_FLAG_WORLD_BANK=live to engage fetchLive; otherwise the
 * deterministic stub keeps the pipeline exercisable in dev.
 *
 * D7707 — the stored figure is gross capital formation (series
 * NE.GDI.TOTL.ZS, % of GDP, World), under the key `capital`. Its period is
 * the row's `date` (the year measured, not the fetch time) and its
 * `published_at` the header's `lastupdated`. A `date` that cannot be read
 * stores a null period.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, normalisePeriod, publishedDate, UA } from './_live';

const KEY = 'world_bank';
const SERIES = 'NE.GDI.TOTL.ZS';
const SERIES_NAME = 'Gross capital formation (% of GDP)';
/** Fixed divisor: 50 % of GDP maps to 1.0 before clamping to 0.05..0.95. */
const DIVISOR = 50;

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
      coverage_area: 'World',
      fetchOne: async () => {
        const url =
          `https://api.worldbank.org/v2/country/WLD/indicator/${SERIES}` +
          '?format=json&per_page=1&mrv=1';
        const j = await fetchJson<[{ lastupdated?: string } | null, Array<{ value: number | null; date?: string }> | null]>(
          url,
          { headers: { 'User-Agent': UA, Accept: 'application/json' } },
        );
        const obs = j?.[1]?.[0];
        const v = obs?.value;
        if (v == null || !isFinite(v)) return null;
        const period = normalisePeriod(obs?.date);
        return {
          value: clamp01(v / DIVISOR),
          raw: v,
          citation_url: `https://data.worldbank.org/indicator/${SERIES}`,
          observed_period: period?.observed_period ?? null,
          observed_period_end: period?.observed_period_end ?? null,
          published_at: publishedDate(j?.[0]?.lastupdated),
          payload: { series: SERIES, series_name: SERIES_NAME, divisor: DIVISOR },
        };
      },
    }),
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
