/**
 * D332 — a shared cents-and-currency formatter, so a page cannot print a
 * bare `$` in front of a price whose stored currency is something else.
 * `PublicEventsPage.jsx`'s event cards always printed `$`, regardless of
 * the event's own `currency` column; `PublicEventDetailPage.jsx` already had
 * this exact formatter declared locally, un-exported. Consolidated here
 * rather than duplicated a second time.
 */
export function formatEventPrice(cents, currency) {
  const amt = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amt);
  } catch { return `$${amt.toFixed(2)}`; }
}
