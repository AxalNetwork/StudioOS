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
import { byPosition, formatLength, moveInOrder, parseLength } from './learningModel';
import { UPLOAD_CANCELLED, VIDEO_UPLOAD, videoFileProblem, videoTypeOf } from './videoUpload';

const listOf = (reply, key, what) => {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
};

/** Every item, drafts and archived included. */
export async function readStudioItems() {
  return { rows: listOf(await adminLearningApi.listItems(), 'items', 'The item list') };
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
 * first. `programs` is null on every row: no program store exists until
 * #1159, so that column is "Not recorded" rather than "None".
 */
export function studioRows(items, courses) {
  const enc = encodeURIComponent;
  return [
    ...(items || []).map((i) => ({
      kind: i.kind, uid: i.uid, title: i.title, status: i.status, visibility: i.visibility, programs: null,
      updated_at: i.updated_at, href: `/learning/studio?item=${enc(i.uid)}`,
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
 *
 * Resolves to `{ attached, item }`: the completion reply, and the item read
 * again as stored (null when that read fails, since the file is attached
 * either way).
 */
export async function uploadVideo({ uid, file, onProgress = () => {}, isCancelled = () => false }) {
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
      if (isCancelled()) throw cancelledError();
      const end = Math.min(n * partSize, total);
      const reply = await adminLearningApi.uploadVideoPart(uid, { ...ref, part_number: n }, file.slice((n - 1) * partSize, end));
      if (typeof reply?.etag !== 'string' || !reply.etag) {
        throw new Error(`Part ${n} of ${parts} came back without its etag, so the upload cannot be finished.`);
      }
      sent.push({ part_number: n, etag: reply.etag });
      onProgress({ sent: end, total, part: n, parts, step: 'parts' });
    }
    if (isCancelled()) throw cancelledError();
    onProgress({ sent: total, total, part: parts, parts, step: 'complete' });
    attached = await adminLearningApi.completeVideoUpload(uid, { ...ref, parts: sent });
  } catch (err) {
    if (ref.key && ref.upload_id) {
      try { await adminLearningApi.abortVideoUpload(uid, ref); } catch { /* the route's sentence for the failure stands; R2 aborts an unfinished upload after seven days */ }
    }
    throw err;
  }
  let item = null;
  try { item = (await adminLearningApi.getItem(uid))?.item || null; } catch { /* attached either way; the editor draws the completion reply */ }
  return { attached, item };
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
  };
}

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
