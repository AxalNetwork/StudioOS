// D557 — authoring the Learning center: items, courses, modules and lessons;
// D559's exercises and exams, D558's programs. Super Admin only. Worker:
// routes/admin_learning*.ts, mounted at /api/admin/learning.
import { request } from '../api.js';

const enc = encodeURIComponent;
const body = (b) => JSON.stringify(b ?? {});

export const adminLearningApi = {
  listItems: () => request('/admin/learning/items'),
  createItem: (b) => request('/admin/learning/items', { method: 'POST', body: body(b) }),
  getItem: (uid) => request(`/admin/learning/items/${enc(uid)}`),
  updateItem: (uid, b) => request(`/admin/learning/items/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  publishItem: (uid) => request(`/admin/learning/items/${enc(uid)}/publish`, { method: 'POST' }),
  unpublishItem: (uid) => request(`/admin/learning/items/${enc(uid)}/unpublish`, { method: 'POST' }),
  archiveItem: (uid) => request(`/admin/learning/items/${enc(uid)}/archive`, { method: 'POST' }),

  // D561 — upload a video to R2 in parts (routes/learning_video.ts). Start
  // with the type and size; send each Blob slice of `part_size` with its
  // number; complete with every {part_number, etag}; or abort.
  startVideoUpload: (uid, b) => request(`/admin/learning/items/${enc(uid)}/video/uploads`, { method: 'POST', body: body(b) }),
  uploadVideoPart: (uid, { key, upload_id, part_number }, blob) => request(
    `/admin/learning/items/${enc(uid)}/video/uploads/part?key=${enc(key)}&upload_id=${enc(upload_id)}&part_number=${enc(part_number)}`,
    { method: 'PUT', body: blob, headers: { 'Content-Type': 'application/octet-stream' } },
  ),
  completeVideoUpload: (uid, b) => request(`/admin/learning/items/${enc(uid)}/video/uploads/complete`, { method: 'POST', body: body(b) }),
  abortVideoUpload: (uid, b) => request(`/admin/learning/items/${enc(uid)}/video/uploads/abort`, { method: 'POST', body: body(b) }),

  listCourses: () => request('/admin/learning/courses'),
  createCourse: (b) => request('/admin/learning/courses', { method: 'POST', body: body(b) }),
  getCourse: (uid) => request(`/admin/learning/courses/${enc(uid)}`),
  updateCourse: (uid, b) => request(`/admin/learning/courses/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  publishCourse: (uid) => request(`/admin/learning/courses/${enc(uid)}/publish`, { method: 'POST' }),
  unpublishCourse: (uid) => request(`/admin/learning/courses/${enc(uid)}/unpublish`, { method: 'POST' }),
  archiveCourse: (uid) => request(`/admin/learning/courses/${enc(uid)}/archive`, { method: 'POST' }),

  addModule: (courseUid, b) => request(`/admin/learning/courses/${enc(courseUid)}/modules`, { method: 'POST', body: body(b) }),
  reorderModules: (courseUid, order) => request(`/admin/learning/courses/${enc(courseUid)}/modules/order`, { method: 'POST', body: body({ order }) }),
  updateModule: (uid, b) => request(`/admin/learning/modules/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  deleteModule: (uid) => request(`/admin/learning/modules/${enc(uid)}`, { method: 'DELETE' }),

  addLesson: (moduleUid, b) => request(`/admin/learning/modules/${enc(moduleUid)}/lessons`, { method: 'POST', body: body(b) }),
  reorderLessons: (moduleUid, order) => request(`/admin/learning/modules/${enc(moduleUid)}/lessons/order`, { method: 'POST', body: body({ order }) }),
  updateLesson: (uid, b) => request(`/admin/learning/lessons/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  deleteLesson: (uid) => request(`/admin/learning/lessons/${enc(uid)}`, { method: 'DELETE' }),

  // D559 — exercises, exams and reviews.
  listExercises: () => request('/admin/learning/exercises'),
  createExercise: (b) => request('/admin/learning/exercises', { method: 'POST', body: body(b) }),
  getExercise: (uid) => request(`/admin/learning/exercises/${enc(uid)}`),
  updateExercise: (uid, b) => request(`/admin/learning/exercises/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  publishExercise: (uid) => request(`/admin/learning/exercises/${enc(uid)}/publish`, { method: 'POST' }),
  unpublishExercise: (uid) => request(`/admin/learning/exercises/${enc(uid)}/unpublish`, { method: 'POST' }),
  archiveExercise: (uid) => request(`/admin/learning/exercises/${enc(uid)}/archive`, { method: 'POST' }),
  // { status: 'accepted' | 'needs_work', feedback }
  reviewSubmission: (uid, b) => request(`/admin/learning/submissions/${enc(uid)}/review`, { method: 'POST', body: body(b) }),

  listExams: () => request('/admin/learning/exams'),
  createExam: (b) => request('/admin/learning/exams', { method: 'POST', body: body(b) }),
  getExam: (uid) => request(`/admin/learning/exams/${enc(uid)}`),
  updateExam: (uid, b) => request(`/admin/learning/exams/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  publishExam: (uid) => request(`/admin/learning/exams/${enc(uid)}/publish`, { method: 'POST' }),
  unpublishExam: (uid) => request(`/admin/learning/exams/${enc(uid)}/unpublish`, { method: 'POST' }),
  archiveExam: (uid) => request(`/admin/learning/exams/${enc(uid)}/archive`, { method: 'POST' }),
  addQuestion: (examUid, b) => request(`/admin/learning/exams/${enc(examUid)}/questions`, { method: 'POST', body: body(b) }),
  updateQuestion: (uid, b) => request(`/admin/learning/questions/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  deleteQuestion: (uid) => request(`/admin/learning/questions/${enc(uid)}`, { method: 'DELETE' }),

  // D558 — programs: contents, assigned admins and enrolments.
  listPrograms: () => request('/admin/learning/programs'),
  createProgram: (b) => request('/admin/learning/programs', { method: 'POST', body: body(b) }),
  getProgram: (uid) => request(`/admin/learning/programs/${enc(uid)}`),
  // name, region, description, enrolment ('invite'|'open'), status ('draft'|'published'|'archived')
  updateProgram: (uid, b) => request(`/admin/learning/programs/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  // The full ordered list: [{ subject_kind: 'course'|'item'|'exam'|'exercise', subject_uid }].
  setProgramContents: (uid, contents) => request(`/admin/learning/programs/${enc(uid)}/contents`, { method: 'PUT', body: body({ contents }) }),
  assignProgramAdmin: (uid, userUid) => request(`/admin/learning/programs/${enc(uid)}/admins`, { method: 'POST', body: body({ user_uid: userUid }) }),
  unassignProgramAdmin: (uid, userUid) => request(`/admin/learning/programs/${enc(uid)}/admins/${enc(userUid)}`, { method: 'DELETE' }),
  enrolInProgram: (uid, userUid) => request(`/admin/learning/programs/${enc(uid)}/enrollments`, { method: 'POST', body: body({ user_uid: userUid }) }),
  unenrolFromProgram: (uid, userUid) => request(`/admin/learning/programs/${enc(uid)}/enrollments/${enc(userUid)}`, { method: 'DELETE' }),

  // D560 — webinars.
  listWebinars: () => request('/admin/learning/webinars'),
  createWebinar: (b) => request('/admin/learning/webinars', { method: 'POST', body: body(b) }),
  getWebinar: (uid) => request(`/admin/learning/webinars/${enc(uid)}`),
  updateWebinar: (uid, b) => request(`/admin/learning/webinars/${enc(uid)}`, { method: 'PATCH', body: body(b) }),
  publishWebinar: (uid) => request(`/admin/learning/webinars/${enc(uid)}/publish`, { method: 'POST' }),
  unpublishWebinar: (uid) => request(`/admin/learning/webinars/${enc(uid)}/unpublish`, { method: 'POST' }),
  cancelWebinar: (uid) => request(`/admin/learning/webinars/${enc(uid)}/cancel`, { method: 'POST' }),
  // itemUid: a video item's uid, or null to detach.
  setWebinarRecording: (uid, itemUid) => request(`/admin/learning/webinars/${enc(uid)}/recording`, { method: 'PUT', body: body({ item_uid: itemUid }) }),
  recordAttendance: (uid, userUid, attended) => request(`/admin/learning/webinars/${enc(uid)}/registrations/${enc(userUid)}`, { method: 'PATCH', body: body({ attended }) }),
};
