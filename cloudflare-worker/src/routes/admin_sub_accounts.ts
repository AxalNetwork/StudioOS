/**
 * D1302 (#3399, Accounts part 3 of #2377) — an account's sub-accounts, for
 * Admin › Accounts, mounted at /api/admin/sub-accounts.
 *
 *   GET /counts             the Overview's LP and Product tester widgets
 *                           (ACC1): testers per status (`pending` is #2390's
 *                           Product testers lane), LPs counted once each, and
 *                           the LP applications still waiting.
 *   GET /accounts/:userId   one account's Product tester record with its
 *                           history, and its LP applications (ACC5).
 *
 * Reads only. A tester is decided on `/api/admin/product-testers` (D1042),
 * which tells the member and refuses an admin account; an LP on the LP
 * applications page. `requireAdmin`; another administrator's record is the
 * Super Admin's to open (403 `super_admin_required`, D133). Each block says
 * `not_set_up` or `unreadable` on its own, never a 0. The rules live in
 * services/subAccounts.ts.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { isSuperAdmin, requireAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { accountSubAccounts, subAccountCounts } from '../services/subAccounts';

const r = new Hono<{ Bindings: Env }>();

r.get('/counts', async (c) => {
  await requireAdmin(c);
  return c.json(await subAccountCounts(c.env));
});

r.get('/accounts/:userId', async (c) => {
  const admin = await requireAdmin(c);
  const raw = c.req.param('userId');
  if (!/^[1-9]\d{0,15}$/.test(raw)) return refuse(c, 404, { code: 'account_not_found', message: 'No account has that number.' });
  const userId = Number(raw);
  let target: { id: number; role: string; super_admin: number } | null;
  try {
    target = await c.env.DB.prepare(
      `SELECT u.id, u.role, EXISTS (SELECT 1 FROM super_admins s WHERE s.user_id = u.id) AS super_admin FROM users u WHERE u.id = ?`,
    ).bind(userId).first<{ id: number; role: string; super_admin: number }>();
  } catch (e) {
    return refuse(c, 503, { code: 'account_unreadable', message: 'The account could not be read. Try again in a moment.', raw: e });
  }
  if (!target) return refuse(c, 404, { code: 'account_not_found', message: 'No account has that number.' });
  const isAdminAccount = String(target.role).toLowerCase() === 'admin' || Number(target.super_admin) === 1;
  if (isAdminAccount && Number(target.id) !== Number(admin.id) && !isSuperAdmin(admin as any)) {
    return refuse(c, 403, { code: 'super_admin_required', message: 'Only a Super Admin can open another administrator’s record.' });
  }
  return c.json(await accountSubAccounts(c.env, userId));
});

export default r;
