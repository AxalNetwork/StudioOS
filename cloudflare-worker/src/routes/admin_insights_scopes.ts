/**
 * D893 (#2662) — the Scope select of Admin › Insights.
 *
 *   GET /api/admin/insights/scopes   (Super Admin, on HQ)
 *
 * The select's lines: HQ-held accounts, then one line per deployed subsidiary
 * from the deployment registry (`services/insightsScope.ts`). A plain Admin, or
 * any admin on a branch, gets 403 `hq_only`: the select is HQ's.
 *
 * A picked line's counts come from `GET /api/admin/insights?scope=<code>`
 * (`routes/admin_insights.ts`), which asks that branch through the fan-out.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import { HQ_ONLY_MESSAGE, insightsScopes, scopeIsBound } from '../services/insightsScope';

type C = Context<{ Bindings: Env }>;

const r = new Hono<{ Bindings: Env }>();

/** The select is HQ's: INS10's words for anyone else. */
function hqOnly(c: C): Response {
  return refuse(c, 403, { code: 'hq_only', message: HQ_ONLY_MESSAGE });
}

r.get('/', async (c) => {
  const user = await requireAdmin(c);
  // `requireSuperAdmin`'s two refusals, in INS10's words and one code.
  if (branchOf(c.env) || !isSuperAdmin(user as any)) return hqOnly(c);
  const { scopes, registry } = await insightsScopes(c.env);
  return c.json({
    scopes: scopes.map((s) => ({ ...s, bound: scopeIsBound(c.env, s.code) })),
    ...(registry.readable ? {} : { reason: registry.reason }),
  });
});

export default r;
