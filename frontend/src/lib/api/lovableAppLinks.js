// D1083 (#2948): the founder's Lovable app address on an experiment or on Prototype / MVP.
// PUT    /api/cycles/:cycle/lovable/app-link?project=        { record_id?, app_url }
// DELETE /api/cycles/:cycle/lovable/app-link?project=&record_id=
// POST   /api/cycles/:cycle/lovable/app-link/:uid/check?project=   (Check now; the only fetch)
// `cycle` is 'validate' (record_id: the experiment's id) or 'build' (no record_id).
// D1312 (#3432), Validate only: an experiment's sign-up address for its Lovable page's form.
// POST   /api/cycles/validate/lovable/signup-token?project=   { record_id }  → 201 { signup }
// DELETE /api/cycles/validate/lovable/signup-token?project=&record_id=       → { signup: null }
import { request } from '../api.js';
const base = (cycle) => `/cycles/${encodeURIComponent(cycle)}/lovable/app-link`;
const signupBase = (cycle = 'validate') => `/cycles/${encodeURIComponent(cycle)}/lovable/signup-token`;
export const lovableAppLinksApi = {
  link: (cycle, project, recordId, appUrl) => request(`${base(cycle)}?project=${encodeURIComponent(project)}`,
    { method: 'PUT', body: JSON.stringify(recordId == null ? { app_url: appUrl } : { record_id: recordId, app_url: appUrl }) }),
  unlink: (cycle, project, recordId) => request(`${base(cycle)}?${new URLSearchParams({ project: String(project), ...(recordId == null ? {} : { record_id: String(recordId) }) })}`,
    { method: 'DELETE' }),
  makeSignup: (project, recordId) => request(`${signupBase()}?project=${encodeURIComponent(project)}`,
    { method: 'POST', body: JSON.stringify({ record_id: recordId }) }),
  turnOffSignup: (project, recordId) => request(`${signupBase()}?${new URLSearchParams({ project: String(project), record_id: String(recordId) })}`,
    { method: 'DELETE' }),
  check: (cycle, project, uid) => request(`${base(cycle)}/${encodeURIComponent(uid)}/check?project=${encodeURIComponent(project)}`,
    { method: 'POST', body: '{}' }),
};
