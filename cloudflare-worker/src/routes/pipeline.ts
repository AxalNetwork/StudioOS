import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, canAccessFounderResource } from '../auth';
import { notifyPipelineRoom } from '../services/realtime';

const pipeline = new Hono<{ Bindings: Env }>();

const STAGES = ['idea', 'mvp_dev', 'traction_review', 'decision_gate', 'spinout_ready', 'iterate'];
const ADVANCE_ROLES = new Set(['admin', 'partner']); // operators/advisors map to partner; admins always allowed
const REVIEW_RATE_LIMIT = 60; // per hour

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS project_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      stage_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      end_date TIMESTAMP,
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_stages_deal ON project_stages(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stages_active ON project_stages(deal_id, status)`,
    // DB-level guard: at most one active stage per deal
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_stages_one_active ON project_stages(deal_id) WHERE status = 'active'`,
    `CREATE TABLE IF NOT EXISTS mvp_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      status TEXT NOT NULL DEFAULT 'todo',
      ai_generated INTEGER DEFAULT 0,
      due_date TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mvp_deal ON mvp_tasks(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mvp_status ON mvp_tasks(deal_id, status)`,
    `CREATE TABLE IF NOT EXISTS metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      key_metrics TEXT,
      traction_score REAL,
      ai_review TEXT,
      created_by INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_metrics_deal ON metrics_snapshots(deal_id, snapshot_date)`,
    `CREATE TABLE IF NOT EXISTS decision_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      gate_type TEXT NOT NULL DEFAULT 'traction_review',
      status TEXT NOT NULL DEFAULT 'pending',
      ai_recommendation TEXT,
      ai_explanation TEXT,
      final_decision TEXT,
      decided_by INTEGER,
      decided_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_gates_deal ON decision_gates(deal_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_gates_status ON decision_gates(status)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  migrated = true;
}

function safeJson<T>(s: any, def: T): T { try { return s ? JSON.parse(s) : def; } catch { return def; } }
async function logAction(env: Env, actionType: string, performedBy: number | null, details: any = {}) {
  try { await env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (NULL, ?, ?, ?)`).bind(actionType, JSON.stringify(details), performedBy).run(); } catch {}
}
async function checkAiQuota(env: Env, userId: number): Promise<boolean> {
  const sql = getSQL(env);
  const rows = await sql`SELECT COUNT(*) as n FROM shared_services_log WHERE performed_by = ${userId} AND action_type = 'ai_call' AND created_at > datetime('now', '-1 hour')`;
  await sql.end();
  return (parseInt(rows[0]?.n) || 0) < REVIEW_RATE_LIMIT;
}
async function llmText(env: Env, system: string, prompt: string): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: 400,
    });
    return (out?.response || '').trim() || null;
  } catch { return null; }
}

async function getCurrentStage(env: Env, dealId: number): Promise<string | null> {
  const r: any = await env.DB.prepare(`SELECT stage_name FROM project_stages WHERE deal_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`).bind(dealId).first();
  return r?.stage_name || null;
}

async function transitionStage(env: Env, dealId: number, newStage: string, metadata: any = {}) {
  // Atomic close + open in a single D1 batch transaction. The unique partial index
  // uq_stages_one_active enforces at most one active stage per deal at the DB level,
  // so concurrent calls are mutually exclusive (the loser's INSERT raises a constraint error).
  await env.DB.batch([
    env.DB.prepare(`UPDATE project_stages SET status = 'completed', end_date = CURRENT_TIMESTAMP WHERE deal_id = ? AND status = 'active'`).bind(dealId),
    env.DB.prepare(`INSERT INTO project_stages (deal_id, stage_name, status, metadata) VALUES (?, ?, 'active', ?)`).bind(dealId, newStage, JSON.stringify(metadata)),
  ]);
}

// Validate metrics: allowlist keys + numeric values + size cap
const METRIC_KEYS = new Set(['users', 'mau', 'dau', 'revenue', 'mrr', 'arr', 'engagement', 'retention', 'growth', 'growth_rate', 'churn', 'cac', 'ltv', 'nps', 'conversion']);
function validateKeyMetrics(km: any): { ok: true; clean: Record<string, number> } | { ok: false; error: string } {
  if (!km || typeof km !== 'object' || Array.isArray(km)) return { ok: false, error: 'key_metrics must be an object' };
  const keys = Object.keys(km);
  if (keys.length === 0) return { ok: false, error: 'key_metrics cannot be empty' };
  if (keys.length > 20) return { ok: false, error: 'Too many metrics (max 20)' };
  const clean: Record<string, number> = {};
  for (const k of keys) {
    if (!METRIC_KEYS.has(k)) return { ok: false, error: `Unknown metric '${k}'. Allowed: ${[...METRIC_KEYS].join(', ')}` };
    const v = Number(km[k]);
    if (!Number.isFinite(v)) return { ok: false, error: `Metric '${k}' must be a finite number` };
    if (Math.abs(v) > 1e12) return { ok: false, error: `Metric '${k}' out of range` };
    clean[k] = v;
  }
  return { ok: true, clean };
}

// ============================================================
// PIPELINE LIST + CREATE
// ============================================================

pipeline.get('/active', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  // All KYC-approved partners can view; admins see everything; founders see only their own
  const sql = getSQL(c.env);
  const isAdmin = user.role === 'admin';
  const isFounder = user.role === 'founder';
  const rows = isAdmin
    ? await sql`SELECT p.id, p.name, p.sector, p.stage as project_stage, p.score, p.status as project_status, p.created_at FROM projects p WHERE p.status NOT IN ('rejected', 'archived') ORDER BY p.created_at DESC LIMIT 100`
    : isFounder
      ? await sql`SELECT p.id, p.name, p.sector, p.stage as project_stage, p.score, p.status as project_status, p.created_at FROM projects p JOIN founders f ON f.id = p.founder_id WHERE f.user_id = ${user.id} ORDER BY p.created_at DESC LIMIT 100`
      : await sql`SELECT p.id, p.name, p.sector, p.stage as project_stage, p.score, p.status as project_status, p.created_at FROM projects p WHERE p.status NOT IN ('rejected', 'archived') ORDER BY p.created_at DESC LIMIT 100`;

  const ids = (rows as any[]).map(r => r.id);
  if (!ids.length) { await sql.end(); return c.json([]); }
  const placeholders = ids.map(() => '?').join(',');

  const stages = await c.env.DB.prepare(`SELECT deal_id, stage_name, status, start_date FROM project_stages WHERE deal_id IN (${placeholders}) AND status = 'active'`).bind(...ids).all();
  const stageByDeal: Record<number, any> = {};
  for (const r of (stages.results || []) as any[]) stageByDeal[r.deal_id] = r;

  const tasks = await c.env.DB.prepare(`SELECT deal_id, status, COUNT(*) as n FROM mvp_tasks WHERE deal_id IN (${placeholders}) GROUP BY deal_id, status`).bind(...ids).all();
  const taskByDeal: Record<number, any> = {};
  for (const r of (tasks.results || []) as any[]) {
    taskByDeal[r.deal_id] = taskByDeal[r.deal_id] || { todo: 0, in_progress: 0, done: 0 };
    taskByDeal[r.deal_id][r.status] = r.n;
  }

  const latestMetrics = await c.env.DB.prepare(`SELECT deal_id, traction_score, key_metrics, snapshot_date FROM metrics_snapshots WHERE id IN (SELECT MAX(id) FROM metrics_snapshots WHERE deal_id IN (${placeholders}) GROUP BY deal_id)`).bind(...ids).all();
  const metricByDeal: Record<number, any> = {};
  for (const r of (latestMetrics.results || []) as any[]) metricByDeal[r.deal_id] = { ...r, key_metrics: safeJson(r.key_metrics, {}) };

  const latestGates = await c.env.DB.prepare(`SELECT deal_id, status, ai_recommendation, final_decision, created_at FROM decision_gates WHERE id IN (SELECT MAX(id) FROM decision_gates WHERE deal_id IN (${placeholders}) GROUP BY deal_id)`).bind(...ids).all();
  const gateByDeal: Record<number, any> = {};
  for (const r of (latestGates.results || []) as any[]) gateByDeal[r.deal_id] = r;

  const enriched = (rows as any[]).map(r => ({
    ...r,
    pipeline_stage: stageByDeal[r.id]?.stage_name || 'idea',
    pipeline_stage_started: stageByDeal[r.id]?.start_date || null,
    task_counts: taskByDeal[r.id] || { todo: 0, in_progress: 0, done: 0 },
    latest_metrics: metricByDeal[r.id] || null,
    latest_gate: gateByDeal[r.id] || null,
  }));
  await sql.end();
  return c.json(enriched);
});

pipeline.post('/projects', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can create pipeline projects' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!data?.name) return c.json({ error: 'Name required' }, 400);
  const sql = getSQL(c.env);
  const [project] = await sql`
    INSERT INTO projects (name, description, sector, stage, problem_statement, solution, status)
    VALUES (${data.name}, ${data.description || null}, ${data.sector || null}, 'idea', ${data.problem_statement || null}, ${data.solution || null}, 'intake')
    RETURNING *
  `;
  // Open the initial 'idea' stage row
  await c.env.DB.prepare(`INSERT INTO project_stages (deal_id, stage_name, status) VALUES (?, 'idea', 'active')`).bind(project.id).run();
  await sql.end();
  await logAction(c.env, 'pipeline_project_created', user.id, { deal_id: project.id, name: project.name });
  // Real-time fan-out: any admin viewing the board sees the new card immediately.
  await notifyPipelineRoom(c.env, project.id, {
    type: 'project_created',
    deal_id: project.id,
    name: project.name,
    sector: project.sector,
    stage: 'idea',
    by_user_id: user.id,
  });
  return c.json(project, 201);
});

pipeline.post('/projects/:id/advance', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can advance stages' }, 403);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { data = {}; }
  const target = data?.stage;
  if (!STAGES.includes(target)) return c.json({ error: `Invalid stage. Allowed: ${STAGES.join(', ')}` }, 400);
  await transitionStage(c.env, dealId, target, { advanced_by: user.id });
  await logAction(c.env, 'pipeline_stage_advanced', user.id, { deal_id: dealId, stage: target });
  await notifyPipelineRoom(c.env, dealId, {
    type: 'stage_advanced',
    deal_id: dealId,
    stage: target,
    by_user_id: user.id,
  });
  return c.json({ ok: true, stage: target });
});

// ============================================================
// MVP TASKS
// ============================================================

pipeline.get('/projects/:id/detail', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const dealId = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const [project] = await sql`SELECT * FROM projects WHERE id = ${dealId}`;
  if (!project) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  // IDOR guard: founders may only see their own pipeline.
  if (!canAccessFounderResource(user as any, project.founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  const stages = await sql`SELECT * FROM project_stages WHERE deal_id = ${dealId} ORDER BY id`;
  const tasks = await sql`SELECT * FROM mvp_tasks WHERE deal_id = ${dealId} ORDER BY status, created_at`;
  const metrics = await sql`SELECT * FROM metrics_snapshots WHERE deal_id = ${dealId} ORDER BY snapshot_date DESC LIMIT 30`;
  const gates = await sql`SELECT * FROM decision_gates WHERE deal_id = ${dealId} ORDER BY created_at DESC LIMIT 10`;
  await sql.end();
  return c.json({
    project,
    stages,
    tasks: (tasks as any[]).map(t => ({ ...t, ai_generated: !!t.ai_generated })),
    metrics: (metrics as any[]).map(m => ({ ...m, key_metrics: safeJson(m.key_metrics, {}) })),
    gates,
    current_stage: (stages as any[]).find((s: any) => s.status === 'active')?.stage_name || 'idea',
  });
});

pipeline.post('/mvp-tasks', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can create MVP tasks' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId || !data?.title) return c.json({ error: 'deal_id and title required' }, 400);
  const r: any = await c.env.DB.prepare(`INSERT INTO mvp_tasks (deal_id, title, description, assigned_to, status, ai_generated, due_date) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(dealId, String(data.title).slice(0, 300), data.description ? String(data.description).slice(0, 2000) : null, data.assigned_to || null, data.status || 'todo', data.ai_generated ? 1 : 0, data.due_date || null).first();
  await logAction(c.env, 'mvp_task_created', user.id, { deal_id: dealId, task_id: r?.id });
  return c.json(r, 201);
});

pipeline.patch('/mvp-tasks/:id', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const allowed: Record<string, any> = {};
  for (const k of ['title', 'description', 'status', 'assigned_to', 'due_date']) {
    if (k in data) allowed[k] = data[k];
  }
  if (!Object.keys(allowed).length) return c.json({ error: 'No valid fields' }, 400);
  const setClauses = Object.keys(allowed).map(k => `${k} = ?`).join(', ');
  const values = Object.values(allowed);
  await c.env.DB.prepare(`UPDATE mvp_tasks SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...values, id).run();
  return c.json({ ok: true });
});

// ============================================================
// METRICS SNAPSHOTS
// ============================================================

pipeline.post('/metrics/snapshot', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can record metrics' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const v = validateKeyMetrics(data?.key_metrics);
  if (!v.ok) return c.json({ error: v.error }, 400);
  const km = v.clean;
  const users = Number(km.users || km.mau || 0);
  const revenue = Number(km.revenue || km.mrr || 0);
  const engagement = Number(km.engagement || km.retention || 0);
  const growth = Number(km.growth || km.growth_rate || 0);
  // Normalize to 0-100 with diminishing returns
  const usersScore = Math.min(40, Math.log10(users + 1) * 10);
  const revenueScore = Math.min(40, Math.log10(revenue + 1) * 8);
  const engagementScore = Math.min(15, engagement * 0.15);
  const growthScore = Math.min(15, growth * 0.5);
  const tractionScore = Math.round(usersScore + revenueScore + engagementScore + growthScore);

  const r: any = await c.env.DB.prepare(`INSERT INTO metrics_snapshots (deal_id, key_metrics, traction_score, created_by) VALUES (?, ?, ?, ?) RETURNING *`)
    .bind(dealId, JSON.stringify(km), tractionScore, user.id).first();
  await logAction(c.env, 'metrics_snapshot', user.id, { deal_id: dealId, score: tractionScore });
  return c.json({ ...r, key_metrics: km, traction_score: tractionScore }, 201);
});

// ============================================================
// DECISION GATES (AI REVIEW)
// ============================================================

pipeline.post('/decision-gate/review', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can trigger reviews' }, 403);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60/hour)' }, 429);

  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const dealId = parseInt(data?.deal_id);
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);

  const sql = getSQL(c.env);
  const [project] = await sql`SELECT * FROM projects WHERE id = ${dealId}`;
  if (!project) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const [latestMetric] = await sql`SELECT * FROM metrics_snapshots WHERE deal_id = ${dealId} ORDER BY snapshot_date DESC LIMIT 1`;
  await sql.end();

  const km = latestMetric ? safeJson(latestMetric.key_metrics, {}) : {};
  const traction = latestMetric?.traction_score ?? 0;

  // Rule-based recommendation as fallback / safety floor
  let ruleRec: 'continue' | 'iterate' | 'spinout_ready';
  if (traction >= 70) ruleRec = 'spinout_ready';
  else if (traction >= 40) ruleRec = 'continue';
  else ruleRec = 'iterate';

  const ai = await llmText(c.env,
    'You are a venture-studio decision-gate analyst. Given a project and its latest traction metrics, recommend exactly one of: SPIN-OUT READY, CONTINUE, or ITERATE. Return JSON: {"recommendation":"spinout_ready|continue|iterate","explanation":"2-3 sentences"}.',
    `Project: ${project.name}\nSector: ${project.sector || 'n/a'}\nStage: ${project.stage}\nTraction Score: ${traction}/100\nLatest Metrics: ${JSON.stringify(km)}\nProblem: ${(project.problem_statement || '').slice(0, 500)}\nSolution: ${(project.solution || '').slice(0, 500)}`);

  let aiRec = ruleRec;
  let aiExp = `Rule-based: traction score ${traction}/100 → ${ruleRec.replace('_', ' ')}.`;
  if (ai) {
    const m = ai.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        const rec = String(parsed.recommendation || '').toLowerCase().replace(/[\s-]/g, '_');
        if (['spinout_ready', 'continue', 'iterate'].includes(rec)) aiRec = rec as any;
        if (parsed.explanation) aiExp = String(parsed.explanation).slice(0, 1000);
      } catch {}
    }
  }

  const gate: any = await c.env.DB.prepare(`INSERT INTO decision_gates (deal_id, gate_type, status, ai_recommendation, ai_explanation) VALUES (?, 'traction_review', 'pending', ?, ?) RETURNING *`)
    .bind(dealId, aiRec, aiExp).first();

  // Move project into decision_gate stage if not already
  const cur = await getCurrentStage(c.env, dealId);
  if (cur !== 'decision_gate') await transitionStage(c.env, dealId, 'decision_gate', { gate_id: gate.id });

  // Fan out to anyone watching this deal or the overview board.
  await notifyPipelineRoom(c.env, dealId, {
    type: 'gate_review_created',
    deal_id: dealId,
    gate_id: gate.id,
    recommendation: aiRec,
    traction_score: traction,
    by: user.id,
    ts: Date.now(),
  });

  // Auto-create a Studio Ops strategic oversight task for human review
  try {
    let wf: any = await c.env.DB.prepare(`SELECT id FROM workflows WHERE template_key = 'pipeline.gate_review' AND project_id = ? LIMIT 1`).bind(dealId).first();
    if (!wf) {
      wf = await c.env.DB.prepare(`INSERT INTO workflows (type, title, description, status, project_id, template_key, owner_user_id) VALUES ('strategic', ?, 'AI-generated decision gate reviews pending human sign-off.', 'active', ?, 'pipeline.gate_review', ?) RETURNING id`)
        .bind(`Decision Gates: ${project.name}`, dealId, user.id).first();
    }
    await c.env.DB.prepare(`INSERT INTO workflow_tasks (workflow_id, title, description, status, ai_assisted, metadata) VALUES (?, ?, ?, 'todo', 1, ?)`)
      .bind(wf.id, `Review AI recommendation: ${aiRec.toUpperCase().replace('_', ' ')}`, aiExp, JSON.stringify({ kind: 'decision_gate', gate_id: gate.id, deal_id: dealId })).run();
  } catch {}

  await logAction(c.env, 'ai_call', user.id, { kind: 'decision_gate_review', deal_id: dealId });
  await logAction(c.env, 'decision_gate_review', user.id, { deal_id: dealId, gate_id: gate.id, recommendation: aiRec });
  return c.json({ ...gate, model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'rule-based', traction_score: traction });
});

pipeline.patch('/decision-gate/decide', async (c) => {
  const user = await requireAuth(c);
  if (!ADVANCE_ROLES.has(user.role)) return c.json({ error: 'Only admins or partners can decide' }, 403);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const gateId = parseInt(data?.gate_id);
  const decision = String(data?.decision || '').toLowerCase();
  if (!gateId || !['passed', 'failed', 'iterate'].includes(decision)) return c.json({ error: 'gate_id and decision (passed|failed|iterate) required' }, 400);

  // Optimistic concurrency: the WHERE status='pending' clause is the actual guard.
  // We rely on meta.changes (rows affected) — if 0, another admin already decided.
  const upd = await c.env.DB.prepare(`UPDATE decision_gates SET status = ?, final_decision = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`)
    .bind(decision, decision, user.id, gateId).run();
  if (!upd.meta?.changes) {
    const existing: any = await c.env.DB.prepare(`SELECT id, status, final_decision, decided_by FROM decision_gates WHERE id = ?`).bind(gateId).first();
    if (!existing) return c.json({ error: 'Gate not found' }, 404);
    return c.json({ error: 'Gate already decided', current: existing }, 409);
  }
  const gate: any = await c.env.DB.prepare(`SELECT * FROM decision_gates WHERE id = ?`).bind(gateId).first();

  // Apply downstream stage transitions
  if (decision === 'passed') {
    await transitionStage(c.env, gate.deal_id, 'spinout_ready', { gate_id: gateId, decided_by: user.id });
    await c.env.DB.prepare(`UPDATE projects SET status = 'spinout' WHERE id = ?`).bind(gate.deal_id).run();
  } else if (decision === 'iterate') {
    await transitionStage(c.env, gate.deal_id, 'iterate', { gate_id: gateId });
    // Reset to mvp_dev next so the team can keep building
    await transitionStage(c.env, gate.deal_id, 'mvp_dev', { gate_id: gateId });
  } else if (decision === 'failed') {
    await c.env.DB.prepare(`UPDATE projects SET status = 'rejected' WHERE id = ?`).bind(gate.deal_id).run();
    await c.env.DB.prepare(`UPDATE project_stages SET status = 'completed', end_date = CURRENT_TIMESTAMP WHERE deal_id = ? AND status = 'active'`).bind(gate.deal_id).run();
  }

  await logAction(c.env, 'decision_gate_decided', user.id, { gate_id: gateId, decision, deal_id: gate.deal_id });

  // Fan out — board needs to refresh because stage and/or project status changed.
  await notifyPipelineRoom(c.env, gate.deal_id, {
    type: 'gate_decided',
    deal_id: gate.deal_id,
    gate_id: gateId,
    decision,
    by: user.id,
    ts: Date.now(),
  });

  return c.json({ ok: true, decision });
});

export default pipeline;
