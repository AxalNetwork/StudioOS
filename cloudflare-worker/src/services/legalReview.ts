/**
 * D4811 (#4811) part 16 — the legal-review record (board CT-08) and the
 * counsel role (owner's answer to question C, 2026-11-09). Pure rules: the
 * route (`routes/admin_legal_reviews.ts`) reads and writes the rows
 * (migration 202611092245), this file says what a request and a decision
 * must carry and how a review reads against the current version.
 *
 *   - A request names the object, the reviewing counsel, the review type and
 *     the jurisdiction (never defaulted), and may name a due date.
 *   - Only the assigned counsel records the decision, once, against the
 *     version it was bound to; a decision on a version that is no longer
 *     current is refused: a newer version needs a new review.
 *   - An approval with conditions names the required changes; a refusal
 *     names its findings.
 */

export const REVIEW_TYPES = Object.freeze(['initial', 'amendment', 'pre_execution', 'periodic'] as const);
export const DECISIONS = Object.freeze(['approved', 'approved_with_conditions', 'not_approved'] as const);
export type ReviewType = typeof REVIEW_TYPES[number];
export type Decision = typeof DECISIONS[number];

type Refusal = { status: 409 | 422; code: string; message: string };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');
const day = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};

/** A review request's fields, or the refusal. `reviewerIsCounsel` is the route's lookup. */
export function requestOf(body: any, reviewerIsCounsel: boolean): { ok: true; value: { review_type: ReviewType; jurisdiction: string; reviewer_id: number; due_on: string | null } } | { ok: false; refusal: Refusal } {
  const reviewer = Number(body?.reviewer_id);
  if (!Number.isSafeInteger(reviewer) || reviewer <= 0) return { ok: false, refusal: { status: 422, code: 'reviewer_required', message: 'Name the counsel who will review it. Nothing was requested.' } };
  if (!reviewerIsCounsel) return { ok: false, refusal: { status: 422, code: 'reviewer_not_counsel', message: 'That person does not hold the counsel role. Only counsel reviews. Nothing was requested.' } };
  if (!(REVIEW_TYPES as readonly string[]).includes(body?.review_type)) return { ok: false, refusal: { status: 422, code: 'review_type_required', message: 'Choose the review type: initial, amendment, pre-execution or periodic. Nothing was requested.' } };
  const jurisdiction = text(body?.jurisdiction, 120);
  if (jurisdiction.length < 2) return { ok: false, refusal: { status: 422, code: 'jurisdiction_required', message: 'Give the jurisdiction the review is under. It is never assumed. Nothing was requested.' } };
  const due = body?.due_on == null || body.due_on === '' ? null : day(body.due_on);
  if (body?.due_on && !due) return { ok: false, refusal: { status: 422, code: 'due_on_invalid', message: 'The due date must be a date, YYYY-MM-DD. Nothing was requested.' } };
  return { ok: true, value: { review_type: body.review_type, jurisdiction, reviewer_id: reviewer, due_on: due } };
}

/**
 * A decision's fields, or the refusal. `currentSha` is the object's current
 * version hash: a review bound to another version cannot be decided.
 */
export function decisionOf(body: any, review: { decision: string | null; reviewer_id: number; version_sha256: string }, deciderId: number, currentSha: string | null):
  { ok: true; value: { decision: Decision; findings: string | null; required_changes: string | null; sources: string | null; next_review_on: string | null } } | { ok: false; refusal: Refusal } {
  if (review.decision != null) return { ok: false, refusal: { status: 409, code: 'already_decided', message: 'This review already has its decision. A decision is recorded once. Nothing was changed.' } };
  if (Number(review.reviewer_id) !== Number(deciderId)) return { ok: false, refusal: { status: 409, code: 'not_assigned_counsel', message: 'Only the counsel assigned to this review records its decision. Nothing was recorded.' } };
  if (currentSha !== review.version_sha256) return { ok: false, refusal: { status: 409, code: 'review_stale', message: 'The version this review is bound to is no longer the current one. Request a new review of the current version. Nothing was recorded.' } };
  if (!(DECISIONS as readonly string[]).includes(body?.decision)) return { ok: false, refusal: { status: 422, code: 'decision_required', message: 'Choose the decision: approved, approved with conditions, or not approved. Nothing was recorded.' } };
  const findings = text(body?.findings, 4000) || null;
  const required = text(body?.required_changes, 4000) || null;
  const sources = text(body?.sources, 2000) || null;
  if (body.decision === 'approved_with_conditions' && !required) return { ok: false, refusal: { status: 422, code: 'required_changes_required', message: 'An approval with conditions names the required changes. Nothing was recorded.' } };
  if (body.decision === 'not_approved' && !findings) return { ok: false, refusal: { status: 422, code: 'findings_required', message: 'A decision not to approve names its findings. Nothing was recorded.' } };
  const next = body?.next_review_on == null || body.next_review_on === '' ? null : day(body.next_review_on);
  if (body?.next_review_on && !next) return { ok: false, refusal: { status: 422, code: 'next_review_invalid', message: 'The next review must be a date, YYYY-MM-DD. Nothing was recorded.' } };
  return { ok: true, value: { decision: body.decision, findings, required_changes: required, sources, next_review_on: next } };
}

/** How a review reads against the object's current version: 'pending' | 'approved' | ... | 'superseded'. */
export function reviewState(review: { decision: string | null; version_sha256: string }, currentSha: string | null): string {
  if (currentSha != null && review.version_sha256 !== currentSha) return review.decision ? `${review.decision}_superseded` : 'superseded';
  return review.decision ?? 'pending';
}
