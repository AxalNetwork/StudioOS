import React from 'react';
import { reviewLine, PILL, TONE } from '../../lib/ticketScreens';

/**
 * D604 (#1280 step 4) — a feature request's review, as `GET /api/tickets`
 * says it (`review` on each row, from D544's `feature_request_reviews`).
 * Beside `BountyBadge` wherever a ticket is listed: a bug has a bounty, a
 * feature request has a review, and a task has neither.
 *
 *   awaiting     no decision yet
 *   approved     going to the build queue
 *   declined     with the reason the Super Admin typed
 *   unreadable   the review could not be read: never shown as awaiting
 */
export default function ReviewBadge({ review, withNote = false }) {
  const line = reviewLine(review);
  if (!line) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="review-state">
      <span className={`${PILL} ${TONE[line.tone]}`}>{line.text}</span>
      {withNote && <span className="text-[11px] text-gray-500 dark:text-gray-400">{line.note}</span>}
    </span>
  );
}
