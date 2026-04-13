import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { runFullScore } from '../services/scoring';

const projects = new Hono<{ Bindings: Env }>();

projects.get('/', async (c) => {
  await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const rows = status
    ? await sql`SELECT * FROM projects WHERE status = ${status} ORDER BY created_at DESC`
    : await sql`SELECT * FROM projects ORDER BY created_at DESC`;
  await sql.end();
  return c.json(rows);
});

projects.get('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  let founder = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }
  await sql.end();
  return c.json({ ...project, founder });
});

projects.post('/', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);

  let founderId = null;
  if (data.founder_email) {
    const existing = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
    if (existing.length > 0) {
      founderId = existing[0].id;
    } else {
      const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name || 'Unknown'}, ${data.founder_email}) RETURNING id`;
      founderId = f.id;
    }
  }

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, ${data.stage || 'idea'}, ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;

  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, 'applied')`;
  await sql`INSERT INTO activity_logs (project_id, action, details) VALUES (${project.id}, 'project_created', ${`Project '${project.name}' submitted`})`;
  await sql.end();
  return c.json(project, 201);
});

projects.post('/submit', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);

  const existingFounders = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  let founderId: number;
  if (existingFounders.length > 0) {
    founderId = existingFounders[0].id;
  } else {
    const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name}, ${data.founder_email}) RETURNING id`;
    founderId = f.id;
  }

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, 'idea', ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;

  const result = runFullScore(data);
  const b = result.breakdown;

  const [snapshot] = await sql`INSERT INTO score_snapshots (project_id, total_score, tier, market_size, market_urgency, market_trend, market_total, team_expertise, team_execution, team_network, team_total, product_mvp_time, product_complexity, product_dependency, product_total, capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total, fit_alignment, fit_synergy, fit_total, distribution_channels, distribution_virality, distribution_total, ai_adjustment, scored_by) VALUES (${project.id}, ${result.total_score}, ${result.tier}, ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total}, ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total}, ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total}, ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total}, ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total}, ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total}, 0, 'auto') RETURNING *`;

  let newStatus = 'rejected', dealStatus = 'rejected', newStage = project.stage;
  if (result.total_score >= 85) { newStatus = 'tier_1'; newStage = 'build'; dealStatus = 'active'; }
  else if (result.total_score >= 70) { newStatus = 'tier_2'; dealStatus = 'scored'; }

  await sql`UPDATE projects SET status = ${newStatus}, stage = ${newStage}, updated_at = CURRENT_TIMESTAMP WHERE id = ${project.id}`;
  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, ${dealStatus})`;
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project.id}, 'auto_scored', ${`Score: ${result.total_score}, Tier: ${result.tier}, Status: ${newStatus}`}, 'system')`;
  await sql.end();

  return c.json({
    project: { ...project, status: newStatus, stage: newStage },
    score: result,
    auto_decision: { status: newStatus, stage: newStage, tier: result.tier, tier_label: result.tier_label },
  });
});

projects.put('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);

  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }

  const fields = ['name', 'description', 'sector', 'stage', 'status', 'playbook_week', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'users_count', 'revenue', 'growth_signals', 'cost_to_mvp', 'funding_needed', 'use_of_funds'];
  const updates: string[] = [];
  const values: any[] = [];

  for (const f of fields) {
    if (data[f] !== undefined) { updates.push(`${f} = ?`); values.push(data[f]); }
  }
  if (updates.length > 0) {
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    await sql.unsafe(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

projects.delete('/:id', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  return c.json({ ok: true });
});

projects.post('/:id/advance-week', async (c) => {
  await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }

  const order = ['week_1', 'week_2', 'week_3', 'week_4', 'complete'];
  const idx = order.indexOf(rows[0].playbook_week);
  if (idx >= 0 && idx < order.length - 1) {
    await sql`UPDATE projects SET playbook_week = ${order[idx + 1]}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  }
  const [updated] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  await sql.end();
  return c.json(updated);
});

export default projects;
