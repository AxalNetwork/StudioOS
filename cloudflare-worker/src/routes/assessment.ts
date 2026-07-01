/**
 * Assessment results — authenticated read routes.
 *
 * Mounted at /api/assessment (see index.ts). The gamified "Play & Discover"
 * player surface (games / sessions / respond / complete / publish / badges) was
 * removed; only the read-only results endpoints remain, consumed by the Profile
 * & Fit section and archetype badges. Every handler is behind requireAuth
 * (wrapped so a missing session returns a clean 401 even outside the global
 * onError) and lazily calls ensureAssessmentSchema() on first hit. The scoring
 * math lives in services/assessmentScoring.ts (pure).
 *
 * Surface:
 *   GET /results/me         — caller's latest result per track
 *   GET /results/:userId    — another user's result (consent-gated)
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { ensureAssessmentSchema } from '../services/assessmentSchema';
import { verifyResult, ASSESSMENT_INTEGRITY_VERSION } from '../services/assessmentScoring';

const assessment = new Hono<{ Bindings: Env }>();

assessment.use('*', async (c, next) => {
  await ensureAssessmentSchema(c.env);
  await next();
});

async function auth(c: any): Promise<User | Response> {
  try {
    return await requireAuth(c);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

function parseJSON<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || s.trim() === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function shapeResult(row: any, verified: boolean | null = null): any {
  return {
    session_id: row.session_id,
    user_id: row.user_id,
    track: row.track,
    value_vector: parseJSON(row.value_vector_json, {}),
    skill_vector: parseJSON(row.skill_vector_json, {}),
    confidence: parseJSON(row.confidence_json, {}),
    flags: parseJSON(row.flags_json, []),
    archetype_slug: row.archetype_slug || null,
    archetype_label: row.archetype_label || null,
    xp_awarded: Number(row.xp_awarded) || 0,
    integrity_version: Number(row.integrity_version) || ASSESSMENT_INTEGRITY_VERSION,
    published: !!row.published,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(verified === null ? {} : { verified }),
  };
}

// ── GET /results/me ───────────────────────────────────────────────────────--
assessment.get('/results/me', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  // Latest result per track for the caller.
  const res = await c.env.DB.prepare(
    `SELECT r.* FROM assessment_results r
       JOIN (SELECT track, MAX(updated_at) AS mx FROM assessment_results
              WHERE user_id = ? GROUP BY track) latest
         ON latest.track = r.track AND latest.mx = r.updated_at
      WHERE r.user_id = ?
      ORDER BY r.updated_at DESC`,
  )
    .bind(user.id, user.id)
    .all<any>();
  const results = await Promise.all(
    (res.results || []).map(async (row) => {
      const ok = await verifyResult(
        c.env,
        {
          userId: row.user_id,
          sessionId: row.session_id,
          track: row.track,
          valueVector: parseJSON(row.value_vector_json, {}),
          skillVector: parseJSON(row.skill_vector_json, {}),
          archetypeSlug: row.archetype_slug || null,
          integrityVersion: Number(row.integrity_version) || ASSESSMENT_INTEGRITY_VERSION,
        },
        row.integrity_hash,
      );
      return shapeResult(row, ok);
    }),
  );
  return c.json({ results });
});

// ── GET /results/:userId ─────────────────────────────────────────────────--
assessment.get('/results/:userId', async (c) => {
  const user = await auth(c);
  if (user instanceof Response) return user;
  const targetId = Number(c.req.param('userId'));
  if (!Number.isFinite(targetId)) return c.json({ error: 'invalid user id' }, 400);

  const isSelf = targetId === user.id;
  const isAdmin = user.role === 'admin';
  // Consent gate: another user's results require published = 1.
  const res = await c.env.DB.prepare(
    `SELECT r.* FROM assessment_results r
       JOIN (SELECT track, MAX(updated_at) AS mx FROM assessment_results
              WHERE user_id = ?${isSelf || isAdmin ? '' : ' AND published = 1'} GROUP BY track) latest
         ON latest.track = r.track AND latest.mx = r.updated_at
      WHERE r.user_id = ?${isSelf || isAdmin ? '' : ' AND r.published = 1'}
      ORDER BY r.updated_at DESC`,
  )
    .bind(targetId, targetId)
    .all<any>();
  const results = (res.results || []).map((row) => shapeResult(row));
  return c.json({ user_id: targetId, results });
});

export default assessment;
