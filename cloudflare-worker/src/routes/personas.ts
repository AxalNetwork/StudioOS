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
 * - POST /api/personas/admin/:user_id/retag admin: set primary persona
 *                                          with manual_override = 1
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth, requireAdmin } from '../auth';
import { PERSONAS, PERSONA_BY_ID, isAllowedPersonaOverlap, type PersonaId } from '../personas';
import { classifyPersona } from '../../ai-workers/persona-router';

const personas = new Hono<{ Bindings: Env }>();

let migrated = false;
async function ensurePersonaSchema(env: Env): Promise<void> {
  if (migrated) return;
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
  migrated = true;
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

personas.get('/taxonomy', (c) => c.json({ personas: PERSONAS }));

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
  const result = await classifyPersona(c.env, { first_message: firstMessage, email: user.email });
  return c.json(result);
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

personas.post('/admin/:user_id/retag', async (c) => {
  await ensurePersonaSchema(c.env);
  const admin = await requireAdmin(c);
  const userId = parseInt(c.req.param('user_id'), 10);
  if (!Number.isFinite(userId)) return c.json({ error: 'invalid user_id' }, 400);
  const body = await c.req.json().catch(() => ({} as { persona_id?: unknown }));
  if (!isPersonaId(body.persona_id)) return c.json({ error: 'invalid persona_id' }, 400);

  const db = c.env.DB;
  await db.prepare(`UPDATE user_personas SET is_primary = 0 WHERE user_id = ?`).bind(userId).run();
  await db.prepare(`
    INSERT INTO user_personas (user_id, persona_id, confidence, manual_override, source, is_primary)
    VALUES (?, ?, 1, 1, 'admin_retag', 1)
    ON CONFLICT(user_id, persona_id) DO UPDATE SET
      manual_override = 1,
      source = 'admin_retag',
      is_primary = 1,
      updated_at = CURRENT_TIMESTAMP
  `).bind(userId, body.persona_id).run();

  const sql = getSQL(c.env);
  await sql`
    INSERT INTO activity_logs (action, details, actor, user_id)
    VALUES ('persona_retagged', ${`Admin ${admin.name} re-tagged user ${userId} as ${body.persona_id}`}, ${admin.email}, ${admin.id})
  `;
  await sql.end();
  return c.json({ ok: true });
});

export default personas;
