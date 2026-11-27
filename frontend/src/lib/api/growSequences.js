/** D4493 (#4493): Distribution outreach sequences; Worker routes/grow_sequences.ts. A due step becomes a draft; only the mail composer's pressed Send sends. */
import { request, refusalError } from '../api.js';
const base = '/grow/sequences';
const qs = (project) => `?project=${encodeURIComponent(String(project))}`;
const id = (v) => encodeURIComponent(String(v));
const write = (path, method, body) => request(base + path, { method, body: JSON.stringify(body) });
/** The recording is a binary read, with the bearer header as other file previews. */
async function recording(project, uid, position) {
  let token = null;
  try { token = localStorage.getItem('token'); } catch { /* storage blocked: the cookie still signs the read */ }
  const res = await fetch(`/api${base}/${id(uid)}/steps/${id(position)}/recording${qs(project)}`, { credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw await refusalError(res, 'The voice note could not be played.');
  return res.blob();
}
export const growSequencesApi = {
  list: (project) => request(base + qs(project)),
  create: (body) => write('', 'POST', body),
  get: (project, uid) => request(`${base}/${id(uid)}${qs(project)}`),
  update: (uid, body) => write(`/${id(uid)}`, 'PATCH', body),
  remove: (uid, project) => write(`/${id(uid)}`, 'DELETE', { project }),
  addStep: (uid, body) => write(`/${id(uid)}/steps`, 'POST', body),
  updateStep: (uid, position, body) => write(`/${id(uid)}/steps/${id(position)}`, 'PATCH', body),
  removeStep: (uid, position, project) => write(`/${id(uid)}/steps/${id(position)}`, 'DELETE', { project }),
  uploadRecording: (uid, position, { project, file, seconds }) => {
    const fd = new FormData();
    fd.append('project', String(project));
    fd.append('seconds', String(seconds));
    fd.append('file', file);
    return request(`${base}/${id(uid)}/steps/${id(position)}/recording`, { method: 'PUT', body: fd });
  },
  recording,
  enrol: (uid, body) => write(`/${id(uid)}/enrol`, 'POST', body),
  due: (project) => request(`${base}/due${qs(project)}`),
  draft: (enrolmentUid, project) => write(`/due/${id(enrolmentUid)}/draft`, 'POST', { project }),
};
