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
import { ensureAxalFitSchema } from '../services/axalFitSchema';
import { loadAllLatestArchetype } from '../services/archetypeScoring';
import { loadLatestFitDecision } from '../services/fitDecision';

const bestFitSelf = new Hono<{ Bindings: Env }>();

// GET /api/best-fit/me — the caller's own fit scorecard + 5 Axal values +
// conversational archetype (Task #45).
bestFitSelf.get('/me', async (c) => {
  const user = await requireAuth(c);
  await ensureAxalFitSchema(c.env);
  const [fit, axalValues, archetypes, fitV2Latest] = await Promise.all([
    loadAllLatestFit(c.env, user.id),
    loadAxalValues(c.env, user.id),
    loadAllLatestArchetype(c.env, user.id),
    // Fit v2 — additive summary of the latest decision (null until the user
    // completes a staged assessment). Existing response keys are untouched.
    loadLatestFitDecision(c.env, user.id).catch(() => null),
  ]);
  const primary_persona = fit.length
    ? [...fit].sort((a, b) => b.total_score - a.total_score)[0].persona
    : null;
  const computed_at = fit.reduce<string | null>(
    (acc, f) => (f.computed_at && (!acc || f.computed_at > acc) ? f.computed_at : acc),
    null,
  );
  // Prefer the archetype that matches the primary fit persona so the card
  // matches the scorecard; otherwise take the highest-confidence one.
  const archetype = archetypes.find((a) => a.persona === primary_persona) || archetypes[0] || null;
  const fit_v2 = fitV2Latest
    ? {
        latest_decision: {
          uid: fitV2Latest.uid,
          role_context: fitV2Latest.role_context,
          outcome: fitV2Latest.outcome,
          culture_score: fitV2Latest.culture_score,
          role_score: fitV2Latest.role_score,
          confidence: fitV2Latest.confidence,
          computed_at: fitV2Latest.computed_at,
        },
      }
    : { latest_decision: null };
  return c.json({ primary_persona, fit, axal_values: axalValues, archetype, archetypes, computed_at, fit_v2 });
});

export default bestFitSelf;
