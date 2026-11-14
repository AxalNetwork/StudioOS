/**
 * D2407 (#2407 part 1) — typed reads of a founder's own Beehiiv, through
 * Beehiiv's hosted MCP server. THE ONLY FILE THAT OPENS A BEEHIIV SESSION
 * (`beehiiv_connection_2407.test.ts` holds the tree to that); every Beehiiv
 * part reads through it.
 *
 * READ ONLY, THREE TIMES OVER.
 *  1. THE RECORD. `MCP_PROVIDERS.beehiiv.read_tools` lists four reads; its one
 *     write tool (the draft tool part 3 plans) is refused by the session.
 *  2. THE SESSION. `callTool` refuses a name off `read_tools`, or one the
 *     server does not offer, before any request.
 *  3. THIS FILE. Each read calls one listed name with arguments it builds
 *     itself, from ids checked against `ID_RE`. No subscriber tool exists here.
 *
 * AGGREGATES ONLY LEAVE THIS FILE. Each answer is read field by field into a
 * typed row: counts, rates, a post's title and date, a publication's name.
 * Nothing else in an answer (a subscriber, an email address, a segment) is
 * copied, followed, fetched or logged. A missing figure is `null`, never 0.
 *
 * RATES ARE FRACTIONS. Beehiiv's samples show a rate both as 45 and as 0.45
 * (UNVERIFIED which the MCP returns); `normaliseRate` turns either into 0.45,
 * using the post's own counts to settle a value at or below 1.
 *
 * UNVERIFIED until the owner's first live sign-in (D2407.md §5): the tool
 * names (#2407's candidates), each tool's argument names and the shape of
 * each answer. The parsers accept the REST v2 names and the obvious
 * alternatives, structured or as JSON text.
 */
import { MCP_PROVIDERS } from '../../integrations/mcpProviders';
import {
  McpClientError, mcpAccessFor, mcpCredentialsOf, openMcpSession, type McpAccess, type McpFetch, type McpSession,
} from '../../integrations/mcpClient';
import { mcpPreregisteredFor } from '../../integrations/mcpSignIn';
import type { IntegrationRow } from '../../integrations/registry';
import type { Env } from '../../types';
import { BEEHIIV_READ_TOOLS } from './mcp';

const BEEHIIV = MCP_PROVIDERS.beehiiv;

export { BEEHIIV_READ_TOOLS };

/** The fetch a test stubs Beehiiv with. */
export type BeehiivFetch = McpFetch;

/** The most sent posts one sync reads. */
export const POST_LIMIT = 20;
/** The most publications a picker lists. */
export const MAX_PUBLICATIONS = 50;

export type BeehiivReadErrorCode = 'not_connected' | 'bad_id' | 'unauthorized' | 'rate_limited' | 'not_allowed' | 'unreadable';

/** A read that failed: a code and a status, never a body or an answer. */
export class BeehiivReadError extends Error {
  readonly code: BeehiivReadErrorCode;
  readonly status: number | null;
  constructor(code: BeehiivReadErrorCode, status: number | null = null) {
    super(`beehiiv_${code}`);
    this.name = 'BeehiivReadError';
    this.code = code;
    this.status = status;
  }
}

/** A Beehiiv id (`pub_…`, `post_…`): letters, digits, `_` and `-`. */
export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** An id as it is sent; anything else throws `bad_id` and nothing is requested. */
export function beehiivId(raw: unknown): string {
  if (typeof raw !== 'string' || !ID_RE.test(raw)) throw new BeehiivReadError('bad_id');
  return raw;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const idOf = (v: unknown): string | null => (typeof v === 'string' && ID_RE.test(v) ? v : null);
/** The first of `keys` that holds a value. */
const pick = (o: Record<string, unknown> | null, ...keys: string[]): unknown => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/** A count: a non-negative whole number, or a string of digits; anything else is null, never 0. */
export function countOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** A date as `YYYY-MM-DD…` ISO text: an ISO string, or epoch seconds or milliseconds. */
export function stampOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v)).toISOString();
  return null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A rate as a fraction from 0 to 1, or null. Beehiiv shows a rate as a
 * percentage (45, "45%") or a fraction (0.45) (UNVERIFIED which). A value
 * above 1 is a percentage. A value at or below 1 is a fraction, unless the
 * row's own counts (`part` of `whole`) say it is a percentage: 0.5 with 1 open
 * of 200 is 0.5%. With no rate, the counts give it. Anything below 0, above
 * 100, or not a number is null.
 */
export function normaliseRate(raw: unknown, part?: number | null, whole?: number | null): number | null {
  const fromCounts = part != null && whole != null && whole > 0 && part >= 0 && part <= whole ? part / whole : null;
  let v: number | null = null;
  let percent = false;
  if (typeof raw === 'number' && Number.isFinite(raw)) v = raw;
  else if (typeof raw === 'string') {
    const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*(%?)\s*$/.exec(raw);
    if (m) { v = Number(m[1]); percent = m[2] === '%'; }
  }
  if (v == null) return fromCounts == null ? null : round6(fromCounts);
  if (v < 0 || v > 100) return null;
  if (percent || v > 1) return round6(v / 100);
  if (fromCounts != null && Math.abs(v / 100 - fromCounts) < Math.abs(v - fromCounts)) return round6(v / 100);
  return round6(v);
}

export interface BeehiivPublication { id: string; name: string | null }

export interface BeehiivAudience {
  subscribers_active: number | null;
  subscribers_free: number | null;
  subscribers_premium: number | null;
  /** Fractions, 0 to 1. */
  open_rate_avg: number | null;
  click_rate_avg: number | null;
}

export interface BeehiivPostStats {
  recipients: number | null;
  unique_opens: number | null;
  /** Fractions, 0 to 1. */
  open_rate: number | null;
  unique_clicks: number | null;
  click_rate: number | null;
}

export interface BeehiivPost extends BeehiivPostStats {
  id: string;
  title: string | null;
  sent_at: string | null;
  /** Whether the list answer carried the post's figures; when not, `postStats` reads them. */
  has_stats: boolean;
}

/** A post's figures from an answer: its own fields, or under `stats`, `stats.email` or `email`. */
export function postStatsOf(v: unknown): BeehiivPostStats & { found: boolean } {
  const o = obj(v);
  const s = obj(pick(obj(o?.stats), 'email')) ?? obj(o?.stats) ?? obj(o?.email) ?? o;
  const recipients = countOf(pick(s, 'recipients', 'recipient_count', 'delivered'));
  const opens = countOf(pick(s, 'unique_opens', 'unique_opened', 'opens'));
  const clicks = countOf(pick(s, 'unique_clicks', 'unique_clicked', 'clicks'));
  const open = normaliseRate(pick(s, 'open_rate', 'unique_open_rate'), opens, recipients);
  const click = normaliseRate(pick(s, 'click_rate', 'unique_click_rate', 'click_through_rate'), clicks, recipients);
  return {
    recipients, unique_opens: opens, open_rate: open, unique_clicks: clicks, click_rate: click,
    found: [recipients, opens, clicks, open, click].some((x) => x != null),
  };
}

/** A publication's audience figures from an answer: its own fields, or under `stats` or `data`. */
export function audienceOf(v: unknown): BeehiivAudience {
  const o = obj(v);
  const s = obj(o?.stats) ?? obj(obj(o?.data)?.stats) ?? obj(o?.data) ?? o;
  return {
    subscribers_active: countOf(pick(s, 'active_subscriptions', 'active_subscribers', 'subscribers')),
    subscribers_free: countOf(pick(s, 'active_free_subscriptions', 'free_subscriptions', 'free_subscribers')),
    subscribers_premium: countOf(pick(s, 'active_premium_subscriptions', 'premium_subscriptions', 'premium_subscribers')),
    open_rate_avg: normaliseRate(pick(s, 'average_open_rate', 'avg_open_rate', 'open_rate')),
    click_rate_avg: normaliseRate(pick(s, 'average_click_rate', 'avg_click_rate', 'click_rate')),
  };
}

const listOf = (body: unknown, max: number): unknown[] => {
  if (Array.isArray(body)) return body.slice(0, max);
  const root = obj(body);
  for (const k of ['data', 'publications', 'posts', 'results']) if (Array.isArray(root?.[k])) return (root![k] as unknown[]).slice(0, max);
  return [];
};

export interface BeehiivReads {
  /** The listed read tools this server offers. */
  readonly offered: readonly string[];
  /** POSTs this session made so far, the handshake included. */
  readonly requests: number;
  /** POSTs this session may still make. */
  readonly remaining: number;
  /** The publications the member's Beehiiv role can see, for the venture's picker. */
  publications(): Promise<BeehiivPublication[]>;
  /** One publication's audience figures. Never a subscriber. */
  audience(publicationId: string): Promise<BeehiivAudience>;
  /** Its most recent sent posts, newest first, at most `POST_LIMIT`. */
  posts(publicationId: string): Promise<BeehiivPost[]>;
  /** One post's figures. */
  postStats(publicationId: string, postId: string): Promise<BeehiivPostStats>;
}

/** The session's failures in this file's words; a body is never carried. */
function asReadError(e: unknown): unknown {
  if (e instanceof BeehiivReadError) return e;
  if (!(e instanceof McpClientError)) return e;
  if (e.code === 'unauthorized' || e.code === 'scope_insufficient') return new BeehiivReadError('unauthorized', e.status);
  if (e.code === 'rate_limited') return new BeehiivReadError('rate_limited', e.status);
  if (e.code === 'path_not_allowed') return new BeehiivReadError('not_allowed', e.status);
  return new BeehiivReadError('unreadable', e.status);
}

/** Open one session as the member; a 401 at open tries `refresh` once. */
export async function openBeehiivReads(access: McpAccess): Promise<BeehiivReads> {
  const open = (token: string) => openMcpSession(BEEHIIV, { accessToken: token, fetcher: access.fetcher, resource: access.resource });
  let session: McpSession;
  try {
    session = await open(access.accessToken);
  } catch (e) {
    if (!(e instanceof McpClientError && e.code === 'unauthorized')) throw asReadError(e);
    const fresh = await access.refresh();
    if (!fresh) throw new BeehiivReadError('unauthorized', e.status);
    try { session = await open(fresh); } catch (again) { throw asReadError(again); }
  }
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    try { return await session.callTool(name, args); } catch (e) { throw asReadError(e); }
  };

  return {
    offered: session.offered,
    get requests() { return session.requests; },
    get remaining() { return Math.max(0, BEEHIIV.budget - session.requests); },

    async publications() {
      const body = await call('list_publications', {});
      return listOf(body, MAX_PUBLICATIONS).map((v) => {
        const o = obj(v);
        const id = idOf(o?.id);
        return id ? { id, name: str(o?.name) } : null;
      }).filter((v): v is BeehiivPublication => v !== null);
    },

    async audience(raw) {
      return audienceOf(await call('get_publication_stats', { publication_id: beehiivId(raw) }));
    },

    async posts(raw) {
      const publicationId = beehiivId(raw);
      const body = await call('list_posts', { publication_id: publicationId, status: 'confirmed', limit: POST_LIMIT, order_by: 'publish_date', direction: 'desc' });
      return listOf(body, POST_LIMIT).map((v) => {
        const o = obj(v);
        const id = idOf(o?.id);
        if (!o || !id) return null;
        const { found, ...stats } = postStatsOf(o);
        return { id, title: str(o.title, 300), sent_at: stampOf(pick(o, 'publish_date', 'sent_at', 'displayed_date')), ...stats, has_stats: found };
      }).filter((v): v is BeehiivPost => v !== null);
    },

    async postStats(rawPub, rawPost) {
      const { found: _found, ...stats } = postStatsOf(await call('get_post_stats', { publication_id: beehiivId(rawPub), post_id: beehiivId(rawPost) }));
      return stats;
    },
  };
}

/**
 * A member's connection's reads: their stored tokens (refreshed first when
 * about to expire), then one session. `not_connected` when the row is not a
 * Beehiiv sign-in or holds no tokens.
 */
export async function beehiivReadsFor(env: Env, row: IntegrationRow, opts: { fetcher?: McpFetch } = {}): Promise<BeehiivReads> {
  const creds = await mcpCredentialsOf(env, BEEHIIV, row);
  if (!creds) throw new BeehiivReadError('not_connected');
  const access = await mcpAccessFor(env, BEEHIIV, row, creds, { fetcher: opts.fetcher, preregistered: mcpPreregisteredFor(env, BEEHIIV) });
  return openBeehiivReads(access);
}
