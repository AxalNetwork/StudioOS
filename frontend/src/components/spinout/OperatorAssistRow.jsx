// D580 (#1207) — the 83(b) page's "Operator assist" row.
//
// An Axal admin assigned to the startup checks its 83(b) filing record (the
// owner's answers 1A and 2A). The row shows who that operator is, their last
// review and the next follow-up date, read from
// `GET /api/legal/83b/operator-review`. Each value that is not on record says
// "Not recorded" with its reason, and a failed read says "Unreadable", never
// an empty or invented value. A review does not gate graduation (3A), so
// nothing here says it does.
import React from 'react';
import { Unrecorded } from '../../ui';

/** The role's wording (#1207 question 4). The Worker serves the same line. */
export const OPERATOR_ROLE_NOTE =
  'Operator review is a check that the filing record is complete. It is not tax or legal advice.';

export const OPERATOR_REASONS = {
  unreadable: 'The operator review could not be read. Reload to try again.',
  noProject: 'There is no company record yet, so no operator can be assigned.',
  noOperator: 'No Axal operator is assigned to this startup’s 83(b) filing yet.',
  noReview: 'The operator has not reviewed the filing record yet.',
  noFollowUp: 'The last review set no follow-up date.',
};

const OUTCOME_LABEL = { complete: 'Record complete', incomplete: 'Record incomplete' };

function fmtDay(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * `review` is `{ status: 'loading' | 'ready' | 'unreadable' | 'no-project', data }`,
 * where `data` is the Worker's read.
 */
export default function OperatorAssistRow({ review }) {
  const status = review?.status || 'loading';
  const data = review?.data || null;
  let operator;
  let last;
  let next;
  if (status === 'unreadable') {
    const u = <Unrecorded reason={OPERATOR_REASONS.unreadable}>Unreadable</Unrecorded>;
    operator = u; last = u; next = u;
  } else if (status === 'no-project') {
    const n = <Unrecorded reason={OPERATOR_REASONS.noProject} />;
    operator = n; last = n; next = n;
  } else if (status !== 'ready') {
    operator = '…'; last = '…'; next = '…';
  } else {
    operator = data?.operator
      ? (data.operator.name || <Unrecorded reason="The assigned operator's account has no name on record." />)
      : <Unrecorded reason={OPERATOR_REASONS.noOperator} />;
    last = data?.last_review
      ? `${OUTCOME_LABEL[data.last_review.outcome] || data.last_review.outcome} · ${fmtDay(data.last_review.reviewed_at) || data.last_review.reviewed_at}`
      : <Unrecorded reason={OPERATOR_REASONS.noReview} />;
    next = data?.next_follow_up
      ? fmtDay(data.next_follow_up)
      : <Unrecorded reason={data?.last_review ? OPERATOR_REASONS.noFollowUp : OPERATOR_REASONS.noReview} />;
  }
  return (
    <div data-testid="row-83b-operator-assist" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-600 dark:text-gray-300">Operator assist</span>
        <span data-testid="text-83b-operator">{operator}</span>
      </div>
      <div className="flex items-center justify-between gap-2 pl-3">
        <span className="text-gray-500 dark:text-gray-400">Last review</span>
        <span data-testid="text-83b-last-review">{last}</span>
      </div>
      <div className="flex items-center justify-between gap-2 pl-3">
        <span className="text-gray-500 dark:text-gray-400">Next follow-up</span>
        <span data-testid="text-83b-next-follow-up">{next}</span>
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{OPERATOR_ROLE_NOTE}</p>
    </div>
  );
}
