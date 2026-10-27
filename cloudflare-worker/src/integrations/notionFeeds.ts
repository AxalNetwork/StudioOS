/**
 * D1085 (#2950, #2405 part 1) — what a founder's own Notion feeds, as the
 * code builds it.
 *
 * ONE LIST, EMPTY UNTIL A PART BUILDS A FEED. Each entry will be one use of a
 * member's Notion: the module it lands in, the `NOTION_READ_TOOLS` it calls
 * and the decision that built it, as `mercuryFeeds.ts` holds Mercury's. Part 1
 * builds the connection and the directory entry only, so nothing lands yet:
 * the registry's `pulls` and `feeds` read this list, and both are empty.
 * Notion parts 3–6 each add theirs here.
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
  // D1087 (#2952): Validate. Interview pages wait for Accept with consent; research pages land as sources.
  { key: 'notion_interviews', what: 'Interview notes, as interviews you accept with the interviewee’s consent', module: 'customer_research', tools: ['notion-fetch'], decision: 'D1087' },
  { key: 'notion_research', what: 'Research pages, as market sources (title and link)', module: 'market_intelligence', tools: ['notion-fetch'], decision: 'D1087' },
  // D1089 (#2954): Raise. CRM rows wait for Add or Link, then their stage follows; pages wait as snapshots (NDA by default).
  { key: 'notion_investor_crm', what: 'An investor CRM database, as investors you add or link, then their stage', module: 'capital_relationships', tools: ['notion-query-data-sources'], decision: 'D1089' },
  { key: 'notion_data_room', what: 'Pages, as dated snapshots you add to the data room (NDA by default)', module: 'data_room', tools: ['notion-fetch'], decision: 'D1089' },
]);
