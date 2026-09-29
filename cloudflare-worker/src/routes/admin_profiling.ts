/**
 * D358 — admin read of how the profiling population is shifting, mounted at
 * /api/admin/profiling (documentation/architecture/PROFILING_V2.md §7.9, §10).
 *
 *   GET /trends?months=12   aggregates only: archetype distribution per role
 *                           per month, displayed-archetype changes per month,
 *                           skill-axis coverage (self-rated vs evidence), and
 *                           answers revised per month.
 *
 * `requireAdmin` (every super admin is an admin). Counts only: no user id, no
 * name, no per-person row, no drill-down. Every count from 1 to
 * SMALL_CELL_MIN − 1 is hidden, with a second cell hidden where a total would
 * let the first be recovered (services/profileEvolution suppressGroup).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { profilingTrends } from '../services/profileEvolution';

const r = new Hono<{ Bindings: Env }>();

r.get('/trends', async (c) => {
  await requireAdmin(c);
  const raw = c.req.query('months');
  const months = raw == null || raw === '' ? 12 : Number(raw);
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return refuse(c, 400, { code: 'invalid_months', message: 'months is a whole number from 1 to 24.' });
  }
  try {
    return c.json(await profilingTrends(c.env, { months }));
  } catch (e) {
    return refuse(c, 503, { code: 'profiling_trends_unreadable', message: 'Profiling trends could not be read. Try again in a moment.', raw: e });
  }
});

export default r;
