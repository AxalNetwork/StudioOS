/**
 * Webinars' reads and writes (D560, #1161), for the member and for the Super
 * Admin. One of the five files in this folder that call the client (the
 * README names them), and only through methods it declares:
 *
 *   learningApi.webinars(when)         → GET    /api/learning/webinars?when=upcoming|past
 *   learningApi.webinar(uid)           → GET    /api/learning/webinars/:uid
 *   learningApi.registerForWebinar     → POST   /api/learning/webinars/:uid/registration
 *   learningApi.unregisterFromWebinar  → DELETE /api/learning/webinars/:uid/registration
 *   learningApi.webinarIcsHref(uid)       the `.ics` link, for an <a href>
 *   adminLearningApi.listWebinars, getWebinar, createWebinar, updateWebinar,
 *     publishWebinar, unpublishWebinar, cancelWebinar, setWebinarRecording,
 *     recordAttendance                → /api/admin/learning/webinars…
 *
 * A REPLY IN THE WRONG SHAPE IS A FAILED READ, NOT AN EMPTY ONE, as in
 * `learningReads.js`. A refusal is not caught here: the error `request()`
 * throws carries the route's own sentence ("This webinar is full."), and the
 * page shows it as it came.
 */
// D527: each domain module from its own file, as `learningReads.js` imports them.
import { learningApi } from '../../lib/api/learning.js';
import { adminLearningApi } from '../../lib/api/adminLearning.js';
import { webinarBody, webinarRow } from './webinarModel';

function listOf(reply, key, what) {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw new Error(`${what} came back in a shape this page cannot read.`);
  return list;
}

/**
 * One list: `upcoming` (live ones included, soonest first) or `past` (newest
 * first, each with its recording). A list never carries a join link.
 */
export async function readWebinars(when = 'upcoming') {
  const reply = await learningApi.webinars(when);
  return { when, rows: listOf(reply, 'webinars', 'The webinar list').map((w) => webinarRow(w, learningApi.webinarIcsHref)) };
}

/**
 * One webinar for this member: the webinar (with `join_url` only inside its
 * window, for a registered member), their registration, the recording once it
 * has ended, and the `.ics` link. A 404 keeps its status, for "no such
 * webinar".
 */
export async function readWebinar(uid) {
  const reply = await learningApi.webinar(uid);
  if (!reply?.webinar || typeof reply.webinar !== 'object') throw new Error('The webinar came back in a shape this page cannot read.');
  return {
    webinar: reply.webinar,
    registration: reply.registration || null,
    recording: reply.recording ?? null,
    icsHref: learningApi.webinarIcsHref(reply.webinar.uid || uid),
  };
}

/**
 * Register, then read the webinar again. The route answers with the
 * registration alone; the seats and, inside the window, the join link come
 * from the read.
 */
export async function registerForWebinar(uid) {
  await learningApi.registerForWebinar(uid);
  return readWebinar(uid);
}

/** Cancel this member's registration, then read the webinar again. */
export async function cancelRegistration(uid) {
  await learningApi.unregisterFromWebinar(uid);
  return readWebinar(uid);
}

// ── The studio ──────────────────────────────────────────────────────────────

/** Every webinar, drafts and cancelled ones included, each with its `registered_count`. */
export async function readStudioWebinars() {
  return { rows: listOf(await adminLearningApi.listWebinars(), 'webinars', 'The webinar list') };
}

/** Every admin webinar route answers `{ webinar, registrations }`. */
function detailOf(reply) {
  if (!reply?.webinar || !Array.isArray(reply.registrations)) throw new Error('The webinar came back in a shape this page cannot read.');
  return { webinar: reply.webinar, registrations: reply.registrations };
}

/** One webinar with its registrations (each by name and uid, never by email). */
export async function readStudioWebinar(uid) {
  return detailOf(await adminLearningApi.getWebinar(uid));
}

/** Schedule a draft (no `uid`) or save one. Throws before sending on a time the page cannot read. */
export async function saveWebinar({ uid, form }) {
  const body = webinarBody(form);
  return detailOf(uid ? await adminLearningApi.updateWebinar(uid, body) : await adminLearningApi.createWebinar(body));
}

const STATUS = {
  publish: (uid) => adminLearningApi.publishWebinar(uid),
  unpublish: (uid) => adminLearningApi.unpublishWebinar(uid),
  cancel: (uid) => adminLearningApi.cancelWebinar(uid),
};
/** Publish, unpublish (back to draft) or cancel. */
export async function setWebinarStatus(uid, action) {
  return detailOf(await STATUS[action](uid));
}

/**
 * Attach a video item as the recording, or detach it with `itemUid` null. It
 * is sent as given: anything else is the route's to refuse, never a detach.
 */
export async function attachRecording(uid, itemUid) {
  return detailOf(await adminLearningApi.setWebinarRecording(uid, itemUid));
}

/** Record one registrant's attendance: true, false, or null for not recorded. */
export async function markAttendance(uid, userUid, attended) {
  return detailOf(await adminLearningApi.recordAttendance(uid, userUid, attended));
}
