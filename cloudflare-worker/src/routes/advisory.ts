import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';

const advisory = new Hono<{ Bindings: Env }>();

const TEMPLATES: Record<string, string> = {
  gtm: 'Based on the {sector} sector, consider: 1) Product-led growth targeting early adopters, 2) Partnership-driven distribution through complementary APIs, 3) Content marketing establishing thought leadership in {sector}.',
  fundraising: 'For a {stage} startup in {sector}: Target $500K-$2M at $5M-$15M pre-money. Lead with traction metrics. Use SAFE notes for speed.',
  product: 'Focus on: 1) Core value proposition validation (30 days), 2) Usage analytics implementation, 3) Feature prioritization via customer feedback loops.',
  team: 'Hiring priorities for {stage}: 1) Technical co-founder if missing, 2) First sales hire for B2B, 3) Product designer for B2C.',
  general: 'Key strategic considerations: 1) Validate product-market fit before scaling, 2) Build measurable growth loops, 3) Maintain 18-month runway minimum.',
};

advisory.post('/ask', async (c) => {
  const user = await requireAuth(c);
  const data = await c.req.json();
  const sql = getSQL(c.env);

  let project: any = null;
  if (data.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${data.project_id}`;
    if (rows.length > 0) project = rows[0];
  }

  const sector = project?.sector || 'technology';
  const stage = project?.stage || 'early-stage';
  const template = TEMPLATES[data.category] || TEMPLATES.general;
  const advice = template.replace(/\{sector\}/g, sector).replace(/\{stage\}/g, stage);

  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${data.project_id || null}, 'ai_advisory_query', ${`Category: ${data.category} | Q: ${(data.question || '').slice(0, 100)}`}, 'ai_advisor')`;
  await sql.end();

  return c.json({ ai_generated: false, fallback_reason: 'Template-based advisory', category: data.category, advice, project_name: project?.name || null });
});

advisory.post('/financial-plan', async (c) => {
  const user = await requireAuth(c);
  const req = await c.req.json();
  const sql = getSQL(c.env);

  let project: any = null;
  if (req.project_id) {
    const rows = await sql`SELECT * FROM projects WHERE id = ${req.project_id}`;
    if (rows.length > 0) project = rows[0];
  }

  const monthlyBurn = req.monthly_burn || ((req.team_size || 1) * (req.avg_salary || 80000) / 12) + 5000;
  const totalMonthlyCost = monthlyBurn + ((req.planned_hires || 0) * (req.avg_salary || 80000) / 12);
  const netBurn = totalMonthlyCost - (req.revenue_monthly || 0);
  const runway = netBurn > 0 ? (req.current_cash || 0) / netBurn : 999;

  const projections = [];
  let cash = req.current_cash || 0;
  let rev = req.revenue_monthly || 0;
  for (let m = 1; m <= 18; m++) {
    rev = rev > 0 ? rev * (1 + (req.revenue_growth_pct || 0) / 100) : 0;
    const hireCost = m > 3 && (req.planned_hires || 0) > 0 ? ((req.planned_hires || 0) * (req.avg_salary || 80000) / 12) * Math.min(m / 6, 1) : 0;
    const expenses = monthlyBurn + hireCost;
    cash = cash + rev - expenses;
    projections.push({ month: m, revenue: Math.round(rev * 100) / 100, expenses: Math.round(expenses * 100) / 100, net: Math.round((rev - expenses) * 100) / 100, cash_balance: Math.round(cash * 100) / 100 });
  }

  const breakeven = projections.find(p => p.net >= 0)?.month || null;
  const recommendations = [];
  if (runway < 6) recommendations.push('URGENT: Runway under 6 months. Begin fundraising immediately.');
  else if (runway < 12) recommendations.push('Start fundraising within 2-3 months.');
  if ((req.revenue_monthly || 0) === 0) recommendations.push('Prioritize first revenue within 90 days.');
  if ((req.team_size || 1) > 3 && (req.revenue_monthly || 0) < monthlyBurn * 0.2) recommendations.push('Team size may be ahead of revenue.');

  if (req.project_id) {
    await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${req.project_id}, 'financial_plan_generated', ${`Runway: ${runway.toFixed(1)}mo, Burn: $${Math.round(netBurn)}/mo`}, 'financial_planner')`;
  }
  await sql.end();

  return c.json({
    summary: { monthly_burn: Math.round(monthlyBurn * 100) / 100, total_monthly_cost: Math.round(totalMonthlyCost * 100) / 100, net_monthly_burn: Math.round(netBurn * 100) / 100, runway_months: Math.round(runway * 10) / 10, runway_status: runway > 12 ? 'Healthy' : runway > 6 ? 'Warning' : 'Critical', breakeven_month: breakeven },
    projections, recommendations, project_name: project?.name || null,
  });
});

advisory.post('/diligence', async (c) => {
  const user = await requireAuth(c);
  const { project_id } = await c.req.json();
  const sql = getSQL(c.env);

  const projects = await sql`SELECT * FROM projects WHERE id = ${project_id}`;
  if (projects.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = projects[0];

  const scores = await sql`SELECT * FROM score_snapshots WHERE project_id = ${project_id} ORDER BY created_at DESC`;
  const docs = await sql`SELECT * FROM documents WHERE project_id = ${project_id}`;
  let founder: any = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }

  const checks: any[] = [];
  let overallStatus = 'pass';

  if (scores.length > 0) {
    checks.push({ category: 'Scoring', item: 'Startup Score', status: scores[0].total_score >= 70 ? 'pass' : 'fail', detail: `Score: ${scores[0].total_score}/100 (${scores[0].tier})` });
  } else {
    checks.push({ category: 'Scoring', item: 'Startup Score', status: 'missing', detail: 'No score on file.' });
    overallStatus = 'incomplete';
  }

  const docTypes = docs.map((d: any) => d.doc_type);
  checks.push({ category: 'Legal', item: 'Corporate Bylaws', status: docTypes.includes('bylaws') ? 'pass' : 'missing', detail: docTypes.includes('bylaws') ? 'On file' : 'Missing' });
  checks.push({ category: 'Legal', item: 'Equity Split', status: docTypes.includes('equity_split') ? 'pass' : 'missing', detail: docTypes.includes('equity_split') ? 'On file' : 'Missing' });
  checks.push({ category: 'Legal', item: 'Incorporation', status: project.entity_id ? 'pass' : 'missing', detail: project.entity_id ? 'Incorporated' : 'Not yet incorporated' });
  if (!project.entity_id) overallStatus = 'incomplete';

  if (founder) {
    checks.push({ category: 'Team', item: 'Founder Profile', status: 'pass', detail: `${founder.name} — ${founder.domain_expertise || 'N/A'}, ${founder.experience_years}yr exp.` });
    if (founder.experience_years < 2) checks.push({ category: 'Team', item: 'Founder Experience', status: 'warning', detail: 'Low experience.' });
  } else {
    checks.push({ category: 'Team', item: 'Founder Profile', status: 'missing', detail: 'No founder on record.' });
    overallStatus = 'incomplete';
  }

  if (project.tam && project.tam > 100_000_000) checks.push({ category: 'Financial', item: 'Market Size', status: 'pass', detail: `TAM: $${project.tam.toLocaleString()}` });
  else checks.push({ category: 'Financial', item: 'Market Size', status: project.tam ? 'warning' : 'missing', detail: project.tam ? `TAM: $${project.tam.toLocaleString()} — may be small` : 'TAM not specified' });

  const missing = checks.filter((c: any) => c.status === 'missing').length;
  const warnings = checks.filter((c: any) => c.status === 'warning').length;
  const pass = checks.filter((c: any) => c.status === 'pass').length;
  if (missing > 2) overallStatus = 'incomplete';
  else if (warnings > 2) overallStatus = 'conditional';

  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project_id}, 'diligence_check', ${`Result: ${overallStatus} | Pass: ${pass}, Warning: ${warnings}, Missing: ${missing}`}, 'diligence_engine')`;
  await sql.end();

  return c.json({
    project_id, project_name: project.name, overall_status: overallStatus,
    summary: { pass, warning: warnings, missing, total: checks.length }, checks,
    recommendation: overallStatus === 'pass' ? 'Ready for spinout' : overallStatus === 'incomplete' ? 'Address missing items' : 'Conditional — review warnings',
    generated_at: new Date().toISOString(),
  });
});

export default advisory;
