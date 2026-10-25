/**
 * D893 (#2660) — Admin › Insights' one read.
 *
 *   GET /api/admin/insights?range=8w|quarter|year&profile=&country=&compare=1&group=&scope=
 *
 * requireAdmin. Counts only: `services/adminInsights.ts` says what each block
 * counts and how it fails alone.
 *
 * SCOPE. This deployment answers for its own accounts (`hq`, or the branch
 * code). Another scope is HQ's: a plain Admin, or any admin on a branch, gets
 * 403 `hq_only` before any read. A Super Admin on HQ gets that subsidiary's
 * counts, read from its own database through the fan-out (D893 S08, #2662):
 * `services/insightsScope.ts` asks the branch, and the branch answers with
 * `loadInsightsForBranch` below, this same read over its own D1.
 *
 * A FILTER THIS CANNOT READ IS A 400, never a quietly wider answer: an unknown
 * range would otherwise draw eight weeks under a label that asked for a year.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { parseAnalyticsRange } from '../services/activeAccounts';
import { adminInsights, ownScope, type InsightsQuery } from '../services/adminInsights';
import { HQ_ONLY_MESSAGE, branchScopedInsights, insightsParams, normaliseScope, type InsightsLoader } from '../services/insightsScope';

const r = new Hono<{ Bindings: Env }>();

/** A role key: what `users.role` holds. */
const PROFILE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** A country as stored: free text on the profile, bounded and printable. */
function parseCountry(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw === '') return null;
  const v = raw.trim();
  if (!v || v.length > 64 || /[\u0000-\u001f\u007f]/.test(v)) return undefined;
  return v;
}

function parseProfile(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw === '') return null;
  return PROFILE_RE.test(raw) ? raw : undefined;
}

/** The query's filters, or the 400 to send. One parser for the route and the branch's RPC. */
export function parseInsightsQuery(get: (k: string) => string | undefined):
  { ok: true; query: InsightsQuery } | { ok: false; code: string; detail: string } {
  const range = parseAnalyticsRange(get('range'));
  if (!range) return { ok: false, code: 'bad_range', detail: 'range must be 8w, quarter or year.' };
  const role = parseProfile(get('profile'));
  if (role === undefined) return { ok: false, code: 'bad_profile', detail: 'profile must be a role key.' };
  const group = parseProfile(get('group'));
  if (group === undefined) return { ok: false, code: 'bad_group', detail: 'group must be a role key.' };
  const country = parseCountry(get('country'));
  if (country === undefined) return { ok: false, code: 'bad_country', detail: 'country must be at most 64 printable characters.' };
  return { ok: true, query: { range, role, country, compare: get('compare') === '1', group } };
}

/**
 * D893 S08 — what a branch runs when HQ's Super Admin picks it: this read,
 * over the branch's own database, from the parameters HQ forwarded. A filter
 * the read cannot use throws, and HQ shows that as the unreadable blocks.
 */
export const loadInsightsForBranch: InsightsLoader = async (env, params) => {
  const p = parseInsightsQuery((k) => params[k as keyof typeof params]);
  if (!p.ok) throw new Error(p.detail);
  return adminInsights(env, p.query);
};

r.get('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const scope = c.req.query('scope');
    const other = scope && scope !== ownScope(c.env);
    if (other && !isSuperAdmin(user as any)) {
      return c.json({ code: 'hq_only', detail: HQ_ONLY_MESSAGE }, 403);
    }
    const p = parseInsightsQuery((k) => c.req.query(k));
    if (!p.ok) return c.json({ code: p.code, detail: p.detail }, 400);
    if (other) {
      // `isSuperAdmin` answers false on a branch (D106), so only HQ gets here.
      const code = normaliseScope(scope);
      if (!code) return c.json({ code: 'bad_scope', detail: 'scope must be hq or a subsidiary\'s code.' }, 400);
      return c.json(await branchScopedInsights(c.env, code, insightsParams(c.req.query())));
    }
    return c.json(await adminInsights(c.env, p.query));
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
