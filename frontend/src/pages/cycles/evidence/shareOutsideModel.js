/**
 * D6864 (#6864, canvas D6054 RA-27 to RA-29, RA-32): the pure parts of Share outside Axal, Shared links and Add
 * evidence by hand: the reader choice, what each row tells the reader, link state words and glyphs, the views
 * line, and the form checks the Worker repeats. Every value the Worker decides (what is withheld, the counts, the
 * state) is read from it, never recomputed here.
 */
export const READERS = Object.freeze([
  { key: 'before_nda', word: 'Before an NDA: coverage only', line: 'The reader sees which kinds of evidence you have, how many and how recent. No figures, files or quotes.' },
  { key: 'after_nda', word: 'An NDA is signed outside Axal', line: 'Summaries, a figure only for items you share After NDA, and Value withheld with its reason. Claims show their state.' },
]);
export const readerWord = (k) => READERS.find((r) => r.key === k)?.word || 'Not recorded';
export const LINK_LIMITS = Object.freeze({ expires_in_days: [1, 90], view_limit: [1, 100], label: 80, summary: 200 });
export const NOTHING_SENT = 'Nothing was sent. Copy the link and send it yourself.';
export const COPY_IS_DATED = 'The reader sees this pack as it is now. It does not update; make a new pack after a change.';
export const PDF_LINE = 'A PDF copy, once downloaded, cannot be stopped or counted.';

/** What the reader of an after-NDA pack sees for one projected row (the Worker's own preview read). */
export function readerSees(row) {
  if (!row) return 'Not recorded';
  if (row.value_reason && row.value_reason !== 'No figure is recorded for this item.' && row.value_reason !== 'Shared as a summary only.') return `Value withheld: ${row.value_reason}`;
  if (row.value_reason === 'Shared as a summary only.') return 'Summary, no figure';
  if (row.value_num == null) return 'Summary · Not recorded';
  return 'Summary with figure';
}

/** RA-29 state words: a glyph and a word, never colour alone. */
export const LINK_STATE = Object.freeze({
  live: { glyph: '✓', word: 'Live' },
  expired: { glyph: '◌', word: 'Expired' },
  used_up: { glyph: '◌', word: 'Used up' },
  revoked: { glyph: '✕', word: 'Revoked' },
});
export const linkStateOf = (s) => LINK_STATE[s] || { glyph: '?', word: 'Not recorded' };
export const isGrey = (s) => s !== 'live';
export function viewsLine(link) {
  if (!link || !Number.isInteger(link.view_count) || !Number.isInteger(link.view_limit)) return 'Not recorded';
  return `${link.view_count} of ${link.view_limit}`;
}
export function changedWord(link) {
  if (link?.state !== 'live') return null;
  if (link.changed_since_sent === true) return 'Changed since sent';
  if (link.changed_since_sent === null) return 'Could not be compared';
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
/** The composer's checks (RA-27), the same ones the Worker makes; an error names the field. */
export function composerErrors(form, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  const label = String(form?.label ?? '').trim();
  if (!label) errors.label = 'Give the link a label you will recognise, such as who it is for.';
  else if (label.length > LINK_LIMITS.label) errors.label = `Keep the label under ${LINK_LIMITS.label} characters.`;
  if (form?.reader === 'after_nda') {
    if (form.nda_confirmed !== true) errors.nda_confirmed = 'Confirm that an NDA is signed outside Axal.';
    if (!DAY.test(String(form.nda_signed_on ?? '')) || form.nda_signed_on > today) errors.nda_signed_on = 'Enter the day the NDA was signed. It cannot be in the future.';
  }
  if (!intIn(Number(form?.expires_in_days), LINK_LIMITS.expires_in_days)) errors.expires_in_days = 'A link lasts from 1 to 90 days.';
  if (!intIn(Number(form?.view_limit), LINK_LIMITS.view_limit)) errors.view_limit = 'Allow from 1 to 100 views.';
  if (Array.isArray(form?.items) && form.items.length === 0) errors.items = 'Tick at least one item.';
  return errors;
}
/** The body the Worker takes: only the fields it accepts. */
export function composerBody(form) {
  const body = { label: String(form.label).trim(), reader: form.reader, expires_in_days: Number(form.expires_in_days), view_limit: Number(form.view_limit) };
  if (form.reader === 'after_nda') { body.nda_confirmed = form.nda_confirmed === true; body.nda_signed_on = form.nda_signed_on; }
  if (Array.isArray(form.items)) body.items = form.items;
  return body;
}

/** RA-32: Add evidence by hand. Source, strength and sharing are fixed; the founder cannot pick them here. */
export const TYPED_FIXED = Object.freeze({ source: 'Typed: stated by you', strength: 'Anecdote', sharing: 'Private' });
export function typedErrors(form, areas, today = new Date().toISOString().slice(0, 10)) {
  const errors = {};
  if (!areas.includes(form?.area)) errors.area = 'Choose the area this evidence belongs to.';
  const summary = String(form?.summary ?? '').trim();
  if (!summary) errors.summary = 'Write one line saying what this evidence shows.';
  else if (summary.length > LINK_LIMITS.summary) errors.summary = `Keep it under ${LINK_LIMITS.summary} characters.`;
  const hasValue = String(form?.value ?? '').trim() !== '';
  if (hasValue && !Number.isFinite(Number(form.value))) errors.value = 'Enter a number, or leave it empty.';
  if (!hasValue && String(form?.unit ?? '').trim()) errors.unit = 'A unit needs a value.';
  if (form?.observed_on && (!DAY.test(form.observed_on) || form.observed_on > today)) errors.observed_on = 'The day cannot be in the future.';
  return errors;
}
export function typedBody(form) {
  const body = { area: form.area, summary: String(form.summary).trim() };
  if (String(form.value ?? '').trim() !== '') { body.value_num = Number(form.value); if (String(form.unit ?? '').trim()) body.value_unit = String(form.unit).trim(); }
  if (form.observed_on) body.observed_on = form.observed_on;
  return body;
}

/** The reader's refusal pages (RA-36) come from the Worker; this is the fallback when it said nothing readable. */
export const REFUSAL_FALLBACK = Object.freeze({ title: 'This link does not open anything', sentence: 'Ask the sender for a new link.' });
