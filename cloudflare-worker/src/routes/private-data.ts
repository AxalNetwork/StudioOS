import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { MARKET_PULSE, STUDIO_BENCHMARKS } from './market-intel';

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
  if (user.role !== 'admin' && user.role !== 'partner') return c.json({ error: 'Insufficient permissions' }, 403);

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
    const projects = user.founder_id
      ? await sql`SELECT p.*, s.total_score, s.tier FROM projects p LEFT JOIN LATERAL (SELECT total_score, tier FROM score_snapshots WHERE project_id = p.id ORDER BY created_at DESC LIMIT 1) s ON true WHERE p.founder_id = ${user.founder_id}`
      : [];
    await sql.end();
    return c.json({ role: 'founder', projects, total_projects: projects.length });
  }

  if (user.role === 'partner') {
    const deals = user.partner_id ? await sql`SELECT d.*, p.name as project_name, p.sector FROM deals d LEFT JOIN projects p ON d.project_id = p.id WHERE d.partner_id = ${user.partner_id} ORDER BY d.created_at DESC` : [];
    const committed = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
    const called = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
    const portfolio = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
    await sql.end();

    const tvpi = parseFloat(called[0].total) > 0 ? Math.round(parseFloat(committed[0].total) / parseFloat(called[0].total) * 100) / 100 : 0;
    return c.json({ role: 'partner', deals, total_deals: deals.length, active_deals: deals.filter((d: any) => ['applied', 'scored', 'active'].includes(d.status)).length, fund_metrics: { total_committed: parseFloat(committed[0].total), total_called: parseFloat(called[0].total), tvpi, portfolio_companies: portfolio.length }, portfolio });
  }

  const allProjects = await sql`SELECT * FROM projects`;
  const active = allProjects.filter((p: any) => ['spinout', 'active', 'tier_1', 'tier_2'].includes(p.status));
  const committed = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
  const called = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
  const totalDeals = await sql`SELECT COUNT(*) as count FROM deals`;
  const activeDeals = await sql`SELECT COUNT(*) as count FROM deals WHERE status IN ('applied', 'scored', 'active')`;
  await sql.end();

  return c.json({ role: 'admin', overview: { total_projects: allProjects.length, active_projects: active.length, total_deals: parseInt(totalDeals[0].count), active_deals: parseInt(activeDeals[0].count), total_committed: parseFloat(committed[0].total), total_called: parseFloat(called[0].total) }, portfolio: active });
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
