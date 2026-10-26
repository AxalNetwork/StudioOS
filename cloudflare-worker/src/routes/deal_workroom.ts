/**
 * D1153 (#3058, part 5 of the deal page #2421) — what the investor's working
 * tabs need that no read or write answered yet. Mounted at `/api/deals`
 * before `deals`, as `dealContext` is, so these literal paths are matched
 * first; the Professional gate on `/api/deals/*` covers them unchanged.
 *
 *   GET  /:id/room-access                     the data room's door for me: a grant,
 *                                             the NDA, and my request (DL8)
 *   POST /:id/room-access/request             ask the founder for access (DL9)
 *   GET  /:id/round                           the round as a count and a total (DL11)
 *   POST /:id/commitments/:uid/withdrawal     withdraw, with a required reason (DL12)
 *
 * An Investor's only, and only on a deal DEAL's rule opens to them (invited
 * or committed, `investorHasDealRelationship`). Another investor is never
 * named, and no amount of theirs is returned: the round is a count of
 * investors and a total. Logs hold outcomes only; a reason or a message is
 * stored, never logged.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { activeCompanyFor } from '../middleware/activeCompany';
import { investorHasDealRelationship } from '../services/dealAccess';
import { dealPageRequestStatement, REQUEST_MESSAGE_MAX } from '../services/dataRoomRequests';

export const WITHDRAW_REASON_MAX = 500;

const r = new Hono<{ Bindings: Env }>();

type Ctx = { user: User; dealId: number; projectId: number; currency: string };

async function investorDeal(c: Context<{ Bindings: Env }>): Promise<Ctx | { error: Response }> {
  const user = await requireAuth(c) as User;
  if (user.role !== 'investor') return { error: c.json({ error: 'investor_only', detail: 'This is an investor’s own view of the deal.' }, 403) };
  const raw = String(c.req.param('id') || '');
  if (!/^[1-9][0-9]{0,14}$/.test(raw)) return { error: c.json({ error: 'deal_not_found' }, 404) };
  const dealId = Number(raw);
  const deal = await c.env.DB.prepare(
    `SELECT d.id, d.project_id, COALESCE(d.currency, 'USD') AS currency FROM deals d
       JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL WHERE d.id = ?`,
  ).bind(dealId).first<{ id: number; project_id: number; currency: string }>();
  // A deal that does not exist and one the investor cannot open answer the same way.
  if (!deal || !(await investorHasDealRelationship(c.env, user.id, dealId))) return { error: c.json({ error: 'deal_not_found' }, 404) };
  return { user, dealId, projectId: Number(deal.project_id), currency: deal.currency };
}

/** The firm a commitment is held under: the active one, or the only one (as `deals.ts`' withdraw reads it). */
async function commitmentFirm(c: Context<{ Bindings: Env }>, user: User): Promise<{ companyId: number | null } | { error: Response }> {
  const active = await activeCompanyFor(c, user);
  if (active != null) return { companyId: active };
  const links = await c.env.DB.prepare(
    'SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? AND company_id IS NOT NULL LIMIT 2',
  ).bind(user.id).all<{ company_id: number }>();
  const ids = (links.results || []).map((x) => Number(x.company_id));
  if (ids.length <= 1) return { companyId: ids[0] ?? null };
  return { error: c.json({ error: 'firm_required', detail: 'You belong to more than one firm. Choose the firm in the company switcher, then try again. Nothing was changed.' }, 400) };
}

r.get('/:id/room-access', async (c) => {
  const x = await investorDeal(c);
  if ('error' in x) return x.error;
  const db = c.env.DB;
  const project = await db.prepare('SELECT uid, founder_id FROM projects WHERE id = ?').bind(x.projectId).first<{ uid: string; founder_id: number | null }>();
  const grant = await db.prepare(
    `SELECT expires_at FROM data_room_grants WHERE project_id = ? AND investor_user_id = ? AND status = 'active'
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
  ).bind(x.projectId, x.user.id).first<{ expires_at: string | null }>();
  // The NDA is the venture founder's (data_room.ts projectNdaActive): an active
  // one is on file until its date; a pending one is out for signature.
  const nda = await db.prepare(
    `SELECT n.status, n.valid_until FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
      WHERE owner.founder_id = ? AND n.party_b_user_id = ?
        AND n.status IN ('active', 'pending', 'partially_signed')
        AND (n.status <> 'active' OR n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
      ORDER BY n.id DESC LIMIT 1`,
  ).bind(project?.founder_id ?? null, x.user.id).first<{ status: string; valid_until: string | null }>();
  const request = await db.prepare(
    `SELECT state, created_at, decided_at, decline_reason FROM data_room_access_requests
      WHERE project_id = ? AND investor_user_id = ? ORDER BY id DESC LIMIT 1`,
  ).bind(x.projectId, x.user.id).first<{ state: string; created_at: string; decided_at: string | null; decline_reason: string | null }>();
  const founder = await db.prepare('SELECT id FROM users WHERE founder_id = ? AND role = ? ORDER BY id LIMIT 1')
    .bind(project?.founder_id ?? null, 'founder').first<{ id: number }>();
  return c.json({
    project_uid: project?.uid ?? null,
    founder_user_id: founder?.id ?? null,
    granted: grant ? { expires_at: grant.expires_at ?? null } : null,
    nda: nda ? { status: nda.status === 'active' ? 'on_file' : 'out_for_signature', valid_until: nda.valid_until ?? null } : null,
    request: request ?? null,
  });
});

r.post('/:id/room-access/request', async (c) => {
  const x = await investorDeal(c);
  if ('error' in x) return x.error;
  const body = await c.req.json().catch(() => ({})) as { message?: unknown };
  if (body.message != null && (typeof body.message !== 'string' || body.message.length > REQUEST_MESSAGE_MAX)) {
    return c.json({ error: 'invalid_message', detail: `Keep the message to ${REQUEST_MESSAGE_MAX.toLocaleString('en-US')} characters.` }, 400);
  }
  const result = await dealPageRequestStatement(c.env, { projectId: x.projectId, investorUserId: x.user.id, message: body.message as string | null, at: new Date().toISOString() }).run();
  if (!result.meta?.changes) {
    // Nothing written: a live grant already opens the room, or a request is already open.
    const granted = await c.env.DB.prepare(
      `SELECT 1 FROM data_room_grants WHERE project_id = ? AND investor_user_id = ? AND status = 'active'
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
    ).bind(x.projectId, x.user.id).first();
    if (granted) return c.json({ error: 'already_granted', detail: 'The data room is already open to you. Nothing was sent.' }, 409);
    return c.json({ ok: true, state: 'open', created: false });
  }
  console.log('[deal-workroom] room access requested');
  return c.json({ ok: true, state: 'open', created: true });
});

r.get('/:id/round', async (c) => {
  const x = await investorDeal(c);
  if ('error' in x) return x.error;
  const row = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT investor_user_id) AS investors,
            COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount END), 0) AS confirmed_total,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending_total
       FROM commitments WHERE deal_id = ? AND status IN ('pending', 'confirmed')`,
  ).bind(x.dealId).first<{ investors: number; confirmed_total: number; pending_total: number }>();
  return c.json({
    investors: Number(row?.investors ?? 0),
    confirmed_total: Number(row?.confirmed_total ?? 0),
    pending_total: Number(row?.pending_total ?? 0),
    currency: x.currency,
  });
});

r.post('/:id/commitments/:uid/withdrawal', async (c) => {
  const x = await investorDeal(c);
  if ('error' in x) return x.error;
  const body = await c.req.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return c.json({ error: 'reason_required', detail: 'Write why you are withdrawing.' }, 400);
  if (reason.length > WITHDRAW_REASON_MAX) return c.json({ error: 'invalid_reason', detail: `Keep the reason to ${WITHDRAW_REASON_MAX} characters.` }, 400);
  const firm = await commitmentFirm(c, x.user);
  if ('error' in firm) return firm.error;
  const uid = String(c.req.param('uid') || '');
  const db = c.env.DB;
  // One batch: the withdrawal, then its record with the reason only when the
  // withdrawal changed a row (changes() reads the statement before it), then
  // the deal's confirmed total.
  const results = await db.batch([
    db.prepare(`UPDATE commitments SET status = 'withdrawn' WHERE uid = ? AND deal_id = ? AND investor_user_id = ? AND company_id IS ?
      AND status IN ('pending', 'confirmed')`).bind(uid, x.dealId, x.user.id, firm.companyId),
    db.prepare(`INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id)
      SELECT 'deal_commitment_withdrawn', ?, ?, 'deal', ? WHERE changes() > 0`)
      .bind(JSON.stringify({ commitment_uid: uid, company_id: firm.companyId, reason }), x.user.id, String(x.dealId)),
    db.prepare(`UPDATE deals SET capital_committed = (SELECT COALESCE(SUM(amount), 0) FROM commitments WHERE deal_id = ? AND status = 'confirmed') WHERE id = ?`)
      .bind(x.dealId, x.dealId),
  ]);
  if (!results[0].meta?.changes) return c.json({ error: 'commitment_not_found', detail: 'This commitment is not yours to withdraw, or it is already withdrawn. Nothing was changed.' }, 404);
  console.log('[deal-workroom] commitment withdrawn');
  return c.json({ ok: true });
});

export default r;
