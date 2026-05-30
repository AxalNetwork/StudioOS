/**
 * US BLS occupational stats connector (P1 free source).
 *
 * Fetches the latest US unemployment rate (series LNS14000000) once and
 * replicates an inverted talent-tightness signal across every sector
 * (lower unemployment → tighter talent market). Requires a free
 * BLS_API_KEY; when unset the source stays on its deterministic stub
 * (does NOT throw). Set MI_FLAG_BLS=live to engage fetchLive.
 */
import { registerSource, type CommonRow } from '../registry';
import { row, seededAround, doy } from './_helpers';
import { buildUniformRows, clamp01, fetchJson, optEnv, UA } from './_live';

const KEY = 'bls';

function buildRows(sectors: string[], now: Date): CommonRow[] {
  const day = doy(now);
  return sectors.map((sector) =>
    row({
      source_key: KEY,
      sector,
      metric_key: 'talent',
      metric_value: seededAround(`${KEY}|${sector}|${day}`, 0.5),
      ts: now.toISOString(),
      citation_url: 'https://axal.vc/market-intel/sources/bls',
    }),
  );
}

registerSource({
  key: KEY,
  display_name: 'US BLS occupational stats',
  category: 'public_data',
  cadence: 'weekly',
  dimensions: ['talent'],
  weight: 0.6,
  daily_cap: 1000,
  status: 'live',
  fetchLive: async (env, { sectors }) => {
    const apiKey = optEnv(env, 'BLS_API_KEY');
    // Free key required — without it, degrade to the stub rather than throw.
    if (!apiKey) return buildRows(sectors, new Date());
    return buildUniformRows({
      sectors,
      key: KEY,
      metric_key: 'talent',
      unit: 'pct',
      fetchOne: async () => {
        const year = new Date().getUTCFullYear();
        const j = await fetchJson<{
          Results?: { series?: Array<{ data?: Array<{ value?: string }> }> };
        }>('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            seriesid: ['LNS14000000'],
            registrationkey: apiKey,
            startyear: String(year - 1),
            endyear: String(year),
          }),
        });
        const raw = j?.Results?.series?.[0]?.data?.[0]?.value;
        const v = raw != null ? parseFloat(raw) : NaN;
        if (!isFinite(v)) return null;
        return {
          value: clamp01(1 - v / 12),
          raw: v,
          citation_url: 'https://data.bls.gov/timeseries/LNS14000000',
        };
      },
    });
  },
  fetchStub: ({ sectors, now }) => buildRows(sectors, now ?? new Date()),
});
