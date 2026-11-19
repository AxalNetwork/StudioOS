import { formatMinor, parseMinor, toMajorString } from '../../lib/money.js';

/**
 * One market reading, as the page is allowed to say it.
 *
 * The range and the catalog price are different facts. Named engagements are
 * not stored. A fresh reading blanks the dollars. High below low saves nothing.
 * A blank scope is saved as no scope, and the page says Not recorded.
 *
 * D7174 (#7174, canvas D7039) — EVERY AMOUNT IS STORED CENTS, WRITTEN WITH TWO
 * DECIMALS. A comparable range is US dollars by contract (`range_low_cents`
 * and `range_high_cents` carry no currency column), so every conversion goes
 * through `lib/money.js` at `USD`: $99.50 – $99.99 stays exactly that in the
 * form, the saved detail, a reopened form, the list, the CSV export and the
 * catalog line. Whole dollars read $4,500.00 (the owner's answer A,
 * D7039-p2), and a true $0.00 – $0.00 is a value.
 */
const USD = 'USD';

export const THIN_BELOW = 6;

/**
 * THE AGE WINDOWS ARE THE ARTBOARD'S OWN NUMBERS, transcribed and not chosen:
 * `Pages · Partner Research` declares `const STALE_AT = 90, AGE_AT = 30`, where
 * `Pages · Advisor Research` says a hundred and twenty. A reading past ninety
 * days is BLOCKED from attachment rather than marked stale; one past thirty is
 * ageing and still attachable, with its age on the row. They, `daysSince` and
 * `ageBand` lived in the unmounted `MarketZone` body until D6285 (#6285).
 */
export const STALE_AT = 90;
export const AGE_AT = 30;

/**
 * Whole days since `iso`, or null when it is not a date. Age is computed from
 * `ran_at` and from nothing else: `updated_at` moves when a row is touched,
 * which would make every reading look current the moment anyone edited one.
 */
export const daysSince = (iso) => {
  const at = Date.parse(iso || '');
  return Number.isFinite(at) ? Math.floor((Date.now() - at) / 86400000) : null;
};

/**
 * A reading's age band, or null when it has never been run.
 *
 * NULL IS ITS OWN ANSWER and never falls into `stale`. A service line nobody has
 * priced the market for has not gone out of date — there is nothing to have
 * aged — and sorting it into the stale bucket would tell a firm to re-run a
 * reading it has never run once.
 */
export function ageBand(days) {
  if (days === null) return null;
  if (days > STALE_AT) return 'stale';
  if (days > AGE_AT) return 'ageing';
  return 'current';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The sentence under each field the form refuses (D7039 RMP-08). */
export const RANGE_BACKWARDS = 'High is below low. Nothing is saved until the range reads forward.';
export const FIELD_COPY = {
  metric: 'Name what the range prices.',
  low: 'Enter the low. A range needs both ends.',
  high: 'Enter the high. A range needs both ends.',
  decimals: (typed) => `Use dollars and cents: two digits after the point at most. ${typed} is not rounded for you.`,
  format: 'Enter dollars and cents as digits, such as 99.50.',
  negative: 'A comparable range starts at $0.00. Enter the amount without a minus sign.',
  count: 'How many engagements the range came from: a whole number, 1 or more. Refused if 0.',
  ranAt: 'A reading needs the date you ran it.',
};

/**
 * Typed dollars to integer cents, exactly, or the sentence that refuses them.
 * `side` names the field a blank belongs to. More than two decimals is
 * refused, never rounded: 99.505 is not 99.51 (`parseMinor`).
 */
export function dollarsToCents(text, side = 'low') {
  const raw = String(text ?? '').replace(/[$\s]/g, '');
  if (!raw) return { cents: null, error: side === 'high' ? FIELD_COPY.high : FIELD_COPY.low };
  const parsed = parseMinor(raw, USD);
  if (parsed.ok) return { cents: parsed.minor, error: null };
  if (parsed.reason === 'decimals') return { cents: null, error: FIELD_COPY.decimals(raw) };
  if (parsed.reason === 'negative') return { cents: null, error: FIELD_COPY.negative };
  if (parsed.reason === 'range') return { cents: null, error: parsed.message };
  return { cents: null, error: FIELD_COPY.format };
}

/** Null when either side is still blank or unreadable. False when the range runs backwards. */
export function rangeReadsForward(lowText, highText) {
  const low = dollarsToCents(lowText, 'low');
  const high = dollarsToCents(highText, 'high');
  if (low.cents == null || high.cents == null) return null;
  return high.cents >= low.cents;
}

export function comparableCount(text) {
  const raw = String(text ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) < 1) return { n: null, error: FIELD_COPY.count };
  return { n: Number(raw), error: null };
}

/**
 * Every refusal of a form, keyed by the field it sits under, plus `row` for a
 * range that runs backwards. Empty when the form would be accepted. `metric`
 * is checked only where the form names what it prices (the directory's form
 * with no service line chosen). These are the Worker's own refusals, made
 * first, so nothing is sent that it would turn away.
 */
export function readingErrors(form, { needMetric = false } = {}) {
  const errors = {};
  if (needMetric && !form?.offering_uid && !String(form?.metric || '').trim()) errors.metric = FIELD_COPY.metric;
  const low = dollarsToCents(form?.low, 'low');
  const high = dollarsToCents(form?.high, 'high');
  if (low.error) errors.low = low.error;
  if (high.error) errors.high = high.error;
  if (low.cents != null && high.cents != null && high.cents < low.cents) errors.row = RANGE_BACKWARDS;
  const count = comparableCount(form?.n);
  if (count.error) errors.n = count.error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form?.ran_at || ''))) errors.ran_at = FIELD_COPY.ranAt;
  return errors;
}

/** The order a form's refusals are read in, top to bottom. */
export const ERROR_ORDER = ['metric', 'low', 'high', 'row', 'n', 'ran_at'];

/** The first refusal, as one sentence, or null. */
export function firstError(errors) {
  const key = ERROR_ORDER.find((k) => errors?.[k]);
  return key ? errors[key] : null;
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
  const errors = readingErrors(form);
  const error = firstError(errors);
  if (error) return { error, errors };
  return {
    body: {
      offering_uid: item?.offering_uid || undefined,
      metric: item?.metric,
      range_low_cents: dollarsToCents(form.low, 'low').cents,
      range_high_cents: dollarsToCents(form.high, 'high').cents,
      comparable_count: comparableCount(form.n).n,
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
 * Licences whose readings have no quote to go onto (#6279). Proposals are the
 * quotes a partner profile owns, so a founder or an investor reads none. Their
 * page draws no Proposal tile, pill or card and says in one line what a reading
 * is for them instead. Partner and advisor keep the attachment card, including
 * its "No proposal on this account" line, unchanged. A founder or investor read
 * that does carry a proposal or an attachment still draws the card.
 */
export const OWN_RECORD_LINE = {
  founder: 'On a founder licence, a reading is your own record of what comparable work went for, kept here to weigh a price you are offered.',
  investor: 'On an investor licence, a reading is your own record of what comparable work went for, kept here for your diligence.',
};

export function attachesNowhere(role, { attachments, proposals } = {}) {
  return Object.hasOwn(OWN_RECORD_LINE, role)
    && !(attachments || []).length
    && !(proposals || []).length;
}

/** The plain name of the draft pill (#6279): what it is, not the canvas's token. */
export const DRAFT_PILL = 'Draft, not saved';

/**
 * The proposals this reading is not on yet. Attaching to the same quote twice
 * writes nothing new (the Worker's `INSERT OR IGNORE`), so "another proposal"
 * offers only these.
 */
export function openProposals(proposals, attachments) {
  const on = new Set((attachments || []).map((a) => String(a.quote_id)));
  return (proposals || []).filter((q) => !on.has(String(q.id)));
}

/**
 * The form a reading opens with: its own figures to the cent, run date and
 * scope. 9950 and 9999 open as 99.50 and 99.99, so saving unchanged writes
 * 9950 and 9999 again, never a range rounded to whole dollars (D7039 RMP-05).
 */
export function readingFields(item) {
  return {
    low: usdPlain(item.range_low_cents) ?? '',
    high: usdPlain(item.range_high_cents) ?? '',
    n: String(item.comparable_count),
    ran_at: item.ran_at,
    scope: item.scope || '',
  };
}

/** A re-run is a new reading. The old dollars do not come forward. */
export function freshReadingForm(form, today) {
  return { ...(form || {}), low: '', high: '', ran_at: today };
}

/** Stored cents as US dollars with two decimals: $99.50, $4,500.00, $0.00. Null for no amount. */
export function usd(cents) {
  if (cents == null || cents === '') return null;
  return formatMinor(Number(cents), USD, { locale: 'en-US' });
}

/** Stored cents as the plain decimal a form box or a CSV cell holds: 99.50. Null for no amount. */
export function usdPlain(cents) {
  if (cents == null || cents === '') return null;
  return toMajorString(Number(cents), USD);
}

/** The catalog's own price, a line of its own and never part of the range. */
export function catalogLine(cents) {
  const amount = usd(cents);
  return amount ? `Catalog price ${amount}` : null;
}

/** "$99.50 – $99.99", or null when the reading holds no range. */
export function rangeLine(item) {
  const low = usd(item?.range_low_cents);
  const high = usd(item?.range_high_cents);
  return low && high ? `${low} – ${high}` : null;
}

/** The saved reading in one sentence: "$99.50 – $99.99 from 7 comparables, run 2026-11-16." */
export function recordedLine(item) {
  const range = rangeLine(item);
  if (!range) return '';
  const n = item.comparable_count;
  return `${range} from ${n} comparable${n === 1 ? '' : 's'}, run ${String(item.ran_at || '').slice(0, 10)}.`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Mon 16 Nov 2026" for a run date, or null when it is not one. */
export function runDayLabel(iso) {
  const day = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(at.getTime())) return null;
  return `${DAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()].slice(0, 3)} ${at.getUTCFullYear()}`;
}

/**
 * The reading's age, sample size and limits in plain words, from the stored
 * fields only (D7039 RMP-04, RMP-10). `ownRecord` is a licence with no quote
 * to put a reading on (#6279): its age line does not talk about attaching.
 */
export function plainWords({ ranAt, days, band, comparableCount: count, ownRecord = false }) {
  const when = days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  const on = runDayLabel(ranAt) || String(ranAt || '').slice(0, 10);
  let ageing;
  if (band === 'stale') {
    ageing = ownRecord
      ? `That is past ${STALE_AT} days, so it is stale: record a fresh reading before you rely on it.`
      : `That is past ${STALE_AT} days, so it is stale: record a fresh reading before a proposal cites it.`;
  } else if (band === 'ageing') {
    ageing = ownRecord
      ? `That is past ${AGE_AT} days, so it is ageing; the run date stays with it.`
      : `That is past ${AGE_AT} days, so it is ageing; still attachable, and the date travels with it.`;
  } else {
    ageing = `Readings start ageing after ${AGE_AT} days and go stale after ${STALE_AT}.`;
  }
  const sample = count < THIN_BELOW
    ? `Fewer than ${THIN_BELOW} is a thin base; a client may ask for the names before the number.`
    : 'Enough to state the range, though none of them is named here.';
  return {
    age: `You ran it on ${on}, ${when}. ${ageing}`,
    sample: `${count} comparable engagement${count === 1 ? '' : 's'}. ${sample}`,
    not: 'A count is not a list of named engagements, and it does not show demand for this work.',
  };
}

/** The columns of the readings export (D7039 RMP-12). The catalog price is not one of them. */
export const READINGS_CSV_HEADER = ['metric', 'service_line', 'scope', 'low_usd', 'high_usd', 'comparables', 'ran_at', 'age_days', 'age'];

/**
 * The list's rows as CSV cells. Amounts are plain decimals with two places;
 * an empty cell is Not recorded, never 0. A service line never read keeps its
 * row, with every reading cell empty and its age `not_recorded`.
 */
export function readingsCsvRows(items = []) {
  return items.map((r) => {
    const read = Boolean(r.uid);
    const days = read ? daysSince(r.ran_at) : null;
    const band = days == null ? null : ageBand(days);
    return [
      r.metric,
      r.offering_uid ? 'yes' : 'no',
      read ? (r.scope || null) : null,
      read ? usdPlain(r.range_low_cents) : null,
      read ? usdPlain(r.range_high_cents) : null,
      read ? r.comparable_count : null,
      read ? (String(r.ran_at || '').slice(0, 10) || null) : null,
      days,
      band || 'not_recorded',
    ];
  });
}

/**
 * D6273 Q2 (RS-17, answered A): pricing readings are hidden from the investor
 * view. The directory draws no readings card, and the reading page says the
 * reading is not on their list without reading it (D7039 RMP-11, the owner's
 * answer A in D7039-p2).
 */
export const readingsHiddenFor = (role) => role === 'investor';

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
