import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const capital = new Hono<{ Bindings: Env }>();

capital.get('/investors', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM lp_investors ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

capital.post('/investors', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const [inv] = await sql`INSERT INTO lp_investors (name, email, committed_capital, fund_name) VALUES (${data.name}, ${data.email}, ${data.committed_capital || 0}, ${data.fund_name || null}) RETURNING *`;
  await sql.end();
  return c.json(inv, 201);
});

capital.get('/investors/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const invs = await sql`SELECT * FROM lp_investors WHERE id = ${id}`;
  if (invs.length === 0) { await sql.end(); return c.json({ error: 'Investor not found' }, 404); }
  const calls = await sql`SELECT * FROM capital_calls WHERE lp_investor_id = ${id}`;
  await sql.end();
  return c.json({ ...invs[0], capital_calls: calls });
});

capital.post('/calls', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const inv = await sql`SELECT id FROM lp_investors WHERE id = ${data.lp_investor_id}`;
  if (inv.length === 0) { await sql.end(); return c.json({ error: 'Investor not found' }, 404); }
  const [call] = await sql`INSERT INTO capital_calls (lp_investor_id, project_id, amount, due_date) VALUES (${data.lp_investor_id}, ${data.project_id || null}, ${data.amount}, ${data.due_date || null}) RETURNING *`;
  await sql.end();
  return c.json(call, 201);
});

capital.get('/calls', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const rows = status
    ? await sql`SELECT * FROM capital_calls WHERE status = ${status} ORDER BY created_at DESC`
    : await sql`SELECT * FROM capital_calls ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

capital.post('/calls/:id/pay', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const calls = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  if (calls.length === 0) { await sql.end(); return c.json({ error: 'Capital call not found' }, 404); }
  await sql`UPDATE capital_calls SET status = 'paid', paid_date = date('now') WHERE id = ${id}`;
  await sql`UPDATE lp_investors SET called_capital = called_capital + ${calls[0].amount} WHERE id = ${calls[0].lp_investor_id}`;
  const [updated] = await sql`SELECT * FROM capital_calls WHERE id = ${id}`;
  await sql.end();
  return c.json({ status: 'paid', call: updated });
});

capital.post('/capitalCall', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE id = ${data.startup_id}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Startup/project not found' }, 404); }

  const investors = await sql`SELECT * FROM lp_investors WHERE status = 'active'`;
  if (investors.length === 0) { await sql.end(); return c.json({ error: 'No active investors found' }, 404); }

  const perInvestor = data.amount / investors.length;
  const callsCreated = [];
  for (const inv of investors) {
    await sql`INSERT INTO capital_calls (lp_investor_id, project_id, amount) VALUES (${inv.id}, ${data.startup_id}, ${Math.round(perInvestor * 100) / 100})`;
    callsCreated.push({ investor_id: inv.id, investor_name: inv.name, amount: Math.round(perInvestor * 100) / 100 });
  }

  const allPartners = await sql`SELECT * FROM partners WHERE status = 'active'`;
  await sql.end();

  const participating = allPartners.filter((p: any) => p.specialization && projects[0].sector && projects[0].sector.toLowerCase().includes(p.specialization.toLowerCase().split(',')[0]?.trim()));

  return c.json({
    startup_id: data.startup_id, startup_name: projects[0].name, total_amount: data.amount,
    calls_created: callsCreated,
    participating_partners: participating.map((p: any) => ({ partner_id: p.id, name: p.name, company: p.company, specialization: p.specialization })),
  });
});

capital.get('/portfolio', async (c) => {
  await requireAuth(c);
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE status IN ('spinout', 'active', 'tier_1', 'tier_2')`;
  const portfolio = [];
  for (const p of projects) {
    const scores = await sql`SELECT total_score, tier FROM score_snapshots WHERE project_id = ${p.id} ORDER BY created_at DESC LIMIT 1`;
    portfolio.push({ id: p.id, name: p.name, sector: p.sector, status: p.status, playbook_week: p.playbook_week, score: scores[0]?.total_score || null, tier: scores[0]?.tier || null, revenue: p.revenue, users: p.users_count });
  }
  const committed = await sql`SELECT COALESCE(SUM(committed_capital), 0) as total FROM lp_investors`;
  const called = await sql`SELECT COALESCE(SUM(called_capital), 0) as total FROM lp_investors`;
  await sql.end();
  return c.json({ projects: portfolio, total_projects: portfolio.length, fund_metrics: { total_committed: committed[0].total, total_called: called[0].total } });
});

export default capital;
