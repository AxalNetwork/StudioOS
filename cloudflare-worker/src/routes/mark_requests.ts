/**
 * D6205 (#6205): an investor asks HQ to record a mark, correct one, or record a
 * missing follow-on round, for a company they hold. Mounted at
 * /api/mark-requests. Store: `portfolio_mark_requests` (migration
 * 202611141523_6205).
 *
 * Who does what:
 *   POST   /             an investor (licence held, not an admin) for a company
 *                        they hold through a confirmed commitment
 *                        (`investorHeldProjectIds`, the Positions read's own
 *                        held scope). One open request per company per
 *                        investor: a second answers 409 with the open one.
 *                        Every active admin gets an in-app notice.
 *   GET    /             the caller's own requests; an admin reads every one,
 *                        with who asked. Anyone without the licence is 403.
 *   PATCH  /:uid         an admin answers an open request: `resolved`, linking
 *                        the mark recorded (a mark of the same company; for a
 *                        follow-on, a note instead), or `declined` with a
 *                        note. The investor is notified. An answered request is
 *                        not reopened (409).
 *
 * A request never writes a mark. Recording one stays the admin write
 * `POST /api/positions/:projectUid/marks`.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { investorHeldProjectIds, investorActiveCompany } from './_investorProjectScope';
import { notify } from '../services/notify';

const r = new Hono<{ Bindings: Env }>();

export const MARK_REQUEST_KINDS = ['mark', 'correction', 'follow_on'] as const;
const KINDS: ReadonlySet<string> = new Set(MARK_REQUEST_KINDS);
const KIND_WORDS: Record<string, string> = { mark: 'a mark', correction: 'a mark correction', follow_on: 'a follow-on round' };
const REASON_MAX = 2000;

/** The open request of one investor on one company. Every reader gets these columns; `requester` is added for an admin only. */
const OPEN_ONE = `SELECT q.uid, q.kind, q.reason, q.state, q.created_at, q.resolved_at, q.resolved_mark_uid,
            q.resolution_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name,
            u.name AS requester_name
       FROM portfolio_mark_requests q
       JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id
      WHERE q.project_id = ? AND q.requester_user_id = ? AND q.state = 'open'`;
const BY_UID = `SELECT q.uid, q.kind, q.reason, q.state, q.created_at, q.resolved_at, q.resolved_mark_uid,
            q.resolution_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name,
            u.name AS requester_name
       FROM portfolio_mark_requests q
       JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id
      WHERE q.uid = ?`;
/** `?1` a requester id or NULL (every requester), `?2` a state or NULL. */
const LIST = `SELECT q.uid, q.kind, q.reason, q.state, q.created_at, q.resolved_at, q.resolved_mark_uid,
            q.resolution_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name,
            u.name AS requester_name
       FROM portfolio_mark_requests q
       JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id
      WHERE (?1 IS NULL OR q.requester_user_id = ?1) AND (?2 IS NULL OR q.state = ?2)
      ORDER BY q.created_at DESC, q.id DESC LIMIT 500`;

function project(row: any, admin: boolean) {
  const out: Record<string, unknown> = {
    uid: row.uid,
    project_uid: row.project_uid,
    project_name: row.project_name,
    kind: row.kind,
    reason: row.reason,
    state: row.state,
    created_at: row.created_at,
    resolved_at: row.resolved_at ?? null,
    resolved_mark_uid: row.resolved_mark_uid ?? null,
    resolution_note: row.resolution_note ?? null,
  };
  if (admin) out.requester = { id: Number(row.requester_user_id), name: row.requester_name ?? null };
  return out;
}

const isAdminUser = (u: User) => u.role === 'admin';

/** Every active admin, told once each. A failed notice never fails the request. */
async function notifyHq(env: Env, title: string, body: string) {
  try {
    const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
    for (const a of admins.results || []) {
      await notify(env, { userId: Number(a.id), type: 'portfolio_mark_requested', title, body, link: '/portfolio/positions', channels: ['in_app'], category: 'deals' });
    }
  } catch { console.warn('[mark_requests] hq_notify_failed'); }
}

// POST /api/mark-requests — { project_uid, kind, reason }
r.post('/', async (c) => {
  try {
    const user = await requireAuth(c);
    // An admin records marks; asking is the investor's act.
    if (isAdminUser(user) || !canViewLpData(user)) return c.json({ detail: 'Only an investor can request a mark.', code: 'investor_only' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const kind = String(body?.kind ?? '');
    if (!KINDS.has(kind)) return c.json({ detail: `kind must be one of: ${MARK_REQUEST_KINDS.join(', ')}`, code: 'bad_kind' }, 400);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return c.json({ detail: 'Say what is wrong or missing.', code: 'reason_required' }, 400);
    if (reason.length > REASON_MAX) return c.json({ detail: `The reason is at most ${REASON_MAX} characters.`, code: 'reason_too_long' }, 400);
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(String(body?.project_uid ?? '')).first<{ id: number; uid: string; name: string }>();
    // Not found and not held answer alike, so a request does not confirm a company exists.
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) {
      return c.json({ detail: 'You can request a mark only for a company you hold.', code: 'not_held' }, 403);
    }
    const open = await c.env.DB.prepare(OPEN_ONE)
      .bind(proj.id, user.id).first<any>();
    if (open) return c.json({ detail: 'You already have an open request for this company.', code: 'request_open', request: project(open, false) }, 409);
    const uid = newUid();
    const now = nowIso();
    try {
      await c.env.DB.prepare(
        `INSERT INTO portfolio_mark_requests (uid, project_id, requester_user_id, kind, reason, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      ).bind(uid, proj.id, user.id, kind, reason, now, now).run();
    } catch (e) {
      // Two submits at once: the partial unique index keeps one; the other is the 409 above.
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message || ''))) {
        const again = await c.env.DB.prepare(OPEN_ONE)
          .bind(proj.id, user.id).first<any>();
        return c.json({ detail: 'You already have an open request for this company.', code: 'request_open', request: again ? project(again, false) : null }, 409);
      }
      throw e;
    }
    await notifyHq(c.env, `${proj.name}: ${KIND_WORDS[kind]} requested`, `${user.name || 'An investor'} asked HQ for ${KIND_WORDS[kind]}: ${reason.slice(0, 280)}`);
    const row = await c.env.DB.prepare(BY_UID).bind(uid).first<any>();
    return c.json(project(row, false), 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/mark-requests[?state=open|resolved|declined] — own requests; an admin reads all.
r.get('/', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return c.json({ detail: 'Forbidden' }, 403);
    const admin = isAdminUser(user);
    const state = c.req.query('state');
    const stateOk = state === 'open' || state === 'resolved' || state === 'declined';
    const rows = await c.env.DB.prepare(LIST).bind(admin ? null : user.id, stateOk ? state : null).all<any>();
    return c.json({ items: (rows.results || []).map((x) => project(x, admin)), scope: admin ? 'all_requests' : 'own_requests' });
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/mark-requests/:uid — { state: 'resolved' | 'declined', mark_uid?, note? }, admin only.
r.patch('/:uid', async (c) => {
  try {
    const user = await requireAdmin(c);
    const row = await c.env.DB.prepare('SELECT id, uid, project_id, requester_user_id, kind, state FROM portfolio_mark_requests WHERE uid = ?')
      .bind(c.req.param('uid')).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (row.state !== 'open') return c.json({ detail: 'This request is already answered.', code: 'request_answered' }, 409);
    const body = await c.req.json().catch(() => ({} as any));
    const state = String(body?.state ?? '');
    if (state !== 'resolved' && state !== 'declined') return c.json({ detail: 'state must be resolved or declined', code: 'bad_state' }, 400);
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, REASON_MAX) : null;
    let markUid: string | null = null;
    if (state === 'resolved' && body?.mark_uid != null && body.mark_uid !== '') {
      const mark = await c.env.DB.prepare('SELECT uid FROM portfolio_marks WHERE uid = ? AND project_id = ?')
        .bind(String(body.mark_uid), row.project_id).first<{ uid: string }>();
      if (!mark) return c.json({ detail: 'That mark is not recorded for this company.', code: 'mark_not_found' }, 400);
      markUid = mark.uid;
    }
    // A resolved mark or correction names the mark recorded; a follow-on, or a decline, says why in a note.
    if (state === 'resolved' && row.kind !== 'follow_on' && !markUid) return c.json({ detail: 'Link the mark recorded.', code: 'mark_required' }, 400);
    if (!markUid && !note) return c.json({ detail: 'Say how the request was answered.', code: 'note_required' }, 400);
    const now = nowIso();
    const done = await c.env.DB.prepare(
      `UPDATE portfolio_mark_requests SET state = ?, resolved_by = ?, resolved_at = ?, resolved_mark_uid = ?, resolution_note = ?, updated_at = ?
        WHERE id = ? AND state = 'open'`,
    ).bind(state, user.id, now, markUid, note, now, row.id).run();
    if (!done.meta?.changes) return c.json({ detail: 'This request is already answered.', code: 'request_answered' }, 409);
    const fresh = await c.env.DB.prepare(BY_UID).bind(row.uid).first<any>();
    try {
      await notify(c.env, {
        userId: Number(row.requester_user_id),
        type: 'portfolio_mark_request_answered',
        title: `${fresh?.project_name || 'Your company'}: request ${state}`,
        body: note ?? 'HQ recorded the mark you asked for.',
        link: '/portfolio/positions',
        channels: ['in_app'],
        category: 'deals',
      });
    } catch { console.warn('[mark_requests] requester_notify_failed'); }
    return c.json(project(fresh, true));
  } catch (e) { return mapError(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/mark-requests', router: r };
