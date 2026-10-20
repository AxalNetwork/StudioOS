/**
 * D802 (#2238) — the words and figures of HQ's "Annual fee invoices" tab on a
 * licence (`LicenceFeeInvoices.jsx`). Pure, so
 * `frontend/test/licence_fee_invoices_d802.test.mjs` holds each rule.
 */

const SIGN = { USD: '$', EUR: '€', GBP: '£' };

/** "€12,000.00" in the invoice's own currency; a currency with no sign here reads "CHF 12,000.00". */
export function money(cents, currency) {
  if (!Number.isSafeInteger(cents)) return 'Not recorded';
  const code = String(currency || '').toUpperCase();
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${whole}.${String(abs % 100).padStart(2, '0')}`;
  const sign = SIGN[code];
  return `${cents < 0 ? '-' : ''}${sign ? `${sign}${text}` : `${code} ${text}`}`;
}

/** A typed total received, in the invoice's currency units: cents, or null. Two decimals at most, never negative. */
export function parseAmount(text) {
  const t = String(text ?? '').trim().replace(/^[$€£]/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

export const STATUS_WORDS = Object.freeze({ issued: 'Issued', paid: 'Paid', void: 'Void' });
export const STATUS_TONE = Object.freeze({ issued: 'warn', paid: 'ok', void: 'neutral' });

/** The line above the list: the fee and the anniversary, or why nothing can be invoiced. */
export function feeLine(read) {
  if (!read || typeof read !== 'object') return null;
  if (!Number.isSafeInteger(read.annual_fee_cents) || read.annual_fee_cents <= 0) {
    return { ok: false, text: 'No annual fee is recorded on this licence, so nothing can be invoiced. Set it on Terms.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(read.starts_on || ''))) {
    return { ok: false, text: 'No start date is recorded on this licence, so its licence year cannot be told.' };
  }
  return { ok: true, text: `Annual fee ${money(read.annual_fee_cents, read.currency)}. Each licence year starts on the anniversary of ${read.starts_on}.` };
}

/** "€4,000.00 of €12,000.00", or "Nothing yet". */
export function paidLine(inv) {
  if (inv.status === 'void') return 'Void';
  return inv.paid_cents > 0 ? `${money(inv.paid_cents, inv.currency)} of ${money(inv.amount_cents, inv.currency)}` : 'Nothing yet';
}
