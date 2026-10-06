/**
 * Research · Markets and · Geographies (D533, issue #1080 step 2).
 *
 *   GET /api/research/markets                the 82 markets, searchable, sortable, paged
 *   GET /api/research/markets/:slug          one market: its companies, funds, signals, sub-markets
 *   GET /api/research/geographies            countries with company and fund counts
 *   GET /api/research/geographies/:code      one country: companies by market, its largest
 *                                            companies by headcount, its funds with their
 *                                            aggregates, and its signals (country, then region)
 *   GET /api/research/listed-companies       the listed companies: `signal_companies` and SEC EDGAR's
 *                                            (migration 404, D595), each labelled by source, paged
 *
 * Every read is signed-in only (`requireAuth`), and every count goes through
 * the crosswalk in `services/researchTaxonomy.ts`, so a company or fund is
 * placed in a market or a country by rule or by hand override, never guessed.
 * What the crosswalk cannot place is counted as unmapped, not dropped silently.
 *
 * The directories are small (hundreds of companies, a few thousand funds), so
 * each request reads the columns it needs once and maps them here. Nothing is
 * written.
 *
 * `supplied_count` is the market directory's own company count, supplied by
 * Axal and not verified; `company_count` is what the company directory in D1
 * holds for that market today. The two are labelled apart because they are
 * not the same claim.
 *
 * The market index series and source mix read live market-intelligence rows
 * only, through `services/market_intel/liveRows.ts` (D538, #1078). A stub row
 * or an index computed before D538 never reaches a response.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { EUR_SOURCE } from '../services/researchFundDirectory';
import { liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { periodKey } from '../services/market_intel/scoring';
import {
  focusTokens, listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector,
  mapFundFocus, mapFundHq, mapSignalTags, type Country, type Overrides,
} from '../services/researchTaxonomy';

const researchMarkets = new Hono<{ Bindings: Env }>();

const SUPPLIED_LABEL = 'Supplied by Axal for discovery; not independently verified.';
const MAX_LIMIT = 100;
const LIST_CAP = 50;

interface CompanyRow { uid: string; name: string; website: string; country: string | null; founded_year: number | null; sector: string | null }
interface FundRow {
  uid: string; name: string; hq: string | null; sector_focus: string | null; fund_size_cents: number | null;
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

async function companies(env: Env): Promise<CompanyRow[]> {
  const r = await env.DB.prepare(
    `SELECT uid, name, website, country, founded_year, sector FROM research_company_directory`,
  ).all<CompanyRow>();
  return r.results || [];
}

async function funds(env: Env): Promise<FundRow[]> {
  const r = await env.DB.prepare(
    `SELECT uid, name, hq, sector_focus, fund_size_cents, fund_year, website, source_name,
            eif_flag, eifo_flag, notable_lps, as_of
       FROM research_fund_directory`,
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
 * THE CURRENCY RULE (D533, as `researchFundDirectory.presentFund` applies it).
 * Only the EuroTech list records sizes in a known currency, euros. Any other
 * source's number is not a size anyone can compare, so it is null with a
 * reason, never printed as if it were euros or dollars.
 */
export function eurSizeCents(f: Pick<FundRow, 'source_name' | 'fund_size_cents'>): number | null {
  return f.source_name === EUR_SOURCE && f.fund_size_cents != null ? Number(f.fund_size_cents) : null;
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
      size_reason: f.source_name === EUR_SOURCE ? 'Not recorded' : 'Not recorded: this list records no size in a known currency',
    }),
    eif: backing(f.eif_flag, f),
    eifo: backing(f.eifo_flag, f),
  };
};

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
/** Largest euro size first; a fund with no size in a known currency follows, by name. */
const bySize = (a: FundRow, b: FundRow) => (eurSizeCents(b) ?? -1) - (eurSizeCents(a) ?? -1) || byName(a, b);

function bump(m: Map<string, number>, key: string) { m.set(key, (m.get(key) ?? 0) + 1); }
const countList = (m: Map<string, number>, keyName: string) =>
  [...m.entries()].map(([k, n]) => ({ [keyName]: k, count: n }))
    .sort((a, b) => (b.count as number) - (a.count as number) || String(a[keyName]).localeCompare(String(b[keyName])));

// ---------------------------------------------------------------------------
// The market index: monthly points per dimension, live rows only.
// ---------------------------------------------------------------------------

export const DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;
export const INDEX_MONTHS = 6;
export const NO_SECTOR_REASON = 'This market has no market-intelligence sector yet';

interface IndexRow { period_key: string; dimension: string; value: number; delta_pct: number | null; source_count: number }

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
        return {
          period: p.period_key, value: p.value, change,
          change_basis: p.delta_pct != null ? 'delta_pct' : (prev ? 'previous_month' : null),
          sources: p.source_count, month_to_date: p.period_key === current,
        };
      }),
    };
  }
  return out;
}

async function marketIndex(env: Env, sector: string | null) {
  if (!sector) {
    return { sector: null, reason: NO_SECTOR_REASON, series: indexSeries([], '', NO_SECTOR_REASON), source_mix: [] };
  }
  const [idx, mix] = await Promise.all([
    env.DB.prepare(
      `SELECT period_key, dimension, value, delta_pct, source_count
         FROM market_intel_indexes
        WHERE sector = ? AND geo = 'global' AND ${liveIndexSql()}
        ORDER BY period_key`,
    ).bind(sector).all<IndexRow>(),
    env.DB.prepare(
      `SELECT source_key, COUNT(*) AS rows, MAX(ts) AS latest
         FROM market_intel_rows
        WHERE sector = ? AND ${liveRowSql()}
        GROUP BY source_key ORDER BY rows DESC, source_key`,
    ).bind(sector).all<{ source_key: string; rows: number; latest: string }>(),
  ]);
  const series = indexSeries(idx.results || [], periodKey(), NO_LIVE_SOURCE_REASON);
  const recorded = Object.values(series).some((d: any) => d.status === 'recorded');
  return { sector, reason: recorded ? null : NO_LIVE_SOURCE_REASON, series, source_mix: mix.results || [] };
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

const MARKET_SORTS = ['name', 'company_count', 'supplied_count'] as const;

researchMarkets.get('/markets', async (c) => {
  await requireAuth(c);
  const q = String(c.req.query('q') || '').trim().slice(0, 120);
  const sort = oneOf(c.req.query('sort'), MARKET_SORTS, 'name');
  const dir = oneOf(c.req.query('dir'), ['asc', 'desc'] as const, sort === 'name' ? 'asc' : 'desc');
  const limit = intParam(c.req.query('limit'), LIST_CAP, 1, MAX_LIMIT);
  const offset = intParam(c.req.query('offset'), 0, 0, 10_000);

  const [rows, sectors, ov, cos] = await Promise.all([
    c.env.DB.prepare(
      `SELECT slug, name, company_count AS supplied_count, as_of
         FROM research_market_directory
        WHERE (? = '' OR name LIKE '%' || ? || '%')`,
    ).bind(q, q).all<{ slug: string; name: string; supplied_count: number; as_of: string }>(),
    listMarketSectors(c.env),
    loadOverrides(c.env),
    companies(c.env),
  ]);
  const sectorOf = new Map(sectors.map((s) => [s.market_slug, s]));
  const counts = new Map<string, number>();
  let unmapped = 0;
  for (const co of cos) {
    const m = mapCompanySector(co.sector, ov).targets[0];
    if (m) bump(counts, m); else unmapped += 1;
  }

  const items = (rows.results || []).map((r) => ({
    slug: r.slug,
    name: r.name,
    mi_sector: sectorOf.get(r.slug)?.mi_sector ?? null,
    company_count: counts.get(r.slug) ?? 0,
    supplied_count: r.supplied_count,
    supplied_label: SUPPLIED_LABEL,
    as_of: r.as_of,
  }));
  const sign = dir === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    const d = sort === 'name' ? byName(a, b) : (a[sort] - b[sort]);
    return sign * d || byName(a, b);
  });
  return c.json({
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit, offset, sort, dir,
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

  const [sector, ov, cos, fs, sigs, countries] = await Promise.all([
    c.env.DB.prepare(
      `SELECT mi_sector, method, note FROM research_market_sectors WHERE market_slug = ?`,
    ).bind(slug).first<{ mi_sector: string | null; method: string; note: string | null }>(),
    loadOverrides(c.env),
    companies(c.env),
    funds(c.env),
    signals(c.env),
    listCountries(c.env),
  ]);
  const countryName = new Map(countries.map((k) => [k.code, k]));
  const index = await marketIndex(c.env, sector?.mi_sector ?? null);

  const inMarket = cos.filter((co) => mapCompanySector(co.sector, ov).targets.includes(slug)).sort(byName);
  const byCountry = new Map<string, number>();
  const labels = new Map<string, number>();
  for (const co of inMarket) {
    bump(byCountry, mapCompanyCountry(co.country, ov).targets[0] ?? '');
    bump(labels, String(co.sector));
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
    company_count: inMarket.length,
    companies: inMarket.slice(0, LIST_CAP).map((co) => companyDto(co, ov)),
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

function countryCounts(cos: CompanyRow[], fs: FundRow[], ov: Overrides) {
  const companyCounts = new Map<string, number>();
  const fundCounts = new Map<string, number>();
  let companiesUnmapped = 0;
  let fundsUnmapped = 0;
  for (const co of cos) {
    const code = mapCompanyCountry(co.country, ov).targets[0];
    if (code) bump(companyCounts, code); else companiesUnmapped += 1;
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

  const [countries, ov, cos, fs] = await Promise.all([listCountries(c.env), loadOverrides(c.env), companies(c.env), funds(c.env)]);
  const { companyCounts, fundCounts, companiesUnmapped, fundsUnmapped } = countryCounts(cos, fs, ov);

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

interface CompanyMetricRow extends CompanyRow {
  employee_count: number | null; employee_as_of: string | null;
  last_funding_amount: number | null; last_funding_currency: string | null;
  last_funding_date: string | null; last_funding_type: string | null; as_of: string | null;
}

/** The directory with migration 375's headcount and last-round columns (D531). */
async function companiesWithMetrics(env: Env): Promise<CompanyMetricRow[]> {
  const r = await env.DB.prepare(
    `SELECT uid, name, website, country, founded_year, sector, employee_count, employee_as_of,
            last_funding_amount, last_funding_currency, last_funding_date, last_funding_type, as_of
       FROM research_company_directory`,
  ).all<CompanyMetricRow>();
  return r.results || [];
}

/** Largest recorded headcount first; a company with none follows, by name. */
export const byHeadcount = (a: CompanyMetricRow, b: CompanyMetricRow) =>
  (b.employee_count ?? -1) - (a.employee_count ?? -1) || byName(a, b);

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

  const [ov, cos, fs, sigs, markets] = await Promise.all([
    loadOverrides(c.env), companiesWithMetrics(c.env), funds(c.env), signals(c.env),
    c.env.DB.prepare(`SELECT slug, name FROM research_market_directory`).all<{ slug: string; name: string }>(),
  ]);
  const marketName = new Map((markets.results || []).map((m) => [m.slug, m.name]));

  const here = cos.filter((co) => mapCompanyCountry(co.country, ov).targets[0] === code).sort(byHeadcount);
  const bySector = new Map<string, number>();
  const byLabel = new Map<string, number>();
  let noLabel = 0;
  for (const co of here) {
    bump(bySector, mapCompanySector(co.sector, ov).targets[0] ?? '');
    const label = String(co.sector ?? '').trim();
    if (label) bump(byLabel, label); else noLabel += 1;
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
    totals: { companies: cos.length, funds: fs.length, signals: sigs.length },
    as_of: {
      companies: maxOf(cos.map((co) => co.as_of)),
      funds: maxOf(fs.map((f) => f.as_of)),
      signals: maxOf(sigs.map((s) => s.updated_at)),
    },
    company_count: here.length,
    companies_by_market: countList(bySector, 'slug').map((r) => ({
      slug: r.slug || null,
      name: r.slug ? (marketName.get(r.slug as string) ?? null) : null,
      count: r.count,
    })),
    companies_by_label: countList(byLabel, 'label'),
    companies_without_label: noLabel,
    companies: here.slice(0, LIST_CAP).map((co) => ({
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
 * (migration 404, `research_public_companies`) carry what EDGAR records and
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
         WHERE (? = '' OR name LIKE '%' || ? || '%' OR ticker LIKE ? || '%')
         ORDER BY name COLLATE NOCASE ASC, ticker LIMIT ? OFFSET ?`,
  desc: `SELECT cik, name, ticker, exchange, other_listings, source_name, source_url, licence, as_of
           FROM research_public_companies
          WHERE (? = '' OR name LIKE '%' || ? || '%' OR ticker LIKE ? || '%')
          ORDER BY name COLLATE NOCASE DESC, ticker LIMIT ? OFFSET ?`,
} as const;

function otherListings(text: string | null): Array<{ symbol: string; exchange: string | null }> {
  const parsed = json<unknown>(text, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((p): p is [string, string | null] => Array.isArray(p) && typeof p[0] === 'string')
    .map(([symbol, exchange]) => ({ symbol, exchange: typeof exchange === 'string' ? exchange : null }));
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
  let edgarStore: { n: number; as_of: string | null; overlap: number };
  let place: (skip: number, take: number) => Promise<EdgarRow[]>;
  try {
    const [r, o, store, count] = await Promise.all([
      c.env.DB.prepare(
        `SELECT symbol, name, exchange, country, region, sector, market_cap, market_cap_band, employee_band, updated_at
           FROM signal_companies
          WHERE (? = '' OR name LIKE '%' || ? || '%' OR symbol LIKE ? || '%')
            AND (? = '' OR sector = ?)`,
      ).bind(q, q, q, sector, sector).all<ListedRow>(),
      loadOverrides(c.env),
      // The whole store, unfiltered: its size, its date, and how many of its
      // tickers are also a signal company's symbol (shown twice, once per source).
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n, MAX(as_of) AS as_of,
                SUM(CASE WHEN ticker IN (SELECT symbol FROM signal_companies) THEN 1 ELSE 0 END) AS overlap
           FROM research_public_companies`,
      ).first<{ n: number; as_of: string | null; overlap: number | null }>(),
      edgarIn
        ? c.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM research_public_companies
            WHERE (? = '' OR name LIKE '%' || ? || '%' OR ticker LIKE ? || '%')`,
        ).bind(q, q, q).first<{ n: number }>()
        : Promise.resolve({ n: 0 }),
    ]);
    rows = signalIn ? (r.results || []) : [];
    ov = o;
    edgarStore = { n: Number(store?.n ?? 0), as_of: store?.as_of ?? null, overlap: Number(store?.overlap ?? 0) };
    edgarTotal = Number(count?.n ?? 0);
    place = async (skip, take) => {
      if (!edgarIn || take <= 0) return [];
      const page = await c.env.DB.prepare(EDGAR_PAGE_SQL[sortKey === '-name' ? 'desc' : 'asc'])
        .bind(q, q, q, take, skip).all<EdgarRow>();
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
  try {
    edgarPage = await place(Math.max(0, offset - matched.length), limit - signalPage.length);
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
    limit, offset, sort: sortKey, source: source || null,
    as_of: maxOf(rows.map((r) => r.updated_at)),
    sources: [
      { key: 'signal_companies', label: SIGNAL_SOURCE_LABEL, total: matched.length, as_of: maxOf(rows.map((r) => r.updated_at)) },
      {
        key: 'sec_edgar', label: EDGAR_SOURCE_LABEL, total: edgarTotal,
        store_total: edgarStore.n, as_of: edgarStore.as_of,
        url: 'https://www.sec.gov/files/company_tickers_exchange.json',
        licence: 'US government work, not subject to copyright in the United States (17 U.S.C. § 105)',
        also_signal_companies: edgarStore.overlap,
        not_recorded: ['country', 'sector', 'market_cap_band', 'employee_band'],
      },
    ],
  });
});

export default researchMarkets;
