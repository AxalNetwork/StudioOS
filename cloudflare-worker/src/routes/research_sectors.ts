/** D547 — tracked sectors, read through the D533 crosswalk and D538 live-data boundary. */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { SECTORS } from '../services/market_intel/aggregator';
import { liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { getSource } from '../services/market_intel/registry';
import '../services/market_intel/sources/index';
import { listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector, mapFundFocus, mapSignalTags } from '../services/researchTaxonomy';
import { presentFund, SERVED_FUNDS, type DirectoryRow } from '../services/researchFundDirectory';

const researchSectors = new Hono<{ Bindings: Env }>();
export const SECTOR_DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;
export const sectorSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sectors = SECTORS.map((name) => ({ name, slug: sectorSlug(name) }));
interface IndexRow { sector: string; period_key: string; dimension: string; value: number; delta_pct: number | null; source_count: number; computed_at: string }
interface MixRow { sector: string; period: string; source_key: string; rows: number; latest: string }
interface Company { uid: string; name: string; country: string | null; sector: string | null; founded_year: number | null; employee_count: number | null; as_of: string; source_url: string }
interface Signal { id: string; title: string; type: string; thesis: string; why_now: string; build_opportunity: string; region: string; country: string; confidence_score: number; tags: string; updated_at: string }

/** Calendar months, including this month. Missing months remain explicit null points. */
export function sectorPeriods(now = new Date()): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function sourceMix(rows: MixRow[], dimension: string) {
  const contributing = rows.filter((r) => getSource(r.source_key)?.dimensions.some((d) => d === dimension));
  const total = contributing.reduce((n, r) => n + r.rows, 0);
  return contributing.map((r) => ({
    source_key: r.source_key, name: getSource(r.source_key)!.display_name,
    rows: r.rows, share: total ? r.rows / total : null, latest: r.latest,
  })).sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

export function sectorSeries(indexes: IndexRow[], mix: MixRow[], periods: string[]) {
  return Object.fromEntries(SECTOR_DIMENSIONS.map((dimension) => {
    const points = periods.map((period) => {
      const row = indexes.find((r) => r.dimension === dimension && r.period_key === period
        && r.source_count > 0 && Number.isFinite(r.value));
      return {
        period, value: row?.value ?? null, change: row?.delta_pct ?? null,
        computed_at: row?.computed_at ?? null, basis: row ? 'live' : null,
        reason: row ? null : NO_LIVE_SOURCE_REASON, sources: row?.source_count ?? null,
        month_to_date: period === periods.at(-1),
        source_mix: sourceMix(mix.filter((r) => r.period === period), dimension),
      };
    });
    const latest = [...points].reverse().find((p) => p.value !== null);
    return [dimension, {
      value: latest?.value ?? null, change: latest?.change ?? null,
      period: latest?.period ?? null, computed_at: latest?.computed_at ?? null,
      basis: latest ? 'live' : null, reason: latest ? null : NO_LIVE_SOURCE_REASON, points,
    }];
  }));
}

async function directory(env: Env) {
  const [marketRows, mappings, overrides, companyRows, fundRows, countries] = await Promise.all([
    env.DB.prepare('SELECT slug, name, company_count AS supplied_count, as_of FROM research_market_directory').all<{ slug: string; name: string; supplied_count: number; as_of: string }>(),
    listMarketSectors(env), loadOverrides(env),
    env.DB.prepare('SELECT uid, name, country, sector, founded_year, employee_count, as_of, source_url FROM research_company_directory').all<Company>(),
    env.DB.prepare(`SELECT uid, name, website, linkedin, hq, fund_number, fund_size_cents,
      fund_date, quarter, fund_year, sector_focus, notable_lps, eif_flag, eifo_flag,
      source_name, source_url, as_of FROM ${SERVED_FUNDS} AS f`).all<DirectoryRow>(),
    listCountries(env),
  ]);
  const marketSector = new Map(mappings.map((m) => [m.market_slug, m.mi_sector]));
  return { markets: marketRows.results || [], marketSector, overrides,
    companies: companyRows.results || [], funds: fundRows.results || [], countries };
}

async function indexData(env: Env, name: string | null, periods: string[]) {
  // Request values are bound; the shared live predicates interpolate only fixed SQL literals.
  const [indexes, mix] = await Promise.all([
    env.DB.prepare(`SELECT sector, period_key, dimension, value, delta_pct, source_count, computed_at
      FROM market_intel_indexes WHERE (? IS NULL OR sector = ?) AND geo = 'global'
      AND ${liveIndexSql()} AND period_key >= ? AND period_key <= ? ORDER BY period_key`)
      .bind(name, name, periods[0], periods.at(-1)).all<IndexRow>(),
    env.DB.prepare(`SELECT sector, substr(ts, 1, 7) AS period, source_key, COUNT(*) AS rows, MAX(ts) AS latest
      FROM market_intel_rows WHERE (? IS NULL OR sector = ?) AND substr(ts, 1, 7) >= ? AND substr(ts, 1, 7) <= ?
      AND ${liveRowSql()}
      GROUP BY sector, substr(ts, 1, 7), source_key`)
      .bind(name, name, periods[0], periods.at(-1)).all<MixRow>(),
  ]);
  return { indexes: indexes.results || [], mix: mix.results || [] };
}

function inSector(data: Awaited<ReturnType<typeof directory>>, name: string) {
  const mapsHere = (markets: string[]) => markets.some((m) => data.marketSector.get(m) === name);
  const companies = data.companies.filter((c) => mapsHere(mapCompanySector(c.sector, data.overrides).targets));
  const funds = data.funds.filter((f) => mapsHere(mapFundFocus(f.sector_focus, data.overrides).targets));
  return { companies, funds, mapsHere };
}

researchSectors.get('/sectors', async (c) => {
  await requireAuth(c);
  try {
    const periods = sectorPeriods();
    const [data, index] = await Promise.all([directory(c.env), indexData(c.env, null, periods)]);
    return c.json({ items: sectors.map((s) => {
      const members = inSector(data, s.name);
      return { ...s, company_count: members.companies.length, fund_count: members.funds.length,
        dimensions: sectorSeries(index.indexes.filter((r) => r.sector === s.name), index.mix.filter((r) => r.sector === s.name), periods) };
    }), total: sectors.length });
  } catch { return c.json({ error: 'sector_unreadable', message: 'Unreadable', reason: 'The sector directory could not be read. Try again.' }, 503); }
});

researchSectors.get('/sectors/:slug', async (c) => {
  await requireAuth(c);
  const sector = sectors.find((s) => s.slug === c.req.param('slug'));
  if (!sector) return c.json({ error: 'Sector not found' }, 404);
  try {
    const periods = sectorPeriods();
    const [data, index, signalRows] = await Promise.all([
      directory(c.env), indexData(c.env, sector.name, periods),
      c.env.DB.prepare(`SELECT id, type, title, thesis, why_now, build_opportunity, region, country,
        confidence_score, tags, updated_at FROM signals WHERE status <> 'archived' ORDER BY updated_at DESC, id`).all<Signal>(),
    ]);
    const members = inSector(data, sector.name);
    const counts = new Map<string, number>();
    const countryNames = new Map(data.countries.map((k) => [k.code, k.name]));
    const companyMarkets = new Map<string, number>();
    for (const co of members.companies) {
      const country = mapCompanyCountry(co.country, data.overrides).targets[0] ?? '';
      counts.set(country, (counts.get(country) ?? 0) + 1);
      for (const market of mapCompanySector(co.sector, data.overrides).targets) companyMarkets.set(market, (companyMarkets.get(market) ?? 0) + 1);
    }
    const funds = members.funds.map(presentFund).sort((a, b) =>
      Number(b.size_currency !== null) - Number(a.size_currency !== null)
      || (b.fund_size_cents ?? 0) - (a.fund_size_cents ?? 0) || a.name.localeCompare(b.name));
    const knownSizes = funds.filter((f) => f.size_currency === 'EUR' && f.fund_size_cents !== null);
    const signals = (signalRows.results || []).filter((s) => members.mapsHere(mapSignalTags(s.tags).targets)).map((s) => {
      const { tags, confidence_score, ...safe } = s;
      return { ...safe, confidence_score: confidence_score > 0 ? confidence_score : null,
        confidence_reason: confidence_score > 0 ? null : 'No confidence measurement is recorded.' };
    });
    return c.json({ ...sector, dimensions: sectorSeries(index.indexes, index.mix, periods),
      source_mix_basis: 'Cited live observations by calendar month; shares count rows, not index weights.',
      company_count: members.companies.length,
      companies: members.companies.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 50).map((co) => ({ ...co,
        country_code: mapCompanyCountry(co.country, data.overrides).targets[0] ?? null })),
      companies_by_country: [...counts].map(([code, count]) => ({ code: code || null, name: countryNames.get(code) ?? null, count }))
        .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))),
      fund_count: funds.length, funds: funds.slice(0, 50),
      fund_sizes: { currency: 'EUR', comparable_count: knownSizes.length,
        total_cents: knownSizes.length ? knownSizes.reduce((n, f) => n + f.fund_size_cents!, 0) : null,
        reason: knownSizes.length ? null : 'No fund size in a known currency is recorded.' },
      signals,
      sub_markets: data.markets.filter((m) => data.marketSector.get(m.slug) === sector.name)
        .map((m) => ({ ...m, company_count: companyMarkets.get(m.slug) ?? 0 }))
        .sort((a, b) => b.company_count - a.company_count || a.name.localeCompare(b.name)),
    });
  } catch { return c.json({ error: 'sector_unreadable', message: 'Unreadable', reason: 'This sector could not be read. Try again.' }, 503); }
});

export default researchSectors;
