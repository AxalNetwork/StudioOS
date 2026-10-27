/**
 * D1091 (#2956): what a member's chosen Google files feed, one entry per use,
 * as `mercuryFeeds.ts` holds Mercury's. Picking a file feeds nothing by itself;
 * each part adds its entries when its writer and routes ship, and the
 * registry's `pulls` and `feeds` read this list.
 *
 * D1094 (#2959, part 5): Raise's three. A fact is written; a proposal waits
 * for Accept.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface GoogleWorkspaceFeed {
  key: string;
  what: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  kind: 'fact' | 'proposal';
  /** The reads it makes: `GOOGLE_WORKSPACE_READS` names, or the Calendar read in `services/google/raise.ts`. */
  endpoint: readonly string[];
  decision: string;
}

export const GOOGLE_WORKSPACE_FEEDS: readonly GoogleWorkspaceFeed[] = Object.freeze([
  Object.freeze({ key: 'slides_deck_version', what: 'A Slides deck, as a new deck version', module: 'pitch_deck', kind: 'proposal' as const, endpoint: Object.freeze(['files.get', 'presentations.get']), decision: 'D1094' }),
  Object.freeze({ key: 'drive_data_room_copy', what: 'Drive files, copied into the data room', module: 'data_room', kind: 'fact' as const, endpoint: Object.freeze(['files.get', 'files.export', 'alt=media']), decision: 'D1094' }),
  Object.freeze({ key: 'calendar_last_met', what: 'When you last met an investor’s firm, from your calendar', module: 'capital_relationships', kind: 'proposal' as const, endpoint: Object.freeze(['events.list']), decision: 'D1094' }),
]);
