/**
 * Phase 0.2 — Notification center (Worker mirror).
 *
 * Mirrors backend/app/api/routes/notifications.py so the bell, dropdown,
 * and Settings preference matrix work identically against axal.vc prod.
 *
 * Uses table `notifications_inbox` to avoid clashing with the Epic 5
 * admin-alert table (`notifications`) that uses a different schema
 * (kind/dedupe_key) and is owned by services/notifications.ts.
 *
 * Endpoints
 *   GET  /api/notifications              list (newest first)
 *   GET  /api/notifications/unread-count
 *   POST /api/notifications/mark-read    {ids|all}
 *   GET  /api/notifications/prefs
 *   PUT  /api/notifications/prefs        {prefs}
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

const notifications = new Hono<{ Bindings: Env }>();

let inboxMigrated = false;
async function ensureInbox(env: Env): Promise<boolean> {
  if (inboxMigrated) return true;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS notifications_inbox (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         user_id INTEGER NOT NULL,
         type TEXT NOT NULL,
         title TEXT NOT NULL,
         body TEXT,
         link TEXT,
         payload TEXT,
         channel TEXT DEFAULT 'in_app',
         read_at TIMESTAMP,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
       )`,
    ).run();
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_inbox_user_unread
         ON notifications_inbox(user_id, read_at, created_at)`,
    ).run();
    inboxMigrated = true;
    return true;
  } catch (e) {
    console.error('[notifications_inbox] migration failed', e);
    return false;
  }
}

function dto(r: any) {
  let payload: any = null;
  if (r.payload) {
    try { payload = JSON.parse(r.payload); } catch { payload = null; }
  }
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    payload,
    channel: r.channel,
    read_at: r.read_at,
    created_at: r.created_at,
  };
}

notifications.get('/', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await ensureInbox(c.env))) return c.json({ notifications: [] });
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 200));
  const onlyUnread = c.req.query('only_unread') === '1';
  const sql = onlyUnread
    ? `SELECT * FROM notifications_inbox WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`
    : `SELECT * FROM notifications_inbox WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`;
  const r: any = await c.env.DB.prepare(sql).bind(user.id, limit).all();
  return c.json({ notifications: (r?.results || []).map(dto) });
});

notifications.get('/unread-count', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await ensureInbox(c.env))) return c.json({ count: 0 });
  const r: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM notifications_inbox WHERE user_id = ? AND read_at IS NULL`,
  ).bind(user.id).first();
  return c.json({ count: Number(r?.c || 0) });
});

notifications.post('/mark-read', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await ensureInbox(c.env))) return c.json({ updated: 0 });
  const body: any = await c.req.json().catch(() => ({}));
  const now = new Date().toISOString();
  if (body?.all) {
    const r: any = await c.env.DB.prepare(
      `UPDATE notifications_inbox SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
    ).bind(now, user.id).run();
    return c.json({ updated: Number(r?.meta?.changes || 0) });
  }
  const ids: number[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => Number.isInteger(x)) : [];
  if (!ids.length) return c.json({ error: 'Provide ids[] or all=true' }, 422);
  // Bind a parameter per id; cap to avoid pathological binds.
  const capped = ids.slice(0, 200);
  const placeholders = capped.map(() => '?').join(',');
  const r: any = await c.env.DB.prepare(
    `UPDATE notifications_inbox SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
  ).bind(now, user.id, ...capped).run();
  return c.json({ updated: Number(r?.meta?.changes || 0) });
});

notifications.get('/prefs', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  try {
    const r: any = await c.env.DB.prepare(
      `SELECT notification_prefs FROM users WHERE id = ?`,
    ).bind(user.id).first();
    let prefs: any = {};
    if (r?.notification_prefs) {
      try { prefs = JSON.parse(r.notification_prefs); } catch { prefs = {}; }
    }
    return c.json({ prefs });
  } catch {
    return c.json({ prefs: {} });
  }
});

notifications.put('/prefs', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const body: any = await c.req.json().catch(() => ({}));
  const prefs = (body && typeof body === 'object') ? (body.prefs || {}) : {};
  const j = JSON.stringify(prefs);
  if (j.length > 16_000) return c.json({ error: 'notification_prefs too large' }, 400);
  try {
    await c.env.DB.prepare(
      `UPDATE users SET notification_prefs = ? WHERE id = ?`,
    ).bind(j, user.id).run();
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to save' }, 500);
  }
});

export default notifications;
