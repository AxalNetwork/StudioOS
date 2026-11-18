/**
 * D6694 (#6694, plan key E9 of #6680) — a formation case's filings, and the
 * registration they write to the company.
 *
 * A case holds filings (formation_filings), each with a kind, a state, an
 * attempt and its evidence, and a timeline (formation_filing_events,
 * append-only). This service is their only writer. Every change is one batch:
 *
 *   1. INSERT the event, WHERE the filing is still at the state and revision
 *      that were read. It carries to_revision; (filing_id, to_revision) is
 *      unique.
 *   2. UPDATE the filing, WHERE it is still as read AND that event exists.
 *
 * So two calls from the same read change the filing once, and the second
 * answers 409 (`filing_moved`).
 *
 * THE RULES (the issue's "Done when"):
 *   - An incorporation filing is not submitted without the founder's approval
 *     of its pack: founder_approved_sha256 must equal pack_sha256. A new pack
 *     clears the approval. (The consent-to-act check is #6706's.)
 *   - An incorporation filing is not accepted without the registration number,
 *     the registry's date and the certificate document.
 *   - A rejected or withdrawn filing keeps the case at its stage; a new
 *     attempt is a new row (attempt + 1, supersedes_filing_id).
 *   - The store's CHECKs hold the same two rules, so no writer can skip them.
 *
 * V2 CASES. The incorporation filing drives the case through `transition`
 * (formationCase.ts), in that transition's batch and guarded on the filing as
 * read (`filingAsRead`):
 *   ready_to_file   markReadyToFile: preparing → ready_to_file, writing
 *                   incorporations.packet_ready_at and the pack as the order's
 *                   packet document.
 *   submitted       submit: ready_to_file → submitted (a later attempt, with
 *                   the case already at submitted, moves only the filing).
 *   registry_query  query: submitted → registry_query; answering it moves the
 *                   case back to submitted.
 *   registered      accept: the case moves to registered; the order is filed
 *                   with filed_on = the REGISTRY's date; and D1415's company
 *                   write runs with that date as incorporation_date, the
 *                   registration number, the certificate in the
 *                   certificate_of_incorporation slot and the registry's
 *                   structured address (incorporationCompany.ts). The
 *                   submission date lives only on the filing.
 *
 * LEGACY CASES (legacy_v1). Nothing changes at `filed` (markFiled, D601). A
 * logged correction (`recordLegacyRegistration`) can add the number and the
 * registry's date later, as an accepted filing recorded after the fact; it
 * fills only the company's empty fields.
 *
 * DOCUMENTS are `documents` rows named by id. Until #6651's write-once helper
 * merges, nothing here stores a file; tests use synthetic rows.
 *
 * No state without evidence a person entered (D4677): every date and number is
 * what the caller typed, checked as a calendar day not in the future.
 */
import type { Env } from '../types';
import { newUid } from '../routes/_t13t14t15_helpers';
import { isCalendarDate } from './section83b';
import { readCase, transition, type Actor, type CaseRow, type Stage } from './formationCase';
import { filingCompanyStatements, type CompanyOutcome, type RegisteredAddress } from './incorporationCompany';
import { logAdminAction } from './adminAudit';

export const FILING_KINDS = Object.freeze([
  'name_reservation', 'incorporation', 'tax_registration', 'vat', 'payroll',
  'beneficial_owner_register', 'foreign_investment_notice', 'other',
] as const);
export type FilingKind = typeof FILING_KINDS[number];
export const FILING_STATES = Object.freeze(['prepared', 'submitted', 'queried', 'accepted', 'rejected', 'withdrawn'] as const);
export type FilingState = typeof FILING_STATES[number];
export const SUBMITTING_PARTIES = Object.freeze(['founder', 'hq', 'partner', 'counsel'] as const);
export const DOCUMENT_CLASSES = Object.freeze([
  'filing_pack', 'certificate', 'registry_receipt', 'registry_query', 'rejection_notice', 'evidence', 'other',
] as const);
export const VISIBILITY = Object.freeze(['all', 'hq_partner', 'hq_only'] as const);

export interface FilingRow {
  id: number; uid: string; case_id: number; kind: FilingKind; state: FilingState; revision: number; attempt: number;
  submitted_on: string | null; decided_on: string | null; registration_number: string | null;
  certificate_document_id: number | null; pack_document_id: number | null; pack_sha256: string | null;
  founder_approved_at: string | null; founder_approved_sha256: string | null;
}

export type FilingResult =
  | { ok: true; filing: FilingRow; case?: { stage: Stage }; company?: CompanyOutcome }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

const FILING_COLS = 'id, uid, case_id, kind, state, revision, attempt, submitted_on, decided_on, registration_number, '
  + 'certificate_document_id, pack_document_id, pack_sha256, founder_approved_at, founder_approved_sha256';
const FILING_BY_ID = 'SELECT ' + FILING_COLS + ' FROM formation_filings WHERE id = ?';
const FILING_BY_UID = 'SELECT ' + FILING_COLS + ' FROM formation_filings WHERE uid = ?';
const DOC_EXISTS = 'SELECT id FROM documents WHERE id = ?';

// Step 1: the event, written only while the filing is as read.
const FILING_AS_READ = 'EXISTS (SELECT 1 FROM formation_filings WHERE id = ? AND state = ? AND revision = ?)';
const EVENT_INSERT =
  'INSERT INTO formation_filing_events (filing_id, from_state, to_state, to_revision, occurred_on, recorded_by, evidence_document_id, detail_json) '
  + 'SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ' + FILING_AS_READ;
// A filing change a case transition carries also waits for the case to have moved.
const CASE_MOVED = 'EXISTS (SELECT 1 FROM formation_cases WHERE id = ? AND stage = ? AND revision = ?)';
const EVENT_INSERT_AFTER_CASE = EVENT_INSERT + ' AND ' + CASE_MOVED;
// Step 2: the filing, while it is as read and its event exists. A NULL leaves a column as it was.
const FILING_UPDATE =
  'UPDATE formation_filings SET state = ?, revision = revision + 1, '
  + 'submitted_on = COALESCE(?, submitted_on), reference = COALESCE(?, reference), decided_on = COALESCE(?, decided_on), '
  + 'rejection_reason = COALESCE(?, rejection_reason), registration_number = COALESCE(?, registration_number), '
  + 'certificate_document_id = COALESCE(?, certificate_document_id), '
  + "updated_at = datetime('now') "
  + 'WHERE id = ? AND state = ? AND revision = ? '
  + 'AND EXISTS (SELECT 1 FROM formation_filing_events WHERE filing_id = ? AND to_revision = ?)';
// A new pack clears any approval; an approval names the pack hash it approved.
const PACK_UPDATE =
  'UPDATE formation_filings SET pack_document_id = ?, pack_sha256 = ?, founder_approved_at = NULL, founder_approved_sha256 = NULL, '
  + "founder_approval_request_id = NULL, revision = revision + 1, updated_at = datetime('now') "
  + 'WHERE id = ? AND state = ? AND revision = ? '
  + 'AND EXISTS (SELECT 1 FROM formation_filing_events WHERE filing_id = ? AND to_revision = ?)';
const APPROVE_UPDATE =
  "UPDATE formation_filings SET founder_approved_at = datetime('now'), founder_approved_sha256 = pack_sha256, "
  + "founder_approval_request_id = ?, revision = revision + 1, updated_at = datetime('now') "
  + 'WHERE id = ? AND state = ? AND revision = ? AND pack_sha256 = ? '
  + 'AND EXISTS (SELECT 1 FROM formation_filing_events WHERE filing_id = ? AND to_revision = ?)';
const CASE_DOC_INSERT =
  'INSERT OR IGNORE INTO formation_case_documents (uid, case_id, filing_id, document_id, class, visible_to, added_by) '
  + 'SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM documents WHERE id = ?)';
const CASE_DOC_INSERT_AFTER_CASE = CASE_DOC_INSERT + ' AND ' + CASE_MOVED;

const SHA256 = /^[0-9a-f]{64}$/;
const today = () => new Date().toISOString().slice(0, 10);
const clean = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const fail = (status: 400 | 403 | 404 | 409, error: string): FilingResult => ({ ok: false, status, error });

export async function readFiling(env: Env, id: number): Promise<FilingRow | null> {
  if (!posInt(id)) return null;
  return (await env.DB.prepare(FILING_BY_ID).bind(id).first<FilingRow>()) || null;
}

/** A day the person typed: a calendar day, not after today. */
function dayError(v: unknown, field: string, now: string): string | null {
  if (!isCalendarDate(v)) return `${field}_invalid`;
  if ((v as string) > now) return `${field}_future`;
  return null;
}

async function documentExists(env: Env, id: number | null): Promise<boolean> {
  return id != null && !!(await env.DB.prepare(DOC_EXISTS).bind(id).first());
}

interface Change {
  to: FilingState; occurredOn?: string | null; evidenceDocumentId?: number | null; detail?: Record<string, unknown>;
  set?: { submitted_on?: string | null; reference?: string | null; decided_on?: string | null; rejection_reason?: string | null;
    registration_number?: string | null; certificate_document_id?: number | null };
}

/** The two statements of one filing change; `afterCase` adds the guard that the case moved first. */
function changeStatements(env: Env, f: FilingRow, c: Change, actor: Actor, afterCase?: { caseId: number; stage: Stage; revision: number }) {
  const next = f.revision + 1;
  const set = c.set || {};
  const read = [f.id, f.state, f.revision];
  const event = env.DB.prepare(afterCase ? EVENT_INSERT_AFTER_CASE : EVENT_INSERT).bind(
    f.id, f.state, c.to, next, c.occurredOn ?? null, actor.userId ?? null, c.evidenceDocumentId ?? null,
    JSON.stringify({ party: actor.party, ...(c.detail || {}) }), ...read,
    ...(afterCase ? [afterCase.caseId, afterCase.stage, afterCase.revision] : []),
  );
  const update = env.DB.prepare(FILING_UPDATE).bind(
    c.to, set.submitted_on ?? null, set.reference ?? null, set.decided_on ?? null, set.rejection_reason ?? null,
    set.registration_number ?? null, set.certificate_document_id ?? null, ...read, f.id, next,
  );
  return [event, update];
}

/** A filing-only change: the two statements, then the filing as it now is, or 409 when it moved in between. */
async function applyChange(env: Env, f: FilingRow, c: Change, actor: Actor, extra: D1PreparedStatement[] = []): Promise<FilingResult> {
  const results = await env.DB.batch([...changeStatements(env, f, c, actor), ...extra]);
  if (!(Number(results[1]?.meta?.changes ?? 0) > 0)) return fail(409, 'filing_moved');
  return { ok: true, filing: (await readFiling(env, f.id))! };
}

/** A filing change carried by a case transition: both move in one batch, or neither does. */
async function applyWithCase(
  env: Env, f: FilingRow, c: Change, actor: Actor, kase: CaseRow, to: Stage,
  payload: { orderSet?: Record<string, unknown>; orderNow?: string[]; extra?: D1PreparedStatement[] } = {},
): Promise<FilingResult> {
  const after = { caseId: kase.id, stage: to, revision: kase.revision + 1 };
  const t = await transition(env, kase.id, to, actor, {
    orderSet: payload.orderSet, orderNow: payload.orderNow,
    extra: [...changeStatements(env, f, c, actor, after), ...(payload.extra || [])],
    filingAsRead: { id: f.id, state: f.state }, expectRevision: kase.revision,
    detail: { filing_uid: f.uid, filing_kind: f.kind, filing_to: c.to },
  });
  if (!t.ok) return fail(409, t.error === 'case_moved' ? 'filing_moved' : t.error);
  const filing = (await readFiling(env, f.id))!;
  // The batch held: the case moved only with its filing event, and the filing update ran right after it.
  if (filing.state !== c.to) return fail(409, 'filing_moved');
  return { ok: true, filing, case: { stage: to } };
}

async function openCase(env: Env, caseId: number): Promise<CaseRow | FilingResult> {
  const kase = await readCase(env, caseId);
  if (!kase) return fail(404, 'case_not_found');
  if (kase.closed_at) return fail(409, 'case_closed');
  return kase;
}
const isFail = (x: unknown): x is FilingResult => !!x && typeof x === 'object' && 'ok' in (x as object);

async function filingAndCase(env: Env, filingId: number): Promise<{ f: FilingRow; kase: CaseRow } | FilingResult> {
  const f = await readFiling(env, filingId);
  if (!f) return fail(404, 'filing_not_found');
  const kase = await openCase(env, f.case_id);
  if (isFail(kase)) return kase;
  return { f, kase };
}

/** A v2 case's incorporation filing moves the case; everything else moves only the filing. */
const drivesCase = (f: FilingRow, kase: CaseRow) => f.kind === 'incorporation' && kase.track === 'v2';

// ── Writes ──────────────────────────────────────────────────────────────────

export interface NewFiling {
  kind: unknown; authorityName?: unknown; submittedByParty?: unknown; packDocumentId?: unknown; packSha256?: unknown;
}

/** A new filing at `prepared`: attempt 1, or the next attempt after a rejected or withdrawn one. */
export async function createFiling(env: Env, caseId: number, input: NewFiling, actor: Actor): Promise<FilingResult> {
  const kase = await openCase(env, caseId);
  if (isFail(kase)) return kase;
  const kind = String(input.kind ?? '');
  if (!(FILING_KINDS as readonly string[]).includes(kind)) return fail(400, 'kind_invalid');
  const party = input.submittedByParty == null ? null : String(input.submittedByParty);
  if (party != null && !(SUBMITTING_PARTIES as readonly string[]).includes(party)) return fail(400, 'submitted_by_party_invalid');
  const packDoc = input.packDocumentId == null ? null : posInt(input.packDocumentId);
  if (input.packDocumentId != null && (!packDoc || !(await documentExists(env, packDoc)))) return fail(400, 'pack_document_not_found');
  const sha = input.packSha256 == null ? null : String(input.packSha256);
  if (sha != null && !SHA256.test(sha)) return fail(400, 'pack_sha256_invalid');
  if ((packDoc == null) !== (sha == null)) return fail(400, 'pack_needs_document_and_sha256');

  const prior = await env.DB.prepare(
    'SELECT id, state, attempt FROM formation_filings WHERE case_id = ? AND kind = ? ORDER BY attempt DESC LIMIT 1',
  ).bind(kase.id, kind).first<{ id: number; state: string; attempt: number }>();
  if (prior && prior.state !== 'rejected' && prior.state !== 'withdrawn') return fail(409, 'filing_live');
  const uid = newUid();
  const attempt = (prior?.attempt ?? 0) + 1;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO formation_filings (uid, case_id, kind, authority_name, submitted_by_party, pack_document_id, pack_sha256, attempt, supersedes_filing_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(uid, kase.id, kind, clean(input.authorityName), party, packDoc, sha, attempt, prior?.id ?? null, actor.userId ?? null),
      env.DB.prepare(
        `INSERT INTO formation_filing_events (filing_id, from_state, to_state, to_revision, recorded_by, detail_json)
         SELECT id, NULL, 'prepared', 0, ?, ? FROM formation_filings WHERE uid = ?`,
      ).bind(actor.userId ?? null, JSON.stringify({ party: actor.party, attempt, supersedes_filing_id: prior?.id ?? null }), uid),
      ...(packDoc ? [env.DB.prepare(
        `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, filing_id, document_id, class, visible_to, added_by)
         SELECT ?, case_id, id, ?, 'filing_pack', 'all', ? FROM formation_filings WHERE uid = ?`,
      ).bind(newUid(), packDoc, actor.userId ?? null, uid)] : []),
    ]);
  } catch (e) {
    // The live-filing index and the attempt key: another call made this filing first.
    if (/UNIQUE/i.test(String((e as Error)?.message))) return fail(409, 'filing_live');
    throw e;
  }
  return { ok: true, filing: (await env.DB.prepare(FILING_BY_UID).bind(uid).first<FilingRow>())! };
}

/** A new pack on a prepared filing. It clears the founder's approval: an approval is of one pack. */
export async function setPack(env: Env, filingId: number, input: { packDocumentId: unknown; packSha256: unknown }, actor: Actor): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f } = fc;
  if (f.state !== 'prepared') return fail(409, 'filing_not_prepared');
  const doc = posInt(input.packDocumentId);
  if (!doc || !(await documentExists(env, doc))) return fail(400, 'pack_document_not_found');
  const sha = String(input.packSha256 ?? '');
  if (!SHA256.test(sha)) return fail(400, 'pack_sha256_invalid');
  const next = f.revision + 1;
  const results = await env.DB.batch([
    env.DB.prepare(EVENT_INSERT).bind(f.id, f.state, f.state, next, null, actor.userId ?? null, null,
      JSON.stringify({ party: actor.party, pack: { document_id: doc, sha256: sha }, approval_cleared: f.founder_approved_at != null }),
      f.id, f.state, f.revision),
    env.DB.prepare(PACK_UPDATE).bind(doc, sha, f.id, f.state, f.revision, f.id, next),
    env.DB.prepare(CASE_DOC_INSERT).bind(newUid(), f.case_id, f.id, doc, 'filing_pack', 'all', actor.userId ?? null, doc),
  ]);
  if (!(Number(results[1]?.meta?.changes ?? 0) > 0)) return fail(409, 'filing_moved');
  return { ok: true, filing: (await readFiling(env, f.id))! };
}

/**
 * The founder approves the pack, by its hash. The hash they saw must be the
 * filing's current pack_sha256; the approval records it.
 */
export async function approvePack(
  env: Env, filingId: number, input: { packSha256: unknown; approvalRequestId?: unknown }, actor: Actor,
): Promise<FilingResult> {
  if (actor.party !== 'founder') return fail(403, 'founder_only');
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (actor.userId == null || Number(actor.userId) !== Number(kase.user_id)) return fail(403, 'founder_only');
  if (f.state !== 'prepared') return fail(409, 'filing_not_prepared');
  if (!f.pack_sha256) return fail(409, 'pack_missing');
  const sha = String(input.packSha256 ?? '');
  if (sha !== f.pack_sha256) return fail(409, 'pack_changed');
  const request = input.approvalRequestId == null ? null : posInt(input.approvalRequestId);
  const next = f.revision + 1;
  const results = await env.DB.batch([
    env.DB.prepare(EVENT_INSERT).bind(f.id, f.state, f.state, next, null, actor.userId, null,
      JSON.stringify({ party: 'founder', approved_sha256: sha, approval_request_id: request }), f.id, f.state, f.revision),
    env.DB.prepare(APPROVE_UPDATE).bind(request, f.id, f.state, f.revision, sha, f.id, next),
  ]);
  if (!(Number(results[1]?.meta?.changes ?? 0) > 0)) return fail(409, 'filing_moved');
  return { ok: true, filing: (await readFiling(env, f.id))! };
}

/**
 * V2: the case moves preparing → ready_to_file with its prepared incorporation
 * filing's pack. incorporations.packet_ready_at is stamped and the pack becomes
 * the order's packet document, in the same batch.
 */
export async function markReadyToFile(env: Env, filingId: number, actor: Actor): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (!drivesCase(f, kase)) return fail(409, 'not_a_v2_incorporation_filing');
  if (f.state !== 'prepared') return fail(409, 'filing_not_prepared');
  if (!f.pack_document_id || !f.pack_sha256) return fail(409, 'pack_missing');
  if (kase.stage !== 'preparing') return fail(409, 'case_not_preparing');
  const t = await transition(env, kase.id, 'ready_to_file', actor, {
    orderSet: { packet_document_id: f.pack_document_id, packet_ready_by: actor.userId ?? null }, orderNow: ['packet_ready_at'],
    filingAsRead: { id: f.id, state: f.state }, expectRevision: kase.revision,
    detail: { step: 'ready_to_file', filing_uid: f.uid, pack_sha256: f.pack_sha256 },
  });
  if (!t.ok) return fail(409, t.error === 'case_moved' ? 'filing_moved' : t.error);
  return { ok: true, filing: f, case: { stage: 'ready_to_file' } };
}

/**
 * The filing was submitted on `submittedOn`. An incorporation filing needs the
 * founder's approval of its current pack. On a v2 case at ready_to_file the
 * case moves to submitted with it.
 */
export async function submitFiling(
  env: Env, filingId: number, input: { submittedOn: unknown; reference?: unknown; evidenceDocumentId?: unknown },
  actor: Actor, now = today(),
): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (f.state !== 'prepared') return fail(409, 'filing_not_prepared');
  const bad = dayError(input.submittedOn, 'submitted_on', now);
  if (bad) return fail(400, bad);
  if (f.kind === 'incorporation') {
    if (!f.pack_sha256 || !f.founder_approved_at || f.founder_approved_sha256 !== f.pack_sha256) return fail(409, 'founder_approval_required');
  }
  const evidence = input.evidenceDocumentId == null ? null : posInt(input.evidenceDocumentId);
  if (input.evidenceDocumentId != null && (!evidence || !(await documentExists(env, evidence)))) return fail(400, 'evidence_document_not_found');
  const change: Change = {
    to: 'submitted', occurredOn: input.submittedOn as string, evidenceDocumentId: evidence,
    set: { submitted_on: input.submittedOn as string, reference: clean(input.reference) },
  };
  if (drivesCase(f, kase) && kase.stage === 'ready_to_file') {
    return applyWithCase(env, f, change, actor, kase, 'submitted', {
      extra: evidence ? [env.DB.prepare(CASE_DOC_INSERT_AFTER_CASE).bind(newUid(), kase.id, f.id, evidence, 'registry_receipt', 'hq_partner', actor.userId ?? null, evidence, kase.id, 'submitted', kase.revision + 1)] : [],
    });
  }
  if (drivesCase(f, kase) && kase.stage !== 'submitted') return fail(409, 'case_not_ready_to_file');
  return applyChange(env, f, change, actor, evidence ? [caseDoc(env, kase.id, f.id, evidence, 'registry_receipt', 'hq_partner', actor)] : []);
}

/** The registry asked a question. A v2 case at submitted moves to registry_query. */
export async function queryFiling(
  env: Env, filingId: number, input: { occurredOn: unknown; evidenceDocumentId?: unknown; note?: unknown }, actor: Actor, now = today(),
): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (f.state !== 'submitted') return fail(409, 'filing_not_submitted');
  const bad = dayError(input.occurredOn, 'occurred_on', now);
  if (bad) return fail(400, bad);
  const evidence = input.evidenceDocumentId == null ? null : posInt(input.evidenceDocumentId);
  if (input.evidenceDocumentId != null && (!evidence || !(await documentExists(env, evidence)))) return fail(400, 'evidence_document_not_found');
  const change: Change = { to: 'queried', occurredOn: input.occurredOn as string, evidenceDocumentId: evidence, detail: { note: clean(input.note, 1000) } };
  if (drivesCase(f, kase) && kase.stage === 'submitted') return applyWithCase(env, f, change, actor, kase, 'registry_query');
  return applyChange(env, f, change, actor);
}

/** The query was answered: the filing is submitted again; a v2 case at registry_query moves back to submitted. */
export async function answerQuery(
  env: Env, filingId: number, input: { occurredOn: unknown; evidenceDocumentId?: unknown }, actor: Actor, now = today(),
): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (f.state !== 'queried') return fail(409, 'filing_not_queried');
  const bad = dayError(input.occurredOn, 'occurred_on', now);
  if (bad) return fail(400, bad);
  const evidence = input.evidenceDocumentId == null ? null : posInt(input.evidenceDocumentId);
  if (input.evidenceDocumentId != null && (!evidence || !(await documentExists(env, evidence)))) return fail(400, 'evidence_document_not_found');
  const change: Change = { to: 'submitted', occurredOn: input.occurredOn as string, evidenceDocumentId: evidence, detail: { answered_query: true } };
  if (drivesCase(f, kase) && kase.stage === 'registry_query') return applyWithCase(env, f, change, actor, kase, 'submitted');
  return applyChange(env, f, change, actor);
}

/**
 * The registry rejected the filing. The case stays at its stage; the next
 * attempt is a new filing (`createFiling`).
 */
export async function rejectFiling(
  env: Env, filingId: number, input: { decidedOn: unknown; reason: unknown; evidenceDocumentId?: unknown }, actor: Actor, now = today(),
): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (f.state !== 'submitted' && f.state !== 'queried') return fail(409, 'filing_not_submitted');
  const bad = dayError(input.decidedOn, 'decided_on', now);
  if (bad) return fail(400, bad);
  if (f.submitted_on && (input.decidedOn as string) < f.submitted_on) return fail(400, 'decided_on_before_submission');
  const reason = clean(input.reason, 1000);
  if (!reason) return fail(400, 'rejection_reason_required');
  const evidence = input.evidenceDocumentId == null ? null : posInt(input.evidenceDocumentId);
  if (input.evidenceDocumentId != null && (!evidence || !(await documentExists(env, evidence)))) return fail(400, 'evidence_document_not_found');
  return applyChange(env, f, {
    to: 'rejected', occurredOn: input.decidedOn as string, evidenceDocumentId: evidence,
    set: { decided_on: input.decidedOn as string, rejection_reason: reason },
  }, actor, evidence ? [caseDoc(env, kase.id, f.id, evidence, 'rejection_notice', 'hq_partner', actor)] : []);
}

/** The filing is withdrawn (before a decision). The case stays at its stage. */
export async function withdrawFiling(env: Env, filingId: number, input: { reason: unknown }, actor: Actor): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f } = fc;
  if (!['prepared', 'submitted', 'queried'].includes(f.state)) return fail(409, 'filing_decided');
  const reason = clean(input.reason, 1000);
  if (!reason) return fail(400, 'reason_required');
  return applyChange(env, f, { to: 'withdrawn', detail: { reason } }, actor);
}

export interface Acceptance {
  decidedOn: unknown; registrationNumber: unknown; certificateDocumentId: unknown;
  address?: RegisteredAddress | null; evidenceDocumentId?: unknown;
}

/** Validate an acceptance's facts: the registry's date, number and certificate. */
async function acceptanceFacts(env: Env, input: Acceptance, f: Pick<FilingRow, 'kind' | 'submitted_on'>, now: string) {
  const bad = dayError(input.decidedOn, 'decided_on', now);
  if (bad) return { error: bad.replace('decided_on', 'registry_date') } as const;
  if (f.submitted_on && (input.decidedOn as string) < f.submitted_on) return { error: 'registry_date_before_submission' } as const;
  const number = clean(input.registrationNumber, 100);
  const cert = input.certificateDocumentId == null ? null : posInt(input.certificateDocumentId);
  if (f.kind === 'incorporation') {
    if (!number) return { error: 'registration_number_required' } as const;
    if (!cert) return { error: 'certificate_required' } as const;
  }
  if (cert != null && !(await documentExists(env, cert))) return { error: 'certificate_document_not_found' } as const;
  const evidence = input.evidenceDocumentId == null ? null : posInt(input.evidenceDocumentId);
  if (input.evidenceDocumentId != null && (!evidence || !(await documentExists(env, evidence)))) return { error: 'evidence_document_not_found' } as const;
  const a = input.address;
  if (a != null && (!clean(a.line1) || !/^[A-Z]{2}$/.test(String(a.country || '')))) return { error: 'address_invalid' } as const;
  return { decidedOn: input.decidedOn as string, number, cert, evidence, address: a ?? null } as const;
}

/**
 * The registry accepted the filing, on `decidedOn`, with this number and
 * certificate. For a v2 case's incorporation filing the case moves to
 * registered, the order is filed with filed_on = the registry's date, and the
 * company is written (D1415, extended here) in the same batch.
 */
export async function acceptFiling(env: Env, filingId: number, input: Acceptance, actor: Actor, now = today()): Promise<FilingResult> {
  const fc = await filingAndCase(env, filingId);
  if (isFail(fc)) return fc;
  const { f, kase } = fc;
  if (f.state !== 'submitted' && f.state !== 'queried') return fail(409, 'filing_not_submitted');
  const facts = await acceptanceFacts(env, input, f, now);
  if ('error' in facts) return fail(400, facts.error!);
  const change: Change = {
    to: 'accepted', occurredOn: facts.decidedOn, evidenceDocumentId: facts.evidence,
    set: { decided_on: facts.decidedOn, registration_number: facts.number, certificate_document_id: facts.cert },
  };
  if (!drivesCase(f, kase)) {
    const docs = facts.cert ? [caseDoc(env, kase.id, f.id, facts.cert, 'certificate', 'all', actor)] : [];
    if (f.kind === 'incorporation' && kase.track === 'legacy_v1') return fail(409, 'use_legacy_correction');
    return applyChange(env, f, change, actor, docs);
  }
  if (!['ready_to_file', 'submitted', 'registry_query'].includes(kase.stage)) return fail(409, 'case_not_awaiting_registry');

  const order = await env.DB.prepare(
    `SELECT i.id, i.project_id, i.subject_company_id, i.company_name, i.jurisdiction_id, i.registered_agent_name, i.registered_agent_address
       FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id
      WHERE o.case_id = ? ORDER BY o.id DESC LIMIT 1`,
  ).bind(kase.id).first<any>();
  if (!order) return fail(409, 'case_has_no_order');
  const adminId = Number(actor.userId ?? 0);
  const { statements, outcome } = await filingCompanyStatements(env, order, facts.decidedOn, adminId, {
    number: facts.number!, certificateDocumentId: facts.cert!, address: facts.address,
  });
  const after = [kase.id, 'registered', kase.revision + 1];
  const r = await applyWithCase(env, f, change, actor, kase, 'registered', {
    orderSet: { filed_on: facts.decidedOn, filed_by: actor.userId ?? null }, orderNow: ['filed_recorded_at'],
    extra: [
      env.DB.prepare(CASE_DOC_INSERT_AFTER_CASE).bind(newUid(), kase.id, f.id, facts.cert, 'certificate', 'all', actor.userId ?? null, facts.cert, ...after),
      ...statements,
    ],
  });
  if (!r.ok) return r;
  return { ...r, company: outcome };
}

/**
 * LEGACY CORRECTION. A legacy_v1 order filed under D601 recorded the
 * submission date only. This records the registry's number, date and
 * certificate later, as an accepted incorporation filing marked
 * recorded_after_the_fact, and fills only the company's EMPTY fields: its
 * incorporation_date, written from the submission date at filing, stays. HQ
 * only, and logged (logAdminAction). The order and the case do not change.
 */
export async function recordLegacyRegistration(
  env: Env, caseId: number, input: Acceptance, actor: Actor, now = today(),
): Promise<FilingResult> {
  if (actor.party !== 'hq' || actor.userId == null) return fail(403, 'hq_only');
  const kase = await openCase(env, caseId);
  if (isFail(kase)) return kase;
  if (kase.track !== 'legacy_v1') return fail(409, 'case_not_legacy');
  if (kase.stage !== 'registered') return fail(409, 'case_not_registered');
  const order = await env.DB.prepare(
    `SELECT i.id, i.company_id, i.filed_on FROM formation_case_orders o JOIN incorporations i ON i.id = o.incorporation_id
      WHERE o.case_id = ? AND i.status = 'filed' ORDER BY o.id DESC LIMIT 1`,
  ).bind(kase.id).first<{ id: number; company_id: number | null; filed_on: string | null }>();
  if (!order) return fail(409, 'order_not_filed');
  const facts = await acceptanceFacts(env, input, { kind: 'incorporation', submitted_on: order.filed_on }, now);
  if ('error' in facts) return fail(400, facts.error!);
  const prior = await env.DB.prepare(
    "SELECT id, state, attempt FROM formation_filings WHERE case_id = ? AND kind = 'incorporation' ORDER BY attempt DESC LIMIT 1",
  ).bind(kase.id).first<{ id: number; state: string; attempt: number }>();
  if (prior && prior.state !== 'rejected' && prior.state !== 'withdrawn') return fail(409, 'filing_live');
  const uid = newUid();
  const company = order.company_id;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO formation_filings (uid, case_id, kind, submitted_by_party, submitted_on, state, decided_on, registration_number,
         certificate_document_id, attempt, supersedes_filing_id, recorded_after_the_fact, created_by)
       VALUES (?, ?, 'incorporation', 'hq', ?, 'accepted', ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(uid, kase.id, order.filed_on, facts.decidedOn, facts.number, facts.cert, (prior?.attempt ?? 0) + 1, prior?.id ?? null, actor.userId),
    env.DB.prepare(
      `INSERT INTO formation_filing_events (filing_id, from_state, to_state, to_revision, occurred_on, recorded_by, evidence_document_id, detail_json)
       SELECT id, NULL, 'accepted', 0, ?, ?, ?, ? FROM formation_filings WHERE uid = ?`,
    ).bind(facts.decidedOn, actor.userId, facts.evidence, JSON.stringify({ party: 'hq', correction: 'legacy_registration', incorporation_id: order.id }), uid),
    env.DB.prepare(
      `INSERT OR IGNORE INTO formation_case_documents (uid, case_id, filing_id, document_id, class, visible_to, added_by)
       SELECT ?, case_id, id, ?, 'certificate', 'all', ? FROM formation_filings WHERE uid = ?`,
    ).bind(newUid(), facts.cert, actor.userId, uid),
  ];
  if (company != null) {
    statements.push(env.DB.prepare(
      `UPDATE company_profiles SET registration_number = COALESCE(registration_number, ?), updated_at = datetime('now')
        WHERE id = ? AND archived_at IS NULL`,
    ).bind(facts.number, company));
    statements.push(env.DB.prepare(
      `INSERT INTO documents (project_id, company_id, title, doc_type, status, content, template_name, uploaded_by)
       SELECT NULL, ?, src.title, 'certificate_of_incorporation', src.status, src.content, src.template_name, ?
         FROM documents src WHERE src.id = ?
          AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.company_id = ? AND d.project_id IS NULL AND d.doc_type = 'certificate_of_incorporation')
          AND EXISTS (SELECT 1 FROM company_profiles WHERE id = ? AND archived_at IS NULL)`,
    ).bind(company, actor.userId, facts.cert, company, company));
  }
  try {
    await env.DB.batch(statements);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return fail(409, 'filing_live');
    throw e;
  }
  if (actor.email) {
    await logAdminAction(env, actor.userId, actor.email, 'formation_legacy_registration', {
      case_uid: kase.uid, incorporation_id: order.id, filing_uid: uid, registry_date: facts.decidedOn,
    });
  }
  return { ok: true, filing: (await env.DB.prepare(FILING_BY_UID).bind(uid).first<FilingRow>())! };
}

function caseDoc(env: Env, caseId: number, filingId: number | null, documentId: number, cls: string, visibleTo: string, actor: Actor) {
  return env.DB.prepare(CASE_DOC_INSERT).bind(newUid(), caseId, filingId, documentId, cls, visibleTo, actor.userId ?? null, documentId);
}

/** A document the case holds, by class and who may see it. Adding the same one twice changes nothing. */
export async function attachCaseDocument(
  env: Env, caseId: number, input: { documentId: unknown; class: unknown; visibleTo?: unknown; filingId?: unknown }, actor: Actor,
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const kase = await readCase(env, caseId);
  if (!kase) return { ok: false, status: 404, error: 'case_not_found' };
  const doc = posInt(input.documentId);
  if (!doc || !(await documentExists(env, doc))) return { ok: false, status: 400, error: 'document_not_found' };
  const cls = String(input.class ?? '');
  if (!(DOCUMENT_CLASSES as readonly string[]).includes(cls)) return { ok: false, status: 400, error: 'class_invalid' };
  const vis = input.visibleTo == null ? 'hq_only' : String(input.visibleTo);
  if (!(VISIBILITY as readonly string[]).includes(vis)) return { ok: false, status: 400, error: 'visible_to_invalid' };
  let filing: number | null = null;
  if (input.filingId != null) {
    const f = await readFiling(env, Number(input.filingId));
    if (!f || f.case_id !== kase.id) return { ok: false, status: 400, error: 'filing_not_on_case' };
    filing = f.id;
  }
  await caseDoc(env, kase.id, filing, doc, cls, vis, actor).run();
  return { ok: true };
}
