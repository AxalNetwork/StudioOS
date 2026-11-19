/**
 * Research › Markets global sourced observations (D7318, #7318): the append-only observation store, the source
 * registry and bounded World Bank adapter; operator imports use marketObservations/write.ts (D7709).
 */
import type { Env } from '../types';
import { ImportFailure, ImportRequestError, MAX_BATCH_ROWS, runObservationBatch, type Observation, type PreparedBatch } from './marketObservations/write';
import { reportPrivateError } from '../util/errorPrivacy';

export const WORLD_BANK_METRICS = {
  'NY.GDP.MKTP.CD': ['gdp_nominal_usd','GDP (current US$)','USD'],
  'NY.GDP.PCAP.CD': ['gdp_per_capita_usd','GDP per capita (current US$)','USD/person'],
  'NY.GDP.MKTP.KD.ZG': ['real_gdp_growth_pct','Real GDP growth','percent'],
  'FP.CPI.TOTL.ZG': ['inflation_cpi_pct','Inflation, consumer prices','percent'],
  'SP.POP.TOTL': ['population','Population','people'],
  'GC.DOD.TOTL.GD.ZS': ['government_debt_pct_gdp','Central government debt','percent_of_GDP'],
  'BN.CAB.XOKA.GD.ZS': ['current_account_pct_gdp','Current account balance','percent_of_GDP'],
  'SL.UEM.TOTL.ZS': ['unemployment_pct','Unemployment','percent'],
  'IT.NET.USER.ZS': ['internet_users_pct','Individuals using the Internet','percent'],
  'GB.XPD.RSDV.GD.ZS': ['rd_intensity_pct_gdp','Research and development expenditure','percent_of_GDP'],
} as const;

export function normalizeIso3(value: unknown): string | null {
  const code=String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
export function normalizeValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const n=Number(value); return Number.isFinite(n) ? n : null;
}
export function worldBankStatus(): 'unspecified' { return 'unspecified'; }

export const WORLD_BANK_IMPORT_LIMITS = Object.freeze({ min_year: 1900, max_year: 2100, years: 10, indicators: 10, page_rows: 20, pages: 2, rows: MAX_BATCH_ROWS, response_bytes: 250_000, country_rows: 400, provider_pages: 1000 });
export interface WorldBankParams { from: number; to: number; indicators: string[] }
type Point = { indicator: number; page: number };

export function worldBankParams(raw: unknown): WorldBankParams {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || Number(b.from) < WORLD_BANK_IMPORT_LIMITS.min_year || Number(b.to) > WORLD_BANK_IMPORT_LIMITS.max_year
    || Number(b.from) > Number(b.to) || Number(b.to) - Number(b.from) + 1 > WORLD_BANK_IMPORT_LIMITS.years)
    throw new ImportRequestError('invalid_parameters');
  const indicators = b.indicators === undefined ? Object.keys(WORLD_BANK_METRICS) : b.indicators;
  if (!Array.isArray(indicators) || !indicators.length || indicators.length > WORLD_BANK_IMPORT_LIMITS.indicators
    || indicators.some(k => typeof k !== 'string' || !Object.hasOwn(WORLD_BANK_METRICS, k)) || new Set(indicators).size !== indicators.length)
    throw new ImportRequestError('invalid_parameters');
  return { from: Number(b.from), to: Number(b.to), indicators: [...indicators].sort() };
}
function cursorFor(params: WorldBankParams, point: Point | null): string | null {
  return point ? btoa(JSON.stringify({ v: 1, ...params, ...point })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
}
function cursorPoint(params: WorldBankParams, raw: unknown): Point {
  if (raw === undefined || raw === null) return { indicator: 0, page: 1 };
  try {
    if (typeof raw !== 'string' || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const c = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
    if (c.v !== 1 || c.from !== params.from || c.to !== params.to || JSON.stringify(c.indicators) !== JSON.stringify(params.indicators)
      || !Number.isInteger(c.indicator) || c.indicator < 0 || c.indicator >= params.indicators.length
      || !Number.isInteger(c.page) || c.page < 1 || c.page > WORLD_BANK_IMPORT_LIMITS.provider_pages) throw new Error();
    return { indicator: c.indicator, page: c.page };
  } catch { throw new ImportRequestError('invalid_cursor'); }
}

async function providerJson(url: string): Promise<any> {
  let response: Response;
  try { response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
  catch { throw new ImportFailure('provider_transport'); }
  if (!response.ok) { await response.body?.cancel(); throw new ImportFailure('provider_http', response.status); }
  if (Number(response.headers.get('content-length')) > WORLD_BANK_IMPORT_LIMITS.response_bytes) {
    await response.body?.cancel(); throw new ImportFailure('provider_payload', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImportFailure('provider_payload', response.status);
  const chunks: Uint8Array[] = []; let size = 0, parts = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; parts++;
      if (size > WORLD_BANK_IMPORT_LIMITS.response_bytes || parts > 1024) { await reader.cancel(); throw new ImportFailure('provider_payload', response.status); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ImportFailure('provider_payload', response.status); }
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure('provider_transport', response.status);
  } finally { reader.releaseLock(); }
}
function publishedDay(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ImportFailure('provider_payload');
  const t = Date.parse(raw + 'T00:00:00Z');
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== raw) throw new ImportFailure('provider_payload');
  return raw;
}
async function contentVintage(cell: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cell)));
  return 'content-sha256:' + [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** At most one metadata request and two data pages; a continuation is bound to the exact request parameters. */
export async function ingestWorldBank(env: Env, raw: unknown, rawCursor?: unknown) {
  const params = worldBankParams(raw), initial = cursorPoint(params, rawCursor);
  return runObservationBatch(env, 'world-bank', async (): Promise<PreparedBatch> => {
    const rows: Observation[] = [], editions = new Set<string>();
    let seen = 0, completed = 0, point: Point | null = initial, failure: ImportFailure | undefined;
    try {
      const countries = await providerJson('https://api.worldbank.org/v2/country?format=json&per_page=400');
      if (!Array.isArray(countries?.[1]) || countries[1].length > WORLD_BANK_IMPORT_LIMITS.country_rows || Number(countries?.[0]?.pages) !== 1)
        throw new ImportFailure('provider_payload');
      const codes = new Set<string>(countries[1].filter((c: any) => typeof c?.region?.id === 'string' && c.region.id && c.region.id !== 'NA')
        .map((c: any) => normalizeIso3(c.id)).filter((c: string | null): c is string => c !== null));
      for (let page = 0; page < WORLD_BANK_IMPORT_LIMITS.pages && point; page++) {
        const indicator: string = params.indicators[point.indicator];
        const url = 'https://api.worldbank.org/v2/country/all/indicator/' + encodeURIComponent(indicator)
          + '?format=json&per_page=' + WORLD_BANK_IMPORT_LIMITS.page_rows + '&date=' + params.from + ':' + params.to + '&page=' + point.page;
        const payload = await providerJson(url), meta = payload?.[0], values = payload?.[1];
        const pages = Number(meta?.pages), returnedPage = Number(meta?.page);
        if (!Array.isArray(values) || values.length > WORLD_BANK_IMPORT_LIMITS.page_rows || !Number.isInteger(pages)
          || pages < 0 || pages > WORLD_BANK_IMPORT_LIMITS.provider_pages || returnedPage !== point.page
          || (pages === 0 ? values.length !== 0 || point.page !== 1 : point.page > pages)) throw new ImportFailure('provider_payload');
        const published = publishedDay(meta.lastupdated);
        const additions: Observation[] = [];
        for (const row of values) {
          if (row?.indicator?.id !== indicator) throw new ImportFailure('provider_payload');
          const iso = normalizeIso3(row?.countryiso3code), period = String(row?.date ?? '');
          if (!iso || !codes.has(iso) || !/^\d{4}$/.test(period) || Number(period) < params.from || Number(period) > params.to) continue;
          const metric = WORLD_BANK_METRICS[indicator as keyof typeof WORLD_BANK_METRICS], value = normalizeValue(row?.value);
          additions.push({ metric_key: metric[0], metric_label: metric[1], geography_type: 'country', geography_code: iso, period,
            value, unit: metric[2], observation_status: worldBankStatus(), published_at: published,
            source_observation_key: indicator + ':' + iso + ':' + period,
            vintage: published ?? await contentVintage([indicator, iso, period, value, worldBankStatus()]) });
        }
        rows.push(...additions); seen += values.length; completed++;
        editions.add(published ?? 'content_identified');
        point = point.page < pages ? { ...point, page: point.page + 1 }
          : point.indicator + 1 < params.indicators.length ? { indicator: point.indicator + 1, page: 1 } : null;
      }
    } catch (error) {
      reportPrivateError('import_row', error, 'market_provider_failed');
      failure = error instanceof ImportFailure ? error : new ImportFailure('provider_payload');
    }
    return { rows, seen, vintage: editions.size === 1 ? [...editions][0] : editions.size ? 'multiple_editions' : 'not_recorded',
      cursor: cursorFor(params, point), retry_cursor: cursorFor(params, initial), progressed: completed > 0, failure };
  });
}
