/**
 * D6695 (#6695, plan key E10 of #6680) — requests on a formation case, its
 * notes, and the timeline each party may read.
 *
 * A REQUEST (formation_case_requests) is HQ, a partner or counsel asking the
 * founder (or one another) for one thing the case needs: a document, an
 * answer, a signature, an identity check, a payment or an approval. Its states:
 *
 *   open → answered → accepted          the asker takes the answer
 *            answered → returned → answered …   sent back, with a reason
 *   open | answered | returned → cancelled      the asker (or HQ) withdraws it
 *
 * An approval answered with its bound hash goes straight to accepted: there is
 * nothing left for the asker to check. This service is the table's only
 * writer. Every change is one batch: the request's conditional UPDATE (or
 * INSERT), a formation_case_events row, and the case's waiting_on, the last
 * two guarded on the first having written.
 *
 * WAITING_ON. While a request is active (open, answered or returned) the case
 * waits on the newest active one: on the party asked while it is open or
 * returned, on the asker once it is answered. Each request records the case's
 * waiting_on from before the first active request (`prior_waiting_on`); when
 * the last one closes the case gets it back. If the case changed stage in
 * between, that value is stale, and the case gets the new stage's own
 * waiting_on instead (formationCase.ts `stageWaitingOn`), or the prior one
 * when the stage names none.
 *
 * KINDS.
 *   - document, signature: answered with a `documents` row already stored
 *     through the classified upload (services/recordStore.ts, for example
 *     `POST /api/company/:uid/documents`). This service stores no bytes; it
 *     checks the row belongs to the case's venture, company or founder and
 *     puts it on the case (formation_case_documents, class `evidence`).
 *   - identity: takes no file and no document, ever (owner decision 13, S1).
 *     It records that the partner asked and, when the partner accepts it, the
 *     partner's own reference for its check. The store refuses a document on
 *     one too.
 *   - approval: bound to a SHA-256 when it is opened. For a filing pack it
 *     names the filing, and answering it approves that pack through
 *     `approvePack` (formationFilings.ts), which sets
 *     formation_filings.founder_approved_at. A pack whose hash changed since
 *     the request was opened is refused (`pack_changed`).
 *   - answer, payment: text.
 *
 * NOTES are formation_case_events rows of kind `note`, visibility `all`,
 * `hq_partner` or `hq_only`. A founder writes only `all`; a partner `all` or
 * `hq_partner`.
 *
 * THE TIMELINE a party reads is filtered by visibility in the SQL: the founder
 * reads `all` only, a partner `all` and `hq_partner`, HQ every row.
 *
 * LOGGED. Every write by HQ, a partner or counsel is recorded with
 * `logAdminAction` (activity_logs), as well as on the case timeline. The
 * founder's own answers are on the timeline.
 *
 * NOTIFIED (notify.ts, category `formation`): the person asked when a request
 * opens; the asker when it is answered. `notifyCaseStage` is the stage,
 * registry-question and registered notice for the founder; its callers are the
 * HQ and partner write routes (#6698, #6711).
 */
import type { Env } from '../types';
import { newUid } from '../routes/_t13t14t15_helpers';
import { isCalendarDate } from './section83b';
import { readCase, stageWaitingOn, type Actor, type CaseRow } from './formationCase';
import { approvePack, readFiling } from './formationFilings';
import { logAdminAction } from './adminAudit';
import { notify, FORMATION_NOTIFY_TYPES } from './notify';

export const REQUEST_KINDS = Object.freeze(['document', 'answer', 'signature', 'identity', 'payment', 'approval'] as const);
export type RequestKind = typeof REQUEST_KINDS[number];
export const REQUEST_STATES = Object.freeze(['open', 'answered', 'accepted', 'returned', 'cancelled'] as const);
export type RequestState = typeof REQUEST_STATES[number];
/** The states in which a request still holds the case's waiting_on. */
export const ACTIVE_STATES: readonly RequestState[] = Object.freeze(['open', 'answered', 'returned']);
export const ASKING_PARTIES = Object.freeze(['hq', 'partner', 'counsel'] as const);
export const ASKED_PARTIES = Object.freeze(['founder', 'hq', 'partner', 'counsel'] as const);
export const NOTE_VISIBILITY = Object.freeze(['all', 'hq_partner', 'hq_only'] as const);
export type Visibility = typeof NOTE_VISIBILITY[number];
export type Audience = 'founder' | 'partner' | 'hq';

/** Body keys that would carry file bytes. No request is answered with bytes here. */
const FILE_KEYS = ['file', 'files', 'data', 'data_uri', 'dataUri', 'bytes', 'content', 'upload', 'attachment'] as const;

export interface RequestRow {
  id: number; uid: string; case_id: number; asked_by_party: string; asked_by_user_id: number;
  asked_of_party: string; asked_of_user_id: number | null; kind: RequestKind; title: string; body: string | null;
  due_on: string | null; state: RequestState; answer_text: string | null; answer_document_id: number | null;
  partner_reference: string | null; bound_sha256: string | null; filing_id: number | null; return_reason: string | null;
  prior_waiting_on: string; prior_case_revision: number; answered_by: number | null; answered_at: string | null;
  closed_by: number | null; closed_at: string | null; revision: number; created_at: string; updated_at: string;
}

export type RequestResult =
  | { ok: true; request: RequestRow }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const REQUEST_COLS = 'r.id, r.uid, r.case_id, r.asked_by_party, r.asked_by_user_id, r.asked_of_party, r.asked_of_user_id, r.kind, '
  + 'r.title, r.body, r.due_on, r.state, r.answer_text, r.answer_document_id, r.partner_reference, r.bound_sha256, r.filing_id, '
  + 'r.return_reason, r.prior_waiting_on, r.prior_case_revision, r.answered_by, r.answered_at, r.closed_by, r.closed_at, '
  + 'r.revision, r.created_at, r.updated_at';
const REQUEST_BY_ID = 'SELECT ' + REQUEST_COLS + ' FROM formation_case_requests r WHERE r.id = ?';
const REQUEST_BY_UID = 'SELECT ' + REQUEST_COLS + ' FROM formation_case_requests r WHERE r.uid = ?';

const ACTIVE_SQL = "('open', 'answered', 'returned')";
// The window's base: the prior value the first active request recorded, else the case's own now.
const OPEN_INSERT =
  'INSERT INTO formation_case_requests (uid, case_id, asked_by_party, asked_by_user_id, asked_of_party, asked_of_user_id, kind, '
  + 'title, body, due_on, bound_sha256, filing_id, prior_waiting_on, prior_case_revision) '
  + 'SELECT ?, c.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '
  + 'COALESCE((SELECT p.prior_waiting_on FROM formation_case_requests p WHERE p.case_id = c.id AND p.state IN ' + ACTIVE_SQL + ' ORDER BY p.id LIMIT 1), c.waiting_on), '
  + 'COALESCE((SELECT p.prior_case_revision FROM formation_case_requests p WHERE p.case_id = c.id AND p.state IN ' + ACTIVE_SQL + ' ORDER BY p.id LIMIT 1), c.revision) '
  + 'FROM formation_cases c WHERE c.id = ? AND c.closed_at IS NULL';
const REQUEST_AT = 'EXISTS (SELECT 1 FROM formation_case_requests WHERE uid = ? AND revision = ?)';
const EVENT_INSERT =
  'INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) '
  + 'SELECT ?, ?, ?, ?, ?, ? WHERE ' + REQUEST_AT;
// The case waits on the newest active request; with none, on `restore`.
const WAITING_UPDATE =
  'UPDATE formation_cases SET waiting_on = COALESCE((SELECT CASE WHEN a.state = \'answered\' THEN a.asked_by_party ELSE a.asked_of_party END '
  + 'FROM formation_case_requests a WHERE a.case_id = formation_cases.id AND a.state IN ' + ACTIVE_SQL + ' ORDER BY a.id DESC LIMIT 1), ?), '
  + "updated_at = datetime('now') WHERE id = ? AND " + REQUEST_AT;
// Every change of state: written only from the state and revision read.
const STATE_UPDATE =
  'UPDATE formation_case_requests SET state = ?, revision = revision + 1, '
  + 'answer_text = CASE WHEN ? = 1 THEN ? ELSE answer_text END, '
  + 'answer_document_id = CASE WHEN ? = 1 THEN ? ELSE answer_document_id END, '
  + 'partner_reference = COALESCE(?, partner_reference), return_reason = COALESCE(?, return_reason), '
  + "answered_by = CASE WHEN ? = 1 THEN ? ELSE answered_by END, answered_at = CASE WHEN ? = 1 THEN datetime('now') ELSE answered_at END, "
  + "closed_by = CASE WHEN ? = 1 THEN ? ELSE closed_by END, closed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE closed_at END, "
  + "updated_at = datetime('now') WHERE id = ? AND state = ? AND revision = ?";
const CASE_DOC_INSERT =
  'INSERT OR IGNORE INTO formation_case_documents (uid, case_id, filing_id, document_id, class, visible_to, added_by) '
  + "SELECT ?, ?, ?, ?, 'evidence', ?, ? WHERE " + REQUEST_AT;
// A document the founder may name: their venture's, their company's, or one they uploaded.
const DOC_ON_CASE =
  'SELECT d.id FROM documents d WHERE d.id = ? AND ((d.project_id IS NOT NULL AND d.project_id = ?) '
  + 'OR (d.company_id IS NOT NULL AND d.company_id = ?) OR d.uploaded_by = ?)';
const NOTE_INSERT =
  "INSERT INTO formation_case_events (case_id, actor_user_id, party, kind, visibility, detail_json) VALUES (?, ?, ?, 'note', ?, ?)";

const SHA256 = /^[0-9a-f]{64}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const fail = (status: 400 | 403 | 404 | 409, error: string) => ({ ok: false as const, status, error });
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** The visibility a request's timeline events carry: the founder sees those asked of them. */
export function requestVisibility(askedOf: string): Visibility {
  if (askedOf === 'founder') return 'all';
  if (askedOf === 'partner') return 'hq_partner';
  return 'hq_only';
}

export async function readRequest(env: Env, id: number): Promise<RequestRow | null> {
  if (!posInt(id)) return null;
  return (await env.DB.prepare(REQUEST_BY_ID).bind(id).first<RequestRow>()) || null;
}
export async function readRequestByUid(env: Env, uid: string): Promise<RequestRow | null> {
  if (typeof uid !== 'string' || !uid) return null;
  return (await env.DB.prepare(REQUEST_BY_UID).bind(uid).first<RequestRow>()) || null;
}

/** HQ, a partner or counsel acting: they must be named, and their write is logged. */
function onBehalfError(actor: Actor): string | null {
  if (!isIn(ASKING_PARTIES, actor.party)) return 'party_cannot_ask';
  if (!posInt(actor.userId)) return 'actor_required';
  return null;
}
async function logWrite(env: Env, actor: Actor, action: string, details: Record<string, unknown>) {
  if (actor.party === 'founder' || !actor.userId) return;
  await logAdminAction(env, Number(actor.userId), actor.email ?? '', action, { party: actor.party, ...details });
}
async function quietNotify(env: Env, args: Parameters<typeof notify>[1]) {
  try { await notify(env, args); } catch { /* a notice never undoes the write (notify.ts) */ }
}

/** The value the case's waiting_on returns to when `r` is the last active request to close. */
function restoreValue(r: RequestRow, kase: CaseRow): string {
  if (Number(kase.revision) === Number(r.prior_case_revision)) return r.prior_waiting_on;
  return stageWaitingOn(kase.stage) ?? r.prior_waiting_on;
}

export interface NewRequest {
  askedOf: unknown; askedOfUserId?: unknown; kind: unknown; title: unknown; body?: unknown; dueOn?: unknown;
  boundSha256?: unknown; filingId?: unknown;
}

/** HQ, a partner or counsel opens a request on a case. The case then waits on the party asked. */
export async function openRequest(env: Env, caseId: number, input: NewRequest, actor: Actor): Promise<RequestResult> {
  const who = onBehalfError(actor);
  if (who) return fail(403, who);
  const kase = await readCase(env, caseId);
  if (!kase) return fail(404, 'case_not_found');
  if (kase.closed_at) return fail(409, 'case_closed');
  if (!isIn(ASKED_PARTIES, input.askedOf)) return fail(400, 'asked_of_invalid');
  if (input.askedOf === actor.party) return fail(400, 'asked_of_self');
  if (!isIn(REQUEST_KINDS, input.kind)) return fail(400, 'kind_invalid');
  const title = clean(input.title, 200);
  if (!title) return fail(400, 'title_required');
  const body = clean(input.body, 4000);
  if (input.dueOn != null && !isCalendarDate(input.dueOn)) return fail(400, 'due_on_invalid');
  const askedOfUser = input.askedOf === 'founder' ? Number(kase.user_id) : (input.askedOfUserId == null ? null : posInt(input.askedOfUserId));
  if (input.askedOf !== 'founder' && input.askedOfUserId != null && !askedOfUser) return fail(400, 'asked_of_user_invalid');

  let bound: string | null = null, filing: number | null = null;
  if (input.kind === 'approval') {
    bound = typeof input.boundSha256 === 'string' ? input.boundSha256 : null;
    if (!bound || !SHA256.test(bound)) return fail(400, 'bound_sha256_required');
    if (input.filingId != null) {
      const f = await readFiling(env, Number(input.filingId));
      if (!f || f.case_id !== kase.id) return fail(400, 'filing_not_on_case');
      if (input.askedOf !== 'founder') return fail(400, 'pack_approval_is_the_founders');
      if (f.pack_sha256 !== bound) return fail(409, 'pack_changed');
      filing = f.id;
    }
  } else if (input.boundSha256 != null || input.filingId != null) {
    return fail(400, 'bound_only_on_approval');
  }

  const uid = newUid();
  const visibility = requestVisibility(input.askedOf);
  const detail = JSON.stringify({ request_uid: uid, kind: input.kind, title, asked_of: input.askedOf });
  const results = await env.DB.batch([
    env.DB.prepare(OPEN_INSERT).bind(uid, actor.party, actor.userId, input.askedOf, askedOfUser, input.kind, title, body,
      input.dueOn ?? null, bound, filing, kase.id),
    env.DB.prepare(EVENT_INSERT).bind(kase.id, actor.userId, actor.party, 'request_opened', visibility, detail, uid, 0),
    env.DB.prepare(WAITING_UPDATE).bind(kase.waiting_on, kase.id, uid, 0),
  ]);
  if (!(Number(results[0]?.meta?.changes ?? 0) > 0)) return fail(409, 'case_closed');
  const request = (await readRequestByUid(env, uid))!;
  await logWrite(env, actor, 'formation_request_opened', { case_uid: kase.uid, request_uid: uid, kind: input.kind, asked_of: input.askedOf });
  if (askedOfUser) {
    await quietNotify(env, {
      userId: askedOfUser, type: FORMATION_NOTIFY_TYPES.requestOpened, category: 'formation',
      title: `Requested: ${title}`, body: body ?? null, link: '/incorporate',
      payload: { case_uid: kase.uid, request_uid: uid, kind: input.kind },
    });
  }
  return { ok: true, request };
}

interface StateChange {
  to: RequestState;
  answer?: { text: string | null; documentId: number | null; by: number | null };
  partnerReference?: string | null; returnReason?: string | null;
  close?: boolean; eventKind: string; detail?: Record<string, unknown>; extra?: (uid: string, next: number) => D1PreparedStatement[];
}

/** One change of a request's state, its event, and the case's waiting_on, in one batch. */
async function applyChange(env: Env, r: RequestRow, kase: CaseRow, c: StateChange, actor: Actor): Promise<RequestResult> {
  const next = r.revision + 1;
  const a = c.answer;
  const statements = [
    env.DB.prepare(STATE_UPDATE).bind(
      c.to, a ? 1 : 0, a?.text ?? null, a ? 1 : 0, a?.documentId ?? null,
      c.partnerReference ?? null, c.returnReason ?? null,
      a ? 1 : 0, a?.by ?? null, a ? 1 : 0,
      c.close ? 1 : 0, actor.userId ?? null, c.close ? 1 : 0,
      r.id, r.state, r.revision,
    ),
    env.DB.prepare(EVENT_INSERT).bind(r.case_id, actor.userId ?? null, actor.party, c.eventKind, requestVisibility(r.asked_of_party),
      JSON.stringify({ request_uid: r.uid, kind: r.kind, title: r.title, ...(c.detail || {}) }), r.uid, next),
    ...(c.extra ? c.extra(r.uid, next) : []),
    env.DB.prepare(WAITING_UPDATE).bind(restoreValue(r, kase), r.case_id, r.uid, next),
  ];
  const results = await env.DB.batch(statements);
  if (!(Number(results[0]?.meta?.changes ?? 0) > 0)) return fail(409, 'request_moved');
  return { ok: true, request: (await readRequest(env, r.id))! };
}

async function requestAndCase(env: Env, requestId: number): Promise<{ r: RequestRow; kase: CaseRow } | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  const r = await readRequest(env, requestId);
  if (!r) return fail(404, 'request_not_found');
  const kase = await readCase(env, r.case_id);
  if (!kase) return fail(404, 'case_not_found');
  return { r, kase };
}

/** Whether `actor` is the one asked: the case's founder, or the named person of the party asked. */
function isAskedOf(r: RequestRow, kase: CaseRow, actor: Actor): boolean {
  if (actor.party !== r.asked_of_party || !posInt(actor.userId)) return false;
  if (r.asked_of_party === 'founder') return Number(actor.userId) === Number(kase.user_id);
  return r.asked_of_user_id == null || Number(r.asked_of_user_id) === Number(actor.userId);
}

export interface Answer { text?: unknown; documentId?: unknown; sha256?: unknown; [k: string]: unknown }

/**
 * The one asked answers. A document or signature names a stored documents row
 * of the case, which goes on the case; an identity request takes no file; an
 * approval carries the hash it was bound to, and for a pack approves it.
 */
export async function answerRequest(env: Env, requestId: number, input: Answer, actor: Actor): Promise<RequestResult> {
  const rc = await requestAndCase(env, requestId);
  if ('ok' in rc) return rc;
  const { r, kase } = rc;
  if (!isAskedOf(r, kase, actor)) return fail(403, 'not_asked_of_you');
  if (kase.closed_at) return fail(409, 'case_closed');
  if (r.state !== 'open' && r.state !== 'returned') return fail(409, 'request_not_open');
  const fileKey = FILE_KEYS.find((k) => input[k] != null);
  if (r.kind === 'identity' && (fileKey || input.documentId != null)) return fail(400, 'identity_takes_no_file');
  if (fileKey) return fail(400, 'file_not_accepted');
  const text = clean(input.text, 4000);
  const by = Number(actor.userId);

  if (r.kind === 'document' || r.kind === 'signature') {
    const doc = posInt(input.documentId);
    if (!doc) return fail(400, 'document_required');
    const owned = await env.DB.prepare(DOC_ON_CASE).bind(doc, kase.project_id ?? null, kase.company_id ?? null, kase.user_id).first();
    if (!owned) return fail(400, 'document_not_on_case');
    const res = await applyChange(env, r, kase, {
      to: 'answered', answer: { text, documentId: doc, by }, eventKind: 'request_answered', detail: { document_id: doc },
      extra: (uid, next) => [env.DB.prepare(CASE_DOC_INSERT).bind(newUid(), kase.id, r.filing_id, doc, requestVisibility(r.asked_of_party), by, uid, next)],
    }, actor);
    if (res.ok) await afterAnswer(env, res.request, kase);
    return res;
  }
  if (input.documentId != null) return fail(400, 'document_not_asked');

  if (r.kind === 'approval') {
    const sha = typeof input.sha256 === 'string' ? input.sha256 : '';
    if (sha !== r.bound_sha256) return fail(409, 'approval_hash_mismatch');
    if (r.filing_id != null) {
      const f = await readFiling(env, r.filing_id);
      if (!f || f.pack_sha256 !== r.bound_sha256) return fail(409, 'pack_changed');
      const approved = await approvePack(env, r.filing_id, { packSha256: sha, approvalRequestId: r.id }, actor);
      if (!approved.ok) return fail(approved.status, approved.error);
    }
    const res = await applyChange(env, r, kase, {
      to: 'accepted', answer: { text, documentId: null, by }, close: true, eventKind: 'request_answered',
      detail: { approved_sha256: sha, filing_id: r.filing_id },
    }, actor);
    if (res.ok) await afterAnswer(env, res.request, kase);
    return res;
  }

  if (r.kind === 'answer' && !text) return fail(400, 'text_required');
  const res = await applyChange(env, r, kase, { to: 'answered', answer: { text, documentId: null, by }, eventKind: 'request_answered' }, actor);
  if (res.ok) await afterAnswer(env, res.request, kase);
  return res;
}

async function afterAnswer(env: Env, r: RequestRow, kase: CaseRow) {
  await quietNotify(env, {
    userId: Number(r.asked_by_user_id), type: FORMATION_NOTIFY_TYPES.requestAnswered, category: 'formation',
    title: `Answered: ${r.title}`, body: null, link: null,
    payload: { case_uid: kase.uid, request_uid: r.uid, kind: r.kind, state: r.state },
  });
}

/** The asker (or HQ) may close or send back a request. */
function mayDecide(r: RequestRow, actor: Actor): boolean {
  if (!posInt(actor.userId)) return false;
  if (actor.party === 'hq') return true;
  return actor.party === r.asked_by_party && Number(actor.userId) === Number(r.asked_by_user_id);
}

/** The asker takes the answer. An identity request needs the partner's reference for its check. */
export async function acceptRequest(env: Env, requestId: number, input: { partnerReference?: unknown }, actor: Actor): Promise<RequestResult> {
  const who = onBehalfError(actor);
  if (who) return fail(403, who);
  const rc = await requestAndCase(env, requestId);
  if ('ok' in rc) return rc;
  const { r, kase } = rc;
  if (!mayDecide(r, actor)) return fail(403, 'not_the_asker');
  let reference: string | null = null;
  if (r.kind === 'identity') {
    if (r.state !== 'open' && r.state !== 'answered') return fail(409, 'request_not_answered');
    reference = clean(input.partnerReference, 200);
    if (!reference) return fail(400, 'partner_reference_required');
  } else if (r.state !== 'answered') {
    return fail(409, 'request_not_answered');
  } else if (input.partnerReference != null) {
    return fail(400, 'reference_only_on_identity');
  }
  const res = await applyChange(env, r, kase, { to: 'accepted', partnerReference: reference, close: true, eventKind: 'request_accepted' }, actor);
  if (res.ok) await logWrite(env, actor, 'formation_request_accepted', { case_uid: kase.uid, request_uid: r.uid, kind: r.kind });
  return res;
}

/** The asker sends an answer back, with a reason; the one asked answers again. */
export async function returnRequest(env: Env, requestId: number, input: { reason: unknown }, actor: Actor): Promise<RequestResult> {
  const who = onBehalfError(actor);
  if (who) return fail(403, who);
  const rc = await requestAndCase(env, requestId);
  if ('ok' in rc) return rc;
  const { r, kase } = rc;
  if (!mayDecide(r, actor)) return fail(403, 'not_the_asker');
  if (r.state !== 'answered') return fail(409, 'request_not_answered');
  const reason = clean(input.reason, 2000);
  if (!reason) return fail(400, 'reason_required');
  const res = await applyChange(env, r, kase, { to: 'returned', returnReason: reason, eventKind: 'request_returned', detail: { reason } }, actor);
  if (res.ok) await logWrite(env, actor, 'formation_request_returned', { case_uid: kase.uid, request_uid: r.uid });
  return res;
}

/** The asker (or HQ) withdraws a request that is still active. */
export async function cancelRequest(env: Env, requestId: number, actor: Actor): Promise<RequestResult> {
  const who = onBehalfError(actor);
  if (who) return fail(403, who);
  const rc = await requestAndCase(env, requestId);
  if ('ok' in rc) return rc;
  const { r, kase } = rc;
  if (!mayDecide(r, actor)) return fail(403, 'not_the_asker');
  if (!ACTIVE_STATES.includes(r.state)) return fail(409, 'request_closed');
  const res = await applyChange(env, r, kase, { to: 'cancelled', close: true, eventKind: 'request_cancelled' }, actor);
  if (res.ok) await logWrite(env, actor, 'formation_request_cancelled', { case_uid: kase.uid, request_uid: r.uid });
  return res;
}

/** The visibilities a party may write a note at. */
export function noteVisibilities(party: string): readonly Visibility[] {
  if (party === 'hq') return NOTE_VISIBILITY;
  if (party === 'partner' || party === 'counsel') return ['all', 'hq_partner'];
  if (party === 'founder') return ['all'];
  return [];
}

/** A note on the case's timeline, at a visibility the writer may use. */
export async function addNote(
  env: Env, caseId: number, input: { text: unknown; visibility?: unknown }, actor: Actor,
): Promise<{ ok: true; eventId: number } | { ok: false; status: 400 | 403 | 404 | 409; error: string }> {
  if (!posInt(actor.userId)) return fail(403, 'actor_required');
  const kase = await readCase(env, caseId);
  if (!kase) return fail(404, 'case_not_found');
  if (actor.party === 'founder' && Number(actor.userId) !== Number(kase.user_id)) return fail(403, 'not_your_case');
  const text = clean(input.text, 4000);
  if (!text) return fail(400, 'text_required');
  const vis = input.visibility == null ? (actor.party === 'founder' ? 'all' : 'hq_only') : input.visibility;
  if (!isIn(noteVisibilities(actor.party), vis)) return fail(400, 'visibility_not_allowed');
  const res = await env.DB.prepare(NOTE_INSERT).bind(kase.id, actor.userId, actor.party, vis, JSON.stringify({ text })).run();
  await logWrite(env, actor, 'formation_case_note', { case_uid: kase.uid, visibility: vis });
  return { ok: true, eventId: Number(res.meta?.last_row_id ?? 0) };
}

/** The visibilities an audience reads. */
export function visibleTo(audience: Audience): readonly Visibility[] {
  if (audience === 'hq') return NOTE_VISIBILITY;
  if (audience === 'partner') return ['all', 'hq_partner'];
  return ['all'];
}

const TIMELINE_SQL: Readonly<Record<Audience, string>> = Object.freeze({
  founder: "SELECT id, at, party, kind, from_stage, to_stage, visibility, detail_json FROM formation_case_events WHERE case_id = ? AND visibility = 'all' ORDER BY id",
  partner: "SELECT id, at, party, kind, from_stage, to_stage, visibility, detail_json FROM formation_case_events WHERE case_id = ? AND visibility IN ('all', 'hq_partner') ORDER BY id",
  hq: 'SELECT id, at, party, kind, from_stage, to_stage, visibility, detail_json FROM formation_case_events WHERE case_id = ? ORDER BY id',
});
// Only these detail keys leave the store: a note's text and what a request event names.
const DETAIL_KEYS = ['text', 'request_uid', 'kind', 'title', 'reason'] as const;

export interface TimelineEvent {
  id: number; at: string; party: string; kind: string; from_stage: string | null; to_stage: string | null;
  visibility: Visibility; detail: Record<string, unknown>;
}

/** A case's timeline as `audience` may read it; the filter is in the SQL. */
export async function readTimeline(env: Env, caseId: number, audience: Audience): Promise<TimelineEvent[]> {
  const rows = (await env.DB.prepare(TIMELINE_SQL[audience]).bind(caseId).all<any>()).results || [];
  return rows.map((e) => {
    let d: Record<string, unknown> = {};
    try { d = e.detail_json ? JSON.parse(String(e.detail_json)) : {}; } catch { d = {}; }
    const detail: Record<string, unknown> = {};
    for (const k of DETAIL_KEYS) if (d[k] != null) detail[k] = d[k];
    return {
      id: Number(e.id), at: String(e.at), party: String(e.party), kind: String(e.kind),
      from_stage: e.from_stage ?? null, to_stage: e.to_stage ?? null, visibility: e.visibility as Visibility, detail,
    };
  });
}

// ── The founder's reads ─────────────────────────────────────────────────────

/** The founder's view of a request: no asker id, no partner reference, no window bookkeeping. */
export function founderView(r: RequestRow & { case_uid?: string }) {
  return {
    uid: r.uid, case_uid: r.case_uid ?? null, kind: r.kind, title: r.title, body: r.body, due_on: r.due_on, state: r.state,
    asked_by: r.asked_by_party, answer_text: r.answer_text, answer_document_id: r.answer_document_id,
    bound_sha256: r.bound_sha256, filing_bound: r.filing_id != null, return_reason: r.return_reason,
    answered_at: r.answered_at, closed_at: r.closed_at, created_at: r.created_at,
  };
}

const FOUNDER_REQUESTS =
  'SELECT ' + REQUEST_COLS + ', c.uid AS case_uid FROM formation_case_requests r JOIN formation_cases c ON c.id = r.case_id '
  + "WHERE c.user_id = ? AND r.asked_of_party = 'founder'";

/** The requests asked of the founder on their own cases, newest first; `caseUid` narrows to one case. */
export async function listFounderRequests(env: Env, userId: number, caseUid?: string | null) {
  const rows = caseUid
    ? (await env.DB.prepare(FOUNDER_REQUESTS + ' AND c.uid = ? ORDER BY r.id DESC').bind(userId, caseUid).all<any>()).results
    : (await env.DB.prepare(FOUNDER_REQUESTS + ' ORDER BY r.id DESC').bind(userId).all<any>()).results;
  return (rows || []).map(founderView);
}

/** One request asked of the founder on their own case, or null: another subject's request reads as missing. */
export async function readFounderRequest(env: Env, userId: number, uid: string) {
  const row = await env.DB.prepare(FOUNDER_REQUESTS + ' AND r.uid = ?').bind(userId, uid).first<any>();
  return row || null;
}

/** The founder's own case by uid, or null. */
export async function readFounderCase(env: Env, userId: number, caseUid: string): Promise<CaseRow | null> {
  const c = await env.DB.prepare('SELECT id FROM formation_cases WHERE uid = ? AND user_id = ?').bind(caseUid, userId).first<{ id: number }>();
  return c ? readCase(env, c.id) : null;
}

/** The founder's notice that their case moved: a registry question, registration, or any other stage. */
export async function notifyCaseStage(env: Env, kase: Pick<CaseRow, 'uid' | 'user_id'>, stage: string) {
  const type = stage === 'registry_query' ? FORMATION_NOTIFY_TYPES.registryQuestion
    : stage === 'registered' ? FORMATION_NOTIFY_TYPES.registered : FORMATION_NOTIFY_TYPES.stageChanged;
  const title = stage === 'registry_query' ? 'The registry has a question about your formation'
    : stage === 'registered' ? 'Your company is registered' : 'Your formation moved to a new stage';
  await quietNotify(env, { userId: Number(kase.user_id), type, category: 'formation', title, link: '/incorporate', payload: { case_uid: kase.uid, stage } });
}
