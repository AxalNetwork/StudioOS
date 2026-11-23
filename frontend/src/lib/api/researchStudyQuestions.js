// D7720 (#7720): questions with evidence and counts, and append-only study decisions.
import { request } from '../api.js';
const study = (uid) => `/research/projects/${encodeURIComponent(uid)}/study`;
const question = (uid, questionUid) => `${study(uid)}/questions/${encodeURIComponent(questionUid)}`;
const send = (method, body) => ({ method, body: JSON.stringify(body) });
export const researchStudyQuestionsApi = {
  list: (uid) => request(`${study(uid)}/questions`),
  create: (uid, body) => request(`${study(uid)}/questions`, send('POST', body)),
  update: (uid, questionUid, body) => request(question(uid, questionUid), send('PUT', body)),
  remove: (uid, questionUid, version) => request(question(uid, questionUid), send('DELETE', { version })),
  reorder: (uid, questions) => request(`${study(uid)}/questions/reorder`, send('POST', { questions })),
  addLink: (uid, questionUid, body) => request(`${question(uid, questionUid)}/links`, send('POST', body)),
  removeLink: (uid, questionUid, linkUid, version) => request(`${question(uid, questionUid)}/links/${encodeURIComponent(linkUid)}`, send('DELETE', { version })),
  decisions: (uid) => request(`${study(uid)}/decisions`),
  recordDecision: (uid, body) => request(`${study(uid)}/decisions`, send('POST', body)),
};
