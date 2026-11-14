/**
 * Whether a share link has a view left (D895), one rule for every reader:
 * the engagement read's `shares` and the Raise cycle's link records (D1111).
 *
 * A link is used up once `used_at` is set or its views reach its cap. No cap
 * is NULL, or the old "unlimited" sentinel a link made before migration 549
 * still carries. An unknown count is not a measured zero.
 */
export const LEGACY_SHARE_NO_VIEW_LIMIT = 2147483647;

export function deckShareMetrics(token: { view_limit?: number | null; view_count?: number | null; used_at?: string | null }) {
  const limit = token.view_limit == null || token.view_limit === LEGACY_SHARE_NO_VIEW_LIMIT ? null : Number(token.view_limit);
  const count = token.view_count == null ? null : Number(token.view_count);
  return { view_limit: limit, view_count: count, exhausted: !!token.used_at || (limit !== null && count !== null && count >= limit) };
}
