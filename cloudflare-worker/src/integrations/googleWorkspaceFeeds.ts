/**
 * D1091: parts 3–6 register feeds when their stores and routes ship. Picking a file feeds nothing.
 * Each entry is one Module map row of #2402: what lands, in which module, as a fact or a proposal.
 */
export interface GoogleWorkspaceFeed {
  key: string; what: string; module: string; kind: 'fact' | 'proposal'; endpoint: string;
}
export const GOOGLE_WORKSPACE_FEEDS: readonly GoogleWorkspaceFeed[] = Object.freeze([
  // D1095 (#2960): Grow.
  Object.freeze({ key: 'grow_metrics_sheet', what: 'Metrics from a Sheet you map', module: 'revenue_and_traction', kind: 'fact', endpoint: 'spreadsheets.values.get' } as const),
  Object.freeze({ key: 'grow_calendar_obligations', what: 'Board meetings and filing deadlines you tag in Calendar', module: 'durable_company_building', kind: 'proposal', endpoint: 'calendar events.list' } as const),
]);

/**
 * The ledger module a chosen file's rows count under, where it differs from the
 * module D1091 registers the file under. Stop using unlinks both.
 */
export const GOOGLE_WORKSPACE_LEDGER_MODULE: Readonly<Record<string, string>> = Object.freeze({
  revenue_traction: 'revenue_and_traction',
});
