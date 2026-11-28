/**
 * D7673 (#7673): the role-neutral introduction request lifecycle and requester readiness, on #7672's directory ids.
 *
 * WHAT IT OWNS. A requester (any signed-in member, whatever their role) asks Axal to introduce them to a person in
 * the shared Network directory, or to a person they name who is not in it yet (a provisional target an operator
 * resolves). Submission only queues the request for Axal. A named operator reviews it and performs any outreach as
 * a person; each contact is recorded as an attempt and its delivery reconciled. Nothing in this module sends a
 * message unless a caller hands `recordContactAttempt` a transport, and no route does.
 *
 * WHAT IT DOES NOT TOUCH. The quarterly investor ask (#6261), curated-credit propositions (#7064), teammate
 * requests (#7066) and Offer one (#6637) keep their own tables, quotas and economics. A row here carries
 * `service_type = 'directory_introduction'` and spends no credit.
 *
 * VISIBILITY. Three projections, each built here so a route cannot widen one by accident: the requester sees their
 * own request without operator-only events or contact detail; an operator sees the request without the requester's
 * private notes; a target projection is the shareable brief only. Directory contact points and raw source records
 * (#7672's operator-only table) are never read here.
 *
 * WHO WORKS THE OPERATOR SIDE (D9067). A Super Admin's named grant: `operator` works requests, `reviewer` decides
 * readiness. `staffKindsOf` reads it; the routes gate on it; `grantStaff` and `revokeStaff` write it with a receipt.
 */
import type { Env } from '../types';
import { adminAuditStatement } from './adminAudit';

export const REQUEST_STATES = [
  'draft', 'readiness_needed', 'submitted', 'in_review', 'needs_information', 'outreach_ready', 'contacted',
  'awaiting_target', 'declined', 'unavailable', 'agreed', 'introduction_made', 'closed', 'withdrawn',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export type Actor = 'requester' | 'operator';

/** Who acts next in each state. A count of "waiting on you" reads this, never a guess. */
export const NEXT_ACTOR: Record<RequestState, 'requester' | 'operator' | 'target' | 'none'> = {
  draft: 'requester',
  readiness_needed: 'requester',
  submitted: 'operator',
  in_review: 'operator',
  needs_information: 'requester',
  outreach_ready: 'operator',
  contacted: 'operator',
  awaiting_target: 'target',
  declined: 'operator',
  unavailable: 'operator',
  agreed: 'operator',
  introduction_made: 'operator',
  closed: 'none',
  withdrawn: 'none',
};

/** States a requester may withdraw from. Withdrawal after contact keeps every attempt and event. */
export const WITHDRAWABLE: readonly RequestState[] = [
  'draft', 'readiness_needed', 'submitted', 'in_review', 'needs_information', 'outreach_ready', 'contacted', 'awaiting_target',
];

/** The operator's moves. Submission, assignment, contact and withdrawal have their own functions. */
export const OPERATOR_TRANSITIONS: Record<string, readonly RequestState[]> = {
  in_review: ['needs_information', 'outreach_ready', 'unavailable'],
  contacted: ['awaiting_target', 'declined', 'unavailable', 'agreed'],
  awaiting_target: ['declined', 'unavailable', 'agreed'],
  agreed: ['introduction_made'],
  introduction_made: ['closed'],
  declined: ['closed'],
  unavailable: ['closed'],
  withdrawn: ['closed'],
};

/** Field limits, matching the migration's CHECKs, so a refusal names the field before the database does. */
export const LIMITS = {
  purpose: 2000,
  shareable_brief: 4000,
  private_notes: 4000,
  outcome_note: 2000,
  display_name: 300,
  organization_text: 300,
  profile_url: 500,
  evidence_ref: 300,
  readiness_text: 300,
} as const;

export const PAGE_SIZE = 25;
export const PAGE_MAX = 100;

/** A refusal this module raises; the route turns it into a refusal body with the same code. */
export class IntroRefusal extends Error {
  status: number;
  code: string;
  /** Our sentence for the member: never a thrown or provider message. */
  sentence: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, sentence: string, extra?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.sentence = sentence;
    this.extra = extra;
  }
}
const refusal = (status: number, code: string, message: string, extra?: Record<string, unknown>) =>
  new IntroRefusal(status, code, message, extra);

// ── Pure rules ─────────────────────────────────────────────────────────────────────────────────────────────────

export function canOperatorMove(from: string, to: string): boolean {
  return (OPERATOR_TRANSITIONS[from] || []).includes(to as RequestState);
}

const isText = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && Array.from(v).length <= max;
const optionalText = (v: unknown, max: number) => v == null || (typeof v === 'string' && Array.from(v).length <= max);
const httpsUrl = (v: unknown) => {
  if (v == null || v === '') return true;
  if (typeof v !== 'string' || v.length > LIMITS.profile_url) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * What each base requirement holds. A requirement a later policy adds and this module does not know is held as
 * short text fields, so a new policy version never needs a code change to be stored, only to be checked.
 */
export function validateReadinessValue(key: string, value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw refusal(400, 'readiness_value_invalid', 'Send this requirement as an object of named text fields.');
  const v = value as Record<string, unknown>;
  if (key === 'professional_profile') {
    if (!isText(v.headline, LIMITS.readiness_text))
      throw refusal(400, 'headline_required', 'Add a professional headline of up to 300 characters.');
    if (!httpsUrl(v.profile_url))
      throw refusal(400, 'profile_url_invalid', 'A profile link must be an https address of up to 500 characters.');
    return { headline: String(v.headline).trim(), ...(v.profile_url ? { profile_url: String(v.profile_url) } : {}) };
  }
  if (key === 'capacity') {
    if (!isText(v.capacity, LIMITS.readiness_text))
      throw refusal(400, 'capacity_required', 'Say in what capacity you ask, in up to 300 characters.');
    if (!optionalText(v.represented_organization, LIMITS.readiness_text))
      throw refusal(400, 'represented_organization_invalid', 'The organisation you represent can be up to 300 characters.');
    return {
      capacity: String(v.capacity).trim(),
      ...(v.represented_organization ? { represented_organization: String(v.represented_organization).trim() } : {}),
    };
  }
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(k) || !optionalText(raw, 1000))
      throw refusal(400, 'readiness_value_invalid', 'Each field is a short lower-case name with text of up to 1,000 characters.');
    if (raw != null) out[k] = String(raw);
  }
  return out;
}

export type ReadinessRow = { requirement_key: string; status: string; valid_until: string | null };

/**
 * Which requirements of a policy are met at `now`. Met means approved by a reviewer and not past its validity.
 * The answer is computed from stored rows on every submission; nothing a client sends can mark one met.
 */
export function readinessGaps(requirements: string[], rows: ReadinessRow[], now: Date) {
  const byKey = new Map(rows.map((r) => [r.requirement_key, r]));
  return requirements.map((key) => {
    const row = byKey.get(key);
    let status: 'missing' | 'awaiting_review' | 'rejected' | 'expired' | 'met' = 'missing';
    if (row?.status === 'submitted') status = 'awaiting_review';
    else if (row?.status === 'rejected') status = 'rejected';
    else if (row?.status === 'approved')
      status = row.valid_until && Date.parse(row.valid_until.replace(' ', 'T') + (row.valid_until.endsWith('Z') ? '' : 'Z')) <= now.getTime() ? 'expired' : 'met';
    return { key, status, valid_until: row?.valid_until ?? null };
  });
}

/** Cursor over (created_at, uid), newest first: stable under inserts, exact to the row. */
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)));
export function encodeCursor(row: { created_at: string; uid: string }): string {
  return b64url(JSON.stringify([row.created_at, row.uid]));
}
export function decodeCursor(cursor: string | undefined | null): [string, string] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(unb64url(cursor));
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x.length <= 128)) return [v[0], v[1]];
  } catch {
    /* fall through */
  }
  throw refusal(400, 'cursor_invalid', 'That page marker is not one this list issued. Start again from the first page.');
}
export function pageSize(raw: string | undefined | null): number {
  if (raw == null || raw === '') return PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > PAGE_MAX)
    throw refusal(400, 'limit_invalid', `Ask for between 1 and ${PAGE_MAX} requests a page.`);
  return n;
}

// ── Projections ────────────────────────────────────────────────────────────────────────────────────────────────

const json = (s: string | null | undefined, fallback: any) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

function targetView(r: any) {
  const uid = r.target_entry_uid || r.provisional_resolved_entry_uid || null;
  return {
    kind: r.target_entry_uid ? 'directory_person' : r.target_provisional_uid ? 'provisional' : 'none',
    entry_uid: uid,
    display_name: r.target_display_name ?? r.provisional_display_name ?? null,
    provisional_uid: r.target_provisional_uid ?? null,
    provisional_status: r.target_provisional_uid ? r.provisional_review_status : null,
    organization_entry_uid: r.organization_entry_uid ?? null,
    organization_name: r.organization_display_name ?? null,
    recipient_identified: !!uid,
  };
}

function baseView(r: any) {
  return {
    uid: r.uid,
    service_type: r.service_type,
    state: r.state,
    next_actor: r.next_actor,
    revision: r.revision,
    target: targetView(r),
    purpose: r.purpose,
    shareable_brief: r.shareable_brief,
    consent_status: r.consent_status,
    outcome_note: r.outcome_note,
    operator_assigned: r.operator_user_id != null,
    policy_version: json(r.policy_snapshot_json, null)?.version ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    submitted_at: r.submitted_at,
    closed_at: r.closed_at,
    links: { self: `/api/intro-requests/${r.uid}` },
  };
}

const eventView = (e: any) => ({
  type: e.event_type,
  from_state: e.from_state,
  to_state: e.to_state,
  by: e.actor_role,
  at: e.created_at,
  detail: json(e.detail_json, {}),
});

/** The requester's own view: their private notes, requester-visible events, no contact detail. */
export function requesterView(r: any, events: any[] = []) {
  return {
    ...baseView(r),
    private_notes: r.private_notes,
    events: events.filter((e) => e.visibility === 'requester').map(eventView),
  };
}

/** The operator's view: every event and attempt, the requester's id, never the requester's private notes. */
export function operatorView(r: any, events: any[] = [], attempts: any[] = []) {
  return {
    ...baseView(r),
    requester_user_id: r.requester_user_id,
    operator_user_id: r.operator_user_id,
    policy_snapshot: json(r.policy_snapshot_json, null),
    events: events.map((e) => ({ ...eventView(e), visibility: e.visibility, actor_user_id: e.actor_user_id })),
    contact_attempts: attempts.map((a) => ({
      uid: a.uid,
      channel: a.channel,
      delivery_state: a.delivery_state,
      attempted_at: a.attempted_at,
      reconciled_at: a.reconciled_at,
      operator_user_id: a.operator_user_id,
    })),
  };
}

/** What an operator may put in front of the target: the brief and the requester's shareable readiness, nothing else. */
export function targetBriefView(r: any, readiness: Record<string, Record<string, string>>) {
  return { purpose: r.purpose, shareable_brief: r.shareable_brief, requester: readiness };
}

/**
 * The notification each audience may receive for an event, or null. This builds the payload only: no route sends
 * it, and a target audience never exists here because target contact is the operator's recorded act.
 */
export function notificationFor(event: { event_type: string; visibility: string; request_uid: string; to_state?: string | null }, audience: 'requester' | 'operator') {
  if (audience === 'requester' && event.visibility !== 'requester') return null;
  const QUIET = new Set(['draft_created', 'draft_updated']);
  if (QUIET.has(event.event_type)) return null;
  return {
    audience,
    request_uid: event.request_uid,
    event_type: event.event_type,
    state: event.to_state ?? null,
    link: `/api/intro-requests/${event.request_uid}`,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────────────────────────────────────────

type DB = any;
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

const REQUEST_SELECT = `SELECT r.*, t.display_name AS target_display_name, o.display_name AS organization_display_name,
  p.display_name AS provisional_display_name, p.review_status AS provisional_review_status, p.resolved_entry_uid AS provisional_resolved_entry_uid
  FROM network_intro_requests r
  LEFT JOIN network_directory_entries t ON t.uid = r.target_entry_uid
  LEFT JOIN network_directory_entries o ON o.uid = r.organization_entry_uid
  LEFT JOIN network_intro_provisional_targets p ON p.uid = r.target_provisional_uid`;

export async function activePolicy(db: DB) {
  const p = await db.prepare(`SELECT uid, version, requirements_json, validity_days FROM network_intro_policies WHERE active = 1`).first();
  if (!p) throw refusal(503, 'intro_policy_unavailable', 'Introduction requests are not open: no readiness policy is active.');
  return { uid: p.uid as string, version: p.version as number, requirements: json(p.requirements_json, []) as string[], validity_days: p.validity_days as number | null };
}

export async function readinessOf(db: DB, userId: number, now = new Date()) {
  const policy = await activePolicy(db);
  const rows = (await db.prepare(`SELECT requirement_key, status, valid_until, value_json, evidence_ref, reviewed_at, updated_at FROM network_intro_readiness WHERE user_id = ?`).bind(userId).all()).results || [];
  const gaps = readinessGaps(policy.requirements, rows, now);
  return {
    policy: { uid: policy.uid, version: policy.version, requirements: policy.requirements, validity_days: policy.validity_days },
    requirements: gaps.map((g) => {
      const row = rows.find((x: any) => x.requirement_key === g.key);
      return { ...g, value: row ? json(row.value_json, {}) : null, has_evidence_ref: !!row?.evidence_ref, reviewed_at: row?.reviewed_at ?? null };
    }),
    ready: gaps.every((g) => g.status === 'met'),
  };
}

export async function putReadiness(db: DB, userId: number, key: string, body: any) {
  const policy = await activePolicy(db);
  if (!policy.requirements.includes(key))
    throw refusal(404, 'requirement_unknown', 'The current readiness policy has no requirement by that name.');
  const value = validateReadinessValue(key, body?.value);
  if (!optionalText(body?.evidence_ref, LIMITS.evidence_ref))
    throw refusal(400, 'evidence_ref_invalid', 'An evidence reference is a short pointer of up to 300 characters, not the document.');
  // A change is reviewed again: approval and validity are cleared, whatever they were.
  await db
    .prepare(`INSERT INTO network_intro_readiness (user_id, requirement_key, value_json, evidence_ref, status, reviewer_user_id, reviewed_at, valid_until, updated_at)
      VALUES (?, ?, ?, ?, 'submitted', NULL, NULL, NULL, datetime('now'))
      ON CONFLICT (user_id, requirement_key) DO UPDATE SET value_json = excluded.value_json, evidence_ref = excluded.evidence_ref,
        status = 'submitted', reviewer_user_id = NULL, reviewed_at = NULL, valid_until = NULL, updated_at = datetime('now')`)
    .bind(userId, key, JSON.stringify(value), body?.evidence_ref ?? null)
    .run();
  return readinessOf(db, userId);
}

export async function reviewReadiness(db: DB, reviewerId: number, userId: number, key: string, decision: string) {
  if (!['approved', 'rejected'].includes(decision))
    throw refusal(400, 'decision_invalid', 'Decide approved or rejected.');
  if (reviewerId === userId) throw refusal(403, 'self_review_refused', 'A reviewer cannot review their own readiness.');
  const policy = await activePolicy(db);
  // The policy's validity, if it has one, as a bound SQLite modifier; no policy validity means no expiry.
  const modifier = decision === 'approved' && policy.validity_days ? `+${Number(policy.validity_days)} days` : null;
  const res = await db
    .prepare(`UPDATE network_intro_readiness SET status = ?, reviewer_user_id = ?, reviewed_at = datetime('now'),
      valid_until = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now', ?) END, updated_at = datetime('now')
      WHERE user_id = ? AND requirement_key = ? AND status = 'submitted'`)
    .bind(decision, reviewerId, modifier, modifier, userId, key)
    .run();
  if (!res.meta?.changes) throw refusal(409, 'readiness_not_awaiting_review', 'That requirement is not waiting for review.');
}

async function publishedEntry(db: DB, entryUid: string, kind: 'person' | 'organization') {
  // A requester can only name what the directory publishes; anything else reads as not found, so a staged or
  // suppressed record's existence is never confirmed to a member.
  return db
    .prepare(`SELECT uid FROM network_directory_entries WHERE uid = ? AND kind = ? AND publication_status = 'published' AND verification_status != 'withdrawn'`)
    .bind(entryUid, kind)
    .first();
}

export async function createProvisionalTarget(db: DB, userId: number, body: any) {
  if (!isText(body?.display_name, LIMITS.display_name))
    throw refusal(400, 'display_name_required', 'Name the person, in up to 300 characters.');
  if (!optionalText(body?.organization_text, LIMITS.organization_text))
    throw refusal(400, 'organization_text_invalid', 'Their organisation can be up to 300 characters.');
  if (!httpsUrl(body?.profile_url))
    throw refusal(400, 'profile_url_invalid', 'A profile link must be an https address of up to 500 characters.');
  const id = uid('ipt');
  await db
    .prepare(`INSERT INTO network_intro_provisional_targets (uid, created_by, display_name, organization_text, profile_url) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, userId, String(body.display_name).trim(), body.organization_text ?? null, body.profile_url || null)
    .run();
  return { uid: id, review_status: 'pending' };
}

async function resolveTargets(db: DB, userId: number, body: any) {
  const t = { target_entry_uid: null as string | null, target_provisional_uid: null as string | null, organization_entry_uid: null as string | null };
  if (body?.target_entry_uid != null && body?.target_provisional_uid != null)
    throw refusal(400, 'one_target_only', 'Name the person either from the directory or as a new person, not both.');
  if (body?.target_entry_uid != null) {
    if (typeof body.target_entry_uid !== 'string' || !(await publishedEntry(db, body.target_entry_uid, 'person')))
      throw refusal(404, 'target_not_found', 'No directory person by that reference is available to you.');
    t.target_entry_uid = body.target_entry_uid;
  }
  if (body?.target_provisional_uid != null) {
    const p = typeof body.target_provisional_uid === 'string'
      ? await db.prepare(`SELECT uid FROM network_intro_provisional_targets WHERE uid = ? AND created_by = ? AND review_status != 'rejected'`).bind(body.target_provisional_uid, userId).first()
      : null;
    if (!p) throw refusal(404, 'target_not_found', 'No person you named by that reference is available.');
    t.target_provisional_uid = body.target_provisional_uid;
  }
  if (body?.organization_entry_uid != null) {
    if (typeof body.organization_entry_uid !== 'string' || !(await publishedEntry(db, body.organization_entry_uid, 'organization')))
      throw refusal(404, 'organization_not_found', 'No directory organisation by that reference is available to you.');
    t.organization_entry_uid = body.organization_entry_uid;
  }
  return t;
}

function textFields(body: any) {
  const out: Record<string, string | null> = {};
  for (const f of ['purpose', 'shareable_brief', 'private_notes'] as const) {
    if (body?.[f] === undefined) continue;
    if (!optionalText(body[f], LIMITS[f])) throw refusal(400, `${f}_invalid`, `That ${f.replace('_', ' ')} is longer than ${LIMITS[f]} characters.`);
    out[f] = body[f] == null ? null : String(body[f]);
  }
  return out;
}

const eventStmt = (db: DB, requestUid: string, revision: number, actorId: number | null, role: string, type: string, from: string | null, to: string | null, visibility: 'requester' | 'operator', detail: Record<string, unknown> = {}) =>
  // Runs first in its batch, while the request is still at the `revision` the caller read. The batch is one
  // transaction, so the event and the guarded update land together or not at all: a lost race writes neither.
  db
    .prepare(`INSERT INTO network_intro_events (request_uid, actor_user_id, actor_role, event_type, from_state, to_state, visibility, detail_json)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM network_intro_requests WHERE uid = ? AND revision = ?)`)
    .bind(requestUid, actorId, role, type, from, to, visibility, JSON.stringify(detail), requestUid, revision);

/** Create a draft. The same idempotency key from the same requester returns the request it first made. */
export async function createRequest(db: DB, userId: number, body: any) {
  const key = body?.idempotency_key;
  if (typeof key !== 'string' || key.length < 8 || key.length > 128)
    throw refusal(400, 'idempotency_key_required', 'Send an idempotency key of 8 to 128 characters with a new request.');
  const prior = await db.prepare(`SELECT uid FROM network_intro_requests WHERE requester_user_id = ? AND idempotency_key = ?`).bind(userId, key).first();
  if (prior) return { request: await requestForRequester(db, userId, prior.uid), created: false };
  const targets = await resolveTargets(db, userId, body);
  if (!targets.target_entry_uid && !targets.target_provisional_uid && !targets.organization_entry_uid)
    throw refusal(400, 'target_required', 'Name a person, or an organisation whose right person Axal should identify.');
  const text = textFields(body);
  const id = uid('ir');
  const results = await db.batch([
    db
      .prepare(`INSERT INTO network_intro_requests (uid, requester_user_id, idempotency_key, target_entry_uid, target_provisional_uid, organization_entry_uid, purpose, shareable_brief, private_notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (requester_user_id, idempotency_key) DO NOTHING`)
      .bind(id, userId, key, targets.target_entry_uid, targets.target_provisional_uid, targets.organization_entry_uid, text.purpose ?? null, text.shareable_brief ?? null, text.private_notes ?? null),
    eventStmt(db, id, 0, userId, 'requester', 'draft_created', null, 'draft', 'requester'),
  ]);
  // A concurrent create with the same key lost the insert; it answers with the winner's request.
  const winner = results[0]?.meta?.changes ? id : (await db.prepare(`SELECT uid FROM network_intro_requests WHERE requester_user_id = ? AND idempotency_key = ?`).bind(userId, key).first())?.uid;
  return { request: await requestForRequester(db, userId, winner), created: !!results[0]?.meta?.changes };
}

async function loadRequest(db: DB, requestUid: string) {
  return db.prepare(REQUEST_SELECT + ` WHERE r.uid = ?`).bind(requestUid).first();
}
async function eventsOf(db: DB, requestUid: string) {
  return (await db.prepare(`SELECT * FROM network_intro_events WHERE request_uid = ? ORDER BY id`).bind(requestUid).all()).results || [];
}
async function attemptsOf(db: DB, requestUid: string) {
  return (await db.prepare(`SELECT * FROM network_intro_contact_attempts WHERE request_uid = ? ORDER BY attempted_at, uid`).bind(requestUid).all()).results || [];
}

/** The requester's own request, or a 404 that does not say whether someone else's exists. */
export async function requireRequestOwner(db: DB, userId: number, requestUid: string) {
  const r = await loadRequest(db, requestUid);
  if (!r || r.requester_user_id !== userId) throw refusal(404, 'request_not_found', 'You have no introduction request by that reference.');
  return r;
}
export async function requestForRequester(db: DB, userId: number, requestUid: string) {
  const r = await requireRequestOwner(db, userId, requestUid);
  return requesterView(r, await eventsOf(db, requestUid));
}
export async function requestForOperator(db: DB, requestUid: string) {
  const r = await loadRequest(db, requestUid);
  // A draft is the requester's own until submitted; an operator cannot read one.
  if (!r || r.state === 'draft') throw refusal(404, 'request_not_found', 'There is no submitted introduction request by that reference.');
  return operatorView(r, await eventsOf(db, requestUid), await attemptsOf(db, requestUid));
}

function expectRevision(body: any, r: any) {
  if (!Number.isSafeInteger(body?.expected_revision))
    throw refusal(400, 'expected_revision_required', 'Send the revision you are changing, so a newer change is not overwritten.');
  if (body.expected_revision !== r.revision)
    throw refusal(409, 'revision_conflict', 'This request changed since you read it. Reload it and try again.', { revision: r.revision, state: r.state });
}

/** Apply one guarded state change and its event in one batch. A lost race changes nothing and is refused. */
const MUTABLE = [
  'target_entry_uid', 'target_provisional_uid', 'organization_entry_uid', 'purpose', 'shareable_brief', 'private_notes',
  'operator_user_id', 'policy_uid', 'policy_snapshot_json', 'consent_status', 'outcome_note', 'submitted_at',
] as const;
async function move(db: DB, r: any, to: RequestState, actor: { id: number | null; role: 'requester' | 'operator' | 'system' }, type: string, set: Record<string, unknown> = {}, visibility: 'requester' | 'operator' = 'requester', detail: Record<string, unknown> = {}) {
  for (const k of Object.keys(set)) if (!(MUTABLE as readonly string[]).includes(k)) throw new Error(`introductionRequests: ${k} is not a mutable column`);
  // One fixed statement: every mutable column is written, each with its new value or the value just read.
  const values = MUTABLE.map((c) => (c in set ? set[c] : r[c]) ?? null);
  const terminal = to === 'closed' || to === 'withdrawn' ? 1 : 0;
  const res = await db.batch([
    eventStmt(db, r.uid, r.revision, actor.id, actor.role, type, r.state, to, visibility, detail),
    db
      .prepare(`UPDATE network_intro_requests SET state = ?, next_actor = ?, revision = revision + 1, updated_at = datetime('now'),
        closed_at = CASE WHEN ? = 1 THEN COALESCE(closed_at, datetime('now')) ELSE closed_at END,
        target_entry_uid = ?, target_provisional_uid = ?, organization_entry_uid = ?, purpose = ?, shareable_brief = ?, private_notes = ?,
        operator_user_id = ?, policy_uid = ?, policy_snapshot_json = ?, consent_status = ?, outcome_note = ?, submitted_at = ?
        WHERE uid = ? AND revision = ?`)
      .bind(to, NEXT_ACTOR[to], terminal, ...values, r.uid, r.revision),
  ]);
  if (!res[1]?.meta?.changes) throw refusal(409, 'revision_conflict', 'This request changed while you were acting on it. Reload it and try again.');
}

export async function updateDraft(db: DB, userId: number, requestUid: string, body: any) {
  const r = await requireRequestOwner(db, userId, requestUid);
  expectRevision(body, r);
  if (!['draft', 'readiness_needed', 'needs_information'].includes(r.state))
    throw refusal(409, 'request_not_editable', 'Only a draft, or a request Axal asked you to add to, can be edited.');
  const text = textFields(body);
  const set: Record<string, unknown> = { ...text };
  if (r.state === 'draft' && ('target_entry_uid' in (body || {}) || 'target_provisional_uid' in (body || {}) || 'organization_entry_uid' in (body || {}))) {
    const merged = {
      target_entry_uid: 'target_entry_uid' in body ? body.target_entry_uid : r.target_entry_uid,
      target_provisional_uid: 'target_provisional_uid' in body ? body.target_provisional_uid : r.target_provisional_uid,
      organization_entry_uid: 'organization_entry_uid' in body ? body.organization_entry_uid : r.organization_entry_uid,
    };
    const t = await resolveTargets(db, userId, merged);
    if (!t.target_entry_uid && !t.target_provisional_uid && !t.organization_entry_uid)
      throw refusal(400, 'target_required', 'Name a person, or an organisation whose right person Axal should identify.');
    Object.assign(set, t);
  }
  await move(db, r, r.state, { id: userId, role: 'requester' }, 'draft_updated', set, 'requester', { fields: Object.keys(set) });
  return requestForRequester(db, userId, requestUid);
}

/**
 * Submit: check the requester's readiness against the active policy from stored rows, then queue for Axal or
 * say what is missing. The policy is copied onto the request, so a later policy change does not rewrite history.
 * Answering an operator's question uses the same call and returns the request to review.
 */
export async function submitRequest(db: DB, userId: number, requestUid: string, body: any, now = new Date()) {
  const r = await requireRequestOwner(db, userId, requestUid);
  expectRevision(body, r);
  if (r.state === 'needs_information') {
    await move(db, r, 'in_review', { id: userId, role: 'requester' }, 'information_supplied');
    return { request: await requestForRequester(db, userId, requestUid), readiness: null };
  }
  if (!['draft', 'readiness_needed'].includes(r.state))
    throw refusal(409, 'request_not_submittable', 'This request has already been submitted.');
  const readiness = await readinessOf(db, userId, now);
  const policy = await activePolicy(db);
  if (!readiness.ready) {
    const missing = readiness.requirements.filter((x) => x.status !== 'met').map((x) => ({ key: x.key, status: x.status }));
    await move(db, r, 'readiness_needed', { id: userId, role: 'requester' }, 'readiness_needed', { policy_uid: policy.uid }, 'requester', { missing });
    return { request: await requestForRequester(db, userId, requestUid), readiness };
  }
  const snapshot = { uid: policy.uid, version: policy.version, requirements: policy.requirements, checked_at: now.toISOString() };
  await move(db, r, 'submitted', { id: userId, role: 'requester' }, 'submitted', {
    policy_uid: policy.uid,
    policy_snapshot_json: JSON.stringify(snapshot),
    submitted_at: now.toISOString().replace('T', ' ').slice(0, 19),
  });
  return { request: await requestForRequester(db, userId, requestUid), readiness };
}

export async function withdrawRequest(db: DB, userId: number, requestUid: string, body: any) {
  const r = await requireRequestOwner(db, userId, requestUid);
  expectRevision(body, r);
  if (!WITHDRAWABLE.includes(r.state)) throw refusal(409, 'request_not_withdrawable', 'This request is already finished.');
  const contacted = ['contacted', 'awaiting_target'].includes(r.state);
  await move(db, r, 'withdrawn', { id: userId, role: 'requester' }, 'withdrawn', {}, 'requester', { after_contact: contacted });
  return requestForRequester(db, userId, requestUid);
}

const PAGE_TAIL = ` AND (? IS NULL OR r.created_at < ? OR (r.created_at = ? AND r.uid < ?)) ORDER BY r.created_at DESC, r.uid DESC LIMIT ?`;
const cursorBinds = (cur: [string, string] | null, limit: number) => [cur?.[0] ?? null, cur?.[0] ?? null, cur?.[0] ?? null, cur?.[1] ?? null, limit + 1];
function pageOut(rows: any[], limit: number, view: (r: any) => any) {
  const page = rows.slice(0, limit);
  return { items: page.map(view), next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}

/** Who acts next; the requester's desk draws one lane per value (D9068, NIE01). */
export const NEXT_ACTORS = ['requester', 'operator', 'target', 'none'] as const;

export async function listForRequester(db: DB, userId: number, q: { state?: string | null; next_actor?: string | null; cursor?: string | null; limit?: string | null }) {
  const limit = pageSize(q.limit);
  const cur = decodeCursor(q.cursor);
  if (q.state && !REQUEST_STATES.includes(q.state as RequestState)) throw refusal(400, 'state_invalid', 'That is not a request state.');
  if (q.next_actor && !(NEXT_ACTORS as readonly string[]).includes(q.next_actor)) throw refusal(400, 'next_actor_invalid', 'That is not who acts next.');
  const state = q.state || null, actor = q.next_actor || null;
  // The total and the page share one WHERE, so the count is the whole set the pages walk.
  const WHERE = ` WHERE r.requester_user_id = ? AND (? IS NULL OR r.state = ?) AND (? IS NULL OR r.next_actor = ?)`;
  const binds = [userId, state, state, actor, actor];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM network_intro_requests r` + WHERE).bind(...binds).first();
  const rows = (await db.prepare(REQUEST_SELECT + WHERE + PAGE_TAIL).bind(...binds, ...cursorBinds(cur, limit)).all()).results || [];
  // Every lane's count from one read, whatever the filter: a lane with nothing in it is a counted zero.
  const counted = (await db.prepare(`SELECT next_actor, COUNT(*) AS n FROM network_intro_requests WHERE requester_user_id = ? GROUP BY next_actor`).bind(userId).all()).results || [];
  const lanes = Object.fromEntries(NEXT_ACTORS.map((a) => [a, Number(counted.find((x: any) => x.next_actor === a)?.n ?? 0)]));
  return { total: total?.n ?? 0, lanes, ...pageOut(rows, limit, (r) => requesterView(r)) };
}

// ── Operator ───────────────────────────────────────────────────────────────────────────────────────────────────

export async function operatorQueue(db: DB, q: { state?: string | null; next_actor?: string | null; mine?: number | null; cursor?: string | null; limit?: string | null }) {
  const limit = pageSize(q.limit);
  const cur = decodeCursor(q.cursor);
  if (q.state && !REQUEST_STATES.includes(q.state as RequestState)) throw refusal(400, 'state_invalid', 'That is not a request state.');
  if (q.next_actor && !['requester', 'operator', 'target', 'none'].includes(q.next_actor)) throw refusal(400, 'next_actor_invalid', 'That is not who acts next.');
  const state = q.state || null, actor = q.next_actor || null, mine = q.mine || null;
  // Drafts are the requester's own until submitted: an operator's queue never lists them.
  const WHERE = ` WHERE r.state != 'draft' AND (? IS NULL OR r.state = ?) AND (? IS NULL OR r.next_actor = ?) AND (? IS NULL OR r.operator_user_id = ?)`;
  const binds = [state, state, actor, actor, mine, mine];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM network_intro_requests r` + WHERE).bind(...binds).first();
  const rows = (await db.prepare(REQUEST_SELECT + WHERE + PAGE_TAIL).bind(...binds, ...cursorBinds(cur, limit)).all()).results || [];
  return { total: total?.n ?? 0, ...pageOut(rows, limit, (r) => operatorView(r)) };
}

async function operatorRequest(db: DB, requestUid: string) {
  const r = await loadRequest(db, requestUid);
  if (!r || r.state === 'draft') throw refusal(404, 'request_not_found', 'There is no submitted introduction request by that reference.');
  return r;
}

export async function assignRequest(db: DB, operatorId: number, requestUid: string, body: any) {
  const r = await operatorRequest(db, requestUid);
  expectRevision(body, r);
  if (r.state !== 'submitted') throw refusal(409, 'request_not_awaiting_assignment', 'Only a submitted request waiting for an operator can be assigned.');
  await move(db, r, 'in_review', { id: operatorId, role: 'operator' }, 'assigned', { operator_user_id: operatorId }, 'requester');
  return requestForOperator(db, requestUid);
}

function assertAssigned(r: any, operatorId: number) {
  if (r.operator_user_id !== operatorId)
    throw refusal(403, 'not_assigned_operator', 'Only the operator assigned to this request can act on it.');
}

export async function operatorMove(db: DB, operatorId: number, requestUid: string, body: any) {
  const r = await operatorRequest(db, requestUid);
  expectRevision(body, r);
  assertAssigned(r, operatorId);
  const to = body?.to;
  if (!canOperatorMove(r.state, to)) throw refusal(409, 'transition_not_allowed', `A request in ${r.state.replace(/_/g, ' ')} cannot move to that state.`, { allowed: OPERATOR_TRANSITIONS[r.state] || [] });
  const set: Record<string, unknown> = {};
  if (to === 'outreach_ready' && !(r.target_entry_uid || r.provisional_resolved_entry_uid))
    throw refusal(409, 'recipient_required', 'Identify the person to contact before marking the request ready for outreach.');
  if (to === 'agreed') set.consent_status = 'granted';
  if (to === 'declined') set.consent_status = 'declined';
  if (to === 'closed') {
    if (!optionalText(body?.outcome_note, LIMITS.outcome_note)) throw refusal(400, 'outcome_note_invalid', 'An outcome note can be up to 2,000 characters.');
    set.outcome_note = body?.outcome_note ?? null;
  }
  const question = to === 'needs_information' ? body?.question : undefined;
  if (to === 'needs_information' && !isText(question, 1000)) throw refusal(400, 'question_required', 'Say what the requester needs to add, in up to 1,000 characters.');
  await move(db, r, to, { id: operatorId, role: 'operator' }, `moved_${to}`, set, 'requester', question ? { question } : {});
  return requestForOperator(db, requestUid);
}

/** The operator points a provisional target or an organisation-only request at a directory person. */
export async function setRecipient(db: DB, operatorId: number, requestUid: string, body: any) {
  const r = await operatorRequest(db, requestUid);
  expectRevision(body, r);
  assertAssigned(r, operatorId);
  if (!['in_review', 'needs_information'].includes(r.state)) throw refusal(409, 'recipient_locked', 'The recipient can only be set while the request is in review.');
  if (typeof body?.entry_uid !== 'string' || !(await publishedEntry(db, body.entry_uid, 'person')))
    throw refusal(404, 'target_not_found', 'No published directory person by that reference.');
  if (r.target_provisional_uid) {
    // Resolving the provisional record keeps the request's reference stable; reads follow it to the entry.
    await db
      .prepare(`UPDATE network_intro_provisional_targets SET review_status = 'resolved', resolved_entry_uid = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE uid = ? AND review_status = 'pending'`)
      .bind(body.entry_uid, operatorId, r.target_provisional_uid)
      .run();
    await move(db, r, r.state, { id: operatorId, role: 'operator' }, 'recipient_identified', {}, 'operator', { entry_uid: body.entry_uid, via: 'provisional' });
  } else {
    await move(db, r, r.state, { id: operatorId, role: 'operator' }, 'recipient_identified', { target_entry_uid: body.entry_uid }, 'operator', { entry_uid: body.entry_uid, via: 'organization' });
  }
  return requestForOperator(db, requestUid);
}

export type Transport = { send(input: { requestUid: string; attemptUid: string; channel: string; brief: ReturnType<typeof targetBriefView> }): Promise<{ provider_ref?: string }> };

/**
 * Record one contact with the target. The same idempotency key returns the attempt it first recorded and sends
 * nothing again. A new attempt is refused while an earlier one is pending or uncertain: it is reconciled first,
 * so a lost response never turns into a blind resend.
 */
export async function recordContactAttempt(db: DB, operatorId: number, requestUid: string, body: any, transport?: Transport) {
  const r = await operatorRequest(db, requestUid);
  assertAssigned(r, operatorId);
  const key = body?.idempotency_key;
  if (typeof key !== 'string' || key.length < 8 || key.length > 128)
    throw refusal(400, 'idempotency_key_required', 'Send an idempotency key of 8 to 128 characters with a contact attempt.');
  const prior = await db.prepare(`SELECT * FROM network_intro_contact_attempts WHERE request_uid = ? AND idempotency_key = ?`).bind(requestUid, key).first();
  if (prior) return { attempt: prior, replayed: true };
  expectRevision(body, r);
  if (!['outreach_ready', 'contacted', 'awaiting_target'].includes(r.state))
    throw refusal(409, 'outreach_not_ready', 'Mark the request ready for outreach before recording contact.');
  if (!['email', 'phone', 'message', 'in_person', 'other'].includes(body?.channel))
    throw refusal(400, 'channel_invalid', 'Say how the target was contacted: email, phone, message, in person or other.');
  const open = await db.prepare(`SELECT uid FROM network_intro_contact_attempts WHERE request_uid = ? AND delivery_state IN ('pending', 'uncertain')`).bind(requestUid).first();
  if (open) throw refusal(409, 'attempt_unreconciled', 'Settle the earlier contact attempt before recording another.', { attempt_uid: open.uid });
  const attemptUid = uid('ica');
  const manual = !transport;
  const to: RequestState = r.state === 'outreach_ready' ? 'contacted' : r.state;
  const res = await db.batch([
    db
      .prepare(`INSERT INTO network_intro_contact_attempts (uid, request_uid, operator_user_id, idempotency_key, channel, delivery_state)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM network_intro_requests WHERE uid = ? AND revision = ?)`)
      .bind(attemptUid, requestUid, operatorId, key, body.channel, manual ? 'delivered' : 'pending', requestUid, r.revision),
    eventStmt(db, requestUid, r.revision, operatorId, 'operator', 'contact_attempted', r.state, to, 'requester', { channel: body.channel }),
    db
      .prepare(`UPDATE network_intro_requests SET state = ?, next_actor = ?, consent_status = CASE WHEN consent_status = 'not_asked' THEN 'asked' ELSE consent_status END,
        revision = revision + 1, updated_at = datetime('now') WHERE uid = ? AND revision = ?`)
      .bind(to, NEXT_ACTOR[to], requestUid, r.revision),
  ]);
  if (!res[2]?.meta?.changes) throw refusal(409, 'revision_conflict', 'This request changed while you were acting on it. Reload it and try again.');
  if (transport) {
    try {
      const sent = await transport.send({ requestUid, attemptUid, channel: body.channel, brief: targetBriefView(r, {}) });
      await db.prepare(`UPDATE network_intro_contact_attempts SET delivery_state = 'delivered', provider_ref = ?, reconciled_at = datetime('now') WHERE uid = ? AND delivery_state = 'pending'`).bind(sent?.provider_ref ?? null, attemptUid).run();
    } catch {
      // The provider may or may not have delivered it. Uncertain, never failed: only a reconcile says which.
      await db.prepare(`UPDATE network_intro_contact_attempts SET delivery_state = 'uncertain' WHERE uid = ? AND delivery_state = 'pending'`).bind(attemptUid).run();
    }
  }
  return { attempt: await db.prepare(`SELECT * FROM network_intro_contact_attempts WHERE uid = ?`).bind(attemptUid).first(), replayed: false };
}

export async function reconcileAttempt(db: DB, operatorId: number, attemptUid: string, body: any) {
  if (!['delivered', 'failed'].includes(body?.delivery_state)) throw refusal(400, 'delivery_state_invalid', 'Settle an attempt as delivered or failed.');
  if (!optionalText(body?.provider_ref, 200)) throw refusal(400, 'provider_ref_invalid', 'A provider reference can be up to 200 characters.');
  const a = await db.prepare(`SELECT a.*, r.operator_user_id AS request_operator FROM network_intro_contact_attempts a JOIN network_intro_requests r ON r.uid = a.request_uid WHERE a.uid = ?`).bind(attemptUid).first();
  if (!a) throw refusal(404, 'attempt_not_found', 'There is no contact attempt by that reference.');
  if (a.request_operator !== operatorId) throw refusal(403, 'not_assigned_operator', 'Only the operator assigned to this request can settle its attempts.');
  if (!['pending', 'uncertain'].includes(a.delivery_state)) throw refusal(409, 'attempt_settled', 'That attempt is already settled.');
  const res = await db.batch([
    db.prepare(`UPDATE network_intro_contact_attempts SET delivery_state = ?, provider_ref = COALESCE(?, provider_ref), reconciled_at = datetime('now') WHERE uid = ? AND delivery_state = ?`).bind(body.delivery_state, body.provider_ref ?? null, attemptUid, a.delivery_state),
    // The event lands only if this call settled the attempt from the state it read.
    db
      .prepare(`INSERT INTO network_intro_events (request_uid, actor_user_id, actor_role, event_type, visibility, detail_json)
        SELECT ?, ?, 'operator', 'contact_reconciled', 'operator', ? WHERE EXISTS (SELECT 1 FROM network_intro_contact_attempts WHERE uid = ? AND delivery_state = ? AND reconciled_at IS NOT NULL)`)
      .bind(a.request_uid, operatorId, JSON.stringify({ attempt_uid: attemptUid, from: a.delivery_state, delivery_state: body.delivery_state }), attemptUid, body.delivery_state),
  ]);
  if (!res[0]?.meta?.changes) throw refusal(409, 'attempt_settled', 'That attempt is already settled.');
}

export async function provisionalQueue(db: DB, q: { status?: string | null }) {
  const status = q.status || 'pending';
  if (!['pending', 'resolved', 'rejected'].includes(status)) throw refusal(400, 'status_invalid', 'That is not a review status.');
  const rows = (await db.prepare(`SELECT uid, created_by, display_name, organization_text, profile_url, review_status, resolved_entry_uid, created_at FROM network_intro_provisional_targets WHERE review_status = ? ORDER BY created_at, uid LIMIT ?`).bind(status, PAGE_MAX).all()).results || [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM network_intro_provisional_targets WHERE review_status = ?`).bind(status).first();
  return { total: total?.n ?? 0, items: rows };
}

export async function readinessQueue(db: DB) {
  const rows = (await db.prepare(`SELECT user_id, requirement_key, value_json, evidence_ref IS NOT NULL AS has_evidence_ref, updated_at FROM network_intro_readiness WHERE status = 'submitted' ORDER BY updated_at, user_id LIMIT ?`).bind(PAGE_MAX).all()).results || [];
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM network_intro_readiness WHERE status = 'submitted'`).first();
  return { total: total?.n ?? 0, items: rows.map((r: any) => ({ ...r, value: json(r.value_json, {}), value_json: undefined, has_evidence_ref: !!r.has_evidence_ref })) };
}

// ── D9067 (#9067): who works the operator side, by a Super Admin's named grant ────────────────────────────────────
//
// The owner's answer A of 2026-11-27 on #7673 (D7678, D7677 Q3): an operator is an HQ admin a Super Admin has named;
// a readiness reviewer is an HQ admin with the Network reviewer entitlement. Being an HQ admin, or a Super Admin, is
// not enough on its own. A grant has no validity period (none is set until the policy owner sets one): it holds until
// a Super Admin revokes it. Every grant and revoke lands in the same batch as its `admin_audit_log` row.

export const STAFF_KINDS = ['operator', 'reviewer'] as const;
export type StaffKind = (typeof STAFF_KINDS)[number];
const GRANT_REASON_MAX = 500;
/** What the grant writes need: the database, for the change and its audit row in one batch. */
type AuditEnv = Pick<Env, 'DB'>;

/** The kinds a person holds now: granted and not revoked. */
export async function staffKindsOf(db: DB, userId: number): Promise<Set<StaffKind>> {
  const rows: Array<{ kind: StaffKind }> = (await db
    .prepare('SELECT kind FROM network_intro_staff_grants WHERE user_id = ? AND revoked_at IS NULL')
    .bind(userId)
    .all()).results ?? [];
  return new Set(rows.map((r) => r.kind));
}

const grantView = (g: any) => ({
  uid: g.uid, kind: g.kind, user: { id: g.user_id, uid: g.user_uid ?? null, name: g.user_name ?? null },
  granted_by: g.granted_by, granted_at: g.granted_at, reason: g.reason,
  revoked_by: g.revoked_by ?? null, revoked_at: g.revoked_at ?? null,
});

/** The grants in force, for the Super Admin's list. */
export async function listStaffGrants(db: DB) {
  const rows = (await db.prepare(`SELECT g.*, u.uid AS user_uid, u.name AS user_name FROM network_intro_staff_grants g JOIN users u ON u.id = g.user_id WHERE g.revoked_at IS NULL ORDER BY g.kind, g.granted_at, g.id`).all()).results ?? [];
  return { grants: rows.map(grantView) };
}

function grantInput(body: any) {
  const kind = body?.kind;
  if (!STAFF_KINDS.includes(kind)) throw refusal(400, 'grant_kind_invalid', 'Name the grant: operator or reviewer.');
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > GRANT_REASON_MAX) throw refusal(400, 'grant_reason_required', 'Say why, in up to 500 characters. The reason is kept with the grant.');
  return { kind: kind as StaffKind, reason };
}

/**
 * A Super Admin names an operator or a reviewer. The grantee must be an active HQ admin. Granting what is already
 * held changes nothing and records nothing (`already: true`).
 */
export async function grantStaff(env: AuditEnv, superAdminId: number, userId: number, body: any) {
  const { kind, reason } = grantInput(body);
  const grantee = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND LOWER(role) = 'admin' AND is_active = 1").bind(userId).first();
  if (!grantee) throw refusal(404, 'grantee_not_hq_admin', 'Only an active HQ admin can be named an operator or a reviewer.');
  const id = uid('isg');
  const [insert] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO network_intro_staff_grants (uid, user_id, kind, granted_by, reason)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM network_intro_staff_grants WHERE user_id = ? AND kind = ? AND revoked_at IS NULL)`)
      .bind(id, userId, kind, superAdminId, reason, userId, kind),
    adminAuditStatement(env as Env, superAdminId, 'network_intro_grant', { target_user_id: userId, kind, grant_uid: id, reason }, { onlyIfChanged: true }),
  ]);
  const row = await env.DB.prepare(`SELECT g.*, u.uid AS user_uid, u.name AS user_name FROM network_intro_staff_grants g JOIN users u ON u.id = g.user_id WHERE g.user_id = ? AND g.kind = ? AND g.revoked_at IS NULL`).bind(userId, kind).first();
  return { grant: grantView(row), already: !insert.meta?.changes };
}

/** A Super Admin ends a grant. Revoking what is not held changes nothing and records nothing (`already: true`). */
export async function revokeStaff(env: AuditEnv, superAdminId: number, userId: number, kindRaw: string, body: any) {
  const { kind, reason } = grantInput({ ...(body ?? {}), kind: kindRaw });
  const held = await env.DB.prepare('SELECT uid FROM network_intro_staff_grants WHERE user_id = ? AND kind = ? AND revoked_at IS NULL').bind(userId, kind).first<{ uid: string }>();
  if (!held) return { grant: null, already: true };
  const [update] = await env.DB.batch([
    env.DB.prepare(`UPDATE network_intro_staff_grants SET revoked_by = ?, revoked_at = datetime('now'), revoke_reason = ?
      WHERE uid = ? AND revoked_at IS NULL`).bind(superAdminId, reason, held.uid),
    adminAuditStatement(env as Env, superAdminId, 'network_intro_revoke', { target_user_id: userId, kind, grant_uid: held.uid, reason }, { onlyIfChanged: true }),
  ]);
  const row = await env.DB.prepare(`SELECT g.*, u.uid AS user_uid, u.name AS user_name FROM network_intro_staff_grants g JOIN users u ON u.id = g.user_id WHERE g.uid = ?`).bind(held.uid).first();
  return { grant: grantView(row), already: !update.meta?.changes };
}
