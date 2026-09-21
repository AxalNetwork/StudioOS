/**
 * One market reading, as the page is allowed to say it.
 *
 * The range and the catalog price are different facts. Named engagements are
 * not stored. A fresh reading blanks the dollars. High below low saves nothing.
 */

export const THIN_BELOW = 6;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function dollarsToCents(text) {
  const raw = String(text ?? '').replace(/[$,\s]/g, '');
  if (!raw) return { cents: null, error: 'Enter the low and the high.' };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { cents: null, error: 'Enter a dollar amount.' };
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isInteger(cents) || cents < 0) return { cents: null, error: 'Enter a dollar amount.' };
  return { cents, error: null };
}

/** Null when either side is still blank. False when the range runs backwards. */
export function rangeReadsForward(lowText, highText) {
  const low = dollarsToCents(lowText);
  const high = dollarsToCents(highText);
  if (low.cents == null || high.cents == null) return null;
  return high.cents >= low.cents;
}

export function comparableCount(text) {
  const raw = String(text ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    return { n: null, error: 'How many engagements the range came from. Refused if 0.' };
  }
  return { n: Number(raw), error: null };
}

/** A re-run is a new reading. The old dollars do not come forward. */
export function freshReadingForm(form, today) {
  return { ...(form || {}), low: '', high: '', ran_at: today };
}

export function catalogLine(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const dollars = Math.round(Number(cents) / 100);
  return `Catalog lists $${dollars.toLocaleString('en-US')}`;
}

export function usd(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  return `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`;
}

export function runMonth(iso) {
  const day = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const month = Number(day.slice(5, 7));
  return MONTHS[month - 1] || null;
}

export function monthName(date) {
  const month = date.getMonth();
  return MONTHS[month] || 'this month';
}

/**
 * The draft reads age and thinness off this reading. It has no second range
 * to compare against and does not invent one.
 */
export function readingDraft({ days, band, comparableCount: count }) {
  const ageLabel = band === 'stale' ? 'stale' : (band === 'ageing' ? 'ageing' : 'current');
  const thin = count < THIN_BELOW;
  const basis = thin
    ? `The range rests on ${count} comparables, which is thin enough that a client may ask for the names before the number.`
    : `${count} comparables is enough to state the range without hedging, though none of them are named here.`;
  const blocked = band === 'stale'
    ? ' Nothing can be attached until a fresh reading is recorded.'
    : '';
  return `This reading is ${days} days old and reads ${ageLabel}. ${basis}${blocked}`;
}

export function staleAttachmentSentence(ranAt, now = new Date()) {
  const from = runMonth(ranAt) || 'an earlier month';
  return `A client shown a range from ${from}, presented as current reasoning behind a ${monthName(now)} quote, is worse than a proposal with no market figure.`;
}

export function ageingAttachmentNote(days) {
  return `This one is ${days} days old — still attachable, and the date says so on the quote.`;
}
