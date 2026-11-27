/**
 * Task #9 — Communities & Circles: public read feed.
 *
 * Mounted at /api/public (BEFORE the generic publicRoutes) so /api/public/circles
 * resolves here. No auth — this backs the public /circles marketing page. Only
 * admin-published rows are returned (published = 1); the page renders an empty
 * state until an admin publishes real circles from /admin/circles.
 *
 * Ordering mirrors the CircleCard grouping: featured first, then the admin's
 * sort_order, then newest.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureCirclesSchema } from '../services/circlesSchema';
import { shapeCircle } from '../services/circlesCommon';

const circlesPublic = new Hono<{ Bindings: Env }>();

circlesPublic.use('*', async (c, next) => {
  await ensureCirclesSchema(c.env);
  await next();
});

// ── GET /circles — published public feed ───────────────────────────────────
circlesPublic.get('/circles', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM circles
      WHERE published = 1
      ORDER BY featured DESC, sort_order ASC, created_at DESC
      LIMIT 200`,
  ).all();
  return c.json({ circles: (rows.results || []).map(shapeCircle) });
});

export default circlesPublic;
