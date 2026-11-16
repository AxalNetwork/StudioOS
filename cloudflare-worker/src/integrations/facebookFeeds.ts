/**
 * D5859 (#5859, part 2a of #2399) — what a connected Facebook Page feeds, as the code builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED, as `beehiivFeeds.ts` holds Beehiiv's: the module each lands in, whether it lands as a
 * fact or waits as a proposal, the read it makes in `services/facebook/insights.ts`, and whether it is built. The
 * registry's `pulls` and `feeds` read the built entries only, and the connector page's tools land where these say
 * (`facebook_grow_5859.test.ts` holds the three to each other).
 *
 * Part 1 (#5292) built the sign-in and the Page list, which land nothing. Part 2a (`services/facebook/grow.ts`) built
 * the first two. The "Link your Facebook Page to a Distribution channel?" proposal is #5860.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface FacebookFeed {
  key: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  what: string;
  kind: 'fact' | 'proposal';
  /** Fragments of the read in `services/facebook/insights.ts`. */
  calls: readonly string[];
  /** False while the feed waits on a later part; the registry claims built feeds only. */
  built: boolean;
  decision: string;
}

export const FACEBOOK_FEED_LIST: readonly FacebookFeed[] = Object.freeze(([
  {
    key: 'followers', module: 'revenue_and_traction', kind: 'fact', built: true, decision: 'D5859',
    what: 'Your Page’s followers, as a dated snapshot each sync, shown beside revenue and never as revenue',
    calls: Object.freeze(['?fields=${FOLLOWER_FIELD}']),
  },
  {
    key: 'insights', module: 'distribution', kind: 'fact', built: true, decision: 'D5859',
    what: 'Your Page’s daily views, unique viewers and engagements, up to 12 months back',
    calls: Object.freeze(['/insights?']),
  },
  {
    key: 'channel', module: 'distribution', kind: 'proposal', built: false, decision: 'D2399',
    what: 'Link your Facebook Page to a Distribution channel, only when you accept',
    calls: Object.freeze([]),
  },
] as FacebookFeed[]).map((f) => Object.freeze(f)));

/** The feeds the code lands today. */
export const FACEBOOK_BUILT_FEEDS: readonly FacebookFeed[] = Object.freeze(FACEBOOK_FEED_LIST.filter((f) => f.built));

/** The modules the built feeds land in, for the registry's `feeds`. */
export const FACEBOOK_FEEDS: readonly string[] = Object.freeze([...new Set(FACEBOOK_BUILT_FEEDS.map((f) => f.module))]);
