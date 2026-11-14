/** D713: obligations under signed partner deals; these routes never move money. */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAdmin, requireAuth, isSuperAdmin, requireSuperAdminWriteBar } from '../auth';
import { branchOf, HQ_ONLY } from '../util/branch';
import { isCalendarDate } from '../services/section83b';
import { logAdminAction } from '../services/adminAudit';

type Bindings = { Bindings: Env };
export const adminPartnerSettlements = new Hono<Bindings>();
export const partnerSettlements = new Hono<{ Bindings: Env }>();
const KINDS = ['revenue_share', 'capital', 'equity_for_services', 'other'];
const STATES = ['draft', 'issued', 'matched', 'void'];
const positiveId = (v: unknown) => (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && Number.isSafeInteger(Number(v)) && Number(v) > 0;

async function requireHqAdmin(c: Context<Bindings>) {
  const user = await requireAdmin(c);
  if (branchOf(c.env)) throw new Error(HQ_ONLY);
  return user;
}

function draftError(b: any): string | null {
  if (!positiveId(b.partner_deal_id)) return 'A partner deal is required.';
  if (!KINDS.includes(b.kind)) return 'Choose a settlement kind.';
  if (!['to_member', 'from_member'].includes(b.direction)) return 'Choose a direction.';
  if (!Number.isSafeInteger(b.amount_cents) || b.amount_cents <= 0) return 'Amount must be positive integer cents.';
  if (!isCalendarDate(b.due_on)) return 'Due date must be a calendar date.';
  if (b.entity_key !== undefined && b.entity_key !== 'management') return 'Management is the only settlement entity.';
  if (b.currency !== undefined && b.currency !== 'usd') return 'Only USD is supported.';
  if (b.memo != null && (typeof b.memo !== 'string' || b.memo.length > 2000 || /\d{8,}/.test(b.memo))) return 'Memo must be at most 2000 characters and contain no run of eight digits.';
  return null;
}
async function activeDeal(env: Env, id: number) {
  return env.DB.prepare("SELECT id, user_id FROM partner_deals WHERE id = ? AND status = 'active' AND user_id IS NOT NULL").bind(id).first<{ id: number; user_id: number }>();
}

adminPartnerSettlements.get('/', async (c) => {
  await requireHqAdmin(c);
  const where: string[] = [];
  const args: (string | number)[] = [];
  for (const [key, col] of [['deal', 'partner_deal_id'], ['partner', 'user_id']] as const) {
    const value = c.req.query(key);
    if (value !== undefined) {
      if (!positiveId(value)) return c.json({ detail: `Invalid ${key}` }, 400);
      where.push(`${col} = ?`); args.push(Number(value));
    }
  }
  const state = c.req.query('state');
  if (state !== undefined) {
    if (!STATES.includes(state)) return c.json({ detail: 'Invalid state' }, 400);
    where.push('state = ?'); args.push(state);
  }
  const rows = await c.env.DB.prepare(`SELECT * FROM partner_deal_settlements ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY drafted_at DESC, id DESC`).bind(...args).all();
  return c.json(rows.results);
});

adminPartnerSettlements.post('/', async (c) => {
  const user = await requireHqAdmin(c);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ detail: 'Expected a settlement' }, 400);
  const error = draftError(b);
  if (error) return c.json({ detail: error }, 400);
  const deal = await activeDeal(c.env, Number(b.partner_deal_id));
  if (!deal) return c.json({ detail: 'An active signed partner deal is required.' }, 400);
  const uid = crypto.randomUUID();
  const row = await c.env.DB.prepare(`INSERT INTO partner_deal_settlements
    (uid, partner_deal_id, user_id, kind, direction, amount_cents, due_on, memo, drafted_by)
    SELECT ?, id, user_id, ?, ?, ?, ?, ?, ? FROM partner_deals
    WHERE id = ? AND status = 'active' AND user_id = ? RETURNING *`)
    .bind(uid, b.kind, b.direction, b.amount_cents, b.due_on, b.memo ?? null, user.id, deal.id, deal.user_id).first();
  if (!row) return c.json({ detail: 'The deal changed; reload it.' }, 409);
  await logAdminAction(c.env, user.id, user.email, 'partner_settlement.draft', { uid, partner_deal_id: deal.id });
  return c.json(row, 201);
});

adminPartnerSettlements.patch('/:uid', async (c) => {
  const user = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  const old = await c.env.DB.prepare('SELECT * FROM partner_deal_settlements WHERE uid = ?').bind(uid).first<any>();
  if (!old) return c.json({ detail: 'Not found' }, 404);
  if (old.state !== 'draft') return c.json({ detail: 'Only drafts can be edited.' }, 409);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ detail: 'Expected a settlement' }, 400);
  const merged = { ...old, ...b };
  const error = draftError(merged);
  if (error) return c.json({ detail: error }, 400);
  const deal = await activeDeal(c.env, Number(merged.partner_deal_id));
  if (!deal) return c.json({ detail: 'An active signed partner deal is required.' }, 400);
  const row = await c.env.DB.prepare(`UPDATE partner_deal_settlements SET partner_deal_id = ?, user_id = ?, kind = ?, direction = ?, amount_cents = ?, due_on = ?, memo = ?, updated_at = datetime('now')
    WHERE uid = ? AND state = 'draft' AND EXISTS (SELECT 1 FROM partner_deals WHERE id = ? AND status = 'active' AND user_id = ?) RETURNING *`)
    .bind(deal.id, deal.user_id, merged.kind, merged.direction, merged.amount_cents, merged.due_on, merged.memo ?? null, uid, deal.id, deal.user_id).first();
  if (!row) return c.json({ detail: 'The settlement or deal changed; reload it.' }, 409);
  await logAdminAction(c.env, user.id, user.email, 'partner_settlement.edit', { uid });
  return c.json(row);
});

adminPartnerSettlements.delete('/:uid', async (c) => {
  const user = await requireHqAdmin(c);
  const uid = c.req.param('uid');
  const row = await c.env.DB.prepare('SELECT state FROM partner_deal_settlements WHERE uid = ?').bind(uid).first<any>();
  if (!row) return c.json({ detail: 'Not found' }, 404);
  const result = await c.env.DB.prepare("DELETE FROM partner_deal_settlements WHERE uid = ? AND state = 'draft'").bind(uid).run();
  if (!result.meta.changes) return c.json({ detail: 'Only drafts can be deleted.' }, 409);
  await logAdminAction(c.env, user.id, user.email, 'partner_settlement.delete', { uid });
  return c.json({ ok: true });
});

for (const act of ['issue', 'void'] as const) {
  adminPartnerSettlements.post(`/:uid/${act}`, async (c) => {
    const user = await requireHqAdmin(c);
    // Elevation BEFORE the bar: a plain Admin must never be asked for a code.
    if (!isSuperAdmin(user)) return c.json({ code: 'super_admin_required', detail: 'Super admin required' }, 403);
    await requireSuperAdminWriteBar(c);
    const uid = c.req.param('uid');
    const old = await c.env.DB.prepare('SELECT * FROM partner_deal_settlements WHERE uid = ?').bind(uid).first<any>();
    if (!old) return c.json({ detail: 'Not found' }, 404);
    if (old.state !== (act === 'issue' ? 'draft' : 'issued')) return c.json({ detail: act === 'issue' ? 'Only drafts can be issued.' : 'Only issued settlements can be voided; withdraw any match first.' }, 409);
    let row;
    if (act === 'issue') {
      row = await c.env.DB.prepare(`UPDATE partner_deal_settlements SET state = 'issued', issued_by = ?, issued_at = datetime('now'), updated_at = datetime('now')
        WHERE uid = ? AND state = 'draft' AND EXISTS (SELECT 1 FROM partner_deals d WHERE d.id = partner_deal_id AND d.status = 'active' AND d.user_id = partner_deal_settlements.user_id) RETURNING *`).bind(user.id, uid).first();
    } else {
      const b = await c.req.json().catch(() => null);
      const reason = typeof b?.reason === 'string' ? b.reason.trim() : '';
      if (!reason || reason.length > 2000) return c.json({ detail: 'A void reason is required (at most 2000 characters).' }, 400);
      row = await c.env.DB.prepare(`UPDATE partner_deal_settlements SET state = 'void', voided_by = ?, voided_at = datetime('now'), void_reason = ?, updated_at = datetime('now')
        WHERE uid = ? AND state = 'issued' RETURNING *`).bind(user.id, reason, uid).first();
    }
    if (!row) return c.json({ detail: 'The settlement or deal changed; reload it.' }, 409);
    await logAdminAction(c.env, user.id, user.email, `partner_settlement.${act}`, { uid });
    return c.json(row);
  });
}

partnerSettlements.get('/', async (c) => {
  const user = await requireAuth(c);
  const rows = await c.env.DB.prepare("SELECT * FROM partner_deal_settlements WHERE user_id = ? AND state IN ('issued', 'matched', 'void') ORDER BY due_on DESC, id DESC").bind(user.id).all();
  return c.json(rows.results);
});
