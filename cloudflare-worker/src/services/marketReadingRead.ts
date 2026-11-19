/**
 * One market reading, read the way the page is allowed to read it.
 *
 * Age is `ran_at` and nothing else. Catalog price is what the firm lists,
 * never a number to fold into the comparable range. A proposal name is a
 * need's title when one was stored, and null when it was not — a quote has
 * no title column of its own.
 */

import { formatMinor, toMajorString } from '../../../frontend/src/lib/money.js';

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
  if (priceCents != null) {
    const cents = Number(priceCents);
    if (Number.isInteger(cents)) return cents;
  }
  if (priceUsd == null) return null;
  const usd = Number(priceUsd);
  if (!Number.isFinite(usd)) return null;
  return Math.round(usd * 100);
}

/** A need title, or null. Deliverables are not a name. */
export function proposalName(title: unknown): string | null {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------
// D7651 (#7651) — the Eadwyn summary of one stored reading, to the cent
// ---------------------------------------------------------------------------
//
// WHAT IT IS. The line canvas D7039 board RMP-12 draws under "Eadwyn summary
// of your readings": what the reading prices, its scope, the range, the
// comparable count and the run date, plus the catalog price where the reading
// is a service line. Every word comes from the stored row. NO MODEL IS CALLED:
// the `research/market` draft surface D6285 removed fed a model and rounded
// with `money()`; this answers only what the row holds, so nothing averages
// two ranges, drops the sample size or rounds a cent away.
//
// CENTS IN, TWO-DECIMAL STRINGS OUT. Every amount leaves as the integer cents
// the row holds and as `toMajorString` text ("99.50", "4500.00") from the one
// money layer (`lib/money.js`, D5029). Nothing here divides by 100.

/** A reading's cents are US dollars by contract: the table has no currency column (D7174). */
export const READING_CURRENCY = 'USD';

/** Cents as the money layer writes them: "$4,500.00". Null when the amount is not a safe integer. */
function readingMoney(cents: number | null | undefined): string | null {
  return cents == null ? null : formatMinor(cents, READING_CURRENCY, { locale: 'en-US' });
}

/** Cents as two-decimal text: 9950 is "99.50". Null when the amount is not usable. */
export function readingUsd(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return toMajorString(n, READING_CURRENCY);
}

export type SummaryRange =
  | { status: 'recorded'; low_cents: number; high_cents: number; low_usd: string; high_usd: string }
  | { status: 'not_recorded'; reason: string };

export type SummaryCatalog =
  | { status: 'recorded'; cents: number; usd: string }
  | { status: 'not_recorded'; reason: string }
  | { status: 'not_applicable'; reason: string };

export interface ReadingSummary {
  uid: string;
  metric: string;
  scope: string | null;
  service_line: boolean;
  range: SummaryRange;
  comparable_count: number | null;
  ran_at: string | null;
  catalog_price: SummaryCatalog;
  line: string | null;
  basis: 'stored_reading';
}

/**
 * The summary of one stored reading. `row` is the reading joined to its own
 * service line (`offering_uid` null when it is not one).
 *
 * A range that will not read as two forward amounts is Not recorded, never a
 * $0.00 that would say the firm looked and found the work worth nothing; the
 * line is then null too, because a summary without its range is not one.
 */
export function readingSummary(row: {
  uid: string; metric: string; scope: string | null;
  range_low_cents: number | null; range_high_cents: number | null;
  comparable_count: number | null; ran_at: string | null;
  offering_uid: string | null; price_cents: number | null; price_usd: number | null;
}): ReadingSummary {
  const lowUsd = readingUsd(row.range_low_cents);
  const highUsd = readingUsd(row.range_high_cents);
  const range: SummaryRange = lowUsd != null && highUsd != null && Number(row.range_high_cents) >= Number(row.range_low_cents)
    ? {
      status: 'recorded',
      low_cents: Number(row.range_low_cents),
      high_cents: Number(row.range_high_cents),
      low_usd: lowUsd,
      high_usd: highUsd,
    }
    : { status: 'not_recorded', reason: 'This reading has no range that reads low to high.' };

  const serviceLine = row.offering_uid != null;
  const catalogCents = serviceLine ? catalogPriceCents(row.price_cents, row.price_usd) : null;
  const catalogUsd = readingUsd(catalogCents);
  const catalog: SummaryCatalog = !serviceLine
    ? { status: 'not_applicable', reason: 'Not a catalog service line, so there is no listed price.' }
    : catalogCents != null && catalogUsd != null
      ? { status: 'recorded', cents: catalogCents, usd: catalogUsd }
      : { status: 'not_recorded', reason: 'This service line has no price in your catalog.' };

  const n = Number.isInteger(row.comparable_count) && Number(row.comparable_count) > 0 ? Number(row.comparable_count) : null;
  const ranAt = /^\d{4}-\d{2}-\d{2}/.test(String(row.ran_at || '')) ? String(row.ran_at).slice(0, 10) : null;
  const scope = row.scope && String(row.scope).trim() ? String(row.scope).trim() : null;

  let line: string | null = null;
  if (range.status === 'recorded') {
    const parts = [`${row.metric}${scope ? ` (${scope})` : ''}: ${readingMoney(range.low_cents)} – ${readingMoney(range.high_cents)}`];
    if (n != null) parts.push(`from ${n} comparable${n === 1 ? '' : 's'}`);
    if (ranAt) parts.push(`run ${ranAt}`);
    line = parts.join(', ');
  }

  return {
    uid: row.uid,
    metric: row.metric,
    scope,
    service_line: serviceLine,
    range,
    comparable_count: n,
    ran_at: ranAt,
    catalog_price: catalog,
    line,
    basis: 'stored_reading',
  };
}
