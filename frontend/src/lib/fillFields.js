/**
 * D1325 (#3486, #2431 part 2) — FILL_FIELDS: which form fields "Fill with
 * Eadwyn" may fill, how, and from where. The SPA's copy of the Worker's
 * `cloudflare-worker/src/services/fills/fields.ts`, which explains each key;
 * `cloudflare-worker/test/fill_sheet_d1325.test.ts` fails when the two
 * disagree. A field with no entry has no trigger.
 *
 * `class` is `restatement`, `sourced`, `composition` or `measured` (a figure a
 * connector or module measured; Eadwyn never fills it). `sources` lists
 * `eadwyn`, `connector:<key>` and `module:<cycle>/<slug>`.
 */
import { neverFillReason } from './neverFill.js';

export const FILL_FIELD_CLASSES = Object.freeze(['restatement', 'sourced', 'composition', 'measured']);

const SOLUTION_DESIGN = 'Founder · Build · Solution design';
const REVENUE = 'Founder · Grow · Revenue and traction';

export const FILL_FIELDS = Object.freeze([
  // AF1, AF3: Add feature. Impact is the founder's call, so it has no entry.
  { page: SOLUTION_DESIGN, form: 'feature', field: 'title', label: 'Feature', table: 'mvp_features', column: 'title', class: 'composition', sources: ['connector:github', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'pain_group_id', label: 'Answers pain theme', table: 'mvp_features', column: 'pain_group_id', class: 'restatement', sources: ['module:validate/problem-discovery', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'hypothesis_id', label: 'Tests hypothesis', table: 'mvp_features', column: 'hypothesis_id', class: 'restatement', sources: ['module:validate/experiments', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'effort', label: 'Effort', table: 'mvp_features', column: 'effort', class: 'composition', sources: ['eadwyn'] },
  // A measured figure: a connector's, never Eadwyn's.
  { page: REVENUE, form: 'kpi', field: 'value', label: 'MRR', table: 'project_metrics', column: 'mrr', class: 'measured', sources: ['connector:stripe', 'connector:mercury'] },
].map((f) => Object.freeze({ ...f, sources: Object.freeze([...f.sources]) })));

/** The fields of one form, in the form's order. */
export const fieldsOf = (page, form) => FILL_FIELDS.filter((f) => f.page === page && f.form === form);

/** Whether Eadwyn is ever asked to fill this field. The Worker answers the same. */
export function offeredToEadwyn(f) {
  return Boolean(f) && f.sources.includes('eadwyn') && f.class !== 'measured' && !neverFillReason(`${f.table}.${f.column}`);
}
