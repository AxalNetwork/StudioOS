/**
 * Task #66 — Follow graph for people + startups.
 *
 * Mounted at /api/follows. Open to any signed-in user (unlike the
 * investor-only `watchlist_items`, which is a DD instrument). A follow is a
 * (follower_user_id, entity_type, entity_id) triple where entity_type is
 * 'user' or 'project'. Follower counts are public; the caller's own
 * following state requires auth.
 *
 *   POST   /api/follows            { entity_type, entity_id }  — follow
 *   DELETE /api/follows            { entity_type, entity_id }  — unfollow
 *   GET    /api/follows/status?entity_type=&entity_id=         — { following, followers }
 *   GET    /api/follows/mine                                   — { users:[], projects:[] }
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const r = new Hono<{ Bindings: Env }>();

let _schemaReady = false;
export async function ensureFollowsSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS follows (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         follower_user_id INTEGER NOT NULL,
         entity_type TEXT NOT NULL,
         entity_id INTEGER NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         UNIQUE (follower_user_id, entity_type, entity_id)
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_user_id)`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_follows_entity ON follows(entity_type, entity_id)`,
    ).run();
    _schemaReady = true;
  } catch (e) {
    console.error('[follows] schema ensure failed', e);
  }
}

type EntityType = 'user' | 'project';

function parseTarget(entityType: unknown, entityId: unknown): { type: EntityType; id: number } | null {
  const t = String(entityType || '').trim().toLowerCase();
  const id = Number(entityId);
  if ((t !== 'user' && t !== 'project') || !Number.isFinite(id) || id <= 0) return null;
  return { type: t as EntityType, id };
}

// Validate the target exists (and, for users, is active) so we don't accrue
// follows against phantom ids.
async function targetExists(env: Env, type: EntityType, id: number): Promise<boolean> {
  if (type === 'user') {
    const row = await env.DB.prepare(
      `SELECT id FROM users WHERE id = ? AND is_active = 1`,
    ).bind(id).first<{ id: number }>();
    return !!row;
  }
  const row = await env.DB.prepare(
    `SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL`,
  ).bind(id).first<{ id: number }>();
  return !!row;
}

async function followerCount(env: Env, type: EntityType, id: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM follows WHERE entity_type = ? AND entity_id = ?`,
  ).bind(type, id).first<{ c: number }>();
  return Number(row?.c || 0);
}

r.post('/', async (c) => {
  await ensureFollowsSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const tgt = parseTarget(body.entity_type, body.entity_id);
  if (!tgt) return c.json({ detail: 'entity_type (user|project) and entity_id required' }, 400);
  if (tgt.type === 'user' && tgt.id === user.id) {
    return c.json({ detail: 'Cannot follow yourself' }, 400);
  }
  if (!(await targetExists(c.env, tgt.type, tgt.id))) {
    return c.json({ detail: 'Not found' }, 404);
  }
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO follows (follower_user_id, entity_type, entity_id) VALUES (?, ?, ?)`,
  ).bind(user.id, tgt.type, tgt.id).run();
  return c.json({ following: true, followers: await followerCount(c.env, tgt.type, tgt.id) });
});

r.delete('/', async (c) => {
  await ensureFollowsSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const tgt = parseTarget(body.entity_type, body.entity_id);
  if (!tgt) return c.json({ detail: 'entity_type (user|project) and entity_id required' }, 400);
  await c.env.DB.prepare(
    `DELETE FROM follows WHERE follower_user_id = ? AND entity_type = ? AND entity_id = ?`,
  ).bind(user.id, tgt.type, tgt.id).run();
  return c.json({ following: false, followers: await followerCount(c.env, tgt.type, tgt.id) });
});

r.get('/status', async (c) => {
  await ensureFollowsSchema(c.env);
  const tgt = parseTarget(c.req.query('entity_type'), c.req.query('entity_id'));
  if (!tgt) return c.json({ detail: 'entity_type (user|project) and entity_id required' }, 400);
  let following = false;
  try {
    const user = await requireAuth(c);
    const row = await c.env.DB.prepare(
      `SELECT 1 FROM follows WHERE follower_user_id = ? AND entity_type = ? AND entity_id = ?`,
    ).bind(user.id, tgt.type, tgt.id).first();
    following = !!row;
  } catch { /* anonymous — following stays false, followers still public */ }
  return c.json({ following, followers: await followerCount(c.env, tgt.type, tgt.id) });
});

r.get('/mine', async (c) => {
  await ensureFollowsSchema(c.env);
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT entity_type, entity_id, created_at FROM follows WHERE follower_user_id = ? ORDER BY created_at DESC LIMIT 500`,
  ).bind(user.id).all<{ entity_type: string; entity_id: number; created_at: string }>();
  const userIds = (rows.results || []).filter((x) => x.entity_type === 'user').map((x) => x.entity_id);
  const projectIds = (rows.results || []).filter((x) => x.entity_type === 'project').map((x) => x.entity_id);

  const users: any[] = [];
  if (userIds.length) {
    const ph = userIds.map(() => '?').join(',');
    const ur = await c.env.DB.prepare(
      `SELECT id, uid, name, display_name, headline, role FROM users WHERE id IN (${ph})`,
    ).bind(...userIds).all<any>();
    for (const u of ur.results || []) {
      users.push({
        id: u.id, handle: u.uid,
        name: u.display_name || u.name || null,
        headline: u.headline || null, role: u.role,
      });
    }
  }
  const projects: any[] = [];
  if (projectIds.length) {
    const ph = projectIds.map(() => '?').join(',');
    const pr = await c.env.DB.prepare(
      `SELECT id, uid, name, sector, stage FROM projects WHERE id IN (${ph}) AND deleted_at IS NULL`,
    ).bind(...projectIds).all<any>();
    for (const p of pr.results || []) {
      projects.push({ id: p.id, handle: p.uid, name: p.name, sector: p.sector, stage: p.stage });
    }
  }
  return c.json({ users, projects });
});

export default r;
