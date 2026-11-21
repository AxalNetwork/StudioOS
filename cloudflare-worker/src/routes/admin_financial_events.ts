/**
 * D5951 (#5951, part of #5038) — HQ's guarded route to reconcile the revenue
 * ledger (`financial_events`, D5299), mounted at `/api/admin/financial-events`.
 * Super Admin only (`requireSuperAdmin`).
 *
 *   GET  /?state=&kind=&currency=&from=&to=&cursor=&limit=
 *        the ledger rows, newest first, filtered by reconciliation state,
 *        kind, currency and the day they occurred (from/to, YYYY-MM-DD,
 *        inclusive). Paged by `cursor` (the last id read), at most 100 a page.
 *        Each row names its unattributed fields; a missing amount is null,
 *        never 0, and nothing is summed (each row keeps its own currency).
 *   POST /:uid/reconcile   { from, to, note? }
 *        moves one row's reconciliation state through
 *        `setReconciliationState`: only a move `RECONCILIATION_MOVES` allows
 *        (else 400), from the state the caller read (a stale `from` changes
 *        nothing and answers 409 with the state the row holds now). A note is
 *        required for `discrepancy` and `excluded`. The actor and time are
 *        stored by that function; the write is recorded in `admin_audit_log`
 *        through `logAdminAction`.
 *
 * NOTHING ELSE ON A ROW CHANGES HERE. The only UPDATE is the service's, and
 * the migration's trigger refuses any other column (D5299).
 *
 * STEP-UP IS AN OPEN QUESTION (#5038 does not decide it). HQ's refund route
 * takes `requireSuperAdminWriteBar` (TOTP session and a recent step-up); this
 * route takes the elevation alone. The PR asks the owner; the change, if
 * wanted, is the POST's one guard.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireSuperAdmin } from '../auth';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import {
  ATTRIBUTION_FIELDS, FINANCIAL_EVENT_KINDS, RECONCILIATION_MOVES, RECONCILIATION_STATES, ensureFinancialEventsSchema,
  setReconciliationState, unattributedFields, type ReconciliationState,
} from '../services/financialEvents';

const r = new Hono<{ Bindings: Env }>();

export const PAGE_MAX = 100;
/** The states whose move must say why. */
export const NOTE_REQUIRED: readonly ReconciliationState[] = Object.freeze(['discrepancy', 'excluded']);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isState = (v: unknown): v is ReconciliationState => (RECONCILIATION_STATES as readonly string[]).includes(String(v));


const view = (row: any) => ({
  uid: row.uid, source: row.source, source_event_type: row.source_event_type, kind: row.kind,
  livemode: row.livemode == null ? null : Number(row.livemode) === 1,
  refs: { object: row.object_ref ?? null, charge: row.charge_ref ?? null, payment_intent: row.payment_intent_ref ?? null, invoice: row.invoice_ref ?? null },
  attribution: Object.fromEntries(ATTRIBUTION_FIELDS.map((k) => [k, row[k] ?? null])),
  unattributed: unattributedFields(row),
  currency: row.currency ?? null,
  gross_cents: row.gross_cents == null ? null : Number(row.gross_cents),
  refund_cents: row.refund_cents == null ? null : Number(row.refund_cents),
  net_cents: row.net_cents == null ? null : Number(row.net_cents),
  occurred_at: row.occurred_at ?? null, recorded_at: row.recorded_at,
  reconciliation: {
    state: row.reconciliation_state, at: row.reconciled_at ?? null,
    by_user_id: row.reconciled_by_user_id == null ? null : Number(row.reconciled_by_user_id),
    note: row.reconciliation_note ?? null,
  },
});

r.get('/', async (c) => {
  await requireSuperAdmin(c);
  const q = c.req.query();
  // Each filter is bound; an absent one is NULL and lets every row through.
  let state: string | null = null, kind: string | null = null, currency: string | null = null;
  let from: string | null = null, to: string | null = null, cursor: number | null = null;
  if (q.state) {
    if (!isState(q.state)) return refuse(c, 400, { code: 'invalid_state', message: `State is one of ${RECONCILIATION_STATES.join(', ')}.` });
    state = q.state;
  }
  if (q.kind) {
    if (!(FINANCIAL_EVENT_KINDS as readonly string[]).includes(q.kind)) return refuse(c, 400, { code: 'invalid_kind', message: `Kind is one of ${FINANCIAL_EVENT_KINDS.join(', ')}.` });
    kind = q.kind;
  }
  if (q.currency) {
    currency = q.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return refuse(c, 400, { code: 'invalid_currency', message: 'Currency is a three-letter code.' });
  }
  for (const key of ['from', 'to'] as const) {
    const v = q[key];
    if (!v) continue;
    if (!DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return refuse(c, 400, { code: 'invalid_period', message: 'From and to are days, YYYY-MM-DD.' });
    if (key === 'from') from = `${v} 00:00:00`; else to = `${v} 23:59:59`;
  }
  if (q.cursor) {
    cursor = Number(q.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 1) return refuse(c, 400, { code: 'invalid_cursor', message: 'The cursor is the last id read.' });
  }
  const lim = q.limit ? Number(q.limit) : 50;
  const limit = Number.isSafeInteger(lim) && lim >= 1 ? Math.min(lim, PAGE_MAX) : 50;
  await ensureFinancialEventsSchema(c.env);
  // occurred_at is ISO (…T…Z); it is compared through datetime() so text order cannot mislead (D124).
  const res = await c.env.DB.prepare(
    `SELECT id, uid, source, source_event_type, kind, livemode, object_ref, charge_ref, payment_intent_ref, invoice_ref,
            user_id, company_id, project_id, licence_uid, revenue_stream, product_ref, currency, gross_cents, refund_cents,
            net_cents, occurred_at, recorded_at, reconciliation_state, reconciled_at, reconciled_by_user_id, reconciliation_note
       FROM financial_events
      WHERE (? IS NULL OR reconciliation_state = ?) AND (? IS NULL OR kind = ?) AND (? IS NULL OR currency = ?)
        AND (? IS NULL OR datetime(occurred_at) >= datetime(?)) AND (? IS NULL OR datetime(occurred_at) <= datetime(?))
        AND (? IS NULL OR id < ?)
      ORDER BY id DESC LIMIT ?`,
  ).bind(state, state, kind, kind, currency, currency, from, from, to, to, cursor, cursor, limit + 1).all<any>();
  const rows = res.results ?? [];
  const page = rows.slice(0, limit);
  return c.json({
    rows: page.map(view),
    next_cursor: rows.length > limit ? Number(page[page.length - 1].id) : null,
    moves: RECONCILIATION_MOVES,
  });
});

r.post('/:uid/reconcile', async (c) => {
  const admin = await requireSuperAdmin(c);
  const uid = c.req.param('uid');
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const from = body?.from, to = body?.to;
  if (!isState(from) || !isState(to)) {
    return refuse(c, 400, { code: 'invalid_move', message: `From and to are states: ${RECONCILIATION_STATES.join(', ')}. Nothing was changed.` });
  }
  if (!RECONCILIATION_MOVES[from].includes(to)) {
    return refuse(c, 400, { code: 'move_not_allowed', message: `A row cannot move from ${from} to ${to}. Nothing was changed.` });
  }
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (NOTE_REQUIRED.includes(to) && !note) {
    return refuse(c, 400, { code: 'note_required', message: `Say why the row is ${to}. Nothing was changed.` });
  }
  if (note.length > 500) return refuse(c, 400, { code: 'note_too_long', message: 'The note is at most 500 characters. Nothing was changed.' });
  await ensureFinancialEventsSchema(c.env);
  const row = await c.env.DB.prepare('SELECT uid, reconciliation_state FROM financial_events WHERE uid = ?').bind(uid).first<{ uid: string; reconciliation_state: string }>();
  if (!row) return refuse(c, 404, { code: 'not_found', message: 'No ledger row has that id.' });
  const done = await setReconciliationState(c.env, { uid, from, to, actorUserId: Number(admin.id), note: note || null });
  if (!done.ok) {
    const now = await c.env.DB.prepare('SELECT reconciliation_state FROM financial_events WHERE uid = ?').bind(uid).first<{ reconciliation_state: string }>();
    return refuse(c, 409, {
      code: 'state_changed', message: `The row is ${now?.reconciliation_state ?? 'changed'} now, not ${from}. Nothing was changed; read it again.`,
      extra: { state: now?.reconciliation_state ?? null },
    });
  }
  await logAdminAction(c.env, Number(admin.id), admin.email || '', 'financial_event_reconciled', { uid, from, to, note: note || null });
  const after = await c.env.DB.prepare(
    `SELECT id, uid, source, source_event_type, kind, livemode, object_ref, charge_ref, payment_intent_ref, invoice_ref,
            user_id, company_id, project_id, licence_uid, revenue_stream, product_ref, currency, gross_cents, refund_cents,
            net_cents, occurred_at, recorded_at, reconciliation_state, reconciled_at, reconciled_by_user_id, reconciliation_note
       FROM financial_events WHERE uid = ?`,
  ).bind(uid).first<any>();
  return c.json({ ok: true, row: view(after) });
});

export const mount: RouteMount = { path: '/api/admin/financial-events', router: r };
export default r;
