import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const dashboard = new Hono<{ Bindings: Env }>();

// Lightweight in-memory cache: { userId -> {data, expires} }
const CACHE_TTL_MS = 30_000;
const cache = new Map<number, { data: any; expires: number }>();

dashboard.get('/', async (c) => {
  const user = await requireAuth(c);
  const fresh = c.req.query('fresh') === '1';
  const cached = cache.get(user.id);
  if (!fresh && cached && cached.expires > Date.now()) {
    return c.json({ ...cached.data, cached: true });
  }

  const sql = getSQL(c.env);
  const isAdmin = user.role === 'admin';
  const isPartner = user.role === 'partner';
  const isFounder = user.role === 'founder';

  // Run all queries in parallel for speed (Cloudflare Workers loves this)
  const [
    deals, scoresMine, syndicatesAll, mySyndicateMemberships, marketplaceCount,
    monthEarnings, lifetimeEarnings, compoundEarnings, pendingPayouts,
    chainCounts, topReferrers, recentCommissions, earningsSeries, myTasks,
    notifications,
  ] = await Promise.all([
    // Recent deal flow — RBAC-scoped:
    // - admin: all active deals
    // - founder: only their own submitted projects
    // - partner: only deals they have a match_score on, plus tier_1/tier_2 (publicly investable)
    isAdmin
      ? sql`SELECT id, name, sector, stage, status, score, ai_decision, created_at FROM projects WHERE status NOT IN ('rejected', 'archived') ORDER BY created_at DESC LIMIT 12`
      : isFounder
        ? sql`SELECT id, name, sector, stage, status, score, ai_decision, created_at FROM projects WHERE submitted_by = ${user.id} AND status NOT IN ('rejected', 'archived') ORDER BY created_at DESC LIMIT 12`
        : sql`SELECT DISTINCT p.id, p.name, p.sector, p.stage, p.status, p.score, p.ai_decision, p.created_at FROM projects p LEFT JOIN match_scores ms ON ms.deal_id = p.id AND ms.user_id = ${user.id} WHERE p.status NOT IN ('rejected', 'archived') AND (p.status IN ('tier_1', 'tier_2') OR ms.id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 12`,
    // My top match scores (any score_type)
    sql`
      SELECT ms.*, p.name as deal_name, p.sector, p.stage
      FROM match_scores ms LEFT JOIN projects p ON p.id = ms.deal_id
      WHERE ms.user_id = ${user.id} ORDER BY ms.score DESC LIMIT 10
    `,
    // Open syndicates (user can join)
    sql`
      SELECT s.id, s.name, s.description, s.target_cents, s.min_commitment_cents, s.created_at,
        (SELECT COUNT(*) FROM syndicate_members WHERE syndicate_id = s.id) as members,
        (SELECT COALESCE(SUM(commitment_cents), 0) FROM syndicate_members WHERE syndicate_id = s.id) as committed_cents
      FROM syndicates s WHERE s.status = 'open' ORDER BY s.created_at DESC LIMIT 8
    `,
    // My syndicate memberships
    sql`
      SELECT sm.commitment_cents, sm.joined_at, s.id, s.name, s.status, s.target_cents
      FROM syndicate_members sm JOIN syndicates s ON s.id = sm.syndicate_id
      WHERE sm.user_id = ${user.id} ORDER BY sm.joined_at DESC LIMIT 10
    `,
    // Marketplace size
    sql`SELECT COUNT(*) as n FROM marketplace_profiles WHERE availability = 'available'`,
    // This month's earnings
    sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', 'start of month')`,
    // Lifetime
    sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id}`,
    // Compounding
    sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND source_type LIKE '%_compound'`,
    // Pending payouts (accrued not yet paid)
    sql`SELECT COALESCE(SUM(amount_cents), 0) as c FROM commissions WHERE user_id = ${user.id} AND status = 'accrued'`,
    // Network reach
    sql`SELECT level, COUNT(*) as n FROM referral_chains WHERE root_referrer_id = ${user.id} GROUP BY level`,
    // Top referrers in MY chain — for each L1 referral I made, count their distinct downstream people
    sql`
      SELECT u.id, u.name, u.email, COUNT(DISTINCT rc.user_id) as downstream
      FROM referral_chains my_l1
      JOIN users u ON u.id = my_l1.user_id
      LEFT JOIN referral_chains rc ON rc.root_referrer_id = my_l1.user_id AND rc.level = 1
      WHERE my_l1.root_referrer_id = ${user.id} AND my_l1.level = 1
      GROUP BY u.id, u.name, u.email
      HAVING COUNT(DISTINCT rc.user_id) > 0
      ORDER BY downstream DESC LIMIT 5
    `,
    // Recent commissions
    sql`SELECT id, amount_cents, source_type, description, status, created_at FROM commissions WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 10`,
    // Earnings over last 30 days, daily buckets
    sql`
      SELECT DATE(created_at) as day, SUM(amount_cents) as cents
      FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at) ORDER BY day
    `,
    // My open Studio Ops tasks (operators/advisors care about this)
    sql`
      SELECT t.id, t.title, t.status, t.priority, t.due_date, w.title as workflow_title, w.type
      FROM workflow_tasks t JOIN workflows w ON w.id = t.workflow_id
      WHERE t.assignee_user_id = ${user.id} AND t.status != 'done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 10
    `,
    // Notifications: recent activity affecting this user (commissions accrued, new syndicates with their deal interests, intro requests)
    sql`
      SELECT 'commission' as kind, id, description as title, amount_cents, created_at FROM commissions WHERE user_id = ${user.id} AND created_at >= datetime('now', '-7 days')
      UNION ALL
      SELECT 'syndicate' as kind, id, name as title, NULL as amount_cents, created_at FROM syndicates WHERE created_by != ${user.id} AND status = 'open' AND created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC LIMIT 12
    `,
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
    recommendedSyndicates = await sql`
      SELECT s.id, s.name, s.description, s.target_cents, s.min_commitment_cents, ms.score, ms.explanation
      FROM syndicates s
      JOIN match_scores ms ON ms.deal_id = s.deal_id AND ms.user_id = ${user.id}
      WHERE s.status = 'open' AND s.created_by != ${user.id}
        AND s.id NOT IN (SELECT syndicate_id FROM syndicate_members WHERE user_id = ${user.id})
      ORDER BY ms.score DESC LIMIT 5
    `;
  }

  await sql.end();

  // Audit dashboard view (admins only, low volume)
  if (isAdmin) {
    try { await c.env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, 'dashboard_view_admin', '{}', ?)`).bind(user.id).run(); } catch {}
  }

  // Build a 30-day series with zeros filled
  const seriesMap = new Map<string, number>();
  for (const row of (earningsSeries as any[])) seriesMap.set(row.day, parseInt(row.cents) || 0);
  const today = new Date();
  const series: { day: string; cents: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ day: key, cents: seriesMap.get(key) || 0 });
  }

  const payload = {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, kyc_status: user.kyc_status },
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
    proprietary_deal_flow: deals,
    ai_scored_opportunities: scoresMine,
    syndication_tools: {
      open_syndicates: syndicatesAll,
      my_memberships: mySyndicateMemberships,
      ai_recommendations: recommendedSyndicates,
    },
    performance_analytics: {
      earnings_series_30d: series,
      chain_counts: chains,
      network_reach: networkReach,
      top_referrers: topReferrers,
      recent_commissions: recentCommissions,
    },
    operator_workspace: {
      assigned_tasks: myTasks,
    },
    notifications,
    role_view: isAdmin ? 'admin' : isPartner ? 'partner' : isFounder ? 'founder' : 'member',
    cached: false,
    generated_at: new Date().toISOString(),
  };

  cache.set(user.id, { data: payload, expires: Date.now() + CACHE_TTL_MS });
  return c.json(payload);
});

dashboard.post('/refresh-scores', async (c) => {
  const user = await requireAuth(c);
  // Invalidate cache for this user; client will get fresh on next fetch
  cache.delete(user.id);
  return c.json({ ok: true, message: 'Cache cleared. Next fetch will re-aggregate.' });
});

export default dashboard;
