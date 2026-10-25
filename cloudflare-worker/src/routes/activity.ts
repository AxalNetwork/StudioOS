import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';

const activity = new Hono<{ Bindings: Env }>();

// T16 — backfillUserId() used to run a full UPDATE on every request to map
// legacy activity_logs.actor (email) → user_id. The one-time SQL migration
// at sql/backfill_activity_user_ids.sql replaces it. Apply once via
// `wrangler d1 execute … --remote`; new INSERTs already set user_id directly.

activity.get('/', async (c) => {
  const user = await requireAuth(c);
  const limit = clampLimit(c.req.query('limit'));
  const offset = parseOffset(c.req.query('offset'));
  const sql = getSQL(c.env);

  // STRICT per-user privacy — even admins only see their OWN activity here.
  const countResult = await sql`
    SELECT COUNT(*) as total FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
  `;
  const rows = await sql`
    SELECT * FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  await sql.end();
  // T17 — Standard pagination envelope. `logs` retained for backwards
  // compatibility with existing ActivityPage; `items` is the new canonical
  // field that future callers should use.
  return c.json({
    items: rows,
    logs: rows,
    total: parseInt(countResult[0].total),
    limit,
    offset,
    user_id: user.id,
  });
});

// Task #7 (IG) — Lightweight recent feed consumed by the Cmd+K palette.
// Trimmed projection (id/action/details/created_at) so the palette index
// stays small; capped at 20 rows regardless of caller input.
activity.get('/recent', async (c) => {
  const user = await requireAuth(c);
  const requested = parseInt(c.req.query('limit') || '20', 10);
  const limit = Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 20));
  const sql = getSQL(c.env);
  const rows = await sql`
    SELECT id, action, details, created_at FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC LIMIT ${limit}
  `;
  await sql.end();
  return c.json({ items: rows, limit });
});

activity.get('/summary', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);

  const total = await sql`
    SELECT COUNT(*) as count FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
  `;
  const recent = await sql`
    SELECT * FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    ORDER BY created_at DESC LIMIT 10
  `;
  const actionCounts = await sql`
    SELECT action, COUNT(*) as count FROM activity_logs
    WHERE user_id = ${user.id} OR LOWER(actor) = LOWER(${user.email})
    GROUP BY action
  `;
  await sql.end();

  const breakdown: Record<string, number> = {};
  for (const r of actionCounts) breakdown[r.action] = parseInt(r.count);

  return c.json({
    total_events: parseInt(total[0].count),
    recent,
    action_breakdown: breakdown,
    user_id: user.id,
  });
});

export default activity;
