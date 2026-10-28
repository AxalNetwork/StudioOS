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

// D1329 (#3490): the other profiles' pages.
const COMMIT = 'Investor · Deals · Commit';
const SERVICES = 'Advisor · Expertise · Services';
const REPORTING = 'Operating Partner · Delivery · Reporting';
const EVENTS = 'Admin · Approvals · Events';
const PUBLICATIONS = 'Super Admin · Content · Publications';
const SOLUTION_DESIGN = 'Founder · Build · Solution design';
const REVENUE = 'Founder · Grow · Revenue and traction';
const PROBLEM = 'Founder · Validate · Problem discovery';
const ICP = 'Founder · Validate · Ideal customer profile';
const EXPERIMENTS = 'Founder · Validate · Experiments and evidence';
const PROTOTYPE = 'Founder · Build · Prototype / MVP';

export const FILL_FIELDS = Object.freeze([
  // AF1, AF3: Add feature. Impact is the founder's call, so it has no entry.
  { page: SOLUTION_DESIGN, form: 'feature', field: 'title', label: 'Feature', table: 'mvp_features', column: 'title', class: 'composition', sources: ['connector:github', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'pain_group_id', label: 'Answers pain theme', table: 'mvp_features', column: 'pain_group_id', class: 'restatement', sources: ['module:validate/problem-discovery', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'hypothesis_id', label: 'Tests hypothesis', table: 'mvp_features', column: 'hypothesis_id', class: 'restatement', sources: ['module:validate/experiments', 'eadwyn'] },
  { page: SOLUTION_DESIGN, form: 'feature', field: 'effort', label: 'Effort', table: 'mvp_features', column: 'effort', class: 'composition', sources: ['eadwyn'] },
  // D1328 (#3489, #2431 part 5), part one: Validate's and Build's text fields.
  // A severity, an urgency, a score window, a direction, a state and an owner
  // are the founder's call, and a link list is not a column, so none is listed.
  // New theme: the pain in the customer's words.
  { page: PROBLEM, form: 'theme', field: 'title', label: 'Theme', table: 'pain_groups', column: 'title', class: 'composition', sources: ['eadwyn'] },
  // New segment.
  { page: ICP, form: 'segment', field: 'name', label: 'Segment', table: 'customer_segments', column: 'name', class: 'composition', sources: ['eadwyn'] },
  { page: ICP, form: 'segment', field: 'who_they_are', label: 'Who they are', table: 'customer_segments', column: 'who_they_are', class: 'composition', sources: ['eadwyn'] },
  { page: ICP, form: 'segment', field: 'job_to_be_done', label: 'Job to be done', table: 'customer_segments', column: 'job_to_be_done', class: 'composition', sources: ['eadwyn'] },
  { page: ICP, form: 'segment', field: 'value_promised', label: 'Value promised', table: 'customer_segments', column: 'value_promised', class: 'composition', sources: ['eadwyn'] },
  // New hypothesis.
  { page: EXPERIMENTS, form: 'hypothesis', field: 'claim', label: 'Claim', table: 'hypotheses', column: 'claim', class: 'composition', sources: ['eadwyn'] },
  { page: EXPERIMENTS, form: 'hypothesis', field: 'success_bar', label: 'Success bar', table: 'hypotheses', column: 'success_bar', class: 'composition', sources: ['eadwyn'] },
  { page: EXPERIMENTS, form: 'hypothesis', field: 'disproof', label: 'What would disprove it', table: 'hypotheses', column: 'disproof', class: 'composition', sources: ['eadwyn'] },
  // Add must-have: a must-have is an mvp_features row (is_must_have), so its own form keeps its own writer.
  { page: PROTOTYPE, form: 'must-have', field: 'title', label: 'Must-have', table: 'mvp_features', column: 'title', class: 'composition', sources: ['eadwyn'] },
  { page: PROTOTYPE, form: 'must-have', field: 'hypothesis_id', label: 'Tests hypothesis', table: 'mvp_features', column: 'hypothesis_id', class: 'restatement', sources: ['module:validate/experiments', 'eadwyn'] },
  // A measured figure: a connector's, never Eadwyn's.
  { page: REVENUE, form: 'kpi', field: 'value', label: 'MRR', table: 'project_metrics', column: 'mrr', class: 'measured', sources: ['connector:stripe', 'connector:mercury'] },
  // D1329 (#3490, #2431 part 6): every other profile. These records are not a
  // venture's; `scopes.ts` holds each one's own write check. No amount, legal
  // name, approval, decision, outcome, term or member's record is listed.
  // AF17, on Commit's IC memo (the owner's answer B): the memo's words only.
  { page: COMMIT, form: 'ic-memo', field: 'memo', label: 'Memo', table: 'ic_decisions', column: 'memo', class: 'composition', sources: ['eadwyn'] },
  // AF18: New service. Its price is a money term and the legal name an identity field.
  { page: SERVICES, form: 'service', field: 'title', label: 'Title', table: 'advisor_services', column: 'title', class: 'composition', sources: ['eadwyn'] },
  { page: SERVICES, form: 'service', field: 'scope', label: 'What it covers', table: 'advisor_services', column: 'scope', class: 'composition', sources: ['module:advisor/outcomes', 'eadwyn'] },
  // AF19: a status report's Done and Next, from the engagement record at no AI tokens.
  { page: REPORTING, form: 'status-report', field: 'shipped', label: 'Done this week', table: 'engagement_status_reports', column: 'shipped', class: 'restatement', sources: ['module:delivery/engagement'] },
  { page: REPORTING, form: 'status-report', field: 'next_up', label: 'Next week', table: 'engagement_status_reports', column: 'next_up', class: 'restatement', sources: ['module:delivery/engagement'] },
  // AF20: an event's content, never its approval, times, capacity or price.
  { page: EVENTS, form: 'event', field: 'description', label: 'Description', table: 'events', column: 'description', class: 'composition', sources: ['eadwyn'] },
  { page: EVENTS, form: 'agenda-item', field: 'title', label: 'Session', table: 'event_agenda_items', column: 'title', class: 'composition', sources: ['eadwyn'] },
  { page: EVENTS, form: 'agenda-item', field: 'description', label: 'What happens', table: 'event_agenda_items', column: 'description', class: 'composition', sources: ['eadwyn'] },
  // AF21: a publication's summary (H20's draft, in the shared sheet).
  { page: PUBLICATIONS, form: 'publication', field: 'summary_text', label: 'Summary', table: 'admin_publications', column: 'summary_text', class: 'composition', sources: ['eadwyn'] },
].map((f) => Object.freeze({ ...f, sources: Object.freeze([...f.sources]) })));

/** The fields of one form, in the form's order. */
export const fieldsOf = (page, form) => FILL_FIELDS.filter((f) => f.page === page && f.form === form);

/** Whether Eadwyn is ever asked to fill this field. The Worker answers the same. */
export function offeredToEadwyn(f) {
  return Boolean(f) && f.sources.includes('eadwyn') && f.class !== 'measured' && !neverFillReason(`${f.table}.${f.column}`);
}
