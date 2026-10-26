/**
 * D1215 (#3212, part 2 of #2424) — closings, mounted at `/api/closings`, and
 * the admin desk at `/api/admin/closings`. The stores and the rules are
 * `services/closings.ts`.
 *
 * Reads (`requireAuth`; who reads what is decided per closing):
 *   GET  /                                   the closings this caller reads
 *   GET  /:uid                               one closing: every line for an admin or the founder,
 *                                            the caller's own lines and the round's total for anyone else
 *
 * An Admin (`requireAdmin`; a support session is refused):
 *   POST /                                   {deal_id, round_label?, instrument?, template_slug?, deadline?, owner_user_id?}
 *                                            opens a closing with one line per live commitment
 *   POST /:uid/lines                         {commitment_uid} or {prospect_id}
 *   PUT  /:uid/lines/:lineUid/route          {route, vehicle_ref?}
 *   POST /:uid/lines/:lineUid/withdraw
 *   POST /:uid/lines/:lineUid/evidence       {kind, source_ref}                 closing.evidence
 *   POST /:uid/evidence/:evidenceUid/withdraw {reason}: 10 to 200 characters   closing.evidence
 *   POST /:uid/complete                      every line settled and the cap-table proposal decided
 *
 * The founder of the closing's venture:
 *   POST /:uid/captable/accept
 *   POST /:uid/captable/dismiss
 *
 * The desk (`requireAdmin`):
 *   GET  /api/admin/closings                 every open closing: lines waiting, next actor, owner
 *
 * The platform never moves money: every write records. Every write appends one
 * `closing_events` row in the same batch. Every refusal goes through `refuse()`
 * with a code and echoes no input.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth } from '../auth';
import { AUTH_ERROR_STATUSES, STEP_UP_REQUIRED, stepUpRefusalBody } from '../util/authErrors';
import { refuse } from '../util/refusal';
import { SUPPORT_SESSION_REFUSED_CODE, assertAdminAct, auditFundAct, isSupportSession } from '../services/fundAdminAccess';
import {
  ClosingRefusal, addEvidence, addLine, adminDesk, completeClosing, decideCaptable, listClosings, openClosing, readClosing,
  setRoute, withdrawEvidence, withdrawLine,
} from '../services/closings';

const onError = (error: any, c: any) => {
  if (error instanceof Response) return error;
  if (error instanceof ClosingRefusal) return refuse(c, error.status, { code: error.code, message: error.sentence });
  if (error?.message === STEP_UP_REQUIRED) return c.json(stepUpRefusalBody(error), 403);
  const status = AUTH_ERROR_STATUSES[error?.message];
  if (status) return refuse(c, status, { code: 'closings_refused', message: 'This account cannot do that on a closing.' });
  return refuse(c, 503, { code: 'closings_unreadable', message: 'Unreadable: the closing could not be read or saved. Try again.', raw: error });
};

const body = async (c: any) => {
  const parsed = await c.req.json().catch(() => null);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

/** An Admin in their own session: a support session never writes a closing. */
async function admin(c: any) {
  const user = await requireAdmin(c);
  if (await isSupportSession(c)) {
    throw new ClosingRefusal(403, SUPPORT_SESSION_REFUSED_CODE, 'A support session cannot change a closing.');
  }
  return user;
}

const r = new Hono<{ Bindings: Env }>();
r.onError(onError);

r.get('/', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  return c.json({ closings: await listClosings(c.env, user) });
});

r.get('/:uid', async (c) => {
  const user = await requireAuth(c);
  c.header('Cache-Control', 'no-store');
  return c.json(await readClosing(c.env, user, c.req.param('uid')));
});

r.post('/', async (c) => {
  const user = await admin(c);
  const uid = await openClosing(c.env, user, await body(c));
  return c.json(await readClosing(c.env, user, uid), 201);
});

r.post('/:uid/lines', async (c) => {
  const user = await admin(c);
  const lineUid = await addLine(c.env, user, c.req.param('uid'), await body(c));
  return c.json({ uid: lineUid }, 201);
});

r.put('/:uid/lines/:lineUid/route', async (c) => {
  const user = await admin(c);
  await setRoute(c.env, user, c.req.param('uid'), c.req.param('lineUid'), await body(c));
  return c.json({ ok: true });
});

r.post('/:uid/lines/:lineUid/withdraw', async (c) => {
  const user = await admin(c);
  await withdrawLine(c.env, user, c.req.param('uid'), c.req.param('lineUid'));
  return c.json({ ok: true });
});

r.post('/:uid/lines/:lineUid/evidence', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'closing.evidence');
  const evidenceUid = await addEvidence(c.env, user, c.req.param('uid'), c.req.param('lineUid'), await body(c));
  // No source reference or amount in the audit row: the evidence row holds it.
  await auditFundAct(c.env, user, 'closing.evidence', { closing_uid: c.req.param('uid'), evidence_uid: evidenceUid });
  return c.json({ uid: evidenceUid }, 201);
});

r.post('/:uid/evidence/:evidenceUid/withdraw', async (c) => {
  const user = await admin(c);
  await assertAdminAct(c, user, 'closing.evidence');
  await withdrawEvidence(c.env, user, c.req.param('uid'), c.req.param('evidenceUid'), await body(c));
  await auditFundAct(c.env, user, 'closing.evidence', { closing_uid: c.req.param('uid'), evidence_uid: c.req.param('evidenceUid'), withdrawn: true });
  return c.json({ ok: true });
});

r.post('/:uid/captable/accept', async (c) => {
  const user = await requireAuth(c);
  if (await isSupportSession(c)) throw new ClosingRefusal(403, SUPPORT_SESSION_REFUSED_CODE, 'A support session cannot decide a cap-table change.');
  await decideCaptable(c.env, user, c.req.param('uid'), 'accepted');
  return c.json({ ok: true, state: 'accepted' });
});

r.post('/:uid/captable/dismiss', async (c) => {
  const user = await requireAuth(c);
  if (await isSupportSession(c)) throw new ClosingRefusal(403, SUPPORT_SESSION_REFUSED_CODE, 'A support session cannot decide a cap-table change.');
  await decideCaptable(c.env, user, c.req.param('uid'), 'dismissed');
  return c.json({ ok: true, state: 'dismissed' });
});

r.post('/:uid/complete', async (c) => {
  const user = await admin(c);
  await completeClosing(c.env, user, c.req.param('uid'));
  return c.json({ ok: true, status: 'closed' });
});

/** The admin desk at `/api/admin/closings`. */
export const adminClosings = new Hono<{ Bindings: Env }>();
adminClosings.onError(onError);
adminClosings.get('/', async (c) => {
  await requireAdmin(c);
  c.header('Cache-Control', 'no-store');
  return c.json({ closings: await adminDesk(c.env) });
});

export default r;
