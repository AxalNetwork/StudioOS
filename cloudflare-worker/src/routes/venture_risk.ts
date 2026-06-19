/**
 * Task #9 — Venture Risk surface.
 *
 * Mounted at /api/venture-risk. The 10-layer Venture Risk rating system is for
 * the INTERNAL DEAL TEAM only. Reads are gated to admin / partner / investor
 * (same privileged set as the founder-risk route); analyst writes (overrides,
 * recompute) are gated to admin / partner — the deal-team analysts.
 *
 * Endpoints:
 *   GET    /by-project/:projectId         — full hybrid assessment (10 layers)
 *   POST   /:projectId/recompute          — refresh the live auto computation
 *   PUT    /:projectId/layers/:layerKey   — upsert an analyst override
 *   DELETE /:projectId/layers/:layerKey   — clear an analyst override
 *   GET    /matrix                        — portfolio risk matrix (heatmap)
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import {
  buildAssessment,
  buildMatrix,
  loadProject,
  upsertOverride,
  deleteOverride,
  isLayerKey,
  clampScore,
  LAYERS,
  LAYER_KEYS,
  type RiskBand,
} from '../services/ventureRisk';

const ventureRisk = new Hono<{ Bindings: Env }>();

/** Internal deal-team READ set — admin / partner / investor. */
function canRead(role: User['role']): boolean {
  return role === 'admin' || role === 'partner' || role === 'investor';
}

/** Analyst WRITE set — admin / partner. */
function canWrite(role: User['role']): boolean {
  return role === 'admin' || role === 'partner';
}

function parseProjectId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

ventureRisk.get('/matrix', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canRead(user.role)) return c.json({ detail: 'Forbidden' }, 403);
    const companies = await buildMatrix(c.env);
    return c.json({
      layer_meta: LAYERS,
      layers: LAYER_KEYS,
      companies,
      company_count: companies.length,
    });
  } catch (e) {
    return mapError(c, e);
  }
});

ventureRisk.get('/by-project/:projectId', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canRead(user.role)) return c.json({ detail: 'Forbidden' }, 403);
    const projectId = parseProjectId(c.req.param('projectId'));
    if (projectId == null) return c.json({ detail: 'Invalid project_id' }, 400);
    const assessment = await buildAssessment(c.env, projectId);
    if (!assessment) return c.json({ detail: 'Project not found' }, 404);
    return c.json(assessment);
  } catch (e) {
    return mapError(c, e);
  }
});

ventureRisk.post('/:projectId/recompute', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canWrite(user.role)) return c.json({ detail: 'Forbidden' }, 403);
    const projectId = parseProjectId(c.req.param('projectId'));
    if (projectId == null) return c.json({ detail: 'Invalid project_id' }, 400);
    // Auto scores are always computed live, so a recompute is a fresh build.
    const assessment = await buildAssessment(c.env, projectId);
    if (!assessment) return c.json({ detail: 'Project not found' }, 404);
    return c.json(assessment);
  } catch (e) {
    return mapError(c, e);
  }
});

ventureRisk.put('/:projectId/layers/:layerKey', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canWrite(user.role)) return c.json({ detail: 'Forbidden' }, 403);
    const projectId = parseProjectId(c.req.param('projectId'));
    if (projectId == null) return c.json({ detail: 'Invalid project_id' }, 400);
    const layerKey = c.req.param('layerKey');
    if (!isLayerKey(layerKey)) return c.json({ detail: 'Invalid layer_key' }, 400);

    const body: Record<string, unknown> = await c.req.json().catch(() => ({}));

    let analystScore: number | null = null;
    if (body.analyst_score != null && body.analyst_score !== '') {
      const n = Number(body.analyst_score);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return c.json({ detail: 'analyst_score must be a number 0..100' }, 400);
      }
      analystScore = clampScore(n);
    }

    let analystBand: RiskBand | null = null;
    if (body.analyst_band != null && body.analyst_band !== '') {
      const b = String(body.analyst_band);
      if (b !== 'low' && b !== 'medium' && b !== 'high') {
        return c.json({ detail: 'analyst_band must be one of low|medium|high' }, 400);
      }
      analystBand = b;
    }

    const analystNote =
      body.analyst_note != null && body.analyst_note !== ''
        ? String(body.analyst_note).slice(0, 2000)
        : null;
    const status =
      body.status != null && body.status !== '' ? String(body.status).slice(0, 40) : 'open';

    const project = await loadProject(c.env, projectId);
    if (!project) return c.json({ detail: 'Project not found' }, 404);

    await upsertOverride(
      c.env,
      projectId,
      layerKey,
      { analyst_score: analystScore, analyst_band: analystBand, analyst_note: analystNote, status },
      user.id,
    );

    const assessment = await buildAssessment(c.env, projectId);
    return c.json(assessment);
  } catch (e) {
    return mapError(c, e);
  }
});

ventureRisk.delete('/:projectId/layers/:layerKey', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canWrite(user.role)) return c.json({ detail: 'Forbidden' }, 403);
    const projectId = parseProjectId(c.req.param('projectId'));
    if (projectId == null) return c.json({ detail: 'Invalid project_id' }, 400);
    const layerKey = c.req.param('layerKey');
    if (!isLayerKey(layerKey)) return c.json({ detail: 'Invalid layer_key' }, 400);
    const project = await loadProject(c.env, projectId);
    if (!project) return c.json({ detail: 'Project not found' }, 404);
    await deleteOverride(c.env, projectId, layerKey);
    const assessment = await buildAssessment(c.env, projectId);
    return c.json(assessment);
  } catch (e) {
    return mapError(c, e);
  }
});

export default ventureRisk;
