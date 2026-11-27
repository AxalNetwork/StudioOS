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
 *   size_min/max  whole units of the asked `size_currency` (euros by default).
 *                 Sizes are compared only on rows that record their size in
 *                 that currency (S1, 12:17Z on #1081 — the lists are never
 *                 banded, sorted or summed together unconverted). A size filter
 *                 therefore leaves out every row whose currency is not recorded.
 *   vintage_from/to  `fund_year`, inclusive.
 *   eif / eifo    `1` backed; `0` not backed, which is only known when the row
 *                 records its LPs (`notable_lps`): a 0 flag with no LP text
 *                 means unknown (S1, 12:17Z).
 *   stage         refused with 400: the directory records no stage yet, and an
 *                 unfiltered answer must never pass for a filtered one.
 *   size_band     one of SIZE_BANDS (half-open bands of the asked currency), on
 *                 the rows sized in it only, like size_min/max; it cannot be combined with them.
 *                 `none` (D7166 part 2, RFD-02's "Show them") is the other
 *                 side of a size filter: every match with no size in the
 *                 asked `size_currency`, the rows `size_not_comparable` counts.
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
 *
 * D597 (#1232) — each list's publisher and terms (migration 406):
 *   SERVED_FUNDS  every read of fund rows goes through it, never through the
 *                 table: it leaves out each row of a list whose terms forbid
 *                 republishing (`research_fund_sources.verdict = 'not allowed'`).
 *   source        on every row and in the profile: the list's name, publisher,
 *                 link and terms verdict. A list with no review row is still
 *                 served, and says its terms were not reviewed.
 *   removed_sources  the lists taken down, with why and how many funds are withheld.
 *
 * D7166 (#7166) — sizes in each list's own currency, and one row per vehicle:
 *   currency      each list's own currency: EuroTech in euros, the Shai
 *                 Goldman list in US dollars (migration 429, its 1A note).
 *                 D7744 moved it from a LIST_CURRENCY map keyed by list name
 *                 onto each row. Sizes are never compared, banded or sorted across
 *                 currencies: `size_currency` (EUR by default, or USD) picks
 *                 the one currency size_min/max, size_band, the size sort and
 *                 the size facet work in, and every other match is left out
 *                 of them and counted (`size_not_comparable`).
 *   moves         migration 202611180052 keyed the EuroTech list by manager
 *                 plus fund number; each old manager uid that no longer names a
 *                 row is recorded in `research_fund_directory_uid_moves`, and
 *                 `getFund` follows it, so an old link opens the same vehicle.
 *
 * D7744 (#7744) — a row carries its own size currency and record kind
 * (migration 202611270508_7744): `fund_size_currency` (three capitals or
 * NULL) on each row and each report row, `record_kind` (vehicle, manager,
 * accelerator, resource, or NULL) on each row, stamped from
 * `research_fund_list_defaults` for the lists that table names. Every read
 * here takes the currency from the row, never from the list's name, so a
 * third list's GBP size is shown, filtered, banded and sorted in GBP, and a
 * size with no currency is counted (`size_unknown_currency`) and never shown.
 * `size_currency` takes any three-letter code (EUR by default); a code no
 * served row holds matches no size and is not an error. `kind` filters on
 * `record_kind` (`none`: not recorded), with a facet. Sizes are never converted.
 */
import type { Env } from '../types';
import { loadOverrides, mapFundFocus, mapFundHq } from './researchTaxonomy';
import { fundProfile } from './researchFundProfile';

/**
 * The EuroTech list's name. D7744: no read decides a currency from it any
 * more (the row carries `fund_size_currency`); it stays for the fixtures and
 * the importers that name the list.
 */
export const EUR_SOURCE = 'EuroTech VC Funds (public spreadsheet)';
/** The Shai Goldman list's name (migration 429). Like EUR_SOURCE, never used to pick a currency. */
export const USD_SOURCE = 'Shai Goldman — new VC funds at/below $200M';

/** D7744: a size currency is any three capital letters (the migration's trigger holds the same rule). */
export type SizeCurrency = string;
export const isSizeCurrency = (v: unknown): v is SizeCurrency => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/** D7744: the record kinds migration 202611270508_7744's trigger allows; NULL is "kind not recorded". */
export const RECORD_KINDS = ['vehicle', 'manager', 'accelerator', 'resource'] as const;
export type RecordKind = typeof RECORD_KINDS[number];
export const KIND_NOT_RECORDED = 'Kind not recorded';
const isKind = (v: unknown): v is RecordKind => (RECORD_KINDS as readonly unknown[]).includes(v);

/**
 * D7744: the one helper Markets and Overview use to choose a euro size — by the
 * row's own currency, never its list's name. Null when the row has no size or
 * its size is in another currency (or in none recorded).
 */
export function euroSizeCents(f: { fund_size_cents: number | null; fund_size_currency?: string | null }): number | null {
  return f.fund_size_currency === 'EUR' && f.fund_size_cents != null ? Number(f.fund_size_cents) : null;
}
/** The same rule in SQL over a served fund row: its euro size, else NULL. A literal of this file. */
export const EURO_SIZE_SQL = `CASE WHEN fund_size_currency = 'EUR' THEN fund_size_cents END`;

/** The three terms verdicts migration 406's CHECK allows, and no other. */
export const FUND_SOURCE_VERDICTS = ['republish allowed', 'cite only', 'not allowed'] as const;
export type FundSourceVerdict = typeof FUND_SOURCE_VERDICTS[number];

/**
 * D597 (#1232): the fund rows the API may serve — every row of
 * `research_fund_directory` except those of a list whose verdict is
 * 'not allowed' in `research_fund_sources` (migration 406). Read fund rows
 * as `FROM ${SERVED_FUNDS} AS f`, never from the table. A literal of this
 * file: no request value reaches it. If the sources table cannot be read,
 * the query fails and the page says "Unreadable"; it never serves every list.
 */
export const SERVED_FUNDS = `(SELECT * FROM research_fund_directory d WHERE NOT EXISTS (
  SELECT 1 FROM research_fund_sources s WHERE s.source_name = d.source_name AND s.verdict = 'not allowed'))`;

/** One list's review, as migration 406 records it. */
export interface FundSourceRow {
  source_name: string; title: string; publisher: string | null; published_url: string | null;
  terms_status: 'found' | 'not found'; terms_quote: string | null; evidence_url: string | null; evidence: string;
  verdict: FundSourceVerdict; verdict_reason: string; reviewed_on: string;
  repo_copy: string | null; repo_copy_note: string | null;
}

export const SOURCE_NOT_REVIEWED = 'Not recorded: this list\'s terms have not been reviewed';

/** Every list's review, by source name. */
export async function loadFundSources(env: Env): Promise<Map<string, FundSourceRow>> {
  const r = await env.DB.prepare(
    `SELECT source_name, title, publisher, published_url, terms_status, terms_quote, evidence_url, evidence,
            verdict, verdict_reason, reviewed_on, repo_copy, repo_copy_note
       FROM research_fund_sources`,
  ).all<FundSourceRow>();
  return new Map((r.results || []).map((s) => [s.source_name, s]));
}

/**
 * How a fund cites its list: name, publisher, link and terms verdict. The
 * link is where the list is published, else where the row was read from. A
 * list with no review row has no verdict, and `reason` says so.
 */
export function citeSource(name: string, rowUrl: string | null, s: FundSourceRow | undefined) {
  if (!s) {
    return { name, title: null, publisher: null, url: rowUrl, verdict: null, terms_status: null,
      terms_quote: null, evidence_url: null, reviewed_on: null, reason: SOURCE_NOT_REVIEWED };
  }
  return { name, title: s.title, publisher: s.publisher, url: s.published_url ?? rowUrl, verdict: s.verdict,
    terms_status: s.terms_status, terms_quote: s.terms_quote, evidence_url: s.evidence_url,
    reviewed_on: s.reviewed_on, reason: s.verdict_reason };
}

export const SORTS: Readonly<Record<string, string>> = {
  'name': 'name COLLATE NOCASE ASC, uid ASC',
  '-name': 'name COLLATE NOCASE DESC, uid ASC',
  'vintage': 'fund_year IS NULL, fund_year ASC, name COLLATE NOCASE, uid',
  '-vintage': 'fund_year IS NULL, fund_year DESC, name COLLATE NOCASE, uid',
  // D7744: `?` is the asked `size_currency`, matched against each row's own currency, bound by `orderBy`.
  'size': `(fund_size_currency = ? AND fund_size_cents IS NOT NULL) DESC, fund_size_cents ASC, name COLLATE NOCASE, uid`,
  '-size': `(fund_size_currency = ? AND fund_size_cents IS NOT NULL) DESC, fund_size_cents DESC, name COLLATE NOCASE, uid`,
};

/** The binds `SORTS[q.sort]` takes: a size sort puts the asked currency's sized rows first. */
export function orderBy(q: Pick<DirectoryQuery, 'sort' | 'size_currency'>): { binds: unknown[] } {
  return { binds: SORTS[q.sort].includes('?') ? [q.size_currency ?? 'EUR'] : [] };
}

/**
 * Bands for `size_band`, half-open [min, max) in cents of the asked
 * `size_currency`, so a fund of exactly 25M is in one band, never two. The
 * labels are in euros; `sizeBands` names them in the asked currency (D7166).
 */
export const SIZE_BANDS: ReadonlyArray<{ value: string; label: string; min: number | null; max: number | null }> = [
  { value: 'lt25', label: 'Under €25M', min: null, max: 25_000_000_00 },
  { value: '25-50', label: '€25–50M', min: 25_000_000_00, max: 50_000_000_00 },
  { value: '50-100', label: '€50–100M', min: 50_000_000_00, max: 100_000_000_00 },
  { value: '100-250', label: '€100–250M', min: 100_000_000_00, max: 250_000_000_00 },
  { value: '250-500', label: '€250–500M', min: 250_000_000_00, max: 500_000_000_00 },
  { value: '500+', label: '€500M and over', min: 500_000_000_00, max: null },
];

const CURRENCY_MARK: Readonly<Record<string, string>> = { EUR: '€', USD: 'US$', GBP: '£' };
/** D7744: the words a sentence names a currency by; any other code is named by itself. */
const CURRENCY_WORD: Readonly<Record<string, string>> = { EUR: 'euros', USD: 'US dollars', GBP: 'pounds sterling' };
export const currencyWord = (c: SizeCurrency) => CURRENCY_WORD[c] ?? c;

/** D7166: SIZE_BANDS labelled in `currency`; a code with no mark is written before the figure (D7744). */
export function sizeBands(currency: SizeCurrency) {
  return SIZE_BANDS.map((b) => ({ ...b, label: b.label.replaceAll('€', CURRENCY_MARK[currency] ?? `${currency} `) }));
}

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
  /** D7166: the one currency sizes are filtered, banded and sorted in. */
  size_currency: SizeCurrency;
  /** D7744: one record kind, or `none` for a row whose kind is not recorded. */
  kind?: RecordKind | 'none' | null;
  limit: number;
  offset: number;
  /**
   * D1190 (#3124): two filters only Capital relationships' match read sets,
   * never `parseDirectoryQuery`. `focus_in` is the raw `sector_focus` strings
   * whose Fit against the venture is the one asked for (computed by `fundFit`,
   * which SQL cannot run), with `focus_in_blank` for a fund that records none;
   * `name_in` is the lower-cased fund names the caller's own network works at.
   */
  focus_in?: string[] | null;
  focus_in_blank?: boolean;
  name_in?: string[] | null;
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
  if (band && band !== 'none' && !SIZE_BANDS.some((b) => b.value === band)) {
    throw new DirectoryQueryError('size_band', `size_band must be one of ${SIZE_BANDS.map((b) => b.value).join(', ')}, none`);
  }
  // D7744: any three-letter code; one no served row holds matches no size, which is not an error.
  const ccy = (get('size_currency') ?? '').trim().toUpperCase() || 'EUR';
  if (!isSizeCurrency(ccy)) {
    throw new DirectoryQueryError('size_currency', 'size_currency must be a three-letter currency code, such as EUR');
  }
  const kind = (get('kind') ?? '').trim().toLowerCase();
  if (kind && kind !== 'none' && !isKind(kind)) {
    throw new DirectoryQueryError('kind', `kind must be one of ${RECORD_KINDS.join(', ')}, none`);
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
    size_currency: ccy,
    kind: (kind || null) as RecordKind | 'none' | null,
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
    `SELECT ${column} AS v, COUNT(*) AS n FROM ${SERVED_FUNDS} AS f ${clause} GROUP BY ${column}`,
  ).bind(...binds).all<{ v: string | null; n: number }>();
  return rows.results || [];
}

/**
 * D1190 (#3124): every distinct non-blank `sector_focus` the served funds carry,
 * for Capital relationships' Fit filter (`fundFit` runs on each in JS). Through
 * `rawCounts`, so it adds no query of its own.
 */
export async function servedFocusValues(env: Env): Promise<string[]> {
  return (await rawCounts(env, 'sector_focus', '', [])).map((r) => r.v).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** The distinct raw strings of `column` the crosswalk maps to `target`. */
async function rawValuesMappingTo(env: Env, column: 'hq' | 'sector_focus', target: string, overrides: Overrides): Promise<string[]> {
  // `column` is one of two literals of this file, never a request value.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT ${column} AS v FROM ${SERVED_FUNDS} AS f WHERE TRIM(COALESCE(${column}, '')) <> ''`,
  ).all<{ v: string }>();
  const map = column === 'hq' ? mapFundHq : mapFundFocus;
  return (rows.results || []).map((r) => r.v).filter((v) => map(v, overrides).targets.includes(target));
}

/** D7744: a directory row's columns, in order; every read that builds a `DirectoryRow` by hand selects these. */
export const DIRECTORY_COLUMNS = [
  'uid', 'name', 'website', 'linkedin', 'hq', 'fund_number', 'fund_size_cents', 'fund_size_currency',
  'fund_date', 'quarter', 'fund_year', 'sector_focus', 'notable_lps',
  'eif_flag', 'eifo_flag', 'source_name', 'source_url', 'as_of', 'record_kind',
] as const;

/** The column list for a SELECT, each prefixed with `alias.` when one is given (a literal of the caller). */
export function directoryColumns(alias = ''): string {
  return DIRECTORY_COLUMNS.map((c) => (alias ? `${alias}.${c}` : c)).join(', ');
}

const COLUMNS = directoryColumns();

export interface DirectoryRow {
  uid: string; name: string; website: string | null; linkedin: string | null; hq: string | null;
  fund_number: string | null; fund_size_cents: number | null; fund_date: string | null; quarter: string | null;
  fund_year: number | null; sector_focus: string | null; notable_lps: string | null;
  eif_flag: number; eifo_flag: number; source_name: string; source_url: string; as_of: string;
  /** D7744: the size's currency as the row records it; NULL when none is recorded. */
  fund_size_currency?: string | null;
  /** D7744: what the row's list says the row is; NULL when not recorded. */
  record_kind?: string | null;
}

/** The reason a size with no recorded currency is not shown (D7744: counted, never printed). */
export const NO_SIZE_CURRENCY = 'Not recorded: this list records no size in a known currency';

/**
 * A row as the API shows it: the currency its size is in (the row's own,
 * D7744), or why there is none; EIF and EIFO as true, false, or null when
 * unknown; its record kind, or why there is none.
 */
export function presentFund(r: DirectoryRow) {
  const { fund_size_currency: raw, ...rest } = r;
  const currency = isSizeCurrency(raw) ? raw : null;
  const sized = currency != null && r.fund_size_cents != null;
  const lpsKnown = typeof r.notable_lps === 'string' && r.notable_lps.trim() !== '';
  const backing = (f: number) => (f ? true : lpsKnown ? false : null);
  const kind = isKind(r.record_kind) ? r.record_kind : null;
  return {
    ...rest,
    fund_size_cents: sized ? r.fund_size_cents : null,
    size_currency: sized ? currency : null,
    ...(sized ? {} : { size_reason: r.fund_size_cents == null ? 'Not recorded' : NO_SIZE_CURRENCY }),
    record_kind: kind,
    ...(kind ? {} : { record_kind_reason: KIND_NOT_RECORDED }),
    eif: backing(r.eif_flag),
    eifo: backing(r.eifo_flag),
  };
}

type FacetKey = 'hq_country' | 'focus' | 'size' | 'vintage' | 'eif' | 'eifo' | 'kind';

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
  if (q.size_band === 'none' && omit !== 'size') {
    // D7166 part 2: the matches a size filter leaves out — no size in the asked currency
    // (no amount, another currency, or a currency not recorded), as `sizeFacet` counts them.
    where.push(`(COALESCE(fund_size_currency, '') <> ? OR fund_size_cents IS NULL)`);
    binds.push(q.size_currency ?? 'EUR');
  }
  const band = q.size_band ? SIZE_BANDS.find((b) => b.value === q.size_band) ?? null : null;
  const lo = band ? band.min : (q.size_min != null ? q.size_min * 100 : null);
  const hi = band ? band.max : (q.size_max != null ? q.size_max * 100 : null);
  if ((band || q.size_min != null || q.size_max != null) && omit !== 'size') {
    // D7744: whole units and bands of the asked currency, on the rows that record their size in it.
    where.push(`fund_size_currency = ? AND fund_size_cents IS NOT NULL`);
    binds.push(q.size_currency ?? 'EUR');
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
  if (q.kind && omit !== 'kind') {
    if (q.kind === 'none') where.push(`record_kind IS NULL`);
    else { where.push(`record_kind = ?`); binds.push(q.kind); }
  }
  if (q.focus_in) {
    where.push(q.focus_in_blank
      ? `(sector_focus IN (SELECT value FROM json_each(?)) OR TRIM(COALESCE(sector_focus, '')) = '')`
      : `sector_focus IN (SELECT value FROM json_each(?))`);
    binds.push(JSON.stringify(q.focus_in));
  }
  if (q.name_in) { where.push(`LOWER(TRIM(name)) IN (SELECT value FROM json_each(?))`); binds.push(JSON.stringify(q.name_in)); }
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
    `SELECT fund_year AS v, COUNT(*) AS n FROM ${SERVED_FUNDS} AS f ${clause} GROUP BY fund_year ORDER BY fund_year DESC`,
  ).bind(...binds).all<{ v: number | null; n: number }>();
  const list = rows.results || [];
  const none = list.filter((x) => x.v == null).reduce((t, x) => t + Number(x.n), 0);
  return [
    ...list.filter((x) => x.v != null).map((x) => ({ value: String(x.v), label: String(x.v), count: Number(x.n) })),
    { value: 'none', label: 'Vintage not recorded', count: none },
  ];
}

/**
 * Size bands count the rows whose own currency is the asked one (D7744).
 * Every other match — no size, a size in the other currency, or one in a
 * currency that is not recorded — is `not_comparable`, never put into a band.
 */
async function sizeFacet(env: Env, q: DirectoryQuery, r: Resolved) {
  const { where, binds } = conditions(q, r, 'size');
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const rows = await env.DB.prepare(
    `SELECT CASE WHEN fund_size_currency = ? THEN fund_size_cents END AS c, COUNT(*) AS n
       FROM ${SERVED_FUNDS} AS f ${clause} GROUP BY c`,
  ).bind(q.size_currency ?? 'EUR', ...binds).all<{ c: number | null; n: number }>();
  const bands = sizeBands(q.size_currency ?? 'EUR').map((b) => ({ value: b.value, label: b.label, count: 0 }));
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

/** D7744: matches per record kind, every other filter applied; `none` is the rows whose kind is not recorded. */
async function kindFacet(env: Env, q: DirectoryQuery, r: Resolved) {
  const { where, binds } = conditions(q, r, 'kind');
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const rows = await env.DB.prepare(
    `SELECT record_kind AS v, COUNT(*) AS n FROM ${SERVED_FUNDS} AS f ${clause} GROUP BY record_kind`,
  ).bind(...binds).all<{ v: string | null; n: number }>();
  return kindCounts(rows.results || []);
}

/** The four kinds and `none`, each with its count, from `record_kind` groups; the counts sum to the rows grouped. */
function kindCounts(rows: Array<{ v: string | null; n: number }>) {
  const by = new Map(rows.map((x) => [x.v, Number(x.n)]));
  const none = rows.filter((x) => !isKind(x.v)).reduce((t, x) => t + Number(x.n), 0);
  return [
    ...RECORD_KINDS.map((k) => ({ value: k as string, label: k[0].toUpperCase() + k.slice(1), count: by.get(k) ?? 0 })),
    { value: 'none', label: KIND_NOT_RECORDED, count: none },
  ];
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
       FROM ${SERVED_FUNDS} AS f ${clause}`,
  ).bind(...binds).first<{ backed: number | null; not_backed: number | null; unknown: number | null }>();
  return { backed: Number(row?.backed ?? 0), not_backed: Number(row?.not_backed ?? 0), unknown: Number(row?.unknown ?? 0) };
}

/**
 * How many rows of the whole served directory carry each field, the lists it
 * holds with each one's review, and the lists taken down (D597) with how many
 * funds each withholds — a count, never a row.
 */
async function coverageAndSources(env: Env, reviews: Map<string, FundSourceRow>) {
  const [cov, src, gone, sized, kinds] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN fund_size_currency IS NULL AND fund_size_cents IS NOT NULL THEN 1 ELSE 0 END) AS size_unknown_currency,
              SUM(CASE WHEN TRIM(COALESCE(hq, '')) <> '' THEN 1 ELSE 0 END) AS hq,
              SUM(CASE WHEN TRIM(COALESCE(website, '')) <> '' THEN 1 ELSE 0 END) AS website,
              SUM(CASE WHEN TRIM(COALESCE(linkedin, '')) <> '' THEN 1 ELSE 0 END) AS linkedin,
              SUM(CASE WHEN TRIM(COALESCE(sector_focus, '')) <> '' THEN 1 ELSE 0 END) AS sector_focus,
              SUM(CASE WHEN fund_year IS NOT NULL THEN 1 ELSE 0 END) AS fund_year,
              SUM(CASE WHEN TRIM(COALESCE(notable_lps, '')) <> '' THEN 1 ELSE 0 END) AS notable_lps,
              SUM(CASE WHEN TRIM(COALESCE(fund_number, '')) <> '' THEN 1 ELSE 0 END) AS fund_number,
              MAX(as_of) AS as_of
         FROM ${SERVED_FUNDS} AS f`,
    ).first<Record<string, number | string | null>>(),
    env.DB.prepare(
      `SELECT source_name AS name, MAX(source_url) AS url, COUNT(*) AS n, MAX(as_of) AS as_of
         FROM ${SERVED_FUNDS} AS f GROUP BY source_name ORDER BY COUNT(*) DESC, source_name`,
    ).all<{ name: string; url: string | null; n: number; as_of: string | null }>(),
    env.DB.prepare(
      `SELECT source_name AS name, COUNT(*) AS n FROM research_fund_directory
        WHERE source_name IN (SELECT source_name FROM research_fund_sources WHERE verdict = 'not allowed')
        GROUP BY source_name`,
    ).all<{ name: string; n: number }>(),
    // D7744: the sized rows per list and per the row's own currency (NULL: none recorded).
    env.DB.prepare(
      `SELECT source_name AS name, fund_size_currency AS c, COUNT(*) AS n FROM ${SERVED_FUNDS} AS f
        WHERE fund_size_cents IS NOT NULL GROUP BY source_name, fund_size_currency`,
    ).all<{ name: string; c: string | null; n: number }>(),
    env.DB.prepare(`SELECT record_kind AS v, COUNT(*) AS n FROM ${SERVED_FUNDS} AS f GROUP BY record_kind`)
      .all<{ v: string | null; n: number }>(),
  ]);
  const withheld = new Map((gone.results || []).map((g) => [g.name, Number(g.n)]));
  const n = (k: string) => Number(cov?.[k] ?? 0);
  const byCurrency: Record<string, number> = {};
  const listCurrencies = new Map<string, Set<string>>();
  for (const x of sized.results || []) {
    if (!isSizeCurrency(x.c)) continue;
    byCurrency[x.c] = (byCurrency[x.c] ?? 0) + Number(x.n);
    if (!listCurrencies.has(x.name)) listCurrencies.set(x.name, new Set());
    listCurrencies.get(x.name)!.add(x.c);
  }
  const currenciesOf = (name: string) => [...(listCurrencies.get(name) ?? [])].sort();
  return {
    coverage: {
      total: n('total'),
      as_of: (cov?.as_of as string | null) ?? null,
      fields: {
        size_eur: byCurrency.EUR ?? 0,
        size_usd: byCurrency.USD ?? 0,
        size_unknown_currency: n('size_unknown_currency'),
        // D7744: rows with a size, per the currency each row records it in.
        size_by_currency: Object.fromEntries(Object.keys(byCurrency).sort().map((c) => [c, byCurrency[c]])),
        hq: n('hq'), website: n('website'), linkedin: n('linkedin'), sector_focus: n('sector_focus'),
        fund_year: n('fund_year'), notable_lps: n('notable_lps'), fund_number: n('fund_number'),
      },
      // D7744: rows per record kind; `none` is the rows whose kind is not recorded. They sum to `total`.
      kinds: kindCounts(kinds.results || []),
    },
    /** D7744: the currencies the served sized rows hold: the options the size currency control offers. */
    size_currencies: Object.keys(byCurrency).sort(),
    sources: (src.results || []).map((s) => {
      const cite = citeSource(s.name, s.url, reviews.get(s.name));
      return {
        name: s.name, url: s.url, rows: Number(s.n), as_of: s.as_of,
        // D7744: the currencies this list's sized rows record; `size_currency` is that one when there is exactly one.
        size_currencies: currenciesOf(s.name),
        size_currency: currenciesOf(s.name).length === 1 ? currenciesOf(s.name)[0] : null,
        title: cite.title, publisher: cite.publisher, published_url: cite.url, verdict: cite.verdict,
        terms_status: cite.terms_status, terms_quote: cite.terms_quote, evidence_url: cite.evidence_url,
        reviewed_on: cite.reviewed_on, reason: cite.reason,
      };
    }),
    removed_sources: [...reviews.values()].filter((s) => s.verdict === 'not allowed')
      .sort((a, b) => a.source_name.localeCompare(b.source_name))
      .map((s) => ({
        name: s.source_name, title: s.title, publisher: s.publisher, published_url: s.published_url,
        verdict: s.verdict, reason: s.verdict_reason, terms_quote: s.terms_quote, evidence_url: s.evidence_url,
        reviewed_on: s.reviewed_on, funds_withheld: withheld.get(s.source_name) ?? 0,
      })),
  };
}

/** A served row as the API shows it, citing its list (D597). */
function presentCited(r: DirectoryRow, reviews: Map<string, FundSourceRow>) {
  return { ...presentFund(r), source: citeSource(r.source_name, r.source_url, reviews.get(r.source_name)) };
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

/** D7744: what a size comparison covers, derived from the asked currency; it names no list. */
export function sizeBasis(currency: SizeCurrency): string {
  const word = currencyWord(currency);
  return `Sizes are compared and sorted in ${word}, on the funds whose list records their size in ${word}; sizes in another currency are compared on their own and never converted, and a size with no recorded currency is not shown.`;
}

export async function listDirectory(env: Env, q: DirectoryQuery) {
  const [overrides, reviews] = await Promise.all([loadOverrides(env), loadFundSources(env)]);
  const [hqRaw, focusRaw] = await Promise.all([
    q.hq_country && q.hq_country !== 'none' ? rawValuesMappingTo(env, 'hq', q.hq_country, overrides) : null,
    q.focus && q.focus !== 'none' ? rawValuesMappingTo(env, 'sector_focus', q.focus, overrides) : null,
  ]);
  const r: Resolved = { hq: hqRaw && JSON.stringify(hqRaw), focus: focusRaw && JSON.stringify(focusRaw) };
  const { where, binds } = conditions(q, r);
  const clause = whereClause(where);
  // `clause` is built from literals of `conditions`; every value is in `binds`.
  const order = orderBy(q);
  const [count, page, whole, labels] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM ${SERVED_FUNDS} AS f ${clause}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${COLUMNS} FROM ${SERVED_FUNDS} AS f ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .bind(...binds, ...order.binds, q.limit, q.offset).all<DirectoryRow>(),
    coverageAndSources(env, reviews),
    facetLabels(env),
  ]);
  const [hq, focus, vintage, size, eif, eifo, kind] = await Promise.all([
    placeFacet(env, 'hq', q, r, overrides, labels.countries, 'HQ not recorded'),
    placeFacet(env, 'sector_focus', q, r, overrides, labels.markets, 'Focus not recorded'),
    vintageFacet(env, q, r),
    sizeFacet(env, q, r),
    backingFacet(env, q, r, 'eif'),
    backingFacet(env, q, r, 'eifo'),
    kindFacet(env, q, r),
  ]);
  return {
    items: (page.results || []).map((row) => presentCited(row, reviews)),
    total: Number(count?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
    sort: q.sort,
    size_currency: q.size_currency,
    size_currencies: whole.size_currencies,
    kind: q.kind ?? null,
    size_basis: sizeBasis(q.size_currency),
    coverage: whole.coverage,
    sources: whole.sources,
    removed_sources: whole.removed_sources,
    facets: {
      hq_country: hq.values,
      focus: focus.values,
      vintage,
      size_band: size.bands,
      size_not_comparable: size.not_comparable,
      eif,
      eifo,
      kind,
    },
    facets_unmapped: { hq_country: hq.unmapped, focus: focus.unmapped },
    facets_basis: 'Each filter\'s counts apply every other active filter, not its own. A fund whose HQ or focus names two values counts under both; one the crosswalk places nowhere counts under neither. Size bands count sizes in the asked currency only.',
  };
}

/** `getFund`'s answer: `removed` alone for a list taken down, else the fund. */
interface FundAnswer {
  removed?: ReturnType<typeof citeSource>;
  /** D7167: the item carries its dated provenance and the four proposed fields. */
  item?: ReturnType<typeof presentCited> & Pick<Awaited<ReturnType<typeof fundProfile>>, 'provenance' | 'proposed'>;
  /** D7167: the vehicle-labelled history (services/researchFundProfile.ts). */
  history?: Awaited<ReturnType<typeof fundProfile>>['history'];
  reports?: Record<string, unknown>[];
  reports_status?: 'ok' | 'unreadable';
  reports_reason?: string;
  /** D7166: the retired uid that was asked, when it moved to this vehicle. */
  moved_from?: string | null;
}

/**
 * One fund and its reports. A failed reports read is reported on its own
 * (`reports_status: 'unreadable'`), never passed off as a fund with no reports.
 * `reports` stays an array so the existing page keeps reading it.
 *
 * A fund of a list taken down (D597) answers `{ removed }`: the list, its
 * publisher and why — never the fund's own fields.
 *
 * D7167: the item also carries its dated `provenance` and the four `proposed`
 * fields, and the answer a vehicle-labelled `history` (services/researchFundProfile.ts).
 */
export async function getFund(env: Env, uid: string, movedFrom: string | null = null): Promise<FundAnswer | null> {
  const [row, reviews] = await Promise.all([
    env.DB.prepare(`SELECT ${COLUMNS} FROM ${SERVED_FUNDS} AS f WHERE uid = ?`).bind(uid).first<DirectoryRow>(),
    loadFundSources(env),
  ]);
  if (!row) {
    const held = await env.DB.prepare(`SELECT source_name FROM research_fund_directory WHERE uid = ?`)
      .bind(uid).first<{ source_name: string }>();
    if (!held && movedFrom == null) {
      // D7166: a uid the vehicle re-import retired opens the vehicle it moved to (one hop).
      const move = await env.DB.prepare(`SELECT new_uid FROM research_fund_directory_uid_moves WHERE old_uid = ?`)
        .bind(uid).first<{ new_uid: string }>().catch(() => null);
      return move?.new_uid ? getFund(env, move.new_uid, uid) : null;
    }
    const review = held ? reviews.get(held.source_name) : undefined;
    if (review?.verdict !== 'not allowed') return null;
    return { removed: citeSource(review.source_name, review.published_url, review) };
  }
  try {
    const r = await env.DB.prepare(
      `SELECT period, report_date, fund_size_cents, fund_size_currency, source_url
         FROM research_fund_directory_reports WHERE fund_uid = ? ORDER BY period ASC`,
    ).bind(uid).all();
    // D7744: a report's size is shown only in the currency the report row records, like the fund's own.
    const reports = (r.results || []).map(({ fund_size_currency: c, ...x }: Record<string, unknown>) => {
      const sized = isSizeCurrency(c) && x.fund_size_cents != null;
      return { ...x, fund_size_cents: sized ? x.fund_size_cents : null, size_currency: sized ? c : null };
    });
    const profile = await fundProfile(env, row, reviews);
    return { item: { ...presentCited(row, reviews), provenance: profile.provenance, proposed: profile.proposed }, history: profile.history, reports, reports_status: 'ok' as const, moved_from: movedFrom };
  } catch {
    const profile = await fundProfile(env, row, reviews);
    return { item: { ...presentCited(row, reviews), provenance: profile.provenance, proposed: profile.proposed }, history: profile.history, reports: [], reports_status: 'unreadable' as const, reports_reason: 'Unreadable', moved_from: movedFrom };
  }
}
