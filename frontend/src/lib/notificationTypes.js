/**
 * D336 — the notification type → human label map, in one place.
 *
 * Before this, the only place a notification `type` key (`capital_call_issued`,
 * `score_generated`, …) was paired with a readable label was the Settings →
 * Notifications matrix (`SettingsPage.jsx`'s `NOTIFICATION_EVENTS` /
 * `PARTNER_NOTIFICATION_EVENTS`). The bell and `/inbox` (`NotificationList.jsx`)
 * had no such map and rendered the raw backend key instead — "score_generated"
 * in the UI rather than "New score generated for your startup". Moving the
 * two arrays here and having both callers import them means there is exactly
 * one place that knows what a notification type is called, matching
 * `frontend/src/lib/README.md`'s rule: a helper used in two places lives here
 * once, not twice.
 */

export const NOTIFICATION_EVENTS = [
  { key: 'deal_assigned', label: 'New deal assigned to me' },
  { key: 'pipeline_status_change', label: 'Pipeline status changes' },
  { key: 'capital_call_issued', label: 'Capital call issued' },
  { key: 'capital_call_paid', label: 'Capital call marked paid' },
  { key: 'agreement_ready_to_sign', label: 'Agreement ready to sign' },
  { key: 'kyc_status_change', label: 'KYC status updates' },
  { key: 'mentions_and_comments', label: 'Mentions & comments' },
  { key: 'ticket_update', label: 'Ticket updates' },
  { key: 'deal_stage_change', label: 'Deal stage changes' },
  { key: 'score_generated', label: 'New score generated for your startup' },
  { key: 'contract_signed', label: 'Contract fully signed' },
  { key: 'advisor_session_booked', label: 'Advisor session booked' },
  { key: 'dd_report_ready', label: 'Due-diligence report ready' },
  { key: 'vote_threshold_reached', label: 'Pipeline vote threshold reached' },
  { key: 'followed_entity_news', label: 'News from people & startups I follow' },
  { key: 'weekly_digest', label: 'Weekly digest' },
  { key: 'product_announcements', label: 'Product announcements' },
];

export const PARTNER_NOTIFICATION_EVENTS = [
  { key: 'partner_high_score_deal', label: 'New deal scores above your threshold' },
  { key: 'partner_pipeline_activity', label: 'Founder activity on watched deals' },
  { key: 'partner_capital_call_due', label: 'Capital call due in 7 days' },
  { key: 'partner_match_recommendation', label: 'New partner match' },
  { key: 'partner_kyc_block', label: 'A founder you backed is blocked on KYC' },
];

const LABEL_BY_TYPE = new Map(
  [...NOTIFICATION_EVENTS, ...PARTNER_NOTIFICATION_EVENTS].map((e) => [e.key, e.label]),
);

/** A readable label for a notification `type`. Falls back to a titleised
 *  version of the raw key (never blank) for a backend event type this map
 *  doesn't know about yet — a new `notify()` call site shouldn't have to
 *  touch this file before its notifications render legibly. */
export function labelForType(type) {
  if (!type) return 'Notification';
  const known = LABEL_BY_TYPE.get(type);
  if (known) return known;
  return String(type)
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
