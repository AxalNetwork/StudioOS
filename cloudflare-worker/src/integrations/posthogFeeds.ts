/**
 * D1385 (#3731, #2409 part 1) — what a founder's own PostHog feeds, as the
 * code builds it.
 *
 * ONE LIST, ONE ENTRY PER FEED A PART BUILDS, as `notionFeeds.ts` holds
 * Notion's: the module each lands in, whether it lands as a fact or waits as
 * a proposal, the `POSTHOG_READ_TOOLS` it calls and the decision that built
 * it. The registry's `pulls` and `feeds` read this list. Part 1 built the
 * connection and the project links only, so it is empty; PostHog parts 3–6
 * each add theirs here.
 *
 * No side effects and no imports: the registry and the pages may read it.
 */

export interface PosthogFeed {
  key: string;
  section: 'validate' | 'build' | 'raise' | 'grow';
  /** A `moduleLabels.ts` key. */
  module: string;
  what: string;
  kind: 'fact' | 'proposal';
  /** The `POSTHOG_READ_TOOLS` names the feed calls. */
  tools: readonly string[];
  decision: string;
}

export const POSTHOG_FEEDS: readonly PosthogFeed[] = Object.freeze([]);
