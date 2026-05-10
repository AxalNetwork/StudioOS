import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { MARKET_PULSE, STUDIO_BENCHMARKS } from './market_intel';

const privateData = new Hono<{ Bindings: Env }>();

privateData.get('/profile', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const result: any = { id: user.id, uid: user.uid, email: user.email, name: user.name, role: user.role, is_active: user.is_active, email_verified: user.email_verified, created_at: user.created_at };

  if (user.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${user.founder_id}`;
    if (f.length > 0) result.founder_profile = f[0];
  }
  if (user.partner_id) {
    const p = await sql`SELECT * FROM partners WHERE id = ${user.partner_id}`;
    if (p.length > 0) result.partner_profile = p[0];
  }
  await sql.end();
  return c.json(result);
});

privateData.get('/market/private-signals', async (c) => {
  const user = await requireAuth(c);
  if (user.role !== 'admin' && user.role !== 'partner' && user.role !== 'investor') return c.json({ error: 'Insufficient permissions' }, 403);

  const signals = MARKET_PULSE.map(s => {
    let conviction = 'neutral';
    if (s.sentiment === 'Aggressive' && s.multiple > 20) conviction = 'aggressive';
    else if (s.sentiment === 'Wait-and-See' || s.multiple < 15) conviction = 'wait-and-see';
    return { sector: s.sector, revenue_multiple: s.multiple, sentiment: s.sentiment, conviction, hiring_signal: s.hiring_surge, technographic_signal: s.technographic_signal, gap_opportunity: s.gap_opportunity };
  });

  const aggressive = signals.filter(s => s.conviction === 'aggressive').length;
  const cautious = signals.filter(s => s.conviction === 'wait-and-see').length;

  return c.json({ global_conviction: aggressive > cautious ? 'Aggressive' : 'Wait-and-See', signals, studio_benchmarks: STUDIO_BENCHMARKS, updated_at: new Date().toISOString() });
});

privateData.get('/portfolio/metrics', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);

  if (user.role === 'founder') {
    // Founders see only OFFICIAL, APPROVED, hash-verified snapshots — sandbox
    // runs are practice and a flagged run reads as "no score yet" until admin
    // signs off. Goes through getVerifiedLatestSnapshot so reads are audited.
    const baseProjects = user.founder_id
      ? await sql`SELECT * FROM projects WHERE founder_id = ${user.founder_id}`
      : [];
    const { getVerifiedLatestSnapshot } = await import('../services/scoreIntegrity');
    const projects = await Promise.all(
      baseProjects.map(async (p: any) => {
        const verified = await getVerifiedLatestSnapshot(c.env, p.id, {
          role: user.role,
          founderId: user.founder_id ?? null,
          ownerFounderId: p.founder_id ?? null,
          userId: user.id ?? null,
        });
        return { ...p, total_score: verified?.row.total_score ?? null, tier: verified?.row.tier ?? null };
      }),
    );
    await sql.end();
    return c.json({ role: 'founder', projects, total_projects: projects.length });
  }

  if (user.role === 'partner' || user.role === 'investor') {
    // Preserve the actual role label so the UI can divergence partner vs
    // investor surfaces (architect feedback — no role flattening).
    const roleLabel = user.role;
    const deals = user.partner_id ? await sql`SELECT d.*, p.name as project_name, p.sector FROM deals d LEFT JOIN projects p ON d.project_id = p.id WHERE d.partner_id = ${user.partner_id} ORDER BY d.created_at DESC` : [];
    const committed = await sql`SELECT COALESCE(SUM(commitment_amount), 0) as total FROM limited_partners`;
    const called = await sql`SELECT COALESCE(SUM(invested_amount), 0) as total FROM limited_partners`;
    // Task #3 (Y-1) — pull founder_user_id alongside each portfolio
    // project so maskFounderForInvestor() can gate sensitive fields per
    // investor↔founder pair. Investors with no active pairwise NDA see
    // only {id, name, sector, stage, headline}; founders/admins/partners
    // are unaffected (mask is a no-op outside the investor role).
    const portfolioRaw = await sql`
      SELECT p.*, u.id AS founder_user_id
        FROM projects p
        LEFT JOIN users u ON u.founder_id = p.founder_id
       WHERE p.status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
    await sql.end();
    let portfolio: any[] = portfolioRaw as any[];
    if (user.role === 'investor') {
      const { maskFounderForInvestor } = await import('../services/trust');
      portfolio = await Promise.all(
        portfolioRaw.map((p: any) => maskFounderForInvestor(c.env, p, { viewerRole: 'investor', viewerUserId: user.id })),
      );
    }
    // (re-open inside metrics calc below — `portfolio` is the masked list)
    const portfolioCount = portfolio.length;

    const tvpi = Number(called[0].total) > 0 ? Math.round(Number(committed[0].total) / Number(called[0].total) * 100) / 100 : 0;
    return c.json({ role: roleLabel, deals, total_deals: deals.length, active_deals: deals.filter((d: any) => ['applied', 'scored', 'active'].includes(d.status)).length, fund_metrics: { total_committed: Number(committed[0].total), total_called: Number(called[0].total), tvpi, portfolio_companies: portfolioCount }, portfolio });
  }

  const allProjects = await sql`SELECT * FROM projects`;
  const active = allProjects.filter((p: any) => ['spinout', 'active', 'tier_1', 'tier_2'].includes(p.status));
  const committed = await sql`SELECT COALESCE(SUM(commitment_amount), 0) as total FROM limited_partners`;
  const called = await sql`SELECT COALESCE(SUM(invested_amount), 0) as total FROM limited_partners`;
  const totalDeals = await sql`SELECT COUNT(*) as count FROM deals`;
  const activeDeals = await sql`SELECT COUNT(*) as count FROM deals WHERE status IN ('applied', 'scored', 'active')`;
  await sql.end();

  return c.json({ role: 'admin', overview: { total_projects: allProjects.length, active_projects: active.length, total_deals: Number(totalDeals[0].count), active_deals: Number(activeDeals[0].count), total_committed: Number(committed[0].total), total_called: Number(called[0].total) }, portfolio: active });
});

privateData.get('/founder/:userId', async (c) => {
  const user = await requireAuth(c);
  const userId = parseInt(c.req.param('userId'));
  if (user.role !== 'admin' && user.id !== userId) return c.json({ error: 'Access denied' }, 403);

  const sql = getSQL(c.env);
  const target = await sql`SELECT * FROM users WHERE id = ${userId}`;
  if (target.length === 0 || target[0].role !== 'founder') { await sql.end(); return c.json({ error: 'Founder not found' }, 404); }

  const projects = target[0].founder_id
    ? await sql`SELECT * FROM projects WHERE founder_id = ${target[0].founder_id}`
    : [];
  await sql.end();
  return c.json({ role: 'founder', projects, total_projects: projects.length });
});

export default privateData;
