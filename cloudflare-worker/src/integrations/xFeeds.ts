/**
 * D2403 part 2 (#2403) — what a founder's own X feeds, as the code builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED, as `tiktokFeeds.ts` holds TikTok's: the module
 * each lands in, fact or proposal, the X API v2 paths it calls, and whether it
 * is built. The registry's `pulls` and `feeds` and the connector page's tools
 * read the built entries only (`x_connector_2403.test.ts` holds the three to
 * each other). Part 2 builds the sign-in, which lands nothing. Part 3a
 * (D8815, #8815, `services/x/growFeeds.ts`) builds the two facts; the channel
 * proposal waits for its own part, as TikTok's (#5864) and Facebook's (#5860) did.
 * `calls` are relative to `https://api.x.com/2`, as `services/x/reads.ts` names them.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface XFeed {
  key: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  what: string;
  kind: 'fact' | 'proposal';
  /** The X API v2 paths the feed calls (`services/x/reads.ts`, sent by `services/xClient.ts`). */
  calls: readonly string[];
  /** False while the feed waits on a later part; the registry claims built feeds only. */
  built: boolean;
  decision: string;
}

export const X_FEED_LIST: readonly XFeed[] = Object.freeze(([
  {
    key: 'audience', module: 'revenue_and_traction', kind: 'fact', built: true, decision: 'D8815',
    what: 'Your followers at each month’s end and your posts’ monthly impressions and engagement, shown beside revenue and never as revenue',
    calls: Object.freeze(['/users/me', '/users/:id/tweets']),
  },
  {
    key: 'posts', module: 'distribution', kind: 'fact', built: true, decision: 'D8815',
    what: 'Your follower count, and per month your own posts, their impressions and engagement, with each recent post’s figures',
    calls: Object.freeze(['/users/me', '/users/:id/tweets']),
  },
  {
    key: 'channel', module: 'distribution', kind: 'proposal', built: false, decision: 'D2403',
    what: 'Add X as a Distribution channel, only when you accept',
    calls: Object.freeze([]),
  },
] as XFeed[]).map((f) => Object.freeze(f)));

/** The feeds the code lands today. */
export const X_BUILT_FEEDS: readonly XFeed[] = Object.freeze(X_FEED_LIST.filter((f) => f.built));

/** The modules the built feeds land in, for the registry's `feeds`. */
export const X_FEEDS: readonly string[] = Object.freeze([...new Set(X_BUILT_FEEDS.map((f) => f.module))]);
