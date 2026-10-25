/**
 * D601 (#998; the owner's answer 1A) — an Axal admin moves a paid formation
 * order on by hand, in two recorded steps:
 *
 *   markPacketReady   paid / packet_processing → packet_ready, with the packet
 *                     attached: a `documents` row of the order's own project.
 *   markFiled         packet_ready → filed, with the date the filing was
 *                     submitted to the state (YYYY-MM-DD; not in the future,
 *                     not before the order was paid).
 *
 * Each is one conditional UPDATE: the status it moves from is in the WHERE, so
 * two admins pressing at once, or a step pressed twice, change the row once and
 * the second call answers 409. Who recorded each step and when are stored on
 * the row (migration 411); the route also logs it through logAdminAction.
 * Nothing here builds a packet or files anything: it records what an admin did.
 */
import type { Env } from '../types';
import { ensureIncorporationsSchema } from './incorporations';
import { isCalendarDate } from './section83b';
import { LAB_PARTICIPANT_IDS } from './labParticipants';

export const PACKET_FROM = ['paid', 'packet_processing'] as const;

const ORDER = 'SELECT id, project_id, status, paid_at FROM incorporations WHERE id = ?';
const PROJECT_DOC = 'SELECT id FROM documents WHERE id = ? AND project_id = ?';

const SET_PACKET_READY =
  "UPDATE incorporations SET status = 'packet_ready', packet_document_id = ?, packet_ready_by = ?, "
  + "packet_ready_at = datetime('now'), updated_at = datetime('now') "
  + "WHERE id = ? AND status IN ('paid', 'packet_processing')";

const SET_FILED =
  "UPDATE incorporations SET status = 'filed', filed_on = ?, filed_by = ?, "
  + "filed_recorded_at = datetime('now'), updated_at = datetime('now') "
  + "WHERE id = ? AND status = 'packet_ready'";

export type FilingResult =
  | { ok: true; id: number; status: 'packet_ready' | 'filed' }
  | { ok: false; status: 400 | 404 | 409; error: string };

type OrderRow = { id: number; project_id: number; status: string; paid_at: string | null };

async function order(env: Env, id: number): Promise<OrderRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await env.DB.prepare(ORDER).bind(id).first<OrderRow>()) || null;
}

/** "Packet ready": attach one of the project's documents as the packet. */
export async function markPacketReady(env: Env, id: number, documentId: unknown, adminId: number): Promise<FilingResult> {
  await ensureIncorporationsSchema(env);
  const o = await order(env, id);
  if (!o) return { ok: false, status: 404, error: 'order_not_found' };
  if (!(PACKET_FROM as readonly string[]).includes(o.status)) return { ok: false, status: 409, error: 'order_not_awaiting_packet' };
  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) return { ok: false, status: 400, error: 'document_id_required' };
  const doc = await env.DB.prepare(PROJECT_DOC).bind(docId, o.project_id).first();
  if (!doc) return { ok: false, status: 400, error: 'document_not_on_project' };
  const r = await env.DB.prepare(SET_PACKET_READY).bind(docId, adminId, id).run();
  if (!(Number(r.meta?.changes ?? 0) > 0)) return { ok: false, status: 409, error: 'order_not_awaiting_packet' };
  return { ok: true, id, status: 'packet_ready' };
}

/** "Filed with the state": the date the filing was submitted. */
export async function markFiled(
  env: Env, id: number, filedOn: unknown, adminId: number, today = new Date().toISOString().slice(0, 10),
): Promise<FilingResult> {
  await ensureIncorporationsSchema(env);
  const o = await order(env, id);
  if (!o) return { ok: false, status: 404, error: 'order_not_found' };
  if (o.status !== 'packet_ready') return { ok: false, status: 409, error: 'packet_not_ready' };
  if (!isCalendarDate(filedOn)) return { ok: false, status: 400, error: 'filed_on_invalid' };
  if (filedOn > today) return { ok: false, status: 400, error: 'filed_on_future' };
  const paidDay = o.paid_at ? String(o.paid_at).slice(0, 10) : null;
  if (paidDay && filedOn < paidDay) return { ok: false, status: 400, error: 'filed_on_before_payment' };
  const r = await env.DB.prepare(SET_FILED).bind(filedOn, adminId, id).run();
  if (!(Number(r.meta?.changes ?? 0) > 0)) return { ok: false, status: 409, error: 'packet_not_ready' };
  return { ok: true, id, status: 'filed' };
}

const PAID_ORDERS =
  'SELECT i.id, i.project_id, p.name AS project_name, i.user_id, i.company_name, i.jurisdiction_id, i.status, '
  + 'i.paid_at, i.packet_document_id, i.packet_ready_at, i.filed_on, i.filed_recorded_at '
  + 'FROM incorporations i LEFT JOIN projects p ON p.id = i.project_id '
  + "WHERE i.status IN ('paid', 'packet_processing', 'packet_ready', 'filed') "
  + 'ORDER BY i.paid_at DESC, i.id DESC LIMIT 200';

/**
 * D946 (#2751) — the same list, Lab ventures only: an order whose founder (the
 * order's user, or its project's founder) is a Lab participant, by the
 * participants read's own rule.
 */
const LAB_PAID_ORDERS =
  'SELECT i.id, i.project_id, p.name AS project_name, i.user_id, i.company_name, i.jurisdiction_id, i.status, '
  + 'i.paid_at, i.packet_document_id, i.packet_ready_at, i.filed_on, i.filed_recorded_at '
  + 'FROM incorporations i LEFT JOIN projects p ON p.id = i.project_id '
  + "WHERE i.status IN ('paid', 'packet_processing', 'packet_ready', 'filed') "
  + 'AND (i.user_id IN (' + LAB_PARTICIPANT_IDS + ') '
  + 'OR p.founder_id IN (SELECT lu.founder_id FROM users lu WHERE lu.id IN (' + LAB_PARTICIPANT_IDS + '))) '
  + 'ORDER BY i.paid_at DESC, i.id DESC LIMIT 200';

const PROJECT_DOCS = 'SELECT id, title FROM documents WHERE project_id = ? ORDER BY id DESC LIMIT 50';

/** HQ's list: every paid order, with its project's documents to attach as the packet. */
export async function listPaidOrders(env: Env, opts: { labOnly?: boolean } = {}) {
  await ensureIncorporationsSchema(env);
  const rows = (await env.DB.prepare(opts.labOnly ? LAB_PAID_ORDERS : PAID_ORDERS).all<Record<string, unknown>>()).results || [];
  const out = [];
  for (const r of rows) {
    const docs = (await env.DB.prepare(PROJECT_DOCS).bind(r.project_id).all<{ id: number; title: string }>()).results || [];
    out.push({ ...r, documents: docs });
  }
  return out;
}
