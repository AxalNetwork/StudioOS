/**
 * What this branch Worker is, and what it is not (S14, D209).
 *
 *   GET /api/branch/deployment
 *
 * THE BRANCH'S HALF OF THE TOPOLOGY. HQ reads its own half at
 * GET /api/admin/platform/topology; both answer from `services/topology.ts`,
 * so the two tiers cannot describe one architecture two ways.
 *
 * S14 DREW THREE REFUSALS AS FACTS — no binding to another branch, no Analytics
 * Engine SQL API, no deploy — and two of them depend on what this Worker was
 * given rather than on code. So the payload's `cannot` list is read from `env`
 * on this deployment and says which way each came out; a refusal that has
 * stopped holding is reported as such, not recited.
 *
 * NO STORE, NO UNREADABLE STATE. The service reads `env` only, so there is
 * nothing here that can fail to answer the way a D1 read can.
 *
 * Admin-gated and branch-only, the gates every other `/api/branch/*` read uses;
 * not suspension-gated, because reads never are (D130).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { requireBranchTier } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import { describeTopology } from '../services/topology';

const r = new Hono<{ Bindings: Env }>();

// GET /api/branch/deployment
r.get('/deployment', async (c) => {
  try {
    await requireAdmin(c);
    requireBranchTier(c.env);
    return c.json(describeTopology(c.env));
  } catch (e) { return mapError(c, e); }
});

export default r;
