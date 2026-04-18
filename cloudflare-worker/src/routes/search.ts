/**
 * Semantic search — Vectorize-backed full-text search across projects,
 * partners (users), and legal documents.
 *
 * GET  /api/search?q=...&type=project|partner|document&limit=10
 *      Any authenticated user. Returns hits ranked by cosine similarity.
 *
 * POST /api/search/backfill
 *      Admin only. Enqueues `embed_entity` jobs for every existing row so
 *      the index reflects pre-Vectorize data. Idempotent — running it
 *      twice just re-embeds.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { searchSemantic, type EntityType } from '../services/vectorize';
import { Jobs } from '../models/jobs';

const search = new Hono<{ Bindings: Env }>();

const VALID_TYPES: EntityType[] = ['project', 'partner', 'document'];

/**
 * Role-based scope:
 *  - admin   → all entity types
 *  - partner → all entity types
 *  - founder → projects only (no partner directory, no legal docs)
 *  - other   → projects only (conservative default)
 *
 * Founders requesting `type=partner` or `type=document` get an empty result
 * with a `warning` rather than a 403 — that keeps the UI simple and avoids
 * leaking the existence of restricted indices.
 */
function allowedTypes(role: string): EntityType[] {
  if (role === 'admin' || role === 'partner') return ['project', 'partner', 'document'];
  return ['project'];
}

search.get('/', async (c) => {
  const user = await requireAuth(c);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ query: '', hits: [] });
  if (q.length > 500) return c.json({ error: 'query too long (max 500 chars)' }, 400);

  const typeParam = c.req.query('type');
  const requestedType = typeParam && VALID_TYPES.includes(typeParam as EntityType) ? (typeParam as EntityType) : undefined;
  const limit = Math.max(1, Math.min(25, parseInt(c.req.query('limit') || '10', 10) || 10));

  if (!c.env.VECTORIZE) {
    return c.json({ query: q, hits: [], warning: 'search index unavailable' });
  }

  const allowed = allowedTypes((user as any).role || 'founder');

  // If a specific type was requested but is not allowed for this role, return empty.
  if (requestedType && !allowed.includes(requestedType)) {
    return c.json({ query: q, type: requestedType, hits: [], warning: 'type not available for your role' });
  }

  // For unscoped queries, fetch all then filter by allowed types in metadata.
  // For scoped queries, push the filter to Vectorize.
  let hits;
  if (requestedType) {
    hits = await searchSemantic(c.env, q, { topK: limit, type: requestedType });
  } else if (allowed.length === VALID_TYPES.length) {
    hits = await searchSemantic(c.env, q, { topK: limit });
  } else {
    // Restricted role with no explicit type — fetch a wider set then filter.
    const wide = await searchSemantic(c.env, q, { topK: limit * 3 });
    hits = wide.filter(h => allowed.includes(h.type)).slice(0, limit);
  }
  return c.json({ query: q, type: requestedType || 'all', allowed_types: allowed, hits });
});

/**
 * Bounded backfill — chunked to avoid runaway D1+queue load.
 *
 * Body: { types?: EntityType[], since_id?: number, chunk?: number }
 *
 * Walks rows in id order from `since_id` (default 0). Caps the total embed
 * jobs enqueued per call at MAX_PER_CALL (across all requested types).
 * Returns `next_since` cursors per type so the operator can call again to
 * resume — keeps any single request short and predictable.
 */
const MAX_PER_CALL = 500;

search.post('/backfill', async (c) => {
  await requireAdmin(c);
  const body = await c.req.json().catch(() => ({} as any));
  const requested: EntityType[] = Array.isArray(body.types) && body.types.length
    ? body.types.filter((t: any) => VALID_TYPES.includes(t))
    : VALID_TYPES;
  const sinceIn: Record<string, number> = (body.since_id && typeof body.since_id === 'object') ? body.since_id : {};
  const chunk = Math.max(50, Math.min(MAX_PER_CALL, Number(body.chunk) || MAX_PER_CALL));

  const counts: Record<string, number> = {};
  const nextSince: Record<string, number | null> = {};
  let remaining = chunk;

  for (const type of requested) {
    if (remaining <= 0) { counts[type] = 0; nextSince[type] = sinceIn[type] ?? 0; continue; }
    const table = type === 'project' ? 'projects' : type === 'partner' ? 'users' : 'legal_documents';
    const since = Number(sinceIn[type] ?? 0);
    const rows = await c.env.DB.prepare(
      `SELECT id FROM ${table} WHERE id > ? ORDER BY id ASC LIMIT ?`
    ).bind(since, remaining).all<{ id: number }>();
    const ids = (rows.results || []).map(r => r.id);
    for (const id of ids) {
      await Jobs.enqueue(c.env, 'embed_entity', { type, id });
    }
    counts[type] = ids.length;
    nextSince[type] = ids.length === remaining ? ids[ids.length - 1] : null; // null = done
    remaining -= ids.length;
  }
  const done = Object.values(nextSince).every(v => v === null);
  return c.json({ message: done ? 'backfill complete' : 'partial — call again with next_since', counts, next_since: nextSince, done });
});

export default search;
