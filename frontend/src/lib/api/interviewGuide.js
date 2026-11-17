import { request } from '../api.js';

// D6008 (#6008) — the venture's interview guide, mounted by the Worker at
// `/api/cycles/validate/interview-guide`: the read (open hypotheses, unjudged
// themes, segments, the guide, labelled defaults), the whole-guide save with
// its version, Eadwyn's quoted draft and its Accept, and the copy on one interview.
const q = (projectId) => `project=${encodeURIComponent(projectId)}`;
const BASE = '/cycles/validate/interview-guide';

export const interviewGuideApi = {
  read: (projectId) => request(`${BASE}?${q(projectId)}`),
  save: (projectId, questions, version) => request(`${BASE}?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ questions, version }) }),
  quoteDraft: (projectId, segmentId) => request(`${BASE}/draft/quote?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ segment_id: segmentId ?? null }) }),
  draft: (projectId, segmentId, quote) => request(`${BASE}/draft?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ segment_id: segmentId ?? null, quote }) }),
  acceptDraft: (projectId, receipt, ids, edits, version) => request(`${BASE}/draft/accept?${q(projectId)}`, { method: 'POST', body: JSON.stringify({ receipt, ids, edits: edits || {}, version }) }),
  readCopy: (projectId, interviewId) => request(`${BASE}/copy/${encodeURIComponent(interviewId)}?${q(projectId)}`),
  takeCopy: (projectId, interviewId) => request(`${BASE}/copy/${encodeURIComponent(interviewId)}?${q(projectId)}`, { method: 'POST', body: JSON.stringify({}) }),
  markAsked: (projectId, interviewId, questionId, asked) => request(`${BASE}/copy/${encodeURIComponent(interviewId)}/asked?${q(projectId)}`, { method: 'PUT', body: JSON.stringify({ question_id: questionId, asked }) }),
};
