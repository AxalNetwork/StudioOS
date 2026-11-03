/**
 * #4176 (D4176, part 1 of #3726) — Learning video on Cloudflare Stream.
 * Two routers, mounted by the route registry (#4105):
 *
 * SUPER ADMIN, at /api/admin/learning (gate and audit: `admin_learning.ts`):
 *   POST   /items/:uid/stream/uploads              { size_bytes, content_type, name? }
 *          → 201 { stream_uid, protocol: 'post', upload_url, expires_at }   at most 200 MB, requireSignedURLs
 *   POST   /items/:uid/stream/uploads/tus          tus creation (Upload-Length, Upload-Metadata)
 *          → 201, Location: Stream's one-time tus URL; { stream_uid, protocol: 'tus', upload_url }
 *            503 stream_tus_unavailable without STREAM_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 *   GET    /items/:uid/stream                      { videos: [...] }; a stale processing row is refreshed
 *   POST   /items/:uid/stream/:streamUid/abandon   { abandoned: true }; 409 stream_in_use
 *   POST   /items/:uid/stream/captions/generate    { language } → 202 { caption }; 409 not_ready
 *   PUT    /items/:uid/stream/captions/:lang       text/vtt (WEBVTT, at most 1 MB) → { caption }
 *   DELETE /items/:uid/stream/captions/:lang       { deleted: true }
 *   PATCH  /items/:uid/stream/thumbnail            { thumbnail_pct: 0..1 } → { video }
 *
 *   POST   /stream/migrations                      { item_uid } → 202 { copy: { stream_uid, state: 'copying' } }
 *          D4179 (#4179, part 4): copy the item's R2 upload to Stream, one item a call;
 *          404 not_found, 409 not_r2, 409 already_copied, 502 stream_copy_failed
 *
 * STREAM, at /api/learning:
 *   POST   /stream/webhook   signature only (`Webhook-Signature`, STREAM_WEBHOOK_SECRET, five minutes);
 *          → { ok: true } | { ignored: true }; 401 bad_signature; 503 webhook_unconfigured
 *   GET    /stream/source/:token   D4179: the R2 object a copy names, for Stream to fetch; the token
 *          is its only key (purpose-scoped HMAC, one hour), and the object must still be the item's
 *
 * Every route answers 503 `stream_unavailable` while `env.STREAM` is absent.
 * Every write is recorded through `record`. No token, upload URL or secret is
 * logged. Bound SQL only.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { refuse } from '../util/refusal';
import { gate, record } from './admin_learning';
import {
  BASIC_UPLOAD_MAX_BYTES, LANGUAGE_RE, MAX_DURATION_SECONDS, STALE_MS, STREAM_UID_RE, UPLOAD_WINDOW_MS, VIDEO_TYPES, VTT_MAX_BYTES,
  applyStatus, captionReady, signSourceToken, streamOf, verifySourceToken, verifyWebhook,
} from '../services/learningStream';
import { keyBelongsTo, parseRange } from '../services/learningVideo';

type C = Context<{ Bindings: Env }>;
const unavailable = (c: C) => refuse(c, 503, { code: 'stream_unavailable', message: 'Video on Stream is not switched on yet.' });
const nowIso = () => new Date().toISOString();

/** The video item, or the refusal. */
async function videoItem(c: C) {
  const item = await c.env.DB.prepare('SELECT uid, kind, stream_uid FROM learning_items WHERE uid = ?')
    .bind(c.req.param('uid') ?? '').first<{ uid: string; kind: string; stream_uid: string | null }>();
  if (!item) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
  if (item.kind !== 'video') return refuse(c, 409, { code: 'not_a_video', message: 'Only a video item takes a video.' });
  return item;
}

/** The item's ready Stream video, or a 409 not_ready. */
async function readyVideo(c: C, item: { uid: string; stream_uid: string | null }) {
  const row = item.stream_uid ? await c.env.DB.prepare(
    `SELECT id, stream_uid FROM learning_stream_videos WHERE item_uid = ? AND stream_uid = ? AND state = 'ready'`,
  ).bind(item.uid, item.stream_uid).first<{ id: number; stream_uid: string }>() : null;
  return row ?? refuse(c, 409, { code: 'not_ready', message: 'This video is not ready on Stream yet.' });
}

const admin = new Hono<{ Bindings: Env }>();

admin.post('/items/:uid/stream/uploads', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const b = await c.req.json().catch(() => ({} as any));
  const size = Number(b?.size_bytes);
  if (!Number.isSafeInteger(size) || size <= 0) return refuse(c, 400, { code: 'bad_size', message: 'size_bytes is the file\'s size in bytes.' });
  if (!(VIDEO_TYPES as readonly string[]).includes(String(b?.content_type ?? ''))) {
    return refuse(c, 415, { code: 'bad_video_type', message: 'Upload an MP4, WebM, QuickTime or Matroska video.' });
  }
  if (size > BASIC_UPLOAD_MAX_BYTES) {
    return refuse(c, 413, { code: 'video_too_large', message: 'A file over 200 MB uses the resumable upload.' });
  }
  const expires = new Date(Date.now() + UPLOAD_WINDOW_MS).toISOString();
  const made = await stream.createDirectUpload({
    maxDurationSeconds: MAX_DURATION_SECONDS, requireSignedURLs: true, expiry: expires,
    meta: { item_uid: item.uid, ...(typeof b?.name === 'string' && b.name.trim() ? { name: b.name.trim().slice(0, 200) } : {}) },
  });
  const uid = String(made?.uid ?? made?.id ?? '');
  const url = String(made?.uploadURL ?? made?.upload_url ?? made?.url ?? '');
  if (!STREAM_UID_RE.test(uid) || !/^https:\/\//.test(url)) {
    return refuse(c, 502, { code: 'stream_upload_failed', message: 'Stream did not give an upload link. Nothing was recorded.' });
  }
  await c.env.DB.prepare(
    `INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, size_bytes, upload_expires_at, created_by)
     VALUES (?, ?, 'upload', 'awaiting_upload', ?, ?, ?)`,
  ).bind(item.uid, uid, size, expires, who.id).run();
  await record(c, who, 'learning.stream.upload', { uid: item.uid, stream_uid: uid, protocol: 'post' });
  return c.json({ stream_uid: uid, protocol: 'post', upload_url: url, expires_at: expires }, 201);
});

/** Base64 of a string, for tus metadata. */
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

admin.post('/items/:uid/stream/uploads/tus', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  if (!streamOf(c.env)) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const token = (c.env as any).STREAM_API_TOKEN as string | undefined;
  const account = c.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return refuse(c, 503, { code: 'stream_tus_unavailable', message: 'Files over 200 MB need the Stream API token.' });
  const length = Number(c.req.header('Upload-Length'));
  if (!Number.isSafeInteger(length) || length <= 0) return refuse(c, 400, { code: 'bad_size', message: 'Upload-Length is the file\'s size in bytes.' });
  // The client's metadata keeps only its name; the Worker sets the signing and duration rules itself.
  const name = (c.req.header('Upload-Metadata') ?? '').split(',').map((p) => p.trim().split(' '))
    .find(([k]) => k === 'name')?.[1];
  const metadata = [`requiresignedurls`, `maxdurationseconds ${b64(String(MAX_DURATION_SECONDS))}`, `item_uid ${b64(item.uid)}`, ...(name ? [`name ${name}`] : [])].join(',');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/stream?direct_user=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0', 'Upload-Length': String(length), 'Upload-Metadata': metadata },
  });
  const location = res.headers.get('Location') ?? res.headers.get('location');
  const uid = res.headers.get('stream-media-id') ?? '';
  if (!res.ok || !location || !STREAM_UID_RE.test(uid)) {
    return refuse(c, 502, { code: 'stream_upload_failed', message: 'Stream did not give an upload link. Nothing was recorded.' });
  }
  await c.env.DB.prepare(
    `INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, size_bytes, upload_expires_at, created_by)
     VALUES (?, ?, 'upload', 'awaiting_upload', ?, ?, ?)`,
  ).bind(item.uid, uid, length, new Date(Date.now() + UPLOAD_WINDOW_MS).toISOString(), who.id).run();
  await record(c, who, 'learning.stream.upload', { uid: item.uid, stream_uid: uid, protocol: 'tus' });
  return c.json({ stream_uid: uid, protocol: 'tus', upload_url: location }, 201, {
    Location: location, 'stream-media-id': uid, 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, stream-media-id, Tus-Resumable',
  });
});

admin.get('/items/:uid/stream', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const rows = async () => (await c.env.DB.prepare(
    `SELECT id, stream_uid, origin, state, error_code, error_message, duration_seconds, size_bytes, thumbnail_pct, ready_at, updated_at
       FROM learning_stream_videos WHERE item_uid = ? ORDER BY id DESC LIMIT 20`,
  ).bind(item.uid).all<any>()).results ?? [];
  // A missed webhook: a row still waiting after two minutes is read again from Stream.
  for (const v of await rows()) {
    if ((v.state === 'processing' || v.state === 'awaiting_upload') && Date.now() - Date.parse(`${String(v.updated_at).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(String(v.updated_at)) ? '' : 'Z'}`) > STALE_MS) {
      try { await applyStatus(c.env, { uid: v.stream_uid, ...(await stream.video(v.stream_uid).details()) }); } catch { /* left as it was */ }
    }
  }
  const videos = await rows();
  const captions = videos.length ? ((await c.env.DB.prepare(
    `SELECT stream_video_id, language, label, source, state FROM learning_stream_captions
      WHERE stream_video_id IN (SELECT id FROM learning_stream_videos WHERE item_uid = ?) ORDER BY language`,
  ).bind(item.uid).all<any>()).results ?? []) : [];
  return c.json({
    current: item.stream_uid,
    videos: videos.map((v) => ({
      stream_uid: v.stream_uid, origin: v.origin, state: v.state, error_code: v.error_code ?? null, error_message: v.error_message ?? null,
      duration_seconds: v.duration_seconds ?? null, size_bytes: v.size_bytes ?? null, thumbnail_pct: v.thumbnail_pct ?? null, ready_at: v.ready_at ?? null,
      captions: captions.filter((x) => x.stream_video_id === v.id).map((x) => ({ language: x.language, label: x.label ?? null, source: x.source, state: x.state })),
    })),
  });
});

admin.post('/items/:uid/stream/:streamUid/abandon', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const sid = c.req.param('streamUid') ?? '';
  const row = STREAM_UID_RE.test(sid) ? await c.env.DB.prepare(
    `SELECT id FROM learning_stream_videos WHERE item_uid = ? AND stream_uid = ? AND state != 'superseded'`,
  ).bind(item.uid, sid).first<{ id: number }>() : null;
  if (!row) return refuse(c, 404, { code: 'not_found', message: 'No such upload for this item.' });
  if (item.stream_uid === sid) return refuse(c, 409, { code: 'stream_in_use', message: 'This is the video members watch. Upload another before removing it.' });
  try { await stream.video(sid).delete(); } catch { /* already gone at Stream: the row still closes */ }
  await c.env.DB.prepare(`UPDATE learning_stream_videos SET state = 'superseded', updated_at = ? WHERE id = ?`).bind(nowIso(), row.id).run();
  await record(c, who, 'learning.stream.abandon', { uid: item.uid, stream_uid: sid });
  return c.json({ abandoned: true });
});

admin.post('/items/:uid/stream/captions/generate', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const b = await c.req.json().catch(() => ({} as any));
  const language = String(b?.language ?? '');
  if (!LANGUAGE_RE.test(language) || language.length > 35) return refuse(c, 400, { code: 'bad_language', message: 'language is a language tag such as en or pt-BR.' });
  const v = await readyVideo(c, item); if (v instanceof Response) return v;
  const made = await stream.video(v.stream_uid).captions.generate(language);
  const label = typeof made?.label === 'string' ? made.label.slice(0, 120) : null;
  await c.env.DB.prepare(
    `INSERT INTO learning_stream_captions (stream_video_id, language, label, source, state, created_by) VALUES (?, ?, ?, 'generated', 'pending', ?)
     ON CONFLICT (stream_video_id, language) DO UPDATE SET label = excluded.label, source = 'generated', state = 'pending', updated_at = datetime('now')`,
  ).bind(v.id, language, label, who.id).run();
  if (made?.status === 'ready') await captionReady(c.env, v.id, language, null);
  await record(c, who, 'learning.stream.captions.generate', { uid: item.uid, language });
  return c.json({ caption: { language, label, source: 'generated', state: made?.status === 'ready' ? 'ready' : 'pending' } }, 202);
});

admin.put('/items/:uid/stream/captions/:lang', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const language = c.req.param('lang') ?? '';
  if (!LANGUAGE_RE.test(language) || language.length > 35) return refuse(c, 400, { code: 'bad_language', message: 'language is a language tag such as en or pt-BR.' });
  const vtt = await c.req.text();
  if (new TextEncoder().encode(vtt).length > VTT_MAX_BYTES) return refuse(c, 413, { code: 'vtt_too_large', message: 'A caption file is at most 1 MB.' });
  if (!/^﻿?WEBVTT/.test(vtt)) return refuse(c, 400, { code: 'bad_vtt', message: 'A caption file is WebVTT: it starts with WEBVTT.' });
  const v = await readyVideo(c, item); if (v instanceof Response) return v;
  const captions = stream.video(v.stream_uid).captions;
  if (typeof captions.upload !== 'function') return unavailable(c);
  await captions.upload(language, new File([vtt], `${language}.vtt`, { type: 'text/vtt' }));
  await c.env.DB.prepare(
    `INSERT INTO learning_stream_captions (stream_video_id, language, label, source, state, created_by) VALUES (?, ?, NULL, 'uploaded', 'ready', ?)
     ON CONFLICT (stream_video_id, language) DO UPDATE SET source = 'uploaded', state = 'ready', updated_at = datetime('now')`,
  ).bind(v.id, language, who.id).run();
  await record(c, who, 'learning.stream.captions.upload', { uid: item.uid, language });
  return c.json({ caption: { language, label: null, source: 'uploaded', state: 'ready' } });
});

admin.delete('/items/:uid/stream/captions/:lang', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const language = c.req.param('lang') ?? '';
  const row = item.stream_uid && LANGUAGE_RE.test(language) ? await c.env.DB.prepare(
    `SELECT cp.id FROM learning_stream_captions cp JOIN learning_stream_videos v ON v.id = cp.stream_video_id
      WHERE v.item_uid = ? AND v.stream_uid = ? AND cp.language = ?`,
  ).bind(item.uid, item.stream_uid, language).first<{ id: number }>() : null;
  if (!row) return refuse(c, 404, { code: 'not_found', message: 'No caption in that language.' });
  await stream.video(item.stream_uid!).captions.delete(language);
  await c.env.DB.prepare('DELETE FROM learning_stream_captions WHERE id = ?').bind(row.id).run();
  await record(c, who, 'learning.stream.captions.delete', { uid: item.uid, language });
  return c.json({ deleted: true });
});

admin.patch('/items/:uid/stream/thumbnail', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const item = await videoItem(c); if (item instanceof Response) return item;
  const b = await c.req.json().catch(() => ({} as any));
  const pct = Number(b?.thumbnail_pct);
  if (b?.thumbnail_pct === null || b?.thumbnail_pct === undefined || !Number.isFinite(pct) || pct < 0 || pct > 1) {
    return refuse(c, 400, { code: 'bad_thumbnail', message: 'thumbnail_pct is a share of the video, from 0 to 1.' });
  }
  const v = await readyVideo(c, item); if (v instanceof Response) return v;
  await stream.video(v.stream_uid).update({ thumbnailTimestampPct: pct });
  await c.env.DB.prepare(`UPDATE learning_stream_videos SET thumbnail_pct = ?, updated_at = ? WHERE id = ?`).bind(pct, nowIso(), v.id).run();
  await record(c, who, 'learning.stream.thumbnail', { uid: item.uid, thumbnail_pct: pct });
  return c.json({ video: { stream_uid: v.stream_uid, thumbnail_pct: pct } });
});

/**
 * D4179 — copy one item's R2 upload to Stream. Stream fetches the object
 * from a one-hour source URL; the copy is an `r2_copy` row, verified by the
 * webhook once it is ready with a duration above 0. The R2 object is kept.
 */
admin.post('/stream/migrations', async (c) => {
  const who = await gate(c); if (who instanceof Response) return who;
  const stream = streamOf(c.env); if (!stream) return unavailable(c);
  const b = await c.req.json().catch(() => ({} as any));
  const itemUid = typeof b?.item_uid === 'string' ? b.item_uid : '';
  const item = itemUid ? await c.env.DB.prepare('SELECT uid, kind, video_source, r2_key FROM learning_items WHERE uid = ?')
    .bind(itemUid).first<{ uid: string; kind: string; video_source: string | null; r2_key: string | null }>() : null;
  if (!item) return refuse(c, 404, { code: 'not_found', message: 'No such item.' });
  if (item.kind !== 'video' || item.video_source !== 'r2' || !keyBelongsTo(item.uid, item.r2_key)) {
    return refuse(c, 409, { code: 'not_r2', message: 'This item has no uploaded file to copy.' });
  }
  const open = await c.env.DB.prepare(
    `SELECT stream_uid FROM learning_stream_videos
      WHERE item_uid = ? AND origin = 'r2_copy' AND source_r2_key = ? AND state IN ('awaiting_upload', 'processing', 'ready') LIMIT 1`,
  ).bind(item.uid, item.r2_key).first<{ stream_uid: string }>();
  if (open) return refuse(c, 409, { code: 'already_copied', message: 'This file is already copied, or its copy is still running.' });
  if (typeof stream.upload !== 'function') return unavailable(c);
  const token = await signSourceToken(c.env, item.uid, item.r2_key!);
  if (!token) return refuse(c, 503, { code: 'stream_copy_unavailable', message: 'Copies cannot be signed here yet.' });
  const source = new URL(`/api/learning/stream/source/${token}`, c.req.url).toString();
  let made: any;
  try {
    made = await stream.upload(source, { requireSignedURLs: true, meta: { item_uid: item.uid, origin: 'r2_copy' } });
  } catch {
    console.warn('[learning-stream] copy refused', { outcome: 'upload_failed' });
    return refuse(c, 502, { code: 'stream_copy_failed', message: 'Stream did not take the copy. Nothing was recorded. Try again.' });
  }
  const uid = String(made?.uid ?? made?.id ?? '');
  if (!STREAM_UID_RE.test(uid)) return refuse(c, 502, { code: 'stream_copy_failed', message: 'Stream did not take the copy. Nothing was recorded. Try again.' });
  await c.env.DB.prepare(
    `INSERT INTO learning_stream_videos (item_uid, stream_uid, origin, state, source_r2_key, created_by)
     VALUES (?, ?, 'r2_copy', 'processing', ?, ?)`,
  ).bind(item.uid, uid, item.r2_key, who.id).run();
  await record(c, who, 'learning.stream.copy', { uid: item.uid, stream_uid: uid });
  return c.json({ copy: { stream_uid: uid, state: 'copying' } }, 202);
});

const hooks = new Hono<{ Bindings: Env }>();

/**
 * D4179 — the object a copy names, for Stream to fetch. No session: the token
 * is the only key, it names one item's one object, and that object must still
 * be the upload the item plays. Anything else is 404, as an unknown path is.
 */
hooks.get('/stream/source/:token', async (c) => {
  const missing = () => refuse(c, 404, { code: 'not_found', message: 'No such video.' });
  const named = await verifySourceToken(c.env, c.req.param('token') ?? '');
  if (!named || !c.env.FILES) return missing();
  const item = await c.env.DB.prepare('SELECT video_source, r2_key FROM learning_items WHERE uid = ?')
    .bind(named.itemUid).first<{ video_source: string | null; r2_key: string | null }>();
  if (!item || item.video_source !== 'r2' || item.r2_key !== named.r2Key) return missing();
  const head = await c.env.FILES.head(named.r2Key);
  if (!head) return missing();
  const range = parseRange(c.req.header('range'), head.size);
  const headers = new Headers({
    'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Type': head.httpMetadata?.contentType || 'application/octet-stream',
  });
  if (range === 'unsatisfiable') { headers.set('Content-Range', `bytes */${head.size}`); return new Response(null, { status: 416, headers }); }
  const obj = await c.env.FILES.get(named.r2Key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) return missing();
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${head.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(head.size));
  return new Response(obj.body, { status: 200, headers });
});

hooks.post('/stream/webhook', async (c) => {
  if (!streamOf(c.env)) return unavailable(c);
  const secret = (c.env as any).STREAM_WEBHOOK_SECRET as string | undefined;
  if (!secret) return refuse(c, 503, { code: 'webhook_unconfigured', message: 'The Stream webhook is not set up yet.' });
  const body = await c.req.text();
  if (!(await verifyWebhook(secret, c.req.header('Webhook-Signature'), body))) {
    return refuse(c, 401, { code: 'bad_signature', message: 'The webhook signature does not match.' });
  }
  let payload: any;
  try { payload = JSON.parse(body); } catch { return refuse(c, 400, { code: 'bad_body', message: 'The webhook body is not JSON.' }); }
  const done = await applyStatus(c.env, payload);
  return c.json(done === 'ignored' ? { ignored: true } : { ok: true });
});

export { admin as adminLearningStream, hooks as learningStreamHooks };

export const mount: RouteMount[] = [
  { path: '/api/admin/learning', router: admin },
  { path: '/api/learning', router: hooks },
];
