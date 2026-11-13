// D801 (#2234) — HQ's terms schedule editor, as pure functions the page and
// its tests share.
//
// THE FIELD LIST IS D797'S, NEVER COPIED HERE. `LICENCE_TERM_FIELDS` is imported
// from the Worker's own `services/licenceTerms.ts`, the module the PUT validates
// with, so a key D797 adds appears in the editor on its own and the editor can
// never offer a key the Worker refuses. Only the section titles live here.
//
// UNITS. A screen types money and percentages; the store keeps whole minor units and
// whole basis points. Each conversion is exact both ways: "1234.5" EUR is 123450
// minor units, "12.5" % is 1250 bps, and more decimals than the currency has is
// refused rather than rounded. Money follows the LICENCE'S currency (D5029,
// `lib/money.js`): 1234 JPY is 1234, 1.005 KWD is 1005. A licence with no usable currency
// shows its stored count of minor units and cannot have a money term edited, rather than being read as euros.
// A cleared field saves `null`, which every reader shows as "Not recorded".
import { DEFAULT_TERM_SECTIONS, LICENCE_TERM_FIELDS } from '../../../cloudflare-worker/src/services/licenceTerms.ts';
import { currencyCode, exponentOf, parseMinor, toMajorString } from './money';

// D4819: the canvas's default contract sections, which every stored schedule
// reads under its own overrides; a licence with no schedule row reads them too.
export { DEFAULT_TERM_SECTIONS, LICENCE_TERM_FIELDS };

/**
 * The canvas's section titles (board L9), by D797 group. A group D797 adds later
 * and this map does not name still renders, under its key. "Seats" and "Brand
 * and platform" hold one D797 term each (what a seat includes, the brand kit);
 * the seat counts and the brand itself stay the Seats and Brand steps.
 */
export const TERM_GROUP_TITLES = {
  parties: 'Parties',
  territory: 'Territory and exclusivity',
  renewal: 'Term and renewal',
  money: 'Fees and money',
  deal: 'Deal terms',
  seats: 'Seats',
  brand: 'Brand and platform',
  reporting: 'Compliance and reporting',
};

const groupTitle = (g) => TERM_GROUP_TITLES[g] || String(g).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The fields by section, in the field list's own order. */
export function termSections(fields = LICENCE_TERM_FIELDS) {
  const out = [];
  for (const f of fields) {
    let s = out.find((x) => x.group === f.group);
    if (!s) { s = { group: f.group, title: groupTitle(f.group), fields: [] }; out.push(s); }
    s.fields.push(f);
  }
  return out;
}

import { NOT_RECORDED } from './absence';

export { NOT_RECORDED };

const UNIT_WORDS = { months: 'months', days: 'days', business_days: 'business days', day_of_month: '' };

/** The unit a field's input is typed in, as the label beside it. */
export function unitOf(field, currency) {
  if (field.type === 'cents') return currency || '';
  if (field.type === 'bps') return '%';
  if (field.type === 'int') return UNIT_WORDS[field.unit] ?? '';
  return '';
}

/** Words for an enum value: `on_request` → "On request". */
export const enumLabel = (v) => String(v).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** A stored value as its input's text; null is the empty field. */
export function toInput(field, value, currency) {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'cents': {
      // Exact text in the licence's own decimals. With no usable currency the
      // stored count is shown as it is: never blanked (a save would clear it) and never divided by a guessed factor.
      const major = toMajorString(Number(value), currency);
      if (major === null) return String(value);
      // A fractional amount keeps all of the currency's decimals ("1234.50", "1.005"); a whole one has none ("1234").
      return Number(value) % (10 ** exponentOf(currency)) ? major : major.split('.')[0];
    }
    case 'bps': {
      const n = Number(value);
      const whole = Math.trunc(n / 100);
      const rest = n % 100;
      if (!rest) return String(whole);
      return `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
    }
    case 'bool': return Number(value) === 1 ? 'yes' : 'no';
    default: return String(value);
  }
}

/** A decimal with at most two places, as whole hundredths, or null when it is not one. */
function hundredths(text) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * An input's text as the value to store, or the sentence that refuses it.
 * The empty field is `null`: "Not recorded".
 */
export function fromInput(field, raw, currency) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: null };
  switch (field.type) {
    case 'cents': {
      if (!currencyCode(currency)) return { ok: false, message: 'Record the licence currency before editing a money term.' };
      const parsed = parseMinor(text, currency);
      return parsed.ok ? { ok: true, value: parsed.minor } : { ok: false, message: parsed.message };
    }
    case 'bps': {
      const n = hundredths(text);
      if (n === null) return { ok: false, message: 'Type a percentage, with at most two decimals.' };
      return n > 10000 ? { ok: false, message: 'A percentage is at most 100.' } : { ok: true, value: n };
    }
    case 'int': {
      if (!/^\d+$/.test(text)) return { ok: false, message: 'Type a whole number.' };
      const n = Number(text);
      return n < field.min || n > field.max
        ? { ok: false, message: `From ${field.min} to ${field.max}.` }
        : { ok: true, value: n };
    }
    case 'bool':
      if (text === 'yes') return { ok: true, value: 1 };
      if (text === 'no') return { ok: true, value: 0 };
      return { ok: false, message: 'Yes or no.' };
    case 'enum':
      return field.values.includes(text) ? { ok: true, value: text } : { ok: false, message: 'Pick one of the choices.' };
    case 'text':
      return text.length > field.max ? { ok: false, message: `At most ${field.max} characters.` } : { ok: true, value: text };
    default:
      return { ok: false, message: 'This term cannot be edited here.' };
  }
}

/** A stored value as the page reads it: money in the licence's currency, bps as a percentage, "Not recorded" for null. */
export function displayValue(field, value, currency) {
  if (value === null || value === undefined) return NOT_RECORDED;
  switch (field.type) {
    case 'cents': {
      const exp = exponentOf(currency);
      const major = toMajorString(Number(value), currency);
      if (exp === null || major === null) return `${Number(value).toLocaleString('en-GB')} minor units (currency ${currency ? `"${currency}" is not one we can price in` : 'not recorded'})`;
      // Whole amounts show no decimals ("EUR 90,000"); a fraction shows the currency's own number of them.
      const fraction = Number(value) % (10 ** exp) !== 0;
      return `${currency} ${new Intl.NumberFormat('en-GB', { minimumFractionDigits: fraction ? exp : 0, maximumFractionDigits: exp }).format(major)}`;
    }
    case 'bps': return `${toInput(field, value)}%`;
    case 'bool': return Number(value) === 1 ? 'Yes' : 'No';
    case 'enum': return enumLabel(value);
    case 'int': return field.unit === 'day_of_month' ? `Day ${value}` : `${value} ${UNIT_WORDS[field.unit] ?? ''}`.trim();
    default: return String(value);
  }
}

/** The form's starting state from a stored schedule: each field's text and contract section. */
export function initialForm(stored, fields = LICENCE_TERM_FIELDS, currency) {
  const values = {};
  const sections = {};
  for (const f of fields) {
    values[f.key] = toInput(f, stored?.terms?.[f.key] ?? null, currency);
    sections[f.key] = stored?.sections?.[f.key] ?? '';
  }
  return { values, sections };
}

/**
 * The PUT's body: only the terms and sections that changed from what is
 * stored, so a save never rewrites a term nobody touched. A cleared value is
 * `null`, a cleared section `null`. With an error, nothing is sent and every
 * refused field is named.
 */
export function buildSave(stored, form, reason, fields = LICENCE_TERM_FIELDS, currency) {
  const errors = {};
  const terms = {};
  const sections = {};
  for (const f of fields) {
    // A money term on a licence with no usable currency is shown as its stored count and cannot be edited; left as
    // shown, it is unchanged, not an error and not a clear.
    if (f.type === 'cents' && !currencyCode(currency)
      && String(form.values[f.key] ?? '').trim() === toInput(f, stored?.terms?.[f.key] ?? null, currency)) continue;
    const parsed = fromInput(f, form.values[f.key], currency);
    if (!parsed.ok) { errors[f.key] = parsed.message; continue; }
    const before = stored?.terms?.[f.key] ?? null;
    if (parsed.value !== before) terms[f.key] = parsed.value;
    const sec = String(form.sections[f.key] ?? '').trim();
    const secBefore = stored?.sections?.[f.key] ?? '';
    if (sec !== secBefore) sections[f.key] = sec || null;
  }
  const why = String(reason ?? '').trim();
  if (!why) errors.reason = 'Say why these terms are changing. It is kept in the licence\'s history.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const changed = Object.keys(terms).length + Object.keys(sections).length;
  if (!changed) return { ok: false, errors: { form: 'Nothing has changed.' } };
  return {
    ok: true,
    body: {
      ...(Object.keys(terms).length ? { terms } : {}),
      ...(Object.keys(sections).length ? { sections } : {}),
      reason: why,
      // D4694 — the revision the form was read at; a save from an older one is refused with a 409.
      expected_revision: Number.isSafeInteger(stored?.revision) ? stored.revision : 0,
    },
  };
}

/** The DOM id of a term's row, for "Open terms". */
export const termRowId = (key) => `licence-term-${key}`;
