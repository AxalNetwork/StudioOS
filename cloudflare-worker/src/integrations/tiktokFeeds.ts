/**
 * D5863 (#5863, part 2a of #2401) — what a founder's own TikTok feeds, as the code builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED, as `beehiivFeeds.ts` holds Beehiiv's: the module each lands in, whether it lands as a
 * fact or waits as a proposal, the Display API path it calls, and whether it is built. The registry's `pulls` and
 * `feeds` read the built entries only, and the connector page's tools land where these say
 * (`tiktok_grow_5863.test.ts` holds the three to each other).
 *
 * Part 1 (#5291) built the sign-in, which lands nothing. Part 2a (`services/tiktok/grow.ts`) built the first two.
 * Part 2b (#5864) built the "Add TikTok as a channel" proposal, which is computed from local data and calls nothing.
 * The Updates line waits for its own part.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface TikTokFeed {
  key: string;
  /** A `moduleLabels.ts` key. */
  module: string;
  what: string;
  kind: 'fact' | 'proposal';
  /** The Display API paths the feed calls (`services/tiktok/client.ts`). */
  calls: readonly string[];
  /** False while the feed waits on a later part; the registry claims built feeds only. */
  built: boolean;
  decision: string;
}

export const TIKTOK_FEED_LIST: readonly TikTokFeed[] = Object.freeze(([
  {
    key: 'audience', module: 'revenue_and_traction', kind: 'fact', built: true, decision: 'D5863',
    what: 'Your followers, total likes and video count, as a dated snapshot each sync, shown beside revenue and never as revenue',
    calls: Object.freeze(['/v2/user/info/']),
  },
  {
    key: 'videos', module: 'distribution', kind: 'fact', built: true, decision: 'D5863',
    what: 'Each public video’s views, likes, comments and shares, with its post date',
    calls: Object.freeze(['/v2/video/list/']),
  },
  {
    key: 'channel', module: 'distribution', kind: 'proposal', built: true, decision: 'D5864',
    what: 'Add TikTok as a Distribution channel, only when you accept',
    calls: Object.freeze([]),
  },
] as TikTokFeed[]).map((f) => Object.freeze(f)));

/** The feeds the code lands today. */
export const TIKTOK_BUILT_FEEDS: readonly TikTokFeed[] = Object.freeze(TIKTOK_FEED_LIST.filter((f) => f.built));

/** The modules the built feeds land in, for the registry's `feeds`. */
export const TIKTOK_FEEDS: readonly string[] = Object.freeze([...new Set(TIKTOK_BUILT_FEEDS.map((f) => f.module))]);
