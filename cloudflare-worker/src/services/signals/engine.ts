/**
 * Signals — engine orchestration.
 *
 * Responsibilities:
 *   • load raw signals + companies (D1 first, seed fallback — see NOTE below),
 *   • apply the founder-facing filters,
 *   • rank via ./ranking.ts,
 *   • compute the KPI strip + filter facets,
 *   • run a best-effort background refresh via the source adapters.
 *
 * NOTE on the DB fallback: the `signals` tables ship as a migration
 * (sql/migrations/136_signals.sql) that may not be applied in every environment yet. So the
 * engine attempts a DB read and, if the tables are missing or empty, transparently
 * falls back to the in-code seed corpus (services/signals/seed.ts). This keeps
 * the UI fully functional day one while supporting DB-backed data later — no
 * code change needed when the table fills.
 *
 * Caching: ranked result sets are cached in KV (env.RATE_LIMITS) for a short TTL
 * so repeated dashboard loads are cheap; a refresh busts the cache.
 */
import type { Env } from '../../types';
import type {
  Signal,
  NormalizedCompany,
  SignalFilters,
  SignalKpis,
} from './types';
import { getSeedCompanies, getSeedSignals } from './seed';
import { rankSignals, type RankBreakdown } from './ranking';
import { SOURCE_REGISTRY, capBand, employeeBand } from './sources';

const CACHE_TTL = 15 * 60; // 15 min
const REFRESH_STAMP_KEY = 'signals:last_refresh';

type RankedSignal = Signal & { rank_breakdown: RankBreakdown };

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadCompaniesFromDb(env: Env): Promise<NormalizedCompany[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT symbol, name, exchange, country, region, sector, industry, market_cap,
              market_cap_band, employee_count, employee_band, ceo, description,
              customer_type, maturity_stage, source_key, updated_at
       FROM signal_companies`,
    ).all<any>()).results || [];
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      exchange: r.exchange || undefined,
      country: r.country || undefined,
      region: r.region || undefined,
      sector: r.sector || undefined,
      industry: r.industry || undefined,
      market_cap: r.market_cap ?? undefined,
      market_cap_band: r.market_cap_band || capBand(r.market_cap) || undefined,
      employee_count: r.employee_count ?? undefined,
      employee_band: r.employee_band || employeeBand(r.employee_count) || undefined,
      ceo: r.ceo || undefined,
      description: r.description || undefined,
      customer_type: r.customer_type || undefined,
      maturity_stage: r.maturity_stage || undefined,
      source_key: r.source_key || undefined,
      updated_at: r.updated_at || undefined,
    }));
  } catch {
    return [];
  }
}

async function loadSignalsFromDb(env: Env): Promise<Signal[]> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT * FROM signals WHERE status = 'active'`,
    ).all<any>()).results || [];
    if (!rows.length) return [];

    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const evRows = (await env.DB.prepare(
      `SELECT * FROM signal_evidence WHERE signal_id IN (${ph})`,
    ).bind(...ids).all<any>()).results || [];
    const mapRows = (await env.DB.prepare(
      `SELECT signal_id, symbol FROM signal_company_map WHERE signal_id IN (${ph})`,
    ).bind(...ids).all<any>()).results || [];

    const evBySignal = new Map<string, any[]>();
    for (const e of evRows) {
      const list = evBySignal.get(e.signal_id) || [];
      list.push(e);
      evBySignal.set(e.signal_id, list);
    }
    const coBySignal = new Map<string, string[]>();
    for (const m of mapRows) {
      const list = coBySignal.get(m.signal_id) || [];
      list.push(m.symbol);
      coBySignal.set(m.signal_id, list);
    }

    return rows.map((r): Signal => ({
      id: r.id,
      type: r.type,
      title: r.title,
      thesis: r.thesis,
      why_now: r.why_now || '',
      region: r.region,
      country: r.country,
      sector: r.sector,
      industry: r.industry || undefined,
      niche: r.niche,
      market_cap_band: r.market_cap_band,
      target_customers: safeJson(r.target_customers, []),
      maturity_stage: r.maturity_stage || undefined,
      related_companies: coBySignal.get(r.id) || [],
      evidence_items: (evBySignal.get(r.id) || []).map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        detail: e.detail || undefined,
        source_key: e.source_key,
        url: e.url || undefined,
        weight: e.weight ?? undefined,
        observed_at: e.observed_at,
      })),
      founder_opportunity: r.founder_opportunity || '',
      advisor_note: r.advisor_note || '',
      build: safeJson(r.build_opportunity, { headline: '', wedge: '', icp: '' }),
      market: safeJson(r.market_context, {} as Signal['market']),
      confidence_score: r.confidence_score ?? 0,
      freshness_score: r.freshness_score ?? 0,
      source_attribution: dedupe((evBySignal.get(r.id) || []).map((e) => e.source_key)),
      tags: safeJson(r.tags, []),
      updated_at: r.updated_at,
    }));
  } catch {
    return [];
  }
}

function safeJson<T>(s: any, def: T): T {
  if (s == null) return def;
  if (typeof s !== 'string') return (s as T) ?? def;
  try { return JSON.parse(s) as T; } catch { return def; }
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Load companies keyed by symbol — DB first, seed fallback. */
export async function loadCompanies(env: Env): Promise<Record<string, NormalizedCompany>> {
  let companies = await loadCompaniesFromDb(env);
  if (!companies.length) companies = getSeedCompanies();
  const map: Record<string, NormalizedCompany> = {};
  for (const c of companies) map[c.symbol] = c;
  return map;
}

/**
 * Load raw (unranked) signals — DB first, seed fallback — WITH provenance.
 *
 * `data_state` is the honesty flag the whole surface hangs off: 'live' means
 * every evidence line was fetched from a public source by an ingestion run;
 * 'illustrative' means no ingestion has ever populated D1 and the caller is
 * seeing the curated example corpus. The UI is required to say so — serving
 * examples as if they were live observations is the exact failure this flag
 * exists to prevent.
 */
export async function loadSignalsWithState(
  env: Env,
): Promise<{ signals: Signal[]; data_state: 'live' | 'illustrative' }> {
  const fromDb = await loadSignalsFromDb(env);
  if (fromDb.length) return { signals: fromDb, data_state: 'live' };
  return { signals: getSeedSignals(), data_state: 'illustrative' };
}

/** Load raw (unranked) signals — DB first, seed fallback. */
export async function loadSignals(env: Env): Promise<Signal[]> {
  return (await loadSignalsWithState(env)).signals;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

function matchesFilters(
  s: Signal,
  f: SignalFilters,
  companiesBySymbol: Record<string, NormalizedCompany>,
): boolean {
  if (f.region && norm(s.region) !== norm(f.region)) return false;
  if (f.country && norm(s.country) !== norm(f.country)) return false;
  if (f.sector && norm(s.sector) !== norm(f.sector)) return false;
  if (f.industry && norm(s.industry) !== norm(f.industry)) return false;
  if (f.niche && !norm(s.niche).includes(norm(f.niche))) return false;
  if (f.market_cap_band && norm(s.market_cap_band) !== norm(f.market_cap_band)) return false;
  if (f.maturity_stage && norm(s.maturity_stage) !== norm(f.maturity_stage)) return false;
  if (f.type && norm(s.type) !== norm(f.type)) return false;
  if (f.customer_type && !(s.target_customers || []).some((c) => norm(c) === norm(f.customer_type))) return false;

  // employee_band is a COMPANY attribute → keep the signal if any related
  // company falls in the requested band.
  if (f.employee_band) {
    const hit = (s.related_companies || []).some(
      (sym) => norm(companiesBySymbol[sym]?.employee_band) === norm(f.employee_band),
    );
    if (!hit) return false;
  }

  if (f.q) {
    const hay = `${s.title} ${s.thesis} ${s.niche} ${s.sector} ${s.industry || ''} ${(s.tags || []).join(' ')}`.toLowerCase();
    if (!hay.includes(norm(f.q))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function cacheKey(f: SignalFilters): string {
  const mode = f.mode || 'founder';
  const parts = [
    mode, f.region, f.country, f.sector, f.industry, f.niche,
    f.market_cap_band, f.employee_band, f.customer_type, f.maturity_stage,
    f.type, f.q, f.limit,
  ].map((x) => (x == null ? '' : String(x)));
  return `signals:ranked:${parts.join('|')}`;
}

/** Ranked + filtered signals for the list view. */
export async function getRankedSignals(
  env: Env,
  filters: SignalFilters,
): Promise<{ signals: RankedSignal[]; total: number; cached: boolean; mode: string; data_state: 'live' | 'illustrative' }> {
  const key = cacheKey(filters);
  try {
    const raw = await env.RATE_LIMITS.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...parsed, cached: true };
    }
  } catch { /* ignore cache read */ }

  const [companies, loaded] = await Promise.all([loadCompanies(env), loadSignalsWithState(env)]);
  const { signals, data_state } = loaded;
  const mode = filters.mode === 'advisor' ? 'advisor' : 'founder';
  const filtered = signals.filter((s) => matchesFilters(s, filters, companies));
  const ranked = rankSignals(filtered, companies, mode);
  const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
  const sliced = ranked.slice(0, limit);

  const payload = { signals: sliced, total: ranked.length, mode, data_state };
  try {
    await env.RATE_LIMITS.put(key, JSON.stringify(payload), { expirationTtl: CACHE_TTL });
  } catch { /* ignore cache write */ }
  return { ...payload, cached: false };
}

/** Full detail for one signal, including the ranking breakdown + company rows. */
export async function getSignalDetail(
  env: Env,
  id: string,
  mode: 'founder' | 'advisor' = 'founder',
): Promise<
  | null
  | {
      signal: RankedSignal;
      companies: NormalizedCompany[];
      sources: typeof SOURCE_REGISTRY;
    }
> {
  const [companies, signals] = await Promise.all([loadCompanies(env), loadSignals(env)]);
  const target = signals.find((s) => s.id === id);
  if (!target) return null;
  const [ranked] = rankSignals([target], companies, mode);
  const companyRows = (target.related_companies || [])
    .map((sym) => companies[sym])
    .filter(Boolean) as NormalizedCompany[];
  const usedSourceKeys = new Set(target.evidence_items.map((e) => e.source_key));
  const sources = SOURCE_REGISTRY.filter((s) => usedSourceKeys.has(s.key));
  return { signal: ranked, companies: companyRows, sources };
}

/** KPI strip payload. */
export async function getKpis(env: Env, mode: 'founder' | 'advisor' = 'founder'): Promise<SignalKpis & { data_state: 'live' | 'illustrative' }> {
  const [companies, loaded] = await Promise.all([loadCompanies(env), loadSignalsWithState(env)]);
  const ranked = rankSignals(loaded.signals, companies, mode);

  const regionCounts = new Map<string, number>();
  const sectorCounts = new Map<string, number>();
  let confSum = 0;
  let freshest: number | null = null;
  for (const s of ranked) {
    regionCounts.set(s.region, (regionCounts.get(s.region) || 0) + 1);
    sectorCounts.set(s.sector, (sectorCounts.get(s.sector) || 0) + 1);
    confSum += s.confidence_score;
    const t = Date.parse(s.updated_at);
    if (isFinite(t) && (freshest == null || t > freshest)) freshest = t;
  }

  const top = (m: Map<string, number>, labelKey: 'region' | 'sector') =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => ({ [labelKey]: k, count: v } as any));

  // Honest by construction: null until an ingestion has actually run. The old
  // behaviour defaulted this to "now", which dressed the seed corpus up as a
  // freshly-refreshed dataset on every page load.
  let lastRefresh: string | null = null;
  try {
    const stamp = await env.RATE_LIMITS.get(REFRESH_STAMP_KEY);
    if (stamp) lastRefresh = stamp;
  } catch { /* ignore */ }

  return {
    active_signals: ranked.length,
    top_regions: top(regionCounts, 'region'),
    top_sectors: top(sectorCounts, 'sector'),
    avg_confidence: ranked.length ? Math.round(confSum / ranked.length) : 0,
    freshest_updated_at: freshest ? new Date(freshest).toISOString() : null,
    last_refreshed_at: lastRefresh,
    data_state: loaded.data_state,
  };
}

/** Distinct filter facets present in the current dataset (drives the filter bar). */
export async function getFacets(env: Env): Promise<Record<string, string[]>> {
  const [companies, signals] = await Promise.all([loadCompanies(env), loadSignals(env)]);
  const regions = new Set<string>();
  const countries = new Set<string>();
  const sectors = new Set<string>();
  const industries = new Set<string>();
  const niches = new Set<string>();
  const capBands = new Set<string>();
  const customerTypes = new Set<string>();
  const stages = new Set<string>();
  const types = new Set<string>();
  const empBands = new Set<string>();

  for (const s of signals) {
    regions.add(s.region);
    countries.add(s.country);
    sectors.add(s.sector);
    if (s.industry) industries.add(s.industry);
    niches.add(s.niche);
    capBands.add(s.market_cap_band);
    if (s.maturity_stage) stages.add(s.maturity_stage);
    types.add(s.type);
    for (const c of s.target_customers || []) customerTypes.add(c);
  }
  for (const c of Object.values(companies)) {
    if (c.employee_band) empBands.add(c.employee_band);
  }

  const sorted = (set: Set<string>) => [...set].sort();
  return {
    region: sorted(regions),
    country: sorted(countries),
    sector: sorted(sectors),
    industry: sorted(industries),
    niche: sorted(niches),
    market_cap_band: sorted(capBands),
    employee_band: sorted(empBands),
    customer_type: sorted(customerTypes),
    maturity_stage: sorted(stages),
    type: sorted(types),
  };
}

/**
 * Background refresh / ingestion job — the REAL pipeline (services/signals/
 * ingest.ts): fetch live evidence from the free public sources, gate each
 * thesis on the evidence threshold, and persist signals + evidence + companies
 * into D1 so the D1-first read path serves live data from here on.
 *
 * The per-source ingest-run audit rows and the cache-busting stamp are kept:
 * the stamp is also what lets the KPI strip report an honest
 * `last_refreshed_at` (null until this has run at least once).
 */
export async function runRefresh(env: Env): Promise<{
  ok: boolean;
  sources: number;
  ran_at: string;
  promoted: number;
  held: number;
  evidence_written: number;
  adapters: Array<{ source: string; status: string; items: number }>;
}> {
  const { runIngestion } = await import('./ingest');
  const runId = await beginIngestRun(env, null);
  let result: Awaited<ReturnType<typeof runIngestion>>;
  try {
    result = await runIngestion(env);
  } catch (e: any) {
    await finishIngestRun(env, runId, 'error', 0, String(e?.message || e));
    throw e;
  }
  await finishIngestRun(env, runId, 'ok', result.evidence_written, undefined, result.promoted);

  // Bust ranked-result cache (prefix delete is not available on KV; the short
  // TTL + a new stamp is our invalidation. Individual keys expire in ≤15 min.)
  try {
    await env.RATE_LIMITS.put(REFRESH_STAMP_KEY, result.ran_at, { expirationTtl: 30 * 86400 });
  } catch { /* ignore */ }

  return {
    ok: result.ok,
    sources: SOURCE_REGISTRY.length,
    ran_at: result.ran_at,
    promoted: result.promoted,
    held: result.held,
    evidence_written: result.evidence_written,
    adapters: result.sources.map((s) => ({ source: s.source, status: s.status, items: s.items })),
  };
}

/**
 * Per-source ingest history for the transparency surface (GET /sources).
 * Best-effort: environments without the table report an empty history.
 */
export async function getIngestHealth(env: Env): Promise<Array<{
  source_key: string | null;
  started_at: string;
  status: string;
  companies_seen: number;
  signals_written: number;
  error: string | null;
}>> {
  try {
    const rows = (await env.DB.prepare(
      `SELECT source_key, started_at, status, companies_seen, signals_written, error
       FROM signal_ingest_runs ORDER BY started_at DESC LIMIT 20`,
    ).all<any>()).results || [];
    return rows;
  } catch {
    return [];
  }
}

async function beginIngestRun(env: Env, sourceKey: string | null): Promise<string | null> {
  try {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO signal_ingest_runs (id, source_key, started_at, status) VALUES (?, ?, datetime('now'), 'running')`,
    ).bind(id, sourceKey).run();
    return id;
  } catch {
    return null; // table may not exist yet — non-fatal
  }
}

async function finishIngestRun(
  env: Env,
  id: string | null,
  status: string,
  seen: number,
  error?: string,
  signalsWritten = 0,
): Promise<void> {
  if (!id) return;
  try {
    await env.DB.prepare(
      `UPDATE signal_ingest_runs SET finished_at = datetime('now'), status = ?, companies_seen = ?, signals_written = ?, error = ? WHERE id = ?`,
    ).bind(status, seen, signalsWritten, error || null, id).run();
  } catch { /* non-fatal */ }
}
