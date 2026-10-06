/**
 * Money on Advisor Studio, and the Earnings module's two figures (D572).
 * Kept out of the page so they can be tested without rendering it.
 */
export function formatMoney(cents, currency = 'USD') {
  if (cents == null) return 'Not recorded';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
    }).format(Number(cents) / 100);
  } catch {
    return `${(Number(cents) / 100).toFixed(2)} ${String(currency || 'USD').toUpperCase()}`;
  }
}

/**
 * D572 — the Earnings module's two figures, from the routes that hold them.
 *
 * It used to read `balance_cents` and `lifetime_cents` off `payoutsMe()`.
 * On the Worker that route returns a bare list of payouts, so both always
 * printed "Not recorded"; the object shape it expected is the dev FastAPI
 * shim's. Now:
 *   · Available balance is `/commissions/me`'s balance. When the account's
 *     commissions are held in more than one currency there is no single sum,
 *     and each currency is shown.
 *   · Lifetime paid is the sum of COMPLETED payouts in `payoutsMe()`, per
 *     currency. `/commissions/me`'s `lifetime_cents` is not that: it counts
 *     every commission ever accrued, paid or not.
 * A read that did not answer in the expected shape is "Not recorded", never
 * a zero.
 */
export function earningsFigures(commissions, payouts) {
  let balance = 'Not recorded';
  if (commissions && typeof commissions === 'object' && !Array.isArray(commissions)) {
    const rows = Array.isArray(commissions.by_currency) ? commissions.by_currency : [];
    if (commissions.mixed_currency && rows.length) {
      balance = rows.map((r) => formatMoney(r.balance_cents, r.currency)).join(' · ');
    } else if (typeof commissions.balance_cents === 'number') {
      balance = formatMoney(commissions.balance_cents, rows[0]?.currency || 'USD');
    }
  }
  let paid = 'Not recorded';
  if (Array.isArray(payouts)) {
    const sums = new Map();
    for (const p of payouts) {
      if (p?.status !== 'completed') continue;
      const cur = String(p.currency || 'USD').toUpperCase();
      sums.set(cur, (sums.get(cur) || 0) + (Number(p.amount_cents) || 0));
    }
    paid = sums.size
      ? [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cur, cents]) => formatMoney(cents, cur)).join(' · ')
      : formatMoney(0, 'USD');
  }
  return { balance, paid };
}
