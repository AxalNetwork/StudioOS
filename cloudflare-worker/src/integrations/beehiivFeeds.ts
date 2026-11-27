/**
 * D2407 (#2407 parts 1–2) — what a founder's own Beehiiv feeds, as the code
 * builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED, as `posthogFeeds.ts` holds PostHog's: the
 * module each lands in, whether it lands as a fact or waits as a proposal,
 * the `BEEHIIV_READ_TOOLS` it calls, and whether it is built. The registry's
 * `pulls` and `feeds` read the built entries only; the connector page's
 * tools land where these say (`beehiiv_grow_2407.test.ts` holds the three to
 * each other).
 *
 * Part 1 built the connection and the publication links, which land
 * nothing. Part 2 (`services/beehiiv/grow.ts`) built the first four. The
 * Updates row's newsletter figures wait for part 3, which links a sent update
 * to the Beehiiv post its draft became.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface BeehiivFeed {
  key: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  what: string;
  kind: 'fact' | 'proposal';
  /** The `BEEHIIV_READ_TOOLS` names the feed calls. */
  tools: readonly string[];
  /** False while the feed waits on a later part; the registry claims built feeds only. */
  built: boolean;
  decision: string;
}

export const BEEHIIV_FEEDS: readonly BeehiivFeed[] = Object.freeze(([
  {
    key: 'audience', module: 'distribution', kind: 'fact', built: true, decision: 'D2407',
    what: 'Free subscribers and your average open and click rates, as a dated snapshot each sync',
    tools: Object.freeze(['get_publication_stats']),
  },
  {
    key: 'traction', module: 'revenue_and_traction', kind: 'fact', built: true, decision: 'D2407',
    what: 'Active and premium subscribers by snapshot date, shown beside revenue and never as revenue',
    tools: Object.freeze(['get_publication_stats']),
  },
  {
    key: 'posts', module: 'distribution', kind: 'fact', built: true, decision: 'D2407',
    what: 'Your last 20 sent posts, each with its recipients, opens and clicks',
    tools: Object.freeze(['list_posts', 'get_post_stats']),
  },
  {
    key: 'channel', module: 'distribution', kind: 'proposal', built: true, decision: 'D2407',
    what: 'Track your publication as a Distribution channel, only when you accept',
    tools: Object.freeze(['list_publications']),
  },
  {
    key: 'update_newsletter', module: 'grow_updates', kind: 'fact', built: false, decision: 'D2407',
    what: 'A sent update’s newsletter recipients, opens and clicks, once part 3 links the update to its post',
    tools: Object.freeze(['get_post_stats']),
  },
] as BeehiivFeed[]).map((f) => Object.freeze(f)));

/** The feeds the code lands today. */
export const BEEHIIV_BUILT_FEEDS: readonly BeehiivFeed[] = Object.freeze(BEEHIIV_FEEDS.filter((f) => f.built));
