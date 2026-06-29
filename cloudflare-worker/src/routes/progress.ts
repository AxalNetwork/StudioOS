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
 *   admin / partner              — read any project
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
import {
  ensureDiscoveryInterviewFeaturedColumn,
  ensureDiscoveryValidationRatingColumns,
} from '../services/discoveryInterviewSchema';
import {
  ensurePainGroupsSchema,
  getPainGroupsView,
  materializeTitleNormAliases,
  normPhrase,
  type PainGroupRow,
} from '../services/painGroups';
import { syncStripeForUser } from '../integrations/providers/stripe';

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
  // Task #3 (DF) — investor removed from read-allowlist per IDOR contract.
  return role === 'admin' || role === 'partner';
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
  featured: number | null;
  validation_rating: number | null;
  validation_comment: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/**
 * Task #14 — coerce an arbitrary validation_rating input into a 0–5
 * integer or null. Any out-of-range / non-numeric / undefined value
 * returns null so the column stays NULL rather than 0 (which would
 * skew the RatingDistribution chart on the Demo Day deck).
 */
function asValidationRating(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!isFinite(n)) return null;
  const r = Math.round(n);
  if (r < 0 || r > 5) return null;
  return r;
}

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
    featured: Number(r.featured ?? 0) === 1,
    // Task #14 — 0–5 founder rating of "how well does our solution
    // address the problem?" + free-text comment. Both null until the
    // founder fills them in.
    validation_rating: r.validation_rating == null ? null : Number(r.validation_rating),
    validation_comment: r.validation_comment ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const INTERVIEW_SELECT =
  `SELECT id, project_id, interviewee_name, interviewee_role, interview_date,
          notes, hypotheses_json, pains_json, featured,
          validation_rating, validation_comment,
          created_at, updated_at
     FROM discovery_interviews`;

function asFeaturedFlag(raw: unknown): number {
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (typeof raw === 'string' && raw.toLowerCase() === 'true') return 1;
  return 0;
}

progress.get('/discovery/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  await ensureDiscoveryInterviewFeaturedColumn(c.env);
  await ensureDiscoveryValidationRatingColumns(c.env);
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
  const featured = asFeaturedFlag(body.featured);
  const validationRating = asValidationRating(body.validation_rating);
  const validationComment = asStringOrNull(body.validation_comment);
  const nowIso = new Date().toISOString();

  await ensureDiscoveryInterviewFeaturedColumn(c.env);
  await ensureDiscoveryValidationRatingColumns(c.env);
  const res = await c.env.DB.prepare(
    `INSERT INTO discovery_interviews
       (project_id, interviewee_name, interviewee_role, interview_date,
        notes, hypotheses_json, pains_json, featured,
        validation_rating, validation_comment,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    projectId, intervieweeName, intervieweeRole, interviewDate,
    notes, JSON.stringify(hypotheses), JSON.stringify(pains),
    featured, validationRating, validationComment,
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
  // `featured` is optional on update — when omitted, preserve the existing
  // flag so partial payloads (e.g. the modal save that pre-dated Task #18)
  // don't accidentally clear a founder's star.
  const featured = Object.prototype.hasOwnProperty.call(body, 'featured')
    ? asFeaturedFlag(body.featured)
    : Number(existing.featured ?? 0);
  // Task #14 — preserve existing rating / comment when fields omitted
  // so partial saves (the legacy modal that pre-dates this column)
  // don't wipe the founder's pulse on a re-save.
  const validationRating = Object.prototype.hasOwnProperty.call(body, 'validation_rating')
    ? asValidationRating(body.validation_rating)
    : (existing.validation_rating == null ? null : Number(existing.validation_rating));
  const validationComment = Object.prototype.hasOwnProperty.call(body, 'validation_comment')
    ? asStringOrNull(body.validation_comment)
    : (existing.validation_comment ?? null);

  await ensureDiscoveryInterviewFeaturedColumn(c.env);
  await ensureDiscoveryValidationRatingColumns(c.env);
  await c.env.DB.prepare(
    `UPDATE discovery_interviews
        SET interviewee_name = ?, interviewee_role = ?, interview_date = ?,
            notes = ?, hypotheses_json = ?, pains_json = ?, featured = ?,
            validation_rating = ?, validation_comment = ?, updated_at = ?
      WHERE id = ?`,
  ).bind(
    intervieweeName, intervieweeRole, interviewDate,
    notes, JSON.stringify(hypotheses), JSON.stringify(pains),
    featured, validationRating, validationComment,
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
// Pain groups (Task #29) — founder-curated grouping of logged discovery
// pains that feeds the Spin-Out deck's "PAIN FREQUENCY ACROSS INTERVIEWS"
// slide. Logged pains stay plain strings; these endpoints only manage the
// curation layer (theme titles + phrase→group aliases).
// ---------------------------------------------------------------------------
const MAX_PAIN_TITLE = 120;
const MAX_PAIN_PHRASE = 200;

function cleanPainTitle(raw: unknown): string | null {
  const s = asStringOrNull(raw);
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, MAX_PAIN_TITLE);
}

async function loadPainGroup(env: Env, groupId: number): Promise<PainGroupRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, project_id, title, sort_order, created_at, updated_at
       FROM pain_groups WHERE id = ?`,
  ).bind(groupId).first<PainGroupRow>();
  return row || null;
}

async function nextPainSort(env: Env, projectId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM pain_groups WHERE project_id = ?',
  ).bind(projectId).first<{ m: number }>();
  return Number(row?.m ?? -1) + 1;
}

progress.get('/pain-groups/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);

  await ensureDiscoveryInterviewFeaturedColumn(c.env);
  const view = await getPainGroupsView(c.env, projectId);
  return c.json(view);
});

// Assign (or re-assign) a logged pain phrase to a group. Body:
//   { phrase, group_id }            — move the phrase into an existing group
//   { phrase, new_title }           — create a group titled new_title + assign
//   { phrase }  /  { phrase, group_id: null } — un-assign (back to implicit)
progress.post('/pain-groups/:projectId/assign', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return c.json({ detail: 'Body required' }, 400);

  const phraseRaw = asStringOrNull(body.phrase);
  const display = (phraseRaw || '').trim().slice(0, MAX_PAIN_PHRASE);
  const norm = normPhrase(display);
  if (!display || !norm) return c.json({ detail: 'phrase is required' }, 400);

  await ensurePainGroupsSchema(c.env);
  const nowIso = new Date().toISOString();

  const newTitle = cleanPainTitle(body.new_title);
  const hasGroupId = Object.prototype.hasOwnProperty.call(body, 'group_id') && body.group_id != null;

  if (!newTitle && !hasGroupId) {
    // Un-assign: drop any explicit alias so the phrase reverts to its own
    // implicit theme.
    await c.env.DB.prepare(
      'DELETE FROM pain_group_aliases WHERE project_id = ? AND phrase_norm = ?',
    ).bind(projectId, norm).run();
    return c.json(await getPainGroupsView(c.env, projectId));
  }

  let groupId: number;
  if (newTitle) {
    const sort = await nextPainSort(c.env, projectId);
    const res = await c.env.DB.prepare(
      `INSERT INTO pain_groups (project_id, title, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(projectId, newTitle, sort, nowIso, nowIso).run();
    groupId = lastInsertId(res);
  } else {
    groupId = Number(body.group_id);
    if (!Number.isFinite(groupId)) return c.json({ detail: 'Invalid group_id' }, 400);
    const g = await loadPainGroup(c.env, groupId);
    if (!g || g.project_id !== projectId) return c.json({ detail: 'Group not found' }, 404);
  }

  // Upsert the alias (UNIQUE(project_id, phrase_norm) → exactly one group).
  await c.env.DB.prepare(
    `INSERT INTO pain_group_aliases
       (project_id, group_id, phrase_norm, display_phrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phrase_norm)
       DO UPDATE SET group_id = excluded.group_id,
                     display_phrase = excluded.display_phrase,
                     updated_at = excluded.updated_at`,
  ).bind(projectId, groupId, norm, display, nowIso, nowIso).run();

  return c.json(await getPainGroupsView(c.env, projectId));
});

// Rename a pain group. Body: { title }
progress.patch('/pain-groups/:groupId', async (c) => {
  const user = await requireAuth(c);
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isFinite(groupId)) return c.json({ detail: 'Invalid id' }, 400);

  await ensurePainGroupsSchema(c.env);
  const g = await loadPainGroup(c.env, groupId);
  if (!g) return c.json({ detail: 'Group not found' }, 404);

  const project = await loadProject(c.env, g.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const title = cleanPainTitle(body?.title);
  if (!title) return c.json({ detail: 'title is required' }, 400);

  // Before the title changes, freeze any logged pains that resolve to this
  // group only via its current title-norm into explicit aliases, so the
  // rename doesn't silently move them back to implicit themes.
  if (normPhrase(title) !== normPhrase(g.title)) {
    await materializeTitleNormAliases(c.env, g.project_id, g);
  }

  await c.env.DB.prepare(
    'UPDATE pain_groups SET title = ?, updated_at = ? WHERE id = ?',
  ).bind(title, new Date().toISOString(), groupId).run();

  return c.json(await getPainGroupsView(c.env, g.project_id));
});

// Delete a pain group. Its aliases revert to implicit themes.
progress.delete('/pain-groups/:groupId', async (c) => {
  const user = await requireAuth(c);
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isFinite(groupId)) return c.json({ detail: 'Invalid id' }, 400);

  await ensurePainGroupsSchema(c.env);
  const g = await loadPainGroup(c.env, groupId);
  if (!g) return c.json({ detail: 'Group not found' }, 404);

  const project = await loadProject(c.env, g.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  // Explicit alias delete first — D1 may run with foreign_keys OFF, so we
  // can't rely on ON DELETE CASCADE to clear the alias rows.
  await c.env.DB.prepare('DELETE FROM pain_group_aliases WHERE group_id = ?').bind(groupId).run();
  await c.env.DB.prepare('DELETE FROM pain_groups WHERE id = ?').bind(groupId).run();

  return c.json(await getPainGroupsView(c.env, g.project_id));
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
  arr: number | null;
  cac: number | null;
  ltv: number | null;
  monthly_churn_pct: number | null;
  active_users: number | null;
  new_users: number | null;
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
  arr: number | null;
  cac: number | null;
  ltv: number | null;
  monthly_churn_pct: number | null;
  active_users: number | null;
  new_users: number | null;
  notes: string | null;
  source: string | null;
  created_at: string;
};

// Task #3 (DF) — lazy column ensure for metrics_snapshots. Frontend writes
// cac/ltv/arr/monthly_churn_pct/new_users which the original 2-column
// schema doesn't have. Idempotent PRAGMA + ALTER ADD COLUMN.
let _metricsColsReady = false;
export async function ensureMetricsSnapshotsSchema(env: Env): Promise<void> {
  if (_metricsColsReady) return;
  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(metrics_snapshots)`).all<{ name: string }>();
    const have = new Set((cols.results || []).map((r) => r.name));
    if (have.size === 0) {
      await env.DB.exec(
        `CREATE TABLE IF NOT EXISTS metrics_snapshots (`
          + ` id INTEGER PRIMARY KEY AUTOINCREMENT,`
          + ` project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,`
          + ` snapshot_date TEXT NOT NULL,`
          + ` mrr REAL, arr REAL, cac REAL, ltv REAL, monthly_churn_pct REAL,`
          + ` active_users INTEGER, new_users INTEGER,`
          + ` notes TEXT, source TEXT,`
          + ` created_by INTEGER REFERENCES users(id),`
          + ` created_at TEXT NOT NULL DEFAULT (datetime('now'))`
          + `)`,
      );
      try { await env.DB.exec(
        `CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_project ON metrics_snapshots(project_id, snapshot_date DESC)`,
      ); } catch (e) { void e; }
    } else {
      const required: Array<[string, string]> = [
        ['arr', 'REAL'], ['cac', 'REAL'], ['ltv', 'REAL'],
        ['monthly_churn_pct', 'REAL'], ['new_users', 'INTEGER'],
      ];
      for (const [col, decl] of required) {
        if (!have.has(col)) {
          try { await env.DB.exec(`ALTER TABLE metrics_snapshots ADD COLUMN ${col} ${decl}`); }
          catch (e) { void e; }
        }
      }
    }
    _metricsColsReady = true;
  } catch (e) {
    console.error('[progress] ensureMetricsSnapshotsSchema:', (e as Error).message);
  }
}

function serializeSnap(s: MetricsSnapshot): SerializedSnap {
  return {
    id: s.id,
    project_id: s.project_id,
    snapshot_date: s.snapshot_date,
    mrr: s.mrr,
    arr: s.arr ?? null,
    cac: s.cac ?? null,
    ltv: s.ltv ?? null,
    monthly_churn_pct: s.monthly_churn_pct ?? null,
    active_users: s.active_users,
    new_users: s.new_users ?? null,
    notes: s.notes,
    source: s.source,
    created_at: s.created_at,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

progress.get('/metrics/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);
  await ensureMetricsSnapshotsSchema(c.env);
  let items: SerializedSnap[] = [];
  try {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM metrics_snapshots WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC LIMIT 200`,
    ).bind(projectId).all<MetricsSnapshot>();
    items = (rows.results || []).map(serializeSnap);
  } catch (e) {
    console.error('[progress] metrics GET:', (e as Error).message);
  }
  // Frontend reads `snapshots` (MetricsPage) AND `items` (other consumers).
  return c.json({ items, snapshots: items });
});

progress.post('/metrics/:projectId', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  await ensureMetricsSnapshotsSchema(c.env);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const dateRaw = String(body?.snapshot_date || '').trim();
  const snapshotDate = dateRaw || new Date().toISOString().slice(0, 10);
  const mrr = numOrNull(body?.mrr);
  let arr = numOrNull(body?.arr);
  if (arr == null && mrr != null) arr = mrr * 12;
  const cac = numOrNull(body?.cac);
  const ltv = numOrNull(body?.ltv);
  const churn = numOrNull(body?.monthly_churn_pct);
  const activeUsers = numOrNull(body?.active_users);
  const newUsers = numOrNull(body?.new_users);
  const notes = body?.notes ? String(body.notes).slice(0, 4000) : null;
  const source = body?.source ? String(body.source).slice(0, 80) : 'manual';
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO metrics_snapshots
         (project_id, snapshot_date, mrr, arr, cac, ltv, monthly_churn_pct,
          active_users, new_users, notes, source, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(projectId, snapshotDate, mrr, arr, cac, ltv, churn, activeUsers, newUsers, notes, source, user.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM metrics_snapshots WHERE id = ?')
      .bind(r.meta.last_row_id).first<MetricsSnapshot>();
    return c.json(serializeSnap(fresh as MetricsSnapshot));
  } catch (e) {
    const msg = (e as Error).message || '';
    console.error('[progress] metrics POST:', msg);
    // Schema drift (missing table/column) is recoverable from the FE
    // perspective — surface as 503 + retry hint instead of an opaque 500.
    const drift = /no such (table|column)/i.test(msg);
    return c.json(
      { detail: drift ? 'Metrics store not ready, please retry.' : 'Failed to save snapshot', code: drift ? 'schema_drift' : 'write_failed' },
      drift ? 503 : 500,
    );
  }
});

progress.put('/metrics/snapshot/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  await ensureMetricsSnapshotsSchema(c.env);
  const existing = await c.env.DB.prepare('SELECT id, project_id FROM metrics_snapshots WHERE id = ?')
    .bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'Snapshot not found' }, 404);
  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const fields: Array<[string, unknown]> = [
    ['snapshot_date', body.snapshot_date != null ? String(body.snapshot_date) : undefined],
    ['mrr', body.mrr !== undefined ? numOrNull(body.mrr) : undefined],
    ['arr', body.arr !== undefined ? numOrNull(body.arr) : undefined],
    ['cac', body.cac !== undefined ? numOrNull(body.cac) : undefined],
    ['ltv', body.ltv !== undefined ? numOrNull(body.ltv) : undefined],
    ['monthly_churn_pct', body.monthly_churn_pct !== undefined ? numOrNull(body.monthly_churn_pct) : undefined],
    ['active_users', body.active_users !== undefined ? numOrNull(body.active_users) : undefined],
    ['new_users', body.new_users !== undefined ? numOrNull(body.new_users) : undefined],
    ['notes', body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : undefined],
  ];
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of fields) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    binds.push(v);
  }
  if (sets.length === 0) {
    const cur = await c.env.DB.prepare('SELECT * FROM metrics_snapshots WHERE id = ?').bind(id).first<MetricsSnapshot>();
    return c.json(serializeSnap(cur as MetricsSnapshot));
  }
  binds.push(id);
  try {
    await c.env.DB.prepare(`UPDATE metrics_snapshots SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  } catch (e) {
    const msg = (e as Error).message || '';
    const drift = /no such (table|column)/i.test(msg);
    console.error('[progress] metrics PUT:', msg);
    return c.json(
      { detail: drift ? 'Metrics store not ready, please retry.' : 'Failed to update snapshot', code: drift ? 'schema_drift' : 'write_failed' },
      drift ? 503 : 500,
    );
  }
  const fresh = await c.env.DB.prepare('SELECT * FROM metrics_snapshots WHERE id = ?').bind(id).first<MetricsSnapshot>();
  return c.json(serializeSnap(fresh as MetricsSnapshot));
});

progress.delete('/metrics/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  await ensureMetricsSnapshotsSchema(c.env);
  const existing = await c.env.DB.prepare('SELECT id, project_id FROM metrics_snapshots WHERE id = ?')
    .bind(id).first<{ id: number; project_id: number }>();
  if (!existing) return c.json({ detail: 'Snapshot not found' }, 404);
  const project = await loadProject(c.env, existing.project_id);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);
  await c.env.DB.prepare('DELETE FROM metrics_snapshots WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Task #3 (DF) — time-series aggregator. Returns
// `{ series: [{date, value}, ...] }` so charts can render even when no
// snapshots exist (empty array, not 5xx).
progress.get('/metrics/:projectId/series', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanView(project, user);
  await ensureMetricsSnapshotsSchema(c.env);

  const allowed = new Set(['mrr', 'arr', 'cac', 'ltv', 'monthly_churn_pct', 'active_users', 'new_users']);
  const metric = String(c.req.query('metric') || 'mrr');
  const safeMetric = allowed.has(metric) ? metric : 'mrr';
  const granularity = String(c.req.query('granularity') || 'snapshot'); // snapshot|month
  let series: Array<{ date: string; value: number | null }> = [];
  try {
    if (granularity === 'month') {
      const rows = await c.env.DB.prepare(
        `SELECT substr(snapshot_date, 1, 7) AS bucket, AVG(${safeMetric}) AS v
           FROM metrics_snapshots WHERE project_id = ?
           GROUP BY bucket ORDER BY bucket ASC`,
      ).bind(projectId).all<{ bucket: string; v: number | null }>();
      series = (rows.results || []).map((r) => ({ date: r.bucket, value: r.v }));
    } else {
      const rows = await c.env.DB.prepare(
        `SELECT snapshot_date AS date, ${safeMetric} AS v
           FROM metrics_snapshots WHERE project_id = ?
           ORDER BY snapshot_date ASC, id ASC`,
      ).bind(projectId).all<{ date: string; v: number | null }>();
      series = (rows.results || []).map((r) => ({ date: r.date, value: r.v }));
    }
  } catch (e) {
    console.error('[progress] metrics series:', (e as Error).message);
  }
  return c.json({ project_id: projectId, metric: safeMetric, granularity, series });
});

progress.post('/metrics/:projectId/import-stripe', async (c) => {
  const user = await requireAuth(c);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  const project = await loadProject(c.env, projectId);
  if (!project) return c.json({ detail: 'Project not found' }, 404);
  ensureCanEdit(project, user);

  // Wire the button to the real Stripe sync: read the founder's active Stripe
  // integration, compute live MRR/ARR/churn/customers, and write a
  // `source='stripe'` metrics snapshot for this project. No fake success — each
  // failure mode surfaces a typed code the Metrics page already handles.
  const result = await syncStripeForUser(c.env, user.id, projectId);

  if (!result.ok) {
    // Not connected / credentials missing → prompt to connect or use manual entry.
    if (result.detail === 'not_connected' || result.detail === 'credentials_missing') {
      return c.json({
        detail: {
          code: 'stripe_not_connected',
          message: 'No Stripe billing integration connected. Use manual entry instead.',
        },
      }, 400);
    }
    // Any other failure (e.g. Stripe API error) → readable generic error.
    return c.json({
      detail: { code: 'stripe_sync_failed', message: result.detail || 'Stripe import failed.' },
    }, 502);
  }

  // Connected, but the account has no usable billing data (no active/trialing
  // subscriptions) → existing "connected but no synced data yet" guidance.
  if (!result.mrr && !result.customers) {
    return c.json({
      detail: { code: 'stripe_no_data', message: 'Stripe is connected but has no synced billing data yet.' },
    }, 400);
  }

  return c.json({
    ok: true,
    imported: result.imported,
    source: 'stripe',
    mrr: result.mrr ?? 0,
    customers: result.customers ?? 0,
  });
});

export default progress;
