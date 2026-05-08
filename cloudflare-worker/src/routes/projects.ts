import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireRole, canAccessFounderResource } from '../auth';
import { runFullScore } from '../services/scoring';

const projects = new Hono<{ Bindings: Env }>();

async function listProjectsHandler(c: any) {
  const user = await requireAuth(c);
  const status = c.req.query('status');
  const sql = getSQL(c.env);
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  // IDOR guard: founders can only see their OWN projects.
  let rows: any;
  if (isPrivileged) {
    rows = status
      ? await sql`SELECT * FROM projects WHERE status = ${status} ORDER BY created_at DESC`
      : await sql`SELECT * FROM projects ORDER BY created_at DESC`;
  } else {
    if (!user.founder_id) { await sql.end(); return c.json([]); }
    rows = status
      ? await sql`SELECT * FROM projects WHERE status = ${status} AND founder_id = ${user.founder_id} ORDER BY created_at DESC`
      : await sql`SELECT * FROM projects WHERE founder_id = ${user.founder_id} ORDER BY created_at DESC`;
  }
  await sql.end();
  return c.json(rows);
}

projects.get('/', listProjectsHandler);
projects.get('', listProjectsHandler);

projects.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  // IDOR guard: a founder can only read their own project; admins/partners read all.
  if (!canAccessFounderResource(user, project.founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  let founder = null;
  if (project.founder_id) {
    const f = await sql`SELECT * FROM founders WHERE id = ${project.founder_id}`;
    if (f.length > 0) founder = f[0];
  }
  await sql.end();
  return c.json({ ...project, founder });
});

/**
 * Resolve which founder row a NEW project should be attached to.
 *
 *  - Founders are forced onto their OWN founder_id (form values ignored). If
 *    they don't have one yet, we auto-create the row from their account name +
 *    email and link it via users.founder_id.
 *  - Admin / partner / investor look the founder up by the form's
 *    founder_email (creating a new row if needed). If no email is supplied
 *    the project ships unattached, matching legacy behaviour.
 */
export async function resolveFounderIdForCreate(
  user: { id: number; role: string; email: string; name?: string | null; founder_id?: number | null },
  data: { founder_email?: string; founder_name?: string },
  sql: any,
): Promise<number | null> {
  if (user.role === 'founder') {
    if (user.founder_id) return user.founder_id;
    const existing = await sql`SELECT id FROM founders WHERE email = ${user.email}`;
    let founderId: number;
    if (existing.length > 0) {
      founderId = existing[0].id;
    } else {
      // founders.email is UNIQUE — guard against the rare race where two
      // concurrent first-project creates from the same founder both pass the
      // SELECT above. The losing INSERT will throw; fall back to a re-SELECT.
      try {
        const [f] = await sql`INSERT INTO founders (name, email) VALUES (${user.name || 'Unknown'}, ${user.email}) RETURNING id`;
        founderId = f.id;
      } catch (e: any) {
        if (!/UNIQUE|constraint/i.test(e?.message || '')) throw e;
        const retry = await sql`SELECT id FROM founders WHERE email = ${user.email}`;
        if (retry.length === 0) throw e;
        founderId = retry[0].id;
      }
    }
    await sql`UPDATE users SET founder_id = ${founderId} WHERE id = ${user.id}`;
    return founderId;
  }
  if (!data.founder_email) return null;
  const existing = await sql`SELECT id FROM founders WHERE email = ${data.founder_email}`;
  if (existing.length > 0) return existing[0].id;
  const [f] = await sql`INSERT INTO founders (name, email) VALUES (${data.founder_name || 'Unknown'}, ${data.founder_email}) RETURNING id`;
  return f.id;
}

async function createProjectHandler(c: any) {
  const user = await requireAuth(c);
  const data = await c.req.json();
  // Task #17 — name is required. Without this an empty form silently
  // creates a blank "" project that founders then can't filter / find.
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  if (!name) return c.json({ error: 'Project name is required' }, 400);
  const sql = getSQL(c.env);

  const founderId = await resolveFounderIdForCreate(user as any, data, sql);

  const [project] = await sql`INSERT INTO projects (name, description, sector, stage, founder_id, problem_statement, solution, why_now, tam, sam, cost_to_mvp, funding_needed, use_of_funds) VALUES (${name}, ${data.description || null}, ${data.sector || null}, ${data.stage || 'idea'}, ${founderId}, ${data.problem_statement || null}, ${data.solution || null}, ${data.why_now || null}, ${data.tam || null}, ${data.sam || null}, ${data.cost_to_mvp || null}, ${data.funding_needed || null}, ${data.use_of_funds || null}) RETURNING *`;

  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, 'applied')`;
  await sql`INSERT INTO activity_logs (project_id, action, details) VALUES (${project.id}, 'project_created', ${`Project '${project.name}' submitted`})`;
  await sql.end();
  // Re-index for semantic search. Best-effort — failure is non-fatal.
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id: project.id }); } catch {}
  return c.json(project, 201);
}

projects.post('/', createProjectHandler);
projects.post('', createProjectHandler);

projects.post('/submit', async (c) => {
  await requireAuth(c);
  const data = await c.req.json();

  // Epic 5: reject any client-supplied score / tier / breakdown BEFORE any
  // DB writes. The /submit path is wide-open intake; a malicious founder
  // could otherwise send a pre-built TIER_1 payload AND have a project row
  // created as a side effect even when the request is rejected.
  const { assertNoReservedFields, signScore, detectAnomalies, INTEGRITY_VERSION } =
    await import('../services/scoreIntegrity');
  try {
    assertNoReservedFields(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Reserved field rejected';
    return c.json({ error: message, code: 'reserved_field' }, 400);
  }

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

  // Snapshot the scoring inputs so the nightly audit + admin queue can
  // reproduce the math, and so anomaly detection can compare to history.
  // Keys MUST match `REQUIRED_OFFICIAL_INPUTS` in scoreIntegrity.ts so that
  // input_jump anomaly detection compares like-for-like fields across the
  // /submit and /scoring/score paths.
  const inputsSnapshot: Record<string, unknown> = {};
  for (const k of ['tam','sam','market_urgency','market_trend','team_expertise','team_execution','team_network','mvp_time_days','product_complexity','product_dependencies','cost_to_mvp','time_to_revenue_months','burn_risk','fit_alignment','fit_synergy','distribution_channels','distribution_virality']) {
    if (data[k] !== undefined) inputsSnapshot[k] = data[k];
  }
  const qualText = [data.problem_statement, data.solution, data.why_now, data.use_of_funds, data.growth_signals]
    .filter(v => typeof v === 'string' && v.trim()).map(v => (v as string).trim().toLowerCase()).join('\n---\n') || null;
  const lockedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  // Anomaly detection MUST run BEFORE the INSERT (same reason as
  // /scoring/score: detectAnomalies' "previous snapshot" lookup would
  // otherwise self-compare against the row we just wrote, swallowing
  // duplicate-text and input-jump signals on intake).
  const intakeFlags = await detectAnomalies(c.env, {
    projectId: project.id, totalScore: result.total_score, isSandbox: false,
    inputs: inputsSnapshot as Record<string, number>, qualitativeText: qualText || '',
  });
  const intakeReview: 'auto_approved' | 'flagged' =
    intakeFlags.length > 0 ? 'flagged' : 'auto_approved';
  const intakeFlagsJson = intakeFlags.length > 0 ? JSON.stringify(intakeFlags) : null;

  const [snapshot] = await sql`
    INSERT INTO score_snapshots (
      project_id, total_score, tier,
      market_size, market_urgency, market_trend, market_total,
      team_expertise, team_execution, team_network, team_total,
      product_mvp_time, product_complexity, product_dependency, product_total,
      capital_cost_mvp, capital_time_revenue, capital_burn_traction, capital_total,
      fit_alignment, fit_synergy, fit_total,
      distribution_channels, distribution_virality, distribution_total,
      ai_adjustment, scored_by,
      is_sandbox, integrity_version, inputs_json, qualitative_text, locked_until,
      anomaly_flags, admin_review_status
    ) VALUES (
      ${project.id}, ${result.total_score}, ${result.tier},
      ${b.market.size}, ${b.market.urgency}, ${b.market.trend}, ${b.market.total},
      ${b.team.expertise}, ${b.team.execution}, ${b.team.network}, ${b.team.total},
      ${b.product.mvp_time}, ${b.product.complexity}, ${b.product.dependency}, ${b.product.total},
      ${b.capital.cost_mvp}, ${b.capital.time_revenue}, ${b.capital.burn_traction}, ${b.capital.total},
      ${b.fit.alignment}, ${b.fit.synergy}, ${b.fit.total},
      ${b.distribution.channels}, ${b.distribution.virality}, ${b.distribution.total},
      0, 'auto',
      0, ${INTEGRITY_VERSION}, ${JSON.stringify(inputsSnapshot)}, ${qualText}, ${lockedUntil},
      ${intakeFlagsJson}, ${intakeReview}
    )
    RETURNING *
  `;
  const intakeHash = await signScore(c.env, project.id, result.total_score, snapshot.created_at, INTEGRITY_VERSION);
  await sql`UPDATE score_snapshots SET integrity_hash = ${intakeHash} WHERE id = ${snapshot.id}`;

  let newStatus = 'rejected', dealStatus = 'rejected', newStage = project.stage;
  if (intakeReview === 'flagged') {
    // Flagged intake holds the project in review until admin signs off, so
    // an LP or partner viewing the pipeline never sees an unverified TIER_1.
    newStatus = 'scoring';
    dealStatus = 'applied';
  } else if (result.total_score >= 85) { newStatus = 'tier_1'; newStage = 'build'; dealStatus = 'active'; }
  else if (result.total_score >= 70) { newStatus = 'tier_2'; dealStatus = 'scored'; }

  await sql`UPDATE projects SET status = ${newStatus}, stage = ${newStage}, updated_at = CURRENT_TIMESTAMP WHERE id = ${project.id}`;
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id: project.id }); } catch {}
  await sql`INSERT INTO deals (project_id, status) VALUES (${project.id}, ${dealStatus})`;
  await sql`INSERT INTO activity_logs (project_id, action, details, actor) VALUES (${project.id}, 'auto_scored', ${`Score: ${result.total_score}, Tier: ${result.tier}, Status: ${newStatus}, Review: ${intakeReview}`}, 'system')`;
  await sql.end();
  // Only auto-create StudioOps for clean, approved tier_1/tier_2. A flagged
  // intake holds at 'scoring' until admin signs off — Epic 5 LP guarantee.
  if (intakeReview === 'auto_approved' && (newStatus === 'tier_1' || newStatus === 'tier_2')) {
    const { autoCreateStudioOpsForProject } = await import('./studioops');
    await autoCreateStudioOpsForProject(c.env, project.id, newStatus, founderId || 1);
  }

  return c.json({
    project: { ...project, status: newStatus, stage: newStage },
    score: { ...result, integrity_hash: intakeHash, integrity_version: INTEGRITY_VERSION, requires_admin_review: intakeReview === 'flagged', anomaly_flags: intakeFlags },
    auto_decision: { status: newStatus, stage: newStage, tier: result.tier, tier_label: result.tier_label, requires_admin_review: intakeReview === 'flagged' },
  });
});

projects.put('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const data = await c.req.json();
  const sql = getSQL(c.env);

  const rows = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }

  // RBAC: admins/partners/investors can edit any project; founders can only edit their own.
  const project = rows[0];
  const isPrivileged = user.role === 'admin' || user.role === 'partner' || user.role === 'investor';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  if (!isPrivileged && !isOwner) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }

  // Task #17 — parity with create: reject blank `name` on update so the
  // direct-API path can't whitewash an existing project's title.
  if (data.name !== undefined) {
    const nameTrimmed = typeof data.name === 'string' ? data.name.trim() : '';
    if (!nameTrimmed) { await sql.end(); return c.json({ error: 'Project name is required' }, 400); }
    data.name = nameTrimmed;
  }

  // Only admin/partner may change status, stage, or playbook week.
  const baseFields = ['name', 'description', 'sector', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'users_count', 'revenue', 'growth_signals', 'cost_to_mvp', 'funding_needed', 'use_of_funds'];
  const privilegedFields = ['stage', 'status', 'playbook_week'];
  const fields = isPrivileged ? [...baseFields, ...privilegedFields] : baseFields;
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
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_entity', { type: 'project', id }); } catch {}
  return c.json(updated);
});

projects.delete('/:id', async (c) => {
  // Task #17 — founders must be able to delete their OWN projects (the
  // happy path includes a delete step). Admins keep blanket delete rights.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT id, founder_id FROM projects WHERE id = ${id}`;
  if (rows.length === 0) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const project = rows[0];
  const isPrivileged = user.role === 'admin';
  const isOwner = !!user.founder_id && project.founder_id === user.founder_id;
  if (!isPrivileged && !isOwner) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  await sql`DELETE FROM projects WHERE id = ${id}`;
  try { const { Jobs } = await import('../models/jobs'); await Jobs.enqueue(c.env, 'embed_delete', { type: 'project', id }); } catch {}
  await sql.end();
  return c.json({ ok: true });
});

projects.post('/:id/advance-week', async (c) => {
  await requireRole(c, 'partner', 'investor');
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
