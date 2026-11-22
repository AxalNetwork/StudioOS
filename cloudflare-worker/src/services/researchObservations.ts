/**
 * D7716 (#7716): the general market-observation query — the lists a field may take, the geography mapping, the
 * filters built in SQL from fixed fragments, the four coverage states, the single read with its revision chain, the
 * metric catalogue and the one CSV export rule shared with `/api/research/market-data/export.csv`.
 */
import type { Env } from '../types';
import { csvSafe } from './csv';
import { INDUSTRY_SCHEMES, STATISTICAL_UNITS } from '../routes/research_studies';

/** The lists #7719 exported first (D7719); this module imports them rather than keeping a second copy. */
export { INDUSTRY_SCHEMES, STATISTICAL_UNITS };
/** How the value is scaled as published. The value itself is never rescaled. */
export const SCALES = ['units', 'thousands', 'millions', 'billions', 'trillions'] as const;
export const PRICE_BASES = ['current_prices', 'constant_prices', 'ppp_current', 'ppp_constant', 'not_applicable'] as const;
/** Size bands by persons employed, as the EU SME definition draws them (D7716). */
export const SIZE_BANDS = ['micro', 'small', 'medium', 'large', 'sme', 'all_sizes'] as const;
export const OBSERVATION_STATUSES = ['actual', 'estimate', 'forecast', 'axal_derived', 'unspecified'] as const;
/** The aggregates a provider publishes, stored as `region` rows. */
export const REGION_CODES = ['WLD', 'EU27_2020', 'OECD'] as const;
export const TEXT_LIMITS = Object.freeze({ series_id: 120, supporting_passage: 500, applicability_note: 500, limitations: 1000 });
export const OBSERVATION_FIELDS = ['statistical_unit', 'scale', 'currency', 'price_basis', 'industry_scheme', 'industry_code',
  'size_band', 'series_id', 'supporting_passage', 'applicability_note', 'limitations'] as const;
export type ObservationFields = Record<(typeof OBSERVATION_FIELDS)[number], string | null>;

const CURRENCY_RE = /^[A-Z]{3}$/;
const INDUSTRY_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/;
const METRIC_RE = /^[a-z][a-z0-9_]{0,63}$/;
const inList = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** The first field outside its list or limit, or null. The writer refuses the batch on any. */
export function observationFieldsError(r: Partial<ObservationFields>): string | null {
  const checks: [keyof ObservationFields, (v: unknown) => boolean][] = [
    ['statistical_unit', v => inList(STATISTICAL_UNITS, v)],
    ['scale', v => inList(SCALES, v)],
    ['currency', v => typeof v === 'string' && CURRENCY_RE.test(v)],
    ['price_basis', v => inList(PRICE_BASES, v)],
    ['industry_scheme', v => inList(INDUSTRY_SCHEMES, v)],
    ['industry_code', v => typeof v === 'string' && INDUSTRY_CODE_RE.test(v)],
    ['size_band', v => inList(SIZE_BANDS, v)],
  ];
  for (const [field, ok] of checks) if (r[field] != null && !ok(r[field])) return 'invalid_' + field;
  for (const [field, max] of Object.entries(TEXT_LIMITS) as [keyof typeof TEXT_LIMITS, number][]) {
    const v = r[field];
    if (v != null && (typeof v !== 'string' || !v.trim() || v.length > max)) return 'invalid_' + field;
  }
  // A code without its scheme cannot be read; a scheme with no code says nothing.
  if ((r.industry_code == null) !== (r.industry_scheme == null)) return 'invalid_industry_code';
  return null;
}

/**
 * ISO 3166-1 alpha-2 → alpha-3. `research_countries` holds two-letter codes and the store holds three-letter ones,
 * so the query converts at the edge. A test asserts every seeded `research_countries.code` is here.
 */
export const ISO2_TO_ISO3: Readonly<Record<string, string>> = Object.freeze({
  AD: 'AND', AE: 'ARE', AF: 'AFG', AG: 'ATG', AL: 'ALB', AM: 'ARM', AO: 'AGO', AR: 'ARG', AT: 'AUT', AU: 'AUS', AZ: 'AZE',
  BA: 'BIH', BB: 'BRB', BD: 'BGD', BE: 'BEL', BF: 'BFA', BG: 'BGR', BH: 'BHR', BI: 'BDI', BJ: 'BEN', BN: 'BRN', BO: 'BOL',
  BR: 'BRA', BS: 'BHS', BT: 'BTN', BW: 'BWA', BY: 'BLR', BZ: 'BLZ', CA: 'CAN', CD: 'COD', CF: 'CAF', CG: 'COG', CH: 'CHE',
  CI: 'CIV', CL: 'CHL', CM: 'CMR', CN: 'CHN', CO: 'COL', CR: 'CRI', CU: 'CUB', CV: 'CPV', CY: 'CYP', CZ: 'CZE', DE: 'DEU',
  DJ: 'DJI', DK: 'DNK', DM: 'DMA', DO: 'DOM', DZ: 'DZA', EC: 'ECU', EE: 'EST', EG: 'EGY', ER: 'ERI', ES: 'ESP', ET: 'ETH',
  FI: 'FIN', FJ: 'FJI', FR: 'FRA', GA: 'GAB', GB: 'GBR', GD: 'GRD', GE: 'GEO', GG: 'GGY', GH: 'GHA', GM: 'GMB', GN: 'GIN',
  GQ: 'GNQ', GR: 'GRC', GT: 'GTM', GW: 'GNB', GY: 'GUY', HK: 'HKG', HN: 'HND', HR: 'HRV', HT: 'HTI', HU: 'HUN', ID: 'IDN',
  IE: 'IRL', IL: 'ISR', IM: 'IMN', IN: 'IND', IQ: 'IRQ', IR: 'IRN', IS: 'ISL', IT: 'ITA', JE: 'JEY', JM: 'JAM', JO: 'JOR',
  JP: 'JPN', KE: 'KEN', KG: 'KGZ', KH: 'KHM', KM: 'COM', KR: 'KOR', KW: 'KWT', KZ: 'KAZ', LA: 'LAO', LB: 'LBN', LI: 'LIE',
  LK: 'LKA', LR: 'LBR', LS: 'LSO', LT: 'LTU', LU: 'LUX', LV: 'LVA', LY: 'LBY', MA: 'MAR', MC: 'MCO', MD: 'MDA', ME: 'MNE',
  MG: 'MDG', MK: 'MKD', ML: 'MLI', MM: 'MMR', MN: 'MNG', MO: 'MAC', MR: 'MRT', MT: 'MLT', MU: 'MUS', MV: 'MDV', MW: 'MWI',
  MX: 'MEX', MY: 'MYS', MZ: 'MOZ', NA: 'NAM', NE: 'NER', NG: 'NGA', NI: 'NIC', NL: 'NLD', NO: 'NOR', NP: 'NPL', NZ: 'NZL',
  OM: 'OMN', PA: 'PAN', PE: 'PER', PG: 'PNG', PH: 'PHL', PK: 'PAK', PL: 'POL', PR: 'PRI', PS: 'PSE', PT: 'PRT', PY: 'PRY',
  QA: 'QAT', RO: 'ROU', RS: 'SRB', RU: 'RUS', RW: 'RWA', SA: 'SAU', SB: 'SLB', SC: 'SYC', SD: 'SDN', SE: 'SWE', SG: 'SGP',
  SI: 'SVN', SK: 'SVK', SL: 'SLE', SM: 'SMR', SN: 'SEN', SO: 'SOM', SR: 'SUR', SS: 'SSD', SV: 'SLV', SY: 'SYR', SZ: 'SWZ',
  TD: 'TCD', TG: 'TGO', TH: 'THA', TJ: 'TJK', TL: 'TLS', TM: 'TKM', TN: 'TUN', TR: 'TUR', TT: 'TTO', TW: 'TWN', TZ: 'TZA',
  UA: 'UKR', UG: 'UGA', US: 'USA', UY: 'URY', UZ: 'UZB', VE: 'VEN', VN: 'VNM', XK: 'XKX', YE: 'YEM', ZA: 'ZAF', ZM: 'ZMB',
  ZW: 'ZWE',
});
const ISO3 = new Set(Object.values(ISO2_TO_ISO3));

/** A two- or three-letter country code, or a listed aggregate, as the store holds it; null for anything unknown. */
export function storedGeography(input: unknown): string | null {
  const raw = typeof input === 'string' ? input.trim() : '';
  if ((REGION_CODES as readonly string[]).includes(raw)) return raw;
  const code = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return ISO2_TO_ISO3[code] ?? null;
  if (/^[A-Z]{3}$/.test(code)) return ISO3.has(code) || (REGION_CODES as readonly string[]).includes(code) ? code : null;
  return null;
}

/** The period forms the store accepts. A range compares within one form only. */
export const PERIOD_FORMS = Object.freeze({
  year: { re: /^\d{4}$/, glob: '[0-9][0-9][0-9][0-9]' },
  quarter: { re: /^\d{4}-Q[1-4]$/, glob: '[0-9][0-9][0-9][0-9]-Q[1-4]' },
  month: { re: /^\d{4}-(0[1-9]|1[0-2])$/, glob: '[0-9][0-9][0-9][0-9]-[01][0-9]' },
});
type PeriodForm = keyof typeof PERIOD_FORMS;
export const periodForm = (v: string): PeriodForm | null =>
  (Object.keys(PERIOD_FORMS) as PeriodForm[]).find(f => PERIOD_FORMS[f].re.test(v)) ?? null;

/** How long after its last success a source still reads as fresh, by its stored refresh policy (D7716). */
export const REFRESH_ALLOWANCE_DAYS: Readonly<Record<string, number>> = Object.freeze({
  monthly: 45, quarterly: 120, april_october: 214, annual: 400,
});
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 200;
export const EXPORT_ROW_CAP = 5000;
const DAY_MS = 86_400_000;
const CHAIN_DEPTH = 50;

export class ObservationQueryError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}

export interface ObservationFilters {
  metric: string | null; geography: string | null; industry_code: string | null; size_band: string | null;
  status: string | null; period_from: string | null; period_to: string | null; form: PeriodForm | null;
  vintages: 'current' | 'all'; limit: number; offset: number;
}

/** Parse the query string; every refusal names the parameter in a sentence. */
export function parseFilters(q: Record<string, string | undefined>): ObservationFilters {
  const text = (k: string) => (q[k] ?? '').trim() || null;
  const metric = text('metric');
  if (metric && !METRIC_RE.test(metric)) throw new ObservationQueryError('invalid_metric', 'The metric is a metric key from the catalogue.');
  const geoRaw = text('geography');
  const geography = geoRaw ? storedGeography(geoRaw) : null;
  if (geoRaw && !geography) throw new ObservationQueryError('unknown_geography', 'The geography is not a known country code or one of the listed aggregates.');
  const industry = text('industry_code');
  if (industry && !INDUSTRY_CODE_RE.test(industry)) throw new ObservationQueryError('invalid_industry_code', 'The industry code is letters, digits, dots and hyphens.');
  const size = text('size_band');
  if (size && !inList(SIZE_BANDS, size)) throw new ObservationQueryError('invalid_size_band', `The size band is one of ${SIZE_BANDS.join(', ')}.`);
  const status = text('status');
  if (status && !inList(OBSERVATION_STATUSES, status)) throw new ObservationQueryError('invalid_status', `The status is one of ${OBSERVATION_STATUSES.join(', ')}.`);
  const from = text('period_from'), to = text('period_to');
  const forms = [from, to].filter((v): v is string => v !== null).map(periodForm);
  if (forms.some(f => f === null)) throw new ObservationQueryError('invalid_period', 'A period is YYYY, YYYY-Qn or YYYY-MM.');
  if (forms.length === 2 && forms[0] !== forms[1]) throw new ObservationQueryError('mixed_period_forms', 'Both ends of a period range use the same form.');
  if (from && to && from > to) throw new ObservationQueryError('invalid_period', 'The range starts before it ends.');
  const vintages = text('vintages') ?? 'current';
  if (vintages !== 'current' && vintages !== 'all') throw new ObservationQueryError('invalid_vintages', 'Vintages is current or all.');
  const limitRaw = text('limit'), offsetRaw = text('offset');
  const limit = limitRaw === null ? PAGE_LIMIT_DEFAULT : Number(limitRaw);
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT_MAX) throw new ObservationQueryError('invalid_limit', `The page size is a whole number from 1 to ${PAGE_LIMIT_MAX}.`);
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new ObservationQueryError('invalid_offset', 'The offset is a whole number of rows.');
  return { metric, geography, industry_code: industry, size_band: size, status, period_from: from, period_to: to,
    form: (forms[0] ?? null) as PeriodForm | null, vintages, limit, offset };
}

/**
 * The WHERE clause, built only from the fixed fragments below; every value is bound. This is the only text joined
 * into a prepared statement in this module (reviewed in scripts/baselines/sql-prepare).
 */
const FRAGMENTS = Object.freeze({
  metric: 'o.metric_key = ?',
  geography: 'o.geography_code = ?',
  industry_code: 'o.industry_code = ?',
  size_band: 'o.size_band = ?',
  status: 'o.observation_status = ?',
  period_from: 'o.period >= ?',
  period_to: 'o.period <= ?',
  form: 'o.period GLOB ?',
  current: 'NOT EXISTS (SELECT 1 FROM research_market_observations n WHERE n.supersedes_observation_id = o.id)',
});
export function whereOf(f: ObservationFilters): { where: string; binds: unknown[] } {
  const parts: string[] = [], binds: unknown[] = [];
  for (const k of ['metric', 'geography', 'industry_code', 'size_band', 'status', 'period_from', 'period_to'] as const) {
    if (f[k] !== null) { parts.push(FRAGMENTS[k]); binds.push(f[k]); }
  }
  if (f.form) { parts.push(FRAGMENTS.form); binds.push(PERIOD_FORMS[f.form].glob); }
  if (f.vintages === 'current') parts.push(FRAGMENTS.current);
  return { where: parts.length ? 'WHERE ' + parts.join(' AND ') : '', binds };
}

/** The export's columns on main, in their order (D7318), then the D7716 fields. */
export const MAIN_EXPORT_COLUMNS = ['source_id', 'source_name', 'source_url', 'source_dataset_or_edition', 'metric_key', 'metric_label',
  'geography_type', 'geography_code', 'period', 'value', 'unit', 'observation_status', 'published_at', 'retrieved_at',
  'methodology_url', 'license_or_usage_note', 'confidence', 'vintage', 'supersedes_observation_id'] as const;
export const EXPORT_COLUMNS = [...MAIN_EXPORT_COLUMNS, ...OBSERVATION_FIELDS] as const;
export type Provenance = Record<(typeof EXPORT_COLUMNS)[number], unknown>;

const SELECT = `SELECT o.id, o.source_id, s.name AS source_name, s.source_url, s.dataset_or_edition AS source_dataset_or_edition,
  o.metric_key, o.metric_label, o.geography_type, o.geography_code, o.period, o.value, o.unit, o.observation_status,
  o.published_at, o.retrieved_at, s.methodology_url, s.license_or_usage_note, o.confidence, o.vintage, o.supersedes_observation_id,
  o.statistical_unit, o.scale, o.currency, o.price_basis, o.industry_scheme, o.industry_code, o.size_band, o.series_id,
  o.supporting_passage, o.applicability_note, o.limitations, s.export_allowed
  FROM research_market_observations o JOIN research_market_sources s ON s.id = o.source_id`;
const ORDER = 'ORDER BY o.geography_code, o.metric_key, o.period, o.id';

/** The provenance fields every surface returns, from one row, in the export's order. */
export function provenanceOf(row: Record<string, unknown>): Provenance {
  return Object.fromEntries(EXPORT_COLUMNS.map(k => [k, row[k] ?? null])) as Provenance;
}
const ageDays = (iso: unknown, now: number) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
};
const listItem = (row: Record<string, unknown>, now: number) => ({
  id: row.id, ...provenanceOf(row), exportable: row.export_allowed === 1, age_days: ageDays(row.retrieved_at, now),
});

export type CoverageState = 'not_covered' | 'no_observation' | 'source_failing' | 'stale' | 'current';
interface SourceHealth { id: string; refresh_policy: string; last_success_at: string | null; last_error: string | null }
/** The state of one source, measured by the Worker's clock. An unknown refresh policy never reads as fresh. */
export function sourceState(s: SourceHealth, now: number): 'source_failing' | 'stale' | 'current' {
  if (s.last_error) return 'source_failing';
  const allowance = REFRESH_ALLOWANCE_DAYS[s.refresh_policy];
  const age = ageDays(s.last_success_at, now);
  if (allowance === undefined || age === null || age > allowance) return 'stale';
  return 'current';
}

/** The coverage state for one metric and geography, with the newest current row when there is one. */
export async function coverageOf(env: Env, metric: string, geography: string, now: number) {
  const covered = await env.DB.prepare(
    `SELECT 1 AS covered FROM research_market_metrics m JOIN research_market_sources s ON s.id = m.source_id
      WHERE m.metric_key = ? AND s.enabled = 1 LIMIT 1`,
  ).bind(metric).first();
  if (!covered) return { state: 'not_covered' as CoverageState, latest: null };
  const latest = await env.DB.prepare(
    `${SELECT} WHERE o.metric_key = ? AND o.geography_code = ? AND ${FRAGMENTS.current}
      ORDER BY o.retrieved_at DESC, o.id DESC LIMIT 1`,
  ).bind(metric, geography).first<Record<string, unknown>>();
  if (!latest) return { state: 'no_observation' as CoverageState, latest: null };
  const source = await env.DB.prepare(
    'SELECT id, refresh_policy, last_success_at, last_error FROM research_market_sources WHERE id = ?',
  ).bind(latest.source_id).first<SourceHealth>();
  const state: CoverageState = source ? sourceState(source, now) : 'stale';
  return { state, latest: listItem(latest, now) };
}

export async function listObservations(env: Env, f: ObservationFilters, now = Date.now()) {
  const { where, binds } = whereOf(f);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM research_market_observations o ${where}`)
    .bind(...binds).first<{ n: number }>();
  const rows = (await env.DB.prepare(`${SELECT} ${where} ${ORDER} LIMIT ? OFFSET ?`)
    .bind(...binds, f.limit, f.offset).all<Record<string, unknown>>()).results ?? [];
  const coverage = f.metric && f.geography ? await coverageOf(env, f.metric, f.geography, now) : null;
  return { items: rows.map(r => listItem(r, now)), total: Number(total?.n ?? 0), limit: f.limit, offset: f.offset,
    vintages: f.vintages, coverage };
}

const LABELLED_DATES = (row: Record<string, unknown>) => ({
  period_measured: { label: 'Period measured', value: row.period ?? null },
  published: { label: 'Published', value: row.published_at ?? null },
  retrieved: { label: 'Retrieved', value: row.retrieved_at ?? null },
});

/** One observation, its source and its revision chain, oldest first. Null when there is no such row. */
export async function readObservation(env: Env, id: number, now = Date.now()) {
  const row = await env.DB.prepare(`${SELECT} WHERE o.id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const chainCols = 'c.id, c.period, c.value, c.vintage, c.published_at, c.retrieved_at, c.observation_status';
  const older = (await env.DB.prepare(
    `WITH RECURSIVE older(id, depth) AS (
       SELECT supersedes_observation_id, 1 FROM research_market_observations WHERE id = ? AND supersedes_observation_id IS NOT NULL
       UNION ALL
       SELECT o.supersedes_observation_id, older.depth + 1 FROM research_market_observations o JOIN older ON o.id = older.id
        WHERE o.supersedes_observation_id IS NOT NULL AND older.depth < ?)
     SELECT ${chainCols}, older.depth FROM older JOIN research_market_observations c ON c.id = older.id ORDER BY older.depth DESC`,
  ).bind(id, CHAIN_DEPTH).all<Record<string, unknown>>()).results ?? [];
  const newer = (await env.DB.prepare(
    `WITH RECURSIVE newer(id, depth) AS (
       SELECT id, 1 FROM research_market_observations WHERE supersedes_observation_id = ?
       UNION ALL
       SELECT o.id, newer.depth + 1 FROM research_market_observations o JOIN newer ON o.supersedes_observation_id = newer.id
        WHERE newer.depth < ?)
     SELECT ${chainCols}, newer.depth FROM newer JOIN research_market_observations c ON c.id = newer.id ORDER BY newer.depth ASC`,
  ).bind(id, CHAIN_DEPTH).all<Record<string, unknown>>()).results ?? [];
  const link = (r: Record<string, unknown>, position: 'older' | 'this' | 'newer') => ({
    id: r.id, period: r.period, value: r.value, vintage: r.vintage, published_at: r.published_at ?? null,
    retrieved_at: r.retrieved_at, observation_status: r.observation_status, position,
  });
  return {
    observation: { ...listItem(row, now), dates: LABELLED_DATES(row), current: newer.length === 0 },
    source: { id: row.source_id, name: row.source_name, source_url: row.source_url, dataset_or_edition: row.source_dataset_or_edition,
      methodology_url: row.methodology_url ?? null, usage_note: row.license_or_usage_note ?? null, exportable: row.export_allowed === 1 },
    revisions: [...older.map(r => link(r, 'older')), link(row, 'this'), ...newer.map(r => link(r, 'newer'))],
  };
}

/** The metric catalogue, with the source each metric comes from and whether that source is enabled. */
export async function listMetrics(env: Env) {
  const r = await env.DB.prepare(
    `SELECT m.metric_key, m.source_id, s.name AS source_name, s.enabled, m.label, m.definition, m.unit
       FROM research_market_metrics m JOIN research_market_sources s ON s.id = m.source_id ORDER BY m.metric_key, m.source_id`,
  ).all<Record<string, unknown>>();
  return (r.results ?? []).map(m => ({ ...m, enabled: m.enabled === 1 }));
}

/**
 * The one export rule (D7716). Rows of a source not marked exportable are left out and counted by source; past the
 * cap the export is refused rather than cut short. Both CSV routes call this.
 */
export async function exportObservations(env: Env, f: ObservationFilters) {
  const { where, binds } = whereOf(f);
  const counts = (await env.DB.prepare(
    `SELECT o.source_id, COALESCE(s.export_allowed, 0) = 1 AS exportable, COUNT(*) AS n
       FROM research_market_observations o JOIN research_market_sources s ON s.id = o.source_id ${where}
      GROUP BY o.source_id, exportable`,
  ).bind(...binds).all<{ source_id: string; exportable: number; n: number }>()).results ?? [];
  const omitted: Record<string, number> = {};
  let exportable = 0;
  for (const c of counts) {
    if (c.exportable === 1) exportable += Number(c.n);
    else omitted[c.source_id] = Number(c.n);
  }
  if (exportable > EXPORT_ROW_CAP) {
    throw new ObservationQueryError('export_too_large',
      `This export would hold ${exportable} rows, more than the ${EXPORT_ROW_CAP} one file holds. Narrow the filters and export again.`, 413);
  }
  const exportWhere = where ? `${where} AND COALESCE(s.export_allowed, 0) = 1` : 'WHERE COALESCE(s.export_allowed, 0) = 1';
  const rows = exportable ? (await env.DB.prepare(`${SELECT} ${exportWhere} ${ORDER} LIMIT ?`)
    .bind(...binds, EXPORT_ROW_CAP).all<Record<string, unknown>>()).results ?? [] : [];
  return { rows: rows.map(provenanceOf), omitted };
}

/** The CSV text: the header, then each row with formula-like cells written as text. */
export function observationsCsv(rows: Provenance[]): string {
  return [EXPORT_COLUMNS.join(','), ...rows.map(r => EXPORT_COLUMNS.map(k => csvSafe(r[k])).join(','))].join('\r\n');
}

/** The filters the market-data CSV keeps: an optional country, every vintage, as it exported before D7716. */
export function marketDataExportFilters(geography: string | null): ObservationFilters {
  return { metric: null, geography, industry_code: null, size_band: null, status: null, period_from: null, period_to: null,
    form: null, vintages: 'all', limit: EXPORT_ROW_CAP, offset: 0 };
}
