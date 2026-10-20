// D801 (#2234) — HQ's terms schedule editor, as pure functions the page and
// its tests share.
//
// THE FIELD LIST IS D797'S, NEVER COPIED HERE. `LICENCE_TERM_FIELDS` is imported
// from the Worker's own `services/licenceTerms.ts`, the module the PUT validates
// with, so a key D797 adds appears in the editor on its own and the editor can
// never offer a key the Worker refuses. Only the section titles live here.
//
// UNITS. A screen types money and percentages; the store keeps whole cents and
// whole basis points. Each conversion is exact both ways: "1234.5" is 123450
// cents, "12.5" % is 1250 bps, and anything with more than two decimals is
// refused rather than rounded. A cleared field saves `null`, which every reader
// shows as "Not recorded".
import { LICENCE_TERM_FIELDS } from '../../../cloudflare-worker/src/services/licenceTerms.ts';

export { LICENCE_TERM_FIELDS };

/**
 * The canvas's section titles (board L9), by D797 group. A group D797 adds later
 * and this map does not name still renders, under its key. The canvas's "Seats"
 * and "Brand and platform" hold no D797 term: they are the Seats and Brand steps.
 */
export const TERM_GROUP_TITLES = {
  parties: 'Parties',
  territory: 'Territory and exclusivity',
  renewal: 'Term and renewal',
  money: 'Fees and money',
  deal: 'Deal terms',
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
export function toInput(field, value) {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'cents': {
      const n = Number(value);
      const whole = Math.trunc(n / 100);
      const rest = Math.abs(n % 100);
      return rest ? `${whole}.${String(rest).padStart(2, '0')}` : String(whole);
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
export function fromInput(field, raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: null };
  switch (field.type) {
    case 'cents': {
      const n = hundredths(text.replace(/,/g, ''));
      return n === null ? { ok: false, message: 'Type an amount, with at most two decimals.' } : { ok: true, value: n };
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
    case 'cents': return `${currency ? `${currency} ` : ''}${Number(toInput(field, value)).toLocaleString('en-GB', { minimumFractionDigits: Number(value) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
    case 'bps': return `${toInput(field, value)}%`;
    case 'bool': return Number(value) === 1 ? 'Yes' : 'No';
    case 'enum': return enumLabel(value);
    case 'int': return field.unit === 'day_of_month' ? `Day ${value}` : `${value} ${UNIT_WORDS[field.unit] ?? ''}`.trim();
    default: return String(value);
  }
}

/** The form's starting state from a stored schedule: each field's text and contract section. */
export function initialForm(stored, fields = LICENCE_TERM_FIELDS) {
  const values = {};
  const sections = {};
  for (const f of fields) {
    values[f.key] = toInput(f, stored?.terms?.[f.key] ?? null);
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
export function buildSave(stored, form, reason, fields = LICENCE_TERM_FIELDS) {
  const errors = {};
  const terms = {};
  const sections = {};
  for (const f of fields) {
    const parsed = fromInput(f, form.values[f.key]);
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
    },
  };
}

/** The DOM id of a term's row, for "Open terms". */
export const termRowId = (key) => `licence-term-${key}`;
