/**
 * A Learning video's file, uploaded by the Super Admin (D561, #1162): the pure
 * half. The route's limits, the check made before anything is sent, and the
 * states the studio's upload field draws. No React and no client: the calls
 * themselves are `uploadVideo` in `studioActions.js`.
 *
 * THE LIMITS ARE THE ROUTE'S, mirrored here so a file is refused before a
 * byte leaves the browser (`services/learningVideo.ts`, which
 * `routes/learning_video.ts` enforces; the D561 UI test holds the two equal):
 *
 *   - the type is `video/mp4` or `video/webm` (the start route answers 415);
 *   - the size is at most 2 GB, 2 × 1024³ bytes, and exactly 2 GB is allowed
 *     (413);
 *   - a part is at most 95 MB, which the start route's own `part_size` never
 *     exceeds.
 *
 * A refusal made here says what the route would have said, in the route's own
 * sentence, then what this file is: the Super Admin reads the same words
 * whichever side refuses.
 *
 * #4177 (L2 of #3726) adds the pure half of a video on Cloudflare Stream
 * (D4176's routes): its limits and the 200 MB switch, the field's states, the
 * poll, captions, chapters, the thumbnail, and the content table's Video
 * column with L4's copy state, which is a guess until #4179 (see below).
 */

/** What D561's routes take. The sizes are 1024-based, as the route's own sentences count them. */
export const VIDEO_UPLOAD = {
  types: { 'video/mp4': 'MP4', 'video/webm': 'WebM' },
  maxBytes: 2 * 1024 * 1024 * 1024,
  partMaxBytes: 95 * 1024 * 1024,
};

const UNITS = ['KB', 'MB', 'GB'];

/**
 * A size in the route's own units: "2 GB", "95 MB", "1.3 GB". Rounded UP to a
 * tenth, so a file one byte over the limit never reads as the limit itself.
 * Null for a size that is not one.
 */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (bytes === null || bytes === undefined || bytes === '' || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const tenths = Math.ceil(value * 10 - 1e-9) / 10;
  return `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)} ${UNITS[unit]}`;
}

/** The file input's `accept`: the two types the route takes. */
export const VIDEO_ACCEPT = Object.keys(VIDEO_UPLOAD.types).join(',');

/** The limits as the upload field shows them: "MP4 or WebM, at most 2 GB." */
export const VIDEO_LIMITS_LINE = `${Object.values(VIDEO_UPLOAD.types).join(' or ')}, at most ${formatBytes(VIDEO_UPLOAD.maxBytes)}.`;

/** The route's own sentences for the two limits (`routes/learning_video.ts`). */
const TYPE_RULE = `A video is ${Object.keys(VIDEO_UPLOAD.types).join(' or ')}.`;
const SIZE_RULE = `A video is at most ${formatBytes(VIDEO_UPLOAD.maxBytes)}.`;

/** The type the start route is sent: the browser's own, as the route reads it. */
export const videoTypeOf = (file) => String(file?.type ?? '').trim().toLowerCase();

/**
 * Why a chosen file cannot be uploaded, or null when it can. Checked before
 * anything is sent, so a file the route would refuse never starts an upload.
 */
export function videoFileProblem(file) {
  if (!file) return 'Choose a video file first.';
  const type = videoTypeOf(file);
  if (!VIDEO_UPLOAD.types[type]) {
    return `${TYPE_RULE} ${type ? `This file is ${type}.` : 'The browser did not say what type this file is.'}`;
  }
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0) return 'This file is empty.';
  if (size > VIDEO_UPLOAD.maxBytes) return `${SIZE_RULE} This file is ${formatBytes(size)}.`;
  return null;
}

// ── The upload field's states ─────────────────────────────────────────────
//
//   idle        nothing chosen
//   refused     a file the route would refuse, with the sentence; nothing sent
//   ready       a file that may go up, waiting for "Upload"
//   uploading   sending: { sent, total, part, parts, step } ('start', 'parts', 'complete')
//   cancelling  "Cancel" was pressed; the part on its way finishes, then the upload is closed
//   cancelled   closed, nothing attached
//   failed      the route's refusal (or the client's), as it came
//   done        attached: { attached } is the completion reply, the file's real size and type

export const IDLE_UPLOAD = { phase: 'idle' };

/** The code `uploadVideo` throws when the Super Admin cancels. */
export const UPLOAD_CANCELLED = 'upload_cancelled';

/** The field's state once a file is chosen. */
export function chooseVideoFile(file) {
  if (!file) return IDLE_UPLOAD;
  const problem = videoFileProblem(file);
  return problem ? { phase: 'refused', file, message: problem } : { phase: 'ready', file };
}

/** The field's state when an upload stops short: cancelled, or failed with the sentence it failed with. */
export function uploadFailure(err, file) {
  if (err?.code === UPLOAD_CANCELLED) return { phase: 'cancelled', file };
  return { phase: 'failed', file, message: err?.message || 'The upload could not be finished.' };
}

/** How far an upload has got, as a whole percent of the file's bytes. */
export function uploadPercent(state) {
  const total = Number(state?.total);
  const sent = Number(state?.sent);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sent)) return 0;
  return Math.max(0, Math.min(100, Math.floor((100 * sent) / total)));
}

/**
 * The editor's form once a file is attached. Completing an upload clears the
 * item's link (D561), so the form's link is cleared too: saving afterwards
 * must not send the old link back, because a saved link replaces an upload.
 */
export const formAfterUpload = (form) => ({ ...form, video_url: '' });

/**
 * The item the editor draws: the row its own upload left, `{ from, row }`,
 * for as long as the page still hands it the item it had when the upload
 * finished. Any newer item from the page (a save or a status change answers
 * with the stored row) is drawn instead.
 */
export const shownItem = (item, uploaded) => (uploaded && uploaded.from === item ? uploaded.row : item);

/**
 * The item as stored once a file is attached: the item read again after the
 * upload, or, when that read failed, the item as the completion reply leaves
 * it (`video_source` from the reply, the link cleared).
 */
export function storedAfterUpload(item, done) {
  if (done?.item) return done.item;
  return { ...item, video_source: done?.attached?.video_source || 'r2', video_url: null };
}

// ══ Video on Cloudflare Stream (#4177, L2 of #3726; the routes are D4176's) ══
//
// `routes/learning_stream.ts` takes the file, `services/learningStream.ts`
// holds its limits. Mirrored here so a file the route would refuse is refused
// before anything is sent (the #4177 test holds the two equal):
//
//   - the type is one of VIDEO_TYPES (the basic route answers 415);
//   - a file of 200 MB (200 × 1024²) or less goes by basic POST to the
//     `upload_url` the start route answers; a larger one goes resumably, by
//     tus, through the Worker's tus route (503 `stream_tus_unavailable`
//     without the API token);
//   - a caption file is WebVTT, at most 1 MB;
//   - chapters are at most 100, start seconds strictly increasing, titles of
//     1–120 characters (`parseChapters`, on the item's PATCH).
//
// The D561 R2 uploader above stays: the editor draws it while Stream answers
// 503 `stream_unavailable`, and until L4 (#4179) has copied every R2 video.

export const STREAM_UPLOAD = {
  types: { 'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV', 'video/x-matroska': 'MKV' },
  basicMaxBytes: 200 * 1024 * 1024,
  // tus chunks: Stream asks for a multiple of 256 KiB, at least 5 MiB; 50 MiB is its suggestion.
  tusChunkBytes: 50 * 1024 * 1024,
  pollMs: 10_000,
  vttMaxBytes: 1024 * 1024,
  maxChapters: 100,
  chapterTitleMax: 120,
};

/** A type by the file's extension, for a file the browser names no type for (an MKV often comes with none). */
const STREAM_EXTENSIONS = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' };

/** The file input's `accept`: the four types, and the extensions a browser may not type. */
export const STREAM_ACCEPT = [...Object.keys(STREAM_UPLOAD.types), '.mp4', '.webm', '.mov', '.mkv'].join(',');

/** The field's limits line (lr14's idle row). No size cap is recorded yet (owner step D, D4176 §7), so none is shown. */
export const STREAM_LIMITS_LINE = 'MP4, WebM, MOV or MKV. Files over 200 MB go up resumably.';

/** The route's sentence for a type it does not take (`routes/learning_stream.ts`, 415 `bad_video_type`). */
export const STREAM_TYPE_RULE = 'Upload an MP4, WebM, QuickTime or Matroska video.';

/** The type the start route is sent: the browser's own, or the extension's when the browser names none. */
export function streamTypeOf(file) {
  const own = String(file?.type ?? '').trim().toLowerCase();
  if (own) return own;
  const ext = String(file?.name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && STREAM_EXTENSIONS[ext]) || '';
}

/** Why a chosen file cannot go to Stream, or null when it can. Checked before anything is sent. */
export function streamFileProblem(file) {
  if (!file) return 'Choose a video file first.';
  const type = streamTypeOf(file);
  if (!STREAM_UPLOAD.types[type]) {
    return `${STREAM_TYPE_RULE} ${type ? `This file is ${type}.` : 'The browser did not say what type this file is.'}`;
  }
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size <= 0) return 'This file is empty.';
  return null;
}

/** THE 200 MB SWITCH: basic POST up to and including 200 MB, tus above it. */
export const streamProtocolFor = (size) => (Number(size) <= STREAM_UPLOAD.basicMaxBytes ? 'post' : 'tus');

/** A clock for a number of seconds: "14:32", "1:02:05". Null for a value that is not one. */
export function formatClock(seconds) {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === '' || !Number.isFinite(n) || n < 0) return null;
  const s = Math.round(n);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${String(mm).padStart(2, '0')}:${ss}`;
}

/** A start time as typed: "03:40", "1:02:05" or whole seconds. Undefined when it is not one. */
export function parseClock(text) {
  const t = String(text ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/);
  if (!m) return undefined;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// ── The Stream field's states (lr14, lr14b, lr20e) ────────────────────────
//
// The field is drawn from two things: the Stream read (`GET …/stream`, held by
// the editor as { status, data, message }) and this editor's own upload
// ({ phase, file, sent, total, protocol, message }). `streamField` turns them
// into the one state the field draws:
//
//   reading      the read has not answered: NO CONTROL IS DRAWN
//   unreadable   the read failed (not a 503 stream_unavailable): no control, a retry
//   off          503 stream_unavailable: Stream is not on, the D561 R2 field is drawn instead
//   uploading    "<file> · uploading n%", Cancel upload
//   cancelling   Cancel was pressed; the request on its way is stopped
//   processing   the newest video is awaiting_upload or processing at Stream; polled every 10 s
//   ready        the item plays it: duration and dimensions, Replace
//   failed       Stream's error, or this upload's refusal, in its own words; Try again
//   idle         no Stream video yet: the file input
//
// A local refusal or failure wins over the read, so the words it stopped with
// stay on screen until another file is chosen.

export const STREAM_IDLE = { phase: 'idle' };
export const STREAM_FAILED_LINE = 'Stream could not process this file.';

/** The newest Stream video the item has that is not superseded, or null. The read lists them newest first. */
export function latestStreamVideo(data) {
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  return videos.find((v) => v && v.state !== 'superseded') || null;
}

/** The video the item plays now (`current`), or null. */
export function currentStreamVideo(data) {
  const videos = Array.isArray(data?.videos) ? data.videos : [];
  return (data?.current && videos.find((v) => v?.stream_uid === data.current && v.state === 'ready')) || null;
}

/** The one state the Stream field draws. */
export function streamField({ read, upload = STREAM_IDLE }) {
  const phase = upload?.phase || 'idle';
  if (phase === 'uploading' || phase === 'cancelling') {
    return { kind: phase, file: upload.file, percent: uploadPercent(upload), protocol: upload.protocol || streamProtocolFor(upload.file?.size) };
  }
  if (phase === 'refused' || phase === 'failed') return { kind: 'failed', file: upload.file, message: upload.message || STREAM_FAILED_LINE, local: true };
  const status = read?.status;
  if (status === 'unavailable') return { kind: 'off', message: read.message || '' };
  if (status === 'unreadable') return { kind: 'unreadable', message: read.message || '' };
  if (status !== 'ready') return { kind: 'reading' };
  const latest = latestStreamVideo(read.data);
  const cancelled = phase === 'cancelled';
  if (!latest) return { kind: 'idle', cancelled };
  if (latest.state === 'processing' || latest.state === 'awaiting_upload') return { kind: 'processing', video: latest };
  if (latest.state === 'error') return { kind: 'failed', video: latest, message: latest.error_message || STREAM_FAILED_LINE };
  const playing = currentStreamVideo(read.data) || (latest.state === 'ready' ? latest : null);
  return playing ? { kind: 'ready', video: playing, cancelled } : { kind: 'idle', cancelled };
}

/** The ready pill: "Ready · 14:32 · 1920×1080", each figure the read does not send said so. */
export function readyLine(video) {
  const length = formatClock(video?.duration_seconds) || 'length not recorded';
  const w = Number(video?.width);
  const hgt = Number(video?.height);
  const size = Number.isFinite(w) && w > 0 && Number.isFinite(hgt) && hgt > 0 ? `${w}×${hgt}` : 'dimensions not recorded';
  return `Ready · ${length} · ${size}`;
}

/** How long to wait before reading the Stream state again: 10 s while a video or a caption is on its way, else null. */
export function streamPollMs(read) {
  if (read?.status !== 'ready') return null;
  const latest = latestStreamVideo(read.data);
  if (latest && (latest.state === 'processing' || latest.state === 'awaiting_upload')) return STREAM_UPLOAD.pollMs;
  const playing = currentStreamVideo(read.data);
  if (playing && (playing.captions || []).some((c) => c?.state === 'pending')) return STREAM_UPLOAD.pollMs;
  return null;
}

/** The read's refusal code that means Stream is not on (D4176 §2). */
export const STREAM_UNAVAILABLE = 'stream_unavailable';

// ── Captions (lr15) ────────────────────────────────────────────────────────

/** The languages "Generate ▾" offers: Stream's generated-caption languages, by their tags. */
export const CAPTION_LANGUAGES = [
  ['en', 'English'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'],
  ['ja', '日本語'], ['ko', '한국어'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['pt', 'Português'], ['ru', 'Русский'],
];
const LANGUAGE_NAMES = Object.fromEntries(CAPTION_LANGUAGES);
export const languageName = (tag) => LANGUAGE_NAMES[String(tag || '').split('-')[0]] || null;

/** The refusal for a caption file that is not WebVTT (lr15's words). */
export const VTT_ONLY = 'Only WebVTT files are accepted.';

/** Why a caption file cannot be uploaded, or null. `text` is the file's contents, read before anything is sent. */
export function vttProblem(file, text) {
  const name = String(file?.name || 'This file');
  const typed = String(file?.type || '').toLowerCase();
  const named = /\.vtt$/i.test(name);
  if ((!named && typed !== 'text/vtt') || !/^﻿?WEBVTT/.test(String(text ?? ''))) return `${VTT_ONLY} ${name} was not uploaded.`;
  if (Number(file?.size) > STREAM_UPLOAD.vttMaxBytes) return 'A caption file is at most 1 MB.';
  return null;
}

const CAPTION_SOURCE = { generated: 'Generated', uploaded: 'Uploaded' };
const CAPTION_STATE = { ready: ['Ready', 'ok'], pending: ['Pending', 'info'], error: ['Error', 'danger'] };

/** The caption rows of the video the item plays, as lr15 draws them. A value the read does not send reads "Not recorded". */
export function captionRows(video) {
  return (Array.isArray(video?.captions) ? video.captions : []).map((c) => {
    const [state, tone] = CAPTION_STATE[c?.state] || ['Not recorded', 'neutral'];
    return {
      language: c?.language,
      name: c?.label || languageName(c?.language) || c?.language,
      source: CAPTION_SOURCE[c?.source] || 'Not recorded',
      state,
      tone,
    };
  });
}

// ── Chapters (lr15) ────────────────────────────────────────────────────────

export const CHAPTER_ORDER = 'Each chapter must start after the one before it.';
export const CHAPTER_LIMIT = `A video has at most ${STREAM_UPLOAD.maxChapters} chapters.`;
export const CHAPTER_TITLE = `Each chapter needs a title of at most ${STREAM_UPLOAD.chapterTitleMax} characters.`;
export const CHAPTER_TIME = 'A start time is minutes and seconds, as 03:40.';
export const CHAPTERS_HINT = `Start times must increase. Up to ${STREAM_UPLOAD.maxChapters} chapters.`;

/** The editor's rows from the stored chapters: [{ start, title }], the start as a clock. */
export const chapterRows = (chapters) => (Array.isArray(chapters) ? chapters : [])
  .map((c) => ({ start: formatClock(c?.start_seconds) ?? '', title: String(c?.title ?? '') }));

/** The first problem with the rows, as { index, message }, or null. Checked before anything is sent. */
export function chapterProblem(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > STREAM_UPLOAD.maxChapters) return { index: STREAM_UPLOAD.maxChapters, message: CHAPTER_LIMIT };
  let last = -1;
  for (let i = 0; i < list.length; i += 1) {
    const start = parseClock(list[i]?.start);
    if (start === undefined) return { index: i, message: CHAPTER_TIME };
    if (start <= last) return { index: i, message: CHAPTER_ORDER };
    const title = String(list[i]?.title ?? '').trim();
    if (!title || title.length > STREAM_UPLOAD.chapterTitleMax) return { index: i, message: CHAPTER_TITLE };
    last = start;
  }
  return null;
}

/** The `chapters` the item's PATCH takes. Throws the problem's sentence first. */
export function chaptersBody(rows) {
  const why = chapterProblem(rows)?.message;
  if (why) throw new Error(why);
  return (rows || []).map((r) => ({ start_seconds: parseClock(r.start), title: String(r.title).trim() }));
}

/** A new row: one minute after the last, or 00:00 for the first. */
export function nextChapter(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const last = list.length ? parseClock(list[list.length - 1].start) : undefined;
  return { start: list.length ? (last === undefined ? '' : formatClock(last + 60)) : '00:00', title: '' };
}

// ── The thumbnail (lr15) ───────────────────────────────────────────────────

/** The slider's steps: a thousandth of the video each. */
export const THUMB_STEPS = 1000;

/** "02:10 of 14:32" for a share of the video; the share alone when the length is not recorded. */
export function thumbLabel(pct, durationSeconds) {
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const total = Number(durationSeconds);
  if (!Number.isFinite(total) || total <= 0) return `${Math.round(p * 100)}% of the video (its length is not recorded)`;
  return `${formatClock(p * total)} of ${formatClock(total)}`;
}

/**
 * The frame at that share, from the poster address the member read signs
 * (`video_stream.poster_url`, Stream's own host only), or null. Stream's
 * thumbnail takes `time=<s>s`.
 */
export function frameUrl(posterUrl, pct, durationSeconds) {
  let u;
  try { u = new URL(String(posterUrl || '')); } catch { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)(cloudflarestream\.com|videodelivery\.net)$/.test(u.hostname)) return null;
  const total = Number(durationSeconds);
  if (Number.isFinite(total) && total > 0) u.searchParams.set('time', `${Math.round(Math.max(0, Math.min(1, Number(pct) || 0)) * total)}s`);
  return u.toString();
}

// ── The content table's Video column and Copy to Stream (lr16) ────────────
//
// `GET /api/admin/learning/items` sends `video_source` and `video_url`, and
// not yet `stream_uid`: L4 (#4179) adds the per-item copy state to this read.
// So "Stream · Ready" is drawn only when the row carries `stream_uid`, and
// "None" is claimed only when it carries `stream_uid: null`; a video with
// neither a file nor a link, on a read without the field, is "Not recorded".
//
// THE COPY STATE IS A GUESS PENDING L4. Its field name and shape are this
// page's, not the route's: `stream_copy` on the row, absent while L4 is not
// built (nothing is drawn), null for an uploaded file not yet copied (Copy to
// Stream), or { state: 'copying' | 'verified' | 'failed', error_message }.
// No client method exists for the copy, so "Copy to Stream" and "Try again"
// draw only when the page passes a handler, and today none does.

export const STREAM_COPY_FIELD = 'stream_copy';

/** The Video column for a content row: [label, tone], or null when the row is not a video. */
export function videoColumn(row) {
  if (row?.kind !== 'video') return null;
  if (row.stream_uid) return ['Stream · Ready', 'ok'];
  if (row.video_source === 'r2') return ['Uploaded file', 'warn'];
  if (String(row.video_url ?? '').trim()) return ['Link', 'neutral'];
  return row.stream_uid === null ? ['None', 'neutral'] : null;
}

/** The row's copy state: undefined when the read does not carry the field, else 'copy' | 'copying' | 'verified' | 'failed' | null. */
export function streamCopyOf(row) {
  if (!row || !Object.hasOwn(row, STREAM_COPY_FIELD)) return undefined;
  if (row.kind !== 'video' || row.video_source !== 'r2' || row.stream_uid) return null;
  const c = row[STREAM_COPY_FIELD];
  if (c === null) return 'copy';
  return ['copying', 'verified', 'failed'].includes(c?.state) ? c.state : null;
}

/** lr16's banner count: uploaded files the read says are not yet verified on Stream. Null when no row carries the field. */
export function stillOnStorage(rows) {
  const carried = (rows || []).filter((r) => streamCopyOf(r) !== undefined);
  if (!carried.length) return null;
  return carried.filter((r) => ['copy', 'copying', 'failed'].includes(streamCopyOf(r))).length;
}

export const storageBanner = (n) => `${n} uploaded ${n === 1 ? 'video still plays' : 'videos still play'} from storage.`;
export const STORAGE_BANNER_LINE = 'Copy each to Stream; the original is kept for 30 days after the copy is verified.';
