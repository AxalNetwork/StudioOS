/**
 * D8815 (#8815, part 3a of #2403) — the two X reads a founder's Grow sync makes, and the only file that names their
 * paths. The shared client (`services/xClient.ts`, `xApiGet`) sends them: one host, the per-connection breaker, 429
 * and 401 as codes, a 15-second deadline, and never X's body to the founder.
 *
 *   ME_PATH          the account's follower, following and post counts (`public_metrics`)
 *   OWN_POSTS_PATH   the founder's own posts, newest first, each with its `public_metrics`; reposts excluded
 *
 * EVERY CALL IS BUDGETED. Each read reserves what X may bill for it from the founder's monthly budget
 * (`budget.ts`) before it is sent, and refunds what it did not use. Nothing left refuses `x_monthly_cap_reached`
 * without calling X, the token refresh included.
 *
 * FIELD BY FIELD. A count that is not a non-negative integer is `null`, never 0. A post id that is not X's digits is
 * dropped. No post text, handle or other user's id is read into a value that leaves this file.
 *
 * UNVERIFIED (#2403): the field names (`followers_count`, `following_count`, `tweet_count`, `impression_count`,
 * `like_count`, `retweet_count`, `reply_count`, `quote_count`, `bookmark_count`), `exclude=retweets` and the billing
 * per resource returned. The owner's first live sync is the check.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { xFounderAccessToken } from '../../integrations/providers/x';
import { XError, xApiGet } from '../xClient';
import type { XBudget } from './budget';

export const ME_PATH = '/users/me?user.fields=public_metrics';
export const OWN_POSTS_PATH = '/users/:id/tweets';
/** X's page size bounds for a user's posts. */
export const PAGE_MAX = 100;
export const PAGE_MIN = 5;

export interface XAudience { followers: number | null; following: number | null; post_count: number | null }
export interface XPostFacts {
  id: string; posted_on: string | null;
  impressions: number | null; likes: number | null; reposts: number | null; replies: number | null; quotes: number | null; bookmarks: number | null;
}
/** `returned` is how many posts X sent, the ones dropped included: what it bills for. */
export interface XPostPage { posts: XPostFacts[]; next: string | null; returned: number }
export interface XReads { account(): Promise<XAudience>; posts(next: string | null): Promise<XPostPage> }

export class XCapReached extends XError {
  constructor() { super('x_monthly_cap_reached', 'This founder has used this month’s X reads.'); }
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const POST_ID = /^\d{1,25}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

export function parseAudience(body: unknown): XAudience {
  const m = (body as { data?: { public_metrics?: Record<string, unknown> } } | null)?.data?.public_metrics ?? {};
  return { followers: count(m.followers_count), following: count(m.following_count), post_count: count(m.tweet_count) };
}

export function parsePosts(body: unknown): XPostPage {
  const b = (body ?? {}) as { data?: unknown; meta?: { next_token?: unknown } };
  const rows = Array.isArray(b.data) ? b.data : [];
  const posts: XPostFacts[] = [];
  for (const raw of rows) {
    const p = (raw ?? {}) as { id?: unknown; created_at?: unknown; public_metrics?: Record<string, unknown> };
    if (typeof p.id !== 'string' || !POST_ID.test(p.id)) continue;
    const at = typeof p.created_at === 'string' ? Date.parse(p.created_at) : NaN;
    const m = p.public_metrics ?? {};
    posts.push({
      id: p.id, posted_on: Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null,
      impressions: count(m.impression_count), likes: count(m.like_count), reposts: count(m.retweet_count),
      replies: count(m.reply_count), quotes: count(m.quote_count), bookmarks: count(m.bookmark_count),
    });
  }
  const next = typeof b.meta?.next_token === 'string' && TOKEN.test(b.meta.next_token) ? b.meta.next_token : null;
  return { posts, next, returned: rows.length };
}

function xUserId(row: Pick<IntegrationRow, 'config_json'>): string {
  let id: unknown = null;
  try { id = JSON.parse(row.config_json || '{}')?.x_user_id; } catch { /* unreadable reads as missing */ }
  if (typeof id !== 'string' || !POST_ID.test(id)) throw new XError('x_connection_unreadable', 'The X connection could not be read.');
  return id;
}

/** The founder's reads through their own connection, each reserved from `budget` before it is sent. */
export function xReadsFor(env: Env, row: Pick<IntegrationRow, 'id' | 'uid' | 'config_json'>, budget: XBudget): XReads {
  const breaker = `x-founder:${row.uid}`;
  const billed = async <T>(want: number, min: number, call: (granted: number, token: string) => Promise<T>, used: (out: T) => number): Promise<T> => {
    const granted = await budget.reserve(want, min);
    if (!granted) throw new XCapReached();
    let out: T;
    try {
      out = await call(granted, await xFounderAccessToken(env, row));
    } catch (e) {
      await budget.refund(granted);
      throw e;
    }
    await budget.refund(granted - Math.min(granted, used(out)));
    return out;
  };
  return {
    account: () => billed(1, 1, async (_n, token) => parseAudience(await xApiGet(ME_PATH, token, breaker)), () => 1),
    posts: (next) => {
      const id = xUserId(row);
      return billed(PAGE_MAX, PAGE_MIN, async (n, token) => {
        const q = new URLSearchParams({ max_results: String(n), 'tweet.fields': 'created_at,public_metrics', exclude: 'retweets' });
        if (next) q.set('pagination_token', next);
        return parsePosts(await xApiGet(`${OWN_POSTS_PATH.replace(':id', encodeURIComponent(id))}?${q}`, token, breaker));
      }, (page) => page.returned);
    },
  };
}
