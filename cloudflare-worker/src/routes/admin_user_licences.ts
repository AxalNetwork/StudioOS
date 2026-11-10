/**
 * D5058 (#5058) — an account's user licences and their lifecycle, for an Admin. Mounted at `/api`.
 *
 *   GET  /api/admin/accounts/:id/user-licences          every user licence the account holds, with its terms and history
 *   POST /api/admin/user-licences/:uid/status            { action, expected_revision, reason }   one status change
 *   POST /api/admin/user-licences/:uid/renew             { expected_revision, starts_on, ends_on?, agreement_version?,
 *                                                          renewal_terms?, reason }                the next term
 *
 * The boundary is D4472's: an Admin, and a Super Admin for another administrator's account. A stale revision is
 * 409 `licence_changed` with the current licence; a write changes one licence and its own access row, nothing
 * else the account holds. Nothing here writes `users.role`, so no licence makes anyone an Admin. Granting and
 * revoking an additional licence stay D4472's routes (`/api/admin/accounts/:id/licences`), which keep the
 * shared row in step.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAdmin, requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { AUTH_ERROR_STATUSES } from '../util/authErrors';
import { logAdminAction } from '../services/adminAudit';
import {
  TRANSITIONS, UserLicenceError, eventsOf, licenceByUid, licencesOfUser, renewLicence, termsOf, transitionLicence, validateRenewal,
} from '../services/userLicences';

type C = Context<{ Bindings: Env }>;
const userLicences = new Hono<{ Bindings: Env }>();

userLicences.onError((error, c) => {
  if (error instanceof UserLicenceError) return refuse(c, error.status, { code: error.code, message: error.sentence, extra: error.extra });
  const status = AUTH_ERROR_STATUSES[error.message];
  if (status) return refuse(c, status, { code: status === 401 ? 'unauthorized' : 'forbidden', message: 'This account cannot perform this operation.' });
  return refuse(c, 503, { code: 'licences_unreadable', message: 'Licences could not be read. Please retry.', raw: error });
});

const UID = /^[A-Za-z0-9_-]{1,80}$/;

/** D4472's boundary: an Admin; another administrator's account needs a Super Admin. */
async function administer(c: C, userId: number) {
  const admin = await requireAdmin(c);
  const target = await c.env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ id: number; role: string }>();
  if (!target) throw new UserLicenceError(404, 'not_found', 'Account not found.');
  if (target.role === 'admin' && target.id !== admin.id) await requireSuperAdmin(c);
  return admin;
}

function reasonOf(body: Record<string, unknown> | null): string {
  const r = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (r.length < 3 || r.length > 500) throw new UserLicenceError(400, 'reason_required', 'Say why, in 3 to 500 characters.');
  return r;
}
function revisionOf(body: Record<string, unknown> | null): number {
  const v = body?.expected_revision;
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return v;
  throw new UserLicenceError(400, 'expected_revision_required', 'Name the revision you read (expected_revision).');
}
async function licenceFor(c: C) {
  const uid = c.req.param('uid') || '';
  if (!UID.test(uid)) throw new UserLicenceError(404, 'not_found', 'No user licence with that id.');
  const l = await licenceByUid(c.env, uid);
  if (!l) throw new UserLicenceError(404, 'not_found', 'No user licence with that id.');
  return l;
}

userLicences.get('/admin/accounts/:id/user-licences', async (c) => {
  const raw = c.req.param('id') || '';
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new UserLicenceError(404, 'not_found', 'Account not found.');
  const userId = Number(raw);
  await administer(c, userId);
  const licences = await licencesOfUser(c.env, userId);
  const withTerms = await Promise.all(licences.map(async (l) => ({ ...l, terms: await termsOf(c.env, l.uid) })));
  return c.json({ user_id: userId, licences: withTerms, history: await eventsOf(c.env, { userId }), actions: Object.keys(TRANSITIONS) });
});

userLicences.post('/admin/user-licences/:uid/status', async (c) => {
  const l = await licenceFor(c);
  const admin = await administer(c, l.user_id);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === 'string' ? body.action : '';
  if (!TRANSITIONS[action]) throw new UserLicenceError(400, 'invalid_action', `The action must be one of ${Object.keys(TRANSITIONS).join(', ')}.`);
  const reason = reasonOf(body);
  const updated = await transitionLicence(c.env, { uid: l.uid, action, expectedRevision: revisionOf(body), reason, actorId: admin.id });
  await logAdminAction(c.env, admin.id, admin.email || '', 'user_licence_status_changed', {
    licence_uid: l.uid, user_id: l.user_id, licence_type: l.licence_type, action, from: l.status, to: updated.status, revision: updated.revision, reason,
  });
  return c.json({ licence: updated });
});

userLicences.post('/admin/user-licences/:uid/renew', async (c) => {
  const l = await licenceFor(c);
  const admin = await administer(c, l.user_id);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const reason = reasonOf(body);
  const expected = revisionOf(body);
  const v = validateRenewal(body);
  if (!v.ok) throw new UserLicenceError(400, 'invalid_renewal', 'The renewal has fields to fix.', { fields: v.errors });
  const out = await renewLicence(c.env, { uid: l.uid, expectedRevision: expected, input: v.value, reason, actorId: admin.id });
  await logAdminAction(c.env, admin.id, admin.email || '', 'user_licence_renewed', {
    licence_uid: l.uid, user_id: l.user_id, licence_type: l.licence_type, term_no: out.term.term_no, starts_on: out.term.starts_on,
    ends_on: out.term.ends_on, agreement_version: out.term.agreement_version, revision: out.licence.revision, reason,
  });
  return c.json(out);
});

export const mount: RouteMount = { path: '/api', router: userLicences };

export default userLicences;
