import { request } from '../api.js';

/** #5314 part 2 (D4822): an engagement's client review history, oldest first (partner_delivery.ts).
 * reviews(engagementId) -> { engagement_id, available, items: [{ id, satisfaction, cleared, source, said_at,
 *                            recorded_at, recorded_by_name }] | null, earlier_not_recorded, earlier_note, reason? }
 * `available: false` is Unreadable, never an empty history; `earlier_not_recorded` marks a score saved
 * before the history was kept.
 */
export const partnerDeliveryReviewsApi = {
  partnerEngagementReviews: (engagementId) =>
    request(`/partner/delivery/engagements/${encodeURIComponent(engagementId)}/reviews`),
};
