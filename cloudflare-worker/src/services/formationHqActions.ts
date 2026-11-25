/** D6698 (#6698) — HQ case writes, their registry evidence, attribution and transaction guards. */
import type { Env, User } from '../types';
import { isSuperAdmin } from '../auth';
import { adminAuditStatement, logAdminAction } from './adminAudit';
import { assignmentStatements, formationOwnerStatements } from './approvalAssignments';
import { caseWriteBatch, type Actor } from './formationCase';
import { readCaseByUid, PARTIES } from './formationQueue';
import { addNote, notifyCaseStage, openRequest } from './formationRequests';
import { acceptFiling, answerQuery, confirmPartnerRegistration, queryFiling, recordLegacyRegistration, rejectFiling, submitFiling, withdrawFiling } from './formationFilings';
import type { RegisteredAddress } from './incorporationCompany';

type Body = Record<string, unknown>;
type Case = NonNullable<Awaited<ReturnType<typeof readCaseByUid>>>;
type Writer = Actor & { userId: number; hqWrite: NonNullable<Actor['hqWrite']> };
type Refusal = { ok: false; status: 400 | 403 | 404 | 409; error: string };
type Result = { ok: true; [key: string]: unknown } | Refusal;
const fail = (status: Refusal['status'], error: string): Refusal => ({ ok: false, status, error });
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const reasonOf = (v: unknown) => typeof v === 'string' && v.trim().length <= 2000 ? v.trim() : '';
export const HQ_ACTIONS = ['assign', 'requests', 'notes', 'filing-events', 'confirm-registration', 'hold', 'release', 'cancel', 'refund-review', 'legacy-correction'] as const;
export type HqAction = typeof HQ_ACTIONS[number];

function receipt(env: Env, kase: Case, writer: Writer, kind: string, detail: Body = {}) {
  return env.DB.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json)
    VALUES (?, ?, 'hq', ?, 'hq_only', ?)`).bind(kase.id, writer.userId, kind, JSON.stringify({ ...detail, ...writer.hqWrite.attribution }));
}

function scopedDocument(env: Env, kase: Case, id: number) {
  return env.DB.prepare(`SELECT id FROM documents d WHERE id = ? AND (
    (d.project_id IS NOT NULL AND d.project_id = ?) OR (d.company_id IS NOT NULL AND d.company_id = ?)
    OR (d.project_id IS NULL AND d.company_id IS NULL AND d.uploaded_by = ?)
    OR EXISTS (SELECT 1 FROM formation_case_documents cd WHERE cd.case_id = ? AND cd.document_id = d.id)
  )`).bind(id, kase.project_id, kase.company_id, kase.user_id, kase.id).first();
}

async function registryAction(env: Env, kase: Case, action: HqAction, body: Body, actor: Writer): Promise<Result> {
  for (const value of [body.evidence_document_id, body.certificate_document_id]) {
    if (value != null && (!positive(value) || !await scopedDocument(env, kase, value))) return fail(400, 'document_not_on_case');
  }
  const address = body.address;
  if (address != null && (typeof address !== 'object' || Array.isArray(address)
    || Object.values(address).some(v => v != null && typeof v !== 'string'))) return fail(400, 'address_invalid');
  const acceptance = { decidedOn: body.registry_date, registrationNumber: body.registration_number,
    certificateDocumentId: body.certificate_document_id, address: address as RegisteredAddress | null, evidenceDocumentId: body.evidence_document_id };
  if (action === 'legacy-correction') {
    actor.hqWrite.receipts.push(receipt(env, kase, actor, 'legacy_registration_corrected'));
    const r = await recordLegacyRegistration(env, kase.id, acceptance, actor);
    return r.ok ? { ok: true, filing_uid: r.filing.uid } : r;
  }
  if (typeof body.filing_uid !== 'string') return fail(400, 'filing_uid_required');
  const f = await env.DB.prepare('SELECT id, uid, revision FROM formation_filings WHERE case_id = ? AND uid = ?')
    .bind(kase.id, body.filing_uid).first<{ id: number; uid: string; revision: number }>();
  if (!f) return fail(404, 'filing_not_found');
  actor.hqWrite.guards.push(env.DB.prepare(`SELECT CASE WHEN EXISTS (
    SELECT 1 FROM formation_filings WHERE id = ? AND case_id = ? AND revision = ?
  ) THEN 1 ELSE abs(-9223372036854775808) END`).bind(f.id, kase.id, f.revision));
  const detail = { filing_uid: f.uid, event: action === 'confirm-registration' ? 'confirmed' : body.event };
  Object.assign(actor.hqWrite.attribution, { filing_uid: f.uid });
  actor.hqWrite.receipts.push(receipt(env, kase, actor, action === 'confirm-registration' ? 'registration_confirmed' : 'partner_filing_event', detail));
  if (action === 'confirm-registration') {
    const r = await confirmPartnerRegistration(env, f.id, actor);
    return r.ok ? { ok: true, filing_uid: f.uid, stage: r.case?.stage } : r;
  }
  const date = { occurredOn: body.occurred_on, evidenceDocumentId: body.evidence_document_id };
  let r;
  switch (body.event) {
    case 'submitted': r = await submitFiling(env, f.id, { submittedOn: body.submitted_on, reference: body.reference, evidenceDocumentId: body.evidence_document_id }, actor); break;
    case 'queried': r = await queryFiling(env, f.id, { ...date, note: body.note }, actor); break;
    case 'answered': r = await answerQuery(env, f.id, date, actor); break;
    case 'accepted': r = await acceptFiling(env, f.id, acceptance, actor, undefined, true); break;
    case 'rejected': r = await rejectFiling(env, f.id, { decidedOn: body.registry_date, reason: body.rejection_reason, evidenceDocumentId: body.evidence_document_id }, actor); break;
    case 'withdrawn': r = await withdrawFiling(env, f.id, { reason: body.reason }, actor); break;
    default: return fail(400, 'filing_event_invalid');
  }
  return r.ok ? { ok: true, filing_uid: f.uid, state: r.filing.state, ...(r.case ? { stage: r.case.stage } : {}) } : r;
}

async function caseAction(env: Env, kase: Case, action: HqAction, b: Body, actor: Writer): Promise<Result> {
  const db = env.DB;
  switch (action) {
    case 'requests': {
      // Partner accounts belong to P2. A request cannot direct a notice carrying case data to an unrelated account.
      if (b.asked_of_user_id != null && (b.asked_of !== 'founder' || b.asked_of_user_id !== kase.user_id)) return fail(400, 'asked_of_user_invalid');
      const r = await openRequest(env, kase.id, { askedOf: b.asked_of, askedOfUserId: b.asked_of_user_id, kind: b.kind, title: b.title,
        body: b.body, dueOn: b.due_on, filingId: b.filing_id, boundSha256: b.bound_sha256 }, actor);
      return r.ok ? { ok: true, request_uid: r.request.uid } : r;
    }
    case 'notes': return addNote(env, kase.id, { text: b.text, visibility: b.visibility }, actor);
    case 'legacy-correction':
    case 'filing-events':
    case 'confirm-registration': return registryAction(env, kase, action, b, actor);
    case 'assign': {
      if (!positive(b.owner_user_id) || !await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'admin' AND is_active = 1").bind(b.owner_user_id).first()) return fail(400, 'active_hq_owner_required');
      if (kase.hq_owner_user_id === b.owner_user_id) return fail(409, 'owner_unchanged');
      actor.hqWrite.guards.push(db.prepare("SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND is_active = 1) THEN 1 ELSE abs(-9223372036854775808) END").bind(b.owner_user_id));
      await caseWriteBatch(env, actor, [
        ...formationOwnerStatements(env, kase.id, b.owner_user_id, actor.userId),
        ...assignmentStatements(env, 'formation_cases', kase.id, b.owner_user_id, actor.userId),
      ], 0);
      break;
    }
    case 'hold': {
      if (kase.hold_reason) return fail(409, 'case_on_hold');
      if (reasonOf(b.reason) === 'restricted_place') return fail(400, 'invalid_hold_reason');
      if (!(PARTIES as readonly unknown[]).includes(b.waiting_on)) return fail(400, 'waiting_on_invalid');
      actor.hqWrite.receipts.push(receipt(env, kase, actor, 'case_held', { prior_waiting_on: kase.waiting_on }));
      await caseWriteBatch(env, actor, [db.prepare("UPDATE formation_cases SET hold_reason = ?, waiting_on = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(actor.hqWrite.attribution.reason, b.waiting_on, kase.id)], 0);
      break;
    }
    case 'release': {
      if (!kase.hold_reason) return fail(409, 'case_not_on_hold');
      const hold = await db.prepare(`SELECT kind, json_extract(detail_json, '$.reason') AS reason
        FROM formation_case_events WHERE case_id = ? AND kind IN ('case_held', 'case_released') ORDER BY id DESC LIMIT 1`)
        .bind(kase.id).first<{ kind: string; reason: string }>();
      if (kase.hold_reason === 'restricted_place' || hold?.kind !== 'case_held' || hold.reason !== kase.hold_reason) return fail(409, 'hold_requires_review');
      actor.hqWrite.receipts.push(receipt(env, kase, actor, 'case_released'));
      await caseWriteBatch(env, actor, [db.prepare(`UPDATE formation_cases SET hold_reason = NULL, updated_at = datetime('now'),
        waiting_on = COALESCE((SELECT CASE WHEN state = 'answered' THEN asked_by_party ELSE asked_of_party END FROM formation_case_requests
          WHERE case_id = formation_cases.id AND state IN ('open','returned','answered') ORDER BY id DESC LIMIT 1),
        (SELECT json_extract(detail_json, '$.prior_waiting_on') FROM formation_case_events WHERE case_id = formation_cases.id AND kind = 'case_held' ORDER BY id DESC LIMIT 1), waiting_on)
        WHERE id = ?`).bind(kase.id)], 0);
      break;
    }
    case 'cancel': {
      actor.hqWrite.receipts.push(receipt(env, kase, actor, 'case_cancelled'));
      await caseWriteBatch(env, actor, [db.prepare("UPDATE formation_cases SET closed_at = datetime('now'), close_reason = 'cancelled', waiting_on = 'nobody', updated_at = datetime('now') WHERE id = ?").bind(kase.id)], 0);
      break;
    }
    case 'refund-review': {
      const eligible = await db.prepare(`SELECT
        (SELECT state FROM formation_filings WHERE case_id = ? AND kind = 'incorporation' ORDER BY attempt DESC LIMIT 1) AS filing_state,
        EXISTS (SELECT 1 FROM formation_case_events WHERE case_id = ? AND kind = 'refund_review_requested') AS requested`)
        .bind(kase.id, kase.id).first<{ filing_state: string | null; requested: number }>();
      if (eligible?.filing_state !== 'rejected') return fail(409, 'registry_rejection_required');
      if (eligible.requested) return fail(409, 'refund_review_already_requested');
      const order = await db.prepare(`SELECT i.id, i.stripe_payment_intent FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id
        WHERE o.case_id = ? AND i.paid_at IS NOT NULL AND i.stripe_payment_intent IS NOT NULL ORDER BY o.id DESC LIMIT 1`).bind(kase.id).first<{ id: number; stripe_payment_intent: string }>();
      if (!order) return fail(409, 'paid_order_required');
      // The review belongs to Billing and only its separate confirmation can move money.
      const sent = db.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json)
        SELECT ?, ?, 'hq', 'refund_review_requested', 'hq_only', ? WHERE (
          SELECT state FROM formation_filings WHERE case_id = ? AND kind = 'incorporation' ORDER BY attempt DESC LIMIT 1
        ) = 'rejected' AND NOT EXISTS (SELECT 1 FROM formation_case_events WHERE case_id = ? AND kind = 'refund_review_requested')
          AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND stripe_payment_intent = ? AND paid_at IS NOT NULL)`)
        .bind(kase.id, actor.userId, JSON.stringify({ ...actor.hqWrite.attribution, order_id: order.id }), kase.id, kase.id, order.id, order.stripe_payment_intent);
      await caseWriteBatch(env, actor, [sent], 0);
      return { ok: true, review: { path: '/api/admin/billing/refund/review', payment_intent: order.stripe_payment_intent } };
    }
  }
  return { ok: true };
}

export async function writeHqCase(env: Env, admin: User, uid: string, action: HqAction, body: Body): Promise<Result> {
  const kase = await readCaseByUid(env, uid);
  if (!kase) return fail(404, 'case_not_found');
  // Only the owner or Super Admin handles private evidence. An unassigned case can be claimed from the queue.
  if (!isSuperAdmin(admin) && kase.hq_owner_user_id !== admin.id && !(action === 'assign' && kase.hq_owner_user_id == null)) return fail(403, 'case_owner_required');
  if (kase.closed_at && !(action === 'refund-review' && ['cancelled', 'rejected'].includes(kase.close_reason ?? ''))) return fail(409, 'case_closed');
  if (body.expected_revision !== undefined && body.expected_revision !== kase.revision) return fail(409, 'case_moved');
  if (kase.hold_reason && ['filing-events','confirm-registration'].includes(action)) return fail(409, 'case_on_hold');
  const reason = reasonOf(body.reason);
  if (action === 'assign' && body.recorded_for_partner_id != null) return fail(400, 'owner_assigned_by_hq');
  const onBehalf = action === 'filing-events' || action === 'confirm-registration';
  if ((onBehalf || ['hold', 'cancel', 'refund-review', 'legacy-correction'].includes(action) || body.recorded_for_partner_id != null) && !reason) return fail(400, 'reason_required');
  if (onBehalf && !positive(body.recorded_for_partner_id)) return fail(400, 'recorded_for_partner_required');
  if (body.recorded_for_partner_id != null && (!positive(body.recorded_for_partner_id) || kase.partner_id !== body.recorded_for_partner_id)) return fail(409, 'partner_not_assigned');
  const attribution: Body = { partner_id: kase.partner_id, ...(body.recorded_for_partner_id != null ? { recorded_for_partner_id: body.recorded_for_partner_id } : {}), ...(reason ? { reason } : {}) };
  const guard = env.DB.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND stage = ? AND revision = ?
    AND closed_at IS ? AND partner_id IS ? AND hq_owner_user_id IS ? AND hold_reason IS ? AND waiting_on = ?)
    THEN 1 ELSE abs(-9223372036854775808) END`).bind(kase.id, kase.stage, kase.revision, kase.closed_at, kase.partner_id, kase.hq_owner_user_id, kase.hold_reason, kase.waiting_on);
  const name = 'formation_hq_' + action.replaceAll('-', '_');
  const details = { case_uid: kase.uid, ...attribution, ...(typeof body.filing_uid === 'string' ? { filing_uid: body.filing_uid } : {}),
    ...(action === 'assign' ? { owner_user_id: body.owner_user_id } : {}), ...(action === 'filing-events' ? { event: body.event } : {}) };
  const actor: Writer = { party: 'hq', userId: admin.id, email: admin.email, hqWrite: {
    attribution, guards: [guard], receipts: [adminAuditStatement(env, admin.id, name, details)],
  } };
  try {
    const result = await caseAction(env, kase, action, body, actor);
    if (result.ok) {
      await logAdminAction(env, admin.id, admin.email ?? '', name, details, { adminAuditAlreadyRecorded: true });
      if (typeof result.stage === 'string') await notifyCaseStage(env, kase, result.stage);
    }
    return result;
  } catch (e) {
    if (/integer overflow/i.test(String(e))) return fail(409, 'case_moved');
    throw e;
  }
}
