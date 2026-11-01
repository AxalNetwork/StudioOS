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
  // #3740 part 1: the KPI form. Its one field is `measured`: connectors only, never Eadwyn.
  'grow/revenue-and-traction': 'Founder · Grow · Revenue and traction',
  // #3740 part 2a.
  'build/product-roadmap': 'Founder · Build · Product roadmap',
  'raise/capital-relationships': 'Founder · Raise · Capital relationships',
  'grow/team-expansion': 'Founder · Grow · Team expansion',
  // #4046 (Group A1).
  'validate/market-intelligence': 'Founder · Validate · Market intelligence',
  'grow/product-improvement': 'Founder · Grow · Product improvement',
  'grow/durable-company-building': 'Founder · Grow · Durable company building',
});

/**
 * #3740 part 1: each Edit form, by its key, and the FILL form it fills. An
 * Edit reads its row (`record`), so a blank field of a saved row draws Ask.
 */
export const EDIT_FILL_FORMS = Object.freeze({
  'edit-theme': 'theme',
  'edit-segment': 'segment',
  'edit-hypothesis': 'hypothesis',
  'edit-feature': 'feature',
  'edit-must-have': 'must-have',
  // A KPI keeps its history: its Edit posts a new value, so it names no row.
  'edit-kpi': 'kpi',
  // #3740 part 2a: each Edit reads its row by id.
  'edit-item': 'item',
  'edit-investor': 'investor',
  'edit-role': 'role',
  // #4046 (Group A1). Feedback's Edit picks a theme from chips, so only Log feedback offers one.
  'edit-competitor': 'competitor',
  'edit-obligation': 'obligation',
});

/**
 * #4046: the tables whose rows a form names by a text key (`ROW_KEYS` in the
 * Worker's routes/fills.ts): a competitor by its candidate id, feedback by its uid.
 */
export const KEYED_FILL_TABLES = Object.freeze(['competitor_tracking', 'product_feedback']);
const TEXT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

/**
 * A row id an Edit sends as `record`: a positive integer, or null (a KPI's key
 * is not a row). #4046: for a table `KEYED_FILL_TABLES` lists, its text key.
 */
export function fillRecordId(id, table = null) {
  const n = typeof id === 'number' ? id : /^[1-9]\d*$/.test(String(id ?? '')) ? Number(id) : NaN;
  if (Number.isSafeInteger(n) && n > 0) return n;
  return KEYED_FILL_TABLES.includes(table) && typeof id === 'string' && TEXT_KEY.test(id) ? id : null;
}

/** The table a sheet's form writes, from FILL_FIELDS; null for a form it does not list. */
export function fillTable(page, form) {
  return fieldsOf(page, form)[0]?.table || null;
}

/** The sheet a cycle form opens, `{ page, form }`, or null when FILL_FIELDS lists none of its fields. */
export function fillTarget(cycle, slug, formKey) {
  const page = FILL_PAGES[`${cycle}/${slug}`];
  if (!page || typeof formKey !== 'string' || !formKey) return null;
  const form = EDIT_FILL_FORMS[formKey] || formKey;
  return fieldsOf(page, form).length ? { page, form } : null;
}

/** A module's first Add form that has a sheet, for its "Fill with Eadwyn" (AF1), or null. */
export function moduleFillTarget(cycle, slug, forms) {
  for (const f of Array.isArray(forms) ? forms : []) {
    const t = fillTarget(cycle, slug, f?.key);
    if (t) return { ...t, label: f.cta || f.button || f.title || 'Add' };
  }
  return null;
}

/**
 * The row a form's Save created or wrote, from the route's `{ id }`; null for
 * anything else. #4046: a keyed table's Save answers its key, a competitor's
 * `candidate_id` or feedback's `uid`.
 */
export function savedId(result, table = null) {
  const id = Number(result?.id);
  if (Number.isSafeInteger(id) && id > 0) return id;
  if (!KEYED_FILL_TABLES.includes(table)) return null;
  return fillRecordId(String(result?.candidate_id ?? result?.uid ?? ''), table);
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
