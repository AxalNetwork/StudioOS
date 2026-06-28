/**
 * Task #19 WS5 — Admin best-fit report fetch.
 *
 * GET /api/admin/best-fit/:userId returns the full live best-fit report for a
 * subject user (skills / values / Axal values / archetype / per-persona fit /
 * cross-counterparty matches / spin-out risk). Admin-only and deliberately NOT
 * tier-gated — the admin always sees the complete report.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { buildBestFitReport } from '../services/bestFit';
import { ensureAxalFitSchema } from '../services/axalFitSchema';

const adminBestFit = new Hono<{ Bindings: Env }>();
adminBestFit.use('*', async (c, next) => {
  await requireAdmin(c);
  await next();
});

// GET /api/admin/best-fit/:userId — live report (no tier check).
adminBestFit.get('/:userId', async (c) => {
  const userId = Number(c.req.param('userId'));
  if (!Number.isFinite(userId) || userId <= 0) return c.json({ error: 'bad user id' }, 400);

  await ensureAxalFitSchema(c.env);
  const report = await buildBestFitReport(c.env, userId);
  if (!report) return c.json({ error: 'user not found' }, 404);
  return c.json(report);
});

export default adminBestFit;
