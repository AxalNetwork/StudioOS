/**
 * D535 (#1081), steps 2 and 3 — the fund directory searched, filtered, sorted
 * and paged on the server, and the fund page's errors reported.
 *
 * `GET /api/research/fund-directory` took `q` and `hq` and returned up to
 * 2,000 rows for the browser to filter; the page never called it and filtered
 * a bundled 1.77 MB file instead. This module turns the query string into one
 * bound SQL query with a `total`.
 *
 * FILTERS (every value from the request is bound, never interpolated):
 *   q             the fund's name, as a substring; `%`, `_` and `\` match
 *                 themselves (LIKE … ESCAPE '\').
 *   hq_country    an ISO 3166-1 alpha-2 code, through #1080's crosswalk
 *                 (`mapFundHq`): every distinct HQ string that maps to the
 *                 code is matched, bound as one JSON array.
 *   focus         a market-directory slug, through `mapFundFocus` the same way.
 *   size_min/max  whole euros. Sizes are compared only where the currency is
 *                 known to be euros: the EuroTech rows (S1, 12:17Z on #1081 —
 *                 the lists are never banded, sorted or summed together
 *                 unconverted). A size filter therefore leaves out every row
 *                 whose currency is not recorded.
 *   vintage_from/to  `fund_year`, inclusive.
 *   eif / eifo    `1` backed; `0` not backed, which is only known when the row
 *                 records its LPs (`notable_lps`): a 0 flag with no LP text
 *                 means unknown (S1, 12:17Z).
 *   stage         refused with 400: the directory records no stage yet, and an
 *                 unfiltered answer must never pass for a filtered one.
 * SORT  name (default), size or vintage, `-` for descending. Size sorts the
 *       euro rows by size and puts every row without a euro size after them.
 * PAGE  `limit` 25 by default, 100 at most; `offset`; `total` counts every match.
 */
import type { Env } from '../types';
import { loadOverrides, mapFundFocus, mapFundHq } from './researchTaxonomy';

/** The source whose sizes are euros (`fund_size_cents` = euro cents). */
export const EUR_SOURCE = 'EuroTech VC Funds (public spreadsheet)';

export const SORTS: Readonly<Record<string, string>> = {
  'name': 'name COLLATE NOCASE ASC, uid ASC',
  '-name': 'name COLLATE NOCASE DESC, uid ASC',
  'vintage': 'fund_year IS NULL, fund_year ASC, name COLLATE NOCASE, uid',
  '-vintage': 'fund_year IS NULL, fund_year DESC, name COLLATE NOCASE, uid',
  'size': `(source_name = '${EUR_SOURCE}' AND fund_size_cents IS NOT NULL) DESC, fund_size_cents ASC, name COLLATE NOCASE, uid`,
  '-size': `(source_name = '${EUR_SOURCE}' AND fund_size_cents IS NOT NULL) DESC, fund_size_cents DESC, name COLLATE NOCASE, uid`,
};

export class DirectoryQueryError extends Error {
  field: string;
  constructor(field: string, message: string) { super(message); this.field = field; }
}

export interface DirectoryQuery {
  q: string;
  hq_country: string | null;
  focus: string | null;
  size_min: number | null;
  size_max: number | null;
  vintage_from: number | null;
  vintage_to: number | null;
  eif: 0 | 1 | null;
  eifo: 0 | 1 | null;
  sort: string;
  limit: number;
  offset: number;
}

function int(field: string, raw: string | undefined, min: number, max: number): number | null {
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw)) throw new DirectoryQueryError(field, `${field} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new DirectoryQueryError(field, `${field} must be between ${min} and ${max}`);
  return n;
}

function flag(field: string, raw: string | undefined): 0 | 1 | null {
  if (raw == null || raw === '') return null;
  if (raw === '1' || raw === 'true') return 1;
  if (raw === '0' || raw === 'false') return 0;
  throw new DirectoryQueryError(field, `${field} must be 1 or 0`);
}

/** Read and validate the query string; a bad value is a 400, never a silent default. */
export function parseDirectoryQuery(get: (k: string) => string | undefined): DirectoryQuery {
  if ((get('stage') ?? '') !== '') {
    throw new DirectoryQueryError('stage', 'stage is not recorded in the fund directory yet, so it cannot be filtered on');
  }
  const hq = (get('hq_country') ?? '').trim().toUpperCase();
  if (hq && !/^[A-Z]{2}$/.test(hq)) throw new DirectoryQueryError('hq_country', 'hq_country must be a two-letter country code');
  const focus = (get('focus') ?? '').trim().toLowerCase();
  if (focus && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(focus)) throw new DirectoryQueryError('focus', 'focus must be a market slug');
  const sort = (get('sort') ?? 'name').trim() || 'name';
  if (!Object.hasOwn(SORTS, sort)) throw new DirectoryQueryError('sort', `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const q = {
    q: String(get('q') ?? '').trim().slice(0, 120),
    hq_country: hq || null,
    focus: focus || null,
    size_min: int('size_min', get('size_min'), 0, 1_000_000_000_000),
    size_max: int('size_max', get('size_max'), 0, 1_000_000_000_000),
    vintage_from: int('vintage_from', get('vintage_from'), 1900, 2100),
    vintage_to: int('vintage_to', get('vintage_to'), 1900, 2100),
    eif: flag('eif', get('eif')),
    eifo: flag('eifo', get('eifo')),
    sort,
    limit: int('limit', get('limit'), 1, 100) ?? 25,
    offset: int('offset', get('offset'), 0, 1_000_000) ?? 0,
  };
  if (q.size_min != null && q.size_max != null && q.size_min > q.size_max) {
    throw new DirectoryQueryError('size_min', 'size_min is above size_max');
  }
  if (q.vintage_from != null && q.vintage_to != null && q.vintage_from > q.vintage_to) {
    throw new DirectoryQueryError('vintage_from', 'vintage_from is after vintage_to');
  }
  return q;
}

/** `%`, `_` and `\` match themselves inside a LIKE … ESCAPE '\' pattern. */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The distinct raw strings of `column` the crosswalk maps to `target`. */
async function rawValuesMappingTo(env: Env, column: 'hq' | 'sector_focus', target: string): Promise<string[]> {
  const [rows, overrides] = await Promise.all([
    // `column` is one of two literals of this file, never a request value.
    env.DB.prepare(
      `SELECT DISTINCT ${column} AS v FROM research_fund_directory WHERE TRIM(COALESCE(${column}, '')) <> ''`,
    ).all<{ v: string }>(),
    loadOverrides(env),
  ]);
  const map = column === 'hq' ? mapFundHq : mapFundFocus;
  return (rows.results || []).map((r) => r.v).filter((v) => map(v, overrides).targets.includes(target));
}

const COLUMNS = `uid, name, website, linkedin, hq, fund_number, fund_size_cents,
  fund_date, quarter, fund_year, sector_focus, notable_lps,
  eif_flag, eifo_flag, source_name, source_url, as_of`;

export interface DirectoryRow {
  uid: string; name: string; website: string | null; linkedin: string | null; hq: string | null;
  fund_number: string | null; fund_size_cents: number | null; fund_date: string | null; quarter: string | null;
  fund_year: number | null; sector_focus: string | null; notable_lps: string | null;
  eif_flag: number; eifo_flag: number; source_name: string; source_url: string; as_of: string;
}

/**
 * A row as the API shows it: the currency its size is in, or why there is
 * none; EIF and EIFO as true, false, or null when unknown.
 */
export function presentFund(r: DirectoryRow) {
  const eur = r.source_name === EUR_SOURCE;
  const lpsKnown = typeof r.notable_lps === 'string' && r.notable_lps.trim() !== '';
  const backing = (f: number) => (f ? true : lpsKnown ? false : null);
  return {
    ...r,
    fund_size_cents: eur ? r.fund_size_cents : null,
    size_currency: eur && r.fund_size_cents != null ? 'EUR' : null,
    ...(eur && r.fund_size_cents != null ? {} : {
      size_reason: eur ? 'Not recorded' : 'Not recorded: this list records no size in a known currency',
    }),
    eif: backing(r.eif_flag),
    eifo: backing(r.eifo_flag),
  };
}

export async function listDirectory(env: Env, q: DirectoryQuery) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.q) { where.push(`name LIKE ? ESCAPE '\\'`); binds.push(`%${likeLiteral(q.q)}%`); }
  if (q.hq_country) {
    where.push(`hq IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(await rawValuesMappingTo(env, 'hq', q.hq_country)));
  }
  if (q.focus) {
    where.push(`sector_focus IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(await rawValuesMappingTo(env, 'sector_focus', q.focus)));
  }
  if (q.size_min != null || q.size_max != null) {
    where.push(`source_name = ? AND fund_size_cents IS NOT NULL`);
    binds.push(EUR_SOURCE);
    if (q.size_min != null) { where.push(`fund_size_cents >= ?`); binds.push(q.size_min * 100); }
    if (q.size_max != null) { where.push(`fund_size_cents <= ?`); binds.push(q.size_max * 100); }
  }
  if (q.vintage_from != null) { where.push(`fund_year >= ?`); binds.push(q.vintage_from); }
  if (q.vintage_to != null) { where.push(`fund_year <= ?`); binds.push(q.vintage_to); }
  for (const [field, col] of [['eif', 'eif_flag'], ['eifo', 'eifo_flag']] as const) {
    const v = q[field];
    if (v === 1) where.push(`${col} = 1`);
    if (v === 0) where.push(`${col} = 0 AND TRIM(COALESCE(notable_lps, '')) <> ''`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // `clause` is built from literals of this function; every value is in `binds`.
  const [count, page] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM research_fund_directory ${clause}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${COLUMNS} FROM research_fund_directory ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .bind(...binds, q.limit, q.offset).all<DirectoryRow>(),
  ]);
  return {
    items: (page.results || []).map(presentFund),
    total: Number(count?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
    sort: q.sort,
    size_basis: 'Sizes are compared and sorted in euros, on the EuroTech list only; other lists record no size in a known currency.',
  };
}

/**
 * One fund and its reports. A failed reports read is reported on its own
 * (`reports_status: 'unreadable'`), never passed off as a fund with no reports.
 * `reports` stays an array so the existing page keeps reading it.
 */
export async function getFund(env: Env, uid: string) {
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM research_fund_directory WHERE uid = ?`)
    .bind(uid).first<DirectoryRow>();
  if (!row) return null;
  try {
    const r = await env.DB.prepare(
      `SELECT period, report_date, fund_size_cents, source_url
         FROM research_fund_directory_reports WHERE fund_uid = ? ORDER BY period ASC`,
    ).bind(uid).all();
    return { item: presentFund(row), reports: r.results || [], reports_status: 'ok' as const };
  } catch {
    return { item: presentFund(row), reports: [], reports_status: 'unreadable' as const, reports_reason: 'Unreadable' };
  }
}
