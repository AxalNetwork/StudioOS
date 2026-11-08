/**
 * D2407 (#2407) — a fake Beehiiv MCP server for Beehiiv's tests, modelled on
 * `_mercury_mcp_fake.mjs` and `_posthog_mcp_fake.mjs`, over the shared fake
 * (`_mcp_fake.mjs`): `mcp.beehiiv.com` serves the MCP server (`initialize`,
 * `tools/list`, `tools/call`) and `auth.beehiiv.com` its OAuth server.
 * Nothing here reaches the network; every other host answers 599.
 *
 * `tools/list` offers the four read tools AND tools Axal VC must never call:
 * a subscriber list, a publish tool, and the draft tool part 3 plans
 * (`create_post_draft`), so a test can prove each is refused before any
 * request. The forbidden names live only here, in the test folder.
 *
 * The answers mix Beehiiv's two rate shapes on purpose (48.2 and 0.061, 51 and
 * 0.46, a 0.5 whose counts say 0.5%), and carry a subscriber's address, so a
 * test can prove every rate lands as a fraction and no address leaves
 * `reads.ts`. Publications, posts and figures are invented.
 *
 * THE TOOL NAMES ARE UNVERIFIED (#2407's candidates, D2407.md §5): when the
 * first live `tools/list` fixes them, this file, the record and `reads.ts`'s
 * call sites change together.
 */
import { notesFake } from './_mcp_fake.mjs';

export const BEEHIIV_HOST = 'mcp.beehiiv.com';
export const BEEHIIV_AUTH_HOST = 'auth.beehiiv.com';
export const BEEHIIV_MCP_URL = `https://${BEEHIIV_HOST}/mcp`;
export const BEEHIIV_ISSUER = `https://${BEEHIIV_AUTH_HOST}`;

export const READ_TOOLS = ['list_publications', 'get_publication_stats', 'list_posts', 'get_post_stats'];
export const DRAFT_TOOL = 'create_post_draft';
/** Tools a server offers that Axal VC never calls: named in the test folder only. */
export const FAKE_BEEHIIV_FORBIDDEN_TOOLS = [DRAFT_TOOL, 'list_subscriptions', 'get_subscription', 'publish_post', 'update_post'];

export const PUB_A = 'pub_fixture-northwind';
export const PUB_B = 'pub_fixture-changelog';
export const PUB_A_NAME = 'The Northwind Letter';
export const POST_A = 'post_fixture-october';
export const POST_B = 'post_fixture-hiring';
export const POST_C = 'post_fixture-tiny';
export const PERSON = 'reader-fixture@example.test';

const readOnly = { readOnlyHint: true };

export function defaultBeehiivTools() {
  return [
    ...READ_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' }, annotations: readOnly })),
    { name: DRAFT_TOOL, inputSchema: { type: 'object', properties: { title: { type: 'string' } } }, annotations: { readOnlyHint: false } },
    { name: 'list_subscriptions', inputSchema: { type: 'object' }, annotations: readOnly },
    { name: 'get_subscription', inputSchema: { type: 'object' }, annotations: readOnly },
    { name: 'publish_post', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: 'update_post', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
  ];
}

/** The data each read answers from; a test may change it between syncs. */
export function defaultBeehiivData() {
  return {
    publications: [
      { id: PUB_A, name: PUB_A_NAME },
      { id: PUB_B, name: 'Northwind Changelog' },
      { id: 'not a beehiiv id!', name: 'Dropped: its id is not Beehiiv\'s' },
    ],
    stats: {
      [PUB_A]: { data: { stats: {
        active_subscriptions: 1284, active_free_subscriptions: 1188, active_premium_subscriptions: 96,
        average_open_rate: 48.2, average_click_rate: 0.061,
        recent_subscribers: [{ email: PERSON }],
      } } },
    },
    posts: {
      [PUB_A]: { data: [
        { id: POST_A, title: '[October product notes]', publish_date: 1760918400, stats: { email: { recipients: 1240, unique_opens: 632, open_rate: 51, unique_clicks: 87, click_rate: 0.07 } } },
        { id: POST_B, title: '[We\'re hiring two engineers]', publish_date: '2026-10-12T09:00:00Z' },
        { id: POST_C, title: '[A tiny test send]', publish_date: '2026-10-05T09:00:00Z', stats: { recipients: 200, unique_opens: 1, open_rate: 0.5, unique_clicks: 0, click_rate: null }, subscriber: { email: PERSON } },
      ] },
    },
    postStats: {
      [POST_B]: { stats: { email: { recipients: 1198, unique_opens: 551, open_rate: 0.46, unique_clicks: 108, click_rate: 9 } } },
    },
  };
}

/** The Beehiiv fake: the shared fake on Beehiiv's hosts, with Beehiiv's tools, no scope, and invented answers. */
export function beehiivFake(opts = {}) {
  const args = [];
  const data = defaultBeehiivData();
  const fake = notesFake({
    era: opts.era ?? 'modern',
    hosts: { mcp: BEEHIIV_HOST, auth: BEEHIIV_AUTH_HOST },
    resource: BEEHIIV_MCP_URL,
    tools: defaultBeehiivTools(),
    scope: opts.scope === undefined ? null : opts.scope,
    answer: (tool, a) => {
      args.push({ tool, args: a });
      switch (tool) {
        case 'list_publications': return { data: data.publications };
        case 'get_publication_stats': return data.stats[a?.publication_id] ?? { data: { stats: {} } };
        case 'list_posts': return data.posts[a?.publication_id] ?? { data: [] };
        case 'get_post_stats': return data.postStats[a?.post_id] ?? { stats: {} };
        default: return { tool, arguments: a };
      }
    },
  });
  fake.state.meta.cimd = opts.cimd ?? false;
  return {
    ...fake,
    /** What the reads answer from. */
    data,
    /** Every `tools/call`'s arguments, in order. */
    args,
    forbiddenCalls: () => fake.toolCalls().filter((t) => FAKE_BEEHIIV_FORBIDDEN_TOOLS.includes(t)),
  };
}
