/**
 * Task #20 — self Best-Fit read endpoint.
 *
 * GET /api/best-fit/me returns the CALLER'S OWN Axal Fit scorecard (per-persona
 * weighted-rubric score + band) and their 5 Axal behavioral values, for the
 * dashboard "Your Profile & Fit" section. Read-only.
 *
 * Deliberately leaner than the admin report (services/bestFit.ts): it does NOT
 * include cross-counterparty matches or the spin-out risk assessment. Matches
 * stay tier-gated via GET /api/matches/summary; the full report stays admin-only
 * via GET /api/admin/best-fit/:userId.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { loadAllLatestFit, loadAxalValues } from '../services/axalFit';

const bestFitSelf = new Hono<{ Bindings: Env }>();

// GET /api/best-fit/me — the caller's own fit scorecard + 5 Axal values.
bestFitSelf.get('/me', async (c) => {
  const user = await requireAuth(c);
  const [fit, axalValues] = await Promise.all([
    loadAllLatestFit(c.env, user.id),
    loadAxalValues(c.env, user.id),
  ]);
  const primary_persona = fit.length
    ? [...fit].sort((a, b) => b.total_score - a.total_score)[0].persona
    : null;
  const computed_at = fit.reduce<string | null>(
    (acc, f) => (f.computed_at && (!acc || f.computed_at > acc) ? f.computed_at : acc),
    null,
  );
  return c.json({ primary_persona, fit, axal_values: axalValues, computed_at });
});

export default bestFitSelf;
