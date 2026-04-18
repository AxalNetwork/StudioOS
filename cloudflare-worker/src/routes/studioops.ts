import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin, canAccessFounderResource } from '../auth';

const studioops = new Hono<{ Bindings: Env }>();

const WORKFLOW_TYPES = ['strategic', 'finance', 'hr', 'legal', 'compliance'] as const;
const WORKFLOW_STATUSES = ['draft', 'active', 'completed', 'archived'] as const;
const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;

const TEMPLATES: Array<{ key: string; type: typeof WORKFLOW_TYPES[number]; title: string; description: string; tasks: string[] }> = [
  { key: 'strategic.decision_gate', type: 'strategic', title: 'Decision Gate Review', description: 'Stage-gate review: continue, iterate, or spin out.',
    tasks: ['Pull traction metrics', 'Review burn vs runway', 'Score market signal', 'Decision call: continue / iterate / spin-out', 'Document outcome in deal memo'] },
  { key: 'strategic.traction_review', type: 'strategic', title: 'Traction & Metrics Review', description: 'Weekly metrics + KPI tracking.',
    tasks: ['Collect WoW user growth', 'Collect revenue / ARR', 'Plot vs targets', 'Identify red/yellow/green signals'] },
  { key: 'finance.budget', type: 'finance', title: 'Budget Allocation', description: 'Allocate studio budget across active projects.',
    tasks: ['Pull active project list', 'Apply allocation rules', 'Update spreadsheet / cap table', 'Notify project owners'] },
  { key: 'finance.cap_table', type: 'finance', title: 'Cap Table Update', description: 'Sync cap table after new round / SAFE.',
    tasks: ['Collect signed SAFE / docs', 'Update cap table', 'Confirm dilution math', 'Email founders'] },
  { key: 'finance.invoice', type: 'finance', title: 'Invoice Generation', description: 'Generate and send invoices for shared services.',
    tasks: ['Compile billable hours', 'Generate invoice PDF', 'Email to project', 'Log in receivables'] },
  { key: 'hr.onboard', type: 'hr', title: 'Team Onboarding', description: 'Onboard a new team member to a portfolio company.',
    tasks: ['Collect employment forms', 'Issue equity grant', 'Set up email + SSO', 'Schedule orientation'] },
  { key: 'hr.review', type: 'hr', title: 'Performance Review', description: 'Quarterly performance review cycle.',
    tasks: ['Collect self-assessments', 'Collect peer feedback', 'Manager 1:1', 'Document outcomes + comp adjustments'] },
  { key: 'legal.ip_transfer', type: 'legal', title: 'IP Licensing / Transfer', description: 'Transfer IP from studio entity to spin-out.',
    tasks: ['Draft assignment agreement', 'Confirm chain of title', 'Founder + studio signatures', 'File records'] },
  { key: 'legal.equity', type: 'legal', title: 'Equity Allocation', description: 'Founder + advisor + studio equity split.',
    tasks: ['Apply standard split (founder X / studio Y / pool Z)', 'Generate vesting schedules', 'Issue grants', 'File 83(b) reminders'] },
  { key: 'legal.safe', type: 'legal', title: 'SAFE Contract', description: 'Generate SAFE for new investor.',
    tasks: ['Confirm investor + cap', 'Generate SAFE doc', 'Founder + investor signatures', 'Update cap table'] },
  { key: 'compliance.kyc_reminder', type: 'compliance', title: 'KYC Reminder Sweep', description: 'Nudge users with pending or missing KYC.',
    tasks: ['Pull users with kyc_status != approved', 'Send reminder email', 'Flag stale > 30 days for admin review'] },
  { key: 'compliance.audit_export', type: 'compliance', title: 'Audit Trail Export', description: 'Export activity logs for audit / regulator request.',
    tasks: ['Define date range + scope', 'Export activity_logs as CSV', 'Hash + sign archive', 'Deliver to requestor'] },
];

let migrated = false;
async function ensureSchema(env: Env) {
  if (migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft',
      project_id INTEGER,
      template_key TEXT,
      owner_user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_workflows_type ON workflows(type)`,
    `CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_workflows_owner ON workflows(owner_user_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_project_template ON workflows(project_id, template_key) WHERE project_id IS NOT NULL AND template_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS workflow_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      assigned_to INTEGER,
      status TEXT DEFAULT 'todo',
      due_date TIMESTAMP,
      ai_assisted INTEGER DEFAULT 0,
      metadata TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON workflow_tasks(workflow_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON workflow_tasks(assigned_to)`,
    `CREATE TABLE IF NOT EXISTS shared_services_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER,
      action_type TEXT NOT NULL,
      details TEXT,
      performed_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_log_workflow ON shared_services_log(workflow_id)`,
    `CREATE INDEX IF NOT EXISTS idx_log_created ON shared_services_log(created_at)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch {} }
  migrated = true;
}

async function logAction(env: Env, workflowId: number | null, actionType: string, performedBy: number | null, details: any = {}) {
  try {
    await env.DB.prepare(`INSERT INTO shared_services_log (workflow_id, action_type, details, performed_by) VALUES (?, ?, ?, ?)`)
      .bind(workflowId, actionType, JSON.stringify(details), performedBy).run();
  } catch {}
}

// --------- LLM helper (rate-limited) ---------
async function checkAiQuota(env: Env, userId: number): Promise<boolean> {
  const sql = getSQL(env);
  const rows = await sql`SELECT COUNT(*) as n FROM shared_services_log WHERE performed_by = ${userId} AND action_type = 'ai_call' AND created_at > datetime('now', '-1 hour')`;
  await sql.end();
  return (parseInt(rows[0]?.n) || 0) < 60;
}

async function llmText(env: Env, system: string, prompt: string): Promise<string | null> {
  if (!env.AI) return null;
  try {
    const out: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      max_tokens: 400,
    });
    return (out?.response || '').trim() || null;
  } catch { return null; }
}

// --------- Templates ---------

studioops.get('/templates', async (c) => {
  await requireAuth(c);
  return c.json(TEMPLATES.map(t => ({ key: t.key, type: t.type, title: t.title, description: t.description, task_count: t.tasks.length })));
});

studioops.post('/execute-template', async (c) => {
  const user = await requireAdmin(c);
  await ensureSchema(c.env);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const tpl = TEMPLATES.find(t => t.key === body.template_key);
  if (!tpl) return c.json({ error: 'Template not found' }, 404);
  const projectId = body.project_id ? parseInt(body.project_id) : null;

  const sql = getSQL(c.env);
  const [wf] = await sql`INSERT INTO workflows (type, title, description, status, project_id, template_key, owner_user_id) VALUES (${tpl.type}, ${tpl.title}, ${tpl.description}, 'active', ${projectId}, ${tpl.key}, ${user.id}) RETURNING *`;
  for (let i = 0; i < tpl.tasks.length; i++) {
    await sql`INSERT INTO workflow_tasks (workflow_id, title, status, sort_order) VALUES (${wf.id}, ${tpl.tasks[i]}, 'todo', ${i})`;
  }
  await sql.end();
  await logAction(c.env, wf.id, 'workflow_created', user.id, { template: tpl.key, project_id: projectId });
  return c.json(wf, 201);
});

// --------- Workflows CRUD ---------

studioops.get('/workflows', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const { type, status, project_id } = c.req.query();
  const sql = getSQL(c.env);
  let rows;
  if (type && status && project_id) {
    rows = await sql`SELECT * FROM workflows WHERE type = ${type} AND status = ${status} AND project_id = ${parseInt(project_id)} ORDER BY updated_at DESC`;
  } else if (type && status) {
    rows = await sql`SELECT * FROM workflows WHERE type = ${type} AND status = ${status} ORDER BY updated_at DESC`;
  } else if (type) {
    rows = await sql`SELECT * FROM workflows WHERE type = ${type} ORDER BY updated_at DESC`;
  } else if (status) {
    rows = await sql`SELECT * FROM workflows WHERE status = ${status} ORDER BY updated_at DESC`;
  } else if (project_id) {
    rows = await sql`SELECT * FROM workflows WHERE project_id = ${parseInt(project_id)} ORDER BY updated_at DESC`;
  } else {
    rows = await sql`SELECT * FROM workflows ORDER BY updated_at DESC LIMIT 200`;
  }

  // Non-admins only see workflows they own or are assigned to via tasks
  let visible: any[] = rows as any[];
  if (user.role !== 'admin') {
    const owned = visible.filter(w => w.owner_user_id === user.id);
    const wfIds = visible.map(w => w.id);
    if (wfIds.length) {
      const placeholders = wfIds.map(() => '?').join(',');
      const assigned = await c.env.DB.prepare(`SELECT DISTINCT workflow_id FROM workflow_tasks WHERE assigned_to = ? AND workflow_id IN (${placeholders})`).bind(user.id, ...wfIds).all();
      const assignedIds = new Set((assigned.results || []).map((r: any) => r.workflow_id));
      visible = visible.filter(w => w.owner_user_id === user.id || assignedIds.has(w.id));
    } else {
      visible = owned;
    }
  }

  // Attach task counts
  if (visible.length) {
    const ids = visible.map(w => w.id);
    const placeholders = ids.map(() => '?').join(',');
    const counts = await c.env.DB.prepare(`SELECT workflow_id, status, COUNT(*) as n FROM workflow_tasks WHERE workflow_id IN (${placeholders}) GROUP BY workflow_id, status`).bind(...ids).all();
    const map: Record<number, any> = {};
    for (const r of (counts.results || []) as any[]) {
      if (!map[r.workflow_id]) map[r.workflow_id] = { todo: 0, in_progress: 0, review: 0, done: 0 };
      map[r.workflow_id][r.status] = r.n;
    }
    visible = visible.map(w => ({ ...w, task_counts: map[w.id] || { todo: 0, in_progress: 0, review: 0, done: 0 } }));
  }
  await sql.end();
  return c.json(visible);
});

studioops.get('/workflows/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM workflows WHERE id = ${id}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  const wf: any = rows[0];

  if (user.role !== 'admin' && wf.owner_user_id !== user.id) {
    const a = await sql`SELECT 1 FROM workflow_tasks WHERE workflow_id = ${id} AND assigned_to = ${user.id} LIMIT 1`;
    if (!a.length) { await sql.end(); return c.json({ error: 'Forbidden' }, 403); }
  }

  const tasks = await sql`SELECT * FROM workflow_tasks WHERE workflow_id = ${id} ORDER BY sort_order, id`;
  let project = null;
  if (wf.project_id) {
    const p = await sql`SELECT id, name, sector, stage, status FROM projects WHERE id = ${wf.project_id}`;
    if (p.length) project = p[0];
  }
  await sql.end();
  return c.json({ ...wf, tasks, project });
});

studioops.post('/workflows', async (c) => {
  const user = await requireAdmin(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!data || !WORKFLOW_TYPES.includes(data.type)) return c.json({ error: 'Invalid type' }, 400);
  if (!data.title) return c.json({ error: 'Title required' }, 400);
  const status = WORKFLOW_STATUSES.includes(data.status) ? data.status : 'draft';
  const sql = getSQL(c.env);
  const [wf] = await sql`INSERT INTO workflows (type, title, description, status, project_id, owner_user_id) VALUES (${data.type}, ${data.title}, ${data.description || null}, ${status}, ${data.project_id || null}, ${user.id}) RETURNING *`;
  await sql.end();
  await logAction(c.env, wf.id, 'workflow_created', user.id, { type: wf.type });
  return c.json(wf, 201);
});

studioops.patch('/workflows/:id', async (c) => {
  const user = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM workflows WHERE id = ${id}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  const cur: any = rows[0];
  const next = {
    title: data.title ?? cur.title,
    description: data.description ?? cur.description,
    status: WORKFLOW_STATUSES.includes(data.status) ? data.status : cur.status,
    type: WORKFLOW_TYPES.includes(data.type) ? data.type : cur.type,
  };
  await sql`UPDATE workflows SET title = ${next.title}, description = ${next.description}, status = ${next.status}, type = ${next.type}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await sql.end();
  await logAction(c.env, id, 'workflow_updated', user.id, { changes: data });
  return c.json({ ok: true });
});

studioops.delete('/workflows/:id', async (c) => {
  const user = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM workflow_tasks WHERE workflow_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(id).run();
  await logAction(c.env, id, 'workflow_deleted', user.id);
  return c.json({ ok: true });
});

// --------- Tasks ---------

studioops.post('/tasks', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  if (!data?.workflow_id || !data?.title) return c.json({ error: 'workflow_id and title required' }, 400);

  const sql = getSQL(c.env);
  const wfRows = await sql`SELECT * FROM workflows WHERE id = ${parseInt(data.workflow_id)}`;
  if (!wfRows.length) { await sql.end(); return c.json({ error: 'Workflow not found' }, 404); }
  const wf: any = wfRows[0];
  if (user.role !== 'admin' && wf.owner_user_id !== user.id) { await sql.end(); return c.json({ error: 'Forbidden' }, 403); }

  const status = TASK_STATUSES.includes(data.status) ? data.status : 'todo';
  const [task] = await sql`INSERT INTO workflow_tasks (workflow_id, title, description, assigned_to, status, due_date, ai_assisted, metadata) VALUES (${wf.id}, ${data.title}, ${data.description || null}, ${data.assigned_to || null}, ${status}, ${data.due_date || null}, ${data.ai_assisted ? 1 : 0}, ${data.metadata ? JSON.stringify(data.metadata) : null}) RETURNING *`;
  await sql.end();
  await logAction(c.env, wf.id, 'task_created', user.id, { task_id: task.id });
  return c.json(task, 201);
});

studioops.patch('/tasks/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const sql = getSQL(c.env);
  const rows = await sql`SELECT t.*, w.owner_user_id FROM workflow_tasks t JOIN workflows w ON w.id = t.workflow_id WHERE t.id = ${id}`;
  if (!rows.length) { await sql.end(); return c.json({ error: 'Not found' }, 404); }
  const cur: any = rows[0];
  // Allowed: admin, workflow owner, or the assignee (status updates only for assignees)
  const isOwnerOrAdmin = user.role === 'admin' || cur.owner_user_id === user.id;
  const isAssignee = cur.assigned_to === user.id;
  if (!isOwnerOrAdmin && !isAssignee) { await sql.end(); return c.json({ error: 'Forbidden' }, 403); }

  const next = {
    title: isOwnerOrAdmin && data.title !== undefined ? data.title : cur.title,
    description: isOwnerOrAdmin && data.description !== undefined ? data.description : cur.description,
    assigned_to: isOwnerOrAdmin && data.assigned_to !== undefined ? data.assigned_to : cur.assigned_to,
    status: TASK_STATUSES.includes(data.status) ? data.status : cur.status,
    due_date: isOwnerOrAdmin && data.due_date !== undefined ? data.due_date : cur.due_date,
  };
  await sql`UPDATE workflow_tasks SET title = ${next.title}, description = ${next.description}, assigned_to = ${next.assigned_to}, status = ${next.status}, due_date = ${next.due_date}, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  await sql.end();
  await logAction(c.env, cur.workflow_id, 'task_updated', user.id, { task_id: id, status: next.status });
  return c.json({ ok: true });
});

studioops.delete('/tasks/:id', async (c) => {
  const user = await requireAdmin(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM workflow_tasks WHERE id = ?').bind(id).run();
  await logAction(c.env, null, 'task_deleted', user.id, { task_id: id });
  return c.json({ ok: true });
});

// --------- AI: strategic review ---------

studioops.get('/strategic-review/:projectId', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60/hour)' }, 429);
  const projectId = parseInt(c.req.param('projectId'));
  const sql = getSQL(c.env);
  const projects = await sql`SELECT * FROM projects WHERE id = ${projectId}`;
  if (!projects.length) { await sql.end(); return c.json({ error: 'Project not found' }, 404); }
  const p: any = projects[0];
  // IDOR guard: founders can only run strategic review on their own project.
  if (!canAccessFounderResource(user as any, p.founder_id)) {
    await sql.end();
    return c.json({ detail: 'Forbidden: you do not own this project' }, 403);
  }
  const snapshots = await sql`SELECT * FROM score_snapshots WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  const snap: any = snapshots[0] || null;
  await sql.end();

  const metrics = {
    name: p.name, sector: p.sector, stage: p.stage, status: p.status,
    tam: p.tam, sam: p.sam, funding_needed: p.funding_needed, cost_to_mvp: p.cost_to_mvp,
    score: snap?.total_score, tier: snap?.tier,
  };

  const ai = await llmText(c.env,
    'You are a venture-studio managing partner. Analyze a portfolio project and recommend one of: CONTINUE, ITERATE, SPIN-OUT, or KILL. Be decisive and concise.',
    `Project metrics: ${JSON.stringify(metrics)}\n\nWrite (1) a 2-3 sentence assessment, (2) the recommendation in CAPS, (3) 3 concrete next actions as a numbered list.`
  );
  await logAction(c.env, null, 'ai_call', user.id, { kind: 'strategic_review', project_id: projectId });

  let rec = 'ITERATE';
  if (snap?.total_score >= 85) rec = 'SPIN-OUT';
  else if (snap?.total_score >= 70) rec = 'CONTINUE';
  else if (snap?.total_score && snap.total_score < 50) rec = 'KILL';

  return c.json({
    project: { id: p.id, name: p.name, sector: p.sector, stage: p.stage, status: p.status },
    metrics, rule_recommendation: rec,
    ai_summary: ai || `Rule-based assessment: score ${snap?.total_score || 'N/A'} (${snap?.tier || 'unscored'}). Recommendation: ${rec}.`,
    model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'rule-based',
  });
});

// --------- AI: task description / checklist ---------

studioops.post('/ai-assist', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  if (!(await checkAiQuota(c.env, user.id))) return c.json({ error: 'Rate limit (60/hour)' }, 429);
  let data: any;
  try { data = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const kind = data.kind; // 'task_description' | 'checklist' | 'summary'
  const context = (data.context || '').toString().slice(0, 2000);
  if (!['task_description', 'checklist', 'summary'].includes(kind)) return c.json({ error: 'Invalid kind' }, 400);

  const systems: Record<string, string> = {
    task_description: 'You write clear, actionable task descriptions for venture studio operators. Output 2-3 sentences max.',
    checklist: 'You generate compliance/operations checklists. Output a numbered list of 4-7 concrete steps. No prose.',
    summary: 'You summarize finance/HR/ops reports. Output 3-4 bullet points with the key numbers and risks.',
  };
  const ai = await llmText(c.env, systems[kind], context);
  await logAction(c.env, data.workflow_id || null, 'ai_call', user.id, { kind });
  return c.json({ result: ai || 'AI service unavailable. Please draft manually.', model: ai ? '@cf/meta/llama-3.1-8b-instruct' : 'unavailable' });
});

// --------- Auto-trigger: called when a project advances ---------

export async function autoCreateStudioOpsForProject(env: Env, projectId: number, newStatus: string, ownerUserId: number) {
  await ensureSchema(env);
  // Only fire on tier_1 (spinout-ready) or tier_2 (traction review)
  const triggers: Record<string, string[]> = {
    tier_1: ['legal.equity', 'legal.safe', 'finance.cap_table', 'strategic.decision_gate'],
    tier_2: ['strategic.traction_review', 'finance.budget'],
  };
  const keys = triggers[newStatus];
  if (!keys) return;

  // Skip if already created
  const existing = await env.DB.prepare(`SELECT template_key FROM workflows WHERE project_id = ? AND template_key IN (${keys.map(() => '?').join(',')})`).bind(projectId, ...keys).all();
  const existingKeys = new Set((existing.results || []).map((r: any) => r.template_key));

  for (const key of keys) {
    if (existingKeys.has(key)) continue;
    const tpl = TEMPLATES.find(t => t.key === key);
    if (!tpl) continue;
    try {
      // INSERT OR IGNORE on the unique (project_id, template_key) index = atomic dedup under concurrency
      const r: any = await env.DB.prepare(`INSERT OR IGNORE INTO workflows (type, title, description, status, project_id, template_key, owner_user_id) VALUES (?, ?, ?, 'active', ?, ?, ?) RETURNING id`)
        .bind(tpl.type, tpl.title, tpl.description, projectId, tpl.key, ownerUserId).first();
      if (r?.id) {
        for (let i = 0; i < tpl.tasks.length; i++) {
          await env.DB.prepare(`INSERT INTO workflow_tasks (workflow_id, title, sort_order) VALUES (?, ?, ?)`).bind(r.id, tpl.tasks[i], i).run();
        }
        await logAction(env, r.id, 'workflow_auto_created', ownerUserId, { trigger: newStatus, template: key, project_id: projectId });
      }
    } catch {}
  }
}

// --------- Audit log ---------

studioops.get('/audit', async (c) => {
  await requireAdmin(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT l.*, u.name as user_name, u.email as user_email
    FROM shared_services_log l LEFT JOIN users u ON u.id = l.performed_by
    ORDER BY l.created_at DESC LIMIT 500
  `;
  await sql.end();
  return c.json(rows);
});

// --------- Stats for dashboard ---------

studioops.get('/stats', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const sql = getSQL(c.env);
  const byType = await sql`SELECT type, status, COUNT(*) as n FROM workflows GROUP BY type, status`;
  const taskByStatus = await sql`SELECT status, COUNT(*) as n FROM workflow_tasks GROUP BY status`;
  const myAssigned = await sql`SELECT COUNT(*) as n FROM workflow_tasks WHERE assigned_to = ${user.id} AND status != 'done'`;
  const aiCallsToday = await sql`SELECT COUNT(*) as n FROM shared_services_log WHERE action_type = 'ai_call' AND created_at > datetime('now', '-1 day')`;
  await sql.end();
  return c.json({ workflows_by_type: byType, tasks_by_status: taskByStatus, my_open_tasks: parseInt(myAssigned[0]?.n) || 0, ai_calls_today: parseInt(aiCallsToday[0]?.n) || 0 });
});

export default studioops;
