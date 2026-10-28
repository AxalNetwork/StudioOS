/**
 * D1328 (#3489, part 5 of #2431) — Fill with Eadwyn on the founder's forms:
 * which cycle form has a sheet, what a placed value is, what Save then
 * records, and the row proposals waiting for a module (AF1, AF3, AF7, AF16).
 * No React and no fetch: `pages/cycles/FormLightbox.jsx` and
 * `pages/cycles/FillRowsPanel.jsx` draw it.
 *
 * THE RULES (#2431, D1323 §4). Eadwyn proposes and a person accepts. In a
 * form nothing is written until Save: a placed value is the form's own, shown
 * "Not saved", and Save writes it through the form's own route, then
 * `POST /api/fills/record` keeps only what still equals each proposal. A
 * typed value is never replaced by Accept all (the sheet's rule). A row
 * proposal is written by `POST /api/fills/rows/accept`, each through its
 * form's own writer, at most 50, each outcome reported.
 */
import { fieldsOf } from './fillFields.js';

/** Each founder module whose Add form FILL_FIELDS lists, by `<cycle>/<slug>`, as its page. */
export const FILL_PAGES = Object.freeze({
  'validate/problem-discovery': 'Founder · Validate · Problem discovery',
  'validate/ideal-customer-profile': 'Founder · Validate · Ideal customer profile',
  'validate/experiments': 'Founder · Validate · Experiments and evidence',
  'build/solution-design': 'Founder · Build · Solution design',
  'build/prototype-mvp': 'Founder · Build · Prototype / MVP',
});

/** The sheet a cycle form opens, `{ page, form }`, or null when FILL_FIELDS lists none of its fields. */
export function fillTarget(cycle, slug, formKey) {
  const page = FILL_PAGES[`${cycle}/${slug}`];
  if (!page || typeof formKey !== 'string' || !formKey) return null;
  return fieldsOf(page, formKey).length ? { page, form: formKey } : null;
}

/** A module's first Add form that has a sheet, for its "Fill with Eadwyn" (AF1), or null. */
export function moduleFillTarget(cycle, slug, forms) {
  for (const f of Array.isArray(forms) ? forms : []) {
    const t = fillTarget(cycle, slug, f?.key);
    if (t) return { ...t, label: f.cta || f.button || f.title || 'Add' };
  }
  return null;
}

/** The row a form's Save created or wrote, from the route's `{ id }`; null for anything else. */
export function savedId(result) {
  const id = Number(result?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The proposals Save sends to `POST /api/fills/record`: each placed Eadwyn
 * value's uid. A placed value the member changed is still sent: the Worker
 * reads the saved row and discards a proposal whose field no longer equals it,
 * so a changed value is never filed as Eadwyn's.
 */
export function placedProposals(placed) {
  return [...new Set(Object.values(placed || {}).map((p) => p?.proposal_uid).filter((u) => typeof u === 'string' && u))];
}

/** The values the sheet handed back, as `{ field: value }` and the placed map the marks read. */
export function placeValues(list, fieldNames) {
  const names = new Set(fieldNames);
  const values = {};
  const placed = {};
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || !names.has(item.field) || item.value == null) continue;
    values[item.field] = String(item.value);
    placed[item.field] = { value: String(item.value), source_kind: item.source_kind || null, proposal_uid: item.proposal_uid || null };
  }
  return { values, placed };
}

/** Whether a placed field still holds what was placed: its "Not saved" mark goes once the member types over it. */
export const stillPlaced = (placed, name, value) => !!placed?.[name] && String(value ?? '') === placed[name].value;

/**
 * The member's own row proposals for this form and venture, waiting
 * (`GET /api/ai/rail/proposals?option=form:<form>&status=proposed`): a field
 * proposal (a value for a form being typed) is not a row, and another
 * venture's row is not this module's.
 */
export function waitingRows(read, projectId) {
  const list = Array.isArray(read?.proposals) ? read.proposals : [];
  return list.filter((p) => p && p.status === 'proposed' && p.kind === 'proposal' && p.payload && typeof p.payload.row === 'object' && p.payload.row !== null
    && !Array.isArray(p.payload.row) && Number(p.payload.project) === Number(projectId))
    .map((p) => ({ uid: String(p.uid), row: p.payload.row, created_at: p.created_at ?? null }));
}

/** A row proposal's lines: its title (the form's first text field) and the rest, as `Label: value`. */
export function rowLines(row, page, form) {
  const fields = fieldsOf(page, form);
  const text = fields.filter((f) => f.class === 'composition' && f.field !== 'effort');
  const titleField = text[0];
  const title = titleField && row?.[titleField.field] != null ? String(row[titleField.field]) : 'Untitled';
  const rest = fields.filter((f) => f !== titleField && row?.[f.field] != null && f.class === 'composition')
    .map((f) => `${f.label}: ${String(row[f.field])}`);
  return { title, rest };
}

/** Why a row was not added, in words. Never the Worker's code alone. */
export const ROW_WHY = Object.freeze({
  not_found: 'It is no longer waiting.',
  decided: 'It was already decided.',
  duplicate: 'One with this name is already on file.',
  invalid: 'It is missing something its form needs.',
  unmatched: 'It points to a record that is not this venture’s.',
  never_fill: 'It names a field Eadwyn never fills.',
  not_offered: 'It names a field Eadwyn is not offered.',
  not_this_form: 'It belongs to another form.',
  other_venture: 'It belongs to another venture.',
  no_writer: 'This form cannot add rows yet.',
  not_written: 'It could not be written. Try again.',
});
export const rowWhy = (why) => ROW_WHY[why] || 'It could not be added.';

/** Accept all's report: "Added 3 of 4." with each refusal's reason, and the rows over the cap. */
export function acceptReport(reply, asked) {
  const outcomes = Array.isArray(reply?.outcomes) ? reply.outcomes : [];
  const created = outcomes.filter((o) => o?.outcome === 'created').length;
  const refused = outcomes.filter((o) => o?.outcome === 'refused').map((o) => ({ uid: o.uid, text: rowWhy(o.why) }));
  const over = Array.isArray(reply?.over_limit) ? reply.over_limit.length : 0;
  const total = Number.isSafeInteger(asked) ? asked : outcomes.length + over;
  return {
    line: `Added ${created} of ${total}.${over ? ` ${over} more wait: Accept all takes 50 at a time.` : ''}`,
    created, refused, over,
  };
}
