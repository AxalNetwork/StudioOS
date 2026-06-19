// Venture Risk Rating — 10-layer risk surface for the internal deal team.
//
// Mounted at /api/venture-risk. Read access: admin/partner/investor. Writes
// (compute, layer override): admin/partner. Founders never see this surface.
//
// Endpoints:
//   GET  /portfolio              — latest assessment per active project (matrix)
//   GET  /:projectId             — latest saved assessment, or a fresh preview
//   GET  /:projectId/history     — snapshot trend
//   POST /:projectId/compute     — recompute from platform data + persist
//   PUT  /:projectId/layer/:key  — upsert analyst override, recompute + persist
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import {
  LAYERS,
  computeVentureRisk,
  applyOverrides,
  serializeAssessment,
  type OverrideRow,
  type VentureRiskAssessment,
} from '../services/ventureRisk';

const ventureRisk = new Hono<{ Bindings: Env }>();

const LAYER_KEYS = new Set(LAYERS.map((l) => l.key));
const VALID_BANDS = new Set(['low', 'medium', 'high']);
const VALID_STATUS = new Set(['open', 'mitigating', 'cleared']);

function canRead(role: User['role']): boolean {
  return role === 'admin' || role === 'partner' || role === 'investor';
}
function canWrite(role: User['role']): boolean {
  return role === 'admin' || role === 'partner';
}

async function loadOverrides(env: Env, projectId: number): Promise<OverrideRow[]> {
  try {
    const r = await env.DB.prepare(
      'SELECT layer_key, band, score, status, note, owner_user_id, updated_at FROM venture_risk_overrides WHERE project_id = ?',
    ).bind(projectId).all();
    return (r.results ?? []) as unknown as OverrideRow[];
  } catch {
    return [];
  }
}

async function loadLatest(env: Env, projectId: number): Promise<VentureRiskAssessment | null> {
  const row = await env.DB.prepare(
    `SELECT a.*, p.name AS project_name, p.stage AS stage
     FROM venture_risk_assessments a JOIN projects p ON p.id = a.project_id
     WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 1`,
  ).bind(projectId).first<Record<string, unknown>>();
  return row ? serializeAssessment(row) : null;
}

async function persist(env: Env, a: VentureRiskAssessment, userId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO venture_risk_assessments
       (project_id, overall_risk, overall_band, derisk_score, derisk_pct, layers_json, source, computed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    a.project_id,
    a.overall_risk,
    a.overall_band,
    a.derisk_score,
    a.derisk_pct,
    JSON.stringify(a.layers),
    a.source,
    userId,
  ).run();
}

// Compute auto + merge sticky overrides into a current assessment.
async function computeMerged(env: Env, projectId: number): Promise<VentureRiskAssessment | null> {
  const auto = await computeVentureRisk(env, projectId);
  if (!auto) return null;
  return applyOverrides(auto, await loadOverrides(env, projectId));
}

// GET /portfolio — risk matrix across active projects. Prefers saved
// snapshots; computes a fresh preview for a bounded number of un-assessed
// projects so the matrix is useful on first load without a heavy fan-out.
ventureRisk.get('/portfolio', async (c) => {
  const user = await requireAuth(c);
  if (!canRead(user.role)) return c.json({ detail: 'Forbidden' }, 403);

  const projects = await c.env.DB.prepare(
    'SELECT id, name, stage FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 60',
  ).all();
  const rows = (projects.results ?? []) as Array<{ id: number; name: string; stage: string }>;

  const FRESH_CAP = 20;
  let fresh = 0;
  const out: unknown[] = [];
  for (const p of rows) {
    let a = await loadLatest(c.env, p.id);
    if (!a && fresh < FRESH_CAP) {
      a = await computeMerged(c.env, p.id);
      fresh += 1;
    }
    out.push({
      project_id: p.id,
      project_name: p.name,
      stage: p.stage,
      assessed: !!a,
      saved: a?.saved ?? false,
      overall_risk: a?.overall_risk ?? null,
      overall_band: a?.overall_band ?? null,
      derisk_score: a?.derisk_score ?? null,
      derisk_pct: a?.derisk_pct ?? null,
      computed_at: a?.computed_at ?? null,
      layers: a ? a.layers.map((l) => ({ key: l.key, label: l.label, band: l.band, risk: l.risk, status: l.status })) : [],
    });
  }
  return c.json({ projects: out, layers: LAYERS.map((l) => ({ key: l.key, label: l.label })) });
});

ventureRisk.get('/:projectId', async (c) => {
  const user = await requireAuth(c);
  if (!canRead(user.role)) return c.json({ detail: 'Forbidden' }, 403);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const latest = await loadLatest(c.env, projectId);
  if (latest) return c.json(latest);

  // No snapshot yet — return a fresh, unsaved preview.
  const preview = await computeMerged(c.env, projectId);
  if (!preview) return c.json({ detail: 'Project not found' }, 404);
  return c.json(preview);
});

ventureRisk.get('/:projectId/history', async (c) => {
  const user = await requireAuth(c);
  if (!canRead(user.role)) return c.json({ detail: 'Forbidden' }, 403);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const r = await c.env.DB.prepare(
    `SELECT overall_risk, overall_band, derisk_score, derisk_pct, source, created_at
     FROM venture_risk_assessments WHERE project_id = ? ORDER BY created_at DESC LIMIT 30`,
  ).bind(projectId).all();
  return c.json({ project_id: projectId, history: r.results ?? [] });
});

ventureRisk.post('/:projectId/compute', async (c) => {
  const user = await requireAuth(c);
  if (!canWrite(user.role)) return c.json({ detail: 'Forbidden' }, 403);
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);

  const merged = await computeMerged(c.env, projectId);
  if (!merged) return c.json({ detail: 'Project not found' }, 404);
  await persist(c.env, merged, user.id);
  const saved = await loadLatest(c.env, projectId);
  return c.json(saved ?? merged);
});

ventureRisk.put('/:projectId/layer/:layerKey', async (c) => {
  const user = await requireAuth(c);
  if (!canWrite(user.role)) return c.json({ detail: 'Forbidden' }, 403);
  const projectId = Number(c.req.param('projectId'));
  const layerKey = String(c.req.param('layerKey'));
  if (!Number.isFinite(projectId)) return c.json({ detail: 'Invalid project_id' }, 400);
  if (!LAYER_KEYS.has(layerKey)) return c.json({ detail: 'Unknown layer' }, 400);

  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const band = body.band != null && VALID_BANDS.has(String(body.band)) ? String(body.band) : null;
  const score = body.score != null && Number.isFinite(Number(body.score)) ? Math.max(0, Math.min(100, Number(body.score))) : null;
  const status = body.status != null && VALID_STATUS.has(String(body.status)) ? String(body.status) : 'open';
  const note = body.note != null ? String(body.note).slice(0, 2000) : null;

  await c.env.DB.prepare(
    `INSERT INTO venture_risk_overrides (project_id, layer_key, band, score, status, note, owner_user_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, layer_key) DO UPDATE SET
       band = excluded.band, score = excluded.score, status = excluded.status,
       note = excluded.note, owner_user_id = excluded.owner_user_id, updated_at = datetime('now')`,
  ).bind(projectId, layerKey, band, score, status, note, user.id).run();

  const merged = await computeMerged(c.env, projectId);
  if (!merged) return c.json({ detail: 'Project not found' }, 404);
  await persist(c.env, merged, user.id);
  const saved = await loadLatest(c.env, projectId);
  return c.json(saved ?? merged);
});

export default ventureRisk;
