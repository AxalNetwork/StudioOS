/**
 * D1091 (#2956) — what a founder's chosen Google files feed, as the code
 * builds it. Picking a file feeds nothing: each entry is one feed a part
 * built, with the module it lands in, the file kind it reads, whether it
 * lands a fact or waits for the founder, and the `GOOGLE_WORKSPACE_READS`
 * calls it makes. The registry's `pulls` and `feeds` read this list, and
 * `google_workspace_feeds.test.ts` holds them to it.
 *
 * D1092 (#2957, part 3): Validate's three. D1093 (#2958, part 4): Build's two.
 * D1095 (#2960, part 6): Grow's two. Raise (part 5) adds its own.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface GoogleWorkspaceFeed {
  key: string;
  what: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  file_kind: 'doc' | 'sheet' | 'slides' | 'form' | 'file' | 'calendar';
  lands: 'fact' | 'proposal';
  /** The `GOOGLE_WORKSPACE_READS` names the feed calls; none when it reads what another feed landed, or when the read is not a Workspace file read. */
  reads: readonly string[];
  decision: string;
}

export const GOOGLE_WORKSPACE_FEEDS: readonly GoogleWorkspaceFeed[] = Object.freeze([
  { key: 'validate_interview_notes', what: 'Interview notes from a Doc you map to an interview', module: 'customer_research', file_kind: 'doc', lands: 'fact', reads: ['files.get', 'documents.get'], decision: 'D1092' },
  { key: 'validate_demand_signals', what: 'Form responses that give an answer you chose, as signals to confirm', module: 'demand_signals', file_kind: 'form', lands: 'proposal', reads: ['forms.get', 'forms.responses.list'], decision: 'D1092' },
  { key: 'validate_signal_evidence', what: 'Signals you confirmed, offered as evidence on a hypothesis you pick', module: 'experiments', file_kind: 'form', lands: 'proposal', reads: [], decision: 'D1092' },
  // D1093 (#2958): a spec Doc's title and headings, proposed as a design note; nothing lands until the founder accepts.
  { key: 'spec_doc', what: 'Spec Docs, proposed as design notes', module: 'solution_design', file_kind: 'doc', lands: 'proposal', reads: ['documents.get'], decision: 'D1093' },
  // D1093 (#2958): a roadmap Sheet, once mapped, as roadmap items. Each objective is a fact under the one-owner rule.
  { key: 'roadmap_sheet', what: 'A mapped roadmap Sheet, as roadmap items', module: 'product_roadmap', file_kind: 'sheet', lands: 'fact', reads: ['spreadsheets.values.get'], decision: 'D1093' },
  // D1095 (#2960): a metrics Sheet's mapped columns, as facts.
  { key: 'grow_metrics_sheet', what: 'Metrics from a Sheet you map', module: 'revenue_and_traction', file_kind: 'sheet', lands: 'fact', reads: ['spreadsheets.values.get'], decision: 'D1095' },
  // D1095 (#2960): #board and #filing events, proposed as obligations. The read is the Calendar API, not a Workspace file read.
  { key: 'grow_calendar_obligations', what: 'Board meetings and filing deadlines you tag in Calendar', module: 'durable_company_building', file_kind: 'calendar', lands: 'proposal', reads: [], decision: 'D1095' },
].map((f) => Object.freeze({ ...f, reads: Object.freeze(f.reads) })) as GoogleWorkspaceFeed[]);

/**
 * The ledger module a chosen file's rows count under, where it differs from the
 * module D1091 registers the file under. Stop using unlinks both.
 */
export const GOOGLE_WORKSPACE_LEDGER_MODULE: Readonly<Record<string, string>> = Object.freeze({
  revenue_traction: 'revenue_and_traction',
});
