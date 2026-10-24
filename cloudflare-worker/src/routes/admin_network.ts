/**
 * D976 / #2762 — the admin side of the advisor and partner network: one
 * person's standing, pause and resume with a reason, and the advisor
 * directory switch (Advisors & Partners part 4, #2369).
 *
 * Mounted at /api/admin/network, before the catch-all /api/admin router. Every
 * handler is requireAdmin. Every write is one row in `network_member_states`
 * (migration 552) and one `logAdminAction` entry.
 *
 *   GET  /people/:userId            the stage, the pause, the directory and the
 *                                   blocks of `services/networkStanding.ts`
 *   POST /people/:userId/pause      { reason } required. New advisor bookings
 *                                   stop; the advisor leaves the advisor
 *                                   directory and the Lab's office hours.
 *                                   Bookings already made stay (AP9c).
 *   POST /people/:userId/resume     { reason } required.
 *   POST /people/:userId/directory  { listed: boolean } — an advisor only.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { ensureNetworkStatesSchema } from '../services/networkStatesSchema';
import { kindOf, loadPerson, pauseEffects, readStanding, REASON_MAX, stageOf } from '../services/networkStanding';

const adminNetwork = new Hono<{ Bindings: Env }>();

adminNetwork.use('*', async (c, next) => {
  await ensureNetworkStatesSchema(c.env);
  await next();
});

async function admin(c: any) {
  try {
    return await requireAdmin(c);
  } catch (e) {
    const msg = (e as Error)?.message;
    return c.json({ error: msg || 'Admin required' }, msg === 'Unauthorized' ? 401 : 403);
  }
}

function userIdParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The person, or the refusal: 404 when the id is no account or the account is in neither network. */
async function person(c: any) {
  const id = userIdParam(c.req.param('userId'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const p = await loadPerson(c.env, id);
  if (!p) return c.json({ error: 'not_found' }, 404);
  if (!kindOf(p)) return c.json({ error: 'not_in_network' }, 404);
  return p;
}

function reasonOf(body: any): string {
  return typeof body?.reason === 'string' ? body.reason.trim().slice(0, REASON_MAX) : '';
}

const now = () => new Date().toISOString();

adminNetwork.get('/people/:userId', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const p = await person(c);
  if (p instanceof Response) return p;
  return c.json(await readStanding(c.env, p));
});

adminNetwork.post('/people/:userId/pause', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const p = await person(c);
  if (p instanceof Response) return p;
  const reason = reasonOf(await c.req.json().catch(() => ({})));
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  if (stageOf(p) === 'ended') return c.json({ error: 'ended' }, 409);
  // The predicate makes a second Pause, or a race with one, a refusal rather than a new stamp.
  const at = now();
  const row = await c.env.DB.prepare(
    `INSERT INTO network_member_states (user_id, paused_at, paused_reason, paused_by, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET paused_at = excluded.paused_at, paused_reason = excluded.paused_reason,
       paused_by = excluded.paused_by, updated_at = excluded.updated_at
     WHERE network_member_states.paused_at IS NULL
     RETURNING user_id`,
  ).bind(p.user_id, at, reason, a.id, at).first();
  if (!row) return c.json({ error: 'already_paused' }, 409);
  await logAdminAction(c.env, a.id, a.email, 'network.paused', { target_user_id: p.user_id, reason });
  const fresh = (await loadPerson(c.env, p.user_id))!;
  return c.json({ user_id: p.user_id, stage: stageOf(fresh), paused_at: at, effects: pauseEffects(fresh) });
});

adminNetwork.post('/people/:userId/resume', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const p = await person(c);
  if (p instanceof Response) return p;
  const reason = reasonOf(await c.req.json().catch(() => ({})));
  if (!reason) return c.json({ error: 'reason_required' }, 400);
  const at = now();
  const row = await c.env.DB.prepare(
    `UPDATE network_member_states
        SET paused_at = NULL, paused_reason = NULL, paused_by = NULL,
            resumed_at = ?, resume_reason = ?, resumed_by = ?, updated_at = ?
      WHERE user_id = ? AND paused_at IS NOT NULL
      RETURNING user_id`,
  ).bind(at, reason, a.id, at, p.user_id).first();
  if (!row) return c.json({ error: 'not_paused' }, 409);
  await logAdminAction(c.env, a.id, a.email, 'network.resumed', { target_user_id: p.user_id, reason });
  const fresh = (await loadPerson(c.env, p.user_id))!;
  return c.json({ user_id: p.user_id, stage: stageOf(fresh), resumed_at: at });
});

adminNetwork.post('/people/:userId/directory', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const p = await person(c);
  if (p instanceof Response) return p;
  if (p.advisor_id == null) return c.json({ error: 'not_an_advisor' }, 409);
  const body = await c.req.json().catch(() => ({} as any));
  if (typeof body?.listed !== 'boolean') return c.json({ error: 'listed_required' }, 400);
  const at = now();
  if (body.listed) {
    const row = await c.env.DB.prepare(
      `UPDATE network_member_states SET directory_hidden_at = NULL, directory_hidden_by = NULL, updated_at = ?
        WHERE user_id = ? AND directory_hidden_at IS NOT NULL RETURNING user_id`,
    ).bind(at, p.user_id).first();
    if (!row) return c.json({ error: 'not_hidden' }, 409);
  } else {
    const row = await c.env.DB.prepare(
      `INSERT INTO network_member_states (user_id, directory_hidden_at, directory_hidden_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET directory_hidden_at = excluded.directory_hidden_at,
         directory_hidden_by = excluded.directory_hidden_by, updated_at = excluded.updated_at
       WHERE network_member_states.directory_hidden_at IS NULL
       RETURNING user_id`,
    ).bind(p.user_id, at, a.id, at).first();
    if (!row) return c.json({ error: 'already_hidden' }, 409);
  }
  await logAdminAction(c.env, a.id, a.email, body.listed ? 'network.directory_shown' : 'network.directory_hidden',
    { target_user_id: p.user_id });
  const fresh = (await loadPerson(c.env, p.user_id))!;
  return c.json({
    user_id: p.user_id,
    hidden_by_admin: !!fresh.directory_hidden_at,
    // Paused also keeps an advisor out of the directory; Show does not lift a pause.
    listed: Number(fresh.advisor_active) === 1 && !fresh.paused_at && !fresh.directory_hidden_at,
  });
});

export default adminNetwork;
