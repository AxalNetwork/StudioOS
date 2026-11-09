/**
 * D4811 (#4811) part 16 — how a legal review reads (board CT-08). Pure: the
 * panel (`LegalReviewPanel.jsx`) reads and draws. A review is of one version,
 * named by its hash; an approval of an older version never reads as an
 * approval of the current one. Counsel approval and AI research never share
 * a style: this file only ever speaks of counsel's recorded decision.
 */
import { dayLabel } from './governanceModel';

export const REVIEW_TYPE_LABELS = Object.freeze({ initial: 'Initial', amendment: 'Amendment', pre_execution: 'Pre-execution', periodic: 'Periodic' });
export const DECISION_LABELS = Object.freeze({ approved: 'Counsel approved', approved_with_conditions: 'Counsel approved with conditions', not_approved: 'Not approved by counsel' });

/** The state pill: { label, tone } — tone 'seal' only for an approval of the current version. */
export function reviewBadge(state) {
  if (state === 'pending') return { label: 'In counsel review', tone: 'amber' };
  if (state === 'superseded') return { label: 'Bound to an older version', tone: 'muted' };
  if (state?.endsWith('_superseded')) return { label: `${DECISION_LABELS[state.replace('_superseded', '')]} · older version`, tone: 'muted' };
  if (state === 'approved' || state === 'approved_with_conditions') return { label: DECISION_LABELS[state], tone: 'seal' };
  if (state === 'not_approved') return { label: DECISION_LABELS[state], tone: 'red' };
  return null;
}

/** "v3 · sha 77c0…12de" — the version a review is bound to. */
export const versionBound = (r) => (r ? `v${r.version} · sha ${String(r.version_sha256 || '').slice(0, 4)}…${String(r.version_sha256 || '').slice(-4)}` : null);

const at = (v) => (typeof v === 'string' && v.length >= 10 ? dayLabel(v.slice(0, 10)) : null);

/**
 * The eleven CT-08 fields of one review, in the canvas's order, as
 * `[label, value | null, why-not-recorded]`.
 */
export function reviewFields(r) {
  const reviewer = r.reviewer?.name ? `${r.reviewer.name}${r.reviewer.firm ? ` · ${r.reviewer.firm}` : ''}` : null;
  const status = r.state === 'pending' ? `In counsel review · requested ${at(r.requested_at) || 'on a date not recorded'}`
    : reviewBadge(r.state)?.label || null;
  return [
    ['Review status', status, null],
    ['Reviewer', reviewer, 'The reviewer no longer has a name on record.'],
    ['Review type', REVIEW_TYPE_LABELS[r.review_type] || null, 'Not recorded.'],
    ['Jurisdiction', r.jurisdiction || null, 'Not recorded.'],
    ['Version reviewed', versionBound(r), null],
    ['Review date', r.decided_at ? at(r.decided_at) : r.due_on ? `Due ${dayLabel(r.due_on)}` : null, 'No due date was set.'],
    ['Findings', r.findings || null, r.decision ? 'Counsel recorded none.' : 'Not yet decided.'],
    ['Required changes', r.required_changes || null, r.decision ? 'Counsel recorded none.' : 'Not yet decided.'],
    ['Source references', r.sources || null, r.decision ? 'Counsel recorded none.' : 'Not yet decided.'],
    ['Next review', r.next_review_on ? dayLabel(r.next_review_on) : null, r.decision ? 'No next review was set.' : 'Not yet decided.'],
    ['Approval decision', r.decision ? DECISION_LABELS[r.decision] : null, 'Not yet decided. Only the assigned counsel can record it.'],
  ];
}

/** One line for an Overview's "Last review": the newest decided review, or why there is none. */
export function lastReviewLine(reviews) {
  const done = (reviews || []).find((r) => r.decision);
  if (!done) return (reviews || []).some((r) => r.state === 'pending') ? 'In counsel review' : null;
  const when = at(done.decided_at);
  return `${DECISION_LABELS[done.decision]} · v${done.version}${when ? ` · ${when}` : ''}${done.state.endsWith('_superseded') ? ' (an older version)' : ''}`;
}

/** Whether the viewer may record the decision on this review. */
export const canDecide = (r, viewer) => !!viewer?.counsel && r?.state === 'pending' && Number(r?.reviewer?.id) === Number(viewer?.id);
