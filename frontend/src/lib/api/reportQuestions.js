// D6225 (#6225) — questions about a sent report. Worker:
// routes/report_questions.ts, at /api/report-questions.
//
// An investor who received a report asks about it and reads only their own
// thread; the founders read every thread on it and answer each question once.
// An admin or an advisor reads the threads and writes nothing, and a support
// session writes nothing (`can_ask` and `can_reply` false, `write_refusal`).
import { request } from '../api.js';

const onReport = (uid) => `/report-questions/reports/${encodeURIComponent(uid)}`;
const question = (uid) => `/report-questions/questions/${encodeURIComponent(uid)}`;

export const reportQuestionsApi = {
  /** {view: 'asker'|'team'|'read_only', can_ask, can_reply, write_refusal, limits, questions: [{uid, figure_key, body, asked_at, state, answer, asker?}]} */
  list: (reportUid) => request(onReport(reportUid)),
  /** {body, figure_key?} → {question} */
  ask: (reportUid, body, figureKey = null) => request(onReport(reportUid), { method: 'POST', body: JSON.stringify({ body, figure_key: figureKey || undefined }) }),
  /** {body} → {question}; once, by a founder. */
  reply: (questionUid, body) => request(`${question(questionUid)}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  /** The asker withdraws a question not yet answered. */
  withdraw: (questionUid) => request(`${question(questionUid)}/withdraw`, { method: 'POST', body: JSON.stringify({}) }),
};
