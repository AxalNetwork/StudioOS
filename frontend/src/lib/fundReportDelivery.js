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
