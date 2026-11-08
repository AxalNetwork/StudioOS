/**
 * D5029 — one money layer for financial UI and Worker validation.
 *
 * StudioOS stores money as integer minor units in columns named `*_cents`. The suffix is a name, not a factor:
 * a currency's minor unit is `10^exponent` of its major unit, and the exponent is the currency's own (ISO 4217).
 * 100 is right for EUR and USD, wrong for JPY and KRW (0) and for KWD and BHD (3). Every conversion between what a
 * person types or reads and what is stored goes through this file; nothing else multiplies or divides by 100.
 *
 * Pure, no imports, no floating point on the way in: `parseMinor` reads the digits of the text and builds the
 * integer from them, so `19.99`, `0.1 + 0.2`-style sums and `1.005` never pass through a double. The Worker imports
 * this same file (`services/currencies.ts`, `routes/admin_billing.ts`), so the page and the route agree.
 *
 *   currencyCode(v)                  the code when it is a listed ISO 4217 currency, else null. Never a default.
 *   exponentOf(code)                 0, 2 or 3; null for a code that is not a currency (so no guessing).
 *   parseMinor(text, code, opts)     major-unit text -> { ok, minor } | { ok: false, reason, message }
 *   formatMinor(minor, code, opts)   integer minor units -> localized money, or null when it cannot be shown truly
 *                                    (opts.trimWhole drops the zero decimals of a whole amount)
 *   toMajorString(minor, code)       the exact major-unit text of an amount, for an edit box ("1234.56")
 *   toMinorSafe(v)                   v as a safe non-negative integer of minor units, or null
 *
 * `reason` is one of: 'currency' | 'empty' | 'format' | 'negative' | 'decimals' | 'range'.
 */

/** The active ISO 4217 codes money is held in. Left out on purpose: fund and unit-of-account codes, precious metals, XDR, XTS, XXX. */
export const CURRENCY_CODES = Object.freeze([
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR',
  'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL',
  'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR',
  'MVR', 'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR',
  'NZD', 'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR',
  'RON', 'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD',
  'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB',
  'TJS', 'TMT', 'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX',
  'USD', 'UYU', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD',
  'XCG', 'XOF', 'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
]);

/**
 * Minor-unit exponent where it is not 2 (ISO 4217). Everything else listed above has two decimals.
 * Zero: whole-unit currencies. Three: the dinar-family currencies and OMR.
 */
const ZERO_DECIMAL = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE_DECIMAL = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

const KNOWN = new Set(CURRENCY_CODES);

/** The code when it is a listed ISO 4217 currency; null otherwise. Lower case and padding are not repaired. */
export function currencyCode(v) {
  return typeof v === 'string' && /^[A-Z]{3}$/.test(v) && KNOWN.has(v) ? v : null;
}

/** Decimal places of the currency's minor unit; null for anything that is not a listed currency. */
export function exponentOf(code) {
  const c = currencyCode(code);
  if (!c) return null;
  if (ZERO_DECIMAL.includes(c)) return 0;
  if (THREE_DECIMAL.includes(c)) return 3;
  return 2;
}

/** `v` as an integer count of minor units: a safe, non-negative integer, else null. A string of digits is accepted. */
export function toMinorSafe(v) {
  const n = typeof v === 'string' && /^\d{1,16}$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

const refuse = (reason, message) => ({ ok: false, reason, message });

/**
 * Major-unit text to integer minor units, exactly.
 *
 * Accepted: digits with an optional single `.` and decimals, optional surrounding spaces, and `,` only as a
 * thousands separator in its plain 3-digit grouping (`1,234.56`). Not guessed: `1.234,56` (is that 1234.56 or
 * 1.23456?) and a bare `12,5` are refused with the way to write them. A leading `-` is refused unless
 * `allowNegative`. More decimals than the currency has is refused, never rounded: `10.005` EUR is not 10.01.
 * A value past the largest safe integer of minor units is refused.
 */
export function parseMinor(text, code, { allowNegative = false } = {}) {
  const exp = exponentOf(code);
  if (exp === null) return refuse('currency', 'The currency is not one StudioOS can price in, so the amount cannot be read.');
  let t = String(text ?? '').trim();
  if (t === '') return refuse('empty', 'Enter an amount.');
  let negative = false;
  if (t.startsWith('-')) {
    if (!allowNegative) return refuse('negative', 'The amount cannot be negative.');
    negative = true;
    t = t.slice(1).trim();
  }
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(t)) t = t.replace(/,/g, '');
  if (/^\.\d/.test(t)) t = `0${t}`;
  const m = /^(\d+)(?:\.(\d*))?$/.exec(t);
  if (!m) {
    return refuse('format', /,/.test(t)
      ? 'Write the amount with a point for the decimals and no thousands separators, such as 1234.56.'
      : 'Write the amount as digits with an optional decimal point, such as 1234.56.');
  }
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const frac = m[2] ?? '';
  const meaningful = frac.replace(/0+$/, '');
  if (meaningful.length > exp) {
    return refuse('decimals', exp === 0
      ? `${code} has no minor unit: enter a whole amount.`
      : `${code} has ${exp} decimal place${exp === 1 ? '' : 's'}: ${frac.slice(0, exp + 1)}… has too many.`);
  }
  if (whole.length + exp > 16) return refuse('range', 'That amount is larger than can be recorded exactly.');
  const minor = Number(whole + (frac + '000').slice(0, exp));
  if (!Number.isSafeInteger(minor)) return refuse('range', 'That amount is larger than can be recorded exactly.');
  return { ok: true, minor: negative ? -minor : minor, exponent: exp };
}

/** The exact decimal text of `minor` at `exp` decimals: 123456, 2 -> "1234.56"; 5, 3 -> "0.005"; 7, 0 -> "7". */
function decimalText(minor, exp) {
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0');
  const body = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return neg ? `-${body}` : body;
}

/** The exact major-unit text of an amount, for filling an edit box. Null when the amount or the currency is not usable. */
export function toMajorString(minor, code) {
  const exp = exponentOf(code);
  const n = typeof minor === 'string' ? toMinorSafe(minor) : minor;
  if (exp === null || typeof n !== 'number' || !Number.isSafeInteger(n)) return null;
  return decimalText(n, exp);
}

/**
 * Integer minor units as localized money in the currency's own number of decimals: €1,234.56, ¥1,235, KD 1.235.
 * Null when the amount is not a safe integer or the currency is not a listed one, so the caller says "Not recorded"
 * rather than a plausible figure in a guessed currency. The digits come from the exact decimal text, not from a
 * float division, so a large amount is not rounded on the way to the screen.
 */
export function formatMinor(minor, code, { locale, trimWhole = false } = {}) {
  const exp = exponentOf(code);
  const n = typeof minor === 'string' && minor.trim() !== '' ? Number(minor) : minor;
  if (exp === null || typeof n !== 'number' || !Number.isSafeInteger(n)) return null;
  // `trimWhole`: a whole amount drops its zero decimals (€90,000), a fractional one keeps all of the currency's own.
  const minDigits = trimWhole && n % 10 ** exp === 0 ? 0 : exp;
  const nf = new Intl.NumberFormat(locale, {
    style: 'currency', currency: code, minimumFractionDigits: minDigits, maximumFractionDigits: exp,
  });
  // Intl takes an exact decimal string; an engine that only takes numbers still has an amount below 2^53.
  try { return nf.format(decimalText(n, exp)); } catch { return nf.format(n / 10 ** exp); }
}

/**
 * D332 (pre-existing; kept as it was, and not part of D5029's scope)
 *
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
