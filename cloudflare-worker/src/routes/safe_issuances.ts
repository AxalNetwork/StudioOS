/**
 * D578 (#1205) — a startup's SAFEs: the terms recorded per investor, and the
 * envelope each was sent in. Mounted at /api/safe-issuances.
 *
 *   GET  /project/:projectId   → { form, sendable, safes: [...] } with each SAFE's status
 *   POST /project/:projectId   → { investor_name, amount_cents, valuation_cap_cents, prospect_id? }
 *   POST /:uid/send            → refused (409 safe_text_not_approved) until the
 *                                counsel-approved SAFE text is registered
 *
 * The form is a post-money SAFE with a valuation cap and no discount (S1's Q1 A
 * for the owner). Status is read from the linked envelope and nowhere else:
 * with no envelope a SAFE is a draft, never "Sent" (the issue's "Done when").
 *
 * Who: a founder or company editor of the startup, or an admin, records and
 * reads (`canAccessProject`, `write` for recording). Anyone else is told the
 * startup does not exist. Investors never read here.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { templateKeyForDocType } from '../services/legalDocTypes';

const r = new Hono<{ Bindings: Env }>();

export const SAFE_FORM = 'post_money_cap';
export const SAFE_DOC_TYPE = 'safe';

/** Whether a SAFE can be sent: only once an approved text is registered for `safe`. */
export function safeSendable(): boolean {
  return templateKeyForDocType(SAFE_DOC_TYPE) !== null;
}

/**
 * A SAFE's status from its envelope, and only from it. No envelope: a draft.
 * `completed` is countersigned; any other envelope state is shown as it is.
 */
export function safeStatus(envelopeStatus: string | null | undefined): { key: string; label: string } {
  if (!envelopeStatus) return { key: 'draft', label: 'Draft · not sent' };
  const s = String(envelopeStatus).toLowerCase();
  if (s === 'completed') return { key: 'countersigned', label: 'Countersigned' };
  if (s === 'sent') return { key: 'sent', label: 'Sent' };
  if (s === 'partially_signed') return { key: 'partially_signed', label: 'Signed by some parties' };
  if (s === 'rejected') return { key: 'rejected', label: 'Declined' };
  if (s === 'void' || s === 'voided') return { key: 'void', label: 'Voided' };
  return { key: s, label: s };
}

const PROJECT = 'SELECT id, founder_id FROM projects WHERE id = ?';
const LIST =
  'SELECT s.uid, s.prospect_id, s.investor_name, s.form, s.amount_cents, s.valuation_cap_cents, s.currency, '
  + 's.envelope_id, e.status AS envelope_status, s.created_at '
  + 'FROM safe_issuances s LEFT JOIN esign_envelopes e ON e.id = s.envelope_id '
  + 'WHERE s.project_id = ? ORDER BY s.id';
const PROSPECT_OF_PROJECT = 'SELECT id FROM raise_prospects WHERE id = ? AND project_id = ?';
const INSERT =
  'INSERT INTO safe_issuances (project_id, prospect_id, investor_name, form, amount_cents, valuation_cap_cents, created_by) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING uid';
const BY_UID = 'SELECT s.uid, s.project_id, s.envelope_id FROM safe_issuances s WHERE s.uid = ?';

async function access(env: Env, user: User, projectId: number, write: boolean) {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const p = await env.DB.prepare(PROJECT).bind(projectId).first<{ id: number; founder_id: number | null }>();
  if (!p) return null;
  // canAccessProject refuses an investor on role alone.
  return (await canAccessProject(env, user, p, { write })) ? p : null;
}

const positiveCents = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

r.get('/project/:projectId', async (c) => {
  const user = await requireAuth(c);
  const p = await access(c.env, user, Number(c.req.param('projectId')), false);
  if (!p) return c.json({ error: 'not_found' }, 404);
  const rows = (await c.env.DB.prepare(LIST).bind(p.id).all<Record<string, any>>()).results || [];
  return c.json({
    form: SAFE_FORM,
    sendable: safeSendable(),
    safes: rows.map((s) => ({
      uid: s.uid,
      prospect_id: s.prospect_id ?? null,
      investor_name: s.investor_name,
      form: s.form,
      amount_cents: s.amount_cents,
      valuation_cap_cents: s.valuation_cap_cents,
      discount: null,
      currency: s.currency,
      envelope_id: s.envelope_id ?? null,
      status: safeStatus(s.envelope_id ? s.envelope_status : null),
      created_at: s.created_at,
    })),
  });
});

r.post('/project/:projectId', async (c) => {
  const user = await requireAuth(c);
  const p = await access(c.env, user, Number(c.req.param('projectId')), true);
  if (!p) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.investor_name === 'string' ? body.investor_name.trim().slice(0, 200) : '';
  if (!name) return c.json({ error: 'investor_name_required' }, 400);
  const amount = positiveCents(body.amount_cents);
  if (amount === null) return c.json({ error: 'amount_cents_invalid' }, 400);
  const cap = positiveCents(body.valuation_cap_cents);
  if (cap === null) return c.json({ error: 'valuation_cap_cents_invalid' }, 400);
  if ('discount' in body && body.discount !== null && body.discount !== undefined) {
    return c.json({ error: 'discount_not_in_form' }, 400);
  }
  let prospectId: number | null = null;
  if (body.prospect_id !== undefined && body.prospect_id !== null) {
    prospectId = Number(body.prospect_id);
    const ok = Number.isInteger(prospectId) && prospectId > 0
      ? await c.env.DB.prepare(PROSPECT_OF_PROJECT).bind(prospectId, p.id).first()
      : null;
    if (!ok) return c.json({ error: 'prospect_not_on_project' }, 400);
  }
  const row = await c.env.DB.prepare(INSERT).bind(p.id, prospectId, name, SAFE_FORM, amount, cap, user.id).first<{ uid: string }>();
  return c.json({ ok: true, uid: row?.uid, status: safeStatus(null) });
});

r.post('/:uid/send', async (c) => {
  const user = await requireAuth(c);
  const s = await c.env.DB.prepare(BY_UID).bind(c.req.param('uid')).first<{ uid: string; project_id: number; envelope_id: number | null }>();
  const p = s ? await access(c.env, user, Number(s.project_id), true) : null;
  if (!s || !p) return c.json({ error: 'not_found' }, 404);
  if (s.envelope_id) return c.json({ error: 'already_sent' }, 409);
  if (!safeSendable()) {
    return c.json({
      error: 'safe_text_not_approved',
      message: 'This SAFE cannot be sent yet: no counsel-approved SAFE text is registered for signature.',
    }, 409);
  }
  // The approved text's registration (#1205) wires the send through the
  // existing e-sign routes. Until then this line is unreachable.
  return c.json({ error: 'send_not_wired' }, 501);
});

export default r;
