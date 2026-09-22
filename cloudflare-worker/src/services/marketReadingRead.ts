/**
 * One market reading, read the way the page is allowed to read it.
 *
 * Age is `ran_at` and nothing else. Catalog price is what the firm lists,
 * never a number to fold into the comparable range. A proposal name is a
 * need's title when one was stored, and null when it was not — a quote has
 * no title column of its own.
 */

export const STALE_AT = 90;

/** Whole days since the run date. Null when the date cannot be read. */
export function readingAgeDays(ranAt: string, now = Date.now()): number | null {
  const at = Date.parse(ranAt || '');
  if (!Number.isFinite(at)) return null;
  return Math.floor((now - at) / 86400000);
}

/** Past the attachment window. An unreadable date is not current. */
export function readingIsStale(ranAt: string, now = Date.now()): boolean {
  const days = readingAgeDays(ranAt, now);
  return days == null || days > STALE_AT;
}

/**
 * The catalog's own price, in cents.
 *
 * `price_cents` is canonical (migration 227). A row priced before that
 * migration has only `price_usd`. Null on both is uncatalogued — not $0.
 */
export function catalogPriceCents(
  priceCents: number | null | undefined,
  priceUsd: number | null | undefined,
): number | null {
  if (priceCents != null && priceCents !== undefined) {
    const cents = Number(priceCents);
    if (Number.isInteger(cents)) return cents;
  }
  if (priceUsd == null || priceUsd === undefined) return null;
  const usd = Number(priceUsd);
  if (!Number.isFinite(usd)) return null;
  return Math.round(usd * 100);
}

/** A need title, or null. Deliverables are not a name. */
export function proposalName(title: unknown): string | null {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
}
