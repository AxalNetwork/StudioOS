/**
 * Task #8 — Customer Discovery + Roadmap (worker port of
 * backend/app/api/routes/progress.py, discovery & roadmap surfaces only).
 *
 * Endpoints (mounted at /api/progress in index.ts):
 *   GET    /discovery/:projectId              — list interviews
 *   POST   /discovery/:projectId              — create interview
 *   PUT    /discovery/interview/:id           — update interview
 *   DELETE /discovery/interview/:id           — delete interview
 *   GET    /roadmap/:projectId                — list OKRs
 *   POST   /roadmap/:projectId                — create OKR
 *   PUT    /roadmap/okr/:id                   — update OKR
 *   DELETE /roadmap/okr/:id                   — delete OKR
 *   POST   /roadmap/okr/:id/move              — move OKR (kanban_status + order)
 *
 * Authorization mirrors the FastAPI helpers:
 *   admin / partner / investor   — read any project
 *   admin / founder (own project) — may write
 *   anyone else                  — 403
 *
 * The metrics sub-surface and /signals aggregator are intentionally OUT OF
 * SCOPE for this task — see .local/tasks/task-8.md.
 *
 * NOTE on column naming: the task brief proposed shorter column names
 * (interviewee / key_quotes / pain_points / solution_fit). The shipping
 * frontend (DiscoveryPage.jsx, RoadmapPage.jsx) however calls these
 * endpoints with the FastAPI field names (interviewee_name,
 * interviewee_role, interview_date, notes, hypotheses, pains, quarter).
 * Since the task's "Done looks like" criteria require the existing pages
 * to work without frontend changes, the schema and request/response
 * payloads here align with the FastAPI contract instead. See replit.md
 * Gotchas for the rationale.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, canAccessFounderResource } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { ensureTier, ensureTierSchema, FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';

const progress = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Authorization helpers (mirror financials.ts).
// ---------------------------------------------------------------------------
type Project = { id: number; name: string; founder_id: number | null };

async function loadProject(env: Env, projectId: number): Promise<Project | null> {
  const row = await env.DB.prepare(
    'SELECT id, name, founder_id FROM projects WHERE id = ?',
  ).bind(projectId).first<Project>();
  return row || null;
}

function isPrivileged(role: User['role']): boolean {
  return role === 'admin' || role === 'partner' || role === 'investor';
}

function ensureCanView(project: Project, user: User): void {
  if (isPrivileged(user.role)) return;
  if (!canAccessFounderResource(user, project.founder_id)) {
    throw new Error('Forbidden');
  }
}

function ensureCanEdit(project: Project, user: User): void {
  if (user.role === 'admin') return;
  if (user.role === 'founder') {
    if (!canAccessFounderResource(user, project.founder_id)) {
      throw new Error('Forbidden');
    }
    return;
  }
  throw new Error('Forbidden');
}

function safeJsonParseArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function asStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return typeof v === 'string' ? v : String(v);
}

function asArrayOrEmpty<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function toNumberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// D1Result.meta is typed but TS lib versions vary; this narrow helper keeps
// the call sites free of `as any` while still extracting the autoincrement id.
function lastInsertId(res: D1Result<unknown>): number {
  const meta = res.meta as { last_row_id?: number } | undefined;
  const id = meta?.last_row_id;
  return typeof id === 'number' ? id : 0;
}

// Today (YYYY-MM-DD) — matches FastAPI's `date.today()` default for
// interview_date when the client omits it.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
type InterviewRow = {
  id: number;
  project_id: number;
  interviewee_name: string;
  interviewee_role: string | null;
  interview_date: string | null;
  notes: string | null;
  hypotheses_json: string | null;
  pains_json: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const VALID_HYPOTHESIS_STATUSES = new Set(['validated', 'invalidated', 'inconclusive']);

type HypothesisItem = { hypothesis: string; status: string; evidence: string | null };

function normalizeHypotheses(raw: unknown): HypothesisItem[] {
  return asArrayOrEmpty<Record<string, unknown>>(raw).map((h) => {
    const status = (asStringOrNull(h.status) || 'inconclusive').toLowerCase();
    return {
      hypothesis: asStringOrNull(h.hypothesis) || '',
      status: VALID_HYPOTHESIS_STATUSES.has(status) ? status : 'inconclusive',
      evidence: asStringOrNull(h.evidence),
    };
  });
}

function normalizePains(raw: unknown): string[] {
  return asArrayOrEmpty(raw)
    .map((p) => (typeof p === 'string' ? p : String(p ?? '')))
    .filter((p) => p.trim().length > 0);
}

function serializeInterview(r: InterviewRow) {
  return {
    id: r.id,
    project_id: r.project_id,
    interviewee_name: r.interviewee_name,
    interviewee_role: r.interviewee_role,
    interview_date: r.interview_date,
    notes: r.notes ?? '',
    hypotheses: safeJsonParseArray(r.hypotheses_json),
    pains: safeJsonParseArray(r.pains_json),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const INTERVIEW_SELECT =
  `SELECT id, project_id, interviewee_name, interviewee_role, interview_date,
          notes, hypotheses_json, pains_json, created_at, updated_at
     FROM discovery_interviews`;

progress.get('/discovery/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  const { results } = await c.env.DB.prepare(
    `${INTERVIEW_SELECT}
      WHERE project_id = ?
      ORDER BY (interview_date IS NULL), interview_date DESC, id DESC`,
  ).bind(projectId).all<InterviewRow>();

  return c.json({
    project_id: projectId,
    interviews: (results || []).map(serializeInterview),
  });
});

progress.post('/discovery/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  // Task #6 — free-tier discovery interview cap.
  if (user.role === 'founder' && !userMeetsTier(user, 'growth')) {
    await ensureTierSchema(c.env);
    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?',
    ).bind(projectId).first<{ n: number }>();
    if (Number(existing?.n ?? 0) >= FREE_TIER_LIMITS.discoveryInterviews) {
      ensureTier(user, 'growth');
    }
  }

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return c.json({ detail: 'Body required' }, 400);
  }
  const intervieweeName = asStringOrNull(body.interviewee_name);
  if (!intervieweeName || !intervieweeName.trim()) {
    return c.json({ detail: 'interviewee_name is required' }, 400);
  }
  const intervieweeRole = asStringOrNull(body.interviewee_role);
  const interviewDate = asStringOrNull(body.interview_date) || todayIso();
  const notes = asStringOrNull(body.notes) ?? '';
  const hypotheses = normalizeHypotheses(body.hypotheses);
  const pains = normalizePains(body.pains);
  const nowIso = new Date().toISOString();

  const res = await c.env.DB.prepare(
    `INSERT INTO discovery_interviews
       (project_id, interviewee_name, interviewee_role, interview_date,
        notes, hypotheses_json, pains_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    projectId, intervieweeName, intervieweeRole, interviewDate,
    notes, JSON.stringify(hypotheses), JSON.stringify(pains),
    nowIso, nowIso,
  ).run();

  const newId = lastInsertId(res);
  const row = await c.env.DB.prepare(`${INTERVIEW_SELECT} WHERE id = ?`)
    .bind(newId).first<InterviewRow>();

  // Activity log — hashed actor per T22.1 convention.
  try {
    const actorHash = await hashEmail(user.email);
    await c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      'interview_logged',
      `Project ${project.name}: ${intervieweeName}`,
      actorHash, user.id, projectId,
    ).run();
  } catch {
    // Activity logging must never block the write.
  }

  return c.json(serializeInterview(row as InterviewRow));
});

progress.put('/discovery/interview/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(`${INTERVIEW_SELECT} WHERE id = ?`)
    .bind(id).first<InterviewRow>();
  if (!existing) return c.json({ detail: 'Interview not found' }, 404);

  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return c.json({ detail: 'Body required' }, 400);
  }
  const intervieweeName = asStringOrNull(body.interviewee_name);
  if (!intervieweeName || !intervieweeName.trim()) {
    return c.json({ detail: 'interviewee_name is required' }, 400);
  }
  const intervieweeRole = asStringOrNull(body.interviewee_role);
  const interviewDate = asStringOrNull(body.interview_date) || existing.interview_date;
  const notes = asStringOrNull(body.notes) ?? '';
  const hypotheses = normalizeHypotheses(body.hypotheses);
  const pains = normalizePains(body.pains);

  await c.env.DB.prepare(
    `UPDATE discovery_interviews
        SET interviewee_name = ?, interviewee_role = ?, interview_date = ?,
            notes = ?, hypotheses_json = ?, pains_json = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    intervieweeName, intervieweeRole, interviewDate,
    notes, JSON.stringify(hypotheses), JSON.stringify(pains),
    new Date().toISOString(), id,
  ).run();

  const row = await c.env.DB.prepare(`${INTERVIEW_SELECT} WHERE id = ?`)
    .bind(id).first<InterviewRow>();
  return c.json(serializeInterview(row as InterviewRow));
});

progress.delete('/discovery/interview/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id FROM discovery_interviews WHERE id = ?',
  ).bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'Interview not found' }, 404);

  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  await c.env.DB.prepare('DELETE FROM discovery_interviews WHERE id = ?').bind(id).run();
  return c.json({ deleted: id });
});

// ---------------------------------------------------------------------------
// Roadmap (OKR kanban)
// ---------------------------------------------------------------------------
const KANBAN_STATUSES = new Set(['now', 'next', 'later', 'done']);

type OkrRow = {
  id: number;
  project_id: number;
  objective: string;
  key_results_json: string | null;
  kanban_status: string;
  quarter: string | null;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
};

type KeyResult = {
  text: string;
  target: number | null;
  current: number | null;
  unit: string | null;
};

function normalizeKeyResults(raw: unknown): KeyResult[] {
  return asArrayOrEmpty<Record<string, unknown>>(raw).map((kr) => {
    const text = asStringOrNull(kr.text) || '';
    const target = kr.target == null || kr.target === '' ? null : Number(kr.target);
    const current = kr.current == null || kr.current === '' ? null : Number(kr.current);
    return {
      text,
      target: target != null && Number.isFinite(target) ? target : null,
      current: current != null && Number.isFinite(current) ? current : null,
      unit: asStringOrNull(kr.unit),
    };
  });
}

function serializeOkr(r: OkrRow) {
  const krs = safeJsonParseArray<Partial<KeyResult>>(r.key_results_json);
  // Compute aggregate progress as the average of (current/target) ratios,
  // clamped to [0, 1]. Mirrors backend.app.api.routes.progress._serialize_okr.
  let progress: number | null = null;
  if (krs.length > 0) {
    const ratios: number[] = [];
    for (const kr of krs) {
      const tgt = typeof kr.target === 'number' ? kr.target : null;
      const cur = typeof kr.current === 'number' ? kr.current : null;
      if (tgt != null && tgt !== 0 && cur != null) {
        ratios.push(Math.max(0, Math.min(1, cur / tgt)));
      }
    }
    if (ratios.length > 0) {
      progress = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000;
    }
  }
  return {
    id: r.id,
    project_id: r.project_id,
    objective: r.objective,
    key_results: krs,
    kanban_status: r.kanban_status,
    quarter: r.quarter,
    sort_order: r.sort_order,
    progress,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const OKR_SELECT =
  `SELECT id, project_id, objective, key_results_json, kanban_status,
          quarter, sort_order, created_at, updated_at
     FROM roadmap_okrs`;

progress.get('/roadmap/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  const { results } = await c.env.DB.prepare(
    `${OKR_SELECT}
      WHERE project_id = ?
      ORDER BY kanban_status, sort_order, id`,
  ).bind(projectId).all<OkrRow>();

  return c.json({
    project_id: projectId,
    okrs: (results || []).map(serializeOkr),
  });
});

progress.post('/roadmap/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  // Task #6 — free-tier OKR cap.
  if (user.role === 'founder' && !userMeetsTier(user, 'growth')) {
    await ensureTierSchema(c.env);
    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM roadmap_okrs WHERE project_id = ?',
    ).bind(projectId).first<{ n: number }>();
    if (Number(existing?.n ?? 0) >= FREE_TIER_LIMITS.roadmapOkrs) {
      ensureTier(user, 'growth');
    }
  }

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ detail: 'Body required' }, 400);

  const objective = asStringOrNull(body.objective);
  if (!objective || !objective.trim()) {
    return c.json({ detail: 'objective is required' }, 400);
  }
  const kanbanStatus = (asStringOrNull(body.kanban_status) || 'now').toLowerCase();
  if (!KANBAN_STATUSES.has(kanbanStatus)) {
    return c.json({
      detail: `kanban_status must be one of ${[...KANBAN_STATUSES].sort().join(', ')}`,
    }, 400);
  }
  const keyResults = normalizeKeyResults(body.key_results);
  const quarter = asStringOrNull(body.quarter);
  const sortOrder = toNumberOr(body.sort_order, 0);
  const nowIso = new Date().toISOString();

  const res = await c.env.DB.prepare(
    `INSERT INTO roadmap_okrs
       (project_id, objective, key_results_json, kanban_status,
        quarter, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    projectId, objective, JSON.stringify(keyResults),
    kanbanStatus, quarter, sortOrder, nowIso, nowIso,
  ).run();

  const newId = lastInsertId(res);
  const row = await c.env.DB.prepare(`${OKR_SELECT} WHERE id = ?`)
    .bind(newId).first<OkrRow>();
  return c.json(serializeOkr(row as OkrRow));
});

progress.put('/roadmap/okr/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id FROM roadmap_okrs WHERE id = ?',
  ).bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'OKR not found' }, 404);

  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ detail: 'Body required' }, 400);

  const objective = asStringOrNull(body.objective);
  if (!objective || !objective.trim()) {
    return c.json({ detail: 'objective is required' }, 400);
  }
  const kanbanStatus = (asStringOrNull(body.kanban_status) || 'now').toLowerCase();
  if (!KANBAN_STATUSES.has(kanbanStatus)) {
    return c.json({
      detail: `kanban_status must be one of ${[...KANBAN_STATUSES].sort().join(', ')}`,
    }, 400);
  }
  const keyResults = normalizeKeyResults(body.key_results);
  const quarter = asStringOrNull(body.quarter);
  const sortOrder = toNumberOr(body.sort_order, 0);

  await c.env.DB.prepare(
    `UPDATE roadmap_okrs
        SET objective = ?, key_results_json = ?, kanban_status = ?,
            quarter = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    objective, JSON.stringify(keyResults), kanbanStatus,
    quarter, sortOrder, new Date().toISOString(), id,
  ).run();

  const row = await c.env.DB.prepare(`${OKR_SELECT} WHERE id = ?`)
    .bind(id).first<OkrRow>();
  return c.json(serializeOkr(row as OkrRow));
});

progress.delete('/roadmap/okr/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id FROM roadmap_okrs WHERE id = ?',
  ).bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'OKR not found' }, 404);

  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  await c.env.DB.prepare('DELETE FROM roadmap_okrs WHERE id = ?').bind(id).run();
  return c.json({ deleted: id });
});

progress.post('/roadmap/okr/:id/move', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id FROM roadmap_okrs WHERE id = ?',
  ).bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'OKR not found' }, 404);

  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ detail: 'Body required' }, 400);

  const kanbanStatus = (asStringOrNull(body.kanban_status) || '').toLowerCase();
  if (!KANBAN_STATUSES.has(kanbanStatus)) {
    return c.json({
      detail: `kanban_status must be one of ${[...KANBAN_STATUSES].sort().join(', ')}`,
    }, 400);
  }
  const sortOrder = toNumberOr(body.sort_order, 0);

  await c.env.DB.prepare(
    `UPDATE roadmap_okrs
        SET kanban_status = ?, sort_order = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(kanbanStatus, sortOrder, new Date().toISOString(), id).run();

  const row = await c.env.DB.prepare(`${OKR_SELECT} WHERE id = ?`)
    .bind(id).first<OkrRow>();
  return c.json(serializeOkr(row as OkrRow));
});

// ---------------------------------------------------------------------------
// Signals — minimal port of FastAPI's /signals/:project_id aggregator.
//
// DiscoveryPage refreshes call this in parallel with /discovery/:projectId
// (Promise.all), so a 404 here would crash the discovery refresh. Until the
// metrics sub-surface ships (follow-up task) the users / revenue sliders
// report 0 with the same `reason: "no_metrics"` shape FastAPI returns when
// no MetricsSnapshot rows exist; the interview-derived signals slider works
// fully off the discovery_interviews table.
// ---------------------------------------------------------------------------
type SliderMeta = Record<string, unknown>;

function signalsSlider(rows: Array<{ hypotheses_json: string | null }>): {
  score: number;
  meta: SliderMeta;
} {
  if (rows.length === 0) {
    return { score: 0, meta: { reason: 'no_interviews' } };
  }
  const total = rows.length;
  let validated = 0;
  let invalidated = 0;
  for (const r of rows) {
    for (const h of safeJsonParseArray<Record<string, unknown>>(r.hypotheses_json)) {
      const status = (asStringOrNull(h.status) || '').toLowerCase();
      if (status === 'validated') validated += 1;
      else if (status === 'invalidated') invalidated += 1;
    }
  }
  const cadence = Math.max(0, Math.min(5, total / 4));
  const learning = Math.max(0, Math.min(5, validated * 0.5));
  const score = Math.max(0, Math.min(10, cadence + learning));
  return {
    score: Math.round(score * 100) / 100,
    meta: {
      interviews: total,
      validated_hypotheses: validated,
      invalidated_hypotheses: invalidated,
    },
  };
}

progress.get('/signals/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  const interviews = await c.env.DB.prepare(
    'SELECT hypotheses_json FROM discovery_interviews WHERE project_id = ?',
  ).bind(projectId).all<{ hypotheses_json: string | null }>();

  const okrs = await c.env.DB.prepare(
    'SELECT kanban_status FROM roadmap_okrs WHERE project_id = ?',
  ).bind(projectId).all<{ kanban_status: string }>();

  const okrRows = okrs.results || [];
  const okrsDone = okrRows.filter((o) => o.kanban_status === 'done').length;
  const interviewRows = interviews.results || [];

  const sig = signalsSlider(interviewRows);
  // Users + revenue sliders require the metrics_snapshots table, which is
  // out of scope for Task #8 — return zero with the same `reason` field
  // FastAPI emits when no snapshots exist.
  const usersScore = 0;
  const revenueScore = 0;
  const usersPts = 0;
  const revenuePts = 0;
  const signalsPts = Math.round((sig.score / 10) * 3 * 100) / 100;
  const total = Math.round(Math.min(usersPts + revenuePts + signalsPts, 15) * 100) / 100;

  return c.json({
    project_id: projectId,
    category: 'traction',
    max: 15,
    total,
    factors: {
      users:   { raw: usersScore,   points: usersPts,   max: 6, label: 'User adoption',       meta: { reason: 'no_metrics' } },
      revenue: { raw: revenueScore, points: revenuePts, max: 6, label: 'Revenue / pipeline',  meta: { reason: 'no_metrics' } },
      signals: { raw: sig.score,    points: signalsPts, max: 3, label: 'Validation signals',  meta: sig.meta },
    },
    summary: {
      interviews: interviewRows.length,
      okrs_total: okrRows.length,
      okrs_done: okrsDone,
      latest_metrics_date: null,
      latest_mrr: null,
      latest_active_users: null,
    },
  });
});

// ---------------------------------------------------------------------------
// Metrics snapshots — Task #1 (AG). Founders log periodic MRR / active-user
// metrics; readers see them on the project dashboard. The /signals slider
// stays as-is (zero out users/revenue) — wiring those is a follow-up.
// ---------------------------------------------------------------------------
type MetricsSnapshot = {
  id: number;
  project_id: number;
  snapshot_date: string;
  mrr: number | null;
  active_users: number | null;
  notes: string | null;
  source: string | null;
  created_by: number | null;
  created_at: string;
};

type SerializedSnap = {
  id: number;
  project_id: number;
  snapshot_date: string;
  mrr: number | null;
  active_users: number | null;
  notes: string | null;
  source: string | null;
  created_at: string;
};

function serializeSnap(s: MetricsSnapshot): SerializedSnap {
  return {
    id: s.id,
    project_id: s.project_id,
    snapshot_date: s.snapshot_date,
    mrr: s.mrr,
    active_users: s.active_users,
    notes: s.notes,
    source: s.source,
    created_at: s.created_at,
  };
}

progress.get('/metrics/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM metrics_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 200`,
  ).bind(projectId).all<MetricsSnapshot>();
  return c.json({ items: (rows.results || []).map(serializeSnap) });
});

progress.post('/metrics/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const dateRaw = String(body?.snapshot_date || '').trim();
  const snapshotDate = dateRaw || new Date().toISOString().slice(0, 10);
  const mrr = body?.mrr != null && body.mrr !== '' && Number.isFinite(Number(body.mrr)) ? Number(body.mrr) : null;
  const activeUsers = body?.active_users != null && body.active_users !== '' && Number.isFinite(Number(body.active_users)) ? Number(body.active_users) : null;
  const notes = body?.notes ? String(body.notes).slice(0, 4000) : null;
  const source = body?.source ? String(body.source).slice(0, 80) : 'manual';
  const r = await c.env.DB.prepare(
    `INSERT INTO metrics_snapshots
       (project_id, snapshot_date, mrr, active_users, notes, source, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(projectId, snapshotDate, mrr, activeUsers, notes, source, user.id).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM metrics_snapshots WHERE id = ?')
    .bind(r.meta.last_row_id).first<MetricsSnapshot>();
  return c.json(serializeSnap(fresh as MetricsSnapshot));
});

progress.delete('/metrics/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const existing = await c.env.DB.prepare('SELECT id, project_id FROM metrics_snapshots WHERE id = ?')
    .bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'Snapshot not found' }, 404);
  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  await c.env.DB.prepare('DELETE FROM metrics_snapshots WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

progress.post('/metrics/:projectId/import-stripe', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  // Stripe ingestion is not yet wired in the worker — return a typed
  // empty success so the SPA's import button doesn't crash.
  return c.json({ ok: true, imported: 0, source: 'stripe', detail: 'not_configured' });
});

export default progress;
