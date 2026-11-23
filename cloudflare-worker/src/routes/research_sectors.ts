/**
 * D547 — tracked sectors, read through the D533 crosswalk and D538 live-data boundary.
 *
 * D7708 — each point returns the window its score covers and the source mix it
 * used, both stored beside the point at compute time and read back as stored.
 * A point written before D7708 reads "Window not recorded" and has no mix; a
 * change names the previous point's window too.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { SECTORS, previousPeriodKey } from '../services/market_intel/aggregator';
import { liveIndexSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { storedWindow, WINDOW_NOT_RECORDED, type ScoreMix } from '../services/market_intel/scoring';
import { getSource } from '../services/market_intel/registry';
import '../services/market_intel/sources/index';
import { listCountries, listMarketSectors, loadOverrides, mapCompanyCountry, mapCompanySector, mapFundFocus, mapSignalTags } from '../services/researchTaxonomy';
import { presentFund, SERVED_FUNDS, type DirectoryRow } from '../services/researchFundDirectory';

const researchSectors = new Hono<{ Bindings: Env }>();
/** D7708 — what a source mix is, as the sector read returns it. */
export const SOURCE_MIX_BASIS = 'Each provider\'s share of the weight the score used over its window, with its count of distinct observations. Stored when the score was computed.';
export const SECTOR_DIMENSIONS = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const;
export const sectorSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sectors = SECTORS.map((name) => ({ name, slug: sectorSlug(name) }));
interface IndexRow {
  sector: string; period_key: string; dimension: string; value: number; delta_pct: number | null; source_count: number; computed_at: string;
  window_start?: string | null; window_end?: string | null; source_mix_json?: string | null;
}
interface Company { uid: string; name: string; country: string | null; sector: string | null; founded_year: number | null; employee_count: number | null; as_of: string; source_url: string }
interface Signal { id: string; title: string; type: string; thesis: string; why_now: string; build_opportunity: string; region: string; country: string; confidence_score: number; tags: string; updated_at: string }

/** Calendar months, including this month. Missing months remain explicit null points. */
export function sectorPeriods(now = new Date()): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * D7708 — the mix a point stored, with each provider's display name. Read back
 * as stored: shares are of the weight the score used, beside each provider's
 * count of distinct observations. A provider no longer registered keeps its key
 * and no name.
 */
function presentMix(mix: ScoreMix | null) {
  if (!mix) return [];
  return mix.entries.map((e) => ({ ...e, name: getSource(e.source_key)?.display_name ?? null }));
}

export function sectorSeries(indexes: IndexRow[], periods: string[]) {
  return Object.fromEntries(SECTOR_DIMENSIONS.map((dimension) => {
    const points = periods.map((period) => {
      const row = indexes.find((r) => r.dimension === dimension && r.period_key === period
        && r.source_count > 0 && Number.isFinite(r.value));
      const win = row ? storedWindow(row) : null;
      return {
        period, value: row?.value ?? null, change: row?.delta_pct ?? null,
        computed_at: row?.computed_at ?? null, basis: row ? 'live' : null,
        reason: row ? null : NO_LIVE_SOURCE_REASON, sources: row?.source_count ?? null,
        window_start: win?.window_start ?? null, window_end: win?.window_end ?? null,
        window_reason: row ? win!.window_reason : null,
        // The newest point is overwritten by each refresh until the month turns.
        latest_point: period === periods.at(-1),
        context_only: win?.source_mix ? win.source_mix.context_only : null,
        source_mix: presentMix(win?.source_mix ?? null),
      };
    });
    // A change compares this point with the previous month's point: name both windows. The previous
    // point may not be in this read (a value no surface may show); its window then reads not recorded.
    const withChange = points.map((p, i) => {
      const before = i > 0 && points[i - 1].value !== null ? points[i - 1] : null;
      return { ...p, change_against: p.change == null ? null : {
        period: before?.period ?? previousPeriodKey(p.period),
        window_start: before?.window_start ?? null, window_end: before?.window_end ?? null,
        window_reason: before?.window_start ? null : WINDOW_NOT_RECORDED,
      } };
    });
    const latest = [...withChange].reverse().find((p) => p.value !== null);
    return [dimension, {
      value: latest?.value ?? null, change: latest?.change ?? null, change_against: latest?.change_against ?? null,
      period: latest?.period ?? null, computed_at: latest?.computed_at ?? null,
      window_start: latest?.window_start ?? null, window_end: latest?.window_end ?? null, window_reason: latest?.window_reason ?? null,
      context_only: latest?.context_only ?? null,
      basis: latest ? 'live' : null, reason: latest ? null : NO_LIVE_SOURCE_REASON, points: withChange,
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
  // Request values are bound; the shared live predicate interpolates only a fixed SQL literal.
  // D7708 — the mix is the one stored beside each point; no second read recomputes it.
  const indexes = await env.DB.prepare(`SELECT sector, period_key, dimension, value, delta_pct, source_count, computed_at,
      window_start, window_end, source_mix_json
      FROM market_intel_indexes WHERE (? IS NULL OR sector = ?) AND geo = 'global'
      AND ${liveIndexSql()} AND period_key >= ? AND period_key <= ? ORDER BY period_key`)
    .bind(name, name, periods[0], periods.at(-1)).all<IndexRow>();
  return { indexes: indexes.results || [] };
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
        dimensions: sectorSeries(index.indexes.filter((r) => r.sector === s.name), periods) };
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
    return c.json({ ...sector, dimensions: sectorSeries(index.indexes, periods),
      source_mix_basis: SOURCE_MIX_BASIS,
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
