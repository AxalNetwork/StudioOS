/**
 * D4357 (#4357) — the review step's itemised quote, pure. `IncorporateFlow.jsx`
 * draws it from `GET /api/legal/incorporation/itemised-quote`.
 *
 * A line the Worker does not know reads "Not recorded", never a zero. Each
 * line says where its figure comes from and the day that source was last
 * checked. The total is the sum of the known lines in it, and says so
 * whenever one of them is unknown; the optional lines are listed apart.
 */
import { NOT_RECORDED } from '../../lib/absence.js';
import { fmtCents } from '../../lib/incorporationPricing.js';

export const ITEMISED_TITLE = 'What it costs';
export const TOTAL = 'Total';
export const OPTIONAL = 'Optional, not in the total';
export const NEVER_CHECKED = 'not checked yet';
export const PAID = Object.freeze({ at_filing: 'Paid to the state at filing', with_order: 'Charged with your order', after_you_pay: 'Added after you pay' });

const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "3 Nov 2026", or null. */
export function dayLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${M[Number(m[2]) - 1]} ${m[1]}` : null;
}

const known = (n) => Number.isInteger(n) && n > 0;

/** One line's amount: the figure, "/year" on a subscription, or Not recorded. */
export function amountText(line) {
  if (!known(line?.amount_cents)) return NOT_RECORDED;
  const money = fmtCents(line.amount_cents, line.currency || 'usd');
  return line.interval ? `${money}/${line.interval}` : money;
}

/** "Stripe catalog (Axal VC) · checked 3 Nov 2026", or "… · not checked yet". */
export function sourceText(line) {
  const day = dayLabel(line?.checked_on);
  return `${String(line?.source || NOT_RECORDED)} · ${day ? `checked ${day}` : NEVER_CHECKED}`;
}

/** The lines in the total, then the optional ones. */
export function quoteRows(value) {
  const lines = Array.isArray(value?.lines) ? value.lines : [];
  const row = (l) => ({
    key: String(l.key), label: String(l.label || NOT_RECORDED), amount: amountText(l), known: known(l.amount_cents),
    source: sourceText(l), sourceUrl: typeof l.source_url === 'string' && /^https:\/\//.test(l.source_url) ? l.source_url : null,
    paid: PAID[l.paid] || null, optional: !!l.optional,
  });
  return { main: lines.filter((l) => !l.optional).map(row), optional: lines.filter((l) => l.optional).map(row) };
}

/** The total and what it leaves out: the sum of the known lines, said so whenever a line is unknown. */
export function totalText(total) {
  const unknown = Array.isArray(total?.unknown) ? total.unknown.filter(Boolean).map(String) : [];
  const amount = known(total?.amount_cents) ? fmtCents(total.amount_cents, total.currency || 'usd') : NOT_RECORDED;
  if (total?.complete === true && unknown.length === 0 && known(total?.amount_cents)) return { amount, complete: true, note: null };
  const missing = unknown.length ? unknown.join(', ') : 'a line';
  return { amount, complete: false, note: `The sum of the known lines only. Not recorded: ${missing}. The full cost is not known yet.` };
}
