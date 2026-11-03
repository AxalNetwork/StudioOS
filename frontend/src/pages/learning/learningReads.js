/**
 * The Learning center's member reads and its two progress writes (D562).
 *
 *   articles.list            → GET  /api/articles                          (routes/articles.ts)
 *   publications.publicList  → GET  /api/market-intel-public/publications  (routes/market_intel_public.ts)
 *   eventsPublic.list        → GET  /api/public/events                     (routes/events_public.ts)
 *   learningApi.catalog      → GET  /api/learning/catalog                  (routes/learning.ts, D557)
 *   learningApi.course       → GET  /api/learning/courses/:slug
 *   learningApi.item         → GET  /api/learning/items/:uid
 *   learningApi.me           → GET  /api/learning/me
 *   learningApi.recordProgress → POST /api/learning/progress
 *   learningApi.exercises / exams / mySubmissions / myAttempts → GET /api/learning/exercises, /exams,
 *                              /me/submissions, /me/attempts (routes/learning_lists.ts, #4180)
 *
 * The Articles, Publications and Events tabs keep the three routes they were
 * built on: they send more per row than the catalog does (an event's own time
 * zone and place, an article's subtitle). All, Courses and Videos read the
 * catalog, and keep each source's state.
 *
 * A REPLY IN THE WRONG SHAPE IS A FAILED READ, NOT AN EMPTY ONE. Each read
 * throws when its list is missing, so the page says "could not be read"
 * rather than "nothing is published", the defect D332 fixed on My Events.
 */
import { articles, publications, eventsPublic } from '../../lib/api';
// D527: a domain module is imported from its own file, as research's are.
import { learningApi } from '../../lib/api/learning.js';
import {
  ALL_LIMIT, ARTICLES_PAGE_SIZE, EVENTS_PAGE_SIZE, articleRow, catalogRow, eventRow, examRow, exerciseRow, itemHref, myAttemptRows,
  mySubmissionRows, parseVtt, previewOf, publicationRow, statsTiles,
} from './learningModel';

function listOf(reply, key, what) {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
}

/** One page of published articles, newest first, with the route's own total. */
export async function readArticles({ q = '', page = 0 } = {}) {
  const offset = page * ARTICLES_PAGE_SIZE;
  const reply = await articles.list({ limit: ARTICLES_PAGE_SIZE, offset, q: q || undefined });
  const total = Number(reply?.total);
  return {
    rows: listOf(reply, 'items', 'The article list').map(articleRow),
    total: Number.isFinite(total) ? total : null,
    offset,
  };
}

/** Every published publication the public list serves (it caps itself at 100). */
export async function readPublications() {
  const reply = await publications.publicList();
  return { rows: listOf(reply, 'publications', 'The publication list').map(publicationRow) };
}

/** The next upcoming events, soonest first. The route sends no total. */
export async function readEvents({ q = '' } = {}) {
  const reply = await eventsPublic.list({ limit: EVENTS_PAGE_SIZE, offset: 0, q: q || undefined });
  return { rows: listOf(reply, 'events', 'The event list').map((e) => eventRow(e, eventsPublic.icsUrl)) };
}

/**
 * The federated catalog: every kind (All), or one kind a page at a time
 * (Courses, Videos). `sources` is the route's own per-kind state, kept whole.
 */
export async function readCatalog({ kind = null, q = '', offset = 0 } = {}) {
  const reply = await learningApi.catalog({ kind: kind || undefined, q: q || undefined, limit: ALL_LIMIT, offset: kind ? offset : undefined });
  const rows = listOf(reply, 'items', 'The catalogue').map(catalogRow);
  if (!reply.sources || typeof reply.sources !== 'object') throw new Error('The catalogue came back without its sources.');
  return { rows, sources: reply.sources, offset: kind ? offset : 0, kind };
}

/** A course with its modules, lessons and the caller's progress. A 404 is "no such course". */
export async function readCourse(slug) {
  const reply = await learningApi.course(slug);
  if (!reply?.course || !Array.isArray(reply.modules)) throw new Error('The course came back in a shape this page cannot read.');
  return { course: reply.course, modules: reply.modules, progress: reply.progress || null };
}

/** One video or reading, with its transcript state and the caller's progress. */
export async function readItem(uid) {
  const reply = await learningApi.item(uid);
  if (!reply?.item) throw new Error('The item came back in a shape this page cannot read.');
  return { item: reply.item, transcriptRecorded: reply.transcript_recorded === true, progress: reply.progress || null };
}

/**
 * #4178 (D4178): one ready caption of an item's Stream video, as timed cues
 * for the click-to-seek transcript. Throws when it cannot be read, so the
 * panel says so and shows the plain transcript instead of an empty list.
 */
export async function readItemCaption(uid, language) {
  const reply = await learningApi.itemCaption(uid, language);
  if (typeof reply?.vtt !== 'string') throw new Error('The caption came back in a shape this page cannot read.');
  return parseVtt(reply.vtt);
}

const previews = new Map();
/**
 * lr7: the hover preview of a video in the library, from the item read (which
 * signs it after its access check). Read once per video per page and kept for
 * 30 minutes, inside the signature's hour. Null when there is none; a read that
 * fails is also null, because a preview is decoration and never a claim.
 */
export async function readItemPreview(uid, now = Date.now()) {
  const key = String(uid || '');
  if (!key) return null;
  const hit = previews.get(key);
  if (hit && hit.until > now) return hit.url;
  let url = null;
  try { url = previewOf((await learningApi.item(key))?.item); } catch { url = null; }
  previews.set(key, { url, until: now + 30 * 60 * 1000 });
  return url;
}

/** Where a row of `GET /me` opens: a course, an item, or nowhere for a bare lesson. */
export function meRowHref(row) {
  if (row?.subject_kind === 'course') return row.course_slug ? `/learning/courses/${encodeURIComponent(row.course_slug)}` : null;
  if (row?.subject_kind === 'item') return itemHref({ kind: row.item_kind, uid: row.subject_uid });
  return null;
}

/** The caller's own record: what they have started and finished, each row with where it opens. */
export async function readMe() {
  const reply = await learningApi.me();
  const withHref = (rows) => rows.map((r) => ({ ...r, href: meRowHref(r) }));
  return {
    in_progress: withHref(listOf(reply, 'in_progress', 'Your learning record')),
    completed: withHref(listOf(reply, 'completed', 'Your learning record')),
  };
}

/**
 * "Mark complete" on a lesson. The route records the subject it is given and
 * nothing else, so the course's own row is written too, or the course would
 * never show as started or finished on My learning: after the lesson, the
 * course is read again and its row carries the server's own percent over
 * required lessons. Returns the fresh course.
 */
export async function markLessonComplete({ course, lessonUid, slug }) {
  await learningApi.recordProgress({ subject_kind: 'lesson', subject_uid: lessonUid, status: 'completed' });
  const fresh = await readCourse(slug || course.slug);
  const percent = fresh.progress?.percent;
  await learningApi.recordProgress({
    subject_kind: 'course',
    subject_uid: fresh.course.uid,
    status: percent === 100 ? 'completed' : 'started',
    ...(Number.isInteger(percent) ? { percent } : {}),
  });
  return fresh;
}

/** "Mark complete" on a standalone video or reading. Returns the stored progress row. */
export async function markItemComplete(uid) {
  const reply = await learningApi.recordProgress({ subject_kind: 'item', subject_uid: uid, status: 'completed' });
  return reply?.progress || null;
}

/**
 * D3726 LR4 — the player's resume position on a standalone video or a lesson's
 * item: `status: 'started'` with the second it reached (a completed item stays
 * completed, and the percent never goes backwards — the route's own rules).
 */
export async function recordItemPosition(uid, seconds, percent = null) {
  const reply = await learningApi.recordProgress({
    subject_kind: 'item',
    subject_uid: uid,
    status: 'started',
    position_seconds: seconds,
    ...(Number.isInteger(percent) ? { percent } : {}),
  });
  return reply?.progress || null;
}

/** #4180: one page of the exercises a member may open, with the route's total. */
export async function readExercises({ offset = 0 } = {}) {
  const reply = await learningApi.exercises({ limit: ALL_LIMIT, offset });
  return { rows: listOf(reply, 'items', 'The exercise list').map(exerciseRow), total: Number.isFinite(Number(reply.total)) ? Number(reply.total) : null, offset };
}

/** #4180: one page of the exams a member may open, with the route's total. */
export async function readExams({ offset = 0 } = {}) {
  const reply = await learningApi.exams({ limit: ALL_LIMIT, offset });
  return { rows: listOf(reply, 'items', 'The exam list').map(examRow), total: Number.isFinite(Number(reply.total)) ? Number(reply.total) : null, offset };
}

/** #4180: My learning's exercises, one row per exercise. */
export async function readMySubmissions() {
  return { rows: mySubmissionRows(listOf(await learningApi.mySubmissions(), 'submissions', 'Your submissions')) };
}

/** #4180: My learning's exam results, one row per exam. */
export async function readMyAttempts() {
  return { rows: myAttemptRows(listOf(await learningApi.myAttempts(), 'attempts', 'Your exam attempts')) };
}

/** D3726 LR1 (#4180's `GET /api/learning/me/stats`): the "Your progress" strip's four figures, "Not recorded" never 0. */
export async function readMyStats() {
  return { tiles: statsTiles(await learningApi.myStats()) };
}
