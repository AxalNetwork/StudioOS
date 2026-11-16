/**
 * D6868 (#6868, the build of the #6228 brief): an investor's rights in a company they hold, beyond the reporting
 * duties, each with its document and clause, and the investor's request that HQ record one. Mounted at
 * /api/portfolio-rights. Store: `portfolio_rights` and `portfolio_right_requests` (migration 202611161152_6868).
 *
 * Who does what:
 *   GET    /:projectUid                   an investor who holds the company (`investorHeldProjectIds`, the
 *                                         Positions read's held scope): the six rights in a fixed order, each
 *                                         recorded or not, and their own requests to record one. Not held and not
 *                                         found answer alike (403 `not_held`). An admin reads every holder's
 *                                         rights and every request, with who asked, and the company's holders.
 *   POST   /requests                      an investor asks HQ to record a right of one type, saying where it is
 *                                         written. One open request per company, investor and type: a second
 *                                         answers 409 with the open one. Every active admin gets an in-app notice.
 *   PUT    /:projectUid/holders/:holderId/:type
 *                                         an admin records, or corrects, one holder's right from the signed paper.
 *                                         The holder must hold the company. With `request_uid` it answers that
 *                                         open request (same company, holder and type) as recorded, linking the
 *                                         right, and the investor is notified.
 *   PATCH  /requests/:uid                 an admin declines an open request with a reason the investor reads.
 *
 * Nothing here infers a right. A type with no row is Not recorded at closing; reading a clause from a signed
 * document for Eadwyn's proposal is not built here (D6868).
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireAdmin, canViewLpData } from '../auth';
import { mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { investorHeldProjectIds, investorActiveCompany, seatOwnerId } from './_investorProjectScope';
import { notify } from '../services/notify';
import { logAdminAction } from '../services/adminAudit';
import { refuse } from '../util/refusal';

const r = new Hono<{ Bindings: Env }>();

/** The canvas's order (PRM18), after the reporting duties row the page draws from `reporting_duties`. */
export const RIGHT_TYPES = ['pro_rata', 'information_rights', 'board_seat', 'observer_seat', 'liquidation_preference', 'anti_dilution'] as const;
const TYPES: ReadonlySet<string> = new Set(RIGHT_TYPES);
export const RIGHT_WORDS: Record<string, string> = {
  pro_rata: 'Pro rata',
  information_rights: 'Information rights',
  board_seat: 'Board seat',
  observer_seat: 'Observer seat',
  liquidation_preference: 'Liquidation preference',
  anti_dilution: 'Anti-dilution',
};
const TEXT_MAX = 2000;
const TITLE_MAX = 200;
const CLAUSE_MAX = 120;
const TERMS_MAX = 500;


const isAdminUser = (u: User) => u.role === 'admin';

function rightDto(row: any, admin: boolean) {
  const out: Record<string, unknown> = {
    uid: row.uid,
    type: row.right_type,
    document_title: row.document_title,
    clause: row.clause ?? null,
    terms: row.terms,
    signed_on: row.signed_on ?? null,
    recorded_at: row.recorded_at,
  };
  if (admin) out.holder = { id: Number(row.holder_user_id), name: row.holder_name ?? null };
  return out;
}

function requestDto(row: any, admin: boolean) {
  const out: Record<string, unknown> = {
    uid: row.uid,
    project_uid: row.project_uid,
    project_name: row.project_name,
    type: row.right_type,
    description: row.description,
    state: row.state,
    created_at: row.created_at,
    answered_at: row.answered_at ?? null,
    right_uid: row.right_uid ?? null,
    answer_note: row.answer_note ?? null,
  };
  if (admin) out.requester = { id: Number(row.requester_user_id), name: row.requester_name ?? null };
  return out;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Whether a user holds a company through a confirmed commitment: the same rule as `investorHeldProjectIds`, for a named holder. */
async function holds(env: Env, projectId: number, holderId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM commitments t JOIN deals d ON d.id = t.deal_id
      WHERE d.project_id = ? AND t.investor_user_id = ? AND t.status = 'confirmed' LIMIT 1`,
  ).bind(projectId, holderId).first<{ ok: number }>();
  return Boolean(row);
}

/** Every active admin, told once each. A failed notice never fails the request. */
async function notifyHq(env: Env, title: string, body: string) {
  try {
    const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
    for (const a of admins.results || []) {
      await notify(env, { userId: Number(a.id), type: 'portfolio_right_requested', title, body, link: '/portfolio/positions', channels: ['in_app'], category: 'deals' });
    }
  } catch { console.warn('[portfolio_rights] hq_notify_failed'); }
}

async function notifyRequester(env: Env, userId: number, projectUid: string, title: string, body: string) {
  try {
    await notify(env, {
      userId, type: 'portfolio_right_request_answered', title, body,
      link: `/portfolio/companies/${encodeURIComponent(projectUid)}/financials#ownership-rights`, channels: ['in_app'], category: 'deals',
    });
  } catch { console.warn('[portfolio_rights] requester_notify_failed'); }
}

const NOT_HELD = { code: 'not_held', message: 'You can read and ask about rights only for a company you hold.' };

// POST /api/portfolio-rights/requests — { project_uid, type, description }
r.post('/requests', async (c) => {
  try {
    const user = await requireAuth(c);
    // An admin records rights; asking is the investor's act.
    if (isAdminUser(user) || !canViewLpData(user)) return refuse(c, 403, { code: 'investor_only', message: 'Only an investor can ask HQ to record a right.' });
    const body = await c.req.json().catch(() => ({} as any));
    const type = String(body?.type ?? '');
    if (!TYPES.has(type)) return refuse(c, 400, { code: 'bad_type', message: 'Choose which right to record.' });
    const description = text(body?.description);
    if (!description) return refuse(c, 400, { code: 'description_required', message: 'Say where the right is written: the document and its clause.' });
    if (description.length > TEXT_MAX) return refuse(c, 400, { code: 'description_too_long', message: `Keep it to ${TEXT_MAX} characters.` });
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(String(body?.project_uid ?? '')).first<{ id: number; uid: string; name: string }>();
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) return refuse(c, 403, NOT_HELD);
    const openSql = `SELECT q.uid, q.right_type, q.description, q.state, q.created_at, q.answered_at, q.right_uid, q.answer_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name, u.name AS requester_name FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id
      WHERE q.project_id = ? AND q.requester_user_id = ? AND q.right_type = ? AND q.state = 'open'`;
    const open = await c.env.DB.prepare(openSql).bind(proj.id, user.id, type).first<any>();
    const already = (row: any) => refuse(c, 409, {
      code: 'request_open', message: 'You already asked HQ to record this right for this company.',
      extra: { request: row ? requestDto(row, false) : null },
    });
    if (open) return already(open);
    const uid = newUid();
    const now = nowIso();
    try {
      await c.env.DB.prepare(
        `INSERT INTO portfolio_right_requests (uid, project_id, requester_user_id, right_type, description, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      ).bind(uid, proj.id, user.id, type, description, now, now).run();
    } catch (e) {
      // Two submits at once: the partial unique index keeps one.
      if (/UNIQUE constraint failed/i.test(String((e as Error)?.message || ''))) {
        return already(await c.env.DB.prepare(openSql).bind(proj.id, user.id, type).first<any>());
      }
      throw e;
    }
    await notifyHq(c.env, `${proj.name}: record a right`, `${user.name || 'An investor'} asked HQ to record ${RIGHT_WORDS[type].toLowerCase()}: ${description.slice(0, 280)}`);
    const row = await c.env.DB.prepare(`SELECT q.uid, q.right_type, q.description, q.state, q.created_at, q.answered_at, q.right_uid, q.answer_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name, u.name AS requester_name FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id WHERE q.uid = ?`).bind(uid).first<any>();
    return c.json(requestDto(row, false), 201);
  } catch (e) { return mapError(c, e); }
});

// PATCH /api/portfolio-rights/requests/:uid — { state: 'declined', note }, admin only.
r.patch('/requests/:uid', async (c) => {
  try {
    const user = await requireAdmin(c);
    const row = await c.env.DB.prepare(
      `SELECT q.id, q.uid, q.state, q.right_type, q.requester_user_id, p.uid AS project_uid, p.name AS project_name
         FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id WHERE q.uid = ?`,
    ).bind(c.req.param('uid')).first<any>();
    if (!row) return refuse(c, 404, { code: 'not_found', message: 'No such request.' });
    if (row.state !== 'open') return refuse(c, 409, { code: 'request_answered', message: 'This request is already answered.' });
    const body = await c.req.json().catch(() => ({} as any));
    // Recording answers a request through PUT, which links the right; this route only declines.
    if (String(body?.state ?? '') !== 'declined') return refuse(c, 400, { code: 'bad_state', message: 'A request is declined here; record the right to answer it as recorded.' });
    const note = text(body?.note);
    if (!note) return refuse(c, 400, { code: 'note_required', message: 'Say why, in words the investor reads.' });
    if (note.length > TEXT_MAX) return refuse(c, 400, { code: 'note_too_long', message: `Keep it to ${TEXT_MAX} characters.` });
    const now = nowIso();
    const done = await c.env.DB.prepare(
      `UPDATE portfolio_right_requests SET state = 'declined', answered_by = ?, answered_at = ?, answer_note = ?, updated_at = ?
        WHERE id = ? AND state = 'open'`,
    ).bind(user.id, now, note, now, row.id).run();
    if (!done.meta?.changes) return refuse(c, 409, { code: 'request_answered', message: 'This request is already answered.' });
    await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), 'portfolio.right_request_declined', { request_uid: row.uid, project_uid: row.project_uid, type: row.right_type });
    await notifyRequester(c.env, Number(row.requester_user_id), row.project_uid, `${row.project_name}: request declined`, note);
    const fresh = await c.env.DB.prepare(`SELECT q.uid, q.right_type, q.description, q.state, q.created_at, q.answered_at, q.right_uid, q.answer_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name, u.name AS requester_name FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id
       LEFT JOIN users u ON u.id = q.requester_user_id WHERE q.uid = ?`).bind(row.uid).first<any>();
    return c.json(requestDto(fresh, true));
  } catch (e) { return mapError(c, e); }
});

// GET /api/portfolio-rights/:projectUid — the caller's rights in one company and their requests; an admin reads all.
r.get('/:projectUid', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!canViewLpData(user)) return refuse(c, 403, { code: 'forbidden', message: 'Rights are read with an investor licence.' });
    c.header('Cache-Control', 'no-store');
    const admin = isAdminUser(user);
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number; uid: string; name: string }>();
    if (admin) {
      if (!proj) return refuse(c, 404, { code: 'not_found', message: 'No such company.' });
      const [rights, requests, holders] = await Promise.all([
        c.env.DB.prepare(`SELECT g.uid, g.project_id, g.holder_user_id, g.right_type, g.document_title, g.clause, g.terms, g.signed_on, g.recorded_at, g.updated_at, u.name AS holder_name FROM portfolio_rights g LEFT JOIN users u ON u.id = g.holder_user_id
          WHERE g.project_id = ? ORDER BY g.holder_user_id, g.id`).bind(proj.id).all<any>(),
        c.env.DB.prepare(`SELECT q.uid, q.right_type, q.description, q.state, q.created_at, q.answered_at, q.right_uid, q.answer_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name, u.name AS requester_name FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id
          LEFT JOIN users u ON u.id = q.requester_user_id WHERE q.project_id = ? ORDER BY q.created_at DESC, q.id DESC LIMIT 500`).bind(proj.id).all<any>(),
        c.env.DB.prepare(`SELECT DISTINCT u.id, u.name FROM commitments t JOIN deals d ON d.id = t.deal_id JOIN users u ON u.id = t.investor_user_id
          WHERE d.project_id = ? AND t.status = 'confirmed' ORDER BY u.name, u.id`).bind(proj.id).all<any>(),
      ]);
      // Who each request is recorded for: the requester's seat holder, which is whose right PUT records.
      const seat = new Map<number, number>();
      for (const q of requests.results || []) {
        const id = Number(q.requester_user_id);
        if (!seat.has(id)) seat.set(id, await seatOwnerId(c.env, { id } as User));
      }
      return c.json({
        scope: 'all_holders',
        project: { uid: proj.uid, name: proj.name },
        types: RIGHT_TYPES,
        holders: (holders.results || []).map((h: any) => ({ id: Number(h.id), name: h.name ?? null })),
        rights: (rights.results || []).map((x: any) => rightDto(x, true)),
        requests: (requests.results || []).map((x: any) => ({ ...requestDto(x, true), holder_id: seat.get(Number(x.requester_user_id)) ?? null })),
      });
    }
    // Not found and not held answer alike, so the read does not confirm a company exists.
    const held = proj ? await investorHeldProjectIds(c.env, user, await investorActiveCompany(c, user)) : [];
    if (!proj || !held || !held.includes(Number(proj.id))) return refuse(c, 403, NOT_HELD);
    const holderId = await seatOwnerId(c.env, user);
    const [rights, requests] = await Promise.all([
      c.env.DB.prepare(`SELECT g.uid, g.project_id, g.holder_user_id, g.right_type, g.document_title, g.clause, g.terms, g.signed_on, g.recorded_at, g.updated_at FROM portfolio_rights g WHERE g.project_id = ? AND g.holder_user_id = ?`).bind(proj.id, holderId).all<any>(),
      c.env.DB.prepare(`SELECT q.uid, q.right_type, q.description, q.state, q.created_at, q.answered_at, q.right_uid, q.answer_note, q.requester_user_id, p.uid AS project_uid, p.name AS project_name, u.name AS requester_name FROM portfolio_right_requests q JOIN projects p ON p.id = q.project_id
        LEFT JOIN users u ON u.id = q.requester_user_id WHERE q.project_id = ? AND q.requester_user_id = ?
        ORDER BY q.created_at DESC, q.id DESC`).bind(proj.id, user.id).all<any>(),
    ]);
    const byType = new Map((rights.results || []).map((x: any) => [x.right_type, x]));
    return c.json({
      scope: 'own_rights',
      project: { uid: proj.uid, name: proj.name },
      // Every type, in order: a type with no row is not recorded, never "none".
      rights: RIGHT_TYPES.map((type) => {
        const row = byType.get(type);
        return row ? { ...rightDto(row, false), recorded: true } : { type, recorded: false };
      }),
      requests: (requests.results || []).map((x: any) => requestDto(x, false)),
    });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/portfolio-rights/:projectUid/holders/:holderId/:type — { document_title, clause?, terms, signed_on?, request_uid? }, admin only.
r.put('/:projectUid/holders/:holderId/:type', async (c) => {
  try {
    const user = await requireAdmin(c);
    const type = c.req.param('type');
    if (!TYPES.has(type)) return refuse(c, 400, { code: 'bad_type', message: 'That is not a right this page records.' });
    const proj = await c.env.DB.prepare('SELECT id, uid, name FROM projects WHERE uid = ? AND deleted_at IS NULL')
      .bind(c.req.param('projectUid')).first<{ id: number; uid: string; name: string }>();
    if (!proj) return refuse(c, 404, { code: 'not_found', message: 'No such company.' });
    const holderId = Number(c.req.param('holderId'));
    if (!Number.isSafeInteger(holderId) || holderId <= 0 || !(await holds(c.env, proj.id, holderId))) {
      return refuse(c, 400, { code: 'not_a_holder', message: 'That investor does not hold this company through a confirmed commitment.' });
    }
    const body = await c.req.json().catch(() => ({} as any));
    const title = text(body?.document_title);
    const clause = text(body?.clause) || null;
    const terms = text(body?.terms);
    const signedOn = body?.signed_on == null || body.signed_on === '' ? null : body.signed_on;
    if (!title) return refuse(c, 400, { code: 'document_required', message: 'Name the signed document the right is in.' });
    if (title.length > TITLE_MAX) return refuse(c, 400, { code: 'document_too_long', message: `Keep the document's title to ${TITLE_MAX} characters.` });
    if (clause && clause.length > CLAUSE_MAX) return refuse(c, 400, { code: 'clause_too_long', message: `Keep the clause to ${CLAUSE_MAX} characters.` });
    if (!terms) return refuse(c, 400, { code: 'terms_required', message: 'Say what the right grants, as the document says it.' });
    if (terms.length > TERMS_MAX) return refuse(c, 400, { code: 'terms_too_long', message: `Keep the terms to ${TERMS_MAX} characters.` });
    if (signedOn !== null && !isDay(signedOn)) return refuse(c, 400, { code: 'bad_signed_on', message: 'Give the date the document was signed as YYYY-MM-DD.' });

    let request: any = null;
    if (body?.request_uid != null && body.request_uid !== '') {
      request = await c.env.DB.prepare(
        'SELECT id, uid, state, project_id, requester_user_id, right_type FROM portfolio_right_requests WHERE uid = ?',
      ).bind(String(body.request_uid)).first<any>();
      if (!request || Number(request.project_id) !== Number(proj.id) || request.right_type !== type) {
        return refuse(c, 400, { code: 'request_mismatch', message: 'That request is not for this company and right.' });
      }
      if (Number(await seatOwnerId(c.env, { id: request.requester_user_id } as User)) !== holderId) {
        return refuse(c, 400, { code: 'request_mismatch', message: 'That request was made by another holder.' });
      }
      if (request.state !== 'open') return refuse(c, 409, { code: 'request_answered', message: 'This request is already answered.' });
    }

    const now = nowIso();
    const existing = await c.env.DB.prepare('SELECT uid FROM portfolio_rights WHERE project_id = ? AND holder_user_id = ? AND right_type = ?')
      .bind(proj.id, holderId, type).first<{ uid: string }>();
    const uid = existing?.uid || newUid();
    const writes = [
      existing
        ? c.env.DB.prepare(`UPDATE portfolio_rights SET document_title = ?, clause = ?, terms = ?, signed_on = ?, recorded_by = ?, updated_at = ? WHERE uid = ?`)
          .bind(title, clause, terms, signedOn, user.id, now, uid)
        : c.env.DB.prepare(`INSERT INTO portfolio_rights (uid, project_id, holder_user_id, right_type, document_title, clause, terms, signed_on, recorded_by, recorded_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uid, proj.id, holderId, type, title, clause, terms, signedOn, user.id, now, now),
    ];
    if (request) {
      writes.push(c.env.DB.prepare(`UPDATE portfolio_right_requests SET state = 'recorded', answered_by = ?, answered_at = ?, right_uid = ?, updated_at = ?
        WHERE id = ? AND state = 'open'`).bind(user.id, now, uid, now, request.id));
    }
    await c.env.DB.batch(writes);
    await logAdminAction(c.env, Number(user.id), String(user.email ?? ''), existing ? 'portfolio.right_corrected' : 'portfolio.right_recorded', {
      right_uid: uid, project_uid: proj.uid, holder_user_id: holderId, type, request_uid: request?.uid ?? null,
    });
    if (request) {
      await notifyRequester(c.env, Number(request.requester_user_id), proj.uid, `${proj.name}: right recorded`, `HQ recorded ${RIGHT_WORDS[type].toLowerCase()} from ${title}${clause ? ` ${clause}` : ''}.`);
    }
    const row = await c.env.DB.prepare(`SELECT g.uid, g.project_id, g.holder_user_id, g.right_type, g.document_title, g.clause, g.terms, g.signed_on, g.recorded_at, g.updated_at, u.name AS holder_name FROM portfolio_rights g LEFT JOIN users u ON u.id = g.holder_user_id WHERE g.uid = ?`)
      .bind(uid).first<any>();
    return c.json(rightDto(row, true), existing ? 200 : 201);
  } catch (e) { return mapError(c, e); }
});

export default r;

export const mount: RouteMount = { path: '/api/portfolio-rights', router: r };
