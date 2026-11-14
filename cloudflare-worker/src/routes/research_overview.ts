/**
 * D536 (#1082) — the Research overview: `GET /api/research/overview`.
 *
 * `/research` is a research overview. A founder should be able to read from it
 * the size of the directories, demand against supply, the competition and
 * where the money is. This route gathers those figures in one read, from the
 * stores that record them:
 *
 *   totals       research_company_directory, research_market_directory,
 *                research_fund_directory — each count with its as-of date;
 *                the supplied-company sum, the fund lists, the twelve
 *                indexed sectors with each one's last computed_at, and the
 *                private / public / government split (government is not
 *                recorded anywhere);
 *   heat         market_intel_indexes, live rows only (D538), the current
 *                month (month to date) and its change on the last month;
 *                computed on the read when live observations exist but the
 *                month's index does not yet (as sector-compass does);
 *   demand_vs_supply  the sectors whose live demand rises faster than supply;
 *   competition  companies per sector label and per country (top N), the
 *                remainders, and the companies with no label or no country;
 *   money        funds per HQ country and per focus market through the D533
 *                crosswalk (top N), euro size bands, every vintage, and the
 *                count missing each of those;
 *   signals      the latest active signals (hand-written theses today), with
 *                why now, the build opportunity, region and confidence.
 *
 * HONESTY. Each section reads on its own and reports its own failure as
 * "unreadable", so one broken table never blanks the page. A count of zero is
 * not a figure: an empty store reads "not recorded" with the reason. No stub
 * row from market intelligence is read (`liveIndexSql`). `signals.advisor_note`
 * is never selected: it breaks the voice rule.
 *
 * Signed-in only; nothing under /research is public. Every value bound from
 * the request is bound; the route takes none today beyond `top`, clamped.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { readListedTotals } from '../services/listedCompanies';
import { requireAuth } from '../auth';
import { SECTORS, recomputeIndexes } from '../services/market_intel/aggregator';
import { liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { periodKey, WINDOW_DAYS } from '../services/market_intel/scoring';
import { listCountries, loadOverrides, mapFundFocus, mapFundHq, type Mapping } from '../services/researchTaxonomy';
import { EUR_SOURCE, SERVED_FUNDS } from '../services/researchFundDirectory';

const researchOverview = new Hono<{ Bindings: Env }>();

export const DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;
export const UNREADABLE = 'Unreadable';
export const NOT_RECORDED = 'Not recorded';

/**
 * One section's answer: `status: 'ok'` with its data, or `'not_recorded'` /
 * `'unreadable'` with the reason there is none.
 */
export type Section = { status: 'ok' | 'not_recorded' | 'unreadable'; reason?: string; [k: string]: unknown };

/** Run a section's read; a thrown error is "unreadable", never a zero. */
export async function section(read: () => Promise<Section>): Promise<Section> {
  try {
    return await read();
  } catch {
    return { status: 'unreadable', reason: UNREADABLE };
  }
}

/** A count with its as-of date, or "not recorded" with the reason when the store is empty. */
export interface Total { value: number | null; as_of: string | null; source: string; reason?: string }

function total(n: number | null | undefined, asOf: string | null | undefined, source: string, emptyReason: string): Total {
  const v = Number(n ?? 0);
  return v > 0
    ? { value: v, as_of: asOf ?? null, source }
    : { value: null, as_of: null, source, reason: emptyReason };
}

/**
 * Fund size bands, on `fund_size_cents` in euro cents. Only the rows whose
 * currency is known are banded — the EuroTech list (`EUR_SOURCE`, D535); the
 * other list records no size in a known currency, and sizes in different
 * currencies are never banded or summed together.
 */
export const SIZE_BANDS: Array<{ band: string; min: number; max: number | null }> = [
  { band: 'under €25M', min: 0, max: 25_000_000_00 },
  { band: '€25M–100M', min: 25_000_000_00, max: 100_000_000_00 },
  { band: '€100M–250M', min: 100_000_000_00, max: 250_000_000_00 },
  { band: '€250M–1B', min: 250_000_000_00, max: 1_000_000_000_00 },
  { band: '€1B and over', min: 1_000_000_000_00, max: null },
];

const COMPANY_SOURCE = 'Wikidata (CC0), research_company_directory';
const MARKET_SOURCE = 'Axal market directory, research_market_directory';
const FUND_SOURCE = 'Public fund lists (spreadsheets), research_fund_directory';

/**
 * D5318 H7 (#5318): each directory is read ONCE per request, and the totals
 * and the section that draw on it share that read. Before, the fund directory
 * was read seven times (two totals, five money aggregates), each repeating
 * `SERVED_FUNDS`' `NOT EXISTS` over `research_fund_sources`; the company
 * directory four times. Now one statement each: the fund one dedupes once,
 * into a materialised CTE, and every aggregate reads that. Rows are tagged by
 * `k` and ranked by `rk`, so the order is the SQL's, not a re-sort here. A
 * failed read fails each line that draws on it, as before: never a zero.
 */
export interface DirRow { k: string; rk: number | null; v: string | number | null; n: number; as_of: string | null }

export interface CompanyAggregates {
  total: number; as_of: string | null;
  /** Distinct raw `country` (the totals line); `countries` is distinct TRIM(country) (competition). */
  countries_raw: number; countries: number; labels: number; labelled: number; located: number;
  by_sector: Array<{ label: string; companies: number }>;
  by_country: Array<{ country: string; companies: number }>;
}

/** The company directory's totals and its top `top` sector labels and countries, in one statement. */
export async function readCompanyAggregates(env: Env, top: number): Promise<CompanyAggregates> {
  const rows = (await env.DB.prepare(
    `SELECT k, rk, v, n, as_of, countries_raw, labels, labelled, located, countries FROM (
       SELECT 'all' AS k, 0 AS rk, NULL AS v, COUNT(*) AS n, MAX(as_of) AS as_of,
              COUNT(DISTINCT CASE WHEN TRIM(COALESCE(country, '')) <> '' THEN country END) AS countries_raw,
              COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sector, '')) <> '' THEN LOWER(TRIM(sector)) END) AS labels,
              SUM(CASE WHEN TRIM(COALESCE(sector, '')) <> '' THEN 1 ELSE 0 END) AS labelled,
              SUM(CASE WHEN TRIM(COALESCE(country, '')) <> '' THEN 1 ELSE 0 END) AS located,
              COUNT(DISTINCT CASE WHEN TRIM(COALESCE(country, '')) <> '' THEN TRIM(country) END) AS countries
         FROM research_company_directory
       UNION ALL
       SELECT 'sector', ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, TRIM(sector) COLLATE NOCASE), TRIM(sector), COUNT(*),
              NULL, NULL, NULL, NULL, NULL, NULL
         FROM research_company_directory WHERE TRIM(COALESCE(sector, '')) <> '' GROUP BY LOWER(TRIM(sector))
       UNION ALL
       SELECT 'country', ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, TRIM(country) COLLATE NOCASE), TRIM(country), COUNT(*),
              NULL, NULL, NULL, NULL, NULL, NULL
         FROM research_company_directory WHERE TRIM(COALESCE(country, '')) <> '' GROUP BY TRIM(country)
     ) WHERE rk <= ? ORDER BY k, rk`
  ).bind(top).all<DirRow & { countries_raw: number | null; labels: number | null; labelled: number | null; located: number | null; countries: number | null }>()).results || [];
  const all = rows.find((r) => r.k === 'all');
  return {
    total: Number(all?.n ?? 0), as_of: all?.as_of ?? null,
    countries_raw: Number(all?.countries_raw ?? 0), countries: Number(all?.countries ?? 0),
    labels: Number(all?.labels ?? 0), labelled: Number(all?.labelled ?? 0), located: Number(all?.located ?? 0),
    by_sector: rows.filter((r) => r.k === 'sector').map((r) => ({ label: String(r.v), companies: Number(r.n) })),
    by_country: rows.filter((r) => r.k === 'country').map((r) => ({ country: String(r.v), companies: Number(r.n) })),
  };
}

export interface FundAggregates {
  total: number; as_of: string | null;
  lists: Array<{ name: string; funds: number; as_of: string | null }>;
  hq: RawCount[]; focus: RawCount[];
  vintages: Array<{ year: number; funds: number }>;
  /** Funds per SIZE_BANDS index, euro list only; a band with no fund is absent. */
  bands: Map<number, number>;
}

/**
 * Every fund aggregate the overview shows, in one statement over the served
 * funds, deduped once. The euro filter (`EUR_SOURCE`, bound) is applied once,
 * as `eur_cents`. The funds missing an HQ, a focus, a size or a vintage are
 * what the grouped rows leave out: those rows count non-blank values only.
 */
export async function readFundAggregates(env: Env): Promise<FundAggregates> {
  // The band edges are constants of this file, never request values.
  const bandSql = `CASE ${SIZE_BANDS.map((b, i) => (b.max != null ? `WHEN eur_cents < ${b.max} THEN ${i}` : `ELSE ${i}`)).join(' ')} END`;
  const rows = (await env.DB.prepare(
    `WITH sf AS MATERIALIZED (
       SELECT source_name, hq, sector_focus, fund_year, as_of,
              CASE WHEN source_name = ? AND fund_size_cents > 0 THEN fund_size_cents END AS eur_cents
         FROM ${SERVED_FUNDS} AS f)
     SELECT k, rk, v, n, as_of FROM (
       SELECT 'all' AS k, 0 AS rk, NULL AS v, COUNT(*) AS n, MAX(as_of) AS as_of FROM sf
       UNION ALL
       SELECT 'list', ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, source_name), source_name, COUNT(*), MAX(as_of)
         FROM sf GROUP BY source_name
       UNION ALL
       SELECT 'hq', 0, hq, COUNT(*), NULL FROM sf WHERE TRIM(COALESCE(hq, '')) <> '' GROUP BY hq
       UNION ALL
       SELECT 'focus', 0, sector_focus, COUNT(*), NULL FROM sf WHERE TRIM(COALESCE(sector_focus, '')) <> '' GROUP BY sector_focus
       UNION ALL
       SELECT 'vintage', fund_year, fund_year, COUNT(*), NULL FROM sf WHERE fund_year IS NOT NULL GROUP BY fund_year
       UNION ALL
       SELECT 'band', b, b, COUNT(*), NULL FROM (SELECT ${bandSql} AS b FROM sf WHERE eur_cents IS NOT NULL) GROUP BY b
     ) ORDER BY k, rk`
  ).bind(EUR_SOURCE).all<DirRow>()).results || [];
  const of = (k: string) => rows.filter((r) => r.k === k);
  const all = of('all')[0];
  return {
    total: Number(all?.n ?? 0), as_of: all?.as_of ?? null,
    lists: of('list').map((r) => ({ name: String(r.v), funds: Number(r.n), as_of: r.as_of ?? null })),
    hq: of('hq').map((r) => ({ v: String(r.v), n: Number(r.n) })),
    focus: of('focus').map((r) => ({ v: String(r.v), n: Number(r.n) })),
    vintages: of('vintage').map((r) => ({ year: Number(r.v), funds: Number(r.n) })),
    bands: new Map(of('band').map((r) => [Number(r.v), Number(r.n)] as const)),
  };
}

/** One total's read; a failure is "Unreadable" on its own line, never a zero. */
async function readTotal<R>(read: () => Promise<R | null>): Promise<R | 'unreadable'> {
  try {
    return (await read()) as R;
  } catch {
    return 'unreadable';
  }
}

function unreadable(source: string): Total {
  return { value: null, as_of: null, source, reason: UNREADABLE };
}

/** Why the government count is empty: no store records ownership type (#1083 Q3 decides only the wording). */
export const GOVERNMENT_REASON = 'No source lists government-owned companies yet; no store holds ownership type';
/**
 * #1077 (D536): the Public count is the Public tab's, read through the same
 * statement (`readListedTotals`): the signal companies plus SEC EDGAR's rows,
 * one row per source.
 */
const PUBLIC_SOURCE = 'signal_companies + research_public_companies (SEC EDGAR): the listed companies, one row per source';
const SECTORS_SOURCE = 'market_intel_indexes: the market-intelligence sectors, live rows only';

/**
 * The twelve market-intelligence sectors, each with the last time a live
 * index row was computed for it. A sector no live source has reached carries
 * `last_computed_at: null` and the reason; a failed read says "Unreadable" on
 * every sector, never a date it did not read.
 */
async function readSectorsTracked(env: Env) {
  const rows = await readTotal(async () => (await env.DB.prepare(
    `SELECT sector, MAX(computed_at) AS computed_at FROM market_intel_indexes
      WHERE ${liveIndexSql()} GROUP BY sector`
  ).all<{ sector: string; computed_at: string | null }>()).results || []);
  if (rows === 'unreadable') {
    return {
      value: SECTORS.length, as_of: null, source: SECTORS_SOURCE, reason: UNREADABLE,
      sectors: SECTORS.map((sector) => ({ sector, last_computed_at: null, reason: UNREADABLE })),
    };
  }
  const by = new Map(rows.map((r) => [r.sector, r.computed_at] as const));
  const sectors = SECTORS.map((sector) => {
    const at = by.get(sector) ?? null;
    return at ? { sector, last_computed_at: at } : { sector, last_computed_at: null, reason: NO_LIVE_SOURCE_REASON };
  });
  const dates = sectors.map((s) => s.last_computed_at).filter((d): d is string => !!d).sort();
  return { value: SECTORS.length, as_of: dates.length ? dates[dates.length - 1] : null, source: SECTORS_SOURCE, sectors };
}

async function readTotals(env: Env, companiesRead: Promise<CompanyAggregates>, fundsRead: Promise<FundAggregates>) {
  return section(async () => {
    const [co, m, fu, pub, tracked] = await Promise.all([
      readTotal(() => companiesRead),
      readTotal(() => env.DB.prepare(
        `SELECT COUNT(*) AS n, MAX(as_of) AS as_of, SUM(company_count) AS supplied FROM research_market_directory`
      ).first<{ n: number; as_of: string | null; supplied: number | null }>()),
      readTotal(() => fundsRead),
      readTotal(() => readListedTotals(env)),
      readSectorsTracked(env),
    ]);
    const c = co === 'unreadable' ? co : { n: co.total, as_of: co.as_of, countries: co.countries_raw, sectors: co.labels };
    const f = fu === 'unreadable' ? fu : { n: fu.total, as_of: fu.as_of };
    const lists = fu === 'unreadable' ? fu : fu.lists;
    const countriesSource = `${COMPANY_SOURCE}: distinct countries`;
    const sectorsSource = `${COMPANY_SOURCE}: distinct raw sector labels`;
    const suppliedSource = `${MARKET_SOURCE}: SUM(company_count), supplied by Axal and not verified`;
    const listsSource = `${FUND_SOURCE}: distinct source lists`;
    const listsAsOf = lists === 'unreadable' ? null
      : (lists ?? []).map((x) => x.as_of).filter((d): d is string => !!d).sort().pop() ?? null;
    const companies = c === 'unreadable' ? unreadable(COMPANY_SOURCE)
      : total(c?.n, c?.as_of, COMPANY_SOURCE, 'The company directory holds no company yet');
    return {
      status: 'ok' as const,
      companies,
      markets: m === 'unreadable' ? unreadable(MARKET_SOURCE) : total(m?.n, m?.as_of, MARKET_SOURCE, 'The market directory holds no market yet'),
      // What the market directory says its markets hold: supplied taxonomy
      // counts, not the company directory's own rows.
      supplied_companies: m === 'unreadable' ? unreadable(suppliedSource)
        : total(m?.supplied, m?.as_of, suppliedSource, 'The market directory supplies no company count yet'),
      funds: f === 'unreadable' ? unreadable(FUND_SOURCE) : total(f?.n, f?.as_of, FUND_SOURCE, 'The fund directory holds no fund yet'),
      fund_sources: lists === 'unreadable' ? { ...unreadable(listsSource), names: [] } : {
        ...total(lists?.length, listsAsOf, listsSource, 'The fund directory holds no fund yet'),
        names: (lists ?? []).map((x) => ({ name: x.name, funds: Number(x.funds) })),
      },
      countries: c === 'unreadable' ? unreadable(countriesSource) : total(c?.countries, c?.as_of, countriesSource, 'No company in the directory records a country'),
      // Distinct raw labels in the company directory. The overview's "sectors
      // tracked" is `sectors_tracked`: the twelve indexed sectors.
      sectors: c === 'unreadable' ? unreadable(sectorsSource) : total(c?.sectors, c?.as_of, sectorsSource, 'No company in the directory records a sector'),
      sectors_tracked: tracked,
      // No source records ownership per company, so each count follows the
      // list the record came from. Government has no list at all.
      market_split: {
        value: null,
        reason: 'No source records ownership for each company, so each count follows the list the record came from',
        private: {
          ...companies,
          note: 'Company directory records not known to be listed. Listing status is not recorded per company, so a few may trade on an exchange.',
        },
        public: pub === 'unreadable' ? unreadable(PUBLIC_SOURCE) : {
          ...total(pub?.total, pub?.as_of, PUBLIC_SOURCE, 'No listed company is recorded yet'),
          ...(pub && pub.total > 0 ? {
            note: `${pub.signal.n} signal companies with their bands, and ${pub.edgar.n} from SEC EDGAR with ticker and exchange only`
              + (pub.edgar.overlap ? `; ${pub.edgar.overlap} tickers appear in both, once per source.` : '.'),
          } : {}),
        },
        government: { value: null, as_of: null, source: null, reason: GOVERNMENT_REASON },
      },
    };
  });
}

interface IndexRow { sector: string; dimension: string; value: number; delta_pct: number | null; source_count: number }

/**
 * Live observations exist but this month's index has not been computed from
 * them: the first hours of a month before the 04:00 recompute, or after a
 * missed cron, when computing it on the read failed too.
 */
export const INDEX_PENDING_REASON =
  "Live observations are recorded, but this month's index has not been computed yet";

interface LiveIndexes { rows: IndexRow[]; pending: boolean }

/**
 * This month's live index rows. When there are none but live observations
 * exist inside the scoring window, the index is computed on the read and read
 * again — the same cold-start path `/market-intel/sector-compass` takes — so
 * a month whose recompute has not run yet never reads as "no live source".
 * If the compute fails or still yields nothing, the answer says the index is
 * pending (`pending: true`), not that no source reported.
 */
async function readLiveIndexes(env: Env): Promise<LiveIndexes> {
  const read = async () => (await env.DB.prepare(
    `SELECT sector, dimension, value, delta_pct, source_count
       FROM market_intel_indexes WHERE geo = 'global' AND period_key = ? AND ${liveIndexSql()}`
  ).bind(periodKey()).all<IndexRow>()).results || [];
  const rows = await read();
  if (rows.length > 0) return { rows, pending: false };
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const observed = await env.DB.prepare(
    `SELECT 1 AS one FROM market_intel_rows WHERE ts >= ? AND ${liveRowSql()} LIMIT 1`
  ).bind(cutoff).first<{ one: number }>();
  if (!observed) return { rows, pending: false };
  try {
    await recomputeIndexes(env);
    const again = await read();
    return { rows: again, pending: again.length === 0 };
  } catch {
    return { rows: [], pending: true };
  }
}

/** Why there is no live index row this month. */
function noIndexReason(r: LiveIndexes): string {
  return r.pending ? INDEX_PENDING_REASON : NO_LIVE_SOURCE_REASON;
}

type Cell = { value: number | null; delta_pct: number | null; source_count: number; reason?: string };

function heatGrid(rows: IndexRow[]) {
  const by = new Map(rows.map((r) => [`${r.sector}|${r.dimension}`, r] as const));
  return SECTORS.map((sector) => ({
    sector,
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => {
      const r = by.get(`${sector}|${d}`);
      const cell: Cell = r
        ? { value: r.value, delta_pct: r.delta_pct ?? null, source_count: r.source_count }
        : { value: null, delta_pct: null, source_count: 0, reason: NO_LIVE_SOURCE_REASON };
      return [d, cell];
    })),
  }));
}

/**
 * Demand rising faster than supply: both dimensions recorded live this month,
 * both with a change on last month, and demand's change the larger. Without
 * live data for a pair the sector is left out, never ranked on a guess.
 */
export function demandOverSupply(rows: IndexRow[]) {
  const by = new Map(rows.map((r) => [`${r.sector}|${r.dimension}`, r] as const));
  const out: Array<{ sector: string; demand: number; supply: number; demand_delta_pct: number; supply_delta_pct: number; gap_pct: number }> = [];
  for (const sector of SECTORS) {
    const d = by.get(`${sector}|demand`);
    const s = by.get(`${sector}|supply`);
    if (!d || !s || d.delta_pct == null || s.delta_pct == null) continue;
    if (d.delta_pct <= s.delta_pct) continue;
    out.push({
      sector, demand: d.value, supply: s.value,
      demand_delta_pct: d.delta_pct, supply_delta_pct: s.delta_pct,
      gap_pct: Math.round((d.delta_pct - s.delta_pct) * 10) / 10,
    });
  }
  return out.sort((a, b) => b.gap_pct - a.gap_pct);
}

async function readHeat(env: Env, indexes: Promise<LiveIndexes>) {
  return section(async () => {
    const live = await indexes;
    const r = live.rows;
    if (r.length === 0) return { status: 'not_recorded' as const, reason: noIndexReason(live) };
    return { status: 'ok' as const, period_key: periodKey(), period_status: 'month_to_date', sectors: heatGrid(r) };
  });
}

async function readDemandVsSupply(env: Env, indexes: Promise<LiveIndexes>) {
  return section(async () => {
    const live = await indexes;
    const r = live.rows;
    if (r.length === 0) return { status: 'not_recorded' as const, reason: noIndexReason(live) };
    const sectors = demandOverSupply(r);
    if (sectors.length === 0) {
      return { status: 'not_recorded' as const, reason: 'No sector has a live demand and supply change on last month yet' };
    }
    return { status: 'ok' as const, period_key: periodKey(), sectors };
  });
}

async function readCompetition(companiesRead: Promise<CompanyAggregates>) {
  return section(async () => {
    const stats = await companiesRead;
    const sectors = stats.by_sector;
    const countries = stats.by_country;
    if (sectors.length === 0 && countries.length === 0) {
      return { status: 'not_recorded' as const, reason: 'No company in the directory records a sector or a country' };
    }
    const all = stats.total;
    const labelled = stats.labelled;
    const located = stats.located;
    const sum = (rows: Array<{ companies: number }>) => rows.reduce((n, r) => n + Number(r.companies), 0);
    return {
      status: 'ok' as const, source: COMPANY_SOURCE, as_of: stats?.as_of ?? null,
      // Wikidata's own industry words, as the canvas draws them; the twelve
      // index sectors are `totals.sectors_tracked`.
      sector_basis: 'raw directory sector labels',
      total_companies: all,
      by_sector: sectors,
      // Every company is in exactly one of: a top label, `other_sectors`, `no_sector`.
      other_sectors: { labels: Math.max(0, Number(stats?.labels ?? 0) - sectors.length), companies: labelled - sum(sectors) },
      no_sector: all - labelled,
      by_country: countries,
      other_countries: { countries: Math.max(0, Number(stats?.countries ?? 0) - countries.length), companies: located - sum(countries) },
      no_country: all - located,
    };
  });
}

/** One distinct raw value of a directory column and how many funds carry it. */
export interface RawCount { v: string; n: number }

/**
 * Funds per crosswalk target (a country code, a market slug), largest first.
 *
 * A fund whose HQ names two countries, or whose focus names two markets, is
 * counted under each, so the ranked counts can add up to more than the funds;
 * `other` and `unmapped` count each fund once. Every fund with a value is in
 * exactly one of: a ranked target, `other` (mapped, but only to targets outside
 * the top), `unmapped` (text the crosswalk places nowhere).
 */
export function crosswalkCounts(rows: RawCount[], map: (raw: string) => Mapping, top: number) {
  const per = new Map<string, number>();
  const mapped: Array<{ targets: string[]; n: number }> = [];
  let unmapped = 0;
  let unmappedValues = 0;
  for (const r of rows) {
    const n = Number(r.n);
    const targets = map(r.v).targets;
    if (targets.length === 0) { unmapped += n; unmappedValues += 1; continue; }
    mapped.push({ targets, n });
    for (const t of targets) per.set(t, (per.get(t) ?? 0) + n);
  }
  const ranked = [...per.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, funds]) => ({ key, funds }));
  const shown = ranked.slice(0, top);
  const inTop = new Set(shown.map((x) => x.key));
  const otherFunds = mapped.filter((m) => !m.targets.some((t) => inTop.has(t))).reduce((s, m) => s + m.n, 0);
  return {
    ranked: shown,
    other: { targets: ranked.length - shown.length, funds: otherFunds },
    unmapped: { values: unmappedValues, funds: unmapped },
  };
}

async function readMoney(env: Env, top: number, fundsRead: Promise<FundAggregates>) {
  return section(async () => {
    const thisYear = new Date().getUTCFullYear();
    const [funds, overrides, countries, markets] = await Promise.all([
      fundsRead,
      loadOverrides(env),
      listCountries(env),
      env.DB.prepare(`SELECT slug, name FROM research_market_directory`).all<{ slug: string; name: string }>(),
    ]);
    const all = funds.total;
    if (all === 0) return { status: 'not_recorded' as const, reason: 'The fund directory holds no fund yet' };
    const countryName = new Map(countries.map((c) => [c.code, c.name] as const));
    const marketName = new Map((markets.results || []).map((m) => [m.slug, m.name] as const));
    const hq = crosswalkCounts(funds.hq, (v) => mapFundHq(v, overrides), top);
    const focus = crosswalkCounts(funds.focus, (v) => mapFundFocus(v, overrides), top);
    // Only sizes whose currency is known are banded: the euro list (EUR_SOURCE).
    const sizeBands = SIZE_BANDS
      .map((b, i) => ({ band: b.band, funds: funds.bands.get(i) ?? 0 }))
      .filter((b) => b.funds > 0);
    const years = funds.vintages;
    const recent = years.filter((v) => v.year >= thisYear - 4 && v.year <= thisYear).reverse();
    const counted = (rows: Array<{ n: number }>) => rows.reduce((s, r) => s + r.n, 0);
    const sized = [...funds.bands.values()].reduce((s, n) => s + n, 0);
    return {
      status: 'ok' as const, source: FUND_SOURCE, as_of: funds.as_of,
      total_funds: all,
      hq_basis: 'HQ text matched to countries through the Research crosswalk (D533); a fund whose HQ names two countries counts in each',
      by_hq: hq.ranked.map((x) => ({ hq: countryName.get(x.key) ?? x.key, code: x.key, funds: x.funds })),
      other_hq: { countries: hq.other.targets, funds: hq.other.funds },
      hq_unmapped: hq.unmapped,
      focus_basis: 'Stated focus matched to markets through the Research crosswalk (D533); a fund naming two markets counts in each',
      by_focus: focus.ranked.map((x) => ({ focus: marketName.get(x.key) ?? x.key, slug: x.key, funds: x.funds })),
      other_focus: { markets: focus.other.targets, funds: focus.other.funds },
      focus_unmapped: focus.unmapped,
      size_currency: 'EUR',
      size_note: 'Sizes in euros, from the one list whose currency is known (the EuroTech list); other lists record no size in a known currency and count as missing. Reported fund sizes only; no NAV, IRR, TVPI or performance is inferred.',
      size_bands: sizeBands,
      vintages: years,
      vintage_range: years.length ? { from: years[0].year, to: years[years.length - 1].year } : null,
      recent_vintages: recent,
      ...(recent.length === 0 ? { recent_vintages_reason: `No fund records a vintage from ${thisYear - 4} to ${thisYear}` } : {}),
      missing: {
        // The grouped rows count non-blank values only, so the rest is missing.
        hq: all - counted(funds.hq),
        focus: all - counted(funds.focus),
        size: all - sized,
        vintage: all - years.reduce((s, v) => s + v.funds, 0),
      },
    };
  });
}

/** The parts of a signal's `build_opportunity` JSON the overview shows; null when it holds none. */
export function buildOpportunity(raw: string | null | undefined) {
  let parsed: unknown;
  try { parsed = JSON.parse(String(raw ?? '')); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, string> = {};
  for (const k of ['headline', 'wedge', 'icp', 'gtm', 'moat', 'risks']) {
    const v = (parsed as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

interface SignalRow {
  id: string; type: string; title: string; sector: string; country: string; region: string;
  why_now: string | null; build_opportunity: string | null; confidence_score: number | null; updated_at: string;
}

async function readSignals(env: Env, top: number) {
  return section(async () => {
    // advisor_note is deliberately never selected (voice rule).
    // D5318 H7: the active count is a window over every active row, taken
    // before LIMIT, so the page length never stands in for it.
    const list = await env.DB.prepare(
      `SELECT id, type, title, sector, country, region, why_now, build_opportunity, confidence_score, updated_at,
              COUNT(*) OVER () AS active_count
         FROM signals WHERE status = 'active' ORDER BY updated_at DESC, id LIMIT ?`
    ).bind(top).all<SignalRow & { active_count: number }>();
    const rows = list.results || [];
    if (rows.length === 0) return { status: 'not_recorded' as const, reason: 'No active signal yet' };
    const items = rows.map((r) => {
      const whyNow = typeof r.why_now === 'string' && r.why_now.trim() ? r.why_now.trim() : null;
      const build = buildOpportunity(r.build_opportunity);
      // 0 is the stored default for a signal no evidence has scored, not a score.
      const confidence = Number(r.confidence_score);
      const scored = Number.isFinite(confidence) && confidence > 0;
      return {
        id: r.id, type: r.type, title: r.title, sector: r.sector, country: r.country,
        region: typeof r.region === 'string' && r.region.trim() ? r.region : null,
        why_now: whyNow,
        ...(whyNow ? {} : { why_now_reason: NOT_RECORDED }),
        build_opportunity: build,
        ...(build ? {} : { build_opportunity_reason: NOT_RECORDED }),
        confidence_score: scored ? confidence : null,
        ...(scored ? {} : { confidence_reason: 'Not recorded: no evidence has been scored for this signal yet' }),
        updated_at: r.updated_at,
      };
    });
    return {
      status: 'ok' as const, source: 'Axal research team: hand-written theses (services/signals)',
      active_count: Number(rows[0].active_count), items,
    };
  });
}

researchOverview.get('/', async (c) => {
  await requireAuth(c);
  const raw = Number.parseInt(String(c.req.query('top') ?? ''), 10);
  const top = Number.isFinite(raw) ? Math.min(25, Math.max(1, raw)) : 10;
  const env = c.env;
  // One read of the live indexes feeds both the heat grid and demand against supply.
  const indexes = readLiveIndexes(env);
  indexes.catch(() => {});
  // D5318 H7: one read of each directory feeds its totals and its section.
  const companies = readCompanyAggregates(env, top);
  companies.catch(() => {});
  const funds = readFundAggregates(env);
  funds.catch(() => {});
  const [totals, heat, demandVsSupply, competition, money, signals] = await Promise.all([
    readTotals(env, companies, funds),
    readHeat(env, indexes),
    readDemandVsSupply(env, indexes),
    readCompetition(companies),
    readMoney(env, top, funds),
    readSignals(env, top),
  ]);
  return c.json({
    generated_at: new Date().toISOString(),
    top,
    totals,
    heat,
    demand_vs_supply: demandVsSupply,
    competition,
    money,
    signals,
  });
});

export default researchOverview;
