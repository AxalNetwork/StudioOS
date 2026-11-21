/**
 * D1415 Part 3 (#3855): `markFiled` also links or creates the order's company,
 * in the same batch (`incorporationCompany.ts`).
 *
 * D601 (#998; the owner's answer 1A) — an Axal admin moves a paid formation
 * order on by hand, in two recorded steps:
 *
 *   markPacketReady   paid / packet_processing → packet_ready, with the packet
 *                     attached: a `documents` row of the order's own project.
 *   markFiled         packet_ready → filed, with the date the filing was
 *                     submitted to the state (YYYY-MM-DD; not in the future,
 *                     not before the order was paid).
 *
 * D6686 (#6686): each step is a transition of the order's formation case
 * (`formationCase.ts`): ready_to_file and registered. The case and the order
 * move in one batch guarded on the stage, revision and status that were read,
 * so two admins pressing at once, or a step pressed twice, change the row once
 * and the second call answers 409. A v2 case is refused (`case_not_legacy`):
 * these two hand steps are the legacy track's. Who recorded each step and when are stored on
 * the row (migration 411); the route also logs it through logAdminAction.
 * Nothing here builds a packet or files anything: it records what an admin did.
 */
import type { Env } from '../types';
import { afterMove } from './agents/transfer';
import { ensureIncorporationsSchema } from './incorporations';
import { isCalendarDate } from './section83b';
import { LAB_PARTICIPANT_IDS } from './labParticipants';
import { filingCompanyStatements, type CompanyOutcome } from './incorporationCompany';
import { ensureCaseForOrder, transition } from './formationCase';

export const PACKET_FROM = ['paid', 'packet_processing'] as const;

const ORDER = 'SELECT id, project_id, status, paid_at FROM incorporations WHERE id = ?';
const PROJECT_DOC = 'SELECT id FROM documents WHERE id = ? AND project_id = ?';

export type FilingResult =
  | { ok: true; id: number; status: 'packet_ready' | 'filed'; company?: CompanyOutcome }
  | { ok: false; status: 400 | 404 | 409; error: string };

// D1415 Part 3 (#3855): what the filing copies onto the company.
const ORDER_FACTS = 'SELECT id, project_id, subject_company_id, company_name, jurisdiction_id, registered_agent_name, registered_agent_address FROM incorporations WHERE id = ?';

type OrderRow = { id: number; project_id: number; status: string; paid_at: string | null };

async function order(env: Env, id: number): Promise<OrderRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return (await env.DB.prepare(ORDER).bind(id).first<OrderRow>()) || null;
}

/** "Packet ready": attach one of the project's documents as the packet. */
export async function markPacketReady(env: Env, id: number, documentId: unknown, adminId: number, adminEmail?: string): Promise<FilingResult> {
  await ensureIncorporationsSchema(env);
  const o = await order(env, id);
  if (!o) return { ok: false, status: 404, error: 'order_not_found' };
  const c = await ensureCaseForOrder(env, id);
  if (c && c.track !== 'legacy_v1') return { ok: false, status: 409, error: 'case_not_legacy' };
  if (!(PACKET_FROM as readonly string[]).includes(o.status)) return { ok: false, status: 409, error: 'order_not_awaiting_packet' };
  const docId = Number(documentId);
  if (!Number.isInteger(docId) || docId <= 0) return { ok: false, status: 400, error: 'document_id_required' };
  const doc = await env.DB.prepare(PROJECT_DOC).bind(docId, o.project_id).first();
  if (!doc) return { ok: false, status: 400, error: 'document_not_on_project' };
  if (!c) return { ok: false, status: 409, error: 'order_not_awaiting_packet' };
  const t = await transition(env, c.id, 'ready_to_file', { party: 'hq', userId: adminId, email: adminEmail }, {
    orderSet: { packet_document_id: docId, packet_ready_by: adminId }, orderNow: ['packet_ready_at'],
    detail: { step: 'packet_ready', document_id: docId },
  });
  if (!t.ok) return { ok: false, status: 409, error: 'order_not_awaiting_packet' };
  return { ok: true, id, status: 'packet_ready' };
}

/** "Filed with the state": the date the filing was submitted. */
export async function markFiled(
  env: Env, id: number, filedOn: unknown, adminId: number, today = new Date().toISOString().slice(0, 10), adminEmail?: string,
): Promise<FilingResult> {
  await ensureIncorporationsSchema(env);
  const o = await order(env, id);
  if (!o) return { ok: false, status: 404, error: 'order_not_found' };
  const c = await ensureCaseForOrder(env, id);
  if (c && c.track !== 'legacy_v1') return { ok: false, status: 409, error: 'case_not_legacy' };
  if (o.status !== 'packet_ready') return { ok: false, status: 409, error: 'packet_not_ready' };
  if (!isCalendarDate(filedOn)) return { ok: false, status: 400, error: 'filed_on_invalid' };
  if (filedOn > today) return { ok: false, status: 400, error: 'filed_on_future' };
  const paidDay = o.paid_at ? String(o.paid_at).slice(0, 10) : null;
  if (paidDay && filedOn < paidDay) return { ok: false, status: 400, error: 'filed_on_before_payment' };
  if (!c) return { ok: false, status: 409, error: 'packet_not_ready' };
  // D1415 Part 3 (#3855): one batch, the transition's order update first, then the company statements,
  // each guarded by "filed and not yet linked" (`incorporationCompany.ts`). A repeat changes nothing;
  // a failure leaves the order and the case as they were (D6686).
  const facts = await env.DB.prepare(ORDER_FACTS).bind(id).first<any>();
  const { statements, outcome } = await filingCompanyStatements(env, facts, filedOn, adminId);
  const t = await transition(env, c.id, 'registered', { party: 'hq', userId: adminId, email: adminEmail }, {
    orderSet: { filed_on: filedOn, filed_by: adminId }, orderNow: ['filed_recorded_at'], extra: statements,
    detail: { step: 'filed', filed_on: filedOn },
  });
  if (!t.ok) return { ok: false, status: 409, error: 'packet_not_ready' };
  // #3850 (E6): the venture moved into its new company in that batch; its in-flight agent runs end `scope_moved`.
  if (outcome && (outcome as { created?: boolean }).created && facts?.project_id) {
    const made = await env.DB.prepare('SELECT id FROM company_profiles WHERE uid = ?').bind((outcome as { uid: string }).uid).first<{ id: number }>();
    if (made) await afterMove(env, { projectId: Number(facts.project_id), from: null, to: Number(made.id), actorUserId: adminId });
  }
  return { ok: true, id, status: 'filed', company: outcome };
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
