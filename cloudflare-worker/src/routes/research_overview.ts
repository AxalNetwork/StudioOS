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
 *   heat         market_intel_indexes, live rows only (D538), the current
 *                month (month to date) and its change on the last month;
 *                computed on the read when live observations exist but the
 *                month's index does not yet (as sector-compass does);
 *   demand_vs_supply  the sectors whose live demand rises faster than supply;
 *   competition  companies per sector label and per country (top N);
 *   money        funds per HQ and per focus (top N), size bands, vintages;
 *   signals      the latest active signals (hand-written theses today).
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
import { requireAuth } from '../auth';
import { SECTORS, recomputeIndexes } from '../services/market_intel/aggregator';
import { liveIndexSql, liveRowSql, NO_LIVE_SOURCE_REASON } from '../services/market_intel/liveRows';
import { periodKey, WINDOW_DAYS } from '../services/market_intel/scoring';

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
 * Fund size bands, on `fund_size_cents` (hundredths of the reported unit).
 * The directory records no currency, so the bands carry none either.
 */
export const SIZE_BANDS: Array<{ band: string; min: number; max: number | null }> = [
  { band: 'under 25M', min: 0, max: 25_000_000_00 },
  { band: '25M–100M', min: 25_000_000_00, max: 100_000_000_00 },
  { band: '100M–250M', min: 100_000_000_00, max: 250_000_000_00 },
  { band: '250M–1B', min: 250_000_000_00, max: 1_000_000_000_00 },
  { band: '1B and over', min: 1_000_000_000_00, max: null },
];

const COMPANY_SOURCE = 'Wikidata (CC0), research_company_directory';
const MARKET_SOURCE = 'Axal market directory, research_market_directory';
const FUND_SOURCE = 'EuroTech VC Funds (public spreadsheets), research_fund_directory';

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

async function readTotals(env: Env) {
  return section(async () => {
    const [c, m, f] = await Promise.all([
      readTotal(() => env.DB.prepare(
        `SELECT COUNT(*) AS n, MAX(as_of) AS as_of,
                COUNT(DISTINCT CASE WHEN TRIM(COALESCE(country, '')) <> '' THEN country END) AS countries,
                COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sector, '')) <> '' THEN LOWER(TRIM(sector)) END) AS sectors
           FROM research_company_directory`
      ).first<{ n: number; as_of: string | null; countries: number; sectors: number }>()),
      readTotal(() => env.DB.prepare(`SELECT COUNT(*) AS n, MAX(as_of) AS as_of FROM research_market_directory`)
        .first<{ n: number; as_of: string | null }>()),
      readTotal(() => env.DB.prepare(`SELECT COUNT(*) AS n, MAX(as_of) AS as_of FROM research_fund_directory`)
        .first<{ n: number; as_of: string | null }>()),
    ]);
    const countriesSource = `${COMPANY_SOURCE}: distinct countries`;
    const sectorsSource = `${COMPANY_SOURCE}: distinct raw sector labels`;
    return {
      status: 'ok' as const,
      companies: c === 'unreadable' ? unreadable(COMPANY_SOURCE) : total(c?.n, c?.as_of, COMPANY_SOURCE, 'The company directory holds no company yet'),
      markets: m === 'unreadable' ? unreadable(MARKET_SOURCE) : total(m?.n, m?.as_of, MARKET_SOURCE, 'The market directory holds no market yet'),
      funds: f === 'unreadable' ? unreadable(FUND_SOURCE) : total(f?.n, f?.as_of, FUND_SOURCE, 'The fund directory holds no fund yet'),
      countries: c === 'unreadable' ? unreadable(countriesSource) : total(c?.countries, c?.as_of, countriesSource, 'No company in the directory records a country'),
      sectors: c === 'unreadable' ? unreadable(sectorsSource) : total(c?.sectors, c?.as_of, sectorsSource, 'No company in the directory records a sector'),
      // Whether a market is private, public or government is recorded nowhere
      // yet; #1083 settles how it will be.
      market_split: { value: null, reason: 'Private, public and government are not recorded yet (#1083)' },
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

async function readCompetition(env: Env, top: number) {
  return section(async () => {
    const [bySector, byCountry, asOf] = await Promise.all([
      env.DB.prepare(
        `SELECT TRIM(sector) AS label, COUNT(*) AS companies FROM research_company_directory
          WHERE TRIM(COALESCE(sector, '')) <> '' GROUP BY LOWER(TRIM(sector))
          ORDER BY companies DESC, label COLLATE NOCASE LIMIT ?`
      ).bind(top).all<{ label: string; companies: number }>(),
      env.DB.prepare(
        `SELECT TRIM(country) AS country, COUNT(*) AS companies FROM research_company_directory
          WHERE TRIM(COALESCE(country, '')) <> '' GROUP BY TRIM(country)
          ORDER BY companies DESC, country COLLATE NOCASE LIMIT ?`
      ).bind(top).all<{ country: string; companies: number }>(),
      env.DB.prepare(`SELECT MAX(as_of) AS as_of FROM research_company_directory`).first<{ as_of: string | null }>(),
    ]);
    const sectors = bySector.results || [];
    const countries = byCountry.results || [];
    if (sectors.length === 0 && countries.length === 0) {
      return { status: 'not_recorded' as const, reason: 'No company in the directory records a sector or a country' };
    }
    return {
      status: 'ok' as const, source: COMPANY_SOURCE, as_of: asOf?.as_of ?? null,
      // Raw directory labels until #1080's crosswalk merges; not the 12 index sectors.
      sector_basis: 'raw directory sector labels',
      by_sector: sectors, by_country: countries,
    };
  });
}

async function readMoney(env: Env, top: number) {
  return section(async () => {
    const bandSql = SIZE_BANDS.map((b, i) =>
      `SUM(CASE WHEN fund_size_cents >= ${b.min}${b.max != null ? ` AND fund_size_cents < ${b.max}` : ''} THEN 1 ELSE 0 END) AS b${i}`,
    ).join(', ');
    const thisYear = new Date().getUTCFullYear();
    const [byHq, byFocus, bands, vintages, asOf] = await Promise.all([
      env.DB.prepare(
        `SELECT TRIM(hq) AS hq, COUNT(*) AS funds FROM research_fund_directory
          WHERE TRIM(COALESCE(hq, '')) <> '' GROUP BY TRIM(hq)
          ORDER BY funds DESC, hq COLLATE NOCASE LIMIT ?`
      ).bind(top).all<{ hq: string; funds: number }>(),
      env.DB.prepare(
        `SELECT TRIM(sector_focus) AS focus, COUNT(*) AS funds FROM research_fund_directory
          WHERE TRIM(COALESCE(sector_focus, '')) <> '' GROUP BY LOWER(TRIM(sector_focus))
          ORDER BY funds DESC, focus COLLATE NOCASE LIMIT ?`
      ).bind(top).all<{ focus: string; funds: number }>(),
      // The band edges are constants of this file, never request values.
      env.DB.prepare(`SELECT ${bandSql} FROM research_fund_directory WHERE fund_size_cents > 0`)
        .first<Record<string, number | null>>(),
      env.DB.prepare(
        `SELECT fund_year AS year, COUNT(*) AS funds FROM research_fund_directory
          WHERE fund_year BETWEEN ? AND ? GROUP BY fund_year ORDER BY fund_year DESC`
      ).bind(thisYear - 4, thisYear).all<{ year: number; funds: number }>(),
      env.DB.prepare(`SELECT MAX(as_of) AS as_of FROM research_fund_directory`).first<{ as_of: string | null }>(),
    ]);
    const sizeBands = SIZE_BANDS
      .map((b, i) => ({ band: b.band, funds: Number(bands?.[`b${i}`] ?? 0) }))
      .filter((b) => b.funds > 0);
    const hq = byHq.results || [];
    const focus = byFocus.results || [];
    const recent = vintages.results || [];
    if (hq.length === 0 && focus.length === 0 && sizeBands.length === 0 && recent.length === 0) {
      return { status: 'not_recorded' as const, reason: 'The fund directory records no HQ, focus, size or vintage yet' };
    }
    return {
      status: 'ok' as const, source: FUND_SOURCE, as_of: asOf?.as_of ?? null,
      size_note: 'Reported fund sizes only, in the currency the source spreadsheet used, which the directory does not record; no NAV, IRR, TVPI or performance is inferred.',
      by_hq: hq, by_focus: focus, size_bands: sizeBands,
      recent_vintages: recent,
      ...(recent.length === 0 ? { recent_vintages_reason: `No fund records a vintage from ${thisYear - 4} to ${thisYear}` } : {}),
    };
  });
}

async function readSignals(env: Env, top: number) {
  return section(async () => {
    // advisor_note is deliberately not selected (voice rule).
    const rows = (await env.DB.prepare(
      `SELECT id, type, title, sector, country, updated_at FROM signals
        WHERE status = 'active' ORDER BY updated_at DESC, id LIMIT ?`
    ).bind(top).all<{ id: string; type: string; title: string; sector: string; country: string; updated_at: string }>()).results || [];
    if (rows.length === 0) return { status: 'not_recorded' as const, reason: 'No active signal yet' };
    return { status: 'ok' as const, source: 'Axal research team: hand-written theses (services/signals)', items: rows };
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
  const [totals, heat, demandVsSupply, competition, money, signals] = await Promise.all([
    readTotals(env),
    readHeat(env, indexes),
    readDemandVsSupply(env, indexes),
    readCompetition(env, top),
    readMoney(env, top),
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
