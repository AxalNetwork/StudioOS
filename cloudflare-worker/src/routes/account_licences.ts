/** D4472 (#4472): own held licences and admin-only additional grant/revoke routes. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../auth';
import { LICENCE_ORDER, isLicence, grantLicence, revokeLicence, LicenceRefusal } from '../services/accountLicences';
import { PROFILE_WORDS } from './admin_accounts';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';

const r = new Hono<{ Bindings: Env }>();
const messages = {
  invalid_licence: 'Choose a valid licence.',
  invalid_retention: 'This operation cannot retain a primary licence.',
  not_found: 'Account not found.',
  primary_licence: 'The primary licence cannot be revoked here.',
  licence_cannot_administer: 'This licence can no longer take an administrator.',
};
r.onError((error, c) => {
  if (error instanceof LicenceRefusal) return refuse(c, error.status, { code: error.code, message: messages[error.code] });
  const status = AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c, status, { code: status === 401 ? 'unauthorized' : 'forbidden', message: 'This account cannot perform this operation.' });
  return refuse(c, 503, { code: 'licences_unreadable', message: 'Licences are Unreadable. Please retry.', raw: error });
});
function accountId(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new LicenceRefusal('not_found', 404);
  return Number(raw);
}
/** Keep the existing boundary around another administrator's account data. */
async function administeredAccount(c: Context<{ Bindings: Env }>) {
  const admin = await requireAdmin(c);
  const userId = accountId(c.req.param('id') || '');
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>();
  if (!target) throw new LicenceRefusal('not_found', 404);
  if (target.role === 'admin' && target.id !== admin.id) await requireSuperAdmin(c);
  return { admin, userId };
}
async function view(db: D1Database, userId: number) {
  const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>();
  if (!user) throw new LicenceRefusal('not_found', 404);
  const grants = (await db.prepare(`SELECT licence, granted_at, source FROM account_licences
    WHERE user_id = ? AND revoked_at IS NULL`).bind(userId).all<{ licence: string; granted_at: string; source: string }>()).results;
  const primaryRole = String(user.role).toLowerCase();
  const held = LICENCE_ORDER.filter(licence => licence === primaryRole || grants.some(row => row.licence === licence))
    .map(licence => {
      const primary = licence === primaryRole;
      const grant = grants.find(row => row.licence === licence);
      return { licence, label: PROFILE_WORDS[licence], granted_at: primary ? null : grant!.granted_at,
        source: primary ? 'primary' : grant!.source, is_primary: primary };
    });
  return { primary: user.role, held, addable: LICENCE_ORDER.filter(licence => !held.some(row => row.licence === licence))
    .map(licence => ({ licence, label: PROFILE_WORDS[licence], how: 'contact' as const })) };
}
r.get('/account/licences', async c => {
  const user = await requireAuth(c);
  return c.json(await view(c.env.DB, user.id));
});
r.get('/admin/accounts/:id/licences', async c => {
  const { userId } = await administeredAccount(c);
  return c.json(await view(c.env.DB, userId));
});
r.post('/admin/accounts/:id/licences', async c => {
  const { admin, userId } = await administeredAccount(c);
  const body = await c.req.json().catch(() => null);
  if (!isLicence(body?.licence)) throw new LicenceRefusal('invalid_licence', 400);
  const code = await grantLicence(c.env.DB, { userId, licence: body.licence, actorId: admin.id, source: 'admin' });
  return c.json({ ok: true, code });
});
r.delete('/admin/accounts/:id/licences/:licence', async c => {
  const { admin, userId } = await administeredAccount(c);
  const code = await revokeLicence(c.env.DB, { userId, licence: c.req.param('licence'), actorId: admin.id, source: 'admin' });
  return c.json({ ok: true, code });
});
export const mount = { path: '/api', router: r };
export default r;
