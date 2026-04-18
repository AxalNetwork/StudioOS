import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';
import { runFullScore, tierLabel } from '../services/scoring';
import { autoCreateStudioOpsForProject } from './studioops';

const scoring = new Hono<{ Bindings: Env }>();

scoring.post('/score', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json();
  const result = runFullScore(body);

  if (body.project_id) {
    const sql = getSQL(c.env);
    const projects = await sql`SELECT * FROM projects WHERE id = ${body.project_id}`;
    if (projects.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
    // IDOR guard: founders may only score their own project; partner/admin can score any.
    if (!canAccessFounderResource(user, projects[0].founder_id)) {
      await sql.end();
      return c.json({ error: 'Forbidden' }, 403);
    }

    const b = result.breakdown;
    const [snapshot] = await sql`INSERT INTO score_snapshots (project_id, total_score, tier, market_size, market_urgency, market_trend, market_total, team_expertise, team_execution, team_network, team_total, product_mvp_time, product_complexity, product_dependency, product_total, capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total, fit_alignment, fit_synergy, fit_total, distribution_channels, distribution_virality, distribution_total, ai_adjustment) VALUES (${body.project_id}, ${result.total_score}, ${result.tier}, ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total}, ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total}, ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total}, ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total}, ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total}, ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total}, ${result.ai_adjustment}) RETURNING id`;

    const newStatus = result.total_score >= 85 ? 'tier_1' : result.total_score >= 70 ? 'tier_2' : 'rejected';
    const prevStatus = projects[0].status;
    await sql`UPDATE projects SET status = ${newStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${body.project_id}`;
    await sql.end();
    if (newStatus !== prevStatus && (newStatus === 'tier_1' || newStatus === 'tier_2')) {
      await autoCreateStudioOpsForProject(c.env, body.project_id, newStatus, user.id);
    }
    return c.json({ ...result, snapshot_id: snapshot.id });
  }

  return c.json(result);
});

scoring.post('/score/:projectId/deal-memo', async (c) => {
  // Memo creation is partner/admin only — founders can never generate one against any project.
  const user = await requireRole(c, 'partner');
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);

  const projects = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projects[0];

  const snapshots = await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  if (snapshots.length === 0) { await sql.end(); return c.json({ error: 'No score found. Run scoring first.' }, 404); }
  const snapshot = snapshots[0];

  let founderName = 'Unknown';
  if (project.founder_id) {
    const founders = await sql`SELECT name FROM founders WHERE id = ${project.founder_id}`;
    if (founders.length > 0) founderName = founders[0].name;
  }

  const decision = snapshot.tier === 'TIER_1' ? 'INVEST / SPINOUT' : snapshot.tier === 'TIER_2' ? 'CONDITIONAL' : 'PASS';

  const [memo] = await sql`INSERT INTO deal_memos (project_id, score_snapshot_id, startup_name, founders, sector, stage, total_score, tier, problem, solution, why_now, users, revenue_info, growth_signals, cost_to_mvp, funding_needed, use_of_funds, decision) VALUES (${project.id}, ${snapshot.id}, ${project.name}, ${founderName}, ${project.sector}, ${project.stage}, ${snapshot.total_score}, ${snapshot.tier}, ${project.problem_statement}, ${project.solution}, ${project.why_now}, ${project.users_count?.toString() || null}, ${project.revenue?.toString() || null}, ${project.growth_signals}, ${project.cost_to_mvp?.toString() || null}, ${project.funding_needed?.toString() || null}, ${project.use_of_funds}, ${decision}) RETURNING *`;
  await sql.end();

  return c.json({
    id: memo.id, startup_name: memo.startup_name, founders: memo.founders,
    sector: memo.sector, stage: memo.stage, score: memo.total_score,
    tier: memo.tier, tier_label: tierLabel(memo.tier),
    problem: memo.problem, solution: memo.solution, why_now: memo.why_now,
    traction: { users: memo.users, revenue: memo.revenue_info, growth_signals: memo.growth_signals },
    economics: { cost_to_mvp: memo.cost_to_mvp, funding_needed: memo.funding_needed, use_of_funds: memo.use_of_funds },
    axal_fit: { strategic_alignment: memo.strategic_alignment, partner_synergies: memo.partner_synergies },
    risks: memo.risks, decision: memo.decision,
    terms: { amount: memo.terms_amount, equity: memo.terms_equity, structure: memo.terms_structure },
  });
});

scoring.get('/scores/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);
  // IDOR guard: a founder can only see scores for their own project.
  const owners = await sql`SELECT founder_id FROM projects WHERE id = ${projectId}`;
  if (owners.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  if (!canAccessFounderResource(user as any, owners[0].founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  const snapshots = await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(snapshots);
});

scoring.get('/deal-memos/:projectId', async (c) => {
  await requireRole(c, 'partner');
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);
  const memos = await sql`SELECT * FROM deal_memos WHERE project_id = ${projectId} ORDER BY created_at DESC`;
  await sql.end();
  return c.json(memos);
});

scoring.get('/queue', async (c) => {
  await requireRole(c, 'partner');
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE status IN ('intake', 'scoring') ORDER BY created_at DESC`;
  await sql.end();
  return c.json(projects);
});

scoring.post('/generateMemo', async (c) => {
  await requireRole(c, 'partner');
  const data = await c.req.json();
  return c.json({
    startup_name: data.startup_name, ai_generated: false,
    memo: {
      problem_analysis: `${data.startup_name || 'Unknown'} is addressing: ${data.problem || 'N/A'}. The ${data.sector || 'technology'} sector presents a market opportunity.`,
      solution_assessment: `Proposed solution: ${data.solution || 'N/A'}. Requires further technical diligence.`,
      traction_summary: data.traction || 'Early stage — pre-traction.',
      risk_assessment: ['Market timing and competitive dynamics need validation', 'Team execution capability requires further assessment', 'Capital efficiency needs detailed burn analysis'],
      decision: 'CONDITIONAL — requires deeper diligence on team and market validation',
      key_insight: `The ${data.sector || 'technology'} opportunity warrants exploration given current market dynamics.`,
    },
  });
});

export default scoring;
