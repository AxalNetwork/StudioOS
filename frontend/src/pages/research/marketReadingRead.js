/**
 * One market reading, as the page is allowed to say it.
 *
 * The range and the catalog price are different facts. Named engagements are
 * not stored. A fresh reading blanks the dollars. High below low saves nothing.
 * A blank scope is saved as no scope, and the page says Not recorded.
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

/**
 * The scope as typed, or null. Blank is no scope: the Worker stores null and the
 * header says Not recorded. The old scope is never carried forward — it is in
 * the box when the form opens, so clearing the box is how a person removes it.
 */
export function scopeValue(text) {
  const raw = String(text ?? '').trim();
  return raw ? raw.slice(0, 200) : null;
}

/**
 * The body `POST /research/market-readings` gets, or the sentence that says why
 * nothing was sent. Every refusal here is one the Worker makes too.
 */
export function readingSubmission(item, form) {
  const low = dollarsToCents(form?.low);
  const high = dollarsToCents(form?.high);
  const count = comparableCount(form?.n);
  if (low.error || high.error || low.cents == null || high.cents == null) {
    return { error: low.error || high.error || 'Enter the low and the high.' };
  }
  if (high.cents < low.cents) {
    return { error: 'High is below low. Nothing is saved until the range reads forward.' };
  }
  if (count.n == null) return { error: count.error };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form?.ran_at || '')) {
    return { error: 'A reading needs the date you ran it.' };
  }
  return {
    body: {
      offering_uid: item?.offering_uid || undefined,
      metric: item?.metric,
      range_low_cents: low.cents,
      range_high_cents: high.cents,
      comparable_count: count.n,
      ran_at: form.ran_at,
      scope: scopeValue(form?.scope),
    },
  };
}

/**
 * Where this reading stands with a proposal, in the order the page says it.
 *
 * STALE BEATS EVERYTHING, then an attachment. After that, a read that returned
 * no proposal is not "Attachable": proposals are the quotes the caller's partner
 * profile owns, so a licence without one, or a partner with no quote yet, has
 * nowhere to put the reading, and saying Attachable invited a click that could
 * only fail.
 */
export function attachState({ stale, attachments, proposals }) {
  if (stale) return 'blocked';
  if ((attachments || []).length > 0) return 'attached';
  if (!(proposals || []).length) return 'nowhere';
  return 'attachable';
}

/** What the header pill and the Proposal tile say in each state. */
export const ATTACH_COPY = {
  blocked: { pill: 'Re-run before attaching', tone: 'danger', tile: 'Blocked', sub: 're-run before attaching' },
  attached: { pill: 'Attached', tone: 'ok', tile: 'Attached', sub: 'travelling with a quote' },
  nowhere: { pill: 'No proposal to attach to', tone: 'neutral', tile: 'No proposal', sub: 'this account has no quote to attach it to' },
  attachable: { pill: 'Attachable', tone: 'ok', tile: 'Attachable', sub: 'range + run date travel together' },
};

/**
 * The proposals this reading is not on yet. Attaching to the same quote twice
 * writes nothing new (the Worker's `INSERT OR IGNORE`), so "another proposal"
 * offers only these.
 */
export function openProposals(proposals, attachments) {
  const on = new Set((attachments || []).map((a) => String(a.quote_id)));
  return (proposals || []).filter((q) => !on.has(String(q.id)));
}

/** The form a reading opens with: its own figures, run date and scope. */
export function readingFields(item) {
  return {
    low: String(Math.round(item.range_low_cents / 100)),
    high: String(Math.round(item.range_high_cents / 100)),
    n: String(item.comparable_count),
    ran_at: item.ran_at,
    scope: item.scope || '',
  };
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
  const month = monthName(now);
  const article = /^[AEIOU]/.test(month) ? 'an' : 'a';
  return `A client shown a range from ${from}, presented as current reasoning behind ${article} ${month} quote, is worse than a proposal with no market figure.`;
}

export function ageingAttachmentNote(days) {
  return `This one is ${days} days old — still attachable, and the date says so on the quote.`;
}
