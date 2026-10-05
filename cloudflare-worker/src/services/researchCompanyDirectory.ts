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
import { loadOverrides, mapCompanyCountry, mapCompanySector, type Overrides } from './researchTaxonomy';

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
  /** An exact sector label; null for no filter. */
  sector_label: string | null;
  /** `sector_label=none`: only companies with no sector label. */
  sector_none: boolean;
  /** An ISO 3166-1 alpha-2 code, matched through the crosswalk (researchTaxonomy.ts). */
  country_code: string;
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
  const label = String(get('sector_label') ?? '').trim().slice(0, 200);
  const code = String(get('country_code') ?? '').trim();
  if (code && !/^[A-Za-z]{2}$/.test(code)) throw new CompanyQueryError('country_code', 'country_code must be a two-letter ISO 3166-1 code');
  const q: CompanyQuery = {
    q: String(get('q') ?? '').trim().slice(0, 120),
    country: String(get('country') ?? '').trim().slice(0, 120),
    sectorTerms,
    sector_label: label && label.toLowerCase() !== SECTOR_NONE ? label : null,
    sector_none: label.toLowerCase() === SECTOR_NONE,
    country_code: code.toUpperCase(),
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

/** `sector_label=none` asks for the companies with no sector label. */
export const SECTOR_NONE = 'none';

/** `%`, `_` and `\` match themselves inside a LIKE … ESCAPE '\' pattern. */
export function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const LIST_COLUMNS = `uid, name, website, country, founded_year, sector, source_name,
  source_url, source_license, as_of, funding_total, funding_currency, last_funding_amount,
  last_funding_currency, last_funding_date, last_funding_type, employee_count, employee_growth_pct,
  employee_as_of`;

/** The distinct raw `country` strings the crosswalk maps to `code`. */
async function countriesMappingTo(env: Env, code: string, ov: Overrides): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT country AS v FROM research_company_directory WHERE TRIM(COALESCE(country, '')) <> ''`,
  ).all<{ v: string }>();
  return (rows.results || []).map((r) => r.v).filter((v) => mapCompanyCountry(v, ov).targets[0] === code);
}

/**
 * What the whole directory records, before any filter: how many rows carry
 * each field (`coverage`), and the filter options with their counts
 * (`facets`). The page prints these, never a number of its own.
 */
export const COVERAGE_FIELDS: Readonly<Record<string, string>> = {
  website: `TRIM(COALESCE(website, '')) <> ''`,
  country: `TRIM(COALESCE(country, '')) <> ''`,
  founded_year: 'founded_year IS NOT NULL',
  sector: `TRIM(COALESCE(sector, '')) <> ''`,
  funding: HAS.funding,
  last_round: 'last_funding_amount IS NOT NULL',
  revenue: HAS.revenue,
  headcount: HAS.headcount,
};

async function directoryShape(env: Env, ov: Overrides) {
  // Every expression is a literal of this file.
  const sums = Object.entries(COVERAGE_FIELDS).map(([k, expr]) => `SUM(CASE WHEN ${expr} THEN 1 ELSE 0 END) AS ${k}`).join(', ');
  const [cov, sectors, countries] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total, ${sums} FROM research_company_directory`).first<Record<string, number>>(),
    env.DB.prepare(
      `SELECT TRIM(sector) AS label, COUNT(*) AS n FROM research_company_directory
        WHERE TRIM(COALESCE(sector, '')) <> '' GROUP BY 1 ORDER BY n DESC, label COLLATE NOCASE`,
    ).all<{ label: string; n: number }>(),
    env.DB.prepare(
      `SELECT country, COUNT(*) AS n FROM research_company_directory
        WHERE TRIM(COALESCE(country, '')) <> '' GROUP BY 1 ORDER BY country COLLATE NOCASE`,
    ).all<{ country: string; n: number }>(),
  ]);
  const total = Number(cov?.total ?? 0);
  const coverage: Record<string, number> = {};
  for (const k of Object.keys(COVERAGE_FIELDS)) coverage[k] = Number(cov?.[k] ?? 0);
  return {
    coverage: { of: total, fields: coverage },
    facets: {
      sector_labels: (sectors.results || []).map((r) => ({ label: r.label, count: Number(r.n) })),
      sector_none: total - coverage.sector,
      countries: (countries.results || []).map((r) => ({
        country: r.country, code: mapCompanyCountry(r.country, ov).targets[0] ?? null, count: Number(r.n),
      })),
      has: { funding: coverage.funding, revenue: coverage.revenue, headcount: coverage.headcount },
    },
  };
}

export async function listCompanies(env: Env, q: CompanyQuery) {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.q) {
    const like = `%${likeLiteral(q.q.toLowerCase())}%`;
    where.push(`(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(website) LIKE ? ESCAPE '\\')`);
    binds.push(like, like);
  }
  if (q.country) { where.push('country = ?'); binds.push(q.country); }
  const ov = await loadOverrides(env);
  if (q.country_code) {
    where.push('country IN (SELECT value FROM json_each(?))');
    binds.push(JSON.stringify(await countriesMappingTo(env, q.country_code, ov)));
  }
  if (q.sector_label != null) { where.push('TRIM(sector) = ?'); binds.push(q.sector_label); }
  if (q.sector_none) where.push(`TRIM(COALESCE(sector, '')) = ''`);
  if (q.sectorTerms.length) {
    where.push(`(${q.sectorTerms.map(() => `LOWER(COALESCE(sector, '')) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    binds.push(...q.sectorTerms.map((t) => `%${likeLiteral(t.toLowerCase())}%`));
  }
  if (q.founded_from != null) { where.push('founded_year >= ?'); binds.push(q.founded_from); }
  if (q.founded_to != null) { where.push('founded_year <= ?'); binds.push(q.founded_to); }
  for (const h of q.has) where.push(HAS[h]);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // `clause` and the ORDER BY are built from literals of this file; every value is in `binds`.
  const [count, page, shape] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM research_company_directory ${clause}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(`SELECT ${LIST_COLUMNS} FROM research_company_directory ${clause} ORDER BY ${SORTS[q.sort]} LIMIT ? OFFSET ?`)
      .bind(...binds, q.limit, q.offset).all(),
    directoryShape(env, ov),
  ]);
  return {
    items: page.results || [],
    total: Number(count?.n ?? 0),
    ...shape,
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
 * The market the company's sector label maps to through the crosswalk, with
 * its name and how it was decided, and the company's ISO country code. A
 * label the crosswalk cannot place is Not recorded; a failed read, Unreadable.
 */
async function trackedSector(env: Env, row: Row) {
  try {
    const ov = await loadOverrides(env);
    const country = mapCompanyCountry(row.country, ov);
    const m = mapCompanySector(row.sector, ov);
    const slug = m.targets[0] ?? null;
    if (!slug) {
      return { status: 'not_recorded' as const, slug: null, name: null, method: null, country_code: country.targets[0] ?? null,
        reason: row.sector ? 'Not recorded: the crosswalk maps no market to this sector label' : 'Not recorded: this company has no sector label' };
    }
    const market = await env.DB.prepare(`SELECT name FROM research_market_directory WHERE slug = ?`).bind(slug).first<{ name: string }>();
    return { status: 'ok' as const, slug, name: market?.name ?? null, method: m.method, country_code: country.targets[0] ?? null };
  } catch {
    return { status: 'unreadable' as const, slug: null, name: null, method: null, country_code: null, reason: 'Unreadable' };
  }
}

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

  let peers: { status: 'ok' | 'unreadable' | 'not_recorded'; rows: unknown[]; total: number | null; reason?: string };
  const sector = typeof row.sector === 'string' ? row.sector.trim() : '';
  if (!sector) {
    peers = { status: 'not_recorded', rows: [], total: null, reason: 'Not recorded: this company has no sector, so it has no peers to match' };
  } else {
    try {
      const [r, n] = await Promise.all([
        env.DB.prepare(
          `SELECT uid, name, website, country, founded_year, sector, last_funding_amount, last_funding_currency,
                  last_funding_date, last_funding_type, employee_count, employee_growth_pct,
                  (COALESCE(country, '') = COALESCE(?, '')) AS same_country
             FROM research_company_directory
            WHERE LOWER(TRIM(sector)) = LOWER(?) AND uid <> ?
            ORDER BY same_country DESC, name COLLATE NOCASE, uid
            LIMIT ?`,
        ).bind(row.country ?? null, sector, row.uid, PEER_LIMIT).all(),
        env.DB.prepare(
          `SELECT COUNT(*) AS n FROM research_company_directory WHERE LOWER(TRIM(sector)) = LOWER(?) AND uid <> ?`,
        ).bind(sector, row.uid).first<{ n: number }>(),
      ]);
      peers = { status: 'ok', rows: r.results || [], total: Number(n?.n ?? 0) };
    } catch {
      peers = { status: 'unreadable', rows: [], total: null, reason: 'Unreadable' };
    }
  }

  const item: Row = {};
  for (const k of ['uid', 'name', 'website', 'country', 'founded_year', 'sector', 'source_name', 'source_url', 'source_license', 'as_of',
    'competitor_status', 'diligence_status']) item[k] = row[k] ?? null;
  return {
    item,
    tracked_sector: await trackedSector(env, row),
    metrics: presentMetrics(row),
    financials, employment, sources, funding_rounds: fundingRounds,
    peers,
    evidence_key: 'company_id = research_company_directory.id',
  };
}
