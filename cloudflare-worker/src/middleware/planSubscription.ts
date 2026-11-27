/** D1100: Stripe renewal retries keep access for at most 21 days after period end. */
export const GRACE_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export function inGrace(status: string | null | undefined, renewsAt: string | null | undefined, now = Date.now()): boolean {
  if (status === 'active' || status === 'trialing') return true;
  if (status !== 'past_due' || typeof renewsAt !== 'string' || !Number.isFinite(now)) return false;
  // Billing writes ISO; SQLite timestamps without an offset are UTC too.
  const timestamp = renewsAt.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(timestamp)) return false;
  const utc = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp
    : timestamp.length === 10 ? timestamp + 'T00:00:00Z' : timestamp.replace(' ', 'T') + 'Z';
  const end = Date.parse(utc);
  return Number.isFinite(end) && now <= end + GRACE_DAYS * DAY_MS;
}
