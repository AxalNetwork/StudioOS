import { formatMinor } from '../../lib/money.js';

/** D1149: amounts carry the deal's denomination; a missing figure stays missing. */
export function dealMoney(value, currency = 'USD', cents = false) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  // D5373: a count of the deal currency's minor units is shown at that currency's own decimals (JPY none, KWD three).
  if (cents) return formatMinor(Number(value), currency, { locale: 'en-US' });
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(Number(value));
  } catch { return null; }
}
/**
 * D4633: a round's Ask is its fundraising target, `target_raise`. A deal
 * drafted before the target existed recorded its size in `amount`, so that is
 * the fallback, and the only one. A figure neither records is null, never 0.
 * Every screen that says "Ask", "Round size" or "of <target>" reads this, so
 * editing the target moves all of them together.
 */
export function roundAsk(deal) {
  for (const v of [deal?.target_raise, deal?.amount]) {
    if (v != null && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}
export function dealBackLink(role) {
  return role === 'founder' ? { path: '/raise/capital-relationships', label: 'Back to Capital relationships' }
    : { path: '/deals', label: 'Back to Deal Flow' };
}
