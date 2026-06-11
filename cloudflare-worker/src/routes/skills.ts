/**
 * Task #11 — User Skill Profile.
 *
 * Mounted at /api/skills. All endpoints require an authenticated session.
 *
 *   GET    /taxonomy                  cacheable (ETag) skills taxonomy:
 *                                     the 8 categories, each with its active
 *                                     skills. Returns 304 on If-None-Match.
 *   GET    /me                        the caller's own self ratings.
 *   PUT    /me                        bulk upsert/delete of the caller's self
 *                                     ratings ({ ratings: [...] }).
 *   POST   /endorsements             endorse another user on a skill — ONLY
 *                                     allowed between connected users (an
 *                                     active cofounder_connections row), else
 *                                     403 not_connected.
 *   GET    /me/aggregate             the caller's blended self+peer scores.
 *   GET    /users/:userId/aggregate  another user's blended scores — self,
 *                                     admin, or a connected peer only (403).
 *
 * The blended formula (0.4*self + 0.6*peer_avg, falling back to self when no
 * endorsements) lives in services/skillProfileSchema.ts::computeBlendedSkills
 * so the downstream radar / matching code reuses the exact blend.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';
import { ensureSkillsTaxonomySchema } from '../services/skillsTaxonomySchema';
import { ensureSkillProfileSchema, computeBlendedSkills } from '../services/skillProfileSchema';

const skills = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clampLevel(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function normEvidenceUrl(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null; // signal "invalid" to caller
  return s.slice(0, 2048);
}

function normYears(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(80, Math.round(n * 10) / 10);
}

function orderedPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/** True when two users share an ACTIVE cofounder connection (mutual NDA signed). */
async function areUsersConnected(env: Env, a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const [lo, hi] = orderedPair(a, b);
  const sql = getSQL(env);
  const rows = await sql`
    SELECT 1 FROM cofounder_connections
    WHERE status = 'active' AND user_a_id = ${lo} AND user_b_id = ${hi}
    LIMIT 1`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// GET /taxonomy — cacheable, ETag-validated.
// ---------------------------------------------------------------------------
skills.get('/taxonomy', async (c) => {
  await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  const sql = getSQL(c.env);

  // Cheap, deterministic validator: row counts + latest updated_at. Changes
  // whenever the taxonomy is edited or (re)seeded, so a stale client revalidates.
  const [catMeta] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM skill_categories`;
  const [skillMeta] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM skills WHERE is_active = 1`;
  const stamp = `${catMeta?.n || 0}.${String(catMeta?.mx || '')}.${skillMeta?.n || 0}.${String(skillMeta?.mx || '')}`;
  const etag = `W/"sktax-${stamp.replace(/[^0-9.]/g, '')}"`;

  const headers = {
    ETag: etag,
    // Auth-scoped reference data: private so shared caches don't serve it
    // cross-user; short max-age + revalidation via the ETag above.
    'Cache-Control': 'private, max-age=300, must-revalidate',
  };

  if (c.req.header('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  const categories = await sql`
    SELECT slug, label, description, is_radar_axis, radar_weight, display_order
    FROM skill_categories ORDER BY display_order, label`;
  const allSkills = await sql`
    SELECT id, slug, category_slug, label, description, seniority_levels_json, display_order
    FROM skills WHERE is_active = 1 ORDER BY category_slug, display_order, label`;

  const byCat = new Map<string, any[]>();
  for (const s of allSkills) {
    let levels: string[] = [];
    try { levels = JSON.parse(s.seniority_levels_json || '[]'); } catch { levels = []; }
    const list = byCat.get(s.category_slug) || [];
    list.push({
      id: Number(s.id),
      slug: s.slug,
      label: s.label,
      description: s.description || null,
      seniority_levels: levels,
      display_order: Number(s.display_order) || 0,
    });
    byCat.set(s.category_slug, list);
  }

  const payload = categories.map((cat) => ({
    slug: cat.slug,
    label: cat.label,
    description: cat.description || null,
    is_radar_axis: !!cat.is_radar_axis,
    radar_weight: Number(cat.radar_weight) || 1,
    display_order: Number(cat.display_order) || 0,
    skills: byCat.get(cat.slug) || [],
  }));

  return c.json({ categories: payload, etag }, 200, headers);
});

// ---------------------------------------------------------------------------
// GET /me — the caller's own self ratings.
// ---------------------------------------------------------------------------
skills.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillProfileSchema(c.env);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT skill_id, self_level, evidence_url, years, updated_at
    FROM user_skills WHERE user_id = ${user.id} ORDER BY skill_id`;
  return c.json({
    ratings: rows.map((r) => ({
      skill_id: Number(r.skill_id),
      self_level: Number(r.self_level) || 0,
      evidence_url: r.evidence_url || null,
      years: r.years == null ? null : Number(r.years),
      updated_at: r.updated_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// PUT /me — bulk upsert/delete of the caller's self ratings.
//   body: { ratings: [{ skill_id, self_level, evidence_url?, years? }] }
//   self_level <= 0 deletes the row (0 == "not held").
// ---------------------------------------------------------------------------
skills.put('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillProfileSchema(c.env);
  const sql = getSQL(c.env);

  let body: any;
  try { body = await c.req.json(); } catch { body = null; }
  const ratings = body && Array.isArray(body.ratings) ? body.ratings : null;
  if (!ratings) {
    return c.json({ error: 'invalid_body', message: 'Expected { ratings: [...] }.' }, 400);
  }
  if (ratings.length > 500) {
    return c.json({ error: 'too_many', message: 'Too many ratings in one request.' }, 400);
  }

  // Only allow ratings against active, real skills.
  const valid = await sql`SELECT id FROM skills WHERE is_active = 1`;
  const validIds = new Set(valid.map((r) => Number(r.id)));

  for (const raw of ratings) {
    const skillId = Number(raw?.skill_id);
    if (!Number.isInteger(skillId) || !validIds.has(skillId)) {
      return c.json({ error: 'invalid_skill', message: `Unknown skill_id: ${raw?.skill_id}` }, 400);
    }
    const level = clampLevel(raw?.self_level);
    if (level <= 0) {
      await sql`DELETE FROM user_skills WHERE user_id = ${user.id} AND skill_id = ${skillId}`;
      continue;
    }
    // Distinguish "field omitted" (keep nothing / null) from "bad value".
    let evidence: string | null = null;
    if (raw?.evidence_url != null && String(raw.evidence_url).trim() !== '') {
      evidence = normEvidenceUrl(raw.evidence_url);
      if (evidence === null) {
        return c.json({ error: 'invalid_evidence_url', field: 'evidence_url', message: 'Evidence link must start with http:// or https://' }, 400);
      }
    }
    const years = normYears(raw?.years);
    await sql`
      INSERT INTO user_skills (user_id, skill_id, self_level, evidence_url, years, updated_at)
      VALUES (${user.id}, ${skillId}, ${level}, ${evidence}, ${years}, datetime('now'))
      ON CONFLICT(user_id, skill_id) DO UPDATE SET
        self_level = excluded.self_level,
        evidence_url = excluded.evidence_url,
        years = excluded.years,
        updated_at = datetime('now')`;
  }

  const rows = await sql`
    SELECT skill_id, self_level, evidence_url, years, updated_at
    FROM user_skills WHERE user_id = ${user.id} ORDER BY skill_id`;
  return c.json({
    ratings: rows.map((r) => ({
      skill_id: Number(r.skill_id),
      self_level: Number(r.self_level) || 0,
      evidence_url: r.evidence_url || null,
      years: r.years == null ? null : Number(r.years),
      updated_at: r.updated_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// POST /endorsements — endorse a CONNECTED user on a skill.
//   body: { endorsee_id, skill_id, level, note? }
// ---------------------------------------------------------------------------
skills.post('/endorsements', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillProfileSchema(c.env);
  const sql = getSQL(c.env);

  let body: any;
  try { body = await c.req.json(); } catch { body = null; }
  const endorseeId = Number(body?.endorsee_id);
  const skillId = Number(body?.skill_id);
  if (!Number.isInteger(endorseeId) || !Number.isInteger(skillId)) {
    return c.json({ error: 'invalid_body', message: 'endorsee_id and skill_id are required.' }, 400);
  }
  if (endorseeId === user.id) {
    return c.json({ error: 'self_endorsement', message: 'You cannot endorse yourself.' }, 400);
  }

  const [skillRow] = await sql`SELECT id FROM skills WHERE id = ${skillId} AND is_active = 1`;
  if (!skillRow) {
    return c.json({ error: 'invalid_skill', message: 'Unknown skill.' }, 400);
  }
  const [endorsee] = await sql`SELECT id FROM users WHERE id = ${endorseeId}`;
  if (!endorsee) {
    return c.json({ error: 'unknown_user', message: 'That user does not exist.' }, 404);
  }

  // The connection gate — endorsements are only allowed between connected
  // users. A missing/non-active connection is a clear 403.
  const connected = await areUsersConnected(c.env, user.id, endorseeId);
  if (connected !== true) {
    return c.json({
      error: 'not_connected',
      message: 'You can only endorse people you are connected with.',
    }, 403);
  }

  // Endorsements are a positive signal: level must be 1..5. A 0 would still
  // count toward peer_count and drag down peer_avg, so reject it outright.
  const level = Math.round(Number(body?.level));
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return c.json({ error: 'invalid_level', field: 'level', message: 'Endorsement level must be between 1 and 5.' }, 400);
  }
  let note: string | null = null;
  if (body?.note != null && String(body.note).trim() !== '') {
    note = String(body.note).trim().slice(0, 1000);
  }

  await sql`
    INSERT INTO skill_endorsements (endorser_id, endorsee_id, skill_id, level, note, updated_at)
    VALUES (${user.id}, ${endorseeId}, ${skillId}, ${level}, ${note}, datetime('now'))
    ON CONFLICT(endorser_id, endorsee_id, skill_id) DO UPDATE SET
      level = excluded.level,
      note = excluded.note,
      updated_at = datetime('now')`;

  const [row] = await sql`
    SELECT endorser_id, endorsee_id, skill_id, level, note, updated_at
    FROM skill_endorsements
    WHERE endorser_id = ${user.id} AND endorsee_id = ${endorseeId} AND skill_id = ${skillId}`;
  return c.json({
    endorsement: {
      endorser_id: Number(row.endorser_id),
      endorsee_id: Number(row.endorsee_id),
      skill_id: Number(row.skill_id),
      level: Number(row.level) || 0,
      note: row.note || null,
      updated_at: row.updated_at,
    },
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /me/aggregate — the caller's blended self+peer scores.
// ---------------------------------------------------------------------------
skills.get('/me/aggregate', async (c) => {
  const user = await requireAuth(c);
  const items = await computeBlendedSkills(c.env, user.id);
  return c.json({ user_id: user.id, skills: items });
});

// ---------------------------------------------------------------------------
// GET /users/:userId/aggregate — another user's blended scores. Visible to
// self, admins, or a connected peer; everyone else gets a 403.
// ---------------------------------------------------------------------------
skills.get('/users/:userId/aggregate', async (c) => {
  const user = await requireAuth(c);
  const targetId = Number(c.req.param('userId'));
  if (!Number.isInteger(targetId)) {
    return c.json({ error: 'invalid_user', message: 'Bad user id.' }, 400);
  }
  if (targetId !== user.id && user.role !== 'admin') {
    const connected = await areUsersConnected(c.env, user.id, targetId);
    if (connected !== true) {
      return c.json({
        error: 'not_connected',
        message: 'You can only view skills of people you are connected with.',
      }, 403);
    }
  }
  const items = await computeBlendedSkills(c.env, targetId);
  return c.json({ user_id: targetId, skills: items });
});

export default skills;
