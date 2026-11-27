/**
 * D983 (#2774, part 2 of #2376) — a studio's program requests, checked
 * against HQ's grants (D982's store, migration 553) at the door that records
 * them, and HQ's answer.
 *
 * WHERE THE CHECKS RUN. A request's fields are `services/escalationRequests.ts`'s
 * rule, which a branch applies too. Whether the program can be asked for
 * needs HQ's grants, which only HQ holds, so it runs where HQ records the
 * request: `recordLicenceRequest` (HQ's own lane) and `recordEscalation` (a
 * branch's "To HQ" lane, over RPC). Both call `checkProgramRequest`.
 *
 *   - `program_grant`: the program is one HQ offers (D982's readiness and its
 *     "can be granted" switch), and the studio does not already hold it
 *     (granted or paused). An ended grant may be asked for again.
 *   - `program_terms_change` and `program_end`: the studio holds the program,
 *     granted or paused. A terms change names a term that applies to it.
 *   - Any of the three: no request of the same kind for the same program
 *     (and, for a terms change, the same term) is already open on this
 *     licence. A second one would be the same question.
 *
 * WHAT THE TERM STANDS AT is read from the grant here, never sent (GR9's
 * "As it stands · read only"). A term nobody set reads "Not recorded" (D797).
 *
 * HQ'S ANSWER (`answerProgramRequest`, D983 §4). An approval is a decision,
 * not a grant: "Grant" stays part 1's write. Approving a grant request
 * records the draft, the program and the terms HQ means to grant, as one
 * `program_changed` event (`request_approved`), and part 6's "Finish grant"
 * opens part 1's grant with it. Declining records the reason the studio
 * reads (`request_declined`). Either is the request's one answer.
 */
import type { Env } from '../types';
import { PROGRAMS, programOf, readinessRefusal, termsFor, validateTerms, type Terms } from './programGrants';
import { PROGRAM_REQUEST_KINDS, isProgramRequestKind } from './escalationRequests';

export const NOT_RECORDED = 'Not recorded';

export const PROGRAM_REQUEST_REFUSALS = {
  program_not_offered: 'HQ does not offer this program to studios.',
  program_already_held: 'Your studio already holds this program. Ask for a change to its terms instead.',
  program_not_held: 'Your studio does not hold this program, so there is nothing to change or end. Ask for it instead.',
  program_term_not_for_program: 'That term does not apply to this program.',
  program_request_open: 'A request of this kind for this program is already open with HQ. Add to that one.',
} as const;
export type ProgramRefusalCode = keyof typeof PROGRAM_REQUEST_REFUSALS;

const refuse = (error: ProgramRefusalCode) => ({ ok: false as const, error, message: PROGRAM_REQUEST_REFUSALS[error] });

/** A term's stored value as the studio reads it. */
export function termText(value: unknown): string {
  if (value === null || value === undefined || value === '') return NOT_RECORDED;
  return String(value);
}

/**
 * One program request checked against the licence's grants. `licenceId` is
 * HQ's `territory_licences.id`; null means the ledger has no such licence,
 * so nothing can be checked and the request is refused as not held for a
 * change and not offered for a grant only on the program's own rule.
 * `openOnLicence` counts the open requests of this kind for this program, on
 * whichever lane the caller writes.
 */
export async function checkProgramRequest(
  env: Env,
  licenceId: number | null,
  kind: string,
  request: Record<string, unknown>,
  openOnLicence: number,
): Promise<{ ok: true; request: Record<string, unknown> } | { ok: false; error: ProgramRefusalCode; message: string }> {
  if (!isProgramRequestKind(kind)) return { ok: true, request };
  const key = String(request.program);
  if (openOnLicence > 0) return refuse('program_request_open');
  const grant = licenceId == null ? null : await env.DB.prepare(
    `SELECT * FROM program_grants WHERE licence_id = ? AND program_key = ?`,
  ).bind(licenceId, key).first<Record<string, unknown>>();
  const held = Boolean(grant && (grant.state === 'granted' || grant.state === 'paused'));

  if (kind === 'program_grant') {
    if (readinessRefusal(key)) return refuse('program_not_offered');
    const d = await env.DB.prepare(`SELECT grantable FROM program_grant_defaults WHERE program_key = ?`)
      .bind(key).first<{ grantable: number }>();
    if (!d || Number(d.grantable) !== 1) return refuse('program_not_offered');
    if (held) return refuse('program_already_held');
    return { ok: true, request: { program: key } };
  }
  if (!held) return refuse('program_not_held');
  if (kind === 'program_end') return { ok: true, request: { program: key } };
  const term = String(request.term);
  if (!termsFor(key).includes(term)) return refuse('program_term_not_for_program');
  return { ok: true, request: { program: key, term, current: termText(grant![term]), asked: request.asked } };
}

/** The same question: the same program, and for a terms change the same term. */
const sameQuestion = (detail: string | null, request: Record<string, unknown>) => {
  const other = requestIn(detail);
  if (!other || other.program !== request.program) return false;
  return request.term === undefined || other.term === request.term;
};

/** The open requests asking the same question, on HQ's tier, for one licence. */
export async function openOnHqTier(env: Env, licenceUid: string, kind: string, request: Record<string, unknown>) {
  const rows = ((await env.DB.prepare(
    `SELECT detail FROM hq_escalations WHERE branch_code = 'hq' AND subject_ref = ? AND kind = ? AND status = 'open'`,
  ).bind(licenceUid, kind).all<{ detail: string | null }>()).results || []);
  return rows.filter((r) => sameQuestion(r.detail, request)).length;
}

/** The open requests asking the same question, from one branch. */
export async function openFromBranch(env: Env, branchCode: string, kind: string, request: Record<string, unknown>) {
  const rows = ((await env.DB.prepare(
    `SELECT detail FROM hq_escalations WHERE branch_code = ? AND kind = ? AND status = 'open'`,
  ).bind(branchCode, kind).all<{ detail: string | null }>()).results || []);
  return rows.filter((r) => sameQuestion(r.detail, request)).length;
}

/** The open program requests from one branch, every kind: the branch lane's share of the open-request cap. */
export async function openProgramRequestsFromBranch(env: Env, branchCode: string) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM hq_escalations WHERE branch_code = ? AND status = 'open' AND kind IN (?, ?, ?)`,
  ).bind(branchCode, ...PROGRAM_REQUEST_KINDS).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** The request a stored row carries, or null. */
export function requestIn(detail: string | null | undefined): Record<string, unknown> | null {
  if (typeof detail !== 'string' || !detail.startsWith('{"v":')) return null;
  try {
    const o = JSON.parse(detail);
    return o && o.request && typeof o.request === 'object' && typeof o.request.program === 'string' ? o.request : null;
  } catch { return null; }
}

/** The licence a request belongs to: its subject on HQ's tier, or its branch's deployment. */
export async function licenceOfRequest(env: Env, row: { branch_code: string; subject_ref: string | null }) {
  if (row.branch_code === 'hq') {
    return row.subject_ref ? env.DB.prepare(
      `SELECT id, uid, licence_ref, brand_name, status FROM territory_licences WHERE uid = ?`,
    ).bind(row.subject_ref).first<{ id: number; uid: string; licence_ref: string | null; brand_name: string | null; status: string }>() : null;
  }
  return env.DB.prepare(
    `SELECT l.id, l.uid, l.licence_ref, l.brand_name, l.status
       FROM licence_deployments d JOIN territory_licences l ON l.uid = d.licence_uid
      WHERE d.code = ?`,
  ).bind(row.branch_code).first<{ id: number; uid: string; licence_ref: string | null; brand_name: string | null; status: string }>();
}

export type ProgramAnswer =
  | { decision: 'approve'; terms?: unknown; reason: string }
  | { decision: 'decline'; reason: string };

export const ANSWER_REFUSALS = {
  not_a_program_request: 'This is not a program request. Answer it in the escalation queue.',
  not_open: 'This request has already been answered or withdrawn.',
  no_licence: 'The licence this request belongs to is not in the ledger, so it cannot be answered here.',
  terms_not_for_kind: 'Only an approved grant request carries the terms HQ means to grant.',
} as const;

/**
 * The draft an approval leaves: what part 1's grant write is opened with.
 * For a grant, the program's defaults with HQ's terms over them, as part 1
 * fills a new grant (D982 §2); for a terms change, the term and what was
 * asked; for an end, the program. Nothing is granted, changed or ended here.
 */
export async function draftOf(env: Env, kind: string, request: Record<string, unknown>, terms: Terms) {
  const key = String(request.program);
  if (kind === 'program_grant') {
    const d = await env.DB.prepare(`SELECT * FROM program_grant_defaults WHERE program_key = ?`)
      .bind(key).first<Record<string, unknown>>();
    const base = Object.fromEntries(termsFor(key).map((k) => [k, (d?.[k] as string | number | null | undefined) ?? null]));
    return { program_key: key, action: 'grant', terms: { ...base, ...terms } };
  }
  if (kind === 'program_terms_change') {
    return { program_key: key, action: 'change_terms', term: request.term ?? null, current: request.current ?? null, asked: request.asked ?? null };
  }
  return { program_key: key, action: 'end' };
}

/** HQ's terms on an approval, checked by part 1's rule. */
export function approvalTerms(kind: string, programKey: string, raw: unknown) {
  if (raw === undefined || raw === null) return { ok: true as const, terms: {} as Terms };
  if (kind !== 'program_grant') return { ok: false as const, error: 'terms_not_for_kind' as const, message: ANSWER_REFUSALS.terms_not_for_kind };
  const v = validateTerms(programKey, raw);
  return v.ok ? { ok: true as const, terms: v.terms } : { ok: false as const, error: 'bad_terms' as const, message: 'Some terms could not be accepted.', errors: v.errors };
}

/** A program's name, for the subject HQ's queue shows. */
export const programName = (key: string) => programOf(key)?.name || key;

export { PROGRAMS };
