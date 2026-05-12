/**
 * Task #4 (AW) L6 — Admin reader for advisor_turn_audit.
 *
 * Mounted at /api/admin/advisor-audit. Every endpoint gates on
 * requireAdmin. Writes (clear-shadow, lock/unlock) log to activity_logs
 * with the hashed-actor pattern (T22.1).
 *
 *   GET  /                           → recent audit rows (?flagged=1, ?limit=50)
 *   GET  /user/:userId               → per-user audit + current lock/shadow state
 *   POST /clear-shadow/:userId       → users.advisor_shadow_flag = 0
 *   POST /lock/:userId               → body { locked: boolean } → users.advisor_locked
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { hashEmail } from '../util/hashEmail';
import { ensureAuditSchema, ensureGuardrailColumns } from '../services/advisor/guardrails';

const r = new Hono<{ Bindings: Env }>();

interface AuditRow {
  id: number;
  user_id: number;
  email: string | null;
  conversation_id: number | null;
  model: string | null;
  prompt_hash: string;
  tool_calls_json: string | null;
  ai_spend_usd: number;
  safety_score: number | null;
  sanitisation_actions_json: string | null;
  refusal_reason: string | null;
  shadow_flagged: number;
  created_at: string;
}

async function logAdminAction(
  env: Env, adminUserId: number, adminEmail: string, action: string, details: Record<string, unknown>,
): Promise<void> {
  try {
    const actor = await hashEmail(adminEmail || '');
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`,
    ).bind(action, JSON.stringify(details), actor, adminUserId).run();
  } catch (e) {
    console.warn('[admin_advisor_audit] activity log:', (e as Error).message);
  }
}

r.get('/', async (c) => {
  await requireAdmin(c);
  await ensureAuditSchema(c.env);
  const flagged = c.req.query('flagged') === '1';
  const limitRaw = Number(c.req.query('limit') || '50');
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));
  const sql = flagged
    ? `SELECT a.*, u.email FROM advisor_turn_audit a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.shadow_flagged = 1
         ORDER BY a.id DESC LIMIT ?`
    : `SELECT a.*, u.email FROM advisor_turn_audit a
         LEFT JOIN users u ON u.id = a.user_id
         ORDER BY a.id DESC LIMIT ?`;
  const rows = await c.env.DB.prepare(sql).bind(limit).all<AuditRow>();
  return c.json({
    turns: rows.results || [],
    filter: { flagged, limit },
  });
});

r.get('/user/:userId', async (c) => {
  await requireAdmin(c);
  await ensureAuditSchema(c.env);
  await ensureGuardrailColumns(c.env);
  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) return c.json({ error: 'invalid user_id' }, 400);
  const user = await c.env.DB.prepare(
    `SELECT id, email, advisor_locked, advisor_shadow_flag FROM users WHERE id = ?`,
  ).bind(uid).first<{ id: number; email: string; advisor_locked: number | null; advisor_shadow_flag: number | null }>();
  if (!user) return c.json({ error: 'user not found' }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM advisor_turn_audit WHERE user_id = ? ORDER BY id DESC LIMIT 200`,
  ).bind(uid).all<AuditRow>();
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      advisor_locked: Number(user.advisor_locked) === 1,
      advisor_shadow_flag: Number(user.advisor_shadow_flag) === 1,
    },
    turns: rows.results || [],
  });
});

r.post('/clear-shadow/:userId', async (c) => {
  const admin = await requireAdmin(c);
  await ensureGuardrailColumns(c.env);
  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) return c.json({ error: 'invalid user_id' }, 400);
  await c.env.DB.prepare(`UPDATE users SET advisor_shadow_flag = 0 WHERE id = ?`).bind(uid).run();
  await logAdminAction(c.env, admin.id, admin.email, 'advisor_shadow_cleared', { target_user_id: uid });
  return c.json({ ok: true, user_id: uid, advisor_shadow_flag: false });
});

r.post('/lock/:userId', async (c) => {
  const admin = await requireAdmin(c);
  await ensureGuardrailColumns(c.env);
  const uid = Number(c.req.param('userId'));
  if (!Number.isFinite(uid) || uid <= 0) return c.json({ error: 'invalid user_id' }, 400);
  const body = await c.req.json().catch(() => ({})) as { locked?: boolean };
  const locked = !!body.locked;
  await c.env.DB.prepare(`UPDATE users SET advisor_locked = ? WHERE id = ?`)
    .bind(locked ? 1 : 0, uid).run();
  await logAdminAction(c.env, admin.id, admin.email, locked ? 'advisor_locked' : 'advisor_unlocked', {
    target_user_id: uid,
  });
  return c.json({ ok: true, user_id: uid, advisor_locked: locked });
});

export default r;
