/** D6237: LP maintenance, composed before the shared fund router. */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { requireFundGp } from '../services/fundGpAccess';
import { assertFundAct, auditFundAct } from '../services/fundAdminAccess';
import { correctLp, removeLp, LpMaintenanceError } from '../services/fundLpMaintenance';
import funds from './funds';
const r = new Hono<{ Bindings: Env }>();
const id = (raw: string) => /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0;
function failure(c: any, error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof LpMaintenanceError) return refuse(c, error.status, { code: error.code, message: error.reason });
  const message = String((error as Error)?.message || '');
  if (AUTH_ERROR_STATUSES[message]) return c.json({ detail: message }, AUTH_ERROR_STATUSES[message]);
  throw error;
}
r.patch('/:id/lps/:lpId', async c => {
  try {
    const fundId = id(c.req.param('id')), lpId = id(c.req.param('lpId'));
    const gp = await requireFundGp(c, fundId);
    await assertFundAct(c, gp, 'fund.write');
    const body = await c.req.json().catch(() => null);
    const lp = await correctLp(c.env, fundId, lpId, Number(gp.user.id), body);
    await auditFundAct(c.env, gp.user, 'fund.write', { fund_id: fundId, lp_id: lpId, write: 'lp_corrected' });
    return c.json({ ok: true, lp });
  } catch (error) { return failure(c, error); }
});
r.delete('/:id/lps/:lpId', async c => {
  try {
    const fundId = id(c.req.param('id')), lpId = id(c.req.param('lpId'));
    const gp = await requireFundGp(c, fundId);
    await assertFundAct(c, gp, 'fund.write');
    await removeLp(c.env, fundId, lpId, Number(gp.user.id));
    await auditFundAct(c.env, gp.user, 'fund.write', { fund_id: fundId, lp_id: lpId, write: 'lp_removed' });
    return c.json({ ok: true, id: lpId });
  } catch (error) { return failure(c, error); }
});
export default r;
export const mount: RouteMount = { path: '/api/funds', router: r, before: [funds] };
