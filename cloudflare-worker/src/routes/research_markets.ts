/**
 * Research · Markets and · Geographies (D533, issue #1080 step 2).
 *
 *   GET /api/research/markets                the 82 markets, searchable (name or tracked sector), filtered
 *                                            by country, source freshness and source type with counts per
 *                                            option, sortable, paged; each with its countries, source count
 *                                            and newest source date (D6284), and a coverage summary (D7171)
 *   GET /api/research/markets/:slug          one market: its companies, funds, signals, sub-markets
 *   GET /api/research/geographies            countries with company and fund counts
 *   GET /api/research/geographies/:code      one country: companies by market, its largest
 *                                            companies by headcount, its funds with their
 *                                            aggregates, and its signals (country, then region)
 *   GET /api/research/listed-companies       the listed companies: `signal_companies` and SEC EDGAR's
 *                                            (migration 404, D595), each labelled by source, paged;
 *                                            `in_both` counts the result's tickers held by both (D7172)
 *
 * Every read is signed-in only (`requireAuth`), and every count goes through
 * the crosswalk in `services/researchTaxonomy.ts`, so a company or fund is
 * placed in a market or a country by rule or by hand override, never guessed.
 * What the crosswalk cannot place is counted as unmapped, not dropped silently.
 *
 * D7713 counts companies by raw sector/country groups. Detail pages read member
 * sort keys and fetch up to 50 company records. Fund and signal counts use their full sets.
 *
 * `supplied_count` is the market directory's own company count, supplied by
 * Axal and not verified; `company_count` is what the company directory in D1
 * holds for that market today. The two are labelled apart because they are
 * not the same claim.
 *
 * The market index series reads live market-intelligence indexes only,
 * through `services/market_intel/liveRows.ts` (D538, #1078). A stub row or an
 * index computed before D538 never reaches a response. D7710 (#7710): each
 * index point carries the window it covers (D7708); the all-time source mix
 * is gone (no page read it).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { readListedTotals, type ListedTotals } from '../services/listedCompanies';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { likeNeedle, likePrefix } from '../util/likeSearch';
import { companyGroups, companyPage, directoryNameOrder as byName, type CompanyGroup, type CompanyRow } from '../services/researchDirectoryReads';
import { euroSizeCents, NO_SIZE_CURRENCY, SERVED_FUNDS } from '../services/researchFundDirectory';
import { distinctObservationsSql, liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON, retrievedAtSql } from '../services/market_intel/liveRows';
import { periodKey, storedWindow, WINDOW_DAYS } from '../services/market_intel/scoring';
import {
  focusTokens, listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector,
  mapFundFocus, mapFundHq, mapSignalTags, type Country, type Overrides,
} from '../services/researchTaxonomy';

export { byHeadcount } from '../services/researchDirectoryReads';

const researchMarkets = new Hono<{ Bindings: Env }>();

const SUPPLIED_LABEL = 'Supplied by Axal for discovery; not independently verified.';
const MAX_LIMIT = 100;
const LIST_CAP = 50;

interface FundRow {
  uid: string; name: string; hq: string | null; sector_focus: string | null; fund_size_cents: number | null;
  /** D7744: the currency the row records its size in; NULL when none is recorded. */
  fund_size_currency: string | null;
  fund_year: number | null; website: string | null; source_name: string; eif_flag: number; eifo_flag: number;
  notable_lps: string | null; as_of: string | null;
}
interface SignalRow {
  id: string; type: string; title: string; thesis: string; why_now: string; country: string; region: string;
  sector: string; niche: string; industry: string | null; status: string; tags: string; build_opportunity: string;
  confidence_score: number; updated_at: string;
}

/** Integer query parameter clamped to [min, max]; anything unreadable is `fallback`. */
function intParam(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(v)) ? (v as T) : fallback;
}

async function funds(env: Env): Promise<FundRow[]> {
  const r = await env.DB.prepare(
    `SELECT uid, name, hq, sector_focus, fund_size_cents, fund_size_currency, fund_year, website, source_name,
            eif_flag, eifo_flag, notable_lps, as_of
       FROM ${SERVED_FUNDS} AS f`,
  ).all<FundRow>();
  return r.results || [];
}

/** Active signals only; `advisor_note` is never selected (S1, #1080). */
async function signals(env: Env): Promise<SignalRow[]> {
  const r = await env.DB.prepare(
    `SELECT id, type, title, thesis, why_now, country, region, sector, niche, industry, status, tags,
            build_opportunity, confidence_score, updated_at
       FROM signals WHERE status <> 'archived' ORDER BY rank_score DESC, id`,
  ).all<SignalRow>();
  return r.results || [];
}

function json<T>(text: string | null | undefined, fallback: T): T {
  try { const v = JSON.parse(text || ''); return v ?? fallback; } catch { return fallback; }
}

function signalDto(s: SignalRow) {
  const { tags, build_opportunity, ...rest } = s;
  const parsed = json<unknown>(tags, []);
  const build = json<Record<string, unknown>>(build_opportunity, {});
  // The build opportunity is a JSON object (`BuildOpportunity`); its
  // `headline` is the one-line pitch a card prints. None written is null.
  const headline = typeof build?.headline === 'string' && build.headline.trim() ? build.headline.trim() : null;
  return { ...rest, tags: Array.isArray(parsed) ? parsed : [], build_headline: headline };
}

const companyDto = (c: CompanyRow, ov: Overrides) => ({
  uid: c.uid, name: c.name, website: c.website, founded_year: c.founded_year,
  country: c.country, country_code: mapCompanyCountry(c.country, ov).targets[0] ?? null,
  sector: c.sector, market: mapCompanySector(c.sector, ov).targets[0] ?? null,
});

/**
 * THE CURRENCY RULE (D533; D7744). These pages compare and print sizes in
 * euros only (the Geography page prints every size here as euros), so only a
 * row that records its size in euros has one here — chosen by the row's own
 * currency through `euroSizeCents`, never by its list's name. Any other size
 * is null with a reason, never printed as if it were euros.
 */
export function eurSizeCents(f: Pick<FundRow, 'fund_size_cents' | 'fund_size_currency'>): number | null {
  return euroSizeCents(f);
}

/** Why a row has no euro size here: none recorded, none in a recorded currency, or one in another currency. */
function noEuroSizeReason(f: Pick<FundRow, 'fund_size_cents' | 'fund_size_currency'>): string {
  if (f.fund_size_cents == null) return 'Not recorded';
  return f.fund_size_currency ? 'Not shown: this page compares sizes in euros only' : NO_SIZE_CURRENCY;
}

/** EIF/EIFO: true, false only when the fund names its LPs, otherwise null (unknown). */
function backing(flag: number, f: Pick<FundRow, 'notable_lps'>): boolean | null {
  const lpsKnown = typeof f.notable_lps === 'string' && f.notable_lps.trim() !== '';
  return flag ? true : lpsKnown ? false : null;
}

const fundDto = (f: FundRow, ov: Overrides) => {
  const size = eurSizeCents(f);
  return {
    uid: f.uid, name: f.name, website: f.website, hq: f.hq, country_codes: mapFundHq(f.hq, ov).targets,
    sector_focus: f.sector_focus, fund_year: f.fund_year,
    fund_size_cents: size,
    size_currency: size != null ? 'EUR' : null,
    ...(size != null ? {} : {
      size_reason: noEuroSizeReason(f),
    }),
    eif: backing(f.eif_flag, f),
    eifo: backing(f.eifo_flag, f),
  };
};

/** Largest euro size first; a fund with no size in a known currency follows, by name. */
const bySize = (a: FundRow, b: FundRow) => (eurSizeCents(b) ?? -1) - (eurSizeCents(a) ?? -1) || byName(a, b);

function bump(m: Map<string, number>, key: string, count = 1) { m.set(key, (m.get(key) ?? 0) + count); }
const countList = (m: Map<string, number>, keyName: string) =>
  [...m.entries()].map(([k, n]) => ({ [keyName]: k, count: n }))
    .sort((a, b) => (b.count as number) - (a.count as number) || String(a[keyName]).localeCompare(String(b[keyName])));

// ---------------------------------------------------------------------------
// The market index: monthly points per dimension, live rows only.
// ---------------------------------------------------------------------------

export const DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;
export const INDEX_MONTHS = 6;
export const NO_SECTOR_REASON = 'This market has no market-intelligence sector yet';

interface IndexRow {
  period_key: string; dimension: string; value: number; delta_pct: number | null; source_count: number;
  window_start?: string | null; window_end?: string | null;
}

/** The month before `period` ('YYYY-MM'). */
function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Index rows → one series per dimension. A point's `change` is the written
 * `delta_pct` when there is one, otherwise the difference from the previous
 * calendar month's value — never across a missing month. A dimension with no
 * live point reads "Not recorded" with its reason, never a neutral 50.
 */
export function indexSeries(rows: IndexRow[], current: string, reason: string) {
  const out: Record<string, unknown> = {};
  for (const dim of DIMENSIONS) {
    const pts = rows
      .filter((r) => r.dimension === dim && r.source_count > 0 && Number.isFinite(r.value))
      .sort((a, b) => a.period_key.localeCompare(b.period_key))
      .slice(-INDEX_MONTHS);
    if (pts.length === 0) { out[dim] = { status: 'not_recorded', reason, points: [] }; continue; }
    const byPeriod = new Map(pts.map((p) => [p.period_key, p]));
    out[dim] = {
      status: 'recorded',
      points: pts.map((p) => {
        const prev = byPeriod.get(previousPeriod(p.period_key));
        const change = p.delta_pct ?? (prev ? Math.round((p.value - prev.value) * 10) / 10 : null);
        // D7710: the window the point covers (D7708), stored at compute time; never derived.
        const w = storedWindow(p);
        return {
          period: p.period_key, value: p.value, change,
          change_basis: p.delta_pct != null ? 'delta_pct' : (prev ? 'previous_month' : null),
          sources: p.source_count, month_to_date: p.period_key === current,
          window_start: w.window_start, window_end: w.window_end, window_reason: w.window_reason,
        };
      }),
    };
  }
  return out;
}

async function marketIndex(env: Env, sector: string | null) {
  if (!sector) {
    return { sector: null, reason: NO_SECTOR_REASON, series: indexSeries([], '', NO_SECTOR_REASON) };
  }
  const idx = await env.DB.prepare(
    `SELECT period_key, dimension, value, delta_pct, source_count, window_start, window_end
       FROM market_intel_indexes
      WHERE sector = ? AND geo = 'global' AND ${liveIndexSql()}
      ORDER BY period_key`,
  ).bind(sector).all<IndexRow>();
  const series = indexSeries(idx.results || [], periodKey(), NO_LIVE_SOURCE_REASON);
  const recorded = Object.values(series).some((d: any) => d.status === 'recorded');
  return { sector, reason: recorded ? null : NO_LIVE_SOURCE_REASON, series };
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

const MARKET_SORTS = ['name', 'company_count', 'supplied_count', 'newest_source'] as const;

// ---------------------------------------------------------------------------
// Per-market coverage for the Markets filters (D6284, #6284 · RS-03).
//
// Three derived fields, read in a fixed number of queries whatever the
// directory's size (no query per market):
//   countries         where the directory's companies in this market are based
//                     (the D533 company-sector and company-country crosswalk);
//   source_count      distinct live sources: the tracked sector's live
//                     market-intelligence `source_key`s (D538 predicate) and the
//                     `source_key`s of the evidence behind active signals whose
//                     tags name the market;
//   newest_source_at  the newest of those sources' row dates (`ts`, `observed_at`).
// Each is `{ status: 'recorded', value }` or `{ status: 'not_recorded', value:
// null, reason }` — a market no source covers reads null with its reason,
// never 0. No market size or growth is derived: no store records one.
//
// D7710 (#7710), owner answer A: `source_count`, `newest_source_at`, the fresh
// band and filter, the coverage bands and the `newest_source` sort read only
// evidence that NAMES the market. Inherited sector-level sources sit beside it
// in `sources_by_kind.market_intel`, read over the index window (D7708: rows
// retrieved in the 30 days before the read), each observation once.
// `distinct_source_count` counts a source key in both sets once. Every newest
// date names its basis (`reported`, `period_measured` or `retrieved`).
//
// D7171 (#7171): the coverage is read for EVERY market, not the page, so the
// `country`, `fresh` and `src` filters, their counts per option and the total
// cover the whole directory before it is paged. `sources_by_kind` splits the
// sources into sector-level (market intelligence, shared by every market in
// the tracked sector) and evidence that names the market, each with its own
// count and newest date, counted over the whole list, not the capped one.
// ---------------------------------------------------------------------------

export const NO_COMPANY_REASON = 'No company in the directory is placed in this market';
export const NO_COUNTRY_REASON = 'No company in this market records a country the crosswalk can place';
export const NO_SOURCE_REASON = 'None named: no evidence behind an active signal names this market';
export const NO_SOURCE_DATE_REASON = 'No source row for this market records a date';
export const NO_DISTINCT_REASON =
  'No source: no evidence names this market and no live market-intelligence row for its tracked sector in the index window';
/** D7710: what a newest date measures. */
export const DATE_BASES = ['reported', 'period_measured', 'retrieved'] as const;
export type DateBasis = typeof DATE_BASES[number];
export const NO_KIND_REASON = 'No source of this kind';
/** At most this many sources are listed per market; `source_count` counts them all. */
export const SOURCES_CAP = 20;

/** D7171, D7710: the freshness bands of `?fresh=`, by the newest evidence that names the market. */
export const FRESH_BANDS = ['30', '90', 'older', 'none'] as const;
/** D7171: the source kinds of `?src=`: evidence naming the market, sector-level only, none. */
export const SOURCE_KINDS = ['named', 'sector', 'none'] as const;
/** A newest source older than this many days is Stale (the page's STALE_AT). */
export const STALE_DAYS = 90;
/** At most this many values of a repeatable filter are read. */
const MAX_FILTER_VALUES = 20;

type Recorded<T> = { status: 'recorded'; value: T } | { status: 'not_recorded'; value: null; reason: string };
const recorded = <T>(value: T): Recorded<T> => ({ status: 'recorded', value });
const notRecorded = <T>(reason: string): Recorded<T> => ({ status: 'not_recorded', value: null, reason });

interface MarketSource { kind: 'market_intel' | 'signal_evidence'; key: string; rows: number; newest: string | null; basis: DateBasis | null }

/** `ts` is ISO ('…T…Z'), `observed_at` is SQLite ('… …'); compared on one form. */
const dateKey = (d: string | null) => String(d ?? '').replace(' ', 'T');
const maxDate = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : (dateKey(b) > dateKey(a) ? b : a));

/** A stored date as UTC milliseconds; a date with no zone is UTC, as SQLite writes it. */
function utcMs(d: string | null): number | null {
  if (!d) return null;
  const k = dateKey(d);
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(k) || !k.includes('T') ? k : `${k}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Whole days from `d` to `now`, or null when `d` is not a date. */
export function ageDays(d: string | null, now: number): number | null {
  const ms = utcMs(d);
  return ms == null ? null : Math.max(0, Math.floor((now - ms) / 86_400_000));
}

/** The `?fresh=` band a market's newest source falls in. */
export function freshBand(newest: Recorded<string>, now: number): typeof FRESH_BANDS[number] {
  const age = newest.status === 'recorded' ? ageDays(newest.value, now) : null;
  if (age == null) return 'none';
  return age <= 30 ? '30' : age <= STALE_DAYS ? '90' : 'older';
}

interface KindSummary { count: number; newest: Recorded<string>; basis: DateBasis | null }
interface Coverage {
  countries: Recorded<Array<{ code: string; count: number }>>;
  source_count: Recorded<number>;
  newest_source_at: Recorded<string>;
  newest_source_basis: DateBasis | null;
  distinct_source_count: Recorded<number>;
  sources_by_kind: { market_intel: KindSummary; signal_evidence: KindSummary };
  sources: MarketSource[];
}

/** The `?src=` kind of a market: any evidence naming it, else sector-level only, else none. */
export function sourceKind(cov: Pick<Coverage, 'sources_by_kind'>): typeof SOURCE_KINDS[number] {
  if (cov.sources_by_kind.signal_evidence.count > 0) return 'named';
  return cov.sources_by_kind.market_intel.count > 0 ? 'sector' : 'none';
}

const countryCodes = (cov: Pick<Coverage, 'countries'>) =>
  cov.countries.status === 'recorded' ? cov.countries.value.map((x) => x.code) : [];

/**
 * D7710: one kind's count and newest date. The newest date takes the strongest
 * basis any source in the list has (the period measured over the retrieval
 * date), so a figure fetched again never moves it when a period is recorded.
 */
function kindSummary(list: MarketSource[]): KindSummary {
  const rank = (b: DateBasis | null) => (b == null ? -1 : DATE_BASES.length - DATE_BASES.indexOf(b));
  const best = list.reduce<DateBasis | null>((acc, s) => (s.newest && rank(s.basis) > rank(acc) ? s.basis : acc), null);
  const newest = list.filter((s) => s.basis === best).reduce<string | null>((acc, s) => maxDate(acc, s.newest), null);
  return {
    count: list.length,
    newest: newest ? recorded(newest) : notRecorded<string>(list.length ? NO_SOURCE_DATE_REASON : NO_KIND_REASON),
    basis: newest ? best : null,
  };
}

/** D7710: the index window's start (D7708: the `WINDOW_DAYS` days before `now`), as an ISO stamp. */
export const windowStart = (now: number) => new Date(now - WINDOW_DAYS * 86_400_000).toISOString();

/**
 * The live market-intelligence sources of each tracked sector: one grouped
 * query. D7710: over the index window by D7708's rule (retrieved in the
 * `WINDOW_DAYS` days before the read), each observation once (D7707's
 * identity). A source's newest date is the last day measured where its rows
 * record one, else its newest retrieval date, and says which.
 */
async function sectorSources(env: Env, sectors: string[], now: number) {
  const miBySector = new Map<string, MarketSource[]>();
  if (!sectors.length) return miBySector;
  const r = await env.DB.prepare(
    `SELECT sector, source_key, ${distinctObservationsSql()} AS rows,
            MAX(observed_period_end) AS period_end, MAX(${retrievedAtSql()}) AS retrieved
       FROM market_intel_rows
      WHERE sector IN (SELECT value FROM json_each(?)) AND ${liveRowSql()} AND ${retrievedAtSql()} >= ?
      GROUP BY sector, source_key`,
  ).bind(JSON.stringify(sectors), windowStart(now))
    .all<{ sector: string; source_key: string; rows: number; period_end: string | null; retrieved: string | null }>();
  for (const row of r.results || []) {
    const list = miBySector.get(row.sector) ?? [];
    const basis: DateBasis | null = row.period_end ? 'period_measured' : (row.retrieved ? 'retrieved' : null);
    list.push({ kind: 'market_intel', key: row.source_key, rows: Number(row.rows), newest: row.period_end ?? row.retrieved ?? null, basis });
    miBySector.set(row.sector, list);
  }
  return miBySector;
}

async function marketCoverage(
  env: Env,
  markets: Array<{ slug: string; mi_sector: string | null; company_count: number }>,
  byCountry: Map<string, Map<string, number>>,
  now: number,
) {
  const slugs = new Set(markets.map((m) => m.slug));
  const sectors = [...new Set(markets.map((m) => m.mi_sector).filter((s): s is string => !!s))];

  // Live market-intelligence sources, passed as one bound JSON array.
  const miBySector = await sectorSources(env, sectors, now);

  // Signal evidence: one grouped query over active signals, mapped by tags here.
  const ev = await env.DB.prepare(
    `SELECT s.id AS signal_id, s.tags AS tags, e.source_key AS source_key,
            COUNT(*) AS rows, MAX(e.observed_at) AS newest
       FROM signal_evidence e JOIN signals s ON s.id = e.signal_id
      WHERE s.status <> 'archived'
      GROUP BY s.id, e.source_key`,
  ).all<{ signal_id: string; tags: string; source_key: string; rows: number; newest: string | null }>();
  const evBySlug = new Map<string, Map<string, MarketSource>>();
  for (const row of ev.results || []) {
    for (const slug of mapSignalTags(row.tags).targets) {
      if (!slugs.has(slug)) continue;
      const per = evBySlug.get(slug) ?? new Map<string, MarketSource>();
      const prev = per.get(row.source_key);
      per.set(row.source_key, {
        kind: 'signal_evidence', key: row.source_key,
        rows: (prev?.rows ?? 0) + Number(row.rows),
        newest: maxDate(prev?.newest ?? null, row.newest ?? null),
        // `observed_at` is the date the source reports.
        basis: 'reported',
      });
      evBySlug.set(slug, per);
    }
  }

  const of = (m: { slug: string; mi_sector: string | null; company_count: number }): Coverage => {
    const per = byCountry.get(m.slug);
    const countries: Recorded<Array<{ code: string; count: number }>> = per && per.size
      ? recorded(countList(per, 'code') as Array<{ code: string; count: number }>)
      : notRecorded(m.company_count > 0 ? NO_COUNTRY_REASON : NO_COMPANY_REASON);

    const mi = m.mi_sector ? (miBySector.get(m.mi_sector) ?? []) : [];
    const named = [...(evBySlug.get(m.slug)?.values() ?? [])];
    const sources: MarketSource[] = [...mi, ...named]
      .sort((a, b) => dateKey(b.newest).localeCompare(dateKey(a.newest)) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    // D7710: the headline reads evidence that names the market; inherited sources sit beside it.
    const namedKind = kindSummary(named);
    const distinct = new Set(sources.map((src) => src.key)).size;
    return {
      countries,
      source_count: named.length ? recorded(named.length) : notRecorded<number>(NO_SOURCE_REASON),
      newest_source_at: namedKind.newest.status === 'recorded' ? namedKind.newest
        : notRecorded<string>(named.length ? NO_SOURCE_DATE_REASON : NO_SOURCE_REASON),
      newest_source_basis: namedKind.basis,
      distinct_source_count: distinct ? recorded(distinct) : notRecorded<number>(NO_DISTINCT_REASON),
      sources_by_kind: { market_intel: kindSummary(mi), signal_evidence: namedKind },
      sources: sources.slice(0, SOURCES_CAP),
    };
  };
  return { of, miBySector };
}

/** A repeatable query parameter (`?country=DE&country=NL` or `?country=DE,NL`), trimmed, at most 20. */
function many(values: string[] | undefined): string[] {
  return [...new Set((values || []).flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean))]
    .slice(0, MAX_FILTER_VALUES);
}

export interface MarketFilters {
  q: string;
  country: string[];
  fresh: typeof FRESH_BANDS[number] | '';
  src: typeof SOURCE_KINDS[number] | '';
  sector: string[];
}
type Facet = 'country' | 'fresh' | 'src';
interface Filterable {
  name: string; mi_sector: string | null; supplied_count?: number;
  countries: Coverage['countries']; newest_source_at: Coverage['newest_source_at']; sources_by_kind: Coverage['sources_by_kind'];
}

/** Whether `q` matches the market's name or its tracked sector, and which. */
export function queryMatch(m: Pick<Filterable, 'name' | 'mi_sector'>, q: string): 'name' | 'sector' | null {
  const needle = q.toLowerCase();
  if (!needle) return null;
  if (m.name.toLowerCase().includes(needle)) return 'name';
  return m.mi_sector && m.mi_sector.toLowerCase().includes(needle) ? 'sector' : null;
}

/**
 * Whether a market passes every filter but `skip` (a facet's counts are taken
 * over the set its own filter does not narrow). A market whose countries are
 * Not recorded matches no country: it is never treated as being in one.
 */
export function passes(m: Filterable, f: MarketFilters, now: number, skip: Facet | null = null): boolean {
  if (f.q && !queryMatch(m, f.q)) return false;
  if (f.sector.length && !(m.mi_sector && f.sector.includes(m.mi_sector))) return false;
  if (skip !== 'country' && f.country.length && !countryCodes(m).some((c) => f.country.includes(c))) return false;
  if (skip !== 'fresh' && f.fresh && freshBand(m.newest_source_at, now) !== f.fresh) return false;
  if (skip !== 'src' && f.src && sourceKind(m) !== f.src) return false;
  return true;
}

/** Counts per option of each filter, over the markets the other filters leave. */
export function marketFacets(all: Filterable[], f: MarketFilters, now: number) {
  const over = (skip: Facet) => all.filter((m) => passes(m, f, now, skip));
  const byCountry = new Map<string, number>();
  let countryNotRecorded = 0;
  const cSet = over('country');
  for (const m of cSet) {
    const codes = countryCodes(m);
    if (!codes.length) countryNotRecorded += 1;
    for (const code of codes) bump(byCountry, code);
  }
  const fSet = over('fresh');
  const sSet = over('src');
  return {
    country: { total: cSet.length, options: countList(byCountry, 'code'), not_recorded: countryNotRecorded },
    fresh: { total: fSet.length, options: FRESH_BANDS.map((value) => ({ value, count: fSet.filter((m) => freshBand(m.newest_source_at, now) === value).length })) },
    src: { total: sSet.length, options: SOURCE_KINDS.map((value) => ({ value, count: sSet.filter((m) => sourceKind(m) === value).length })) },
  };
}

/**
 * The coverage summary (the Analysis view, RMD-06B) over the markets the
 * filters leave: how fresh their newest sources are, which record a country
 * and why not, how many a tracked sector claims, and per tracked sector its
 * sector-level sources and how many of its markets evidence names. Counts of
 * markets only: no size, growth or ranking.
 */
export function coverageSummary(set: Filterable[], miBySector: Map<string, MarketSource[]>, now: number) {
  const fresh = Object.fromEntries(FRESH_BANDS.map((b) => [b, 0])) as Record<typeof FRESH_BANDS[number], number>;
  const countries = { recorded: 0, no_company: 0, no_placeable_country: 0, distinct: 0 };
  const seen = new Set<string>();
  const sectors = new Map<string, { markets: number; named_markets: number }>();
  let unmapped = 0;
  let unmappedNamed = 0;
  for (const m of set) {
    fresh[freshBand(m.newest_source_at, now)] += 1;
    if (m.countries.status === 'recorded') {
      countries.recorded += 1;
      for (const c of m.countries.value) seen.add(c.code);
    } else if (m.countries.reason === NO_COUNTRY_REASON) countries.no_placeable_country += 1;
    else countries.no_company += 1;
    const named = m.sources_by_kind.signal_evidence.count > 0 ? 1 : 0;
    if (!m.mi_sector) { unmapped += 1; unmappedNamed += named; continue; }
    const s = sectors.get(m.mi_sector) ?? { markets: 0, named_markets: 0 };
    s.markets += 1;
    s.named_markets += named;
    sectors.set(m.mi_sector, s);
  }
  countries.distinct = seen.size;
  const supplied_total = set.reduce((n, m) => n + (Number(m.supplied_count) || 0), 0);
  const by_sector = [...sectors.entries()].map(([sector, s]) => {
    const k = kindSummary(miBySector.get(sector) ?? []);
    return { sector, markets: s.markets, sector_sources: k.count, newest_sector_source: k.newest, newest_sector_basis: k.basis, named_markets: s.named_markets };
  }).sort((a, b) => b.markets - a.markets || a.sector.localeCompare(b.sector));
  return {
    markets: set.length,
    // The taxonomy's own company counts, summed: labelled apart, never a market size.
    supplied_total,
    fresh,
    countries,
    tracked: { mapped: set.length - unmapped, unmapped },
    by_sector,
    unmapped: { markets: unmapped, named_markets: unmappedNamed },
    stale_days: STALE_DAYS,
  };
}

researchMarkets.get('/markets', async (c) => {
  await requireAuth(c);
  const q = String(c.req.query('q') || '').trim().slice(0, 120);
  const sort = oneOf(c.req.query('sort'), MARKET_SORTS, 'name');
  const dir = oneOf(c.req.query('dir'), ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc');
  const limit = intParam(c.req.query('limit'), LIST_CAP, 1, MAX_LIMIT);
  const offset = intParam(c.req.query('offset'), 0, 0, 10_000);

  // D7171: a filter that cannot be read is refused, never dropped: an ignored
  // filter would answer the whole directory under a filtered heading.
  const country = many(c.req.queries('country')).map((v) => v.toUpperCase());
  if (country.some((v) => !/^[A-Z]{2}$/.test(v))) {
    return refuse(c, 400, { code: 'invalid_country', message: 'A country filter is a two-letter country code, such as DE.' });
  }
  const freshRaw = String(c.req.query('fresh') || '');
  if (freshRaw && !(FRESH_BANDS as readonly string[]).includes(freshRaw)) {
    return refuse(c, 400, { code: 'invalid_fresh', message: 'Source freshness is one of 30, 90, older or none.' });
  }
  const srcRaw = String(c.req.query('src') || '');
  if (srcRaw && !(SOURCE_KINDS as readonly string[]).includes(srcRaw)) {
    return refuse(c, 400, { code: 'invalid_src', message: 'Source type is one of named, sector or none.' });
  }
  const filters: MarketFilters = {
    q, country, sector: many(c.req.queries('sector')),
    fresh: freshRaw as MarketFilters['fresh'], src: srcRaw as MarketFilters['src'],
  };

  const [rows, sectors, { groups }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT slug, name, company_count AS supplied_count, as_of FROM research_market_directory`,
    ).all<{ slug: string; name: string; supplied_count: number; as_of: string }>(),
    listMarketSectors(c.env),
    companyGroups(c.env),
  ]);
  const sectorOf = new Map(sectors.map((s) => [s.market_slug, s]));
  const counts = new Map<string, number>();
  let unmapped = 0;
  const byCountry = new Map<string, Map<string, number>>();
  for (const group of groups) {
    const market = group.markets[0];
    if (!market) { unmapped += group.count; continue; }
    bump(counts, market, group.count);
    if (group.code) {
      const countries = byCountry.get(market) ?? new Map<string, number>();
      bump(countries, group.code, group.count);
      byCountry.set(market, countries);
    }
  }

  const base = (rows.results || []).map((r) => ({
    slug: r.slug,
    name: r.name,
    mi_sector: sectorOf.get(r.slug)?.mi_sector ?? null,
    company_count: counts.get(r.slug) ?? 0,
    supplied_count: r.supplied_count,
    supplied_label: SUPPLIED_LABEL,
    as_of: r.as_of,
  }));
  const now = Date.now();
  const { of, miBySector } = await marketCoverage(c.env, base, byCountry, now);
  const all = base.map((m) => ({ ...m, ...of(m) }));
  const items = all.filter((m) => passes(m, filters, now));

  const sign = dir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    if (sort === 'newest_source') {
      // A market with no dated source sorts last either way.
      const an = a.newest_source_at.value; const bn = b.newest_source_at.value;
      if (!an || !bn) return (an ? 0 : 1) - (bn ? 0 : 1) || byName(a, b);
      return sign * dateKey(an).localeCompare(dateKey(bn)) || byName(a, b);
    }
    const d = sort === 'name' ? byName(a, b) : (a[sort] - b[sort]);
    return sign * d || byName(a, b);
  });
  const page = items.slice(offset, offset + limit);
  return c.json({
    items: page.map((m) => (q ? { ...m, matched_on: queryMatch(m, q) } : m)),
    total: items.length,
    directory_total: all.length,
    limit, offset, sort, dir,
    filters: { q, country: filters.country, fresh: filters.fresh || null, src: filters.src || null, sector: filters.sector },
    matched_on: q ? { name: items.filter((m) => queryMatch(m, q) === 'name').length, sector: items.filter((m) => queryMatch(m, q) === 'sector').length } : null,
    facets: marketFacets(all, filters, now),
    summary: coverageSummary(items, miBySector, now),
    read_at: new Date(now).toISOString(),
    // D7710: the window the sector-level sources were read over.
    sector_window: { start: windowStart(now), end: new Date(now).toISOString(), days: WINDOW_DAYS },
    companies_unmapped: unmapped,
    supplied_label: SUPPLIED_LABEL,
  });
});

researchMarkets.get('/markets/:slug', async (c) => {
  await requireAuth(c);
  const slug = c.req.param('slug');
  const market = await c.env.DB.prepare(
    `SELECT slug, name, company_count AS supplied_count, as_of FROM research_market_directory WHERE slug = ?`,
  ).bind(slug).first<{ slug: string; name: string; supplied_count: number; as_of: string }>();
  if (!market) return c.json({ detail: 'Not found' }, 404);

  const [sector, { groups, overrides: ov }, fs, sigs, countries] = await Promise.all([
    c.env.DB.prepare(
      `SELECT mi_sector, method, note FROM research_market_sectors WHERE market_slug = ?`,
    ).bind(slug).first<{ mi_sector: string | null; method: string; note: string | null }>(),
    companyGroups(c.env),
    funds(c.env),
    signals(c.env),
    listCountries(c.env),
  ]);
  const countryName = new Map(countries.map((k) => [k.code, k]));
  const index = await marketIndex(c.env, sector?.mi_sector ?? null);

  const inMarket = groups.filter((g) => g.markets.includes(slug));
  const page = await companyPage(c.env, inMarket, 'market');
  const byCountry = new Map<string, number>();
  const labels = new Map<string, number>();
  for (const group of page.orderedGroups) {
    bump(byCountry, group.code ?? '', group.count);
    bump(labels, String(group.sector), group.count);
  }
  const focused = fs.filter((f) => mapFundFocus(f.sector_focus, ov).targets.includes(slug)).sort(bySize);
  const tokens = new Map<string, number>();
  for (const f of focused) {
    for (const t of focusTokens(f.sector_focus)) {
      if (mapFundFocus(t, ov).targets.includes(slug)) bump(tokens, t);
    }
  }
  const sigIn = sigs.filter((s) => mapSignalTags(s.tags).targets.includes(slug));

  return c.json({
    item: { ...market, supplied_label: SUPPLIED_LABEL },
    sector: sector ? { mi_sector: sector.mi_sector, method: sector.method, note: sector.note } : { mi_sector: null, method: null, note: null },
    index,
    company_count: inMarket.reduce((n, g) => n + g.count, 0),
    companies: page.rows.map((co) => companyDto(co, ov)),
    companies_by_country: countList(byCountry, 'code').map((r) => ({
      code: r.code || null,
      name: r.code ? (countryName.get(r.code as string)?.name ?? null) : null,
      count: r.count,
    })),
    fund_count: focused.length,
    funds: focused.slice(0, LIST_CAP).map((f) => fundDto(f, ov)),
    signals: sigIn.map(signalDto),
    sub_markets: {
      company_sectors: countList(labels, 'label'),
      fund_focus: countList(tokens, 'label'),
    },
  });
});

// ---------------------------------------------------------------------------
// Geographies
// ---------------------------------------------------------------------------

const GEO_SORTS = ['name', 'company_count', 'fund_count'] as const;

function countryCounts(groups: CompanyGroup[], fs: FundRow[], ov: Overrides) {
  const companyCounts = new Map<string, number>();
  const fundCounts = new Map<string, number>();
  let companiesUnmapped = 0;
  let fundsUnmapped = 0;
  for (const { code, count } of groups) {
    if (code) bump(companyCounts, code, count); else companiesUnmapped += count;
  }
  for (const f of fs) {
    const codes = mapFundHq(f.hq, ov).targets;
    if (codes.length === 0) fundsUnmapped += 1;
    for (const code of codes) bump(fundCounts, code);
  }
  return { companyCounts, fundCounts, companiesUnmapped, fundsUnmapped };
}

researchMarkets.get('/geographies', async (c) => {
  await requireAuth(c);
  const q = String(c.req.query('q') || '').trim().toLowerCase().slice(0, 120);
  const region = String(c.req.query('region') || '').trim();
  const sort = oneOf(c.req.query('sort'), GEO_SORTS, 'name');
  const dir = oneOf(c.req.query('dir'), ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc');
  const limit = intParam(c.req.query('limit'), LIST_CAP, 1, MAX_LIMIT);
  const offset = intParam(c.req.query('offset'), 0, 0, 10_000);
  const withData = c.req.query('with_data') !== '0';

  const [countries, { groups, overrides: ov }, fs] = await Promise.all([listCountries(c.env), companyGroups(c.env), funds(c.env)]);
  const { companyCounts, fundCounts, companiesUnmapped, fundsUnmapped } = countryCounts(groups, fs, ov);

  const items = countries
    .filter((k: Country) => (!region || k.region === region) && (!q || k.name.toLowerCase().includes(q) || k.code.toLowerCase() === q))
    .map((k) => ({ ...k, company_count: companyCounts.get(k.code) ?? 0, fund_count: fundCounts.get(k.code) ?? 0 }))
    .filter((k) => !withData || k.company_count + k.fund_count > 0);
  const sign = dir === 'asc' ? 1 : -1;
  items.sort((a, b) => sign * (sort === 'name' ? byName(a, b) : a[sort] - b[sort]) || byName(a, b));
  return c.json({
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit, offset, sort, dir,
    companies_unmapped: companiesUnmapped,
    funds_unmapped: fundsUnmapped,
  });
});

/** Fund size bands, in euros (the only currency a size is recorded in). */
export const SIZE_BANDS: ReadonlyArray<{ key: string; label: string; min: number; max: number | null }> = [
  { key: 'lt50', label: 'Under €50M', min: 0, max: 50e6 },
  { key: '50to150', label: '€50M–€150M', min: 50e6, max: 150e6 },
  { key: '150to500', label: '€150M–€500M', min: 150e6, max: 500e6 },
  { key: 'gte500', label: '€500M and over', min: 500e6, max: null },
];

/** What a set of funds adds up to: how many carry each fact, sizes by band, focus keywords. */
export function fundAggregates(fs: FundRow[]) {
  const bands = SIZE_BANDS.map((b) => ({ key: b.key, label: b.label, count: 0 }));
  const focus = new Map<string, number>();
  let withSize = 0; let withVintage = 0; let withFocus = 0; let latest: string | null = null;
  for (const f of fs) {
    const cents = eurSizeCents(f);
    if (cents != null) {
      withSize += 1;
      const eur = cents / 100;
      const i = SIZE_BANDS.findIndex((b) => eur >= b.min && (b.max == null || eur < b.max));
      if (i >= 0) bands[i].count += 1;
    }
    if (f.fund_year != null) withVintage += 1;
    const tokens = focusTokens(f.sector_focus);
    if (tokens.length) withFocus += 1;
    for (const t of new Set(tokens)) bump(focus, t);
    if (f.as_of && (!latest || f.as_of > latest)) latest = f.as_of;
  }
  return {
    count: fs.length,
    with_size: withSize,
    with_vintage: withVintage,
    with_focus: withFocus,
    no_focus: fs.length - withFocus,
    size_bands: bands,
    size_not_recorded: fs.length - withSize,
    focus_keywords: countList(focus, 'label').slice(0, 10),
    as_of: latest,
  };
}

const maxOf = (vals: Array<string | null | undefined>) =>
  vals.reduce<string | null>((m, v) => (v && (!m || v > m) ? v : m), null);

researchMarkets.get('/geographies/:code', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code').toUpperCase();
  const country = await c.env.DB.prepare(
    `SELECT code, name, region FROM research_countries WHERE code = ?`,
  ).bind(code).first<Country>();
  if (!country) return c.json({ detail: 'Not found' }, 404);

  const [{ groups, overrides: ov }, fs, sigs, markets] = await Promise.all([
    companyGroups(c.env, true), funds(c.env), signals(c.env),
    c.env.DB.prepare(`SELECT slug, name FROM research_market_directory`).all<{ slug: string; name: string }>(),
  ]);
  const marketName = new Map((markets.results || []).map((m) => [m.slug, m.name]));

  const here = groups.filter((g) => g.code === code);
  const page = await companyPage(c.env, here, 'country');
  const bySector = new Map<string, number>();
  const byLabel = new Map<string, number>();
  let noLabel = 0;
  for (const group of page.orderedGroups) {
    bump(bySector, group.markets[0] ?? '', group.count);
    const label = String(group.sector ?? '').trim();
    if (label) bump(byLabel, label, group.count); else noLabel += group.count;
  }
  const hqHere = fs.filter((f) => mapFundHq(f.hq, ov).targets.includes(code)).sort(bySize);
  // Signals that name the country come first; then those that name only its
  // region. Each says which, so a card never passes a regional signal off as
  // one about this country.
  const named = sigs.filter((s) => mapCompanyCountry(s.country, ov).targets[0] === code);
  const namedIds = new Set(named.map((s) => s.id));
  const regional = sigs.filter((s) => !namedIds.has(s.id) && s.region === country.region);

  return c.json({
    item: country,
    totals: { companies: groups.reduce((n, g) => n + g.count, 0), funds: fs.length, signals: sigs.length },
    as_of: {
      companies: maxOf(groups.map((g) => g.newest)),
      funds: maxOf(fs.map((f) => f.as_of)),
      signals: maxOf(sigs.map((s) => s.updated_at)),
    },
    company_count: here.reduce((n, g) => n + g.count, 0),
    companies_by_market: countList(bySector, 'slug').map((r) => ({
      slug: r.slug || null,
      name: r.slug ? (marketName.get(r.slug as string) ?? null) : null,
      count: r.count,
    })),
    companies_by_label: countList(byLabel, 'label'),
    companies_without_label: noLabel,
    companies: page.rows.map((co) => ({
      ...companyDto(co, ov),
      employee_count: co.employee_count ?? null,
      employee_as_of: co.employee_as_of ?? null,
      last_round: co.last_funding_amount != null || co.last_funding_type
        ? { amount: co.last_funding_amount ?? null, currency: co.last_funding_currency ?? null,
            date: co.last_funding_date ?? null, type: co.last_funding_type ?? null }
        : null,
    })),
    fund_count: hqHere.length,
    fund_aggregates: fundAggregates(hqHere),
    funds: hqHere.slice(0, LIST_CAP).map((f) => fundDto(f, ov)),
    signals: [
      ...named.map((s) => ({ ...signalDto(s), match: 'country' as const })),
      ...regional.map((s) => ({ ...signalDto(s), match: 'region' as const })),
    ],
    // Market intelligence is computed worldwide only: no per-country demand
    // is stored, so the page prints Not recorded with this reason.
    demand: { status: 'not_recorded', reason: 'Demand data is global only. The sector indexes are computed worldwide, so no per-country demand is stored.' },
  });
});

// ---------------------------------------------------------------------------
// Listed companies (the Public tab)
// ---------------------------------------------------------------------------

interface ListedSortable { name: string; symbol: string; market_cap: number | null }
const byCap = (a: ListedSortable, b: ListedSortable) =>
  (a.market_cap == null ? 1 : 0) - (b.market_cap == null ? 1 : 0) || (Number(a.market_cap) - Number(b.market_cap));
export const LISTED_SORTS: Readonly<Record<string, (a: ListedSortable, b: ListedSortable) => number>> = {
  'name': (a, b) => byName(a, b) || a.symbol.localeCompare(b.symbol),
  '-name': (a, b) => byName(b, a) || a.symbol.localeCompare(b.symbol),
  // A company with no recorded market cap sorts last either way.
  'market_cap': (a, b) => byCap(a, b) || byName(a, b),
  '-market_cap': (a, b) => (a.market_cap == null ? 1 : 0) - (b.market_cap == null ? 1 : 0)
    || (Number(b.market_cap) - Number(a.market_cap)) || byName(a, b),
};

interface ListedRow {
  symbol: string; name: string; exchange: string | null; country: string | null; region: string | null;
  sector: string | null; market_cap: number | null; market_cap_band: string | null; employee_band: string | null;
  updated_at: string;
}
interface EdgarRow {
  cik: string; name: string; ticker: string; exchange: string | null; other_listings: string | null;
  source_name: string; source_url: string; licence: string; as_of: string;
}

/**
 * The two stores the Public tab reads (D595, #1230), each labelled. The
 * signal companies carry the bands their source sets; the SEC EDGAR rows
 * (`research_public_companies`: the table from migration 404, the rows from
 * migration 412) carry what EDGAR records and
 * nothing more — CIK, name, ticker, exchange — so a filter on sector or
 * country, which EDGAR does not record, matches none of them.
 */
export const LISTED_SOURCES = ['signal_companies', 'sec_edgar'] as const;
export const SIGNAL_SOURCE_LABEL = 'StudioOS signal companies';
export const EDGAR_SOURCE_LABEL = 'SEC EDGAR';
const LISTED_MAX_OFFSET = 200_000;

/**
 * EDGAR's page, in SQL: the store is thousands of rows. Market cap is not
 * recorded, so a cap sort reads by name. Two literal statements, so no order
 * clause is ever built from the request.
 */
const EDGAR_PAGE_SQL = {
  asc: `SELECT cik, name, ticker, exchange, other_listings, source_name, source_url, licence, as_of
          FROM research_public_companies
         WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR ticker LIKE ? ESCAPE '\\')
         ORDER BY name COLLATE NOCASE ASC, ticker LIMIT ? OFFSET ?`,
  desc: `SELECT cik, name, ticker, exchange, other_listings, source_name, source_url, licence, as_of
           FROM research_public_companies
          WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR ticker LIKE ? ESCAPE '\\')
          ORDER BY name COLLATE NOCASE DESC, ticker LIMIT ? OFFSET ?`,
} as const;

function otherListings(text: string | null): Array<{ symbol: string; exchange: string | null }> {
  const parsed = json<unknown>(text, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is [string, string | null] => Array.isArray(p) && typeof p[0] === 'string')
    .map(([symbol, exchange]) => ({ symbol, exchange: typeof exchange === 'string' ? exchange : null }));
}

/**
 * D7172 (#7172, the ◇ of D7037): the tickers in the current search that are in
 * both sources, across every page of the result, not only the page shown. The
 * matched signal companies' symbols go in as one bound JSON array, and EDGAR's
 * rows are held to the same search, so a ticker counts only when both of its
 * rows are in this result. Nothing to count when EDGAR is left out or no signal
 * company matched.
 */
/**
 * The three binds of a listed-company search: the term (blank means no filter),
 * "name contains" and "ticker starts with", escaped and capped at D1's 50-byte
 * LIKE limit (D9167).
 */
export const listedSearch = (q: string) => [q, likeNeedle(q, 1) ?? '', likePrefix(q) ?? ''] as const;

export async function countInBoth(env: Env, edgarIn: boolean, q: string, symbols: string[]): Promise<number> {
  if (!edgarIn || symbols.length === 0) return 0;
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT ticker) AS n FROM research_public_companies
      WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR ticker LIKE ? ESCAPE '\\')
        AND ticker IN (SELECT value FROM json_each(?))`,
  ).bind(...listedSearch(q), JSON.stringify(symbols)).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

researchMarkets.get('/listed-companies', async (c) => {
  await requireAuth(c);
  const q = String(c.req.query('q') || '').trim().slice(0, 120);
  const sector = String(c.req.query('sector') || '').trim().slice(0, 120);
  const countryParam = String(c.req.query('country') || '').trim().toUpperCase().slice(0, 2);
  const sortKey = Object.hasOwn(LISTED_SORTS, String(c.req.query('sort'))) ? String(c.req.query('sort')) : '-market_cap';
  const sourceParam = String(c.req.query('source') || '');
  const source = (LISTED_SOURCES as readonly string[]).includes(sourceParam) ? sourceParam : '';
  const limit = intParam(c.req.query('limit'), LIST_CAP, 1, MAX_LIMIT);
  const offset = intParam(c.req.query('offset'), 0, 0, LISTED_MAX_OFFSET);
  // EDGAR records no sector and no country, so either filter leaves it out.
  const edgarIn = source !== 'signal_companies' && !sector && !countryParam;
  const signalIn = source !== 'sec_edgar';
  const unreadable = (e: unknown) => refuse(c, 503, {
    code: 'listed_companies_unreadable',
    message: 'The listed companies could not be read. This is not a sign there are none; try again.',
    raw: e,
  });

  let rows: ListedRow[];
  let ov: Overrides;
  let edgarTotal = 0;
  let stores: ListedTotals;
  let place: (skip: number, take: number) => Promise<EdgarRow[]>;
  try {
    const [r, o, store, count] = await Promise.all([
      c.env.DB.prepare(
        `SELECT symbol, name, exchange, country, region, sector, market_cap, market_cap_band, employee_band, updated_at
           FROM signal_companies
          WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR symbol LIKE ? ESCAPE '\\')
            AND (? = '' OR sector = ?)`,
      ).bind(...listedSearch(q), sector, sector).all<ListedRow>(),
      loadOverrides(c.env),
      // Both stores, unfiltered: their sizes, dates, and how many EDGAR tickers
      // are also a signal company's symbol (shown twice, once per source). The
      // same read the Research overview's Public count prints (#1077, D536).
      readListedTotals(c.env),
      edgarIn
        ? c.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM research_public_companies
            WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR ticker LIKE ? ESCAPE '\\')`,
        ).bind(...listedSearch(q)).first<{ n: number }>()
        : Promise.resolve({ n: 0 }),
    ]);
    rows = signalIn ? (r.results || []) : [];
    ov = o;
    stores = store;
    edgarTotal = Number(count?.n ?? 0);
    place = async (skip, take) => {
      if (!edgarIn || take <= 0) return [];
      const page = await c.env.DB.prepare(EDGAR_PAGE_SQL[sortKey === '-name' ? 'desc' : 'asc'])
        .bind(...listedSearch(q), take, skip).all<EdgarRow>();
      return page.results || [];
    };
  } catch (e) {
    return unreadable(e);
  }
  const placed = rows.map((r) => ({ ...r, country_code: mapCompanyCountry(r.country, ov).targets[0] ?? null }));
  const matched = (countryParam ? placed.filter((r) => r.country_code === countryParam) : placed)
    .sort(LISTED_SORTS[sortKey]);

  // One list, paged on the Worker: the signal companies first (they carry
  // bands), then EDGAR's rows, each in the chosen order.
  const signalPage = matched.slice(offset, offset + limit);
  let edgarPage: EdgarRow[];
  let inBoth: number;
  try {
    [edgarPage, inBoth] = await Promise.all([
      place(Math.max(0, offset - matched.length), limit - signalPage.length),
      countInBoth(c.env, edgarIn, q, matched.map((r) => r.symbol)),
    ]);
  } catch (e) {
    return unreadable(e);
  }
  return c.json({
    items: [
      ...signalPage.map((r) => ({
        source: 'signal_companies' as const,
        symbol: r.symbol, name: r.name, exchange: r.exchange, country: r.country, country_code: r.country_code,
        region: r.region, sector: r.sector, market_cap_band: r.market_cap_band, employee_band: r.employee_band,
        updated_at: r.updated_at,
      })),
      ...edgarPage.map((r) => ({
        source: 'sec_edgar' as const,
        symbol: r.ticker, name: r.name, exchange: r.exchange, cik: r.cik,
        other_listings: otherListings(r.other_listings),
        source_url: r.source_url, licence: r.licence, as_of: r.as_of,
      })),
    ],
    total: matched.length + edgarTotal,
    // D7172 (#7172): how many tickers in THIS result, across all its pages,
    // have a row from each source. Each such ticker is two rows of `total`.
    // 0 when a source filter, a sector or a country leaves either source out.
    in_both: inBoth,
    // Both stores, unfiltered, one row per source: the overview's Public count.
    store_total: stores.total,
    limit, offset, sort: sortKey, source: source || null,
    as_of: maxOf(rows.map((r) => r.updated_at)),
    sources: [
      {
        key: 'signal_companies', label: SIGNAL_SOURCE_LABEL, total: matched.length,
        store_total: stores.signal.n, as_of: maxOf(rows.map((r) => r.updated_at)),
      },
      {
        key: 'sec_edgar', label: EDGAR_SOURCE_LABEL, total: edgarTotal,
        store_total: stores.edgar.n, as_of: stores.edgar.as_of,
        url: 'https://www.sec.gov/files/company_tickers_exchange.json',
        licence: 'US government work, not subject to copyright in the United States (17 U.S.C. § 105)',
        also_signal_companies: stores.edgar.overlap,
        not_recorded: ['country', 'sector', 'market_cap_band', 'employee_band'],
      },
    ],
  });
});

export default researchMarkets;
