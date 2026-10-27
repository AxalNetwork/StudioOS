/**
 * D1085 (#2950, #2405 part 1) — what a founder's own Notion feeds, as the
 * code builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED A PART BUILDS. Each entry is one use of a
 * member's Notion: the module it lands in, the `NOTION_READ_TOOLS` it calls
 * and the decision that built it, as `mercuryFeeds.ts` holds Mercury's. The
 * registry's `pulls` and `feeds` read this list. Part 1 built the connection
 * only; Notion parts 3–6 each add theirs here (D1088: Build).
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface NotionFeed {
  key: string;
  what: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  /** The `NOTION_READ_TOOLS` names the feed calls. */
  tools: readonly string[];
  decision: string;
}

export const NOTION_FEEDS: readonly NotionFeed[] = Object.freeze([
  // D1088 (#2953, part 4): Build. A roadmap and a must-have database land as facts; spec pages wait as design notes.
  { key: 'build_roadmap', what: 'Roadmap database rows as roadmap items', module: 'product_roadmap',
    tools: ['notion-fetch', 'notion-query-data-sources'], decision: 'D1088' },
  { key: 'build_must_haves', what: 'Must-have database rows as must-haves', module: 'prototype_mvp',
    tools: ['notion-fetch', 'notion-query-data-sources'], decision: 'D1088' },
  { key: 'build_specs', what: 'Spec pages, proposed as design notes', module: 'solution_design',
    tools: ['notion-fetch'], decision: 'D1088' },
]);
