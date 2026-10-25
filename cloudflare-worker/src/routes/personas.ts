/**
 * Epic 1 — Personas API.
 *
 * - GET  /api/personas/taxonomy            public list (no auth)
 * - GET  /api/personas/me                  current user's personas + extras
 * - POST /api/personas/classify            AI classify {first_message}
 * - POST /api/personas/answer              persist {persona_id, key, value}
 * - POST /api/personas/finalize            write/replace user_personas row
 *                                          (allows up to 2 rows for the
 *                                          founder+operator overlap)
 * - GET  /api/personas/admin/list          admin: all users + persona rows
 * - GET  /api/personas/admin/segments      admin: the segment counts (D999),
 *                                          counts only, admins left out
 * - POST /api/personas/admin/:user_id/retag admin: set primary persona
 *                                          with manual_override = 1
 *
 * D1000 (#2815): the segment profile store (`services/segmentProfiles.ts`)
 * sets each segment's status. Sign-up (taxonomy, classify, finalize) offers
 * only Active segments; an admin's retag may use a Draft one but never a
 * Retired one; a member keeps a segment they already hold. The profiles
 * themselves are `routes/persona_segments.ts`, at /api/personas/segments.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin, isSuperAdmin } from '../auth';
import { PERSONAS, PERSONA_BY_ID, isAllowedPersonaOverlap, type PersonaId } from '../personas';
import { classifyPersona } from '../../ai-workers/persona-router';
import { bindingKey } from '../util/schemaBootstrap';
import { readPersonaSegments } from '../services/personaSegments';
import { NOT_OFFERED, statusesOf } from '../services/segmentProfiles';
import { MembersError, movableSegment, moveOne } from '../services/personaMembers';

const personas = new Hono<{ Bindings: Env }>();

const MIGRATED = new WeakMap<object, boolean>();
async function ensurePersonaSchema(env: Env): Promise<void> {
  if (MIGRATED.get(bindingKey(env))) return;
  const db = env.DB;
  // Each statement is run independently and any failure leaves `migrated`
  // false so the next request retries. We surface the error to the caller
  // rather than swallowing it — a half-applied schema must not look healthy.
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      persona_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      manual_override INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'router',
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, persona_id)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_personas_user ON user_personas(user_id)`).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_profile_extras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      persona_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      source TEXT NOT NULL DEFAULT 'onboarding',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, persona_id, key)
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_profile_extras_user ON user_profile_extras(user_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_profile_extras_persona ON user_profile_extras(user_id, persona_id)`).run();
  MIGRATED.set(bindingKey(env), true);
}

function isPersonaId(v: unknown): v is PersonaId {
  return typeof v === 'string' && v in PERSONA_BY_ID;
}

interface UserPersonaRow {
  id: number;
  user_id: number;
  persona_id: string;
  confidence: number;
  manual_override: number;
  source: string;
  is_primary: number;
  created_at: string;
  updated_at: string;
}

interface UserExtraRow {
  id: number;
  user_id: number;
  persona_id: string;
  key: string;
  value: string | null;
  source: string;
}

/**
 * D1000: the segment profile store decides what sign-up offers. Only Active
 * segments are listed, under HQ's name and words; the questions stay code's.
 * A store that cannot be read answers 503, never the full twelve.
 */
async function signUpStatuses(c: any) {
  try { return await statusesOf(c.env); } catch (e) {
    console.error('[personas] segment statuses unreadable:', (e as Error)?.message);
    return null;
  }
}
const STATUSES_UNREADABLE = { detail: 'The segments could not be read just now. Try again in a moment.', code: 'segments_unreadable' };

personas.get('/taxonomy', async (c) => {
  const statuses = await signUpStatuses(c);
  if (!statuses) return c.json(STATUSES_UNREADABLE, 503);
  let names = new Map<string, { name: string; who: string | null }>();
  try {
    const r = await c.env.DB.prepare(`SELECT key, name, who FROM segment_profiles`).all<{ key: string; name: string; who: string | null }>();
    names = new Map((r.results || []).map((x) => [x.key, { name: x.name, who: x.who }]));
  } catch (e) {
    console.error('[personas] segment names unreadable:', (e as Error)?.message);
    return c.json(STATUSES_UNREADABLE, 503);
  }
  const offered = PERSONAS.filter((p) => statuses.get(p.id) === 'active').map((p) => {
    const stored = names.get(p.id);
    return stored ? { ...p, label: stored.name, short_description: stored.who || p.short_description } : p;
  });
  return c.json({ personas: offered });
});

personas.get('/me', async (c) => {
  await ensurePersonaSchema(c.env);
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT id, user_id, persona_id, confidence, manual_override, source, is_primary, created_at, updated_at
    FROM user_personas WHERE user_id = ${user.id}
    ORDER BY is_primary DESC, updated_at DESC
  ` as unknown as UserPersonaRow[];
  const extras = await sql`
    SELECT id, user_id, persona_id, key, value, source FROM user_profile_extras WHERE user_id = ${user.id}
  ` as unknown as UserExtraRow[];
  await sql.end();
  return c.json({ personas: rows, extras });
});

personas.post('/classify', async (c) => {
  await ensurePersonaSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as { first_message?: unknown }));
  const firstMessage = typeof body.first_message === 'string' ? body.first_message : '';
  if (!firstMessage.trim()) return c.json({ error: 'first_message required' }, 400);
  const statuses = await signUpStatuses(c);
  if (!statuses) return c.json(STATUSES_UNREADABLE, 503);
  const result = await classifyPersona(c.env, { first_message: firstMessage, email: user.email });
  // D1000: a suggestion sign-up does not offer is not made; the member picks.
  const offered = (id: string | null) => !!id && statuses.get(id) === 'active';
  const alternatives = result.alternatives.filter((a) => offered(a.persona_id));
  if (result.persona_id && !offered(result.persona_id)) {
    return c.json({ ...result, persona_id: null, confidence: 0, follow_up_questions: [], needs_disambiguation: true, alternatives });
  }
  return c.json({ ...result, alternatives });
});

personas.post('/answer', async (c) => {
  await ensurePersonaSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as { persona_id?: unknown; key?: unknown; value?: unknown }));
  if (!isPersonaId(body.persona_id)) return c.json({ error: 'invalid persona_id' }, 400);
  const key = typeof body.key === 'string' ? body.key.slice(0, 80) : '';
  if (!key) return c.json({ error: 'key required' }, 400);
  const value = body.value == null ? null : String(body.value).slice(0, 4000);

  const sql = getSQL(c.env);
  const existing = await sql`
    SELECT id FROM user_profile_extras WHERE user_id = ${user.id} AND persona_id = ${body.persona_id} AND key = ${key}
  ` as unknown as Array<{ id: number }>;
  if (existing.length > 0) {
    await sql`
      UPDATE user_profile_extras SET value = ${value}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing[0].id}
    `;
  } else {
    await sql`
      INSERT INTO user_profile_extras (user_id, persona_id, key, value)
      VALUES (${user.id}, ${body.persona_id}, ${key}, ${value})
    `;
  }
  await sql.end();
  return c.json({ ok: true });
});

personas.post('/finalize', async (c) => {
  await ensurePersonaSchema(c.env);
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as { persona_id?: unknown; confidence?: unknown; secondary_persona_id?: unknown; source?: unknown }));
  if (!isPersonaId(body.persona_id)) return c.json({ error: 'invalid persona_id' }, 400);
  const confidence = Math.max(0, Math.min(1, Number(body.confidence) || 0));
  const source = body.source === 'self_select' ? 'self_select' : 'router';

  let secondary: PersonaId | null = null;
  if (body.secondary_persona_id != null) {
    if (!isPersonaId(body.secondary_persona_id)) return c.json({ error: 'invalid secondary_persona_id' }, 400);
    if (!isAllowedPersonaOverlap(body.persona_id, body.secondary_persona_id)) {
      return c.json({ error: 'persona overlap not allowed' }, 400);
    }
    secondary = body.secondary_persona_id;
  }

  const db = c.env.DB;
  // D1000: a member joins only an Active segment. One they already hold they
  // keep (a Retired segment's members keep it until they are moved).
  const statuses = await signUpStatuses(c);
  if (!statuses) return c.json(STATUSES_UNREADABLE, 503);
  const held = new Set(((await db.prepare(`SELECT persona_id FROM user_personas WHERE user_id = ?`).bind(user.id).all<{ persona_id: string }>()).results || []).map((r) => r.persona_id));
  for (const id of [body.persona_id, secondary]) {
    if (id && statuses.get(id) !== 'active' && !held.has(id)) return c.json({ detail: NOT_OFFERED, code: 'segment_not_offered' }, 409);
  }
  // Reset primary flags so we never end up with two primaries.
  await db.prepare(`UPDATE user_personas SET is_primary = 0 WHERE user_id = ?`).bind(user.id).run();
  await db.prepare(`
    INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(user_id, persona_id) DO UPDATE SET
      confidence = excluded.confidence,
      source = excluded.source,
      is_primary = 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(user.id, body.persona_id, confidence, source).run();
  if (secondary) {
    await db.prepare(`
      INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(user_id, persona_id) DO UPDATE SET
        confidence = excluded.confidence,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `).bind(user.id, secondary, confidence, source).run();
  }
  return c.json({ ok: true, primary: body.persona_id, secondary });
});

personas.get('/admin/list', async (c) => {
  await ensurePersonaSchema(c.env);
  await requireAdmin(c);
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT u.id as user_id, u.email, u.name, u.role,
           up.persona_id, up.confidence, up.manual_override, up.source, up.is_primary, up.updated_at
    FROM users u
    LEFT JOIN user_personas up ON up.user_id = u.id AND up.is_primary = 1
    ORDER BY u.created_at DESC
    LIMIT 500
  `;
  await sql.end();
  return c.json({ users: rows });
});

// D999 (#2814): the segment counts behind /admin/persona-segments. Counts
// only, over every account but admins; each block answers alone.
personas.get('/admin/segments', async (c) => {
  await ensurePersonaSchema(c.env);
  await requireAdmin(c);
  return c.json(await readPersonaSegments(c.env));
});

personas.post('/admin/:user_id/retag', async (c) => {
  await ensurePersonaSchema(c.env);
  const admin = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'), 10);
  if (!Number.isFinite(userId)) return c.json({ error: 'invalid user_id' }, 400);
  const body = await c.req.json().catch(() => ({} as { persona_id?: unknown }));
  if (!isPersonaId(body.persona_id)) return c.json({ error: 'invalid persona_id' }, 400);

  // D255, D1000: the single move's rules, shared with the bulk move (D1002, services/personaMembers.ts).
  try {
    const outcome = await moveOne(c.env, admin as any, isSuperAdmin(admin as any), userId, body.persona_id,
      () => movableSegment(c.env, body.persona_id).then(() => undefined));
    if (outcome === 'user_not_found') return c.json({ error: 'user_not_found' }, 404);
    if (outcome === 'super_admin_required') return c.json({ error: 'Only a super admin can re-tag an admin account.', code: 'super_admin_required' }, 403);
    if (outcome === 'unchanged') return c.json({ ok: true, unchanged: true });
  } catch (e) {
    if (e instanceof MembersError) return c.json(e.code === 'segments_unreadable' ? STATUSES_UNREADABLE : { detail: e.sentence, code: e.code }, e.status as any);
    throw e;
  }
  return c.json({ ok: true });
});

export default personas;
