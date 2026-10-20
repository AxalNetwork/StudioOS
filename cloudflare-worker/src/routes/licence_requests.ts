/**
 * The Administrator's requests to HQ (D799, #2232).
 *   GET  /api/licence/mine/requests   this licence's requests, and HQ's answers
 *   POST /api/licence/mine/requests   raise one
 *
 * THE OWNER'S ANSWER (D795): an Administrator requests and HQ decides — a
 * renewal, a term change, more seats, a delegate admin, notice of
 * non-renewal, and the older kinds beside them. Each is an escalation
 * (migration 259); what each kind carries is `services/escalationRequests.ts`.
 *
 * ON HQ, WHERE TODAY'S ADMINISTRATORS ARE. No branch is deployed (D286), so an
 * Administrator's licence is on HQ's database and they had no lane at all.
 * This route writes `hq_escalations` directly, under `branch_code = 'hq'`, with
 * the licence's uid as `subject_ref`, and reads back only that licence's rows.
 * The licence is the one `licence_admins` binds the caller to (its UNIQUE
 * index on user_id makes it one); a caller bound to none — a founder, an
 * investor, a plain member — gets `no_licence`, a 404, as `GET /mine` answers.
 *
 * ON A BRANCH, ONE PATH FOR THE PAGE. The same two calls are handed to the
 * branch's "To HQ" lane (`routes/branch_escalations.ts`), which already holds
 * the branch's rows and carries them to HQ over RPC, so the Licences page
 * calls one URL on either tier and the branch keeps its own rules: its admin
 * gate, its local row, its retry.
 *
 * OPEN WHILE THE LICENCE IS SUSPENDED (D107, D112). A suspended licence's way
 * out is a request to HQ, so neither call reads the licence's status.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { branchOf } from '../util/branch';
import { mapError } from './_t13t14t15_helpers';
import {
  recordLicenceRequest, listLicenceRequests, escalationKindsFor,
  ESCALATION_KINDS, SLA_HOURS, LICENCE_REQUESTS_OPEN_MAX,
} from '../rpc/hqOps';
import { withRequestView, REQUEST_KINDS, REQUESTABLE_TERMS, SEAT_TYPES } from '../services/escalationRequests';
import branchLane from './branch_escalations';

const r = new Hono<{ Bindings: Env }>();

/** The licence this user administers on HQ, or null. */
async function administeredLicence(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT l.id, l.uid, l.kind, l.status
       FROM licence_admins la
       JOIN territory_licences l ON l.id = la.licence_id
      WHERE la.user_id = ?`,
  ).bind(userId).first<{ id: number; uid: string; kind: string | null; status: string }>();
}

const NO_LICENCE = { error: 'no_licence', message: 'You do not administer a territory licence.' };

/** The branch lane's answer to the same call, with the caller's own headers. */
async function toBranchLane(c: any, method: 'GET' | 'POST') {
  const init: RequestInit = { method, headers: c.req.raw.headers };
  if (method === 'POST') init.body = await c.req.text();
  let ctx: unknown;
  try { ctx = c.executionCtx; } catch { ctx = undefined; }
  return branchLane.request('/escalations', init, c.env, ctx as any);
}

// GET /api/licence/mine/requests
r.get('/mine/requests', async (c) => {
  try {
    const user = await requireAuth(c);
    if (branchOf(c.env)) return toBranchLane(c, 'GET');

    const licence = await administeredLicence(c.env, user.id);
    if (!licence) return c.json(NO_LICENCE, 404);

    const listed = await listLicenceRequests(c.env, licence.uid);
    const gate = escalationKindsFor(licence.kind);
    return c.json({
      licence_uid: licence.uid,
      licence_status: licence.status,
      items: listed.items.map(withRequestView),
      complete: listed.complete,
      kinds: ESCALATION_KINDS,
      kinds_available: gate.available,
      kinds_hidden: gate.hidden,
      request_kinds: REQUEST_KINDS,
      response_hours: SLA_HOURS,
      requestable_terms: REQUESTABLE_TERMS,
      seat_types: SEAT_TYPES,
      open_max: LICENCE_REQUESTS_OPEN_MAX,
      answer_shape: 'single_decision',
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/licence/mine/requests  { kind, subject, detail?, request? }
r.post('/mine/requests', async (c) => {
  try {
    const user = await requireAuth(c);
    if (branchOf(c.env)) return toBranchLane(c, 'POST');

    const licence = await administeredLicence(c.env, user.id);
    if (!licence) return c.json(NO_LICENCE, 404);

    const b = await c.req.json().catch(() => ({} as any));
    const out = await recordLicenceRequest(
      c.env,
      { uid: licence.uid, kind: licence.kind },
      { id: user.id, name: (user as { name?: string }).name ?? null },
      b && typeof b === 'object' ? b : {},
    );
    if (!out.ok) {
      const { ok: _ok, status, ...body } = out;
      return c.json(body, status);
    }
    return c.json(withRequestView(out.row), 201);
  } catch (e) { return mapError(c, e); }
});

export default r;
