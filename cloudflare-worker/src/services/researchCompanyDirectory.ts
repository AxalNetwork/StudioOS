/**
 * D534 (#1079), the Worker half — the company directory searched, filtered,
 * sorted and paged on the server, and one company with its evidence and peers.
 *
 * `GET /api/research/company-directory` took `q`, `country` and `sector` and
 * returned up to 1,000 rows with no total, for the browser to page. This
 * module turns the query string into one bound SQL query with a `total`.
 *
 * FILTERS (every request value is bound, never interpolated):
 *   q              name or website, a case-insensitive substring; `%`, `_`
 *                  and `\` match themselves (LIKE … ESCAPE '\').
 *   country        exact, as before.
 *   sector         the route's alias terms (MARKET_SECTOR_ALIASES), as before,
 *                  so MarketSectorProfile's call keeps working.
 *   founded_from/to  `founded_year`, inclusive.
 *   has            funding | revenue | headcount, comma-separated: the metric
 *                  is recorded (`funding_total`, `revenue`, `employee_count`).
 * SORT  name (default), founded or funding; `-` for descending. A company
 *       without the value sorts after every company with it, either way.
 *       Funding is compared only within one currency, never across: the rows
 *       are ordered by currency first. On 4 October every recorded
 *       `funding_total` is USD (16 rows), so this changes nothing today and
 *       keeps a second currency from being ranked against the first.
 * PAGE  `limit` 25 by default, 100 at most; `offset`; `total` counts every match.
 *
 * THE COMPANY KEY. `company_financials`, `company_employment_history`,
 * `company_sources` and `company_funding_rounds` (migration 370) carry an
 * INTEGER `company_id` and no foreign key. It is `research_company_directory.id`:
 * on production every row matches one (19 of 19, 40 of 40, 300 of 300, and the
 * funding-rounds table is empty), counted on 4 October without reading a row.
 */
import type { Env } from '../types';

/** A bad query value. `reason` is a sentence this file wrote, safe for a refusal body (D278). */
export class CompanyQueryError extends Error {
  field: string;
  reason: string;
  constructor(field: string, reason: string) { super(reason); this.field = field; this.reason = reason; }
}

const NULLS_LAST = (col: string, dir: 'ASC' | 'DESC') => `${col} IS NULL, ${col} ${dir}`;

export const SORTS: Readonly<Record<string, string>> = {
  'name': 'name COLLATE NOCASE ASC, uid ASC',
  '-name': 'name COLLATE NOCASE DESC, uid ASC',
  'founded': `${NULLS_LAST('founded_year', 'ASC')}, name COLLATE NOCASE, uid`,
  '-founded': `${NULLS_LAST('founded_year', 'DESC')}, name COLLATE NOCASE, uid`,
  'funding': `funding_total IS NULL, funding_currency, funding_total ASC, name COLLATE NOCASE, uid`,
  '-funding': `funding_total IS NULL, funding_currency, funding_total DESC, name COLLATE NOCASE, uid`,
};

/** The metric each `has=` value requires to be recorded. Column names are literals of this file. */
export const HAS: Readonly<Record<string, string>> = {
  funding: 'funding_total IS NOT NULL',
  revenue: 'revenue IS NOT NULL',
  headcount: 'employee_count IS NOT NULL',
};

export interface CompanyQuery {
  q: string;
  country: string;
  sectorTerms: string[];
  founded_from: number | null;
  founded_to: number | null;
  has: string[];
  sort: string;
  limit: number;
  offset: number;
}

function int(field: string, raw: string | undefined, min: number, max: number): number | null {
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw)) throw new CompanyQueryError(field, `${field} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new CompanyQueryError(field, `${field} must be between ${min} and ${max}`);
  return n;
}

/**
 * Read and validate the query string; a bad value is a 400, never a silent
 * default. `sectorTerms` comes from the route, which owns the alias map.
 */
export function parseCompanyQuery(get: (k: string) => string | undefined, sectorTerms: string[] = []): CompanyQuery {
  const sort = (get('sort') ?? 'name').trim() || 'name';
  if (!Object.hasOwn(SORTS, sort)) throw new CompanyQueryError('sort', `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const has = (get('has') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const h of has) {
    if (!Object.hasOwn(HAS, h)) throw new CompanyQueryError('has', `has must be one or more of ${Object.keys(HAS).join(', ')}`);
  }
  const q: CompanyQuery = {
    q: String(get('q') ?? '').trim().slice(0, 120),
    country: String(get('country') ?? '').trim().slice(0, 120),
    sectorTerms,
    founded_from: int('founded_from', get('founded_from'), 1000, 2100),
    founded_to: int('founded_to', get('founded_to'), 1000, 2100),
    has: [...new Set(has)],
    sort,
    limit: int('limit', get('limit'), 1, 100) ?? 25,
    offset: int('offset', get('offset'), 0, 1_000_000) ?? 0,
  };
  if (q.founded_from != null && q.founded_to != null && q.founded_from > q.founded_to) {
    throw new CompanyQueryError('founded_from', 'founded_from is after founded_to');
  }
  return q;
}

/** `%`, `_` and `\` match themselves inside a LIKE … ESCAPE '\' pattern. */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const LIST_COLUMNS = `uid, name, website, country, founded_year, sector, source_name,
  source_url, source_license, as_of`;

export async function listCompanies(env: Env, q: CompanyQuery) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.q) {
    const like = `%${likeLiteral(q.q.toLowerCase())}%`;
    where.push(`(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(website) LIKE ? ESCAPE '\\')`);
    binds.push(like, like);
  }
  if (q.country) { where.push('country = ?'); binds.push(q.country); }
  if (q.sectorTerms.length) {
    where.push(`(${q.sectorTerms.map(() => `LOWER(COALESCE(sector, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    binds.push(...q.sectorTerms.map((t) => `%${likeLiteral(t.toLowerCase())}%`));
  }
  if (q.founded_from != null) { where.push('founded_year >= ?'); binds.push(q.founded_from); }
  if (q.founded_to != null) { where.push('founded_year <= ?'); binds.push(q.founded_to); }
  for (const h of q.has) where.push(HAS[h]);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // `clause` and the ORDER BY are built from literals of this file; every value is in `binds`.
  const [count, page] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM research_company_directory ${clause}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${LIST_COLUMNS} FROM research_company_directory ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .bind(...binds, q.limit, q.offset).all(),
  ]);
  return {
    items: page.results || [],
    total: Number(count?.n ?? 0),
    limit: q.limit,
    offset: q.offset,
    sort: q.sort,
    funding_basis: 'Funding is compared only within one currency; companies with no recorded funding sort last.',
  };
}

type Row = Record<string, any>;

/** A metric with its source and as-of date, or `Not recorded` — never a zero. */
function metric(value: unknown, extra: Row, source: Row, asOf: unknown) {
  if (value == null) return { value: null, status: 'not_recorded' as const, reason: 'Not recorded' };
  return { value, ...extra, source_name: source.name ?? null, source_url: source.url ?? null, as_of: asOf ?? source.updated ?? null, status: 'recorded' as const };
}

export function presentMetrics(r: Row) {
  const source = { name: r.metrics_source_name, url: r.metrics_source_url, updated: r.metrics_updated_at };
  return {
    funding_total: metric(r.funding_total, { currency: r.funding_currency ?? null }, source, r.metrics_updated_at),
    last_funding: metric(r.last_funding_amount, {
      currency: r.last_funding_currency ?? null, date: r.last_funding_date ?? null, type: r.last_funding_type ?? null,
    }, source, r.last_funding_date),
    valuation: metric(r.valuation, { currency: r.valuation_currency ?? null }, source, r.valuation_as_of),
    revenue: metric(r.revenue, { currency: r.revenue_currency ?? null }, source, r.revenue_as_of),
    headcount: metric(r.employee_count, { growth_pct: r.employee_growth_pct ?? null }, source, r.employee_as_of),
    market_share_pct: metric(r.market_share_pct, {}, source, r.market_share_as_of),
    confidence: r.metrics_confidence ?? null,
  };
}

/**
 * Read one evidence table for a company. A failed read is reported as
 * unreadable on its own, never passed off as a company with no rows.
 */
async function evidence(env: Env, sql: string, id: number) {
  try {
    const r = await env.DB.prepare(sql).bind(id).all();
    return { status: 'ok' as const, rows: r.results || [] };
  } catch {
    return { status: 'unreadable' as const, rows: [], reason: 'Unreadable' };
  }
}

export const PEER_LIMIT = 8;

/**
 * One company: identity, each metric with its source and as-of date, the
 * migration-370 evidence matched on `company_id = id`, and peers — other
 * companies in the same sector, same country first, then by name, capped.
 */
export async function getCompany(env: Env, uid: string) {
  const row = await env.DB.prepare(`SELECT * FROM research_company_directory WHERE uid = ?`).bind(uid).first<Row>();
  if (!row) return null;
  const [financials, employment, sources, fundingRounds] = await Promise.all([
    evidence(env, `SELECT period, period_type, metric_type, revenue, revenue_currency, revenue_growth, arr, mrr,
        gross_profit, gross_margin, ebitda, ebitda_margin, net_income, cash, debt, burn_rate, runway, employees,
        source_name, source_url, verified_at, confidence
      FROM company_financials WHERE company_id = ? ORDER BY period DESC, financial_id`, row.id),
    evidence(env, `SELECT observed_date, employee_count, source, source_url, verified_at, confidence
      FROM company_employment_history WHERE company_id = ? ORDER BY observed_date DESC, employment_id`, row.id),
    evidence(env, `SELECT field_name, source_name, source_type, source_url, publication_date, retrieved_at, verified_at, confidence
      FROM company_sources WHERE company_id = ? ORDER BY field_name, source_id`, row.id),
    evidence(env, `SELECT round_type, stage, announcement_date, closing_date, amount, currency, pre_money_valuation,
        post_money_valuation, valuation_currency, lead_investor, investors, source_name, source_url, verified_at, confidence
      FROM company_funding_rounds WHERE company_id = ? ORDER BY announcement_date DESC, funding_round_id`, row.id),
  ]);

  let peers: { status: 'ok' | 'unreadable' | 'not_recorded'; rows: unknown[]; reason?: string };
  const sector = typeof row.sector === 'string' ? row.sector.trim() : '';
  if (!sector) {
    peers = { status: 'not_recorded', rows: [], reason: 'Not recorded: this company has no sector, so it has no peers to match' };
  } else {
    try {
      const r = await env.DB.prepare(
        `SELECT uid, name, website, country, founded_year, sector
           FROM research_company_directory
          WHERE LOWER(TRIM(sector)) = LOWER(?) AND uid <> ?
          ORDER BY (COALESCE(country, '') = COALESCE(?, '')) DESC, name COLLATE NOCASE, uid
          LIMIT ?`,
      ).bind(sector, row.uid, row.country ?? null, PEER_LIMIT).all();
      peers = { status: 'ok', rows: r.results || [] };
    } catch {
      peers = { status: 'unreadable', rows: [], reason: 'Unreadable' };
    }
  }

  const item: Row = {};
  for (const k of ['uid', 'name', 'website', 'country', 'founded_year', 'sector', 'source_name', 'source_url', 'source_license', 'as_of']) item[k] = row[k] ?? null;
  return {
    item,
    metrics: presentMetrics(row),
    financials, employment, sources, funding_rounds: fundingRounds,
    peers,
    evidence_key: 'company_id = research_company_directory.id',
  };
}
