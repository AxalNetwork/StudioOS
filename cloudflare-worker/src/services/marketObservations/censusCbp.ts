/**
 * D7927 (#7927): the U.S. Census Bureau County Business Patterns importer, national level — establishments, mid-March
 * employees and annual payroll by NAICS industry for the United States, read from the Bureau's national flat file
 * (`cbp<yy>us.zip`), which needs no API key. All establishments only (legal form `-`); no size class is imported.
 */
import type { Env } from '../../types';
import { reportPrivateError } from '../../util/errorPrivacy';
import { readZipEntry, ZipReadError } from '../../util/zipRead';
import { ImportFailure, ImportRequestError, MAX_BATCH_ROWS, runObservationBatch, type ImportReport, type Observation, type PreparedBatch } from './write';

export const SOURCE_ID = 'census-cbp';
/** The record layout read on 2026-11-26 covers 2018 to 2023 (EMPFLAG gone from 2018); 2023 is the latest release. */
export const FIRST_YEAR = 2018;
/**
 * The last reference year whose layout and NAICS version (2017) were checked (D7927). A later release may change the
 * NAICS version or, after the Department of Commerce order on noise infusion, its flags, so it is refused until
 * someone reads its layout and raises this number.
 */
export const LAST_VERIFIED_YEAR = 2023;
export const fileUrl = (year: number) =>
  `https://www2.census.gov/programs-surveys/cbp/datasets/${year}/cbp${String(year).slice(2)}us.zip`;

/** The file's columns per metric. Values are stored as published (payroll in $1,000), never rescaled. */
export const CBP_METRICS = Object.freeze({
  establishments: { column: 'est', flag: null, metric_key: 'cbp_establishments', label: 'Number of establishments',
    unit: 'establishments', scale: 'units', currency: null, price_basis: 'not_applicable' },
  employees: { column: 'emp', flag: 'emp_nf', metric_key: 'cbp_employees', label: 'Paid employees, pay period including March 12',
    unit: 'persons', scale: 'units', currency: null, price_basis: 'not_applicable' },
  annual_payroll: { column: 'ap', flag: 'ap_nf', metric_key: 'cbp_annual_payroll', label: 'Annual payroll ($1,000)',
    unit: 'USD', scale: 'thousands', currency: 'USD', price_basis: 'current_prices' },
} as const);
type Metric = keyof typeof CBP_METRICS;

/** One provider request per batch; ten industries by three metrics is 30 cells, inside the writer's batch of 40. */
export const CBP_IMPORT_LIMITS = Object.freeze({ first_year: FIRST_YEAR, last_year: LAST_VERIFIED_YEAR, industries: 10, metrics: 3,
  cells: 30, archive_bytes: 4_000_000, file_bytes: 16_000_000 });
if (CBP_IMPORT_LIMITS.industries * CBP_IMPORT_LIMITS.metrics > MAX_BATCH_ROWS) throw new Error('CBP batch exceeds the writer batch');

/** `all` is the all-industries total; otherwise a 2- to 6-digit NAICS code as the Bureau publishes it (54, 5415, 541511). */
const INDUSTRY_RE = /^(all|\d{2,6})$/;

/** The text every row carries (D7927). The noise note for the cell is appended. */
export const CBP_LIMITATIONS = 'Counts are establishments (single physical locations) with paid employees, not companies or customers. '
  + 'The series excludes the self-employed, employees of private households, railroad employees, agricultural production '
  + 'employees and most government employees; businesses without employees are not counted. Employment is for the pay '
  + 'period including March 12; payroll is in thousands of dollars at current prices. National data cover the 50 states '
  + 'and the District of Columbia, not Puerto Rico or the Island Areas. Values carry the Census Bureau\'s noise infusion '
  + 'for disclosure avoidance. Industries are NAICS 2017.';

/** The record layout's noise flags (read 2026-11-26). `N` means the field was set to zero: no row is stored. */
const NOISE_NOTES: Readonly<Record<string, string>> = Object.freeze({
  G: 'Census noise flag G: the published value differs from the undisturbed value by less than 2 percent.',
  H: 'Census noise flag H: the published value differs from the undisturbed value by 2 to less than 5 percent.',
  J: 'Census noise flag J: the published value differs from the undisturbed value by 5 percent or more.',
});

export interface CbpParams { year: number; industries: string[]; metrics: Metric[] }
export interface CbpSkips { not_available: number; unknown_flag: number; not_published: number }
export type CbpReport = ImportReport & { skipped: CbpSkips };

const invalid = () => new ImportRequestError('invalid_cbp_parameters');

/** Validate a batch: one reference year, up to ten industries, the metrics asked for, all within one writer batch. */
export function cbpParams(raw: unknown): CbpParams {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const L = CBP_IMPORT_LIMITS;
  if (Object.keys(b).some(k => !['year', 'industries', 'metrics'].includes(k))) throw invalid();
  if (!Number.isInteger(b.year) || Number(b.year) < L.first_year || Number(b.year) > L.last_year) throw invalid();
  const industries = b.industries;
  if (!Array.isArray(industries) || !industries.length || industries.length > L.industries
    || industries.some(v => typeof v !== 'string' || !INDUSTRY_RE.test(v)) || new Set(industries).size !== industries.length) throw invalid();
  const metrics = b.metrics === undefined ? Object.keys(CBP_METRICS) : b.metrics;
  if (!Array.isArray(metrics) || !metrics.length || metrics.length > L.metrics
    || metrics.some(v => typeof v !== 'string' || !Object.hasOwn(CBP_METRICS, v)) || new Set(metrics).size !== metrics.length) throw invalid();
  return { year: Number(b.year), industries: industries as string[], metrics: metrics as Metric[] };
}

/** A file's NAICS cell (`------`, `54----`, `5415//`, `541511`) as this importer names it, or null when it is not one. */
export function cbpIndustry(raw: string): string | null {
  if (raw === '------') return 'all';
  const m = /^(\d{2,6})[-/]*$/.exec(raw);
  return m && raw.length === 6 ? m[1] : null;
}

/** A noise flag read into the note it adds, or a reason to store nothing. */
export function cbpFlag(raw: string | null): { note: string | null } | 'not_available' | 'unknown_flag' {
  if (raw === null) return { note: null };
  if (raw === 'N') return 'not_available';
  return Object.hasOwn(NOISE_NOTES, raw) ? { note: NOISE_NOTES[raw] } : 'unknown_flag';
}

/** One CSV line of the national file: comma-separated, fields optionally in double quotes, no embedded quotes or commas. */
function fields(line: string): string[] {
  return line.split(',').map(f => (f.length >= 2 && f.startsWith('"') && f.endsWith('"') ? f.slice(1, -1) : f).trim());
}

function lastModified(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Read the national file's text into observations for the asked industries and metrics. */
export async function cbpRows(text: string, p: CbpParams, published: string | null, skipped: CbpSkips): Promise<{ rows: Observation[]; seen: number }> {
  const lines = text.split(/\r?\n/);
  const header = fields(lines[0] ?? '');
  const at = (name: string) => header.indexOf(name);
  const needed: string[] = ['naics', 'lfo'];
  for (const m of p.metrics) { needed.push(CBP_METRICS[m].column); const flag: string | null = CBP_METRICS[m].flag; if (flag) needed.push(flag); }
  if (needed.some(n => at(n) < 0)) throw new ImportFailure('provider_payload');
  const wanted = new Set(p.industries), found = new Map<string, string[]>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = fields(lines[i]);
    if (f.length !== header.length) throw new ImportFailure('provider_payload');
    if (f[at('lfo')] !== '-') continue;
    const code = cbpIndustry(f[at('naics')]);
    if (code === null) throw new ImportFailure('provider_payload');
    if (!wanted.has(code)) continue;
    if (found.has(code)) throw new ImportFailure('provider_payload');
    found.set(code, f);
  }
  const rows: Observation[] = [];
  let seen = 0;
  for (const code of p.industries) {
    const f = found.get(code);
    for (const m of p.metrics) {
      seen++;
      if (!f) { skipped.not_published++; continue; }
      const metric = CBP_METRICS[m];
      const flag = cbpFlag(metric.flag ? f[at(metric.flag)] : null);
      if (flag === 'not_available') { skipped.not_available++; continue; }
      if (flag === 'unknown_flag') { skipped.unknown_flag++; continue; }
      const raw = f[at(metric.column)];
      if (!/^\d{1,15}$/.test(raw)) throw new ImportFailure('provider_payload');
      const key = ['cbp', 'us', p.year, code, metric.column].join(':');
      rows.push({
        metric_key: metric.metric_key, metric_label: metric.label, geography_type: 'country', geography_code: 'USA',
        period: String(p.year), value: Number(raw), unit: metric.unit, observation_status: 'unspecified', published_at: published,
        source_observation_key: key,
        vintage: published ?? 'content-sha256:' + await sha256([key, raw, flag.note]),
        statistical_unit: 'establishment', scale: metric.scale, currency: metric.currency, price_basis: metric.price_basis,
        industry_scheme: code === 'all' ? null : 'naics_2017', industry_code: code === 'all' ? null : code, size_band: 'all_sizes',
        series_id: ['CBP', 'US', code, metric.column.toUpperCase()].join('.'),
        supporting_passage: null, applicability_note: null, limitations: [CBP_LIMITATIONS, flag.note].filter(Boolean).join(' '),
      });
    }
  }
  return { rows, seen };
}

async function sha256(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** A provider file's bytes and its Last-Modified date, bounded (D7928 passes its own cap); any transport or size problem is a classed failure. */
export async function providerArchive(url: string, maxBytes: number = CBP_IMPORT_LIMITS.archive_bytes): Promise<{ bytes: Uint8Array; lastModified: string | null }> {
  let response: Response;
  try { response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ImportFailure('provider_transport'); }
  if (!response.ok) { await response.body?.cancel(); throw new ImportFailure('provider_http', response.status); }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new ImportFailure('provider_payload', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImportFailure('provider_payload', response.status);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ImportFailure('provider_payload', response.status); }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    throw new ImportFailure('provider_transport', response.status);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, lastModified: lastModified(response.headers.get('last-modified')) };
}

/** One bounded batch: one file download, at most one writer batch, no continuation. */
export async function ingestCensusCbp(env: Env, raw: unknown, cursor?: unknown): Promise<CbpReport> {
  const params = cbpParams(raw);
  if (cursor !== undefined && cursor !== null) throw new ImportRequestError('invalid_cursor');
  const skipped: CbpSkips = { not_available: 0, unknown_flag: 0, not_published: 0 };
  const report = await runObservationBatch(env, SOURCE_ID, async (): Promise<PreparedBatch> => {
    try {
      const archive = await providerArchive(fileUrl(params.year));
      let text: string;
      try {
        // A literal pattern, then the year checked on the name: the national archive holds one `cbp<yy>us.txt`.
        const entry = await readZipEntry(archive.bytes, /^cbp\d{2}us\.txt$/i, CBP_IMPORT_LIMITS.file_bytes);
        if (entry.name.slice(3, 5) !== String(params.year).slice(2)) throw new ImportFailure('provider_payload');
        text = new TextDecoder('latin1').decode(entry.bytes);
      } catch (error) {
        if (error instanceof ZipReadError) throw new ImportFailure('provider_payload');
        throw error;
      }
      const { rows, seen } = await cbpRows(text, params, archive.lastModified, skipped);
      return { rows, seen, vintage: archive.lastModified ?? (rows.length ? 'content_identified' : 'not_recorded'),
        cursor: null, retry_cursor: null, progressed: true };
    } catch (error) {
      reportPrivateError('import_row', error, 'market_provider_failed');
      for (const k of Object.keys(skipped) as (keyof CbpSkips)[]) skipped[k] = 0;
      return { rows: [], seen: 0, vintage: 'not_recorded', cursor: null, retry_cursor: null, progressed: false,
        failure: error instanceof ImportFailure ? error : new ImportFailure('provider_payload') };
    }
  });
  return { ...report, skipped };
}
