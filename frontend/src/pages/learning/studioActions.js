/**
 * The Learning studio's reads and writes (D562), for the Super Admin, through
 * `adminLearningApi` (routes/admin_learning.ts, D557). Every route gates on
 * `requireSuperAdmin`, and every write answers with the row or the whole
 * course tree, which the studio draws from rather than from what it sent.
 *
 * THE BODIES ARE BUILT HERE, IN PURE FUNCTIONS, so what each button sends is
 * one readable mapping rather than a form's state. A refusal is not caught
 * here: the error `request()` throws carries the route's own sentence as its
 * message, and the studio shows that sentence as it is.
 */
import { adminLearningApi } from '../../lib/api/adminLearning.js';
import { learningApi } from '../../lib/api/learning.js';
import { rawRequestHeaders, readRefusal } from '../../lib/api.js';
import { byPosition, formatLength, moveInOrder, parseLength } from './learningModel';
import {
  STREAM_COPY_FIELD, STREAM_UNAVAILABLE, STREAM_UPLOAD, UPLOAD_CANCELLED, VIDEO_UPLOAD, chaptersBody, streamFileProblem, streamProtocolFor,
  streamTypeOf, videoFileProblem, videoTypeOf, vttProblem,
} from './videoUpload';

const listOf = (reply, key, what) => {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
};

/** Every item, drafts and archived included. */
export async function readStudioItems() {
  return { rows: listOf(await adminLearningApi.listItems(), 'items', 'The item list') };
}

/** D4181 (#4181, lr17): one video's analytics, as the route answers it (`videoAnalyticsModel.js` reads it). */
export async function readItemAnalytics(uid) {
  return adminLearningApi.itemAnalytics(uid);
}

/** Every course, without its modules (the list does not send them). */
export async function readStudioCourses() {
  return { rows: listOf(await adminLearningApi.listCourses(), 'courses', 'The course list') };
}

/** One course with its modules and lessons, for the builder. */
export async function readStudioCourse(uid) {
  const reply = await adminLearningApi.getCourse(uid);
  if (!reply?.course) throw new Error('The course came back in a shape this page cannot read.');
  return { course: reply.course };
}

/**
 * The content table's rows, items and courses as one list, the newest edit
 * first. `programs` is null on every row: the item and course lists do not
 * say which programs hold a row (D558 keeps that on each program), so that
 * column is "Not recorded" rather than "None".
 */
export function studioRows(items, courses) {
  const enc = encodeURIComponent;
  return [
    ...(items || []).map((i) => ({
      kind: i.kind, uid: i.uid, title: i.title, status: i.status, visibility: i.visibility, programs: null,
      updated_at: i.updated_at, href: `/learning/studio?item=${enc(i.uid)}`,
      // #4177 (lr16): the Video column. `stream_uid` and the copy state are copied only when the read carries
      // them, so a field the read does not send stays absent rather than reading as "none" (videoUpload.js).
      video_source: i.video_source ?? null, video_url: i.video_url ?? null,
      ...(Object.hasOwn(i, 'stream_uid') ? { stream_uid: i.stream_uid } : {}),
      ...(Object.hasOwn(i, STREAM_COPY_FIELD) ? { [STREAM_COPY_FIELD]: i[STREAM_COPY_FIELD] } : {}),
    })),
    ...(courses || []).map((c) => ({
      kind: 'course', uid: c.uid, title: c.title, status: c.status, visibility: c.visibility, programs: null,
      updated_at: c.updated_at, href: `/learning/studio?course=${enc(c.uid)}`,
    })),
  ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

/** What the studio says after a status change went through. */
export const STATUS_NOTICE = { publish: 'Published.', unpublish: 'Unpublished: back to draft.', archive: 'Archived.' };

/** An item form as the studio holds it, from a stored item or blank. */
export function itemForm(item) {
  return {
    title: item?.title ?? '',
    summary: item?.summary ?? '',
    video_url: item?.video_url ?? '',
    length: formatLength(item?.duration_seconds),
    thumbnail_url: item?.thumbnail_url ?? '',
    transcript: item?.transcript ?? '',
    body: item?.body ?? '',
    topic: item?.topic ?? '',
    level: item?.level ?? '',
    visibility: item?.visibility ?? 'open',
  };
}

/**
 * The body `POST /items` and `PATCH /items/:uid` take. Empty text is sent as
 * empty, which the route stores as null; a video sends its link and
 * transcript, a reading its text, and neither touches the other's fields.
 * Throws on a length that is not one, before anything is sent.
 */
export function itemBody(form, kind) {
  const seconds = parseLength(form.length);
  if (seconds === undefined) throw new Error('Length is minutes, or minutes and seconds as 12:05.');
  return {
    title: form.title,
    summary: form.summary,
    duration_seconds: seconds,
    thumbnail_url: form.thumbnail_url,
    topic: form.topic,
    level: form.level || null,
    // Never null: the column is NOT NULL, and the route stores what it is sent.
    visibility: form.visibility || 'open',
    ...(kind === 'video' ? { video_url: form.video_url, transcript: form.transcript } : { body: form.body }),
  };
}

/** Create a draft (`kind` set) or save an existing item (`uid` set). Resolves to the stored item. */
export async function saveItem({ uid, kind, form }) {
  const body = itemBody(form, kind);
  const reply = uid ? await adminLearningApi.updateItem(uid, body) : await adminLearningApi.createItem({ kind, ...body });
  return reply.item;
}

const ITEM_STATUS = {
  publish: (uid) => adminLearningApi.publishItem(uid),
  unpublish: (uid) => adminLearningApi.unpublishItem(uid),
  archive: (uid) => adminLearningApi.archiveItem(uid),
};
/** Publish, unpublish or archive an item. Resolves to the stored item. */
export async function setItemStatus(uid, action) {
  return (await ITEM_STATUS[action](uid)).item;
}

// ── A video's file, uploaded in parts (D561, `routes/learning_video.ts`) ──

function cancelledError() {
  const err = new Error('The upload was cancelled, so nothing was attached.');
  err.code = UPLOAD_CANCELLED;
  return err;
}

/**
 * Upload one file to a video item, through D561's four routes:
 *
 *   1. start     `POST …/items/:uid/video/uploads` with the type and size,
 *                which answers the key, the upload id and the part size;
 *   2. parts     `PUT …/video/uploads/part`, each `part_size` slice of the
 *                file in turn with its number, each answering its etag;
 *   3. complete  `POST …/video/uploads/complete` with every
 *                `{part_number, etag}`: the route checks the stored object's
 *                real size and type, attaches it and clears any link;
 *   4. abort     `POST …/video/uploads/abort`, on a cancel or on any failure
 *                after the start, so R2 is left holding no half-sent upload.
 *
 * A file the route would refuse is refused here before anything is sent. A
 * refusal is not caught: the error is the route's own, its sentence the
 * message, and the abort that follows it never replaces it. The key is passed
 * from one step to the next and never returned to the page.
 *
 *   onProgress({ sent, total, part, parts, step })  after the start and each part, and before completing
 *   isCancelled()                                   asked before each part and before completing
 *   signal                                          an AbortSignal: stops the part on its way, and
 *                                                   counts as cancelled from then on
 *
 * Resolves to `{ attached, item }`: the completion reply, and the item read
 * again as stored (null when that read fails, since the file is attached
 * either way).
 */
export async function uploadVideo({ uid, file, onProgress = () => {}, isCancelled = () => false, signal }) {
  const stopped = () => isCancelled() || Boolean(signal?.aborted);
  const problem = videoFileProblem(file);
  if (problem) throw new Error(problem);
  const total = file.size;
  const start = await adminLearningApi.startVideoUpload(uid, { content_type: videoTypeOf(file), size_bytes: total });
  const ref = { key: start?.key, upload_id: start?.upload_id };
  let attached;
  try {
    const partSize = Number(start?.part_size);
    if (typeof ref.key !== 'string' || !ref.key || typeof ref.upload_id !== 'string' || !ref.upload_id
      || !Number.isSafeInteger(partSize) || partSize <= 0 || partSize > VIDEO_UPLOAD.partMaxBytes) {
      throw new Error('The upload could not start: the reply came back in a shape this page cannot read.');
    }
    const parts = Math.ceil(total / partSize);
    const sent = [];
    onProgress({ sent: 0, total, part: 0, parts, step: 'parts' });
    for (let n = 1; n <= parts; n += 1) {
      if (stopped()) throw cancelledError();
      const end = Math.min(n * partSize, total);
      const reply = await adminLearningApi.uploadVideoPart(uid, { ...ref, part_number: n }, file.slice((n - 1) * partSize, end), { signal });
      if (typeof reply?.etag !== 'string' || !reply.etag) {
        throw new Error(`Part ${n} of ${parts} came back without its etag, so the upload cannot be finished.`);
      }
      sent.push({ part_number: n, etag: reply.etag });
      onProgress({ sent: end, total, part: n, parts, step: 'parts' });
    }
    if (stopped()) throw cancelledError();
    onProgress({ sent: total, total, part: parts, parts, step: 'complete' });
    attached = await adminLearningApi.completeVideoUpload(uid, { ...ref, parts: sent });
  } catch (err) {
    if (ref.key && ref.upload_id) {
      try { await adminLearningApi.abortVideoUpload(uid, ref); } catch { /* the route's sentence for the failure stands; R2 aborts an unfinished upload after seven days */ }
    }
    // A cancel that stopped the part on its way arrives as the fetch's abort: it is the cancel.
    throw stopped() ? cancelledError() : err;
  }
  let item = null;
  try { item = (await adminLearningApi.getItem(uid))?.item || null; } catch { /* attached either way; the editor draws the completion reply */ }
  return { attached, item };
}

// ── A video on Cloudflare Stream (#4177, L2 of #3726; `routes/learning_stream.ts`, D4176) ──

/**
 * The item's Stream videos (`GET …/items/:uid/stream`), as the editor holds
 * the read: `{ status: 'ready', data }`, or `{ status: 'unavailable' }` for the
 * 503 `stream_unavailable` the routes answer while Stream is off (the editor
 * then draws D561's R2 field). Any other failure is thrown: the editor draws
 * it as unreadable, never as "no video".
 */
export async function readStreamStatus(uid) {
  try {
    const data = await adminLearningApi.streamStatus(uid);
    if (!Array.isArray(data?.videos)) throw new Error('The video\'s Stream state came back in a shape this page cannot read.');
    return { status: 'ready', data };
  } catch (err) {
    if (err?.code === STREAM_UNAVAILABLE) return { status: 'unavailable', message: err.message };
    throw err;
  }
}

/**
 * The item's stored chapters, and the poster address for the thumbnail
 * picker. The studio's own item read does not send `chapters_json`, so they
 * come from the item read (`GET /api/learning/items/:uid`), which a Super
 * Admin may read for any status and which sends `chapters` and the signed
 * `video_stream`. Throws when the reply carries no chapters list.
 */
export async function readItemChapters(uid) {
  const item = (await learningApi.item(uid))?.item;
  if (!Array.isArray(item?.chapters)) throw new Error('The chapters came back in a shape this page cannot read.');
  return { chapters: item.chapters, poster_url: item.video_stream?.state === 'ready' ? item.video_stream.poster_url || null : null };
}

/** Save the chapters: `PATCH …/items/:uid` with `chapters` alone. Checked before anything is sent; resolves to what was saved. */
export async function saveChapters(uid, rows) {
  const chapters = chaptersBody(rows);
  await adminLearningApi.updateItem(uid, { chapters });
  return chapters;
}

export const generateCaptions = (uid, language) => adminLearningApi.generateCaptions(uid, language);
export const deleteCaptions = (uid, language) => adminLearningApi.deleteCaptions(uid, language);
export const setStreamThumbnail = (uid, pct) => adminLearningApi.setStreamThumbnail(uid, pct);

/** Upload a WebVTT file: read, checked (WebVTT only, at most 1 MB), then `PUT …/captions/:lang`. */
export async function uploadCaptionFile(uid, language, file) {
  const text = typeof file?.text === 'function' ? await file.text() : '';
  const problem = vttProblem(file, text);
  if (problem) throw new Error(problem);
  return adminLearningApi.uploadCaptions(uid, language, text);
}

function cancelledUpload() {
  const err = new Error('The upload was cancelled, so nothing was attached.');
  err.code = UPLOAD_CANCELLED;
  return err;
}

/**
 * The basic upload: the file as multipart `file` to Stream's one-time
 * `upload_url`, by XHR so its bytes report progress. The URL is Stream's and
 * carries no session: none of the page's headers is sent to it.
 */
export function postToStream(url, file, { onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//.test(String(url))) { reject(new Error('Stream did not give an upload link. Nothing was recorded.')); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { resolve(); return; }
      let said = '';
      try { said = JSON.parse(xhr.responseText)?.errors?.[0]?.message || ''; } catch { /* not JSON */ }
      reject(new Error(said ? `Stream did not take the file: ${said}` : `Stream did not take the file (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('The file could not reach Stream. Check the connection and try again.'));
    xhr.onabort = () => reject(cancelledUpload());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file, file.name || 'video');
    xhr.send(form);
  });
}

/** A tus failure in the route's own words: the Worker's refusal on the creation request, or the client's. */
export function tusFailure(err) {
  const res = err?.originalResponse;
  let body = null;
  try { body = JSON.parse(res?.getBody?.() || 'null'); } catch { /* not JSON */ }
  const { message, code } = readRefusal(body);
  const e = new Error(message || 'The resumable upload could not be finished.');
  if (code) e.code = code;
  const status = res?.getStatus?.();
  if (status) e.status = status;
  return e;
}

/**
 * The resumable upload, by `tus-js-client` (loaded only when a file over
 * 200 MB is chosen): the creation request goes to the Worker's tus route with
 * the session's headers, which answers Stream's one-time Location; every
 * chunk after it goes to Stream with none of them. Resolves to the video's
 * `stream_uid`, from the creation reply's `stream-media-id`.
 */
export async function tusToStream({ endpoint, file, onProgress = () => {}, signal }) {
  const { Upload } = await import('tus-js-client');
  return new Promise((resolve, reject) => {
    let streamUid = null;
    const ours = (url) => {
      try { return new URL(url, window.location.origin).origin === window.location.origin; } catch { return false; }
    };
    const upload = new Upload(file, {
      endpoint,
      chunkSize: STREAM_UPLOAD.tusChunkBytes,
      retryDelays: [0, 3000, 10000, 30000],
      metadata: { name: file.name || 'video' },
      storeFingerprintForResuming: false,
      onBeforeRequest: (req) => {
        if (req.getMethod() !== 'POST' || !ours(req.getURL())) return;
        for (const [k, v] of Object.entries(rawRequestHeaders('POST'))) req.setHeader(k, v);
      },
      onAfterResponse: (req, res) => {
        const id = res.getHeader('stream-media-id');
        if (id) streamUid = id;
      },
      onProgress: (sent, total) => onProgress(sent, total),
      onError: (err) => { const e = tusFailure(err); e.stream_uid = streamUid; reject(e); },
      onSuccess: () => resolve({ stream_uid: streamUid }),
    });
    signal?.addEventListener('abort', () => {
      upload.abort(false).catch(() => {}).finally(() => { const e = cancelledUpload(); e.stream_uid = streamUid; reject(e); });
    }, { once: true });
    upload.start();
  });
}

/**
 * Upload one file to the item's video on Stream. THE 200 MB SWITCH: up to
 * and including 200 MB, `POST …/stream/uploads` answers a one-time
 * `upload_url` and the file goes there by basic POST (`postFile`); above it,
 * the file goes by tus through `streamTusEndpoint(uid)` (`tusUpload`). A file
 * the route would refuse is refused before anything is sent. A cancel or a
 * failure after Stream made the video abandons it
 * (`POST …/stream/:streamUid/abandon`), and the refusal it stopped with is
 * thrown as it came. Resolves to `{ stream_uid, protocol }`; the video is then
 * processing, which the editor polls.
 *
 *   onProgress({ sent, total, protocol })
 *   signal       an AbortSignal: "Cancel upload"
 *   postFile, tusUpload   the two transports, replaceable in a test
 */
export async function uploadToStream({ uid, file, onProgress = () => {}, signal, postFile = postToStream, tusUpload = tusToStream }) {
  const problem = streamFileProblem(file);
  if (problem) throw new Error(problem);
  const total = file.size;
  const protocol = streamProtocolFor(total);
  const progress = (sent) => onProgress({ sent: Math.min(Number(sent) || 0, total), total, protocol });
  const abandon = async (streamUid) => {
    if (!streamUid) return;
    try { await adminLearningApi.abandonStreamUpload(uid, streamUid); } catch { /* the sentence it stopped with stands; the row expires */ }
  };
  progress(0);
  if (protocol === 'post') {
    const start = await adminLearningApi.startStreamUpload(uid, { size_bytes: total, content_type: streamTypeOf(file), name: file.name || undefined });
    if (typeof start?.stream_uid !== 'string' || typeof start?.upload_url !== 'string') {
      throw new Error('The upload could not start: the reply came back in a shape this page cannot read.');
    }
    try {
      if (signal?.aborted) throw cancelledUpload();
      await postFile(start.upload_url, file, { onProgress: progress, signal });
    } catch (err) {
      await abandon(start.stream_uid);
      throw signal?.aborted ? cancelledUpload() : err;
    }
    progress(total);
    return { stream_uid: start.stream_uid, protocol };
  }
  let made;
  try {
    made = await tusUpload({ endpoint: adminLearningApi.streamTusEndpoint(uid), file, onProgress: progress, signal });
  } catch (err) {
    await abandon(err?.stream_uid);
    throw signal?.aborted ? cancelledUpload() : err;
  }
  progress(total);
  return { stream_uid: made?.stream_uid ?? null, protocol };
}

/** A course form as the studio holds it. */
export function courseForm(course) {
  return {
    title: course?.title ?? '',
    slug: course?.slug ?? '',
    summary: course?.summary ?? '',
    cover_url: course?.cover_url ?? '',
    level: course?.level ?? '',
    estimated_minutes: course?.estimated_minutes === null || course?.estimated_minutes === undefined ? '' : String(course.estimated_minutes),
    visibility: course?.visibility ?? 'open',
    resources: Array.isArray(course?.resources) ? course.resources.map((r) => ({ title: r.title ?? '', url: r.url ?? '' })) : [],
    // D4650 (#4650, part 2): the course's metadata, as the form edits it (a list is one line per entry).
    audience: Array.isArray(course?.meta?.audience) ? [...course.meta.audience] : [],
    stage: course?.meta?.stage ?? '',
    outcomes: (course?.meta?.outcomes ?? []).join('\n'),
    prerequisites: (course?.meta?.prerequisites ?? []).join('\n'),
    author: course?.meta?.author ?? '',
    reviewer: course?.meta?.reviewer ?? '',
    reviewed_on: course?.meta?.reviewed_on ?? '',
    practical_output: course?.meta?.practical_output ?? '',
  };
}

const lines = (text) => String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/** The body `POST /courses` and `PATCH /courses/:uid` take. Blank resource rows are dropped. */
export function courseBody(form) {
  return {
    title: form.title,
    slug: form.slug,
    summary: form.summary,
    cover_url: form.cover_url,
    level: form.level || null,
    estimated_minutes: String(form.estimated_minutes ?? '').trim(),
    visibility: form.visibility || 'open',
    resources: (form.resources || [])
      .filter((r) => String(r.title || '').trim() || String(r.url || '').trim())
      .map((r) => ({ title: String(r.title || '').trim(), url: String(r.url || '').trim() })),
    audience: Array.isArray(form.audience) ? form.audience : [],
    stage: String(form.stage ?? '').trim() || null,
    outcomes: lines(form.outcomes),
    prerequisites: lines(form.prerequisites),
    author: String(form.author ?? '').trim() || null,
    reviewer: String(form.reviewer ?? '').trim() || null,
    reviewed_on: String(form.reviewed_on ?? '').trim() || null,
    practical_output: String(form.practical_output ?? '').trim() || null,
  };
}

/** Create a draft course or save one. Resolves to the course tree. */
export async function saveCourse({ uid, form }) {
  const body = courseBody(form);
  const reply = uid ? await adminLearningApi.updateCourse(uid, body) : await adminLearningApi.createCourse(body);
  return reply.course;
}

const COURSE_STATUS = {
  publish: (uid) => adminLearningApi.publishCourse(uid),
  unpublish: (uid) => adminLearningApi.unpublishCourse(uid),
  archive: (uid) => adminLearningApi.archiveCourse(uid),
};
export async function setCourseStatus(uid, action) {
  return (await COURSE_STATUS[action](uid)).course;
}

export async function addModule(courseUid, title) {
  return (await adminLearningApi.addModule(courseUid, { title })).course;
}

export async function renameModule(moduleUid, title) {
  return (await adminLearningApi.updateModule(moduleUid, { title })).course;
}

/** Move a module up or down: the route takes the complete new order. Null when it is already at that end. */
export async function moveModule(course, moduleUid, step) {
  const order = moveInOrder(byPosition(course.modules).map((m) => m.uid), moduleUid, step);
  if (!order) return null;
  return (await adminLearningApi.reorderModules(course.uid, order)).course;
}

export async function deleteModule(moduleUid) {
  return (await adminLearningApi.deleteModule(moduleUid)).course;
}

/** The body `POST /modules/:uid/lessons` takes. */
export function lessonBody(form) {
  return { kind: form.kind, title: form.title, ref_uid: form.ref_uid, required: form.required !== false };
}

export async function addLesson(moduleUid, form) {
  return (await adminLearningApi.addLesson(moduleUid, lessonBody(form))).course;
}

/** `PATCH /lessons/:uid` takes a title, what it opens and whether it counts; never its kind. */
export async function updateLesson(lessonUid, form) {
  return (await adminLearningApi.updateLesson(lessonUid, { title: form.title, ref_uid: form.ref_uid, required: form.required !== false })).course;
}

/** Move a lesson up or down within its module. Null when it is already at that end. */
export async function moveLesson(module, lessonUid, step) {
  const order = moveInOrder(byPosition(module.lessons).map((l) => l.uid), lessonUid, step);
  if (!order) return null;
  return (await adminLearningApi.reorderLessons(module.uid, order)).course;
}

export async function deleteLesson(lessonUid) {
  return (await adminLearningApi.deleteLesson(lessonUid)).course;
}

/** #3935 (LE8): a saved course's drawn cover: one quote for the draw and its checks, then the draw. The builder's form keeps the URL until Save. */
export const courseCoverQuote = (uid, prompt) => adminLearningApi.courseCoverQuote(uid, prompt);
export const courseCoverDraw = (uid, prompt) => adminLearningApi.courseCoverDraw(uid, prompt);
