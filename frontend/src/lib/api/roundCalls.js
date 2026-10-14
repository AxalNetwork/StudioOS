import { request } from '../api.js';
const params = input => new URLSearchParams(Object.entries(input || {}).filter(([,value]) => value != null && value !== '')).toString();
export const roundCallsApi = {
  availability: () => request('/round-calls/availability'),
  context: projectId => request('/round-calls/context?' + params({project_id:projectId})),
  list: projectId => request('/round-calls?' + params({project_id:projectId})),
  page: uid => request(`/round-calls/${encodeURIComponent(uid)}`),
  create: body => request('/round-calls', {method:'POST',body:JSON.stringify(body)}),
  save: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}`, {method:'PUT',body:JSON.stringify(body)}),
  previewAudience: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/audience-preview`, {method:'POST',body:JSON.stringify(body)}),
  audience: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/audience`, {method:'PUT',body:JSON.stringify(body)}),
  send: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/send`, {method:'POST',body:JSON.stringify(body)}),
  respond: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/responses`, {method:'POST',body:JSON.stringify(body)}),
  manage: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/manage`, {method:'POST',body:JSON.stringify(body)}),
  answer: (uid,questionUid,answer) => request(`/round-calls/${encodeURIComponent(uid)}/questions/${encodeURIComponent(questionUid)}`, {method:'PUT',body:JSON.stringify({answer})}),
  requestCounsel: (uid,revision) => request(`/round-calls/${encodeURIComponent(uid)}/counsel-request`, {method:'POST',body:JSON.stringify({revision})}),
  counselQueue: () => request('/round-calls/counsel-queue'),
  counsel: (uid,body) => request(`/round-calls/${encodeURIComponent(uid)}/counsel-approval`, {method:'POST',body:JSON.stringify(body)}),
};
