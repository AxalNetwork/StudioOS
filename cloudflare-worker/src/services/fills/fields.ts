/**
 * D1325 (#3486, #2431 part 2) — FILL_FIELDS: which form fields "Fill with
 * Eadwyn" may fill, how, and from where. The Worker's copy of
 * `frontend/src/lib/fillFields.js`; `test/fill_sheet_d1325.test.ts` fails when
 * the two disagree, as `never_fill.test.ts` does for the never-fill registry.
 *
 * ONE ENTRY PER FIELD. `{ page, form, field, label, table, column, class, sources }`:
 *   page     the rail page the form is on (D768's words, "Founder · Build · …");
 *   form     the form's own key (`forms.js`: `feature`, `kpi`); its rail option
 *            is `form:<form>`;
 *   field    the form's field name, and `label` the words on it;
 *   table, column   where the value is written, the address `fill_provenance`
 *            files it under;
 *   class    one of `types.ts`'s three, or `measured`: a figure a connector or
 *            module measured, which Eadwyn never fills;
 *   sources  where a value may come from: `eadwyn`, `connector:<key>`,
 *            `module:<cycle>/<slug>`.
 *
 * A FIELD WITH NO ENTRY HAS NO TRIGGER. A decision, a score, a judgement the
 * founder makes (Add feature's Impact), a signature or an amount is not listed,
 * and a never-fill field (`neverFill.ts`) may not be. This part starts with the
 * forms the canvas draws (AF1 and AF3: Build › Solution design's Add feature)
 * and one measured field (Grow › Revenue and traction's MRR); part 5 (#3489)
 * adds the founder's other forms in parts of at most 30 fields.
 */
import type { FillClass } from './types';
import { neverFillReason } from './neverFill';

export type FillFieldClass = FillClass | 'measured';
export interface FillField {
  page: string;
  form: string;
  field: string;
  label: string;
  table: string;
  column: string;
  class: FillFieldClass;
  sources: readonly string[];
}

export const FILL_FIELD_CLASSES: readonly FillFieldClass[] = Object.freeze(['restatement', 'sourced', 'composition', 'measured']);

// D1329 (#3490): the other profiles' pages.
const COMMIT = 'Investor · Deals · Commit';
const SERVICES = 'Advisor · Expertise · Services';
const REPORTING = 'Operating Partner · Delivery · Reporting';
const EVENTS = 'Admin · Approvals · Events';
const PUBLICATIONS = 'Super Admin · Content · Publications';
const SOLUTION_DESIGN = 'Founder · Build · Solution design';
const REVENUE = 'Founder · Grow · Revenue and traction';

export const FILL_FIELDS: readonly FillField[] = Object.freeze([
  // AF1, AF3: Add feature. Impact is the founder's call, so it has no entry.
  { page: SOLUTION_DESIGN, form: 'feature', field: 'title', label: 'Feature', table: 'mvp_features', column: 'title', class: 'composition', sources: ['connector:github', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'pain_group_id', label: 'Answers pain theme', table: 'mvp_features', column: 'pain_group_id', class: 'restatement', sources: ['module:validate/problem-discovery', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'hypothesis_id', label: 'Tests hypothesis', table: 'mvp_features', column: 'hypothesis_id', class: 'restatement', sources: ['module:validate/experiments', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'effort', label: 'Effort', table: 'mvp_features', column: 'effort', class: 'composition', sources: ['eadwyn'] },
  // A measured figure: a connector's, never Eadwyn's.
  { page: REVENUE, form: 'kpi', field: 'value', label: 'MRR', table: 'project_metrics', column: 'mrr', class: 'measured', sources: ['connector:stripe', 'connector:mercury'] },
  // D1329 (#3490, #2431 part 6): every other profile. These records are not a
  // venture's; `scopes.ts` holds each one's own write check. No amount, legal
  // name, approval, decision, outcome, term or member's record is listed.
  // AF17, on Commit's IC memo (the owner's answer B): the memo's words only.
  { page: COMMIT, form: 'ic-memo', field: 'memo', label: 'Memo', table: 'ic_decisions', column: 'memo', class: 'composition', sources: ['eadwyn'] },
  // AF18: New service. Its price is a money term and the legal name an identity field.
  { page: SERVICES, form: 'service', field: 'title', label: 'Title', table: 'advisor_services', column: 'title', class: 'composition', sources: ['eadwyn'] },
  { page: SERVICES, form: 'service', field: 'scope', label: 'What you deliver', table: 'advisor_services', column: 'scope', class: 'composition', sources: ['module:advisor/outcomes', 'eadwyn'] },
  // AF19: a status report's Done and Next, from the engagement record at no AI tokens.
  { page: REPORTING, form: 'status-report', field: 'shipped', label: 'Done this week', table: 'engagement_status_reports', column: 'shipped', class: 'restatement', sources: ['module:delivery/engagement'] },
  { page: REPORTING, form: 'status-report', field: 'next_up', label: 'Next week', table: 'engagement_status_reports', column: 'next_up', class: 'restatement', sources: ['module:delivery/engagement'] },
  // AF20: an event's content, never its approval, times, capacity or price.
  { page: EVENTS, form: 'event', field: 'description', label: 'Description', table: 'events', column: 'description', class: 'composition', sources: ['eadwyn'] },
  { page: EVENTS, form: 'agenda-item', field: 'title', label: 'Session', table: 'event_agenda_items', column: 'title', class: 'composition', sources: ['eadwyn'] },
  { page: EVENTS, form: 'agenda-item', field: 'description', label: 'What happens', table: 'event_agenda_items', column: 'description', class: 'composition', sources: ['eadwyn'] },
  // AF21: a publication's summary (H20's draft, in the shared sheet).
  { page: PUBLICATIONS, form: 'publication', field: 'summary_text', label: 'Summary', table: 'admin_publications', column: 'summary_text', class: 'composition', sources: ['eadwyn'] },
].map((f) => Object.freeze({ ...f, sources: Object.freeze([...f.sources]) })) as FillField[]);

/** The fields of one form, in the form's order. */
export const fieldsOf = (page: string, form: string): FillField[] => FILL_FIELDS.filter((f) => f.page === page && f.form === form);

/** A source key's kind: `eadwyn`, `connector` or `module`; null for anything else. */
export function sourceKind(source: string): 'eadwyn' | 'connector' | 'module' | null {
  if (source === 'eadwyn') return 'eadwyn';
  if (/^connector:[a-z0-9_]+$/.test(source)) return 'connector';
  if (/^module:[a-z]+\/[a-z0-9-]+$/.test(source)) return 'module';
  return null;
}

/**
 * Whether Eadwyn is ever asked to fill this field: it lists Eadwyn, is not
 * measured, and the never-fill registry does not name it. The registry's own
 * check holds every entry to this, so it is a second lock, not the only one.
 */
export function offeredToEadwyn(f: FillField): boolean {
  return f.sources.includes('eadwyn') && f.class !== 'measured' && !neverFillReason(`${f.table}.${f.column}`);
}

/**
 * The registry's rules, as a list of what breaks them; empty when it holds.
 * A measured field never lists Eadwyn; no field is one the never-fill registry
 * names; every class and source is a known one; a form's fields write one table.
 */
export function fillFieldProblems(fields: readonly FillField[] = FILL_FIELDS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tableOf = new Map<string, string>();
  for (const f of fields) {
    const id = `${f.page} / ${f.form} / ${f.field}`;
    if (seen.has(id)) out.push(`${id}: listed twice`);
    seen.add(id);
    if (!FILL_FIELD_CLASSES.includes(f.class)) out.push(`${id}: unknown class ${f.class}`);
    if (!f.sources.length) out.push(`${id}: no source`);
    for (const s of f.sources) if (!sourceKind(s)) out.push(`${id}: unknown source ${s}`);
    if (f.class === 'measured' && f.sources.includes('eadwyn')) out.push(`${id}: a measured field lists Eadwyn`);
    const nf = neverFillReason(`${f.table}.${f.column}`);
    if (nf) out.push(`${id}: ${f.table}.${f.column} is never filled (${nf.label})`);
    const key = `${f.page} / ${f.form}`;
    const t = tableOf.get(key);
    if (t && t !== f.table) out.push(`${key}: writes ${t} and ${f.table}`);
    tableOf.set(key, f.table);
  }
  return out;
}
