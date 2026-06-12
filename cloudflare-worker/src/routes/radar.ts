/**
 * Task #13 — Radar / Spider-Graph Service.
 *
 * Mounted at /api/radar. All endpoints require an authenticated session.
 *
 *   GET  /me       — the caller's own 8-axis radar.
 *   POST /team     — radar for an ad-hoc team (by user id list).
 *
 * Output is deterministic (identical input → identical output) and cached
 * briefly (5-min KV) keyed on the user set and taxonomy version.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { getSQL } from '../db';
import { ensureSkillsTaxonomySchema } from '../services/skillsTaxonomySchema';
import { ensureSkillProfileSchema } from '../services/skillProfileSchema';
import { computeRadar, radarCacheKey } from '../services/radar';
import { getTaxonomyVersion } from '../services/taxonomyVersion';

const radar = new Hono<{ Bindings: Env }>();

const CACHE_TTL_SECONDS = 300; // 5 minutes

// Task #19 — taxonomy version now comes from the centralized service (folds in
// counts + latest edit time of categories/skills/values). An admin taxonomy
// edit changes the string → the radar cache key changes → cached radars miss
// and recompute on the next request (well within the ~60s invalidation target).
async function getCachedRadar(env: Env, userIds: number[], version: string): Promise<any | null> {
  const kv = env.TOKENS;
  if (!kv) return null;
  const key = await radarCacheKey(userIds, version);
  try {
    const cached = await kv.get(key, 'json');
    if (cached) return cached;
  } catch { /* fall through */ }
  return null;
}

async function setCachedRadar(env: Env, userIds: number[], data: any, version: string): Promise<void> {
  const kv = env.TOKENS;
  if (!kv) return;
  const key = await radarCacheKey(userIds, version);
  try {
    await kv.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// GET /me — caller's own radar
// ---------------------------------------------------------------------------
radar.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  await ensureSkillProfileSchema(c.env);

  const version = await getTaxonomyVersion(c.env);
  const cached = await getCachedRadar(c.env, [user.id], version);
  if (cached) return c.json(cached);

  const result = await computeRadar(c.env, [user.id]);
  const payload = {
    ...result,
    user_id: user.id,
    cached: false,
  };
  await setCachedRadar(c.env, [user.id], payload, version);
  return c.json(payload);
});

/** Same policy as skills.ts — active cofounder connection required. */
async function areUsersConnected(env: Env, a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const sql = getSQL(env);
  const rows = await sql`
    SELECT 1 FROM cofounder_connections
    WHERE status = 'active' AND user_a_id = ${lo} AND user_b_id = ${hi}
    LIMIT 1`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// POST /team — radar for an ad-hoc team
// ---------------------------------------------------------------------------
radar.post('/team', async (c) => {
  const user = await requireAuth(c);
  await ensureSkillsTaxonomySchema(c.env);
  await ensureSkillProfileSchema(c.env);

  const body = await c.req.json().catch(() => ({}));
  const rawIds: number[] = Array.isArray(body.user_ids)
    ? body.user_ids.map(Number).filter((n: unknown) => Number.isInteger(n) && Number(n) > 0)
    : [];

  if (rawIds.length === 0) {
    return c.json({ error: 'invalid_body', message: 'user_ids must be a non-empty array of positive integers.' }, 400);
  }

  // Deduplicate to a true set before compute/cache keying.
  const ids = Array.from(new Set(rawIds)).sort((a, b) => a - b);

  // Authorization: same policy as skills.ts — self/admin/connected peer only.
  const unauthorized: number[] = [];
  for (const targetId of ids) {
    if (targetId === user.id) continue;
    if (user.role === 'admin') continue;
    const connected = await areUsersConnected(c.env, user.id, targetId);
    if (!connected) unauthorized.push(targetId);
  }
  if (unauthorized.length > 0) {
    return c.json({
      error: 'not_connected',
      message: 'You can only view radar for yourself, admins, or connected peers.',
      unauthorized_ids: unauthorized,
    }, 403);
  }

  const version = await getTaxonomyVersion(c.env);
  const cached = await getCachedRadar(c.env, ids, version);
  if (cached) return c.json(cached);

  const result = await computeRadar(c.env, ids);
  const payload = {
    ...result,
    user_ids: ids,
    cached: false,
  };
  await setCachedRadar(c.env, ids, payload, version);
  return c.json(payload);
});

export default radar;
