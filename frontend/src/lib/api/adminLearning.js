// D557 — authoring the Learning center: items, courses, modules and lessons.
// Super Admin only. Worker: routes/admin_learning.ts, mounted at
// /api/admin/learning.
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
};
