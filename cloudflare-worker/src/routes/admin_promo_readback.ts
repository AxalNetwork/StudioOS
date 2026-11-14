/** Read one licence's checkout ceiling over its registered branch binding (#5039). */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { mapError } from './_t13t14t15_helpers';
import { branchByCode, BRANCH_DEADLINE_MS } from '../services/branches';
import { withDeadline } from '../util/deadline';
import { PERIOD_RE, quarterKey } from '../services/statements';

const r = new Hono<{ Bindings: Env }>();
r.get('/promo-ceilings/:uid/read-back', async (c) => {
  try {
    await requireSuperAdmin(c);
    const period = c.req.query('period');
    if (!period || !PERIOD_RE.test(period)) return c.json({ error: 'bad_period' }, 400);
    const uid = c.req.param('uid');
    const licence = await c.env.DB.prepare('SELECT uid FROM territory_licences WHERE uid = ?').bind(uid).first();
    if (!licence) return c.json({ error: 'not_found' }, 404);
    if (period !== quarterKey(new Date())) return c.json({ state: 'other_period', message: 'Checkout read-back covers the current quarter only.' });
    const deployment = await c.env.DB.prepare('SELECT code FROM licence_deployments WHERE licence_uid = ?').bind(uid).first<{ code: string }>();
    const branch = branchByCode(c.env, deployment?.code);
    if (!branch) return c.json({ state: 'not_deployed', message: 'No registered branch binding is available.' });
    try {
      const read: any = await withDeadline(branch.stub.promoCeilingReadback(), BRANCH_DEADLINE_MS, 'promotion read-back');
      if (read?.branch !== branch.code || typeof read?.as_of !== 'string' || !Number.isFinite(Date.parse(read.as_of))) throw new Error('Invalid branch read-back');
      const age = Date.now() - Date.parse(read.as_of);
      if (age < -5000 || age > 60_000) throw new Error('Stale branch read-back');
      if (read.ceiling === null) return c.json({ state: 'no_ceiling', as_of: read.as_of, message: 'Branch checkout has no ceiling for the current quarter.' });
      const actual = read.ceiling;
      if (actual?.period !== period || !['ceiling_cents', 'spent_cents', 'remaining_cents'].every((k) => Number.isSafeInteger(actual[k]) && actual[k] >= 0)
          || !/^[A-Z]{3}$/.test(actual.currency)) throw new Error('Unreadable checkout ceiling');
      const saved = await c.env.DB.prepare('SELECT ceiling_cents, currency FROM licence_promo_ceilings WHERE licence_uid = ? AND period = ?').bind(uid, period).first<{ ceiling_cents: number; currency: string }>();
      const matches = saved?.ceiling_cents === actual.ceiling_cents && saved?.currency === actual.currency;
      return c.json({ state: matches ? 'verified' : 'mismatch', as_of: read.as_of, actual,
        message: matches ? 'Branch checkout confirms this ceiling.' : 'Branch checkout differs from the saved HQ ceiling.' });
    } catch { return c.json({ state: 'unreadable', message: 'Branch checkout could not be read. No enforcement claim can be made.' }); }
  } catch (e) { return mapError(c, e); }
});
export const mount = { path: '/api/admin', router: r };
export default r;
