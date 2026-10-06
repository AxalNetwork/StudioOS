/**
 * D561 (#1162) — Learning videos stored in R2: the upload rules, the byte
 * ranges playback answers, and the sweep that removes objects no item uses.
 *
 * THE BUCKET IS PRIVATE. Nothing here makes a public or presigned URL. A
 * video reaches a member only through `GET /api/learning/items/:uid/video`,
 * which asks `canSeeLearning` first and streams the bytes itself. The same
 * shape `services/r2.ts` uses for KYC documents.
 *
 * KEYS. Every object is `learning/videos/<item uid>/<random>.<ext>`. The item
 * uid in the key is what ties an upload to its item: each upload step checks
 * that the key it is given sits under the item named in the path, so a step
 * cannot complete, abort or attach an object belonging to another item. That
 * is why the upload needs no table of its own.
 */
import type { Env } from '../types';

export const VIDEO_PREFIX = 'learning/videos/';
/** 2 GB, the issue's limit, in bytes. */
export const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/**
 * The largest part one request may carry. A Worker request body is capped at
 * 100 MB on the plans this runs on, so parts stay under it; R2 itself takes
 * parts up to 5 GiB. Every part but the last must be the same size, and at
 * least 5 MiB, which is R2's rule.
 */
export const VIDEO_PART_MAX_BYTES = 95 * 1024 * 1024;
export const VIDEO_PART_MIN_BYTES = 5 * 1024 * 1024;
/** The part size the client is told to use: 2 GB in at most 22 parts. */
export const VIDEO_PART_BYTES = 95 * 1024 * 1024;
export const VIDEO_MAX_PARTS = Math.ceil(VIDEO_MAX_BYTES / VIDEO_PART_MIN_BYTES);

export const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** The prefix every object of one item sits under. */
export const itemPrefix = (itemUid: string) => `${VIDEO_PREFIX}${itemUid}/`;

/** A fresh key for an item's upload. */
export function newVideoKey(itemUid: string, contentType: string): string {
  const ext = VIDEO_TYPES[contentType];
  return `${itemPrefix(itemUid)}${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
}

/**
 * Whether `key` is one this item's upload could have made: under the item's
 * prefix, one path segment, an allowed extension, nothing that climbs out.
 */
export function keyBelongsTo(itemUid: string, key: unknown): key is string {
  if (typeof key !== 'string' || key.length > 300) return false;
  const prefix = itemPrefix(itemUid);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^[a-f0-9]{32}\.(mp4|webm)$/.test(rest);
}

export type ByteRange = { start: number; end: number };

/**
 * One `Range: bytes=…` header against an object of `size` bytes.
 *
 *   - `null`: no usable Range header, so the whole object is sent (200).
 *   - `'unsatisfiable'`: a well-formed range that falls outside the object
 *     (416, with `Content-Range: bytes * /size`).
 *   - a range, clamped to the object: sent as 206.
 *
 * Only one range is served. A multi-range request is answered with the whole
 * object, which RFC 9110 allows and every video player accepts; building
 * multipart/byteranges responses would buy nothing a player uses.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    // A suffix: the last N bytes.
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n === 0) return 'unsatisfiable';
    if (size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return null;
  if (start >= size) return 'unsatisfiable';
  let end = b === '' ? size - 1 : Number(b);
  if (!Number.isSafeInteger(end)) return null;
  if (end < start) return null;
  if (end > size - 1) end = size - 1;
  return { start, end };
}

/** How long an object nobody points at is kept, so an upload that has just completed is never swept. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** How long an archived item keeps its video: archive is reversible, so the object stays a while. */
export const ARCHIVED_GRACE_DAYS = 30;

/**
 * THE SWEEP. Archiving does not delete the object: an archived item can be
 * published again, and its video should still be there. Instead, once a day,
 * this removes every object under `learning/videos/` that no item needs:
 *
 *   - its item no longer exists;
 *   - its item does not point at it (a newer upload replaced it, or the item
 *     now plays a link), and it is older than a day;
 *   - its item has been archived for more than 30 days.
 *
 * Incomplete multipart uploads are not listed by `list()`; R2's own lifecycle
 * aborts them after seven days.
 *
 * Returns the counts, so the cron line says what it did.
 */
export async function sweepLearningVideos(env: Env, now: Date = new Date()): Promise<{ checked: number; deleted: number }> {
  if (!env.FILES) return { checked: 0, deleted: 0 };
  let cursor: string | undefined;
  let checked = 0;
  let deleted = 0;
  const archivedBefore = new Date(now.getTime() - ARCHIVED_GRACE_DAYS * 86400_000).toISOString();
  do {
    const page = await env.FILES.list({ prefix: VIDEO_PREFIX, cursor, limit: 500 });
    for (const obj of page.objects) {
      checked++;
      const itemUid = obj.key.slice(VIDEO_PREFIX.length).split('/')[0];
      const item = await env.DB.prepare(
        'SELECT video_source, r2_key, status, updated_at FROM learning_items WHERE uid = ?',
      ).bind(itemUid).first<{ video_source: string | null; r2_key: string | null; status: string; updated_at: string | null }>();
      const inUse = !!item && item.video_source === 'r2' && item.r2_key === obj.key;
      const old = now.getTime() - new Date(obj.uploaded).getTime() > ORPHAN_GRACE_MS;
      const longArchived = !!item && inUse && item.status === 'archived'
        && !!item.updated_at && String(item.updated_at) < archivedBefore;
      if (!item || (!inUse && old) || longArchived) {
        await env.FILES.delete(obj.key);
        deleted++;
        // An archived item whose video is gone must not point at it: the
        // item forgets the object, so publishing it again is refused until a
        // new video is attached rather than publishing a dead player.
        if (longArchived) {
          await env.DB.prepare(
            `UPDATE learning_items SET video_source = NULL, r2_key = NULL WHERE uid = ? AND r2_key = ? AND status = 'archived'`,
          ).bind(itemUid, obj.key).run();
        }
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { checked, deleted };
}
