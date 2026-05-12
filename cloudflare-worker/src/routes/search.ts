/**
 * Semantic search — Vectorize-backed search across projects, deals,
 * founders, partners, legal documents, and academy lessons.
 *
 * GET  /api/search?q=...&type=...&limit=10[&grouped=1]
 *      Any authenticated user. Returns hits ranked by cosine similarity.
 *      `grouped=1` (or no `type`) returns `{ groups: { project: [...], ... } }`
 *      so the cmd-K palette can render one section per entity type without
 *      a second pass.
 *
 * POST /api/search/backfill
 *      Admin only. Enqueues `embed_entity` jobs for every existing row so
 *      the index reflects pre-Vectorize data. Idempotent — running it
 *      twice just re-embeds.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin } from '../auth';
import { searchSemantic, type EntityType, ALL_ENTITY_TYPES, type SearchHit } from '../services/vectorize';
import { Jobs } from '../models/jobs';

const search = new Hono<{ Bindings: Env }>();

const VALID_TYPES = ALL_ENTITY_TYPES;

/**
 * Bootstrap the academy_lessons table on demand (matches the lazy CREATE
 * pattern used by other worker routes — no migration runner in dev).
 * Safe to call repeatedly; CREATE TABLE IF NOT EXISTS is a no-op when
 * the table already exists.
 */
async function ensureAcademySchema(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS academy_lessons (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         slug TEXT UNIQUE,
         title TEXT NOT NULL,
         summary TEXT,
         body TEXT,
         created_at TEXT DEFAULT (datetime('now')),
         updated_at TEXT DEFAULT (datetime('now'))
       )`
    ).run();
  } catch (e: any) {
    console.error('academy_lessons schema:', e?.message);
  }
}

/**
 * Role-based scope:
 *  - admin/partner/investor → every entity type
 *  - founder/other          → projects + academy lessons (their own learning surface)
 *
 * Founders requesting a restricted type get an empty result with a
 * `warning`, not a 403 — keeps the UI simple and avoids leaking the
 * existence of restricted indices.
 */
/**
 * Role-scoped allow-list — must mirror the frontend route guards in
 * App.jsx so every returned hit deep-links to a reachable page rather
 * than a 403 / role-redirect.
 */
const ROLE_ALLOWED: Record<string, EntityType[]> = {
  // 'founder' (entity) is admin-only — founder-role users must not be
  // able to enumerate other founders via search, and no founder-role
  // -accessible founder profile page exists yet.
  admin:    VALID_TYPES,
  founder:  ['project', 'document', 'academy_lesson'],
  partner:  ['project', 'deal', 'document', 'academy_lesson'],
  investor: ['project', 'deal', 'document', 'academy_lesson'],
};

function allowedTypes(role: string): EntityType[] {
  return ROLE_ALLOWED[role] || ['project', 'academy_lesson'];
}

function scrubSnippet(h: SearchHit): SearchHit {
  // Security #8 defense-in-depth: legacy document vectors may still
  // carry contract body fragments in `snippet`. Always replace at the
  // wire for `document` hits.
  if (h.type === 'document') {
    return { ...h, snippet: 'Legal document — open to view (download required)' };
  }
  return h;
}

search.get('/', async (c) => {
  const user = await requireAuth(c);
  const q = (c.req.query('q') || '').trim();
  const grouped = c.req.query('grouped') === '1' || c.req.query('grouped') === 'true';
  if (!q) return c.json({ query: '', hits: [], groups: {} });
  if (q.length > 500) return c.json({ error: 'query too long (max 500 chars)' }, 400);

  const typeParam = c.req.query('type');
  const requestedType = typeParam && VALID_TYPES.includes(typeParam as EntityType) ? (typeParam as EntityType) : undefined;
  const limit = Math.max(1, Math.min(25, parseInt(c.req.query('limit') || '10', 10) || 10));

  if (!c.env.VECTORIZE) {
    return c.json({ query: q, hits: [], groups: {}, warning: 'search index unavailable' });
  }

  await ensureAcademySchema(c.env);

  const allowed = allowedTypes((user as any).role || 'founder');

  if (requestedType && !allowed.includes(requestedType)) {
    return c.json({ query: q, type: requestedType, hits: [], groups: {}, warning: 'type not available for your role' });
  }

  let hits: SearchHit[];
  if (requestedType) {
    hits = await searchSemantic(c.env, q, { topK: limit, type: requestedType });
  } else if (allowed.length === VALID_TYPES.length) {
    // Pull a wider set when grouping so each group still has decent depth
    // even if one type dominates the global ranking.
    hits = await searchSemantic(c.env, q, { topK: grouped ? Math.min(50, limit * VALID_TYPES.length) : limit });
  } else {
    const wide = await searchSemantic(c.env, q, { topK: limit * 3 });
    hits = wide.filter(h => allowed.includes(h.type));
    if (!grouped) hits = hits.slice(0, limit);
  }
  hits = hits.map(scrubSnippet);

  if (grouped || !requestedType) {
    const groups: Record<string, SearchHit[]> = {};
    for (const t of allowed) groups[t] = [];
    for (const h of hits) {
      if (!allowed.includes(h.type)) continue;
      if (!groups[h.type]) groups[h.type] = [];
      if (groups[h.type].length < limit) groups[h.type].push(h);
    }
    return c.json({ query: q, type: requestedType || 'all', allowed_types: allowed, groups, hits });
  }
  return c.json({ query: q, type: requestedType || 'all', allowed_types: allowed, hits });
});

/**
 * Bounded backfill — chunked to avoid runaway D1+queue load.
 *
 * Body: { types?: EntityType[], since_id?: number, chunk?: number }
 */
const MAX_PER_CALL = 500;

const TABLE_BY_TYPE: Record<EntityType, string> = {
  project: 'projects',
  deal: 'deals',
  founder: 'founders',
  partner: 'users',
  document: 'legal_documents',
  academy_lesson: 'academy_lessons',
  mentor: 'mentors',
  investor: 'users',
};

search.post('/backfill', async (c) => {
  await requireAdmin(c);
  await ensureAcademySchema(c.env);
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
    const table = TABLE_BY_TYPE[type];
    const since = Number(sinceIn[type] ?? 0);
    // Task #5 (AV) — `users` is shared by partner+investor; filter by
    // role so each backfill type only enqueues the right rows instead
    // of re-embedding the entire users table per type.
    const where = type === 'investor' ? `id > ? AND role = 'investor'`
      : type === 'partner' ? `id > ? AND role = 'partner'`
      : `id > ?`;
    const rows = await c.env.DB.prepare(
      `SELECT id FROM ${table} WHERE ${where} ORDER BY id ASC LIMIT ?`
    ).bind(since, remaining).all<{ id: number }>();
    const ids = (rows.results || []).map(r => r.id);
    for (const id of ids) {
      await Jobs.enqueue(c.env, 'embed_entity', { type, id });
    }
    counts[type] = ids.length;
    nextSince[type] = ids.length === remaining ? ids[ids.length - 1] : null;
    remaining -= ids.length;
  }
  const done = Object.values(nextSince).every(v => v === null);
  return c.json({ message: done ? 'backfill complete' : 'partial — call again with next_since', counts, next_since: nextSince, done });
});

export default search;
