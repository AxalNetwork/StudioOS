/**
 * D7717 (#7717): the Eurostat structural business statistics importer — enterprises, persons employed and net turnover
 * by NACE Rev. 2 activity, size class, country and reference year from dataset `sbs_sc_ovw` (reference years 2021 on).
 */
import type { Env } from '../../types';
import { providerJson } from '../researchMarketData';
import { ISO2_TO_ISO3 } from '../researchObservations';
import { reportPrivateError } from '../../util/errorPrivacy';
import { ImportFailure, ImportRequestError, MAX_BATCH_ROWS, runObservationBatch, type ImportReport, type Observation, type PreparedBatch } from './write';

export const SOURCE_ID = 'eurostat-sbs';
/** Confirmed from the API's own metadata on 2026-11-23 (D7717): dataflow ESTAT:SBS_SC_OVW(1.0), DSD SBS_SC_OVW 26.0. */
export const DATASET = 'sbs_sc_ovw';
export const DATAFLOW = 'SBS_SC_OVW';
export const DATA_URL = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/' + DATASET;
/** The size-class table changed at reference year 2021; only the current series is imported, never joined to 2005–2020. */
export const FIRST_YEAR = 2021;

/** indic_sbs code → metric. Labels as Eurostat's INDIC_SBS codelist publishes them; values are never rescaled. */
export const SBS_INDICATORS = Object.freeze({
  ENT_NR: { metric_key: 'sbs_enterprises', label: 'Enterprises - number', unit: 'enterprises', scale: 'units', currency: null, price_basis: 'not_applicable' },
  EMP_NR: { metric_key: 'sbs_persons_employed', label: 'Persons employed - number', unit: 'persons', scale: 'units', currency: null, price_basis: 'not_applicable' },
  NETTUR_MEUR: { metric_key: 'sbs_net_turnover', label: 'Net turnover - million euro', unit: 'EUR', scale: 'millions', currency: 'EUR', price_basis: 'current_prices' },
} as const);
type Indicator = keyof typeof SBS_INDICATORS;

/**
 * size_emp code → D7716 size band. Only classes that are exactly one band are importable: 10-19 and 20-49 are not
 * "small" (10–49) on their own and are never summed into it; 0_1 and 2-9 have no band.
 */
export const SBS_SIZE_BANDS = Object.freeze({ TOTAL: 'all_sizes', '0-9': 'micro', '50-249': 'medium', GE250: 'large' } as const);
type SizeClass = keyof typeof SBS_SIZE_BANDS;

/** Eurostat's own codes for Greece and the United Kingdom; every other country goes through #7716's mapping. */
export const EUROSTAT_COUNTRY_CODES: Readonly<Record<string, string>> = Object.freeze({ EL: 'GRC', UK: 'GBR' });
/** The provider's own aggregate that the store holds as a `region` row (D7716 REGION_CODES). Never summed here. */
export const SBS_REGION_CODES = Object.freeze(['EU27_2020'] as const);
/**
 * Geographies an import may ask for: the EU Member States, EFTA and the official candidate countries, whose data the
 * Eurostat copyright notice (read 2026-11-23) allows for commercial reuse with the source acknowledged, plus the EU
 * aggregate. Data for other countries, the United Kingdom included, is not reusable commercially and is refused.
 */
export const SBS_GEOGRAPHIES = Object.freeze([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
  'IS', 'LI', 'NO', 'CH',
  'AL', 'BA', 'GE', 'MD', 'ME', 'MK', 'RS', 'TR', 'UA',
  'EU27_2020',
] as const);

/** The batch an operator may ask for. One provider request; its cube never exceeds the writer's batch. */
export const SBS_IMPORT_LIMITS = Object.freeze({ first_year: FIRST_YEAR, max_year: 2100, years: 4, indicators: 3, activities: 4,
  size_classes: 4, geographies: 10, cells: MAX_BATCH_ROWS });

/** NACE Rev. 2 section (B–S), division or group as Eurostat publishes it (J, J62, J620). */
const ACTIVITY_RE = /^[B-S](\d{2,3})?$/;

/** The text every row carries (D7717). Flag notes are appended per cell. */
export const SBS_LIMITATIONS = 'Counts are enterprises, not establishments or every possible buyer. Turnover is the revenue of the '
  + 'enterprises in the activity, not what a buyer segment spends on a product. The table covers the business economy '
  + '(NACE Rev. 2 sections B to N, P to R and divisions S95 and S96) and leaves out some activities. Series from reference '
  + 'year 2021 only; the 2005-2020 size-class table is a break in series and is not joined.';

/** Observation-flag letters (OBS_FLAG codelist). `e` sets the status, `f` the forecast status; the rest are limitations. */
const FLAG_NOTES: Readonly<Record<string, string>> = Object.freeze({
  p: 'provisional', b: 'break in time series', d: 'definition differs (see metadata)', u: 'low reliability',
  n: 'not significant', i: 'value imputed by Eurostat or other receiving agencies',
});
const FLAG_ORDER = ['b', 'd', 'i', 'n', 'p', 'u'];

export interface SbsParams { from: number; to: number; indicators: Indicator[]; activities: string[]; size_classes: SizeClass[]; geographies: string[] }
export interface SbsSkips { missing: number; confidential: number; unknown_geography: number; aggregate_geography: number; unknown_flag: number }
export type SbsReport = ImportReport & { skipped: SbsSkips };

const invalid = () => new ImportRequestError('invalid_sbs_parameters');
function list<T extends string>(raw: unknown, allowed: (v: string) => boolean, max: number, fallback?: readonly T[]): T[] {
  const v = raw === undefined && fallback ? [...fallback] : raw;
  if (!Array.isArray(v) || !v.length || v.length > max || v.some(x => typeof x !== 'string' || !allowed(x)) || new Set(v).size !== v.length)
    throw invalid();
  return v as T[];
}

/** Validate a batch. Every dimension is bounded, and the requested cube must fit one writer batch, or it is refused. */
export function sbsParams(raw: unknown): SbsParams {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const L = SBS_IMPORT_LIMITS;
  if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || Number(b.from) < L.first_year || Number(b.to) > L.max_year
    || Number(b.from) > Number(b.to) || Number(b.to) - Number(b.from) + 1 > L.years) throw invalid();
  const indicators = list<Indicator>(b.indicators, v => Object.hasOwn(SBS_INDICATORS, v), L.indicators, Object.keys(SBS_INDICATORS) as Indicator[]);
  const activities = list<string>(b.activities, v => ACTIVITY_RE.test(v), L.activities);
  const size_classes = list<SizeClass>(b.size_classes, v => Object.hasOwn(SBS_SIZE_BANDS, v), L.size_classes);
  const geographies = list<string>(b.geographies, v => (SBS_GEOGRAPHIES as readonly string[]).includes(v), L.geographies);
  const years = Number(b.to) - Number(b.from) + 1;
  if (indicators.length * activities.length * size_classes.length * geographies.length * years > L.cells)
    throw new ImportRequestError('sbs_batch_too_large');
  return { from: Number(b.from), to: Number(b.to), indicators, activities, size_classes, geographies };
}

/** The one request a batch makes. The parameters were validated, so no caller text reaches the URL unchecked. */
export function sbsUrl(p: SbsParams): string {
  const q = new URLSearchParams({ format: 'JSON', lang: 'EN' });
  for (const v of p.indicators) q.append('indic_sbs', v);
  for (const v of p.activities) q.append('nace_r2', v);
  for (const v of p.size_classes) q.append('size_emp', v);
  for (const v of p.geographies) q.append('geo', v);
  for (let y = p.from; y <= p.to; y++) q.append('time', String(y));
  return DATA_URL + '?' + q.toString();
}

/** A Eurostat geo code as the store holds it, or why it is skipped. Nothing is guessed. */
export function sbsGeography(code: string): { type: 'country' | 'region'; code: string } | 'aggregate' | 'unknown' {
  if ((SBS_REGION_CODES as readonly string[]).includes(code)) return { type: 'region', code };
  if (/^(EU|EA|EEA|EFTA)(\d|_|$)/.test(code)) return 'aggregate';
  if (!/^[A-Z]{2}$/.test(code)) return 'unknown';
  const iso3 = EUROSTAT_COUNTRY_CODES[code] ?? ISO2_TO_ISO3[code];
  return iso3 ? { type: 'country', code: iso3 } : 'unknown';
}

/** A cell's flag string (`OBS_FLAG|CONF_STATUS`) read into a status, limitation notes, or a reason to store nothing. */
export function sbsFlag(raw: unknown): { status: 'estimate' | 'forecast' | 'unspecified'; notes: string[] } | 'confidential' | 'missing' | 'unknown_flag' {
  if (raw === undefined || raw === null || raw === '') return { status: 'unspecified', notes: [] };
  if (typeof raw !== 'string' || raw.length > 12) return 'unknown_flag';
  const [obs, conf = '', extra] = raw.split('|');
  if (extra !== undefined || !/^[a-z]*$/.test(obs) || !/^[A-Z]?$/.test(conf)) return 'unknown_flag';
  if (conf) return ['C', 'N', 'P'].includes(conf) ? 'confidential' : 'unknown_flag';
  const letters = new Set(obs);
  if (letters.has('m')) return 'missing';
  if ([...letters].some(l => l !== 'e' && l !== 'f' && !FLAG_NOTES[l])) return 'unknown_flag';
  if (letters.has('e') && letters.has('f')) return 'unknown_flag';
  return { status: letters.has('e') ? 'estimate' : letters.has('f') ? 'forecast' : 'unspecified',
    notes: FLAG_ORDER.filter(l => letters.has(l)).map(l => FLAG_NOTES[l]) };
}

function providerUpdated(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{4}|Z)$/.test(raw)) throw new ImportFailure('provider_payload');
  const t = Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(t)) throw new ImportFailure('provider_payload');
  return new Date(t).toISOString();
}
async function contentVintage(cell: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(cell)));
  return 'content-sha256:' + [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

const DIMENSIONS = ['freq', 'indic_sbs', 'nace_r2', 'size_emp', 'geo', 'time'] as const;

/** Read a JSON-stat 2.0 response into observations. Every cell of the cube is seen; skipped cells are counted by reason. */
export async function sbsRows(payload: any, p: SbsParams, skipped: SbsSkips): Promise<{ rows: Observation[]; seen: number; vintage: string | null }> {
  if (!payload || typeof payload !== 'object' || payload.class !== 'dataset' || !Array.isArray(payload.id) || !Array.isArray(payload.size)
    || payload.id.length !== DIMENSIONS.length || payload.size.length !== DIMENSIONS.length || DIMENSIONS.some(d => !payload.id.includes(d))
    || !payload.value || typeof payload.value !== 'object' || (payload.status != null && typeof payload.status !== 'object'))
    throw new ImportFailure('provider_payload');
  // Each dimension's codes by position; the response's order, not the request's, decides the cell index.
  const codes = payload.id.map((dim: string, k: number) => {
    const index = payload.dimension?.[dim]?.category?.index, size = payload.size[k];
    if (!index || typeof index !== 'object' || !Number.isInteger(size) || size < 0 || Object.keys(index).length !== size)
      throw new ImportFailure('provider_payload');
    const byPos: string[] = new Array(size);
    for (const [code, pos] of Object.entries(index)) {
      if (!Number.isInteger(pos) || (pos as number) < 0 || (pos as number) >= size || byPos[pos as number] !== undefined) throw new ImportFailure('provider_payload');
      byPos[pos as number] = code;
    }
    return byPos;
  }) as string[][];
  const seen = payload.size.reduce((a: number, b: number) => a * b, 1);
  if (seen > MAX_BATCH_ROWS) throw new ImportFailure('provider_payload');
  const at = (dim: (typeof DIMENSIONS)[number]) => payload.id.indexOf(dim);
  const asked = { indic_sbs: p.indicators as string[], nace_r2: p.activities, size_emp: p.size_classes as string[],
    time: Array.from({ length: p.to - p.from + 1 }, (_, i) => String(p.from + i)) };
  for (const [dim, wanted] of Object.entries(asked))
    if (codes[at(dim as keyof typeof asked)].some(c => !wanted.includes(c))) throw new ImportFailure('provider_payload');
  if (codes[at('freq')].some(c => c !== 'A')) throw new ImportFailure('provider_payload');
  const published = providerUpdated(payload.updated);
  const rows: Observation[] = [];
  for (let i = 0; i < seen; i++) {
    let rest = i; const cell: Record<string, string> = {};
    for (let k = payload.id.length - 1; k >= 0; k--) { cell[payload.id[k]] = codes[k][rest % payload.size[k]]; rest = Math.floor(rest / payload.size[k]); }
    const geo = sbsGeography(cell.geo);
    if (geo === 'aggregate') { skipped.aggregate_geography++; continue; }
    if (geo === 'unknown' || !p.geographies.includes(cell.geo)) { skipped.unknown_geography++; continue; }
    const flag = sbsFlag(payload.status?.[String(i)]);
    if (flag === 'confidential') { skipped.confidential++; continue; }
    if (flag === 'unknown_flag') { skipped.unknown_flag++; continue; }
    const raw = payload.value[String(i)];
    if (flag === 'missing' || raw === undefined || raw === null) { skipped.missing++; continue; }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new ImportFailure('provider_payload');
    const indicator = SBS_INDICATORS[cell.indic_sbs as Indicator];
    const key = [DATASET, cell.indic_sbs, cell.nace_r2, cell.size_emp, cell.geo, cell.time].join(':');
    const limitations = [SBS_LIMITATIONS, ...flag.notes.map(n => 'Eurostat flag: ' + n + '.')].join(' ');
    rows.push({
      metric_key: indicator.metric_key, metric_label: indicator.label, geography_type: geo.type, geography_code: geo.code,
      period: cell.time, value: raw, unit: indicator.unit, observation_status: flag.status, published_at: published,
      source_observation_key: key,
      vintage: published ?? await contentVintage([key, raw, flag]),
      statistical_unit: 'enterprise', scale: indicator.scale, currency: indicator.currency, price_basis: indicator.price_basis,
      industry_scheme: 'nace_rev2', industry_code: cell.nace_r2, size_band: SBS_SIZE_BANDS[cell.size_emp as SizeClass],
      series_id: [DATAFLOW, 'A', cell.indic_sbs, cell.nace_r2, cell.size_emp, cell.geo].join('.'),
      supporting_passage: null, applicability_note: null, limitations,
    });
  }
  return { rows, seen, vintage: published };
}

/** One bounded batch: one provider request, at most one writer batch, no continuation. */
export async function ingestEurostatSbs(env: Env, raw: unknown, cursor?: unknown): Promise<SbsReport> {
  const params = sbsParams(raw);
  if (cursor !== undefined && cursor !== null) throw new ImportRequestError('invalid_cursor');
  const skipped: SbsSkips = { missing: 0, confidential: 0, unknown_geography: 0, aggregate_geography: 0, unknown_flag: 0 };
  const report = await runObservationBatch(env, SOURCE_ID, async (): Promise<PreparedBatch> => {
    try {
      const { rows, seen, vintage } = await sbsRows(await providerJson(sbsUrl(params)), params, skipped);
      return { rows, seen, vintage: vintage ?? (rows.length ? 'content_identified' : 'not_recorded'), cursor: null, retry_cursor: null, progressed: true };
    } catch (error) {
      reportPrivateError('import_row', error, 'market_provider_failed');
      for (const k of Object.keys(skipped) as (keyof SbsSkips)[]) skipped[k] = 0;
      return { rows: [], seen: 0, vintage: 'not_recorded', cursor: null, retry_cursor: null, progressed: false,
        failure: error instanceof ImportFailure ? error : new ImportFailure('provider_payload') };
    }
  });
  return { ...report, skipped };
}
