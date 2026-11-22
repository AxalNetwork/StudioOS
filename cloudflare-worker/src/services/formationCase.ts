/**
 * D6686 (#6686, E6 of #6680) — the formation case: the one writer of a case's
 * stage and of the order status that stage projects to.
 *
 * A case has a stage from STAGES, a party it is waiting on, a revision and an
 * append-only timeline (formation_case_events). `transition` moves a case one
 * stage in a single D1 batch of three statements, all guarded on the same
 * precondition: the case at the stage and revision that was read, and its
 * order at the status that was read.
 *
 *   1. INSERT the event, WHERE the precondition holds. It carries to_revision,
 *      and (case_id, to_revision) is unique.
 *   2. UPDATE the order's status (and any order fields the caller sets), WHERE
 *      the precondition holds.
 *   3. UPDATE the case, WHERE it is still at that stage and revision AND the
 *      event of step 1 exists.
 *
 * Nothing between the statements changes the case or the order, so either the
 * precondition held and all three write, or it did not and none does. The
 * service reads `meta.changes` on step 3 and answers 409 when the case did not
 * move. Hold (`hold_reason`, `waiting_on`) and closing never change the order
 * status.
 *
 * Legacy orders (track legacy_v1) get their case from the backfill migration,
 * or from `ensureCaseForOrder` for an order paid after it ran. The case uid is
 * `fc_legacy_<order id>` on both paths, so the two cannot make two cases.
 */
import type { Env } from '../types';
import { ensureIncorporationsSchema } from './incorporations';
import { logAdminAction } from './adminAudit';

export const STAGES = [
  'draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted',
  'paid', 'preparing', 'ready_to_file', 'submitted', 'registry_query',
  'registered', 'activating', 'handed_off',
] as const;
export type Stage = typeof STAGES[number];

export type OrderStatus = 'pending_payment' | 'paid' | 'packet_processing' | 'packet_ready' | 'filed';

/** The order status a stage projects to. Every stage before paid is pending_payment. */
export function statusForStage(stage: Stage): OrderStatus {
  switch (stage) {
    case 'paid': return 'paid';
    case 'preparing': return 'packet_processing';
    case 'ready_to_file': case 'submitted': case 'registry_query': return 'packet_ready';
    case 'registered': case 'activating': case 'handed_off': return 'filed';
    default: return 'pending_payment';
  }
}

/** A legacy order's stage, from its status. pending_payment and unknown statuses have no case. */
export const LEGACY_STAGE: Readonly<Record<string, Stage>> = Object.freeze({
  paid: 'paid', packet_processing: 'preparing', packet_ready: 'ready_to_file', filed: 'registered',
});

/** Who a stage waits on, where the stage alone says so. */
/**
 * D6686 part 2 (the owner's answer, 2026-11-16): the stages that keep a
 * formation_case_stages record — every stage but draft through quoted. Entering
 * one opens its row; leaving it marks the row completed, by whom and when.
 */
export const RECORDED_STAGES: readonly Stage[] = ['paid', 'preparing', 'ready_to_file', 'submitted', 'registry_query', 'registered', 'activating', 'handed_off'];
const RECORDED = new Set<string>(RECORDED_STAGES);
/** The role responsible for a recorded stage. */
export const STAGE_ROLE: Readonly<Record<string, string>> = Object.freeze({
  paid: 'hq', preparing: 'hq', ready_to_file: 'hq', submitted: 'registry', registry_query: 'registry',
  registered: 'hq', activating: 'hq', handed_off: 'founder',
});

const WAITING_ON: Partial<Record<Stage, string>> = {
  paid: 'hq', preparing: 'hq', ready_to_file: 'hq',
  submitted: 'registry', registry_query: 'registry', registered: 'nobody',
};
/** D6695: who `stage` waits on where the stage alone says so, else null (formationRequests.ts restores waiting_on with it). */
export function stageWaitingOn(stage: string): string | null {
  return WAITING_ON[stage as Stage] ?? null;
}

export type Party = 'founder' | 'hq' | 'partner' | 'counsel' | 'registry' | 'system';
export interface Actor { party: Party; userId?: number | null; email?: string | null }

export interface CaseRow {
  id: number; uid: string; user_id: number; project_id: number | null; company_id: number | null;
  track: 'legacy_v1' | 'v2'; stage: Stage; revision: number; waiting_on: string; closed_at: string | null;
}

const CASE_COLS = 'c.id, c.uid, c.user_id, c.project_id, c.company_id, c.track, c.stage, c.revision, c.waiting_on, c.closed_at';

// Only these order columns may ride a transition: the D601 hand steps' own record.
const ORDER_FIELDS = new Set(['packet_document_id', 'packet_ready_by', 'filed_on', 'filed_by']);
const ORDER_NOW_FIELDS = new Set(['packet_ready_at', 'filed_recorded_at']);

// The order's new status is chosen from this fixed table of SQL text, one per
// status, never interpolated (D6686: it also keeps the D601 race test's hook,
// which watches for the literal statement).
const SET_STATUS: Readonly<Record<OrderStatus, string>> = Object.freeze({
  pending_payment: "UPDATE incorporations SET status = 'pending_payment'",
  paid: "UPDATE incorporations SET status = 'paid'",
  packet_processing: "UPDATE incorporations SET status = 'packet_processing'",
  packet_ready: "UPDATE incorporations SET status = 'packet_ready'",
  filed: "UPDATE incorporations SET status = 'filed'",
});

// Every statement below is fixed text, assembled once from the fragments
// above; nothing a caller passes reaches the SQL text (check-sql-prepare).
const CASE_BY_ID = 'SELECT ' + CASE_COLS + ' FROM formation_cases c WHERE c.id = ?';
const CASE_BY_ORDER = 'SELECT ' + CASE_COLS + ' FROM formation_case_orders o JOIN formation_cases c ON c.id = o.case_id WHERE o.incorporation_id = ?';
const CASE_AS_READ = 'EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND stage = ? AND revision = ? AND closed_at IS NULL)';
const ORDER_AS_READ = 'EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = ?)';
const EVENT_INSERT_HEAD =
  'INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, from_stage, to_stage, to_revision, visibility, detail_json) '
  + "SELECT ?, ?, ?, 'stage_change', ?, ?, ?, ?, ? WHERE " + CASE_AS_READ;
const EVENT_INSERT_NO_ORDER = EVENT_INSERT_HEAD;
const EVENT_INSERT_WITH_ORDER = EVENT_INSERT_HEAD + ' AND ' + ORDER_AS_READ;
// D6694 (#6694): a transition a filing drives is also guarded on that filing
// still at the state that was read, so a filing changed in between moves nothing.
const FILING_AS_READ = 'EXISTS (SELECT 1 FROM formation_filings WHERE id = ? AND state = ?)';
const EVENT_INSERT_NO_ORDER_FILING = EVENT_INSERT_NO_ORDER + ' AND ' + FILING_AS_READ;
const EVENT_INSERT_WITH_ORDER_FILING = EVENT_INSERT_WITH_ORDER + ' AND ' + FILING_AS_READ;
// The order's D601 fields: a NULL leaves the column as it was; a 1 in a *_now
// slot stamps it with datetime('now').
const ORDER_UPDATE_TAIL =
  ', packet_document_id = COALESCE(?, packet_document_id), packet_ready_by = COALESCE(?, packet_ready_by)'
  + ", packet_ready_at = CASE WHEN ? = 1 THEN datetime('now') ELSE packet_ready_at END"
  + ', filed_on = COALESCE(?, filed_on), filed_by = COALESCE(?, filed_by)'
  + ", filed_recorded_at = CASE WHEN ? = 1 THEN datetime('now') ELSE filed_recorded_at END"
  + ", updated_at = datetime('now') WHERE id = ? AND status = ? AND " + CASE_AS_READ;
const ORDER_UPDATE: Readonly<Record<OrderStatus, string>> = Object.freeze(
  Object.fromEntries(Object.entries(SET_STATUS).map(([k, head]) => [k, head + ORDER_UPDATE_TAIL])) as Record<OrderStatus, string>,
);
// D6694: with filingAsRead the order moves only while the filing is as read, as the event and the case do.
const ORDER_UPDATE_FILING: Readonly<Record<OrderStatus, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ORDER_UPDATE).map(([k, sql]) => [k, sql + ' AND ' + FILING_AS_READ])) as Record<OrderStatus, string>,
);
// Both stage statements run after the case update and are guarded on the case
// being at the new stage and revision, so they write only when the transition did.
const STAGE_AFTER = 'EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND stage = ? AND revision = ?)';
const STAGE_COMPLETE =
  'INSERT INTO formation_case_stages (case_id, stage, responsible_role, completed_by, completed_at) '
  + "SELECT ?, ?, ?, ?, datetime('now') WHERE " + STAGE_AFTER + ' '
  + 'ON CONFLICT(case_id, stage) DO UPDATE SET completed_by = excluded.completed_by, completed_at = excluded.completed_at '
  + 'WHERE formation_case_stages.completed_at IS NULL';
const STAGE_OPEN =
  'INSERT OR IGNORE INTO formation_case_stages (case_id, stage, responsible_role) SELECT ?, ?, ? WHERE ' + STAGE_AFTER;
const STAGE_OPEN_BY_UID =
  'INSERT OR IGNORE INTO formation_case_stages (case_id, stage, responsible_role) SELECT id, stage, ? FROM formation_cases WHERE uid = ? AND stage = ?';

const CASE_UPDATE =
  "UPDATE formation_cases SET stage = ?, stage_entered_at = datetime('now'), revision = revision + 1, "
  + "waiting_on = COALESCE(?, waiting_on), updated_at = datetime('now') "
  + 'WHERE id = ? AND stage = ? AND revision = ? '
  + 'AND EXISTS (SELECT 1 FROM formation_case_events WHERE case_id = ? AND to_revision = ?)';

export function legacyCaseUid(incorporationId: number): string {
  return `fc_legacy_${incorporationId}`;
}

export async function readCase(env: Env, caseId: number): Promise<CaseRow | null> {
  return (await env.DB.prepare(CASE_BY_ID).bind(caseId).first<CaseRow>()) || null;
}

/**
 * The legacy case of a paid order, made if it is missing: for an order paid
 * between the backfill and this deploy, and on every case read. Returns null
 * for an order with no case to have (not found, pending_payment, or a status
 * the backfill does not know). Idempotent: the uid and the order link are
 * unique, and the opening event is written once.
 */
export async function ensureCaseForOrder(env: Env, incorporationId: number): Promise<CaseRow | null> {
  await ensureIncorporationsSchema(env);
  const linked = await env.DB.prepare(
    CASE_BY_ORDER,
  ).bind(incorporationId).first<CaseRow>();
  if (linked) return linked;
  const order = await env.DB.prepare(
    'SELECT id, user_id, project_id, company_id, status, paid_at FROM incorporations WHERE id = ?',
  ).bind(incorporationId).first<{ id: number; user_id: number; project_id: number | null; company_id: number | null; status: string; paid_at: string | null }>();
  if (!order) return null;
  const stage = LEGACY_STAGE[order.status];
  if (!stage) return null;
  const uid = legacyCaseUid(order.id);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO formation_cases (uid, user_id, intent, project_id, company_id, track, stage, waiting_on, revision)
       VALUES (?, ?, 'convert_project', ?, ?, 'legacy_v1', ?, ?, 0)`,
    ).bind(uid, order.user_id, order.project_id ?? null, order.company_id ?? null, stage, WAITING_ON[stage] ?? 'nobody'),
    env.DB.prepare(
      'INSERT OR IGNORE INTO formation_case_orders (case_id, incorporation_id) SELECT id, ? FROM formation_cases WHERE uid = ?',
    ).bind(order.id, uid),
    env.DB.prepare(
      `INSERT INTO formation_case_events (case_id, party, kind, to_stage, visibility, detail_json)
       SELECT id, 'system', 'case_opened', ?, 'hq_only', ? FROM formation_cases
        WHERE uid = ? AND NOT EXISTS (SELECT 1 FROM formation_case_events e WHERE e.case_id = formation_cases.id AND e.kind = 'case_opened')`,
    ).bind(stage, JSON.stringify({ incorporation_id: order.id, status: order.status }), uid),
    // D6686 part 2: the opened case's stage gets its record (every legacy stage is a recorded one).
    env.DB.prepare(STAGE_OPEN_BY_UID).bind(STAGE_ROLE[stage] ?? null, uid, stage),
  ]);
  return (await env.DB.prepare(
    CASE_BY_ORDER,
  ).bind(incorporationId).first<CaseRow>()) || null;
}

export interface TransitionPayload {
  /** Fields of the D601 hand steps written on the order in the same batch. */
  orderSet?: Record<string, unknown>;
  /** Order columns stamped with datetime('now') in the same batch. */
  orderNow?: string[];
  /** Statements run after the three, in the same batch (D1415's company link). */
  extra?: D1PreparedStatement[];
  detail?: Record<string, unknown>;
  visibility?: 'all' | 'hq_partner' | 'hq_only';
  /** D6694: move only while this filing is still at this state (formationFilings.ts). */
  filingAsRead?: { id: number; state: string };
  /** D6694: move only from this revision, the one the caller read and built its `extra` statements on. */
  expectRevision?: number;
}

export type TransitionResult =
  | { ok: true; caseId: number; from: Stage; to: Stage; revision: number; status: OrderStatus | null; results: D1Result[] }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** Move a case to `to`. The only writer of a case's stage and of its order's status. */
export async function transition(
  env: Env, caseId: number, to: Stage, actor: Actor, payload: TransitionPayload = {},
): Promise<TransitionResult> {
  await ensureIncorporationsSchema(env);
  if (!(STAGES as readonly string[]).includes(to)) return { ok: false, status: 400, error: 'unknown_stage' };
  const c = await readCase(env, caseId);
  if (!c) return { ok: false, status: 404, error: 'case_not_found' };
  if (c.closed_at) return { ok: false, status: 409, error: 'case_closed' };
  if (c.stage === to) return { ok: false, status: 409, error: 'case_already_at_stage' };
  if (payload.expectRevision !== undefined && c.revision !== payload.expectRevision) return { ok: false, status: 409, error: 'case_moved' };
  for (const k of Object.keys(payload.orderSet || {})) if (!ORDER_FIELDS.has(k)) throw new Error(`transition: order field ${k} is not allowed`);
  for (const k of payload.orderNow || []) if (!ORDER_NOW_FIELDS.has(k)) throw new Error(`transition: order field ${k} is not allowed`);

  const order = await env.DB.prepare(
    `SELECT i.id, i.status FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id
      WHERE o.case_id = ? ORDER BY o.id DESC LIMIT 1`,
  ).bind(c.id).first<{ id: number; status: string }>();
  const toStatus = order ? statusForStage(to) : null;
  const nextRevision = c.revision + 1;

  // The precondition: the case as read, and its order at the status read.
  const caseBinds = [c.id, c.stage, c.revision];
  const orderBinds = order ? [order.id, order.status] : [];

  const statements: D1PreparedStatement[] = [];
  const filing = payload.filingAsRead;
  const eventSql = filing
    ? (order ? EVENT_INSERT_WITH_ORDER_FILING : EVENT_INSERT_NO_ORDER_FILING)
    : (order ? EVENT_INSERT_WITH_ORDER : EVENT_INSERT_NO_ORDER);
  statements.push(env.DB.prepare(eventSql).bind(
    c.id, actor.userId ?? null, actor.party, c.stage, to, nextRevision, payload.visibility ?? 'hq_only',
    JSON.stringify({ ...(payload.detail || {}), incorporation_id: order?.id ?? null, status_from: order?.status ?? null, status_to: toStatus }),
    ...caseBinds, ...orderBinds, ...(filing ? [filing.id, filing.state] : []),
  ));
  const set = payload.orderSet || {};
  const now = new Set(payload.orderNow || []);
  if (order && toStatus && (toStatus !== order.status || Object.keys(set).length || now.size)) {
    statements.push(env.DB.prepare((filing ? ORDER_UPDATE_FILING : ORDER_UPDATE)[toStatus]).bind(
      set.packet_document_id ?? null, set.packet_ready_by ?? null, now.has('packet_ready_at') ? 1 : 0,
      set.filed_on ?? null, set.filed_by ?? null, now.has('filed_recorded_at') ? 1 : 0,
      order.id, order.status, ...caseBinds, ...(filing ? [filing.id, filing.state] : []),
    ));
  }
  const caseIndex = statements.length;
  statements.push(env.DB.prepare(CASE_UPDATE).bind(to, WAITING_ON[to] ?? null, c.id, c.stage, c.revision, c.id, nextRevision));
  const after = [c.id, to, nextRevision];
  if (RECORDED.has(c.stage)) statements.push(env.DB.prepare(STAGE_COMPLETE).bind(c.id, c.stage, STAGE_ROLE[c.stage], actor.userId ?? null, ...after));
  if (RECORDED.has(to)) statements.push(env.DB.prepare(STAGE_OPEN).bind(c.id, to, STAGE_ROLE[to], ...after));
  statements.push(...(payload.extra || []));

  const results = await env.DB.batch(statements);
  if (!(Number(results[caseIndex]?.meta?.changes ?? 0) > 0)) return { ok: false, status: 409, error: 'case_moved' };

  if (actor.party === 'hq' && actor.userId && actor.email) {
    await logAdminAction(env, actor.userId, actor.email, 'formation_case_transition', {
      case_uid: c.uid, from: c.stage, to, revision: nextRevision, incorporation_id: order?.id ?? null,
    });
  }
  return { ok: true, caseId: c.id, from: c.stage, to, revision: nextRevision, status: toStatus, results };
}
