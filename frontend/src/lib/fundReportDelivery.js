/** Describe the recorded inbox delivery outcome for the fund reporting surfaces. */
import { parseStamp } from '../ui/parseStamp.js';

export function fundReportDeliveryLabel(period) {
  switch (period.delivery_status) {
    case 'sent':
      return `${period.delivered_count} notified`;
    case 'partial':
      return `${period.delivered_count} notified · ${period.undelivered_count} without an active linked account`;
    case 'failed':
      return 'Delivery failed';
    case 'unreadable':
      return 'Delivery unreadable';
    case 'not_sent':
      return period.undelivered_count > 0 ? 'Not sent · No active linked accounts' : 'Not sent';
    default:
      return period.status === 'draft' ? 'Not sent' : period.delivery_count ?? period.delivered_count ?? period.delivery_status ?? 'Unavailable';
  }
}

export function fundReportDeliveryTime(period) {
  const stamp = parseStamp(period.lps_notified_at);
  return stamp === null ? null : new Date(stamp).toLocaleString();
}

/**
 * D6240: "n of m" LPs an issued period was made available to. A period issued
 * before per-LP rows were written reads Not recorded, never 0 of m. A reply
 * without `lp_delivery` (a draft, or a Worker from before D6240) keeps the
 * D6255 label.
 */
export function lpDeliveryLabel(period) {
  const counts = period?.lp_delivery;
  if (!counts || typeof counts !== 'object') return fundReportDeliveryLabel(period);
  if (counts.state === 'recorded' && Number.isSafeInteger(counts.delivered) && Number.isSafeInteger(counts.total)) {
    return `${counts.delivered} of ${counts.total}`;
  }
  if (counts.state === 'not_recorded') return 'Not recorded · issued before delivery was recorded';
  return 'Delivery unreadable';
}

/** D6240: what "n of m" leaves out, as one short line, or null. */
export function lpDeliveryNote(period) {
  const counts = period?.lp_delivery;
  if (counts?.state !== 'recorded') return null;
  const parts = [];
  if (counts.opened) parts.push(`${counts.opened} opened`);
  if (counts.no_account) parts.push(`${counts.no_account} no account`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  return parts.length ? parts.join(' · ') : null;
}

/** D6240: the words for one LP's delivery state. An LP with no active linked account reads No account. */
export const LP_DELIVERY_STATES = {
  not_sent: 'No account',
  made_available: 'Made available',
  opened: 'Opened',
  failed: 'Failed',
};
export const lpDeliveryStateLabel = (state) => LP_DELIVERY_STATES[state] || 'Unreadable';
