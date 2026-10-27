/**
 * D1091 (#2956) — what a founder's chosen Google files feed, as the code
 * builds it. Picking a file feeds nothing: each entry is one feed a part
 * built, with the module it lands in, the file kind it reads, whether it
 * lands a fact or waits for the founder, and the `GOOGLE_WORKSPACE_READS`
 * calls it makes. The registry's `pulls` and `feeds` read this list, and
 * `google_workspace_feeds.test.ts` holds them to it.
 *
 * D1092 (#2957, part 3): Validate's three. D1093 (#2958, part 4): Build's two.
 * D1094 (#2959, part 5): Raise's three. Part 6 adds its own here.
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
  /** The `GOOGLE_WORKSPACE_READS` names the feed calls (Calendar's are `GOOGLE_CALENDAR_READS` in `services/google/raise.ts`); none when it reads what another feed landed. */
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
  // D1094 (#2959): a chosen Slides deck, proposed as a new deck version; nothing lands until the founder accepts.
  { key: 'slides_deck_version', what: 'A Slides deck, as a new deck version', module: 'pitch_deck', file_kind: 'slides', lands: 'proposal', reads: ['files.get', 'presentations.get'], decision: 'D1094' },
  // D1094 (#2959): chosen Drive files, copied into the data room under NDA, shared with nobody.
  { key: 'drive_data_room_copy', what: 'Drive files, copied into the data room', module: 'data_room', file_kind: 'file', lands: 'fact', reads: ['files.get', 'files.export', 'alt=media'], decision: 'D1094' },
  // D1094 (#2959): the day you last met an investor's firm, from your calendar, proposed as a meeting.
  { key: 'calendar_last_met', what: 'When you last met an investor’s firm, from your calendar', module: 'capital_relationships', file_kind: 'calendar', lands: 'proposal', reads: ['events.list'], decision: 'D1094' },
].map((f) => Object.freeze({ ...f, reads: Object.freeze(f.reads) })) as GoogleWorkspaceFeed[]);
