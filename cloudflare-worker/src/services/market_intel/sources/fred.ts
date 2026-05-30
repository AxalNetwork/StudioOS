/**
 * FRED macro-capital connector (P1 free source, NEW).
 *
 * Fetches the latest effective federal funds rate (series FEDFUNDS) once and
 * replicates an inverted risk-capital signal across every sector (lower
 * fed-funds rate → more risk capital). Requires a free FRED_API_KEY; when
 * unset the source stays on its deterministic stub (does NOT throw). Set
 * MI_FLAG_FRED=live to engage fetchLive.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, optEnv, UA } from './_live';

const KEY = 'fred';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'capital',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/fred',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'FRED macro rates',
  category: 'public_data',
  cadence: 'weekly',
  dimensions: ['capital'],
  weight: 0.55,
  daily_cap: 1000,
  status: 'live',
  fetchLive: async (env, { sectors }) => {
    const apiKey = optEnv(env, 'FRED_API_KEY');
    // Free key required — without it, degrade to the stub rather than throw.
    if (!apiKey) return buildRows(sectors, new Date());
    return buildUniformRows({
      sectors,
      key: KEY,
      metric_key: 'capital',
      unit: 'pct',
      fetchOne: async () => {
        const url =
          'https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS' +
          `&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=1`;
        const j = await fetchJson<{ observations?: Array<{ value?: string }> }>(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        });
        const raw = j?.observations?.[0]?.value;
        if (raw == null || raw === '.') return null;
        const v = parseFloat(raw);
        if (!isFinite(v)) return null;
        return {
          value: clamp01(1 - v / 12),
          raw: v,
          citation_url: 'https://fred.stlouisfed.org/series/FEDFUNDS',
        };
      },
    });
  },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
