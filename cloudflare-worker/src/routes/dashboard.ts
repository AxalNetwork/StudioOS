import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { kvGetJSON, kvPutJSON, kvDelete, createL1 } from '../kv';
import { clampDays } from '../util/pagination';
import { maskFounderForInvestor } from '../services/trust';

const dashboard = new Hono<{ Bindings: Env }>();

// Two-tier cache:
//   L1 — per-isolate Map, 10s TTL. Sub-millisecond, but only the isolate
//        that wrote it gets a hit. Useful for tight refresh loops.
//   L2 — KV (TOKENS namespace, `cache:dash:<userId>` key), 60s TTL. Shared
//        across all worker isolates worldwide, ~150ms read.
// Origin (D1) is the source of truth on miss.
const L1_TTL_MS = 10_000;
const KV_TTL_SEC = 60;
const l1 = createL1<any>(L1_TTL_MS);
const kvKey = (userId: number) => `cache:dash:${userId}`;

// Wrap a query so a single missing table or SQL error doesn't 500 the whole dashboard.
// Returns the fallback value and logs the underlying error for observability.
async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    console.error(`[dashboard:${label}]`, String(e?.message || e));
    return fallback;
  }
}

dashboard.get('/', async (c) => {
  const user = await requireAuth(c);
  const fresh = c.req.query('fresh') === '1';
  // T17 — `?days=N` window (default 30, max 365) sizes the earnings series
  // and the recent-notifications query. Older callers without the param
  // get the historical default behavior.
  const days = clampDays(c.req.query('days'), 30, 365);
  const now = Date.now();

  // L1 — per-isolate
  if (!fresh) {
    const l1Hit = l1.map.get(String(user.id));
    if (l1Hit && l1Hit.exp > now) {
      return c.json({ ...l1Hit.v, cached: 'l1' });
    }
    // L2 — KV (only attempt if binding exists; falls through to origin otherwise)
    if (c.env.TOKENS) {
      const kvHit = await kvGetJSON<any>(c.env.TOKENS, kvKey(user.id));
      if (kvHit) {
        l1.map.set(String(user.id), { v: kvHit, exp: now + L1_TTL_MS });
        return c.json({ ...kvHit, cached: 'kv' });
      }
    }
  }

  const sql = getSQL(c.env);
  const isAdmin = user.role === 'admin';
  // Phase 0.1: investors share dashboard view with partners (capital-allocator lens).
  const isInvestor = user.role === 'investor';
  const isPartner = user.role === 'partner' || isInvestor;
  const isFounder = user.role === 'founder';

  // Run all queries in parallel for speed (Cloudflare Workers loves this).
  // Each query is wrapped in safeQuery so one missing table cannot 500 the whole dashboard.
  const [
    deals, scoresMine, syndicatesAll, mySyndicateMemberships, marketplaceCount,
    monthEarnings, lifetimeEarnings, compoundEarnings, pendingPayouts,
    chainCounts, topReferrers, recentCommissions, earningsSeries, myTasks,
    notifications,
  ] = await Promise.all([
    safeQuery('deals', () =>
      isAdmin
        ? sql`SELECT id, name, sector, stage, status, score, ai_decision, created_at FROM projects WHERE status NOT IN ('rejected', 'archived') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 12`
        : isFounder
          ? sql`SELECT id, name, sector, stage, status, score, ai_decision, created_at FROM projects WHERE submitted_by = ${user.id} AND status NOT IN ('rejected', 'archived') AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 12`
          // Task #3 (Y-1) — investors get the founder_user_id JOIN so
          // the Trust Center mask can null sensitive fields when no
          // active pairwise NDA exists. Partners stay un-masked.
          : isInvestor
            ? sql`SELECT DISTINCT p.id, p.name, p.sector, p.stage, p.status, p.score, p.ai_decision, p.created_at, u.id AS founder_user_id FROM projects p LEFT JOIN match_scores ms ON ms.deal_id = p.id AND ms.user_id = ${user.id} LEFT JOIN users u ON u.founder_id = p.founder_id WHERE p.status NOT IN ('rejected', 'archived') AND p.deleted_at IS NULL AND (p.status IN ('tier_1', 'tier_2') OR ms.id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 12`
            : sql`SELECT DISTINCT p.id, p.name, p.sector, p.stage, p.status, p.score, p.ai_decision, p.created_at FROM projects p LEFT JOIN match_scores ms ON ms.deal_id = p.id AND ms.user_id = ${user.id} WHERE p.status NOT IN ('rejected', 'archived') AND p.deleted_at IS NULL AND (p.status IN ('tier_1', 'tier_2') OR ms.id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 12`,
      [] as any[]),
    safeQuery('scoresMine', () => sql`
      SELECT ms.*, p.name as deal_name, p.sector, p.stage
      FROM match_scores ms LEFT JOIN projects p ON p.id = ms.deal_id
      WHERE ms.user_id = ${user.id} ORDER BY ms.score DESC LIMIT 10
    `, [] as any[]),
    safeQuery('syndicatesAll', () => sql`
      SELECT s.id, s.name, s.description, s.target_cents, s.min_commitment_cents, s.created_at,
        (SELECT COUNT(*) FROM syndicate_members WHERE syndicate_id = s.id) as members,
        (SELECT COALESCE(SUM(commitment_cents), 0) FROM syndicate_members WHERE syndicate_id = s.id) as committed_cents
      FROM syndicates s WHERE s.status = 'open' ORDER BY s.created_at DESC LIMIT 8
    `, [] as any[]),
    safeQuery('mySyndicateMemberships', () => sql`
      SELECT sm.commitment_cents, sm.joined_at, s.id, s.name, s.status, s.target_cents
      FROM syndicate_members sm JOIN syndicates s ON s.id = sm.syndicate_id
      WHERE sm.user_id = ${user.id} ORDER BY sm.joined_at DESC LIMIT 10
    `, [] as any[]),
    safeQuery('marketplaceCount', () =>
      sql`SELECT COUNT(*) as n FROM marketplace_profiles WHERE availability = 'available'`,
      [{ n: 0 }] as any[]),
    safeQuery('monthEarnings', () =>
      sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', 'start of month')`,
      [{ c: 0 }] as any[]),
    safeQuery('lifetimeEarnings', () =>
      sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id}`,
      [{ c: 0 }] as any[]),
    safeQuery('compoundEarnings', () =>
      sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND source_type LIKE '%_compound'`,
      [{ c: 0 }] as any[]),
    safeQuery('pendingPayouts', () =>
      sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND status = 'accrued'`,
      [{ c: 0 }] as any[]),
    safeQuery('chainCounts', () =>
      sql`SELECT level, COUNT(*) as n FROM referral_chains WHERE root_referrer_id = ${user.id} GROUP BY level`,
      [] as any[]),
    safeQuery('topReferrers', () => sql`
      SELECT u.id, u.name, u.email, COUNT(DISTINCT rc.user_id) as downstream
      FROM referral_chains my_l1
      JOIN users u ON u.id = my_l1.user_id
      LEFT JOIN referral_chains rc ON rc.root_referrer_id = my_l1.user_id AND rc.level = 1
      WHERE my_l1.root_referrer_id = ${user.id} AND my_l1.level = 1
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(DISTINCT rc.user_id) > 0
      ORDER BY downstream DESC LIMIT 5
    `, [] as any[]),
    safeQuery('recentCommissions', () =>
      sql`SELECT id, amount_cents, source_type, description, status, created_at FROM commissions WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 10`,
      [] as any[]),
    safeQuery('earningsSeries', () => sql`
      SELECT DATE(created_at) as day, SUM(amount_cents) as cents
      FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', ${`-${days} days`})
      GROUP BY DATE(created_at) ORDER BY day
    `, [] as any[]),
    safeQuery('myTasks', () => sql`
      SELECT t.id, t.title, t.status, t.priority, t.due_date, w.title as workflow_title, w.type
      FROM workflow_tasks t JOIN workflows w ON w.id = t.workflow_id
      WHERE t.assignee_user_id = ${user.id} AND t.status != 'done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 10
    `, [] as any[]),
    safeQuery('notifications', () => sql`
      SELECT 'commission' as kind, id, description as title, amount_cents, created_at FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', '-7 days')
      UNION ALL
      SELECT 'syndicate' as kind, id, name as title, NULL as amount_cents, created_at FROM syndicates WHERE created_by != ${user.id} AND status = 'open' AND created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC LIMIT 12
    `, [] as any[]),
  ]);

  // Build chain counts map
  const chains: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
  for (const r of chainCounts as any[]) chains[`L${r.level}`] = r.n;
  const networkReach = chains.L1 + chains.L2 + chains.L3;

  // AI score average across my matches
  const scoresArr = (scoresMine as any[]).map(s => s.score).filter((n): n is number => typeof n === 'number');
  const aiScoreAvg = scoresArr.length ? Math.round(scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length) : null;

  // Personalized "AI-recommended syndicates" for partners — open syndicates whose deal_id has a high match_score for the user
  let recommendedSyndicates: any[] = [];
  if (isPartner || isAdmin) {
    recommendedSyndicates = await safeQuery('recommendedSyndicates', () => sql`
      SELECT s.id, s.name, s.description, s.target_cents, s.min_commitment_cents, ms.score, ms.explanation
      FROM syndicates s
      JOIN match_scores ms ON ms.deal_id = s.deal_id AND ms.user_id = ${user.id}
      WHERE s.status = 'open' AND s.created_by != ${user.id}
        AND s.id NOT IN (SELECT syndicate_id FROM syndicate_members WHERE user_id = ${user.id})
      ORDER BY ms.score DESC LIMIT 5
    `, [] as any[]);
  }

  try { await sql.end(); } catch {}

  // Task #3 (Y-1) — Trust Center mask. For investors only, run each
  // proprietary-deal-flow row through maskFounderForInvestor so any
  // founder/project payload is reduced to FOUNDER_PUBLIC_KEYS until
  // the pairwise NDA is active. Fail-closed: rows whose
  // founder_user_id couldn't be resolved are masked too.
  let dealsMasked: any[] = deals as any[];
  if (isInvestor) {
    dealsMasked = await Promise.all(
      (deals as any[]).map(row => maskFounderForInvestor(c.env, row, {
        viewerRole: 'investor',
        viewerUserId: user.id,
      })),
    );
  }

  // Audit dashboard view (admins only, low volume)
  if (isAdmin) {
    try { await c.env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, 'dashboard_view_admin', '{}', ?)`).bind(user.id).run(); } catch {}
  }

  // Build the day-series with zeros filled for the requested ?days window.
  const seriesMap = new Map<string, number>();
  for (const row of (earningsSeries as any[])) seriesMap.set(row.day, parseInt(row.cents) || 0);
  const today = new Date();
  const series: { day: string; cents: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, cents: seriesMap.get(key) || 0 });
  }

  const payload = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, kyc_status: user.kyc_status, assistant_enabled: (() => {
      // Mirror /api/assistant/* mount gate — see routes/auth.ts.
      const e = c.env as any;
      const prod = e?.STAGE === 'production' || e?.ENVIRONMENT === 'production';
      if (prod || e?.ENABLE_ANTHROPIC_DEV !== '1') return 0;
      return ((user as any).assistant_enabled ?? 0) ? 1 : 0;
    })() },
    quick_stats: {
      month_earnings_cents: parseInt((monthEarnings as any)[0]?.c) || 0,
      lifetime_earnings_cents: parseInt((lifetimeEarnings as any)[0]?.c) || 0,
      compound_earnings_cents: parseInt((compoundEarnings as any)[0]?.c) || 0,
      pending_payouts_cents: parseInt((pendingPayouts as any)[0]?.c) || 0,
      active_syndicates: (syndicatesAll as any[]).length,
      my_syndicates: (mySyndicateMemberships as any[]).length,
      ai_score_avg: aiScoreAvg,
      network_reach: networkReach,
      marketplace_available: parseInt((marketplaceCount as any)[0]?.n) || 0,
    },
    proprietary_deal_flow: dealsMasked,
    ai_scored_opportunities: scoresMine,
    syndication_tools: {
      open_syndicates: syndicatesAll,
      my_memberships: mySyndicateMemberships,
      ai_recommendations: recommendedSyndicates,
    },
    performance_analytics: {
      // Field name is historical (was hardcoded 30d). The actual length now
      // reflects the requested ?days window — see `window_days` below.
      earnings_series_30d: series,
      window_days: days,
      chain_counts: chains,
      network_reach: networkReach,
      top_referrers: topReferrers,
      recent_commissions: recentCommissions,
    },
    operator_workspace: {
      assigned_tasks: myTasks,
    },
    notifications,
    role_view: isAdmin ? 'admin' : isInvestor ? 'investor' : isPartner ? 'partner' : isFounder ? 'founder' : 'member',
    cached: false,
    generated_at: new Date().toISOString(),
  };

  // Write through both tiers. KV write is fire-and-forget via waitUntil so
  // the response stays fast; KV failure is logged but never blocks.
  l1.map.set(String(user.id), { v: payload, exp: Date.now() + L1_TTL_MS });
  if (c.env.TOKENS) {
    const ctx = (c.executionCtx as any);
    const writeP = kvPutJSON(c.env.TOKENS, kvKey(user.id), payload, KV_TTL_SEC);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(writeP); else void writeP;
  }
  return c.json(payload);
});

dashboard.post('/refresh-scores', async (c) => {
  const user = await requireAuth(c);
  // Invalidate both cache tiers for this user.
  l1.map.delete(String(user.id));
  if (c.env.TOKENS) await kvDelete(c.env.TOKENS, kvKey(user.id));
  return c.json({ ok: true, message: 'Cache cleared. Next fetch will re-aggregate.' });
});

// Task #81 — Investor deal lifecycle.
//
// A READ-ONLY aggregation that answers "what deals is THIS investor engaged
// with, and how far along?" for the investor deal desk on /studio. Every
// count is scoped to the caller's own user id (no cross-user leakage) and the
// route NEVER writes — in particular it must not touch watchlist/journal.
//
// The funnel stages (watching → intro → deal room → diligence → committed) are
// derived from the same tables their dedicated surfaces own:
//   watching   — watchlist_items (owner_user_id, status='watching')
//   intro      — investor_introductions (investor_user_id)
//   dealroom   — investor_dealroom_members (investor_user_id)
//   diligence  — dd_cases the investor owns OR reviews
//   committed  — decision_journal_entries (owner_user_id, decision='invest')
// Extra per-investor counts (IC engagement, recorded positions, open secondary
// listings) ride along in `counts` for the quick-stats row.
dashboard.get('/investor-lifecycle', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const n = (rows: any): number => {
    const r = Array.isArray(rows) ? rows[0] : null;
    return r ? parseInt((r as any).n, 10) || 0 : 0;
  };

  const [
    watching, watchlistTotal, intros, introsPending, dealrooms,
    ddTotal, ddOpen, icEngaged, committed, positions, listingsOpen,
  ] = await Promise.all([
    safeQuery('inv:watching', () => sql`SELECT COUNT(*) AS n FROM watchlist_items WHERE owner_user_id = ${user.id} AND status = 'watching'`, [{ n: 0 }]),
    safeQuery('inv:watchlistTotal', () => sql`SELECT COUNT(*) AS n FROM watchlist_items WHERE owner_user_id = ${user.id} AND status != 'archived'`, [{ n: 0 }]),
    safeQuery('inv:intros', () => sql`SELECT COUNT(*) AS n FROM investor_introductions WHERE investor_user_id = ${user.id}`, [{ n: 0 }]),
    safeQuery('inv:introsPending', () => sql`SELECT COUNT(*) AS n FROM investor_introductions WHERE investor_user_id = ${user.id} AND status = 'pending'`, [{ n: 0 }]),
    safeQuery('inv:dealrooms', () => sql`SELECT COUNT(*) AS n FROM investor_dealroom_members WHERE investor_user_id = ${user.id}`, [{ n: 0 }]),
    safeQuery('inv:ddTotal', () => sql`SELECT COUNT(*) AS n FROM dd_cases WHERE owner_user_id = ${user.id} OR id IN (SELECT case_id FROM dd_reviewers WHERE user_id = ${user.id})`, [{ n: 0 }]),
    safeQuery('inv:ddOpen', () => sql`SELECT COUNT(*) AS n FROM dd_cases WHERE (owner_user_id = ${user.id} OR id IN (SELECT case_id FROM dd_reviewers WHERE user_id = ${user.id})) AND status IN ('open', 'in_review')`, [{ n: 0 }]),
    safeQuery('inv:icEngaged', () => sql`SELECT COUNT(DISTINCT d.id) AS n FROM ic_decisions d LEFT JOIN ic_votes v ON v.ic_decision_id = d.id WHERE d.created_by = ${user.id} OR v.user_id = ${user.id}`, [{ n: 0 }]),
    safeQuery('inv:committed', () => sql`SELECT COUNT(*) AS n FROM decision_journal_entries WHERE owner_user_id = ${user.id} AND decision = 'invest'`, [{ n: 0 }]),
    safeQuery('inv:positions', () => sql`SELECT COUNT(*) AS n FROM portfolio_positions WHERE created_by = ${user.id}`, [{ n: 0 }]),
    safeQuery('inv:listingsOpen', () => sql`SELECT COUNT(*) AS n FROM secondary_listings WHERE user_id = ${user.id} AND status IN ('open', 'listed', 'matched')`, [{ n: 0 }]),
  ]);

  // Task #83 — open DD reviewer items assigned to THIS investor feed the
  // lifecycle module's next-actions. Scoped to `assignee_user_id = user` (no
  // cross-user leakage) and only for cases that are still open/in-review.
  const reviewerRows = await safeQuery('inv:ddNextActions', () => sql`
    SELECT s.title AS section_title, c.uid AS case_uid, c.subject_label AS subject_label
      FROM dd_sections s
      JOIN dd_cases c ON c.id = s.case_id
     WHERE s.assignee_user_id = ${user.id}
       AND s.status IN ('pending', 'assigned', 'in_review')
       AND c.status IN ('open', 'in_review')
     ORDER BY s.updated_at DESC
     LIMIT 5`, [] as any[]);

  try { await sql.end(); } catch {}

  const nextActions = (Array.isArray(reviewerRows) ? reviewerRows : []).map((r: any) => ({
    key: `dd:${r.case_uid}:${r.section_title}`,
    label: `Review ${r.section_title} — ${r.subject_label}`,
    href: `/due-diligence/${r.case_uid}`,
    done: false,
    manual: false,
  }));

  const counts = {
    watching: n(watching),
    watchlist_total: n(watchlistTotal),
    intros: n(intros),
    intros_pending: n(introsPending),
    dealrooms: n(dealrooms),
    dd_total: n(ddTotal),
    dd_open: n(ddOpen),
    ic_engaged: n(icEngaged),
    committed: n(committed),
    positions: n(positions),
    listings_open: n(listingsOpen),
  };

  // Ordered funnel. `href` deep-links to the surface that moves the stage.
  const stages = [
    { id: 'watching', label: 'Watching', count: counts.watching, reached: counts.watching > 0, href: '/watchlist' },
    { id: 'intro', label: 'Warm intro', count: counts.intros, reached: counts.intros > 0, href: '/deals' },
    { id: 'dealroom', label: 'Deal room', count: counts.dealrooms, reached: counts.dealrooms > 0, href: '/deals' },
    { id: 'diligence', label: 'Diligence', count: counts.dd_total, reached: counts.dd_total > 0, href: '/due-diligence' },
    { id: 'committed', label: 'Committed', count: counts.committed, reached: counts.committed > 0, href: '/watchlist' },
  ];

  // Current stage = the deepest one with any activity (falls back to the first).
  let currentStage = stages[0].id;
  for (const s of stages) if (s.reached) currentStage = s.id;

  return c.json({
    stages,
    current_stage: currentStage,
    next_actions: nextActions,
    counts,
    generated_at: new Date().toISOString(),
  });
});

export default dashboard;
