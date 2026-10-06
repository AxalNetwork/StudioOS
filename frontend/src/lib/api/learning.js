// D557 — the Learning center, member side: the federated catalog, a course,
// an item, the caller's own progress and their learning record.
// Worker: routes/learning.ts, mounted at /api/learning.
import { request } from '../api.js';

const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const learningApi = {
  // `kind`, `q`, `topic`, `level`, `limit`, `offset`. Each source answers
  // alone: read `sources[kind].status` before reading its rows as "none".
  catalog: (params) => request(`/learning/catalog${qs(params)}`),
  course: (slug) => request(`/learning/courses/${encodeURIComponent(slug)}`),
  item: (uid) => request(`/learning/items/${encodeURIComponent(uid)}`),
  // { subject_kind: 'item'|'lesson'|'course', subject_uid, status: 'started'|'completed', percent?, position_seconds? }
  recordProgress: (body) => request('/learning/progress', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/learning/me'),

  // D559 — exercises and exams. No payload carries a correct answer before
  // the attempt is submitted and the exam's `reveal` allows it.
  exercise: (uid) => request(`/learning/exercises/${encodeURIComponent(uid)}`),
  // { body } for a text exercise, { checked: [index, …] } for a checklist.
  submitExercise: (uid, answer) => request(`/learning/exercises/${encodeURIComponent(uid)}/submissions`, { method: 'POST', body: JSON.stringify(answer) }),
  exam: (uid) => request(`/learning/exams/${encodeURIComponent(uid)}`),
  // Starts an attempt, or resumes the open one; returns its deadline and questions.
  startExam: (uid) => request(`/learning/exams/${encodeURIComponent(uid)}/attempts`, { method: 'POST' }),
  // answers: { [questionUid]: [optionIndex, …] }
  submitExam: (uid, attemptUid, answers) => request(`/learning/exams/${encodeURIComponent(uid)}/attempts/${encodeURIComponent(attemptUid)}/submit`, { method: 'POST', body: JSON.stringify({ answers }) }),
  examAttempts: (uid) => request(`/learning/exams/${encodeURIComponent(uid)}/attempts`),
  // Read-only review of learners' work, for whoever may review it (D559).
  reviewSubmissions: (exerciseUid) => request(`/learning/review/exercises/${encodeURIComponent(exerciseUid)}/submissions`),
  reviewAttempts: (examUid) => request(`/learning/review/exams/${encodeURIComponent(examUid)}/attempts`),

  // D558 — programs. A member lists the open ones and self-enrols into one;
  // an assigned admin follows their programs' learners, read-only.
  programs: () => request('/learning/programs'),
  myEnrolledPrograms: () => request('/learning/programs/enrolled'),
  program: (uid) => request(`/learning/programs/${encodeURIComponent(uid)}`),
  enrolInProgram: (uid) => request(`/learning/programs/${encodeURIComponent(uid)}/enrol`, { method: 'POST' }),
  assignedPrograms: () => request('/learning/programs/mine'),
  programLearners: (uid) => request(`/learning/programs/${encodeURIComponent(uid)}/learners`),
  programLearner: (uid, userUid) => request(`/learning/programs/${encodeURIComponent(uid)}/learners/${encodeURIComponent(userUid)}`),

  // D560 — webinars. `join_url` arrives only for a registered member, from 15
  // minutes before the start until the end; a list never carries it.
  webinars: (when = 'upcoming') => request(`/learning/webinars?when=${encodeURIComponent(when)}`),
  webinar: (uid) => request(`/learning/webinars/${encodeURIComponent(uid)}`),
  registerForWebinar: (uid) => request(`/learning/webinars/${encodeURIComponent(uid)}/registration`, { method: 'POST' }),
  unregisterFromWebinar: (uid) => request(`/learning/webinars/${encodeURIComponent(uid)}/registration`, { method: 'DELETE' }),
  // The .ics download, for an <a href>; the request carries the session cookie.
  webinarIcsHref: (uid) => `/api/learning/webinars/${encodeURIComponent(uid)}/calendar.ics`,
};
