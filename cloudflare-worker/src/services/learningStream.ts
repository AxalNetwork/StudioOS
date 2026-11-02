/**
 * #4176 (D4176, part 1 of #3726) — Learning video on Cloudflare Stream.
 *
 * Stream sits BESIDE an item (migration `202611022159_learning_stream.sql`):
 * `learning_items.stream_uid` names the ready Stream video the item plays, and
 * `learning_stream_videos` holds every video made for it, with its state. The
 * binding is `env.STREAM` (`[stream]` and `[env.production.stream]` in
 * wrangler.toml); while it is absent every Stream route answers 503
 * `stream_unavailable`, so this code ships before the owner turns Stream on.
 *
 * WHAT THIS FILE DECIDES
 *   · `verifyWebhook` — Stream's `Webhook-Signature: time=…,sig1=…` is the
 *     HMAC-SHA256 of `time + '.' + body` with `STREAM_WEBHOOK_SECRET`, compared
 *     in constant time, within five minutes of now.
 *   · `applyStatus` — what a webhook (or a refresh of a stale row) changes, and
 *     only that. Idempotent: delivered twice, it leaves the same rows.
 *       ready  → duration (rounded), size, dimensions, host, ready_at; for an
 *                upload the item's `stream_uid` and `duration_seconds`, and the
 *                item's previous ready video `superseded`;
 *       error  → error_code and error_message.
 *   · `captionReady` — a generated caption that is ready fills the item's
 *     transcript only when there is none: it never overwrites an author's.
 *   · `playback` — the member's `video_stream`, every URL carrying a token from
 *     `generateToken()`. The caller mints it ONLY after `canSeeLearning`; it is
 *     never cached and never logged.
 *
 * Bound SQL only.
 */
import type { Env } from '../types';

/** What the Workers binding is used for here; tolerant of the field names the binding and the REST API each use. */
export type StreamBinding = {
  createDirectUpload(opts: Record<string, unknown>): Promise<any>;
  video(uid: string): {
    details(): Promise<any>;
    update(patch: Record<string, unknown>): Promise<any>;
    generateToken(): Promise<string>;
    delete(): Promise<unknown>;
    captions: {
      generate(language: string): Promise<any>;
      upload?(language: string, file: unknown): Promise<any>;
      delete(language: string): Promise<unknown>;
      list?(): Promise<any>;
    };
  };
};

/** The largest file a basic (POST) direct upload takes; larger files go through tus. */
export const BASIC_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
/** The longest video an upload may hold (owner step D may lower it). */
export const MAX_DURATION_SECONDS = 4 * 3600;
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'] as const;
export const VTT_MAX_BYTES = 1024 * 1024;
/** A one-time upload link lives this long. */
export const UPLOAD_WINDOW_MS = 30 * 60 * 1000;
/** A `processing` or `awaiting_upload` row unchanged this long is refreshed from Stream (a missed webhook). */
export const STALE_MS = 2 * 60 * 1000;
/** Stream webhook signatures older than this are refused. */
export const WEBHOOK_WINDOW_SECONDS = 300;
export const LANGUAGE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
/** A Stream video id: 32 hex characters. */
export const STREAM_UID_RE = /^[a-f0-9]{32}$/;

export const streamOf = (env: Env): StreamBinding | null => ((env as any).STREAM ?? null);

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Constant-time comparison of two hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether a Stream webhook is genuine: the signature over `time.body`, inside the window. */
export async function verifyWebhook(secret: string, header: string | null | undefined, body: string, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = new Map(header.split(',').map((p) => {
    const at = p.indexOf('=');
    return [p.slice(0, at).trim(), p.slice(at + 1).trim()] as [string, string];
  }));
  const time = parts.get('time') ?? '';
  const sig = (parts.get('sig1') ?? '').toLowerCase();
  if (!/^\d{1,12}$/.test(time) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  if (Math.abs(nowMs / 1000 - Number(time)) > WEBHOOK_WINDOW_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${time}.${body}`)));
  return sameHex(mac, sig);
}

/** `customer-<code>.cloudflarestream.com` from a playback URL, or null. */
export function hostOf(details: any): string | null {
  for (const u of [details?.playback?.hls, details?.playback?.dash, details?.preview, details?.thumbnail]) {
    try {
      const h = new URL(String(u)).hostname.toLowerCase();
      if (/^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(h)) return h;
    } catch { /* not a URL */ }
  }
  return null;
}

const nowIso = () => new Date().toISOString();

/**
 * Apply what Stream says about one video (a webhook body, or `details()`).
 * Returns what happened. Unknown videos are ignored: a webhook for a video
 * this store never made changes nothing.
 */
export async function applyStatus(env: Env, details: any): Promise<'ready' | 'error' | 'processing' | 'ignored'> {
  const uid = String(details?.uid ?? details?.id ?? '');
  if (!STREAM_UID_RE.test(uid)) return 'ignored';
  const row = await env.DB.prepare('SELECT id, item_uid, origin, state FROM learning_stream_videos WHERE stream_uid = ?')
    .bind(uid).first<{ id: number; item_uid: string; origin: string; state: string }>();
  if (!row || row.state === 'superseded') return 'ignored';
  const state = String(details?.status?.state ?? '');
  const t = nowIso();
  if (details?.readyToStream === true || state === 'ready') {
    const duration = Number(details?.duration);
    const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;
    const size = Number(details?.size);
    const width = Number(details?.input?.width);
    const height = Number(details?.input?.height);
    await env.DB.prepare(
      `UPDATE learning_stream_videos
          SET state = 'ready', duration_seconds = ?, size_bytes = ?, width = ?, height = ?, playback_host = COALESCE(?, playback_host),
              error_code = NULL, error_message = NULL, ready_at = COALESCE(ready_at, ?), updated_at = ?,
              verified_at = CASE WHEN origin = 'r2_copy' AND ? > 0 THEN COALESCE(verified_at, ?) ELSE verified_at END
        WHERE id = ? AND state != 'superseded'`,
    ).bind(seconds, Number.isFinite(size) && size >= 0 ? Math.round(size) : null, Number.isFinite(width) && width > 0 ? width : null,
      Number.isFinite(height) && height > 0 ? height : null, hostOf(details), t, t, seconds ?? 0, t, row.id).run();
    if (row.origin === 'upload' || seconds) {
      // The item now plays this video; its previous ready video is superseded (the sweep deletes it at Stream after 30 days).
      await env.DB.batch([
        env.DB.prepare(`UPDATE learning_items SET stream_uid = ?, duration_seconds = COALESCE(?, duration_seconds), updated_at = ? WHERE uid = ?`)
          .bind(uid, seconds, t, row.item_uid),
        env.DB.prepare(`UPDATE learning_stream_videos SET state = 'superseded', updated_at = ? WHERE item_uid = ? AND state = 'ready' AND stream_uid != ?`)
          .bind(t, row.item_uid, uid),
      ]);
    }
    return 'ready';
  }
  if (state === 'error') {
    const code = String(details?.status?.errorReasonCode ?? details?.status?.errReasonCode ?? 'error').slice(0, 80);
    const message = String(details?.status?.errorReasonText ?? details?.status?.errReasonText ?? 'Stream could not process this video.').slice(0, 500);
    await env.DB.prepare(
      `UPDATE learning_stream_videos SET state = 'error', error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND state != 'superseded'`,
    ).bind(code, message, t, row.id).run();
    return 'error';
  }
  if (['queued', 'inprogress', 'downloading', 'pendingupload'].includes(state) || details?.readyToStream === false) {
    await env.DB.prepare(
      `UPDATE learning_stream_videos SET state = 'processing', updated_at = ? WHERE id = ? AND state IN ('awaiting_upload', 'processing')`,
    ).bind(t, row.id).run();
    return 'processing';
  }
  return 'ignored';
}

const CUE_TIMING = /^(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;

/**
 * Cue text with its markup dropped: everything from a `<` to the next `>` is
 * left out, in one pass, and no `<` or `>` survives (a stray `>` is dropped
 * too). A scan, not a pattern, so no tag can be rebuilt from what is left.
 */
export function stripMarkup(text: string): string {
  let out = '';
  let inTag = false;
  for (const ch of text) {
    if (ch === '<') { inTag = true; continue; }
    if (ch === '>') { inTag = false; continue; }
    if (!inTag) out += ch;
  }
  return out;
}

/** The words of a WebVTT file without its header, cue numbers, timings, notes or tags. */
export function vttToText(vtt: string): string {
  const lines = String(vtt ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let skip = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { skip = false; continue; }
    if (skip) continue;
    if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) { skip = /^(NOTE|STYLE|REGION)\b/.test(line); continue; }
    // A cue's timing line (`00:00:01.000 --> 00:00:04.000 …`) and a bare cue number carry no words.
    if (CUE_TIMING.test(line) || /^\d+$/.test(line)) continue;
    // Cue text is drawn as plain text, never HTML; markup is dropped, and so is any angle bracket left over.
    out.push(stripMarkup(line).trim());
  }
  return out.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * A generated caption is ready: mark its row, and when the item has no
 * transcript, write the caption's words into it. An author's transcript is
 * never overwritten (the UPDATE's own WHERE holds that, not only this code).
 */
export async function captionReady(env: Env, streamVideoId: number, language: string, vtt: string | null): Promise<{ transcriptFilled: boolean }> {
  const t = nowIso();
  await env.DB.prepare(`UPDATE learning_stream_captions SET state = 'ready', updated_at = ? WHERE stream_video_id = ? AND language = ?`)
    .bind(t, streamVideoId, language).run();
  const text = vtt ? vttToText(vtt) : '';
  if (!text) return { transcriptFilled: false };
  const res = await env.DB.prepare(
    `UPDATE learning_items SET transcript = ?, updated_at = ?
      WHERE uid = (SELECT item_uid FROM learning_stream_videos WHERE id = ?) AND (transcript IS NULL OR transcript = '')`,
  ).bind(text.slice(0, 200_000), t, streamVideoId).run();
  return { transcriptFilled: Number(res.meta?.changes ?? 0) > 0 };
}

export type VideoStream =
  | null
  | { state: 'processing' }
  | { state: 'error' }
  | {
    state: 'ready'; iframe_url: string; hls_url: string; dash_url: string; poster_url: string; preview_url: string;
    captions: { language: string; label: string | null }[]; duration_seconds: number | null; expires_at: string;
  };

type StreamRow = { id: number; stream_uid: string; state: string; duration_seconds: number | null; playback_host: string | null; thumbnail_pct: number | null };

/**
 * The item's Stream state for a member, read in its own guarded query (a store
 * without the Stream columns reads as no Stream video). `sign` is called only
 * for a ready video, and only by a caller that has already checked the reader
 * may see the item.
 */
export async function streamState(env: Env, itemUid: string): Promise<{ ready: StreamRow | null; pending: 'processing' | 'error' | null; chapters: unknown[] }> {
  try {
    const item = await env.DB.prepare('SELECT stream_uid, chapters_json FROM learning_items WHERE uid = ?')
      .bind(itemUid).first<{ stream_uid: string | null; chapters_json: string | null }>();
    let chapters: unknown[] = [];
    try { const c = JSON.parse(item?.chapters_json || '[]'); chapters = Array.isArray(c) ? c : []; } catch { chapters = []; }
    const ready = item?.stream_uid ? await env.DB.prepare(
      `SELECT id, stream_uid, state, duration_seconds, playback_host, thumbnail_pct FROM learning_stream_videos
        WHERE stream_uid = ? AND item_uid = ? AND state = 'ready'`,
    ).bind(item.stream_uid, itemUid).first<StreamRow>() : null;
    const latest = await env.DB.prepare(
      `SELECT state FROM learning_stream_videos WHERE item_uid = ? AND state IN ('awaiting_upload', 'processing', 'error') ORDER BY id DESC LIMIT 1`,
    ).bind(itemUid).first<{ state: string }>();
    const pending = latest ? (latest.state === 'error' ? 'error' : 'processing') : null;
    return { ready: ready ?? null, pending, chapters };
  } catch {
    return { ready: null, pending: null, chapters: [] };
  }
}

/** The signed playback for a ready video. Never cached; the token is never logged. */
export async function signedPlayback(env: Env, stream: StreamBinding, row: StreamRow): Promise<VideoStream> {
  const token = await stream.video(row.stream_uid).generateToken();
  const base = row.playback_host ? `https://${row.playback_host}/${token}` : `https://videodelivery.net/${token}`;
  const captions = ((await env.DB.prepare(
    `SELECT language, label FROM learning_stream_captions WHERE stream_video_id = ? AND state = 'ready' ORDER BY language`,
  ).bind(row.id).all<{ language: string; label: string | null }>()).results ?? []).map((x) => ({ language: x.language, label: x.label ?? null }));
  return {
    state: 'ready',
    iframe_url: row.playback_host ? `${base}/iframe` : `https://iframe.videodelivery.net/${token}`,
    hls_url: `${base}/manifest/video.m3u8`,
    dash_url: `${base}/manifest/video.mpd`,
    poster_url: `${base}/thumbnails/thumbnail.jpg`,
    preview_url: `${base}/thumbnails/thumbnail.gif?duration=4s`,
    captions,
    duration_seconds: row.duration_seconds ?? null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  };
}

/** Chapters as PATCH sends them: at most 100, start times strictly increasing, titles 1–120 characters. Null when invalid. */
export function parseChapters(v: unknown): { start_seconds: number; title: string }[] | null {
  if (!Array.isArray(v) || v.length > 100) return null;
  const out: { start_seconds: number; title: string }[] = [];
  let last = -1;
  for (const c of v) {
    const start = Number((c as any)?.start_seconds);
    const title = typeof (c as any)?.title === 'string' ? (c as any).title.trim() : '';
    if (!Number.isInteger(start) || start < 0 || start <= last || !title || title.length > 120) return null;
    out.push({ start_seconds: start, title });
    last = start;
  }
  return out;
}
