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
  // #4178 (D4178): one ready caption of the item's Stream video, for the player's timed transcript.
  //   itemCaption(uid, language) → { language, vtt }; 404 when not ready, 503 stream_captions_unavailable
  itemCaption: (uid, language) => request(`/learning/items/${encodeURIComponent(uid)}/captions/${encodeURIComponent(language)}`),
  // { subject_kind: 'item'|'lesson'|'course', subject_uid, status: 'started'|'completed', percent?, position_seconds? }
  recordProgress: (body) => request('/learning/progress', { method: 'POST', body: JSON.stringify(body) }),
  me: () => request('/learning/me'),

  // #4180 (D4180) — the list reads (routes/learning_lists.ts). Published and
  // visible only; a figure not recorded is null, never 0.
  //   exercises({ limit, offset }) → { items: [{ uid, title, submission_kind, where: { kind, title } | null, status, submitted_at, updated_at, href }], total, limit, offset }
  //   exams({ limit, offset })     → { items: [{ uid, title, where, question_count, time_limit_minutes, pass_mark_percent,
  //                                    attempts_left, attempts_used, best_score_percent, passed, updated_at, href }], total, limit, offset }
  //   mySubmissions()              → { submissions: [{ uid, status, feedback, submitted_at, reviewed_at, exercise: { uid, title, href } }] }
  //   myAttempts()                 → { attempts: [{ uid, started_at, submitted_at, score_percent, passed, timed_out, exam: { uid, title, pass_mark_percent, href } }] }
  //   myStats()                    → { month, courses_in_progress, lessons_completed_this_month, watch_seconds_this_month, exams: { passed, sat } }
  // The catalog also takes `max_minutes`, and a row found in a transcript carries `match: { in, snippet, at_seconds }`.
  exercises: (params) => request(`/learning/exercises${qs(params)}`),
  exams: (params) => request(`/learning/exams${qs(params)}`),
  mySubmissions: () => request('/learning/me/submissions'),
  myAttempts: () => request('/learning/me/attempts'),
  myStats: () => request('/learning/me/stats'),

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
