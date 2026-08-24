/**
 * GP application review — the admin half of the LP request-for-access flow.
 *
 * `services/lpApplications.ts` is the APPLICANT's half: validation and shaping
 * for the form behind POST /api/spinout-lab/lp-application. This is the GP's:
 * the review queue, the decision transitions, and the note/reviewer metadata.
 *
 * Pure module — no Hono, no D1, no auth imports — so the transitions can be
 * driven directly by tests, and so the wire handlers stay thin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT APPROVAL DOES NOT DO — read before wiring anything downstream.
 *
 * The GP Application Review design says, on the decision panel, "Approvals
 * grant reporting access immediately." That is NOT how this product is built,
 * and implementing it would break a deliberate, documented invariant.
 *
 * `lpAccessState()` (frontend/src/lib/spinoutFundModel.js) states it plainly:
 *
 *     An application can raise the ladder to 'pending' and NO FURTHER — not
 *     even when the GP has marked it approved. An approved applicant with no
 *     `limited_partners` row yet is mid-onboarding, and the reporting archive
 *     that 'approved' would unlock is keyed to a holding they do not have.
 *
 * The access ladder derives from `limited_partners` — a countersigned LPA and
 * a real commitment — and never from this table. That separation is what makes
 * it safe for an applicant to author their own row: the worst a hostile
 * submitter can do is tell the GP they are interested.
 *
 * So approval here means "cleared to be issued an LPA", not "let them in". The
 * downstream panel this module feeds says exactly that rather than repeating
 * the design's claim. Wiring approval to entitlements would let a GP mis-click
 * their way into disclosing portfolio reporting to someone who has signed
 * nothing — the one failure this architecture was shaped to prevent.
 */

/**
 * Review states.
 *
 * `pending`, `approved`, `declined` and `withdrawn` are the stored vocabulary
 * from migration 165 and are unchanged. `in_review` and `needs_follow_up` are
 * added here because the GP queue needs to distinguish "nobody has looked at
 * this" from "someone is on it" and "we are waiting on the applicant" — the
 * design's New / In review / Needs follow-up columns. They are ordinary values
 * in the same TEXT column; no migration is required.
 *
 * `pending` renders as "New": it is what POST /lp-application writes, so it
 * means untouched, not in-progress.
 */
export const REVIEW_STATUSES = [
  'pending',
  'in_review',
  'needs_follow_up',
  'approved',
  'declined',
  'withdrawn',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Statuses a GP may set. `withdrawn` is the applicant's own act — a GP who
 *  wants an application gone declines it, on the record, with a reason. */
export const GP_SETTABLE: ReviewStatus[] = [
  'in_review', 'needs_follow_up', 'approved', 'declined',
];

/** Statuses that count as "still needs a human" for the queue's default view. */
export const OPEN_STATUSES: ReviewStatus[] = ['pending', 'in_review', 'needs_follow_up'];

/** Terminal for the applicant: they cannot re-submit over these (the POST
 *  route already 409s on them). A GP can still move them — reversing a
 *  decision is legitimate and stays on the record. */
export const DECIDED_STATUSES: ReviewStatus[] = ['approved', 'declined'];

export const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'New',
  in_review: 'In review',
  needs_follow_up: 'Needs follow-up',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === 'string' && (REVIEW_STATUSES as readonly string[]).includes(v);
}

export type TransitionResult =
  | { ok: true; status: ReviewStatus; requiresNote: boolean }
  | { ok: false; error: string };

/**
 * Validate a GP's requested status change.
 *
 * Declining REQUIRES a note. Everything else is optional. An applicant who is
 * turned away is entitled to a reason — `presentLpApplication` returns
 * `review_note` on their own row, so this is not an internal-only field, and a
 * bare "Declined" with no explanation is the outcome this guards against.
 *
 * A no-op (same status, no new note) is refused rather than written: it would
 * append a meaningless entry to the audit trail and reset `reviewed_at`,
 * making the record look freshly handled when nothing happened.
 */
export function validateTransition(
  current: string | null | undefined,
  next: unknown,
  note: unknown,
): TransitionResult {
  if (!isReviewStatus(next)) {
    return { ok: false, error: `Unknown status. Expected one of: ${GP_SETTABLE.join(', ')}.` };
  }
  if (!GP_SETTABLE.includes(next)) {
    return {
      ok: false,
      error: next === 'withdrawn'
        ? 'Only the applicant can withdraw an application. Decline it instead, with a reason.'
        : `A reviewer cannot set "${STATUS_LABELS[next]}".`,
    };
  }
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (next === 'declined' && !trimmed) {
    return {
      ok: false,
      error: 'A decline needs a reason — the applicant is shown this note on their own application.',
    };
  }
  if (current === next && !trimmed) {
    return {
      ok: false,
      error: `Already ${STATUS_LABELS[next]}. Add a note if you want to record something new.`,
    };
  }
  return { ok: true, status: next, requiresNote: next === 'declined' };
}

/**
 * Downstream consequences of a decision, for the review panel.
 *
 * Deliberately descriptive, not aspirational: each entry says what the system
 * ACTUALLY does. `done: false` on the LPA line is the honest state for every
 * newly-approved applicant, because approval does not create a
 * `limited_partners` row and nothing here pretends it does.
 */
export function downstreamEffects(status: string | null | undefined, hasHolding: boolean) {
  if (status !== 'approved') return [];
  return [
    {
      key: 'lpa',
      label: 'Subscription / LPA issuance',
      done: hasHolding,
      note: hasHolding
        ? 'Countersigned — the LP position is on file.'
        : 'Unblocked by this approval. Access follows the countersigned LPA, not this decision.',
    },
    {
      key: 'access',
      label: 'LP reporting access',
      done: hasHolding,
      note: hasHolding
        ? 'Active — derived from the limited_partners position.'
        : 'NOT granted by approval. The access ladder reads limited_partners; an approved applicant with no position stays at "pending".',
    },
    {
      key: 'applicant_view',
      label: 'Applicant sees the decision',
      done: true,
      note: 'Status and review note appear on their own application immediately.',
    },
  ];
}

/** One queue row, shaped for the GP list. */
export interface ReviewQueueRow {
  id: number;
  user_id: number;
  name: string;
  email: string;
  firm: string | null;
  investor_type: string;
  target_commitment: number | null;
  preference_areas: string[];
  note: string | null;
  status: ReviewStatus;
  status_label: string;
  reviewed_by: number | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  age_days: number;
}

const parseAreas = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch { return []; }
};

/** Whole days between `iso` and `nowMs`. Null/unparseable → 0 rather than NaN,
 *  which would render as "NaN days" in the ageing column. */
export function ageInDays(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(String(iso).includes('T') ? String(iso) : `${iso}Z`.replace(' ', 'T'));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

/** Shape a joined DB row for the queue. Never throws on a malformed row. */
export function presentQueueRow(row: any, nowMs: number): ReviewQueueRow | null {
  if (!row || row.id == null) return null;
  const status: ReviewStatus = isReviewStatus(row.status) ? row.status : 'pending';
  const commitment = typeof row.target_commitment === 'number' && isFinite(row.target_commitment)
    ? row.target_commitment
    : null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: String(row.applicant_name || row.email || 'Unknown applicant'),
    email: String(row.email || ''),
    firm: row.firm ? String(row.firm) : null,
    investor_type: String(row.investor_type || 'other'),
    target_commitment: commitment,
    preference_areas: parseAreas(row.preference_areas),
    note: row.note ? String(row.note) : null,
    status,
    status_label: STATUS_LABELS[status],
    reviewed_by: row.reviewed_by == null ? null : Number(row.reviewed_by),
    reviewer_name: row.reviewer_name ? String(row.reviewer_name) : null,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    review_note: row.review_note ? String(row.review_note) : null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
    age_days: ageInDays(row.created_at, nowMs),
  };
}

/** Per-status counts for the queue summary strip, plus the `open` roll-up the
 *  default "Needs action" view uses. Always returns every key, so the UI never
 *  has to guard a missing bucket. */
export function summarize(rows: ReviewQueueRow[]) {
  const counts: Record<string, number> = { open: 0 };
  for (const s of REVIEW_STATUSES) counts[s] = 0;
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (OPEN_STATUSES.includes(r.status)) counts.open += 1;
  }
  return counts;
}
