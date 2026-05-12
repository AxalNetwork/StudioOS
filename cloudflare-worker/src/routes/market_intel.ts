import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getLiveQuotes, getMarketHeadlines } from '../services/market-data';
import { ensureInvestorTier, effectiveInvestorTier, type InvestorUser } from '../middleware/requireInvestorTier';
import type { User } from '../types';
import type { TierUser } from '../middleware/requireTier';

/** Authenticated caller as enriched by requireAuth + tier joins. */
type MIUser = User & Partial<TierUser> & Partial<InvestorUser>;
import { ensureMarketIntelSchema } from '../services/market_intel/schema';
import { listSources, isLive } from '../services/market_intel/registry';
import { SECTORS, recomputeIndexes } from '../services/market_intel/aggregator';
import { periodKey } from '../services/market_intel/scoring';
import { readEdgeCache, writeEdgeCache, readKv, writeKv } from '../services/market_intel/cache';
// Side-effect import — every connector calls registerSource() at module
// top-level so listSources() returns the full set after this barrel.
import '../services/market_intel/sources';
import { investorSignals as investorSignalsApp } from './investor_signals';
import { callerHasFullLens } from '../util/marketIntelTier';

const marketIntel = new Hono<{ Bindings: Env }>();

// Task #5 (AK) — spec requires `GET /api/market-intel/investor-signals`
// alongside the standalone `/api/investor-signals` mount. We mount the
// same Hono sub-app under `/investor-signals` so both paths surface the
// identical filtered+latest endpoints with no logic duplication.
marketIntel.route('/investor-signals', investorSignalsApp);

// All market-intel endpoints require an authenticated session.
marketIntel.use('*', async (c, next) => {
  await requireAuth(c);
  await ensureMarketIntelSchema(c.env);
  await next();
});

const MARKET_PULSE = [
  { sector: 'Agentic B2B', multiple: 22.4, sentiment: 'Aggressive', technographic_signal: 'High churn in legacy CRM; 40% migration to AI-first middleware.', hiring_surge: 'DevOps/SRE hiring up 18% in mid-market SaaS.', gap_opportunity: 'Unified API for autonomous agent billing.' },
  { sector: 'Bio-Automation', multiple: 14.1, sentiment: 'Wait-and-See', technographic_signal: 'Early adoption of Lab-OS standards.', hiring_surge: 'Biology-specialized LLM researchers.', gap_opportunity: 'Compliance-as-a-service for decentralized clinical trials.' },
  { sector: 'AI Infrastructure', multiple: 28.7, sentiment: 'Aggressive', technographic_signal: 'Enterprise GPU cluster adoption up 65% YoY.', hiring_surge: 'ML Ops engineers up 32% across Fortune 500.', gap_opportunity: 'Edge inference orchestration layer for real-time AI.' },
  { sector: 'Fintech / DeFi', multiple: 16.3, sentiment: 'Cautious', technographic_signal: 'Banks migrating to API-first core banking.', hiring_surge: 'Compliance + crypto-native product managers.', gap_opportunity: 'Regulated stablecoin treasury management API.' },
  { sector: 'Data / Analytics', multiple: 19.8, sentiment: 'Aggressive', technographic_signal: 'Data lakehouse adoption replacing legacy warehouses.', hiring_surge: 'Data engineers and analytics engineers up 25%.', gap_opportunity: 'Real-time data quality monitoring for AI pipelines.' },
  { sector: 'Cybersecurity', multiple: 24.2, sentiment: 'Aggressive', technographic_signal: 'Zero-trust adoption accelerating in mid-market.', hiring_surge: 'AppSec and identity engineers up 40%.', gap_opportunity: 'AI-powered threat detection for API-first architectures.' },
  { sector: 'Autonomous Robotics', multiple: 26.3, sentiment: 'Aggressive', technographic_signal: 'Vision-language models enabling 40%+ YoY increase in warehouse and last-mile automation pilots.', hiring_surge: 'Robotics software + perception engineers up 31%.', gap_opportunity: 'Unified agentic control layer for heterogeneous robot fleets.' },
  { sector: 'Climate Intelligence', multiple: 17.9, sentiment: 'Aggressive', technographic_signal: 'Post-IRA extension surge in carbon accounting and Scope 3 automation platforms.', hiring_surge: 'Sustainability AI engineers up 37%.', gap_opportunity: 'Real-time MRV API for enterprise net-zero compliance.' },
  { sector: 'Quantum Infrastructure', multiple: 12.4, sentiment: 'Wait-and-See', technographic_signal: 'Error-corrected logical qubits crossing 100+ threshold.', hiring_surge: 'Quantum algorithm researchers up 24%.', gap_opportunity: 'Cloud-accessible quantum optimization layer for supply-chain and portfolio risk modeling.' },
];

const MACRO_DATA = {
  sectors: [
    { name: 'AI / ML', avg_pe: 45.2, yoy_growth: 34.5, ipo_window: 'Open', trend: 'up' },
    { name: 'SaaS', avg_pe: 32.1, yoy_growth: 18.2, ipo_window: 'Selective', trend: 'stable' },
    { name: 'Fintech', avg_pe: 28.7, yoy_growth: 12.4, ipo_window: 'Cautious', trend: 'stable' },
    { name: 'Blockchain', avg_pe: 38.5, yoy_growth: 28.1, ipo_window: 'Opening', trend: 'up' },
    { name: 'Biotech', avg_pe: 22.3, yoy_growth: 8.6, ipo_window: 'Selective', trend: 'down' },
    { name: 'Climate Tech', avg_pe: 30.4, yoy_growth: 22.3, ipo_window: 'Open', trend: 'up' },
    { name: 'Cybersecurity', avg_pe: 41.8, yoy_growth: 25.6, ipo_window: 'Open', trend: 'up' },
    { name: 'Semiconductors', avg_pe: 52.3, yoy_growth: 41.2, ipo_window: 'Open', trend: 'up' },
    { name: 'Enterprise AI Software', avg_pe: 38.9, yoy_growth: 29.4, ipo_window: 'Selective', trend: 'up' },
  ],
  interest_rate_impact: 'Moderate — rates stabilized, favoring growth equity.',
  exit_environment: 'Improving. Strategic M&A picking up in AI/Infrastructure.',
  updated_at: '2026-03-27',
};

const PRIVATE_ROUNDS = [
  { company: 'xAI',        sector: 'AI Infrastructure',     amount: '$6B',    valuation: '$45B', stage: 'Series C' },
  { company: 'Anthropic',  sector: 'AI Infrastructure',     amount: '$3.5B',  valuation: '$61B', stage: 'Series E' },
  { company: 'Anduril',    sector: 'Defense / Cybersecurity', amount: '$1.5B', valuation: '$14B', stage: 'Series E' },
  { company: 'Scale AI',   sector: 'Data / Analytics',      amount: '$1B',    valuation: '$14B', stage: 'Series F' },
  { company: 'Groq',       sector: 'AI Infrastructure',     amount: '$300M',  valuation: '$2.8B', stage: 'Series D' },
  { company: 'Perplexity', sector: 'AI Search',             amount: '$250M',  valuation: '$3B',  stage: 'Series D' },
];

const HIGH_CONVICTION = [
  { sector: 'Agentic B2B',          play_type: 'Replacement Play', multiple: 22.4, sentiment: 'Aggressive',
    reasoning: 'High churn in legacy CRM; 40% migration to AI-first middleware.',
    gap_opportunity: 'Unified API for autonomous agent billing.' },
  { sector: 'AI Infrastructure',    play_type: 'Efficiency Play',  multiple: 28.7, sentiment: 'Aggressive',
    reasoning: 'High 28.7x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'Edge inference orchestration layer for real-time AI.' },
  { sector: 'Data / Analytics',     play_type: 'Exit Play',        multiple: 19.8, sentiment: 'Aggressive',
    reasoning: 'Sector multiples at 19.8x — favorable exit timing.',
    gap_opportunity: 'Real-time data quality monitoring for AI pipelines.' },
  { sector: 'Cybersecurity',        play_type: 'Efficiency Play',  multiple: 24.2, sentiment: 'Aggressive',
    reasoning: 'High 24.2x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'AI-powered threat detection for API-first architectures.' },
  { sector: 'Autonomous Robotics',  play_type: 'Efficiency Play',  multiple: 26.3, sentiment: 'Aggressive',
    reasoning: 'High 26.3x multiple + aggressive sentiment = launch at 1/10th cost via studio.',
    gap_opportunity: 'Unified agentic control layer for heterogeneous robot fleets.' },
  { sector: 'Climate Intelligence', play_type: 'Exit Play',        multiple: 17.9, sentiment: 'Aggressive',
    reasoning: 'Post-IRA tailwinds + 17.9x multiples — favorable exit timing for MRV plays.',
    gap_opportunity: 'Real-time MRV API for enterprise net-zero compliance.' },
];

const STUDIO_BENCHMARKS = {
  avg_time_to_inc_days: 11, founder_match_rate: 88, api_reusability_score: 65,
  current_dry_powder: '$4.5M', avg_time_to_first_check_days: 28, conversion_idea_to_funded: 23,
  active_batch_size: 8, portfolio_companies: 12, decision_gate_pass_rate: 72,
  avg_time_to_spinout_days: 68, avg_founder_equity_at_spinout: 68, followon_funding_rate: 75,
  avg_valuation_first_round: '$9.2M', cost_per_spinout: '$185k', deployment_velocity: 35,
};

marketIntel.get('/market-pulse', async (c) => {
  const updated_at = new Date().toISOString();
  let headlines: any[] = [];
  let sources: string[] = [];
  let cached = false;
  try {
    const h = await getMarketHeadlines(c.env);
    headlines = h.headlines;
    sources = h.sources;
    cached = h.cached;
  } catch { /* fall through to seed-only */ }
  return c.json({
    signals: MARKET_PULSE,
    headlines,
    headlines_sources: sources,
    headlines_cached: cached,
    updated_at,
    total_sectors: MARKET_PULSE.length,
  });
});

marketIntel.get('/macro', async (c) => {
  let live_quotes: any[] = [];
  let quotes_updated_at: string | null = null;
  let cached = false;
  try {
    const q = await getLiveQuotes(c.env);
    live_quotes = q.quotes;
    quotes_updated_at = q.updated_at;
    cached = q.cached;
  } catch { /* fall through to seed-only */ }
  return c.json({ ...MACRO_DATA, live_quotes, quotes_updated_at, quotes_cached: cached });
});
marketIntel.get('/private-rounds', (c) => c.json({ rounds: PRIVATE_ROUNDS, total: PRIVATE_ROUNDS.length, updated_at: new Date().toISOString() }));
marketIntel.get('/studio-benchmarks', (c) => c.json(STUDIO_BENCHMARKS));

marketIntel.get('/competitive-intelligence', (c) => {
  return c.json({
    high_conviction_plays: HIGH_CONVICTION,
    studio_benchmarks: STUDIO_BENCHMARKS,
    market_pulse: MARKET_PULSE,
    updated_at: new Date().toISOString(),
  });
});

// Task #6 (W-1) — Market Intelligence export. Free investors get a paywall;
// Professional+ (and admin/partner/mentor bypass) can pull a CSV of the
// current Market Pulse + private rounds. Founders see this surface but
// behind the founder-tier gate (Studio); they never hit this gate because
// the route is only mounted under investor auth in practice.
marketIntel.get('/export', async (c) => {
  const user = (await requireAuth(c)) as InvestorUser;
  // Investors must hold Professional+. Other roles (admin/partner/mentor)
  // bypass the gate inside ensureInvestorTier; founders aren't expected here.
  if (user.role === 'investor') {
    ensureInvestorTier(user, 'professional');
  }
  const fmt = (c.req.query('format') || 'csv').toLowerCase();
  const rows = MARKET_PULSE.map((s) => ({
    sector: s.sector, multiple: s.multiple, sentiment: s.sentiment,
    technographic_signal: s.technographic_signal,
    hiring_surge: s.hiring_surge,
    gap_opportunity: s.gap_opportunity,
  }));
  if (fmt === 'json') {
    return c.json({ exported_at: new Date().toISOString(), rows });
  }
  // Tiny inline CSV writer — Market Intel ships a much richer export in AA-2.
  const headers = Object.keys(rows[0] || { sector: '' });
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc((r as Record<string, unknown>)[h])).join(','));
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="market-intel-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Task #14 (AA-1) — Aggregator-backed lenses.
//
// All endpoints here read from the new `market_intel_indexes` /
// `market_intel_rows` tables populated by the cron-driven aggregator
// (services/market_intel/aggregator.ts). Tier gating is enforced
// SERVER-SIDE per the AA-1 spec:
//   • Free            → composite indexes only (sector compass headline).
//   • Growth/Pro      → full lens + watchlist read.
//   • Studio/Pro      → exports + alerts (watchlist write).
//   • Institutional   → quarterly Axal-VC PDF queue.
// Bypass roles (admin/partner/mentor) always see the full surface.
// ─────────────────────────────────────────────────────────────────────────

type Role = 'admin' | 'founder' | 'partner' | 'investor' | 'mentor';
const FULL_LENS_BYPASS: Role[] = ['admin', 'partner', 'mentor'];

interface IndexRow {
  sector: string; geo: string; period_key: string;
  dimension: string; value: number; source_count: number;
  computed_at: string;
}
interface CitationRow {
  source_key: string; sector: string; metric_key: string;
  metric_value: number; ts: string; ingested_at?: string;
  citation_url: string | null;
}
interface WatchlistRow {
  id: number; sector: string; geo: string; cadence: string; created_at: string;
}

async function readCurrentIndexes(env: Env, period: string): Promise<IndexRow[]> {
  const rows = (await env.DB.prepare(
    `SELECT sector, geo, period_key, dimension, value, source_count, computed_at
       FROM market_intel_indexes WHERE period_key = ? AND geo = 'global'`
  ).bind(period).all<IndexRow>()).results || [];
  if (rows.length > 0) return rows;
  // Cold start path — first deploy after migration / before any cron run.
  // Compute on demand so the first reader gets a populated response.
  await recomputeIndexes(env);
  return (await env.DB.prepare(
    `SELECT sector, geo, period_key, dimension, value, source_count, computed_at
       FROM market_intel_indexes WHERE period_key = ? AND geo = 'global'`
  ).bind(period).all<IndexRow>()).results || [];
}

/** Sector Compass — public composite. Free callers see this everywhere. */
marketIntel.get('/sector-compass', async (c) => {
  const user = await requireAuth(c);
  const period = periodKey();
  const tierLabel = callerHasFullLens(user) ? 'full' : 'free';
  const cached = await readEdgeCache(c.req.raw, tierLabel);
  if (cached) return cached;

  // Layered read: edge miss → KV warm snapshot (24h) → DB → cold compute.
  let rows: IndexRow[] = [];
  const warm = await readKv<{ period_key: string; rows: IndexRow[] }>(c.env, 'compass:global');
  if (warm && warm.period_key === period && Array.isArray(warm.rows) && warm.rows.length > 0) {
    rows = warm.rows;
  } else {
    rows = await readCurrentIndexes(c.env, period);
    if (rows.length > 0) {
      // Repopulate the warm snapshot so the next reader skips D1 entirely.
      await writeKv(c.env, 'compass:global', { period_key: period, computed_at: rows[0].computed_at, rows });
    }
  }
  const bySector: Record<string, Record<string, IndexRow>> = {};
  for (const r of rows) {
    bySector[r.sector] = bySector[r.sector] || {};
    bySector[r.sector][r.dimension] = r;
  }
  // Payload-level tier gating. Free callers get the composite headline
  // ONLY (no per-dimension breakdown); Growth+/bypass callers get the
  // full dimensional lens. Cache keys already fold in `tierLabel` so
  // the two shapes never cross-pollute the edge cache.
  const isFull = tierLabel === 'full';
  const sectors = SECTORS.map((sector) => {
    const dims = bySector[sector] || {};
    const composite = dims.composite?.value ?? 50;
    if (!isFull) return { sector, composite };
    return {
      sector,
      composite,
      dimensions: (['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'] as const).reduce((acc, d) => {
        const r = dims[d];
        acc[d] = r ? { value: r.value, source_count: r.source_count } : { value: 50, source_count: 0 };
        return acc;
      }, {} as Record<string, { value: number; source_count: number }>),
    };
  });

  const body = {
    period_key: period,
    computed_at: rows[0]?.computed_at ?? new Date().toISOString(),
    sectors,
    lens: tierLabel,
  };
  return writeEdgeCache(c.req.raw, tierLabel, body);
});

/** Founder lens — gap opportunities + sector picks. Growth-gated. */
marketIntel.get('/founder-lens', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({
      error: 'tier_required',
      required: 'growth',
      message: 'The founder lens needs the Growth tier or higher.',
      checkout_path: '/api/billing/checkout',
    }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  const picks: Array<{ sector: string; composite: number; demand: number; supply: number; opportunity_gap: number }> = [];
  for (const sector of SECTORS) {
    const r = rows.filter((x) => x.sector === sector);
    const composite = r.find((x) => x.dimension === 'composite')?.value ?? 50;
    const supply = r.find((x) => x.dimension === 'supply')?.value ?? 50;
    const demand = r.find((x) => x.dimension === 'demand')?.value ?? 50;
    const opportunity = Math.round((demand - supply) * 10) / 10;
    picks.push({ sector, composite, demand, supply, opportunity_gap: opportunity });
  }
  picks.sort((a, b) => b.opportunity_gap - a.opportunity_gap);
  return c.json({ period_key: period, picks, computed_at: new Date().toISOString() });
});

/** Investor lens — capital + sentiment ordering. Investor Pro+/bypass only. */
marketIntel.get('/investor-lens', async (c) => {
  const user = await requireAuth(c);
  // Strict gate: investors must hold Pro+; admin/partner/mentor bypass;
  // founders/other roles never see the investor lens (use /founder-lens).
  if (FULL_LENS_BYPASS.includes(user.role as Role)) {
    /* bypass */
  } else if (user.role === 'investor') {
    ensureInvestorTier(user, 'professional');
  } else {
    return c.json({ error: 'tier_required', required: 'investor_professional' }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  const ranked = SECTORS.map((sector) => {
    const r = rows.filter((x) => x.sector === sector);
    const capital = r.find((x) => x.dimension === 'capital')?.value ?? 50;
    const sentiment = r.find((x) => x.dimension === 'sentiment')?.value ?? 50;
    const composite = r.find((x) => x.dimension === 'composite')?.value ?? 50;
    return { sector, capital, sentiment, composite, score: Math.round((capital * 0.6 + sentiment * 0.4) * 10) / 10 };
  }).sort((a, b) => b.score - a.score);
  return c.json({ period_key: period, ranked, computed_at: new Date().toISOString() });
});

// Task #5 (AK) — Geography lens. Currently single 'global' band; per-geo
// rollups land in AA-2. Both `/geography` and `/geography-lens` route to
// the same handler so the seven sub-tabs share a consistent lens-naming
// convention without paying for an internal sub-request.
const geographyLensHandler = async (c: Context<{ Bindings: Env }>) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'professional' }, 402);
  }
  const period = periodKey();
  const rows = await readCurrentIndexes(c.env, period);
  return c.json({
    period_key: period,
    geos: [{ geo: 'global', sectors: rows.filter((r) => r.dimension === 'composite').map((r) => ({ sector: r.sector, composite: r.value })) }],
  });
};
marketIntel.get('/geography', geographyLensHandler);
marketIntel.get('/geography-lens', geographyLensHandler);

/** Citations — last N rows backing the most recent index recompute. */
marketIntel.get('/citations', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const sector = c.req.query('sector') || '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200);
  // Task #5 (AK) — `since` (ISO timestamp) lets the Citations tab fetch
  // only rows newer than the user's last visit. Falls back to a 30-day
  // window when omitted or unparseable. The DB rows expose both `ts`
  // (observation time, source-supplied) and `created_at` (ingest time
  // written by `persistRows`) so the UI can display when WE saw it vs
  // when the source published it.
  const sinceQ = c.req.query('since');
  let cutoff: string;
  if (sinceQ) {
    const d = new Date(sinceQ);
    cutoff = isNaN(d.getTime())
      ? new Date(Date.now() - 30 * 86_400_000).toISOString()
      : d.toISOString();
  } else {
    cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  }
  // `since` filters on ingest time (`created_at`), matching the
  // Citations tab UX expectation of "what's new since I last looked".
  // The ORDER BY stays on `ts` so the most recently *observed* metric
  // surfaces first — ingest can lag observation by minutes.
  // SQLite stores `created_at` as `YYYY-MM-DD HH:MM:SS` (datetime('now'))
  // while ISO `cutoff` uses the `T` separator with milliseconds + `Z`.
  // Lexical TEXT compare on those two formats is unsafe — wrap both
  // sides in `datetime(...)` so the comparison normalizes to the
  // canonical Julian-day form. Same treatment for ts handling.
  const rows = sector
    ? (await c.env.DB.prepare(
        `SELECT source_key, sector, metric_key, metric_value, ts, created_at AS ingested_at, citation_url
           FROM market_intel_rows WHERE datetime(created_at) >= datetime(?) AND sector = ?
           ORDER BY datetime(ts) DESC LIMIT ?`
      ).bind(cutoff, sector, limit).all<CitationRow>()).results
    : (await c.env.DB.prepare(
        `SELECT source_key, sector, metric_key, metric_value, ts, created_at AS ingested_at, citation_url
           FROM market_intel_rows WHERE datetime(created_at) >= datetime(?)
           ORDER BY datetime(ts) DESC LIMIT ?`
      ).bind(cutoff, limit).all<CitationRow>()).results;
  return c.json({ rows: rows || [], since: cutoff });
});

/** List the registered sources + their LIVE/STUB status. Available to all auth'd callers. */
marketIntel.get('/sources', async (c) => {
  const cached = await readKv<any>(c.env, 'sources:catalog');
  if (cached) return c.json(cached);
  const rows = listSources().map((s) => ({
    key: s.key,
    display_name: s.display_name,
    category: s.category,
    cadence: s.cadence,
    dimensions: s.dimensions,
    weight: s.weight,
    paid: !!s.paid,
    live: isLive(c.env, s.key),
  }));
  const body = { count: rows.length, sources: rows };
  await writeKv(c.env, 'sources:catalog', body, 60 * 60);
  return c.json(body);
});

// Watchlist — Growth+/Pro+ may CRUD their own; cron-driven digests reuse
// services/notify.ts (Task #14 cron pulses already flush pending digests).
marketIntel.get('/watchlist', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const rows = (await c.env.DB.prepare(
    `SELECT id, sector, geo, cadence, created_at FROM market_intel_watchlist WHERE user_id = ? ORDER BY id DESC`
  ).bind(user.id).all<WatchlistRow>()).results || [];
  // Task #32 — surface the per-user digest pause window so the UI can
  // render the "Pause digests" control with the correct state. NULL =
  // not paused; ISO timestamp = paused until then; the sentinel
  // '9999-12-31T00:00:00Z' = paused indefinitely.
  const pauseRow = await c.env.DB.prepare(
    `SELECT mi_digest_paused_until AS until FROM users WHERE id = ?`
  ).bind(user.id).first<{ until: string | null }>();
  const until = pauseRow?.until || null;
  const nowIso = new Date().toISOString();
  const isActive = !!(until && until > nowIso);
  const indefinite = !!(until && until.startsWith('9999-'));
  return c.json({
    rows,
    digest_pause: {
      paused_until: isActive ? until : null,
      indefinite: isActive && indefinite,
    },
  });
});

// Task #32 — set/clear the per-user digest pause window. Body shape:
//   { until: 'iso-string' }   → pause until that timestamp
//   { until: 'indefinite' }   → pause forever (sentinel year 9999)
//   { until: null }           → resume immediately
// 1w/1m presets are computed client-side so the server stays a thin
// passthrough — easier to add new presets without a deploy.
marketIntel.post('/watchlist/pause', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const body = await c.req.json<{ until?: string | null }>().catch(() => ({} as { until?: string | null }));
  let value: string | null = null;
  const until = body?.until;
  if (until != null) {
    if (until === 'indefinite') {
      value = '9999-12-31T00:00:00.000Z';
    } else {
      const d = new Date(String(until));
      if (isNaN(d.getTime())) return c.json({ error: 'invalid_until' }, 400);
      // Cap at 1 year so a typo (e.g. year 4001) doesn't strand the
      // user; "indefinite" is the explicit sentinel for forever.
      const max = new Date(Date.now() + 366 * 86_400_000);
      value = (d > max ? max : d).toISOString();
    }
  }
  await c.env.DB.prepare(
    `UPDATE users SET mi_digest_paused_until = ? WHERE id = ?`
  ).bind(value, user.id).run();
  return c.json({ ok: true, paused_until: value });
});

marketIntel.post('/watchlist', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const body = await c.req.json<{ sector?: string; geo?: string; cadence?: 'weekly' | 'monthly' }>().catch(() => ({} as { sector?: string; geo?: string; cadence?: 'weekly' | 'monthly' }));
  const sector = String(body.sector || '').trim();
  if (!sector || !(SECTORS as readonly string[]).includes(sector)) {
    return c.json({ error: 'invalid_sector' }, 400);
  }
  const geo = body.geo || 'global';
  const cadence = body.cadence === 'monthly' ? 'monthly' : 'weekly';
  await c.env.DB.prepare(
    `INSERT INTO market_intel_watchlist (user_id, sector, geo, cadence) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, sector, geo) DO UPDATE SET cadence = excluded.cadence`
  ).bind(user.id, sector, geo, cadence).run();
  return c.json({ ok: true });
});

marketIntel.delete('/watchlist/:id', async (c) => {
  const user = await requireAuth(c);
  if (!callerHasFullLens(user)) {
    return c.json({ error: 'tier_required', required: 'growth' }, 402);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM market_intel_watchlist WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run();
  return c.json({ ok: true });
});

// =============================================================================
// Task #6 (AT-1) — Anonymised advisor-derived MI surfaces.
//
// Nine read endpoints over `market_intel_aggregates` (k≥5 enforced both
// at reduce-time and read-time). Investor-identity disclosure on the
// `/fit/*` endpoints requires an active pairwise NDA; otherwise the
// counter-party id is hashed.
// =============================================================================
import { ensureExtractorSchema } from '../services/market_intel/extractor_schema';

marketIntel.use('/at1/*', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sentiment',     async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/talc',          async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/demand-supply', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sector-heat',   async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/sentiment-geo', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/capital-velocity', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/partner-pulse', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/fit/*',         async (c, next) => { await ensureExtractorSchema(c.env); await next(); });
marketIntel.use('/contribution-optout', async (c, next) => { await ensureExtractorSchema(c.env); await next(); });

const K_MIN = 5;
function safeJson(s: string | null | undefined): any { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
function clampPeriods(p: string | undefined, fallback: number): number {
  const n = p ? parseInt(p, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(52, Math.max(1, n));
}

// 1. /sentiment — recent N weeks per sector, mean valence + energy.
marketIntel.get('/sentiment', async (c) => {
  const periods = clampPeriods(c.req.query('weeks'), 8);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='sentiment' AND n >= ?
       ORDER BY period_key DESC, dimension_key ASC LIMIT ?`,
  ).bind(K_MIN, periods * 32).all();
  const items = (rows.results || []).map((r: any) => ({
    sector: String(r.dimension_key).replace(/^sector:/, ''),
    period_key: r.period_key,
    valence: r.value,
    energy: safeJson(r.payload_json).energy ?? null,
    n: r.n,
  }));
  return c.json({ items, k_min: K_MIN });
});

// 2. /talc — TALC stage distribution per persona × sector.
marketIntel.get('/talc', async (c) => {
  const periods = clampPeriods(c.req.query('months'), 6);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='talc' AND n >= ?
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, periods * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const [persona, sector] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return { persona, sector, period_key: r.period_key, mode: p.mode || null,
             distribution: p.distribution || {}, dominance: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN });
});

// 3. /demand-supply — counts by sector × side × topic.
marketIntel.get('/demand-supply', async (c) => {
  const sector = (c.req.query('sector') || '').slice(0, 64) || null;
  const where = sector ? `AND dimension_key LIKE ?` : '';
  const stmt = c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='demand_supply' AND n >= ? ${where}
       ORDER BY period_key DESC, value DESC LIMIT 200`,
  );
  const rows = sector ? await stmt.bind(K_MIN, `${sector}:%`).all() : await stmt.bind(K_MIN).all();
  const items = (rows.results || []).map((r: any) => {
    const [sec, side, topic] = String(r.dimension_key).split(':');
    return { sector: sec, side, topic, period_key: r.period_key, count: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN });
});

// 4. /sector-heat — composite "heat" index per sector (and sub-sector
//    when the reducer emits dimension_key='sector:X:Y' rows) per week.
marketIntel.get('/sector-heat', async (c) => {
  const weeks = clampPeriods(c.req.query('weeks'), 8);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='sector_heat' AND n >= ?
       ORDER BY period_key DESC, value DESC LIMIT ?`,
  ).bind(K_MIN, weeks * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const p = safeJson(r.payload_json);
    // dimension_key is either `sector:X` (top-level) or `sector:X:Y`
    // (sub-sector). Split so the frontend can render expandable sub-rows.
    const parts = String(r.dimension_key).split(':');
    const sector = parts[1] || '';
    const sub_sector = parts.length > 2 ? parts.slice(2).join(':') : null;
    return { sector, sub_sector,
             period_key: r.period_key, heat: r.value,
             contributions: p.contributions ?? null, mean_valence: p.mean_valence ?? null, n: r.n };
  });
  return c.json({ items, k_min: K_MIN });
});

// 5. /sentiment-geo — geo × sector cross-tab.
marketIntel.get('/sentiment-geo', async (c) => {
  const weeks = clampPeriods(c.req.query('weeks'), 4);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='sentiment_geo' AND n >= ?
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, weeks * 64).all();
  const items = (rows.results || []).map((r: any) => {
    const [, geo, sector] = String(r.dimension_key).split(':');
    return { geo, sector, period_key: r.period_key, valence: r.value, n: r.n };
  });
  return c.json({ items, k_min: K_MIN });
});

// 6. /capital-velocity — derived: investor-side TALC distribution shift
//    (higher dominance of 'distributing' → more capital recycling).
marketIntel.get('/capital-velocity', async (c) => {
  const months = clampPeriods(c.req.query('months'), 6);
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json
       FROM market_intel_aggregates
       WHERE extractor='talc' AND n >= ? AND dimension_key LIKE 'investor:%'
       ORDER BY period_key DESC LIMIT ?`,
  ).bind(K_MIN, months * 16).all();
  const items = (rows.results || []).map((r: any) => {
    const [, sector] = String(r.dimension_key).split(':');
    const dist = (safeJson(r.payload_json).distribution || {}) as Record<string, number>;
    const total = Object.values(dist).reduce((a, b) => a + (Number(b) || 0), 0) || 1;
    const distributing = (dist.distributing || 0) / total;
    const scaling = (dist.scaling || 0) / total;
    return { sector, period_key: r.period_key, velocity: round(distributing + 0.5 * scaling),
             distributing_share: round(distributing), scaling_share: round(scaling), n: r.n };
  });
  return c.json({ items, k_min: K_MIN });
});

// 7. /partner-pulse — rolling supply-side topics aggregated across mentors+partners.
marketIntel.get('/partner-pulse', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value FROM market_intel_aggregates
       WHERE extractor='demand_supply' AND n >= ? AND dimension_key LIKE '%:supply:%'
       ORDER BY period_key DESC, value DESC LIMIT 200`,
  ).bind(K_MIN).all();
  const items = (rows.results || []).map((r: any) => {
    const [sector, , topic] = String(r.dimension_key).split(':');
    return { sector, topic, period_key: r.period_key, supply_count: r.value, n: r.n };
  });
  // Rate-card averages and comp-model histograms surface here once the
  // partner advisor bank ships compensation questions and the matching
  // extractors land. Until then these queries return [] and the frontend
  // shows the k-anonymity insufficient-data block.
  const rateRows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='partner_rate_card' AND n >= ?
       ORDER BY period_key DESC LIMIT 100`,
  ).bind(K_MIN).all().catch(() => ({ results: [] as any[] }));
  const rate_cards = ((rateRows as any).results || []).map((r: any) => {
    const [sector, topic] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return {
      sector, topic, period_key: r.period_key,
      median_hourly: p.median_hourly ?? null,
      p25_hourly: p.p25_hourly ?? null,
      p75_hourly: p.p75_hourly ?? null,
      median_project: p.median_project ?? null,
      n: r.n,
    };
  });
  const compRows = await c.env.DB.prepare(
    `SELECT dimension_key, period_key, n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='partner_comp_model' AND n >= ?
       ORDER BY period_key DESC LIMIT 100`,
  ).bind(K_MIN).all().catch(() => ({ results: [] as any[] }));
  const comp_models = ((compRows as any).results || []).map((r: any) => {
    const [sector] = String(r.dimension_key).split(':');
    const p = safeJson(r.payload_json);
    return {
      sector, period_key: r.period_key,
      distribution: p.distribution || {},
      n: r.n,
    };
  });
  return c.json({ items, rate_cards, comp_models, k_min: K_MIN });
});

// 8. /fit/founder/:project_id — top investor matches for this founder's
//    project. Investor identifiers are hashed unless an active pairwise
//    NDA exists between viewer (founder) and the investor user.
marketIntel.get('/fit/founder/:project_id', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const projectId = parseInt(c.req.param('project_id'), 10);
  if (!Number.isFinite(projectId)) return c.json({ error: 'invalid_project' }, 400);
  // Resolve founder user_id for the project; require ownership.
  const owner = await c.env.DB.prepare(
    `SELECT u.id AS user_id FROM projects p JOIN users u ON u.founder_id = p.founder_id
       WHERE p.id = ? AND p.deleted_at IS NULL`,
  ).bind(projectId).first<{ user_id: number }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  const isAdmin = (user.role || '').toLowerCase() === 'admin';
  if (owner.user_id !== user.id && !isAdmin) return c.json({ error: 'forbidden' }, 403);
  const cell = await c.env.DB.prepare(
    `SELECT n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='fit_match' AND dimension_key = ?`,
  ).bind(`founder:${owner.user_id}`).first<{ n: number; value: number; payload_json: string }>();
  if (!cell || (cell.n ?? 0) < K_MIN) {
    return c.json({ matches: [], note: cell ? 'k_anonymity_suppressed' : 'no_fit_yet', k_min: K_MIN });
  }
  const matches = (safeJson(cell.payload_json).matches || []) as Array<{ user_id: number; score: number }>;
  const disclosed = await disclosedIdentities(c.env, user.id, matches.map((m) => m.user_id));
  return c.json({
    matches: await Promise.all(matches.map(async (m) => ({
      score: m.score,
      investor_user_id: disclosed.has(m.user_id) ? m.user_id : null,
      investor_id_hash: disclosed.has(m.user_id) ? null : await pseudoId(c.env, m.user_id),
      nda_required: !disclosed.has(m.user_id),
    }))),
    k_min: K_MIN,
  });
});

// 9. /fit/investor/me — top founder matches for the calling investor.
marketIntel.get('/fit/investor/me', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  if ((user.role || '').toLowerCase() !== 'investor' && (user.role || '').toLowerCase() !== 'admin') {
    return c.json({ error: 'forbidden', required_role: 'investor' }, 403);
  }
  const cell = await c.env.DB.prepare(
    `SELECT n, value, payload_json FROM market_intel_aggregates
       WHERE extractor='fit_match' AND dimension_key = ?`,
  ).bind(`investor:${user.id}`).first<{ n: number; value: number; payload_json: string }>();
  if (!cell || (cell.n ?? 0) < K_MIN) {
    return c.json({ matches: [], note: cell ? 'k_anonymity_suppressed' : 'no_fit_yet', k_min: K_MIN });
  }
  const matches = (safeJson(cell.payload_json).matches || []) as Array<{ user_id: number; score: number }>;
  const disclosed = await disclosedIdentities(c.env, user.id, matches.map((m) => m.user_id));
  return c.json({
    matches: await Promise.all(matches.map(async (m) => ({
      score: m.score,
      founder_user_id: disclosed.has(m.user_id) ? m.user_id : null,
      founder_id_hash: disclosed.has(m.user_id) ? null : await pseudoId(c.env, m.user_id),
      nda_required: !disclosed.has(m.user_id),
    }))),
    k_min: K_MIN,
  });
});

// Per-user opt-out toggle (default: contribute = optout=0).
marketIntel.get('/contribution-optout', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const r = await c.env.DB.prepare(`SELECT mi_contribution_optout AS x FROM users WHERE id = ?`)
    .bind(user.id).first<{ x: number | null }>();
  return c.json({ opted_out: Number(r?.x || 0) === 1 });
});
marketIntel.post('/contribution-optout', async (c) => {
  const user = (await requireAuth(c)) as MIUser;
  const body = await c.req.json().catch(() => ({} as { opt_out?: boolean }));
  const flag = body.opt_out ? 1 : 0;
  await c.env.DB.prepare(`UPDATE users SET mi_contribution_optout = ? WHERE id = ?`).bind(flag, user.id).run();
  return c.json({ ok: true, opted_out: flag === 1, note: 'Existing contributions purged within 24h by nightly reducer.' });
});

function round(x: number | null): number | null { return x == null ? null : Math.round(x * 1000) / 1000; }
// HMAC-SHA-256 truncated to 16 hex chars, keyed on
// AXAL_ENCRYPTION_SECRET (or JWT_SECRET as fallback) so non-disclosed
// numeric user-ids cannot be enumerated by brute-force preimage. The
// per-deployment secret means the opaque id is stable for one
// deployment but not portable across environments.
async function pseudoId(env: Env, id: number): Promise<string> {
  const secret = (env as any).AXAL_ENCRYPTION_SECRET || (env as any).JWT_SECRET || '';
  if (!secret) return `mi_anon_${(id * 2654435761 >>> 0).toString(36)}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`mi:fit:${id}`));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `mi_${hex.slice(0, 16)}`;
}

/** Returns the subset of `targetUserIds` for which an active pairwise NDA exists with the viewer. */
async function disclosedIdentities(env: Env, viewerId: number, targetUserIds: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (targetUserIds.length === 0) return out;
  const placeholders = targetUserIds.map(() => '?').join(',');
  try {
    const rows = await env.DB.prepare(
      `SELECT party_a_user_id AS a, party_b_user_id AS b
         FROM pairwise_ndas
         WHERE status='active'
           AND (valid_until IS NULL OR valid_until > datetime('now'))
           AND ((party_a_user_id = ? AND party_b_user_id IN (${placeholders}))
             OR (party_b_user_id = ? AND party_a_user_id IN (${placeholders})))`,
    ).bind(viewerId, ...targetUserIds, viewerId, ...targetUserIds)
      .all<{ a: number; b: number }>();
    for (const r of rows.results || []) {
      if (r.a === viewerId) out.add(r.b);
      else if (r.b === viewerId) out.add(r.a);
    }
  } catch (e) {
    console.warn('[mi.fit] pairwise_ndas lookup failed:', (e as Error).message);
  }
  return out;
}

export { MARKET_PULSE, STUDIO_BENCHMARKS };
export default marketIntel;
