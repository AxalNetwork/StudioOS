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
 *   size_band     one of SIZE_BANDS (half-open euro bands), on the EuroTech list
 *                 only, like size_min/max; it cannot be combined with them.
 *   vintage       one `fund_year`, or `none`; not combined with vintage_from/to.
 *   `none`        for `hq_country`, `focus` and `vintage`: the field is empty
 *                 (NULL or blank) on the row — not recorded, which is a different
 *                 fact from a value the crosswalk cannot place.
 * SORT  name (default), size or vintage, `-` for descending. Size sorts the
 *       euro rows by size and puts every row without a euro size after them.
 * PAGE  `limit` 25 by default, 100 at most; `offset`; `total` counts every match.
 *
 * STEPS 4–5 (the pages) added three read-only blocks to the answer:
 *   coverage  how many rows of the WHOLE directory carry each field (unfiltered).
 *   sources   each list the directory holds, with its row count and as_of.
 *   facets    the filter options with counts. Each facet's counts apply every
 *             OTHER active filter and not its own, so a reader sees what picking
 *             that option would return. A fund whose HQ names two countries
 *             counts under both; an HQ or focus string the crosswalk places
 *             nowhere counts under neither (`facets_unmapped` says how many).
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

/**
 * Euro bands for `size_band`, half-open [min, max) in euro cents, so a fund of
 * exactly €25M is in one band, never two. Euro rows only (EUR_SOURCE).
 */
export const SIZE_BANDS: ReadonlyArray<{ value: string; label: string; min: number | null; max: number | null }> = [
  { value: 'lt25', label: 'Under €25M', min: null, max: 25_000_000_00 },
  { value: '25-50', label: '€25–50M', min: 25_000_000_00, max: 50_000_000_00 },
  { value: '50-100', label: '€50–100M', min: 50_000_000_00, max: 100_000_000_00 },
  { value: '100-250', label: '€100–250M', min: 100_000_000_00, max: 250_000_000_00 },
  { value: '250-500', label: '€250–500M', min: 250_000_000_00, max: 500_000_000_00 },
  { value: '500+', label: '€500M and over', min: 500_000_000_00, max: null },
];

/** A bad query value. `reason` is a sentence this file wrote, safe for a refusal body (D278). */
export class DirectoryQueryError extends Error {
  field: string;
  reason: string;
  constructor(field: string, reason: string) { super(reason); this.field = field; this.reason = reason; }
}

export interface DirectoryQuery {
  q: string;
  hq_country: string | null;
  focus: string | null;
  size_min: number | null;
  size_max: number | null;
  size_band: string | null;
  vintage: number | 'none' | null;
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
  if (hq && hq !== 'NONE' && !/^[A-Z]{2}$/.test(hq)) throw new DirectoryQueryError('hq_country', 'hq_country must be a two-letter country code');
  const focus = (get('focus') ?? '').trim().toLowerCase();
  if (focus && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(focus)) throw new DirectoryQueryError('focus', 'focus must be a market slug');
  const sort = (get('sort') ?? 'name').trim() || 'name';
  if (!Object.hasOwn(SORTS, sort)) throw new DirectoryQueryError('sort', `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const band = (get('size_band') ?? '').trim();
  if (band && !SIZE_BANDS.some((b) => b.value === band)) {
    throw new DirectoryQueryError('size_band', `size_band must be one of ${SIZE_BANDS.map((b) => b.value).join(', ')}`);
  }
  const vRaw = (get('vintage') ?? '').trim().toLowerCase();
  const vintage = vRaw === 'none' ? 'none' as const : int('vintage', vRaw, 1900, 2100);
  const q = {
    q: String(get('q') ?? '').trim().slice(0, 120),
    hq_country: hq === 'NONE' ? 'none' : (hq || null),
    focus: focus || null,
    size_min: int('size_min', get('size_min'), 0, 1_000_000_000_000),
    size_max: int('size_max', get('size_max'), 0, 1_000_000_000_000),
    size_band: band || null,
    vintage,
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
  if (q.size_band && (q.size_min != null || q.size_max != null)) {
    throw new DirectoryQueryError('size_band', 'size_band cannot be combined with size_min or size_max');
  }
  if (q.vintage != null && (q.vintage_from != null || q.vintage_to != null)) {
    throw new DirectoryQueryError('vintage', 'vintage cannot be combined with vintage_from or vintage_to');
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

type Overrides = Awaited<ReturnType<typeof loadOverrides>>;

/** Every distinct raw value of `column`, with how many rows carry it under `clause`. */
async function rawCounts(env: Env, column: 'hq' | 'sector_focus', clause: string, binds: unknown[]) {
  // `column` is one of two literals of this file, never a request value; `clause`
  // is built by `conditions` from literals, with every value in `binds`.
  const rows = await env.DB.prepare(
    `SELECT ${column} AS v, COUNT(*) AS n FROM research_fund_directory ${clause} GROUP BY ${column}`,
  ).bind(...binds).all<{ v: string | null; n: number }>();
  return rows.results || [];
}

/** The distinct raw strings of `column` the crosswalk maps to `target`. */
async function rawValuesMappingTo(env: Env, column: 'hq' | 'sector_focus', target: string, overrides: Overrides): Promise<string[]> {
  // `column` is one of two literals of this file, never a request value.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT ${column} AS v FROM research_fund_directory WHERE TRIM(COALESCE(${column}, '')) <> ''`,
  ).all<{ v: string }>();
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

type FacetKey = 'hq_country' | 'focus' | 'size' | 'vintage' | 'eif' | 'eifo';

/** The crosswalk's answer for an `hq_country` / `focus` filter (a JSON array), resolved once per request. */
interface Resolved { hq: string | null; focus: string | null }

/**
 * The WHERE conditions for `q`, leaving out the filter named by `omit` (a
 * facet's counts apply every other filter, not its own). Every condition is a
 * literal of this function; every value goes into `binds`.
 */
function conditions(q: DirectoryQuery, r: Resolved, omit: FacetKey | null = null) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.q) { where.push(`name LIKE ? ESCAPE '\\'`); binds.push(`%${likeLiteral(q.q)}%`); }
  if (q.hq_country && omit !== 'hq_country') {
    if (q.hq_country === 'none') where.push(`TRIM(COALESCE(hq, '')) = ''`);
    else { where.push(`hq IN (SELECT value FROM json_each(?))`); binds.push(r.hq); }
  }
  if (q.focus && omit !== 'focus') {
    if (q.focus === 'none') where.push(`TRIM(COALESCE(sector_focus, '')) = ''`);
    else { where.push(`sector_focus IN (SELECT value FROM json_each(?))`); binds.push(r.focus); }
  }
  const band = q.size_band ? SIZE_BANDS.find((b) => b.value === q.size_band) ?? null : null;
  const lo = band ? band.min : (q.size_min != null ? q.size_min * 100 : null);
  const hi = band ? band.max : (q.size_max != null ? q.size_max * 100 : null);
  if ((band || q.size_min != null || q.size_max != null) && omit !== 'size') {
    where.push(`source_name = ? AND fund_size_cents IS NOT NULL`);
    binds.push(EUR_SOURCE);
    if (lo != null) { where.push(`fund_size_cents >= ?`); binds.push(lo); }
    // A band is half-open; size_max (whole euros) stays inclusive, as in steps 2–3.
    if (hi != null) { where.push(band ? `fund_size_cents < ?` : `fund_size_cents <= ?`); binds.push(hi); }
  }
  if (omit !== 'vintage') {
    if (q.vintage === 'none') where.push(`fund_year IS NULL`);
    else if (q.vintage != null) { where.push(`fund_year = ?`); binds.push(q.vintage); }
    if (q.vintage_from != null) { where.push(`fund_year >= ?`); binds.push(q.vintage_from); }
    if (q.vintage_to != null) { where.push(`fund_year <= ?`); binds.push(q.vintage_to); }
  }
  for (const [field, col] of [['eif', 'eif_flag'], ['eifo', 'eifo_flag']] as const) {
    if (omit === field) continue;
    const v = q[field];
    if (v === 1) where.push(`${col} = 1`);
    if (v === 0) where.push(`${col} = 0 AND TRIM(COALESCE(notable_lps, '')) <> ''`);
  }
  return { where, binds };
}

const whereClause = (where: string[]) => (where.length ? `WHERE ${where.join(' AND ')}` : '');

/** HQ or focus facet: raw strings → crosswalk targets, summed; blank → `none`. */
async function placeFacet(
  env: Env, column: 'hq' | 'sector_focus', q: DirectoryQuery, r: Resolved, overrides: Overrides,
  labels: Map<string, string>, noneLabel: string,
) {
  const { where, binds } = conditions(q, r, column === 'hq' ? 'hq_country' : 'focus');
  const map = column === 'hq' ? mapFundHq : mapFundFocus;
  const counts = new Map<string, number>();
  let none = 0;
  let unmapped = 0;
  for (const row of await rawCounts(env, column, whereClause(where), binds)) {
    const n = Number(row.n);
    if (String(row.v ?? '').trim() === '') { none += n; continue; }
    const targets = map(row.v, overrides).targets;
    if (!targets.length) unmapped += n;
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + n);
  }
  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, label: labels.get(value) ?? value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { values: [...values, { value: 'none', label: noneLabel, count: none }], unmapped };
}

async function vintageFacet(env: Env, q: DirectoryQuery, r: Resolved) {
  const { where, binds } = conditions(q, r, 'vintage');
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const rows = await env.DB.prepare(
    `SELECT fund_year AS v, COUNT(*) AS n FROM research_fund_directory ${clause} GROUP BY fund_year ORDER BY fund_year DESC`,
  ).bind(...binds).all<{ v: number | null; n: number }>();
  const list = rows.results || [];
  const none = list.filter((x) => x.v == null).reduce((t, x) => t + Number(x.n), 0);
  return [
    ...list.filter((x) => x.v != null).map((x) => ({ value: String(x.v), label: String(x.v), count: Number(x.n) })),
    { value: 'none', label: 'Vintage not recorded', count: none },
  ];
}

/**
 * Size bands count euro rows only (EUR_SOURCE). Every other match — no size,
 * or a size in a currency that is not recorded — is `not_comparable`, and is
 * never put into a band.
 */
async function sizeFacet(env: Env, q: DirectoryQuery, r: Resolved) {
  const { where, binds } = conditions(q, r, 'size');
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const rows = await env.DB.prepare(
    `SELECT CASE WHEN source_name = ? THEN fund_size_cents END AS c, COUNT(*) AS n
       FROM research_fund_directory ${clause} GROUP BY c`,
  ).bind(EUR_SOURCE, ...binds).all<{ c: number | null; n: number }>();
  const bands = SIZE_BANDS.map((b) => ({ value: b.value, label: b.label, count: 0 }));
  let notComparable = 0;
  for (const row of rows.results || []) {
    const n = Number(row.n);
    if (row.c == null) { notComparable += n; continue; }
    const c = Number(row.c);
    const k = SIZE_BANDS.findIndex((b) => (b.min == null || c >= b.min) && (b.max == null || c < b.max));
    if (k < 0) notComparable += n; else bands[k].count += n;
  }
  return { bands, not_comparable: notComparable };
}

/** Backed (flag 1), not backed (flag 0 with LP text), unknown (flag 0, no LP text). */
async function backingFacet(env: Env, q: DirectoryQuery, r: Resolved, field: 'eif' | 'eifo') {
  const { where, binds } = conditions(q, r, field);
  const clause = whereClause(where);
  // `column` is one of two literals of this function, never a request value;
  // `clause` is built from literals of `conditions`, every value in `binds`.
  const column = field === 'eif' ? 'eif_flag' : 'eifo_flag';
  const row = await env.DB.prepare(
    `SELECT SUM(CASE WHEN ${column} = 1 THEN 1 ELSE 0 END) AS backed,
            SUM(CASE WHEN ${column} = 0 AND TRIM(COALESCE(notable_lps, '')) <> '' THEN 1 ELSE 0 END) AS not_backed,
            SUM(CASE WHEN ${column} = 0 AND TRIM(COALESCE(notable_lps, '')) = '' THEN 1 ELSE 0 END) AS unknown
       FROM research_fund_directory ${clause}`,
  ).bind(...binds).first<{ backed: number | null; not_backed: number | null; unknown: number | null }>();
  return { backed: Number(row?.backed ?? 0), not_backed: Number(row?.not_backed ?? 0), unknown: Number(row?.unknown ?? 0) };
}

/** How many rows of the whole directory carry each field, and the lists it holds. */
async function coverageAndSources(env: Env) {
  const [cov, src] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN source_name = ? AND fund_size_cents IS NOT NULL THEN 1 ELSE 0 END) AS size_eur,
              SUM(CASE WHEN source_name <> ? AND fund_size_cents IS NOT NULL THEN 1 ELSE 0 END) AS size_unknown_currency,
              SUM(CASE WHEN TRIM(COALESCE(hq, '')) <> '' THEN 1 ELSE 0 END) AS hq,
              SUM(CASE WHEN TRIM(COALESCE(website, '')) <> '' THEN 1 ELSE 0 END) AS website,
              SUM(CASE WHEN TRIM(COALESCE(linkedin, '')) <> '' THEN 1 ELSE 0 END) AS linkedin,
              SUM(CASE WHEN TRIM(COALESCE(sector_focus, '')) <> '' THEN 1 ELSE 0 END) AS sector_focus,
              SUM(CASE WHEN fund_year IS NOT NULL THEN 1 ELSE 0 END) AS fund_year,
              SUM(CASE WHEN TRIM(COALESCE(notable_lps, '')) <> '' THEN 1 ELSE 0 END) AS notable_lps,
              SUM(CASE WHEN TRIM(COALESCE(fund_number, '')) <> '' THEN 1 ELSE 0 END) AS fund_number,
              MAX(as_of) AS as_of
         FROM research_fund_directory`,
    ).bind(EUR_SOURCE, EUR_SOURCE).first<Record<string, number | string | null>>(),
    env.DB.prepare(
      `SELECT source_name AS name, MAX(source_url) AS url, COUNT(*) AS n, MAX(as_of) AS as_of
         FROM research_fund_directory GROUP BY source_name ORDER BY COUNT(*) DESC, source_name`,
    ).all<{ name: string; url: string | null; n: number; as_of: string | null }>(),
  ]);
  const n = (k: string) => Number(cov?.[k] ?? 0);
  return {
    coverage: {
      total: n('total'),
      as_of: (cov?.as_of as string | null) ?? null,
      fields: {
        size_eur: n('size_eur'),
        size_unknown_currency: n('size_unknown_currency'),
        hq: n('hq'), website: n('website'), linkedin: n('linkedin'), sector_focus: n('sector_focus'),
        fund_year: n('fund_year'), notable_lps: n('notable_lps'), fund_number: n('fund_number'),
      },
    },
    sources: (src.results || []).map((s) => ({
      name: s.name, url: s.url, rows: Number(s.n), as_of: s.as_of,
      size_currency: s.name === EUR_SOURCE ? 'EUR' : null,
    })),
  };
}

/** Labels for the facet values: country names (migration 376) and market names (229). */
async function facetLabels(env: Env) {
  const [countries, markets] = await Promise.all([
    env.DB.prepare(`SELECT code AS v, name FROM research_countries`).all<{ v: string; name: string }>(),
    env.DB.prepare(`SELECT slug AS v, name FROM research_market_directory`).all<{ v: string; name: string }>(),
  ]);
  const toMap = (res: { results?: { v: string; name: string }[] }) => new Map((res.results || []).map((x) => [x.v, x.name]));
  return { countries: toMap(countries), markets: toMap(markets) };
}

export async function listDirectory(env: Env, q: DirectoryQuery) {
  const overrides = await loadOverrides(env);
  const [hqRaw, focusRaw] = await Promise.all([
    q.hq_country && q.hq_country !== 'none' ? rawValuesMappingTo(env, 'hq', q.hq_country, overrides) : null,
    q.focus && q.focus !== 'none' ? rawValuesMappingTo(env, 'sector_focus', q.focus, overrides) : null,
  ]);
  const r: Resolved = { hq: hqRaw && JSON.stringify(hqRaw), focus: focusRaw && JSON.stringify(focusRaw) };
  const { where, binds } = conditions(q, r);
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const [count, page, whole, labels] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM research_fund_directory ${clause}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${COLUMNS} FROM research_fund_directory ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .bind(...binds, q.limit, q.offset).all<DirectoryRow>(),
    coverageAndSources(env),
    facetLabels(env),
  ]);
  const [hq, focus, vintage, size, eif, eifo] = await Promise.all([
    placeFacet(env, 'hq', q, r, overrides, labels.countries, 'HQ not recorded'),
    placeFacet(env, 'sector_focus', q, r, overrides, labels.markets, 'Focus not recorded'),
    vintageFacet(env, q, r),
    sizeFacet(env, q, r),
    backingFacet(env, q, r, 'eif'),
    backingFacet(env, q, r, 'eifo'),
  ]);
  return {
    items: (page.results || []).map(presentFund),
    total: Number(count?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
    sort: q.sort,
    size_basis: 'Sizes are compared and sorted in euros, on the EuroTech list only; other lists record no size in a known currency.',
    coverage: whole.coverage,
    sources: whole.sources,
    facets: {
      hq_country: hq.values,
      focus: focus.values,
      vintage,
      size_band: size.bands,
      size_not_comparable: size.not_comparable,
      eif,
      eifo,
    },
    facets_unmapped: { hq_country: hq.unmapped, focus: focus.unmapped },
    facets_basis: 'Each filter\'s counts apply every other active filter, not its own. A fund whose HQ or focus names two values counts under both; one the crosswalk places nowhere counts under neither. Size bands count euro sizes only.',
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
    // A report's size is shown only in a known currency, like the fund's own.
    const eur = row.source_name === EUR_SOURCE;
    const reports = (r.results || []).map((x: Record<string, unknown>) => ({
      ...x,
      fund_size_cents: eur ? x.fund_size_cents : null,
      size_currency: eur && x.fund_size_cents != null ? 'EUR' : null,
    }));
    return { item: presentFund(row), reports, reports_status: 'ok' as const };
  } catch {
    return { item: presentFund(row), reports: [], reports_status: 'unreadable' as const, reports_reason: 'Unreadable' };
  }
}
