/**
 * D893 (#2662) — the Scope select of Admin › Insights, and the gate on
 * `?scope=`.
 *
 *   GET /api/admin/insights/scopes   (Super Admin, on HQ)
 *
 * The select's lines: HQ-held accounts, then one line per deployed subsidiary
 * from the deployment registry (`services/insightsScope.ts`). A plain Admin, or
 * any admin on a branch, gets 403 `hq_only`: the select is HQ's.
 *
 * `insightsScopeGate` and `scopedInsightsRead` are what `GET /api/admin/insights`
 * (#2660, `routes/admin_insights.ts`) calls for `?scope=<code>`: the gate
 * refuses a plain Admin with INS10's words, and the read asks that branch for
 * its own counts through the fan-out.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import { branchOf } from '../util/branch';
import { refuse } from '../util/refusal';
import {
  HQ_ONLY_MESSAGE, HQ_SCOPE, normaliseScope, insightsScopes, branchScopedInsights, scopeIsBound,
  type InsightsParams,
} from '../services/insightsScope';

type C = Context<{ Bindings: Env }>;

const r = new Hono<{ Bindings: Env }>();

/** The refusal for a scope that is not this admin's. One body for the select and the read. */
function hqOnly(c: C): Response {
  return refuse(c, 403, { code: 'hq_only', message: HQ_ONLY_MESSAGE });
}

/**
 * Null when this admin may read `raw`'s scope; otherwise the response to send.
 * An admin's own deployment (no scope, or `hq`) always passes. Any other scope
 * needs a Super Admin on HQ: a plain Admin, or an admin on a branch, gets 403
 * `hq_only`. A scope that is not a branch code is 400.
 */
export async function insightsScopeGate(c: C, raw: string | null | undefined): Promise<
  { scope: string; refusal: null } | { scope: null; refusal: Response }
> {
  const user = await requireAdmin(c);
  const scope = normaliseScope(raw);
  if (!scope) {
    return { scope: null, refusal: refuse(c, 400, { code: 'bad_scope', message: 'scope must be hq or a subsidiary\'s code.' }) };
  }
  if (scope === HQ_SCOPE) return { scope, refusal: null };
  if (branchOf(c.env) || !isSuperAdmin(user as any)) return { scope: null, refusal: hqOnly(c) };
  return { scope, refusal: null };
}

/** One subsidiary's Insights, from its own database. Call it after the gate passed a branch code. */
export function scopedInsightsRead(c: C, scope: string, params: InsightsParams) {
  return branchScopedInsights(c.env, scope, params);
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
