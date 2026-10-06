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
