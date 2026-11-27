/**
 * D561 (#1162) — Learning videos in R2: the Super Admin's upload, and the
 * member's gated playback.
 *
 * Two routers, mounted beside the ones they extend:
 *   - `adminLearningVideo` at `/api/admin/learning` (Super Admin only, the
 *     `gate` every authoring route uses):
 *       POST   /items/:uid/video/uploads           start a multipart upload
 *       PUT    /items/:uid/video/uploads/part      send one part
 *       POST   /items/:uid/video/uploads/complete  finish it and attach it
 *       POST   /items/:uid/video/uploads/abort     give it up
 *   - `learningVideo` at `/api/learning`:
 *       GET    /items/:uid/video                   stream it, with Range
 *
 * THE UPLOAD. A video goes up in parts because one request body is capped
 * below the 2 GB a video may be. The start step checks the item is a video,
 * the type (`video/mp4` or `video/webm`) and the declared size, and makes the
 * key under `learning/videos/<item uid>/`. Every later step is handed that key
 * and checks it belongs to the item in its path (`keyBelongsTo`), so no step
 * can reach another item's object. Completing checks the stored object's real
 * size and type, then sets `video_source = 'r2'` and `r2_key`, clears any link,
 * and logs the actor and the object through `logAdminAction`. A completed
 * object over 2 GB, or of another type, is deleted and refused.
 *
 * PLAYBACK. `canSeeLearning` decides, exactly as for the item itself: a draft
 * or archived video is the Super Admin's only. A refused or missing video is
 * 404, never 403, so the route does not confirm that a hidden item exists.
 * It answers HTTP Range with 206 and the right `Content-Range`, sends
 * `Cache-Control: private` and never a bucket URL.
 *
 * CLEANUP. Archiving keeps the object, because an archived item can be
 * published again. A daily sweep (`sweepLearningVideos`) removes objects no
 * item points at and the videos of items archived for more than 30 days.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError } from './_t13t14t15_helpers';
import { gate, record } from './admin_learning';
import { canSeeLearning } from '../services/learningAccess';
import {
  VIDEO_MAX_BYTES, VIDEO_MAX_PARTS, VIDEO_PART_BYTES, VIDEO_PART_MAX_BYTES, VIDEO_TYPES,
  keyBelongsTo, newVideoKey, parseRange,
} from '../services/learningVideo';

type C = Context<{ Bindings: Env }>;

const noBucket = (c: C) => refuse(c, 503, {
  code: 'video_storage_unavailable',
  message: 'Video storage is not configured on this deployment, so nothing can be uploaded or played.',
});

/** The item a step names, if it exists and is a video. */
async function videoItem(c: C) {
  const uid = c.req.param('uid') as string;
  const item = await c.env.DB.prepare('SELECT uid, kind, video_source, r2_key FROM learning_items WHERE uid = ?')
    .bind(uid).first<{ uid: string; kind: string; video_source: string | null; r2_key: string | null }>();
  if (!item) return { error: refuse(c, 404, { code: 'not_found', message: 'No such item.' }) };
  if (item.kind !== 'video') {
    return { error: refuse(c, 409, { code: 'not_a_video', message: 'Only a video item takes an uploaded video.' }) };
  }
  return { item };
}

/** The key and upload id every step after the first is handed, checked against the item. */
function uploadRef(c: C, itemUid: string, key: unknown, uploadId: unknown) {
  if (!keyBelongsTo(itemUid, key)) {
    return { error: refuse(c, 400, { code: 'bad_key', message: 'That upload does not belong to this item.' }) };
  }
  if (typeof uploadId !== 'string' || !uploadId || uploadId.length > 1000) {
    return { error: refuse(c, 400, { code: 'bad_upload_id', message: 'An upload id is needed.' }) };
  }
  return { key: key as string, uploadId };
}

export const adminLearningVideo = new Hono<{ Bindings: Env }>();

adminLearningVideo.post('/items/:uid/video/uploads', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  if (!c.env.FILES) return noBucket(c);
  const { item, error } = await videoItem(c); if (error) return error;
  const b: any = await c.req.json().catch(() => ({}));
  const contentType = typeof b?.content_type === 'string' ? b.content_type.trim().toLowerCase() : '';
  if (!VIDEO_TYPES[contentType]) {
    return refuse(c, 415, { code: 'bad_video_type', message: 'A video is video/mp4 or video/webm.' });
  }
  const size = Number(b?.size_bytes);
  if (!Number.isSafeInteger(size) || size <= 0) {
    return refuse(c, 400, { code: 'bad_size', message: 'size_bytes is the file\'s size in bytes.' });
  }
  if (size > VIDEO_MAX_BYTES) {
    return refuse(c, 413, { code: 'video_too_large', message: 'A video is at most 2 GB.' });
  }
  const key = newVideoKey(item!.uid, contentType);
  const upload = await c.env.FILES.createMultipartUpload(key, {
    httpMetadata: { contentType },
    customMetadata: { item_uid: item!.uid, uploaded_by: String(admin.id) },
  });
  await record(c, admin, 'learning.video.upload_started', { uid: item!.uid, key, content_type: contentType, size_bytes: size });
  return c.json({
    key,
    upload_id: upload.uploadId,
    part_size: VIDEO_PART_BYTES,
    parts: Math.ceil(size / VIDEO_PART_BYTES),
  }, 201);
});

adminLearningVideo.put('/items/:uid/video/uploads/part', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  if (!c.env.FILES) return noBucket(c);
  const { item, error } = await videoItem(c); if (error) return error;
  const ref = uploadRef(c, item!.uid, c.req.query('key'), c.req.query('upload_id'));
  if (ref.error) return ref.error;
  const partNumber = Number(c.req.query('part_number'));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > VIDEO_MAX_PARTS) {
    return refuse(c, 400, { code: 'bad_part_number', message: `part_number is 1 to ${VIDEO_MAX_PARTS}.` });
  }
  const declared = Number(c.req.header('content-length'));
  if (!Number.isSafeInteger(declared) || declared <= 0) {
    return refuse(c, 411, { code: 'length_required', message: 'A part is sent with its Content-Length.' });
  }
  if (declared > VIDEO_PART_MAX_BYTES) {
    return refuse(c, 413, { code: 'part_too_large', message: `A part is at most ${VIDEO_PART_MAX_BYTES} bytes.` });
  }
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength !== declared) {
    return refuse(c, 400, { code: 'length_mismatch', message: 'The part is not the length it declared.' });
  }
  try {
    const upload = c.env.FILES.resumeMultipartUpload(ref.key!, ref.uploadId!);
    const part = await upload.uploadPart(partNumber, bytes);
    return c.json({ part_number: part.partNumber, etag: part.etag });
  } catch (e) {
    return refuse(c, 409, { code: 'upload_not_open', message: 'That upload is not open: it was completed, aborted or never started.', raw: e });
  }
});

adminLearningVideo.post('/items/:uid/video/uploads/complete', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  if (!c.env.FILES) return noBucket(c);
  const { item, error } = await videoItem(c); if (error) return error;
  const b: any = await c.req.json().catch(() => ({}));
  const ref = uploadRef(c, item!.uid, b?.key, b?.upload_id);
  if (ref.error) return ref.error;
  const parts = Array.isArray(b?.parts) ? b.parts : null;
  const clean = parts?.map((p: any) => ({ partNumber: Number(p?.part_number), etag: String(p?.etag ?? '') }));
  if (!clean?.length || clean.length > VIDEO_MAX_PARTS
    || clean.some((p: any) => !Number.isInteger(p.partNumber) || p.partNumber < 1 || !p.etag)) {
    return refuse(c, 400, { code: 'bad_parts', message: 'parts is the list of {part_number, etag} each part answered with.' });
  }
  try {
    await c.env.FILES.resumeMultipartUpload(ref.key!, ref.uploadId!).complete(clean);
  } catch (e) {
    return refuse(c, 409, { code: 'upload_not_open', message: 'That upload could not be completed: it was completed, aborted or never started, or a part is missing.', raw: e });
  }
  // The declared size and type were the client's word. These are the object's.
  const head = await c.env.FILES.head(ref.key!);
  const type = head?.httpMetadata?.contentType || '';
  if (!head || head.size > VIDEO_MAX_BYTES || !VIDEO_TYPES[type]) {
    await c.env.FILES.delete(ref.key!);
    return head && head.size > VIDEO_MAX_BYTES
      ? refuse(c, 413, { code: 'video_too_large', message: 'A video is at most 2 GB. The upload was removed.' })
      : refuse(c, 415, { code: 'bad_video_type', message: 'A video is video/mp4 or video/webm. The upload was removed.' });
  }
  const previous = item!.video_source === 'r2' ? item!.r2_key : null;
  await c.env.DB.prepare(
    `UPDATE learning_items SET video_source = 'r2', r2_key = ?, video_url = NULL, updated_at = ? WHERE uid = ?`,
  ).bind(ref.key!, new Date().toISOString(), item!.uid).run();
  await record(c, admin, 'learning.video.attached', {
    uid: item!.uid, key: ref.key, size_bytes: head.size, content_type: type, replaced_key: previous,
  });
  return c.json({ uid: item!.uid, video_source: 'r2', size_bytes: head.size, content_type: type });
});

adminLearningVideo.post('/items/:uid/video/uploads/abort', async (c) => {
  const admin = await gate(c); if (admin instanceof Response) return admin;
  if (!c.env.FILES) return noBucket(c);
  const { item, error } = await videoItem(c); if (error) return error;
  const b: any = await c.req.json().catch(() => ({}));
  const ref = uploadRef(c, item!.uid, b?.key, b?.upload_id);
  if (ref.error) return ref.error;
  try {
    await c.env.FILES.resumeMultipartUpload(ref.key!, ref.uploadId!).abort();
  } catch (e) {
    return refuse(c, 409, { code: 'upload_not_open', message: 'That upload is not open.', raw: e });
  }
  await record(c, admin, 'learning.video.upload_aborted', { uid: item!.uid, key: ref.key });
  return c.json({ aborted: true });
});

export const learningVideo = new Hono<{ Bindings: Env }>();

learningVideo.get('/items/:uid/video', async (c) => {
  let user: any;
  try { user = await requireAuth(c); } catch (e) { return mapError(c, e); }
  const item = await c.env.DB.prepare('SELECT uid, status, visibility, video_source, r2_key FROM learning_items WHERE uid = ?')
    .bind(c.req.param('uid')).first<any>();
  const missing = () => refuse(c, 404, { code: 'not_found', message: 'No such video.' });
  if (!item || !canSeeLearning(user, item) || item.video_source !== 'r2' || !item.r2_key) return missing();
  if (!c.env.FILES) return noBucket(c);
  const head = await c.env.FILES.head(item.r2_key);
  if (!head) return missing();
  const size = head.size;
  const range = parseRange(c.req.header('range'), size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const obj = await c.env.FILES.get(item.r2_key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) return missing();
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { status: 200, headers });
});
