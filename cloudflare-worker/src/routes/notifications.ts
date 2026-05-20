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

// Task #2 (IB) — Public one-click unsubscribe (RFC 8058). MUST sit
// BEFORE the requireAuth-using handlers so it stays reachable from a
// link in an email (the recipient is NOT signed in). Token is the
// HMAC-signed `{user_id}.{exp}.{hex_sig}` produced by services/email/send.ts.
async function verifyUnsubscribeToken(env: Env, token: string): Promise<{ userId: number } | null> {
  const m = /^(\d+)\.(\d+)\.([0-9a-f]+)$/i.exec(token || '');
  if (!m) return null;
  const userId = parseInt(m[1], 10);
  const exp    = parseInt(m[2], 10);
  const sigHex = m[3].toLowerCase();
  if (!userId || !exp || exp * 1000 < Date.now()) return null;
  const secret = (env as any).AXAL_ENCRYPTION_SECRET || (env as any).JWT_SECRET;
  if (!secret) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}.${exp}`));
    const want = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return want === sigHex ? { userId } : null;
  } catch { return null; }
}

async function applyMarketingUnsub(env: Env, userId: number): Promise<void> {
  try {
    // Lazy ALTER — migration 053 may not have landed on dev/preview yet.
    try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN marketing_unsubscribed_at TIMESTAMP`).run(); } catch { /* idempotent */ }
    await env.DB.prepare(
      `UPDATE users SET marketing_unsubscribed_at = CURRENT_TIMESTAMP WHERE id = ? AND marketing_unsubscribed_at IS NULL`,
    ).bind(userId).run();
  } catch (e) { console.warn('[notifications] marketing unsub failed', e); }
}

const unsubHtml = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Axal — Unsubscribed</title>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#111;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">Axal</h1>
<p style="font-size:15px;line-height:1.55;">${msg}</p>
<p style="font-size:13px;color:#6b7280;"><a href="/settings/notifications" style="color:#6b7280;">Open notification settings</a></p>`;

// Both GET (visible link in email) and POST (RFC 8058 one-click) hit
// the same handler. CSRF middleware exempts the POST because there is
// no cookie auth on this path — the HMAC token IS the authorisation.
async function unsubscribeHandler(c: any) {
  const token = c.req.query('token') || '';
  const v = await verifyUnsubscribeToken(c.env, token);
  if (!v) return c.html(unsubHtml('That unsubscribe link is invalid or expired. Open your <a href="/settings/notifications">notification settings</a> to manage email preferences.'), 400);
  await applyMarketingUnsub(c.env, v.userId);
  return c.html(unsubHtml('You\'ve been unsubscribed from Axal marketing emails. Transactional notifications (security, billing, contracts) will continue.'));
}
notifications.get('/unsubscribe', unsubscribeHandler);
notifications.post('/unsubscribe', unsubscribeHandler);

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
    // Task #2 (IB) — spec columns surfaced when present on the row.
    category: r.category ?? null,
    severity: r.severity ?? 'info',
    cta_url: r.cta_url ?? r.link ?? null,
    template_key: r.template_key ?? null,
  };
}

notifications.get('/', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await ensureInbox(c.env))) return c.json({ notifications: [] });
  const limitRaw = parseInt(c.req.query('limit') || '50', 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 50, 200));
  // Task #2 (IB) — spec supports `?unread=true` and `?category=`.
  // Existing callers still pass `?only_unread=1`; honour both.
  const onlyUnread = c.req.query('only_unread') === '1' || c.req.query('unread') === 'true';
  const category = (c.req.query('category') || '').trim();
  const wheres = ['user_id = ?'];
  const binds: any[] = [user.id];
  if (onlyUnread) wheres.push('read_at IS NULL');
  if (category) { wheres.push('category = ?'); binds.push(category); }
  const sql = `SELECT * FROM notifications_inbox WHERE ${wheres.join(' AND ')} ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);
  const r: any = await c.env.DB.prepare(sql).bind(...binds).all();
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

// ─── Task #2 (IB) spec endpoints ────────────────────────────────────────────
//   POST   /api/notifications/:id/read     mark a single row read
//   POST   /api/notifications/read-all     mark every unread row read
//   DELETE /api/notifications/:id          dismiss a single row
// The legacy POST /mark-read {ids|all} stays mounted above for back-compat.

notifications.post('/read-all', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (!(await ensureInbox(c.env))) return c.json({ updated: 0 });
  const r: any = await c.env.DB.prepare(
    `UPDATE notifications_inbox SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
  ).bind(new Date().toISOString(), user.id).run();
  return c.json({ updated: Number(r?.meta?.changes || 0) });
});

notifications.post('/:id/read', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 422);
  if (!(await ensureInbox(c.env))) return c.json({ updated: 0 });
  const r: any = await c.env.DB.prepare(
    `UPDATE notifications_inbox SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
  ).bind(new Date().toISOString(), id, user.id).run();
  return c.json({ updated: Number(r?.meta?.changes || 0) });
});

notifications.delete('/:id', async (c) => {
  const user = await requireAuth(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'invalid id' }, 422);
  if (!(await ensureInbox(c.env))) return c.json({ deleted: 0 });
  const r: any = await c.env.DB.prepare(
    `DELETE FROM notifications_inbox WHERE id = ? AND user_id = ?`,
  ).bind(id, user.id).run();
  return c.json({ deleted: Number(r?.meta?.changes || 0) });
});

export default notifications;
