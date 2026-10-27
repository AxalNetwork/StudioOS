/**
 * D1091 (#2956): what a member's chosen Google files feed, one entry per use.
 * Picking a file feeds nothing by itself; a part adds its entry when its writer,
 * store and routes ship. The registry's `pulls` and `feeds` read this list.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */
export interface GoogleWorkspaceFeed {
  key: string;
  what: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  /** The `GOOGLE_WORKSPACE_READS` operations the feed calls. */
  reads: readonly string[];
  decision: string;
}

export const GOOGLE_WORKSPACE_FEEDS: readonly GoogleWorkspaceFeed[] = Object.freeze([
  // D1093 (#2958): a spec Doc's title and headings, proposed as a design note; nothing lands until the founder accepts.
  Object.freeze({ key: 'spec_doc', what: 'Spec Docs, proposed as design notes', module: 'solution_design', reads: Object.freeze(['documents.get']), decision: 'D1093' }),
  // D1093 (#2958): a roadmap Sheet, once mapped, as roadmap items under the one-owner rule.
  Object.freeze({ key: 'roadmap_sheet', what: 'A mapped roadmap Sheet, as roadmap items', module: 'product_roadmap', reads: Object.freeze(['spreadsheets.values.get']), decision: 'D1093' }),
]);
