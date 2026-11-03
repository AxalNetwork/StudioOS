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
import { R2_KEPT_AFTER_COPY_DAYS, SUPERSEDED_KEPT_DAYS, streamOf } from './learningStream';

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

/**
 * D561 (#1250) — THE STREAM ADDRESS, VERSIONED BY ITS UPLOAD.
 *
 * The stream route answers `Cache-Control: private, max-age=3600`, so a
 * replacement upload under the same address could be served from a member's
 * browser cache for up to an hour. The address therefore carries `?v=`, the
 * first 16 hex digits of the SHA-256 of the item's `r2_key`. Every upload
 * gets a fresh random key (`newVideoKey`), so the version changes exactly when
 * a new upload completes, and not when the title or text is edited, as
 * `updated_at` would. It is a hash, so the bucket key itself is still never
 * sent. The stream route reads only `:uid` and `Range`; the query is ignored.
 */
export async function streamVersion(r2Key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(r2Key));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The gated stream path for an item, with its upload's version. */
export async function streamUrl(itemUid: string, r2Key: string): Promise<string> {
  return `/api/learning/items/${encodeURIComponent(itemUid)}/video?v=${await streamVersion(r2Key)}`;
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
 * D4179 (#4179, part 4): a copy to Stream changes what is kept.
 *   - An object with a copy that is not verified is NEVER deleted, whatever
 *     else holds: the copy may still be fetching it, or may need a retry.
 *   - The object an item plays is deleted once its copy has been verified for
 *     `R2_KEPT_AFTER_COPY_DAYS` (owner step F, S1's pick: 30) and the item
 *     plays that copy. The item then forgets the object and plays Stream.
 *   - At Stream (when bound): a video superseded for more than
 *     `SUPERSEDED_KEPT_DAYS`, and an upload link never used past its expiry,
 *     are deleted, with their rows.
 *
 * Returns the counts, so the cron line says what it did.
 */
export async function sweepLearningVideos(env: Env, now: Date = new Date()): Promise<{ checked: number; deleted: number; copied_deleted: number; kept_unverified: number; stream_deleted: number }> {
  const stream = await sweepStreamVideos(env, now);
  if (!env.FILES) return { checked: 0, deleted: 0, copied_deleted: 0, kept_unverified: 0, stream_deleted: stream };
  let copiedDeleted = 0;
  let keptUnverified = 0;
  const copiedBefore = new Date(now.getTime() - R2_KEPT_AFTER_COPY_DAYS * 86400_000).toISOString();
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
      const copy = await copyOf(env, itemUid, obj.key);
      // A copy that is not verified holds its object, whatever else is true.
      if (copy && !copy.verified_at) { keptUnverified++; continue; }
      // Owner step F: the original goes once the copy has been verified long enough and the item plays it.
      const copiedLongAgo = !!item && inUse && !!copy?.verified_at && Date.parse(copy.verified_at) < Date.parse(copiedBefore) && copy.playing;
      if (copiedLongAgo) {
        await env.FILES.delete(obj.key);
        deleted++;
        copiedDeleted++;
        await env.DB.prepare(
          `UPDATE learning_items SET video_source = NULL, r2_key = NULL WHERE uid = ? AND r2_key = ? AND stream_uid = ?`,
        ).bind(itemUid, obj.key, copy!.stream_uid).run();
        continue;
      }
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
  return { checked, deleted, copied_deleted: copiedDeleted, kept_unverified: keptUnverified, stream_deleted: stream };
}

/**
 * The newest copy of one R2 object, and whether the item plays it. A store
 * without the Stream table has no copies.
 */
async function copyOf(env: Env, itemUid: string, key: string): Promise<{ stream_uid: string; verified_at: string | null; playing: boolean } | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT v.stream_uid, v.verified_at, (i.stream_uid = v.stream_uid) AS playing
         FROM learning_stream_videos v LEFT JOIN learning_items i ON i.uid = v.item_uid
        WHERE v.item_uid = ? AND v.source_r2_key = ? AND v.origin = 'r2_copy' AND v.state != 'superseded'
        ORDER BY v.verified_at IS NULL DESC, v.id DESC LIMIT 1`,
    ).bind(itemUid, key).first<{ stream_uid: string; verified_at: string | null; playing: number | null }>();
    return row ? { stream_uid: row.stream_uid, verified_at: row.verified_at ?? null, playing: Number(row.playing) === 1 } : null;
  } catch { return null; }
}

/**
 * D4179 — Stream videos nobody plays: superseded for more than
 * `SUPERSEDED_KEPT_DAYS`, or an upload link past its expiry that was never
 * used. Each is deleted at Stream, then its row (and its captions). A video
 * Stream says is already gone still closes its row. Never the item's current
 * video. Without the binding, nothing.
 */
export async function sweepStreamVideos(env: Env, now: Date = new Date()): Promise<number> {
  const stream = streamOf(env);
  if (!stream) return 0;
  const supersededBefore = new Date(now.getTime() - SUPERSEDED_KEPT_DAYS * 86400_000).toISOString();
  let rows: { id: number; stream_uid: string }[] = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT v.id, v.stream_uid FROM learning_stream_videos v LEFT JOIN learning_items i ON i.uid = v.item_uid
        WHERE (i.stream_uid IS NULL OR i.stream_uid != v.stream_uid)
          AND ((v.state = 'superseded' AND julianday(v.updated_at) < julianday(?)) OR (v.state = 'awaiting_upload' AND v.upload_expires_at IS NOT NULL AND julianday(v.upload_expires_at) < julianday(?)))
        ORDER BY v.id LIMIT 200`,
    ).bind(supersededBefore, now.toISOString()).all<{ id: number; stream_uid: string }>()).results ?? [];
  } catch { return 0; }
  let deleted = 0;
  for (const r of rows) {
    try { await stream.video(r.stream_uid).delete(); } catch { /* already gone at Stream: the row still closes */ }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM learning_stream_captions WHERE stream_video_id = ?').bind(r.id),
      env.DB.prepare('DELETE FROM learning_stream_videos WHERE id = ?').bind(r.id),
    ]);
    deleted++;
  }
  return deleted;
}
