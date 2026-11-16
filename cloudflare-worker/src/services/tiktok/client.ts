/**
 * D5863 (#5863, part 2a of #2401) — the two reads of a founder's own TikTok: the account's counts and its public
 * videos. THE ONLY FILE THAT CALLS TikTok's Display API (`tiktok_grow_5863.test.ts` holds the tree to that); the
 * sign-in, refresh and revoke stay in `integrations/tiktokOAuth.ts`.
 *
 *   GET  /v2/user/info/?fields=…    follower_count, following_count, likes_count, video_count  (scope user.info.stats)
 *   POST /v2/video/list/?fields=…   { max_count, cursor } → videos, cursor, has_more            (scope video.list)
 *
 * THE RULES OF EVERY CALL. One host (`API`), never a redirect, a 10-second deadline, the member's token in the
 * header only. An answer is read field by field into a typed row: counts, a post date, the first 150 characters of
 * a title. A cover, an embed URL, an open_id or any other field is never copied. A count TikTok did not give is
 * `null`, never 0. A failure is a code (`TikTokReadError`), never TikTok's body; nothing here logs.
 *
 * UNVERIFIED (D5863 §5): the method of the video list, its body and field names, and the user-info field names
 * are #2401's reading of TikTok's pages on 2026-10-21. This session could not reach developers.tiktok.com (the
 * proxy refused it on 2026-11-15). Every name is in the constants below, and nowhere else.
 */
import type { Env } from '../../types';
import type { IntegrationRow } from '../../integrations/registry';
import { tiktokAccessToken } from '../../integrations/providers/tiktok';

export const API = 'https://open.tiktokapis.com';
export const USER_FIELDS = Object.freeze(['follower_count', 'following_count', 'likes_count', 'video_count'] as const);
export const VIDEO_FIELDS = Object.freeze(['id', 'create_time', 'title', 'duration', 'view_count', 'like_count', 'comment_count', 'share_count'] as const);
/** TikTok's largest page of the video list (UNVERIFIED). */
export const VIDEO_PAGE = 20;
export const TITLE_MAX = 150;
const DEADLINE_MS = 10_000;

export type TikTokReadErrorCode = 'unauthorized' | 'scope_missing' | 'rate_limited' | 'unreadable';

/** A read that failed: a code and a status, never a body. */
export class TikTokReadError extends Error {
  readonly code: TikTokReadErrorCode;
  readonly status: number | null;
  constructor(code: TikTokReadErrorCode, status: number | null = null) {
    super(`tiktok_${code}`);
    this.name = 'TikTokReadError';
    this.code = code;
    this.status = status;
  }
}

export interface TikTokAccount { followers: number | null; following: number | null; likes_total: number | null; video_count: number | null }
export interface TikTokVideo {
  id: string; posted_on: string | null; title: string | null; duration_s: number | null;
  views: number | null; likes: number | null; comments: number | null; shares: number | null;
}
export interface TikTokVideoPage { videos: TikTokVideo[]; cursor: string | null; has_more: boolean }

/** The reads one sync makes, so a test or the sync can count them. */
export interface TikTokReads {
  account(): Promise<TikTokAccount>;
  videos(cursor: string | null): Promise<TikTokVideoPage>;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
/** A count: a safe non-negative integer, else null. */
export const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const VIDEO_ID = /^[0-9A-Za-z_-]{1,40}$/;
const CURSOR = /^[0-9A-Za-z_-]{1,64}$/;

function day(seconds: unknown): string | null {
  const n = count(seconds);
  if (n === null) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function title(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, TITLE_MAX).join('') : null;
}

/** TikTok's own error envelope: `error.code` is 'ok' on success. */
function failed(res: Response, data: Record<string, unknown> | null): TikTokReadError | null {
  const code = String(obj(data?.error)?.code ?? '');
  if (res.status === 429 || code === 'rate_limit_exceeded') return new TikTokReadError('rate_limited', res.status);
  if (res.status === 401 || code === 'access_token_invalid') return new TikTokReadError('unauthorized', res.status);
  if (code === 'scope_not_authorized') return new TikTokReadError('scope_missing', res.status);
  if (!res.ok || (code && code !== 'ok')) return new TikTokReadError('unreadable', res.status);
  return null;
}

async function call(token: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(DEADLINE_MS),
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch {
    throw new TikTokReadError('unreadable');
  }
  const data = obj(await res.json().catch(() => null));
  const err = failed(res, data);
  if (err) throw err;
  const out = obj(data?.data);
  if (!out) throw new TikTokReadError('unreadable', res.status);
  return out;
}

export function parseAccount(data: Record<string, unknown>): TikTokAccount {
  const u = obj(data.user) ?? {};
  return { followers: count(u.follower_count), following: count(u.following_count), likes_total: count(u.likes_count), video_count: count(u.video_count) };
}

export function parseVideos(data: Record<string, unknown>): TikTokVideoPage {
  const videos = (Array.isArray(data.videos) ? data.videos : []).flatMap((raw): TikTokVideo[] => {
    const v = obj(raw);
    const id = typeof v?.id === 'string' && VIDEO_ID.test(v.id) ? v.id : null;
    if (!v || !id) return [];
    return [{
      id, posted_on: day(v.create_time), title: title(v.title), duration_s: count(v.duration),
      views: count(v.view_count), likes: count(v.like_count), comments: count(v.comment_count), shares: count(v.share_count),
    }];
  });
  const c = data.cursor;
  const cursor = (typeof c === 'number' && Number.isSafeInteger(c)) ? String(c) : typeof c === 'string' && CURSOR.test(c) ? c : null;
  return { videos, cursor, has_more: data.has_more === true && cursor !== null };
}

/** The reads for one access token. */
export function tiktokReads(token: string): TikTokReads {
  return {
    async account() {
      const data = await call(token, `/v2/user/info/?fields=${USER_FIELDS.join(',')}`, { method: 'GET' });
      return parseAccount(data);
    },
    async videos(cursor) {
      const page = { max_count: VIDEO_PAGE, ...(cursor ? { cursor: Number(cursor) } : {}) };
      const data = await call(token, `/v2/video/list/?fields=${VIDEO_FIELDS.join(',')}`, {
        body: JSON.stringify(page),
        method: 'POST',
      });
      return parseVideos(data);
    },
  };
}

/** The scopes the member granted, from the connection row. */
export function grantedScopes(row: Pick<IntegrationRow, 'scopes_json'>): string[] {
  try {
    const v = JSON.parse(row.scopes_json ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/** The reads for a connection row, through the provider's refresh lease. */
export async function tiktokReadsFor(env: Env, row: IntegrationRow): Promise<TikTokReads> {
  let token: string;
  try { token = await tiktokAccessToken(env, row); } catch { throw new TikTokReadError('unauthorized'); }
  return tiktokReads(token);
}
