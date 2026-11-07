/**
 * One definition of how much an advisor may write, and in what currency (D4674).
 *
 * The advisor routes used to cut text with `.slice(0, n)` and report the write
 * as saved: a 2,500-character scope became 2,000 characters on the Worker and
 * the editor went on showing 2,500. A value over its limit is now a 400 that
 * names the field and the limit, and `frontend/src/lib/advisorLimits.js` holds
 * the same numbers for the inputs' `maxLength` (a test holds the two equal).
 */
export const SERVICE_LIMITS = { title: 200, duration_note: 200, scope: 2000 } as const;
export const PROFILE_LIMITS = {
  display_name: 200, bio: 4000, linkedin_url: 500, headline: 200, country: 100,
  timezone: 100, availability_note: 500, headshot_url: 1000,
} as const;
/** A list field (expertise, sectors, stages, languages) holds at most this many entries. */
export const LIST_MAX_ITEMS = 32;

/**
 * The currencies a service may be priced in: those that divide into hundredths,
 * because the price is stored as whole minor units and every one of these has
 * exactly two. (A zero- or three-decimal currency would read ten times or a
 * thousand times off, so it is not offered until it has its own exponent.)
 */
export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'SGD'] as const;

export class AdvisorValidationError extends Error {
  code: string;
  field?: string;
  max?: number;
  constructor(code: string, message: string, field?: string, max?: number) {
    super(message);
    this.code = code; this.field = field; this.max = max;
  }
}

/** Trimmed text, or null when blank; over its limit is refused, never cut. */
export function boundedText(field: string, v: unknown, max: number): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  if (!t) return null;
  if (t.length > max) {
    throw new AdvisorValidationError('too_long', `${field.replace(/_/g, ' ')} is at most ${max} characters; this is ${t.length}.`, field, max);
  }
  return t;
}

/** A list of strings, at most LIST_MAX_ITEMS long; more is refused, never dropped. */
export function boundedList(field: string, v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  if (v.length > LIST_MAX_ITEMS) {
    throw new AdvisorValidationError('too_many', `${field} holds at most ${LIST_MAX_ITEMS} entries; this has ${v.length}.`, field, LIST_MAX_ITEMS);
  }
  return v.map(String);
}

/** A currency the price list supports, or a refusal that lists them. */
export function supportedCurrency(v: unknown): string {
  const code = String(v ?? '').trim().toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(code)) {
    throw new AdvisorValidationError('currency_unsupported', `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}.`, 'currency');
  }
  return code;
}

/** A price in whole minor units: a number or a digit string, never "1e3", "12,50" or 12.5. */
export function wholeCents(v: unknown): number | null {
  if (v == null || v === '') return null;
  const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\d+$/.test(v.trim()));
  const n = ok ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new AdvisorValidationError('price_invalid', 'price_cents must be a whole number of cents, zero or more', 'price_cents');
  }
  if (n > 100_000_000_00) throw new AdvisorValidationError('price_invalid', 'price_cents is implausibly large', 'price_cents');
  return n;
}

/** An hourly rate in dollars: a number or a plain decimal string with at most two places. */
export function hourlyRate(v: unknown): number | null {
  if (v == null || v === '') return null;
  const ok = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v.trim()));
  const n = ok ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) {
    throw new AdvisorValidationError('rate_invalid', 'Hourly rate must be a non-negative number', 'hourly_rate_usd');
  }
  return n;
}
