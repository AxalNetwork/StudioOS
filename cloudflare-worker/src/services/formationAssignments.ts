/**
 * D6710 (#6710, P2 of #6680) — offering a formation case to a partner firm,
 * reassigning it, and the check that scopes a firm's staff to its own cases.
 *
 * WHO MAY BE OFFERED A CASE (`eligiblePartners`). A firm with a coverage row
 * for the case's country, form and the service, and: verified; that coverage
 * switched on; a licence for the country valid through today; a signed data
 * agreement; none of its restricted places among the case's countries (the
 * form's country and each current person's residence). A restricted place that
 * is not a two-letter country code cannot be compared and refuses the firm
 * (`restricted_places_unreadable`) until HQ records it as a code. The eligible
 * firms are ordered by coverage priority, then open cases, then measured
 * turnaround (the mean hours from acceptance to completion of the firm's
 * completed assignments; null, "not recorded", when it has none, and last).
 *
 * OFFER (`offerCase`) and REASSIGN (`reassignCase`) are HQ writes: the case's
 * HQ owner or a Super Admin. Each re-screens the case's people first
 * (`screenFormationCase(env, id, 'offer', actor, revision)`, #6705) and refuses
 * on a hold, on missing people and on lists it cannot read. The write is one
 * batch guarded on the case revision it read and the firm's eligibility, with
 * a case event, an admin-audit row and an activity row naming the user and
 * the firm.
 *
 * REASSIGNMENT ends the old firm's access in the same batch: its assignment
 * becomes `withdrawn`, the case's `partner_id` is cleared (so #6705's
 * `sharingAllowed` fails for it at once), and a deletion or return request is
 * recorded for it in `formation_partner_notices`. The new firm gets an offer.
 * Consents name a firm (`formation_case_consents.partner_id`), so the new firm
 * reads no people or documents until the founder gives a consent naming it.
 *
 * NOTICE WORDING. Counsel-approved wording for the request to the old firm is
 * pending (#6710, #6705). `PARTNER_NOTICE_WORDING` is null: the request is
 * recorded with `delivery = 'awaiting_counsel'` and nothing is sent. Do not
 * put wording here without counsel's approval.
 *
 * ACCESS (`canAccessFormationCase`). A partner-licensed user with a live
 * `formation_partner_members` row for a verified firm holding a live
 * assignment on an open case: 'full' when accepted (and, for the formation
 * service, the case names that firm), 'redacted' while offered and unexpired,
 * otherwise null. Reading people or documents also needs #6705's sharing gate
 * (`canReadFormationPeople`). The partner-facing routes are #6711's.
 *
 * EXPIRY (`expireOffers`, the scheduled handler). An offer past `expires_at`
 * becomes `expired` with a `partner_offer_expired` event, and the case shows in
 * HQ's 'unassigned' view again (formationQueue.ts `partner_offer_state`).
 */
import type { Env, User } from '../types';
import { isSuperAdmin } from '../auth';
import { holdsLicence } from './accountLicences';
import { adminAuditStatement, logAdminAction } from './adminAudit';
import { SERVICES, parsePlaces } from './formationPartners';
import { sharingAllowed } from './formationPeople';
import { readCaseByUid } from './formationQueue';
import { screenFormationCase } from './formationScreening';

export type Service = typeof SERVICES[number];
export const ASSIGNMENT_STATES = ['offered', 'accepted', 'declined', 'expired', 'withdrawn', 'completed'] as const;
export const NOTICE_KINDS = ['deletion_request', 'return_request'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];
export const OFFER_HOURS_DEFAULT = 72;
export const OFFER_HOURS_MAX = 14 * 24;
/** Stages before payment: an accepted assignment moves such a case to the v2 track. */
const PRE_PAID = ['draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted'];

/**
 * Counsel-approved wording for the deletion or return request to a firm whose
 * assignment ended. PLACEHOLDER: null until counsel approves wording, so no
 * request is sent and each is recorded as `awaiting_counsel`.
 */
export const PARTNER_NOTICE_WORDING: ((kind: NoticeKind, partnerName: string) => string) | null = null;

type Refusal = { ok: false; status: 400 | 403 | 404 | 409 | 503; error: string; detail?: Record<string, unknown> };
const fail = (status: Refusal['status'], error: string, detail?: Record<string, unknown>): Refusal =>
  ({ ok: false, status, error, ...(detail ? { detail } : {}) });
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** A Date as SQLite's UTC text, 'YYYY-MM-DD HH:MM:SS', which compares as text. */
export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

type Case = NonNullable<Awaited<ReturnType<typeof readCaseByUid>>>;

/** The case's countries: the form's country and each current person's residence, upper case. */
export async function caseCountries(env: Env, kase: { id: number; country: string | null }): Promise<string[]> {
  const r = await env.DB.prepare(
    'SELECT DISTINCT upper(residence_country) AS c FROM formation_case_people WHERE case_id = ? AND removed_at IS NULL AND residence_country IS NOT NULL',
  ).bind(kase.id).all<{ c: string }>();
  const out = new Set<string>();
  if (kase.country) out.add(kase.country.toUpperCase());
  for (const row of r.results || []) if (row.c) out.add(row.c);
  return [...out].sort();
}

export interface Candidate {
  formation_partner_id: number; uid: string; partner_id: number; name: string;
  eligible: boolean; refusal: string | null;
  priority: number; target_hours: number | null; open_cases: number;
  turnaround_hours: number | null; completed_cases: number; credential_valid_until: string | null;
}

/** Every firm with coverage for the case's country, form and service, each with why it may not be offered, eligible first. */
export async function eligiblePartners(env: Env, kase: Case, service: Service, now: Date): Promise<Candidate[]> {
  if (!kase.country || !kase.form_key) return [];
  const today = sqlTime(now).slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT f.id, f.uid, f.partner_id, p.name, f.status, f.dpa_signed_on, f.restricted_places_json,
            v.is_on, v.priority, v.target_hours,
            (SELECT max(valid_until) FROM formation_partner_credentials WHERE formation_partner_id = f.id AND country = v.country) AS valid_until,
            (SELECT count(*) FROM formation_case_assignments WHERE formation_partner_id = f.id AND state IN ('offered', 'accepted')) AS open_cases,
            (SELECT count(*) FROM formation_case_assignments WHERE formation_partner_id = f.id AND state = 'completed'
                AND decided_at IS NOT NULL AND ended_at IS NOT NULL) AS completed_cases,
            (SELECT avg((julianday(ended_at) - julianday(decided_at)) * 24) FROM formation_case_assignments
              WHERE formation_partner_id = f.id AND state = 'completed' AND decided_at IS NOT NULL AND ended_at IS NOT NULL) AS turnaround
       FROM formation_partner_coverage v
       JOIN formation_partners f ON f.id = v.formation_partner_id
       JOIN partners p ON p.id = f.partner_id
      WHERE v.country = ? AND v.form_key = ? AND v.service = ?`,
  ).bind(kase.country, kase.form_key, service).all<any>();
  const countries = await caseCountries(env, kase);
  const out: Candidate[] = (rows.results || []).map((r: any) => {
    const places = parsePlaces(r.restricted_places_json).map((p) => p.trim().toUpperCase());
    let refusal: string | null = null;
    if (r.status !== 'verified') refusal = 'partner_not_verified';
    else if (Number(r.is_on) !== 1) refusal = 'coverage_off';
    else if (!r.valid_until) refusal = 'credential_missing';
    else if (String(r.valid_until) < today) refusal = 'credential_expired';
    else if (!r.dpa_signed_on) refusal = 'dpa_missing';
    else if (places.some((p) => !/^[A-Z]{2}$/.test(p))) refusal = 'restricted_places_unreadable';
    else if (places.some((p) => countries.includes(p))) refusal = 'restricted_place';
    return {
      formation_partner_id: Number(r.id), uid: r.uid, partner_id: Number(r.partner_id), name: r.name,
      eligible: refusal == null, refusal,
      priority: Number(r.priority), target_hours: r.target_hours == null ? null : Number(r.target_hours),
      open_cases: Number(r.open_cases),
      turnaround_hours: r.turnaround == null ? null : Math.round(Number(r.turnaround) * 10) / 10,
      completed_cases: Number(r.completed_cases),
      credential_valid_until: r.valid_until ?? null,
    };
  });
  const t = (c: Candidate) => c.turnaround_hours ?? Number.POSITIVE_INFINITY;
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.priority - b.priority
    || a.open_cases - b.open_cases || t(a) - t(b) || a.name.localeCompare(b.name) || a.formation_partner_id - b.formation_partner_id);
}

/** A batch guard: aborts the batch unless the firm is still eligible for this coverage today. */
function eligibilityGuard(env: Env, formationPartnerId: number, kase: Case, service: Service, now: Date) {
  return env.DB.prepare(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM formation_partners f
        JOIN formation_partner_coverage v ON v.formation_partner_id = f.id AND v.country = ? AND v.form_key = ? AND v.service = ? AND v.is_on = 1
       WHERE f.id = ? AND f.status = 'verified' AND f.dpa_signed_on IS NOT NULL
         AND EXISTS (SELECT 1 FROM formation_partner_credentials cr WHERE cr.formation_partner_id = f.id AND cr.country = v.country AND cr.valid_until >= ?))
     THEN 1 ELSE abs(-9223372036854775808) END`,
  ).bind(kase.country, kase.form_key, service, formationPartnerId, sqlTime(now).slice(0, 10));
}

/** A batch guard: aborts the batch unless the case is open, not held and at the revision read. */
function caseGuard(env: Env, kase: Case) {
  return env.DB.prepare(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND revision = ? AND closed_at IS NULL AND hold_reason IS NULL
       AND track = 'v2' AND partner_id IS ?) THEN 1 ELSE abs(-9223372036854775808) END`,
  ).bind(kase.id, kase.revision, kase.partner_id);
}

function event(env: Env, caseId: number, actor: number | null, party: 'hq' | 'partner' | 'system', kind: string, detail: Record<string, unknown>, onlyIfChanged = false) {
  const args = [caseId, actor, party, kind, JSON.stringify(detail)];
  return onlyIfChanged
    ? env.DB.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json)
        SELECT ?, ?, ?, ?, 'hq_only', ? WHERE changes() = 1`).bind(...args)
    : env.DB.prepare(`INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json)
        VALUES (?, ?, ?, ?, 'hq_only', ?)`).bind(...args);
}

function activity(env: Env, actor: number | null, action: string, detail: Record<string, unknown>, onlyIfChanged = false) {
  const args = [actor, action, JSON.stringify(detail)];
  return onlyIfChanged
    ? env.DB.prepare('INSERT INTO activity_logs (user_id, action, details) SELECT ?, ?, ? WHERE changes() = 1').bind(...args)
    : env.DB.prepare('INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)').bind(...args);
}

function offerInsert(env: Env, kase: Case, c: Candidate, service: Service, actor: number, expiresAt: string, replaces: number | null) {
  return env.DB.prepare(
    `INSERT INTO formation_case_assignments (case_id, formation_partner_id, partner_id, service, offered_by, expires_at, replaces_assignment_id)
     SELECT ?, f.id, f.partner_id, ?, ?, ?, ? FROM formation_partners f WHERE f.id = ?`,
  ).bind(kase.id, service, actor, expiresAt, replaces, c.formation_partner_id);
}

interface WriteBody { formation_partner_uid?: unknown; service?: unknown; expires_in_hours?: unknown; expected_revision?: unknown; reason?: unknown; notice_kind?: unknown }

type Prepared = { ok: true; kase: Case; service: Service; target: Candidate; expiresAt: string; reason: string };

/** The checks offer and reassign share, up to and including the re-screen. */
async function prepare(
  env: Env, admin: User, uid: string, b: WriteBody, now: Date, needReason: boolean,
  beforeScreen: (kase: Case, service: Service, target: Candidate) => Promise<Refusal | null>,
): Promise<Prepared | Refusal> {
  const service = b.service == null ? 'formation' : b.service;
  if (!isOneOf(SERVICES, service)) return fail(400, 'invalid_service');
  if (typeof b.formation_partner_uid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.formation_partner_uid)) return fail(400, 'formation_partner_required');
  const hours = b.expires_in_hours == null ? OFFER_HOURS_DEFAULT : b.expires_in_hours;
  if (typeof hours !== 'number' || !Number.isSafeInteger(hours) || hours < 1 || hours > OFFER_HOURS_MAX) return fail(400, 'invalid_expiry');
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length > 2000 || (needReason && !reason)) return fail(400, 'reason_required');
  const kase = await readCaseByUid(env, uid);
  if (!kase) return fail(404, 'case_not_found');
  if (!isSuperAdmin(admin) && Number(kase.hq_owner_user_id) !== Number(admin.id)) return fail(403, 'case_owner_required');
  if (kase.closed_at) return fail(409, 'case_closed');
  if (kase.track !== 'v2') return fail(409, 'legacy_case');
  if (b.expected_revision !== undefined && b.expected_revision !== kase.revision) return fail(409, 'case_moved');
  if (kase.hold_reason) return fail(409, 'case_on_hold');
  if (!kase.country || !kase.form_key) return fail(409, 'form_not_chosen');
  const candidates = await eligiblePartners(env, kase, service, now);
  const target = candidates.find((c) => c.uid === b.formation_partner_uid);
  if (!target) return fail(409, 'partner_has_no_coverage');
  if (!target.eligible) return fail(409, target.refusal!, { partner: target.uid });
  const refused = await beforeScreen(kase, service, target);
  if (refused) return refused;
  // #6705: the people are screened again before any firm is offered the case.
  try {
    const screen = await screenFormationCase(env, kase.id, 'offer', Number(admin.id), kase.revision);
    if (screen.held) return fail(409, 'case_on_hold');
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (m === 'formation_case_moved' || m === 'formation_case_unavailable') return fail(409, 'case_moved');
    if (m === 'formation_people_required') return fail(409, 'people_required');
    return fail(503, 'screening_unavailable');
  }
  const expiresAt = sqlTime(new Date(now.getTime() + hours * 3_600_000));
  return { ok: true, kase, service, target, expiresAt, reason };
}

async function commit(env: Env, admin: User, statements: D1PreparedStatement[], audit: { name: string; details: Record<string, unknown> }) {
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (/integer overflow|UNIQUE constraint/i.test(String(e))) return fail(409, 'case_moved');
    throw e;
  }
  await logAdminAction(env, Number(admin.id), admin.email ?? '', audit.name, audit.details, { adminAuditAlreadyRecorded: true });
  return null;
}

/** HQ offers one service on a case to an eligible firm. */
export async function offerCase(env: Env, admin: User, uid: string, b: WriteBody, now = new Date()) {
  const p = await prepare(env, admin, uid, b, now, false, async (kase, service) => {
    const live = await env.DB.prepare(
      "SELECT uid FROM formation_case_assignments WHERE case_id = ? AND service = ? AND state IN ('offered', 'accepted')",
    ).bind(kase.id, service).first<{ uid: string }>();
    return live ? fail(409, 'assignment_exists', { assignment: live.uid }) : null;
  });
  if (!p.ok) return p;
  const { kase, service, target, expiresAt } = p;
  const detail = { case_uid: kase.uid, service, formation_partner_uid: target.uid, partner_id: target.partner_id, expires_at: expiresAt, by_user_id: Number(admin.id) };
  const audit = { name: 'formation_case.partner_offered', details: detail };
  const refused = await commit(env, admin, [
    caseGuard(env, kase),
    eligibilityGuard(env, target.formation_partner_id, kase, service, now),
    offerInsert(env, kase, target, service, Number(admin.id), expiresAt, null),
    event(env, kase.id, Number(admin.id), 'hq', 'partner_offered', detail),
    adminAuditStatement(env, Number(admin.id), audit.name, detail),
  ], audit);
  if (refused) return refused;
  const row = await env.DB.prepare(
    "SELECT uid FROM formation_case_assignments WHERE case_id = ? AND service = ? AND state = 'offered'",
  ).bind(kase.id, service).first<{ uid: string }>();
  return { ok: true as const, assignment: row?.uid ?? null, state: 'offered', partner: target.uid, service, expires_at: expiresAt };
}

/**
 * HQ moves a case's service to another eligible firm. The old firm's access
 * ends in the same batch, it is sent a deletion or return request, and the new
 * firm is offered the case.
 */
export async function reassignCase(env: Env, admin: User, uid: string, b: WriteBody, now = new Date()) {
  const kind = b.notice_kind == null ? 'deletion_request' : b.notice_kind;
  if (!isOneOf(NOTICE_KINDS, kind)) return fail(400, 'invalid_notice_kind');
  let old: any = null;
  const p = await prepare(env, admin, uid, b, now, true, async (kase, service, target) => {
    old = await env.DB.prepare(
      `SELECT a.id, a.uid, a.state, a.formation_partner_id, a.partner_id, f.uid AS partner_uid
         FROM formation_case_assignments a JOIN formation_partners f ON f.id = a.formation_partner_id
        WHERE a.case_id = ? AND a.service = ? AND a.state IN ('offered', 'accepted')`,
    ).bind(kase.id, service).first<any>();
    if (!old) return fail(409, 'no_assignment');
    return Number(old.formation_partner_id) === target.formation_partner_id ? fail(409, 'same_partner') : null;
  });
  if (!p.ok) return p;
  const { kase, service, target, expiresAt, reason } = p;
  const actor = Number(admin.id);
  const detail = {
    case_uid: kase.uid, service, from_formation_partner_uid: old.partner_uid, from_partner_id: Number(old.partner_id),
    formation_partner_uid: target.uid, partner_id: target.partner_id, notice_kind: kind, reason, expires_at: expiresAt, by_user_id: actor,
  };
  const audit = { name: 'formation_case.partner_reassigned', details: detail };
  const at = sqlTime(now);
  const clearsCase = service === 'formation' && kase.partner_id != null && Number(kase.partner_id) === Number(old.partner_id);
  const statements: D1PreparedStatement[] = [
    caseGuard(env, kase),
    eligibilityGuard(env, target.formation_partner_id, kase, service, now),
    // The old firm's assignment ends now. An accepted one ends; an unanswered offer is withdrawn as its answer.
    env.DB.prepare(
      `UPDATE formation_case_assignments SET state = 'withdrawn', updated_at = ?, end_reason = ?,
              decided_by = CASE WHEN state = 'offered' THEN ? ELSE decided_by END,
              decided_at = CASE WHEN state = 'offered' THEN ? ELSE decided_at END,
              ended_by = CASE WHEN state = 'accepted' THEN ? ELSE ended_by END,
              ended_at = CASE WHEN state = 'accepted' THEN ? ELSE ended_at END
        WHERE id = ? AND state = ?`,
    ).bind(at, reason, actor, at, actor, at, old.id, old.state),
    env.DB.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END'),
    // The request to the old firm: recorded, not sent, until counsel approves wording (PARTNER_NOTICE_WORDING).
    env.DB.prepare(
      `INSERT INTO formation_partner_notices (case_id, assignment_id, formation_partner_id, kind, delivery, requested_by, requested_at)
       VALUES (?, ?, ?, ?, 'awaiting_counsel', ?, ?)`,
    ).bind(kase.id, old.id, old.formation_partner_id, kind, actor, at),
    offerInsert(env, kase, target, service, actor, expiresAt, Number(old.id)),
    event(env, kase.id, actor, 'hq', 'partner_reassigned', detail),
    adminAuditStatement(env, actor, audit.name, detail),
  ];
  if (clearsCase) {
    // #6705's sharingAllowed binds formation_cases.partner_id: clearing it ends the old firm's reads in this batch.
    statements.push(env.DB.prepare(
      'UPDATE formation_cases SET partner_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
    ).bind(at, kase.id, kase.revision));
  }
  const refused = await commit(env, admin, statements, audit);
  if (refused) return refused;
  const row = await env.DB.prepare(
    "SELECT uid FROM formation_case_assignments WHERE case_id = ? AND service = ? AND state = 'offered'",
  ).bind(kase.id, service).first<{ uid: string }>();
  return {
    ok: true as const, assignment: row?.uid ?? null, state: 'offered', partner: target.uid, service, expires_at: expiresAt,
    ended: { assignment: old.uid, partner: old.partner_uid },
    notice: { kind, delivery: PARTNER_NOTICE_WORDING ? 'pending_send' : 'awaiting_counsel' },
  };
}

/**
 * A firm's member accepts or declines an offer. #6711 mounts the partner
 * route; the rule is here so the access check and the offer share one table.
 * Accepting the formation service names the firm on the case, and a case not
 * yet paid moves to the v2 track.
 */
export async function answerOffer(env: Env, user: User, assignmentUid: string, answer: 'accept' | 'decline', now = new Date()) {
  if (!holdsLicence(user as any, 'partner')) return fail(403, 'partner_required');
  const a = await env.DB.prepare(
    `SELECT a.id, a.case_id, a.formation_partner_id, a.partner_id, a.service, a.expires_at, f.uid AS partner_uid, c.uid AS case_uid, c.revision
       FROM formation_case_assignments a
       JOIN formation_partners f ON f.id = a.formation_partner_id AND f.status = 'verified'
       JOIN formation_partner_members m ON m.formation_partner_id = a.formation_partner_id AND m.user_id = ? AND m.revoked_at IS NULL
       JOIN formation_cases c ON c.id = a.case_id AND c.closed_at IS NULL
      WHERE a.uid = ? AND a.state = 'offered' AND a.expires_at > ?`,
  ).bind(Number(user.id), assignmentUid, sqlTime(now)).first<any>();
  if (!a) return fail(404, 'offer_not_found');
  const at = sqlTime(now);
  const actor = Number(user.id);
  const state = answer === 'accept' ? 'accepted' : 'declined';
  const detail = { case_uid: a.case_uid, service: a.service, formation_partner_uid: a.partner_uid, partner_id: Number(a.partner_id), by_user_id: actor };
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE formation_case_assignments SET state = ?, decided_by = ?, decided_at = ?, updated_at = ?
        WHERE id = ? AND state = 'offered' AND expires_at > ?`,
    ).bind(state, actor, at, at, a.id, at),
    env.DB.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END'),
    event(env, a.case_id, actor, 'partner', 'partner_offer_' + (answer === 'accept' ? 'accepted' : 'declined'), detail),
    activity(env, actor, 'formation_case.partner_offer_' + (answer === 'accept' ? 'accepted' : 'declined'), detail),
  ];
  if (answer === 'accept' && a.service === 'formation') {
    statements.push(env.DB.prepare(
      `UPDATE formation_cases SET partner_id = ?, revision = revision + 1, updated_at = ?,
              track = CASE WHEN track <> 'v2' AND stage IN (SELECT value FROM json_each(?)) THEN 'v2' ELSE track END
        WHERE id = ? AND closed_at IS NULL AND (partner_id IS NULL OR partner_id = ?)`,
    ).bind(a.partner_id, at, JSON.stringify(PRE_PAID), a.case_id, a.partner_id));
    statements.push(env.DB.prepare('SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END'));
  }
  try { await env.DB.batch(statements); } catch (e) {
    if (/integer overflow/i.test(String(e))) return fail(409, 'offer_moved');
    throw e;
  }
  return { ok: true as const, assignment: assignmentUid, state };
}

/** Offers past their expiry become `expired`, each with a case event; the case returns to HQ's unassigned view. */
export async function expireOffers(env: Env, now = new Date(), limit = 50) {
  const at = sqlTime(now);
  const due = await env.DB.prepare(
    `SELECT a.id, a.case_id, a.service, a.partner_id, a.expires_at, f.uid AS partner_uid
       FROM formation_case_assignments a JOIN formation_partners f ON f.id = a.formation_partner_id
      WHERE a.state = 'offered' AND a.expires_at <= ? ORDER BY a.expires_at, a.id LIMIT ?`,
  ).bind(at, limit).all<any>();
  let expired = 0;
  for (const a of due.results || []) {
    const detail = { service: a.service, formation_partner_uid: a.partner_uid, partner_id: Number(a.partner_id), expires_at: a.expires_at };
    const [r] = await env.DB.batch([
      env.DB.prepare("UPDATE formation_case_assignments SET state = 'expired', decided_at = ?, updated_at = ? WHERE id = ? AND state = 'offered'")
        .bind(at, at, a.id),
      event(env, a.case_id, null, 'system', 'partner_offer_expired', detail, true),
      activity(env, null, 'formation_case.partner_offer_expired', { case_id: a.case_id, ...detail }, true),
    ]);
    if (r.meta.changes === 1) expired += 1;
  }
  return { expired };
}

export type FormationCaseAccess = 'full' | 'redacted' | null;

/**
 * The partner-side ownership check on a formation case: may this user, acting
 * for a partner firm, see this case, and how much of it.
 *   'full'      the user is a live member of a verified firm whose assignment
 *               on the open case is accepted (for the formation service, the
 *               case names that firm)
 *   'redacted'  the same, with the firm's offer unanswered and unexpired
 *   null        anything else: not partner-licensed, no live membership, another
 *               firm's case, an ended, declined or expired assignment, a closed case
 * Reading people or documents also needs `canReadFormationPeople`.
 */
export async function canAccessFormationCase(env: Env, user: User | null | undefined, caseId: number, now = new Date()): Promise<FormationCaseAccess> {
  if (!user || !holdsLicence(user as any, 'partner') || !Number.isSafeInteger(caseId)) return null;
  const rows = await env.DB.prepare(
    `SELECT a.state FROM formation_case_assignments a
       JOIN formation_partners f ON f.id = a.formation_partner_id AND f.status = 'verified'
       JOIN formation_partner_members m ON m.formation_partner_id = a.formation_partner_id AND m.user_id = ? AND m.revoked_at IS NULL
       JOIN formation_cases c ON c.id = a.case_id AND c.closed_at IS NULL
      WHERE a.case_id = ?
        AND ((a.state = 'accepted' AND (a.service <> 'formation' OR c.partner_id = a.partner_id))
          OR (a.state = 'offered' AND a.expires_at > ?))`,
  ).bind(Number(user.id), caseId, sqlTime(now)).all<{ state: string }>();
  const states = (rows.results || []).map((r) => r.state);
  if (states.includes('accepted')) return 'full';
  if (states.includes('offered')) return 'redacted';
  return null;
}

/**
 * May this firm member read the case's people (or another scope) now: full
 * access, then #6705's gate — the case names the firm, a live consent naming
 * the firm for the scope (and for a cross-border transfer when one applies),
 * each person noticed for this firm and screened clear, and no hold.
 */
export async function canReadFormationPeople(env: Env, user: User | null | undefined, caseId: number, scope: string, crossBorder: boolean, now = new Date()) {
  if ((await canAccessFormationCase(env, user, caseId, now)) !== 'full') return false;
  // Full access may come from another service; the people belong to the firm the case names, through its formation assignment.
  const firm = await env.DB.prepare(
    `SELECT c.partner_id FROM formation_case_assignments a
       JOIN formation_partners f ON f.id = a.formation_partner_id AND f.status = 'verified'
       JOIN formation_partner_members m ON m.formation_partner_id = a.formation_partner_id AND m.user_id = ? AND m.revoked_at IS NULL
       JOIN formation_cases c ON c.id = a.case_id AND c.closed_at IS NULL AND c.partner_id = a.partner_id
      WHERE a.case_id = ? AND a.service = 'formation' AND a.state = 'accepted'`,
  ).bind(Number(user!.id), caseId).first<{ partner_id: number }>();
  if (firm?.partner_id == null) return false;
  return sharingAllowed(env, caseId, Number(firm.partner_id), scope, crossBorder);
}
