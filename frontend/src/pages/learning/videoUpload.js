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
