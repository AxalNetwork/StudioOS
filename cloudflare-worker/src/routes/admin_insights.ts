/**
 * D893 (#2660) — Admin › Insights' one read.
 *
 *   GET /api/admin/insights?range=8w|quarter|year&profile=&country=&compare=1&group=&scope=
 *
 * requireAdmin. Counts only: `services/adminInsights.ts` says what each block
 * counts and how it fails alone.
 *
 * SCOPE. This deployment answers for its own accounts (`hq`, or the branch
 * code). Another scope is refused before any read: a plain Admin with 403
 * `hq_only`, because reading another subsidiary is HQ's; a Super Admin with
 * 400 `scope_unavailable`, because that read is #2662's and does not exist yet.
 *
 * A FILTER THIS CANNOT READ IS A 400, never a quietly wider answer: an unknown
 * range would otherwise draw eight weeks under a label that asked for a year.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { parseAnalyticsRange } from '../services/activeAccounts';
import { adminInsights, ownScope } from '../services/adminInsights';

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

r.get('/', async (c) => {
  try {
    const user = await requireAdmin(c);
    const scope = c.req.query('scope');
    if (scope && scope !== ownScope(c.env)) {
      return isSuperAdmin(user as any)
        ? c.json({
          code: 'scope_unavailable',
          detail: 'Insights for another subsidiary are not read yet (#2662). This read answers for this deployment\'s own accounts.',
        }, 400)
        : c.json({ code: 'hq_only', detail: 'Only HQ reads another subsidiary\'s insights.' }, 403);
    }
    const range = parseAnalyticsRange(c.req.query('range'));
    if (!range) return c.json({ code: 'bad_range', detail: 'range must be 8w, quarter or year.' }, 400);
    const role = parseProfile(c.req.query('profile'));
    if (role === undefined) return c.json({ code: 'bad_profile', detail: 'profile must be a role key.' }, 400);
    const group = parseProfile(c.req.query('group'));
    if (group === undefined) return c.json({ code: 'bad_group', detail: 'group must be a role key.' }, 400);
    const country = parseCountry(c.req.query('country'));
    if (country === undefined) return c.json({ code: 'bad_country', detail: 'country must be at most 64 printable characters.' }, 400);
    const compare = c.req.query('compare') === '1';
    return c.json(await adminInsights(c.env, { range, role, country, compare, group }));
  } catch (e) {
    return mapError(c, e);
  }
});

export default r;
