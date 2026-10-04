/**
 * Research · Markets and · Geographies (D533, issue #1080 step 2).
 *
 *   GET /api/research/markets                the 82 markets, searchable, sortable, paged
 *   GET /api/research/markets/:slug          one market: its companies, funds, signals, sub-markets
 *   GET /api/research/geographies            countries with company and fund counts
 *   GET /api/research/geographies/:code      one country: companies by market, companies, funds, signals
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
 * The market index series and source mix are not here yet: they must read
 * live market-intelligence rows only, and that predicate arrives with #1078.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import {
  focusTokens, listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector,
  mapFundFocus, mapFundHq, mapSignalTags, type Country, type Overrides,
} from '../services/researchTaxonomy';

const researchMarkets = new Hono<{ Bindings: Env }>();

const SUPPLIED_LABEL = 'Supplied by Axal for discovery; not independently verified.';
const MAX_LIMIT = 100;
const LIST_CAP = 50;

interface CompanyRow { uid: string; name: string; website: string; country: string | null; founded_year: number | null; sector: string | null }
interface FundRow { uid: string; name: string; hq: string | null; sector_focus: string | null; fund_size_cents: number | null; fund_year: number | null; website: string | null }
interface SignalRow { id: string; type: string; title: string; thesis: string; why_now: string; country: string; region: string; niche: string; industry: string | null; status: string; tags: string; updated_at: string }

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
    `SELECT uid, name, hq, sector_focus, fund_size_cents, fund_year, website FROM research_fund_directory`,
  ).all<FundRow>();
  return r.results || [];
}

/** Active signals only; `advisor_note` is never selected (S1, #1080). */
async function signals(env: Env): Promise<SignalRow[]> {
  const r = await env.DB.prepare(
    `SELECT id, type, title, thesis, why_now, country, region, niche, industry, status, tags, updated_at
       FROM signals WHERE status <> 'archived' ORDER BY rank_score DESC, id`,
  ).all<SignalRow>();
  return r.results || [];
}

function signalDto(s: SignalRow) {
  const { tags, ...rest } = s;
  let parsed: unknown = [];
  try { parsed = JSON.parse(tags || '[]'); } catch { parsed = []; }
  return { ...rest, tags: Array.isArray(parsed) ? parsed : [] };
}

const companyDto = (c: CompanyRow, ov: Overrides) => ({
  uid: c.uid, name: c.name, website: c.website, founded_year: c.founded_year,
  country: c.country, country_code: mapCompanyCountry(c.country, ov).targets[0] ?? null,
  sector: c.sector, market: mapCompanySector(c.sector, ov).targets[0] ?? null,
});

const fundDto = (f: FundRow, ov: Overrides) => ({
  uid: f.uid, name: f.name, website: f.website, hq: f.hq, country_codes: mapFundHq(f.hq, ov).targets,
  sector_focus: f.sector_focus, fund_size_cents: f.fund_size_cents, fund_year: f.fund_year,
});

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const bySize = (a: FundRow, b: FundRow) => (b.fund_size_cents ?? -1) - (a.fund_size_cents ?? -1) || byName(a, b);

function bump(m: Map<string, number>, key: string) { m.set(key, (m.get(key) ?? 0) + 1); }
const countList = (m: Map<string, number>, keyName: string) =>
  [...m.entries()].map(([k, n]) => ({ [keyName]: k, count: n }))
    .sort((a, b) => (b.count as number) - (a.count as number) || String(a[keyName]).localeCompare(String(b[keyName])));

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

researchMarkets.get('/geographies/:code', async (c) => {
  await requireAuth(c);
  const code = c.req.param('code').toUpperCase();
  const country = await c.env.DB.prepare(
    `SELECT code, name, region FROM research_countries WHERE code = ?`,
  ).bind(code).first<Country>();
  if (!country) return c.json({ detail: 'Not found' }, 404);

  const [ov, cos, fs, sigs, markets] = await Promise.all([
    loadOverrides(c.env), companies(c.env), funds(c.env), signals(c.env),
    c.env.DB.prepare(`SELECT slug, name FROM research_market_directory`).all<{ slug: string; name: string }>(),
  ]);
  const marketName = new Map((markets.results || []).map((m) => [m.slug, m.name]));

  const here = cos.filter((co) => mapCompanyCountry(co.country, ov).targets[0] === code).sort(byName);
  const bySector = new Map<string, number>();
  for (const co of here) bump(bySector, mapCompanySector(co.sector, ov).targets[0] ?? '');
  const hqHere = fs.filter((f) => mapFundHq(f.hq, ov).targets.includes(code)).sort(bySize);
  const sigHere = sigs.filter((s) => mapCompanyCountry(s.country, ov).targets[0] === code);

  return c.json({
    item: country,
    company_count: here.length,
    companies_by_market: countList(bySector, 'slug').map((r) => ({
      slug: r.slug || null,
      name: r.slug ? (marketName.get(r.slug as string) ?? null) : null,
      count: r.count,
    })),
    companies: here.slice(0, LIST_CAP).map((co) => companyDto(co, ov)),
    fund_count: hqHere.length,
    funds: hqHere.slice(0, LIST_CAP).map((f) => fundDto(f, ov)),
    signals: sigHere.map(signalDto),
  });
});

export default researchMarkets;
