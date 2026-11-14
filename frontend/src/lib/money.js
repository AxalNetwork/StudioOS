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
 *   formatMicro(micro, code, opts)   an amount in millionths of a unit (micro-USD) as exact localized money, or null
 *   formatMinorOrCount(minor, code)  formatMinor, or the stored count with the currency named when it is unusable (D5373)
 *   majorToMinor(major, code)        a legacy float of MAJOR units to minor units at the currency's exponent (rounded once)
 *   suffixAmount(minor, code)        "1,200 USD" / "12,000 JPY": the amount at the currency's decimals, then the code
 *   codeAmount(minor, code)          "EUR 12,000" / "KWD 12.345": the code, then the amount at the currency's decimals
 *   plainAmount(minor, code)         the grouped number alone at the currency's decimals ("20.00"), for text that adds the code
 *   fromStripeUnits / toStripeUnits / formatStripeAmount / plainStripeAmount / parseStripeAmount   Stripe's own count (ISK, UGX hundredths; three-decimal steps of ten)
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

/** A currency from a human-entered unit label, with no default for unknown units. */
export function currencyFromLabel(value) {
  return currencyCode(typeof value === 'string' ? value.trim().toUpperCase() : value);
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
 * An amount held in MILLIONTHS of a major unit (the token ledger's micro-USD) as localized money, exactly: 12,340,000
 * is "$12.34", 1,500 is "$0.0015". At least the currency's own decimals, up to six, trailing zeros beyond that dropped.
 * Null when the count is not a safe integer or the currency is not a listed one.
 */
export function formatMicro(micro, code, { locale } = {}) {
  const exp = exponentOf(code);
  const n = typeof micro === 'string' && micro.trim() !== '' ? Number(micro) : micro;
  if (exp === null || typeof n !== 'number' || !Number.isSafeInteger(n)) return null;
  const digits = String(Math.abs(n)).padStart(7, '0');
  const whole = digits.slice(0, -6);
  let frac = digits.slice(-6);
  while (frac.length > exp && frac.endsWith('0')) frac = frac.slice(0, -1);
  if (exp === 0 && frac === '') return new Intl.NumberFormat(locale, { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(`${n < 0 ? '-' : ''}${whole}`);
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: code, minimumFractionDigits: frac.length, maximumFractionDigits: frac.length,
  }).format(`${n < 0 ? '-' : ''}${whole}.${frac}`);
}

/**
 * D5373 — `formatMinor`, or, when the currency is not one we can price in, the stored count of minor units with the
 * currency named: "123,456 minor units (currency "XYZ" is not one we can price in)". For a surface that must show
 * SOMETHING for a stored amount, never a figure read in a guessed currency. Null only when `minor` is not a finite
 * number at all (the caller says "Not recorded"). `locale` and `trimWhole` pass through to `formatMinor`.
 */
export function formatMinorOrCount(minor, code, { locale, trimWhole = false } = {}) {
  const n = typeof minor === 'string' && minor.trim() !== '' ? Number(minor) : minor;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const shown = formatMinor(n, code, { locale, trimWhole });
  if (shown !== null) return shown;
  const named = typeof code === 'string' && code.trim() !== '' ? `"${code}" is not one we can price in` : 'not recorded';
  return `${n.toLocaleString(locale)} minor units (currency ${named})`;
}

/**
 * D5373 — an amount as a plain grouped number at the currency's own decimals, no sign or symbol: "20.00", "2,500",
 * "1.235". For a surface that writes the code beside it ("20.00 USD"). Null for an unusable amount or currency.
 */
export function plainAmount(minor, code, { locale = 'en-US', trimWhole = false } = {}) {
  const exp = exponentOf(code);
  const n = typeof minor === 'string' && minor.trim() !== '' ? Number(minor) : minor;
  if (exp === null || typeof n !== 'number' || !Number.isSafeInteger(n)) return null;
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: trimWhole && n % 10 ** exp === 0 ? 0 : exp, maximumFractionDigits: exp });
  try { return nf.format(decimalText(n, exp)); } catch { return nf.format(n / 10 ** exp); }
}

/**
 * D5373 — "1,200 USD", "12,000 JPY", "1.250 KWD": the amount at the currency's own decimals, then the code. For
 * sentences that write the code after the figure (invoice lines, notices, log lines). A missing or unlisted code names
 * the stored count instead of printing a figure in a guessed currency. Null for a non-number.
 */
export function suffixAmount(minor, code, { locale = 'en-US', trimWhole = false } = {}) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : code;
  const plain = plainAmount(minor, c, { locale, trimWhole });
  if (plain !== null) return `${plain} ${c}`;
  return formatMinorOrCount(minor, c, { locale });
}

/**
 * D5373 — a legacy REAL column holds an amount in MAJOR units (dollars, a float); this is its integer count of minor
 * units, rounded once, at the currency's own exponent. For a surface that must show a legacy dollar column through
 * `formatMinor`. Null for a currency that is not listed or a value that is not a finite number.
 */
export function majorToMinor(major, code) {
  const exp = exponentOf(typeof code === 'string' ? code.trim().toUpperCase() : code);
  const v = typeof major === 'string' && major.trim() !== '' ? Number(major) : major;
  if (exp === null || typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v * 10 ** exp);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * D5373 — "EUR 12,000", "JPY 12,000", "KWD 12.345": the code, then the amount at the currency's own decimals (a whole
 * amount drops them unless `trimWhole` is false). For the licence pages that write the code, not a symbol. A missing or
 * unlisted code names the stored count instead of printing a figure in a guessed currency. Null for a non-number.
 */
export function codeAmount(minor, code, { locale = 'en-US', trimWhole = true } = {}) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : code;
  const plain = plainAmount(minor, c, { locale, trimWhole });
  if (plain !== null) return `${c} ${plain}`;
  return formatMinorOrCount(minor, c, { locale });
}

/**
 * D5373 — Stripe's own units. Stripe counts ISK and UGX in hundredths although ISO 4217 gives them no decimals
 * (D5029), and takes a three-decimal currency in thousandths but only in steps of ten. Everything else is the
 * currency's own minor unit. `fromStripeUnits` / `toStripeUnits` move between Stripe's count and the currency's own
 * minor unit; both return null for a currency that is not listed or an amount that cannot be exact.
 */
export const STRIPE_HUNDREDTHS = Object.freeze(['ISK', 'UGX']);

export function fromStripeUnits(unit, code) {
  const c = currencyCode(typeof code === 'string' ? code.toUpperCase() : code);
  const n = typeof unit === 'string' && unit.trim() !== '' ? Number(unit) : unit;
  if (!c || typeof n !== 'number' || !Number.isSafeInteger(n)) return null;
  if (STRIPE_HUNDREDTHS.includes(c)) return n % 100 === 0 ? n / 100 : null;
  return n;
}

export function toStripeUnits(minor, code) {
  const c = currencyCode(typeof code === 'string' ? code.toUpperCase() : code);
  if (!c || typeof minor !== 'number' || !Number.isSafeInteger(minor)) return null;
  const units = STRIPE_HUNDREDTHS.includes(c) ? minor * 100 : minor;
  if (!Number.isSafeInteger(units)) return null;
  if (exponentOf(c) === 3 && units % 10 !== 0) return null;
  return units;
}

/**
 * A Stripe amount as the grouped number alone at its currency's decimals ("20.00", "2,500", "12.340"), for text that
 * writes the code beside it; the count named when the currency is not a listed one.
 */
export function plainStripeAmount(unit, currency, opts = {}) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : currency;
  const minor = fromStripeUnits(unit, code);
  const plain = minor === null ? null : plainAmount(minor, code, opts);
  return plain ?? stripeCount(unit, code, opts);
}

/** A Stripe count that cannot be shown as an amount: ISK or UGX not in whole hundredths, or a currency that is not listed. */
function stripeCount(unit, code, opts) {
  if (currencyCode(code) && Number.isFinite(Number(unit))) return `${Number(unit).toLocaleString(opts.locale)} Stripe units (not a whole amount of ${code})`;
  return formatMinorOrCount(unit, code, opts) ?? String(unit);
}

/** A Stripe amount (price `unit_amount`, charge `amount`) as localized money in its currency, or the count named. */
export function formatStripeAmount(unit, currency, opts = {}) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : currency;
  const minor = fromStripeUnits(unit, code);
  if (minor !== null) return formatMinor(minor, code, opts);
  return stripeCount(unit, code, opts);
}

/** Major-unit text to Stripe units for a currency, with Stripe's own rules: ISK and UGX in hundredths; a three-decimal currency in steps of ten. */
export function parseStripeAmount(text, currency) {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : currency;
  const parsed = parseMinor(text, code);
  if (!parsed.ok) return parsed;
  const units = toStripeUnits(parsed.minor, code);
  if (units === null) {
    return exponentOf(code) === 3
      ? refuse('decimals', `Stripe takes ${code} in steps of 0.01: the last decimal place must be 0.`)
      : refuse('range', 'That amount is larger than can be recorded exactly.');
  }
  return { ok: true, minor: parsed.minor, units, exponent: parsed.exponent };
}

/**
 * D332 + D5373 — a shared cents-and-currency formatter, so a page cannot print a bare `$` in front of a price whose
 * stored currency is something else. An event ticket carries its own `currency` (a code, stored lower case), and the
 * price is shown at THAT currency's decimals: a 2,500 JPY ticket is ¥2,500, not ¥25. `events.currency` is NOT NULL
 * DEFAULT 'usd', so a payload that names none is the column's default (USD); a code that is not a listed currency is
 * named beside the stored count, never read as dollars. `eventCurrency` is that rule alone, for the event surfaces that
 * lay out their own price text.
 */
export function eventCurrency(currency) {
  return currency === null || currency === undefined || String(currency).trim() === '' ? 'USD' : String(currency).trim().toUpperCase();
}

export function formatEventPrice(cents, currency) {
  const n = Number(cents);
  const code = eventCurrency(currency);
  return String(formatMinorOrCount(Number.isFinite(n) ? n : 0, code));
}
