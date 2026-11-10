/**
 * D802 (#2238) — the words and figures of HQ's "Annual fee invoices" tab on a
 * licence (`LicenceFeeInvoices.jsx`). Pure, so
 * `frontend/test/licence_fee_invoices_d802.test.mjs` holds each rule.
 */

import { formatMinorOrCount, parseMinor, toMajorString } from '../../lib/money.js';

const SIGN = { USD: '$', EUR: '€', GBP: '£' };

/** "€12,000.00" in the invoice's own currency, at that currency's decimals (¥12,000, KWD 12.000); a currency with no sign here reads "CHF 1,234.56". */
export function money(cents, currency) {
  if (!Number.isSafeInteger(cents)) return 'Not recorded';
  const code = String(currency || '').toUpperCase();
  const major = toMajorString(cents, code);
  if (major === null) return formatMinorOrCount(cents, code);
  const neg = major.startsWith('-');
  const [whole, frac] = (neg ? major.slice(1) : major).split('.');
  const text = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac === undefined ? '' : `.${frac}`}`;
  const sign = SIGN[code];
  return `${neg ? '-' : ''}${sign ? `${sign}${text}` : `${code} ${text}`}`;
}

/** A typed total received, in the invoice's currency units: minor units of THAT currency, or null (D5373). Never negative; no more decimals than the currency has. */
export function parseAmount(text, currency) {
  const t = String(text ?? '').trim().replace(/^[$€£]/, '').replace(/,/g, '');
  const r = parseMinor(t, String(currency || '').toUpperCase());
  return r.ok ? r.minor : null;
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
