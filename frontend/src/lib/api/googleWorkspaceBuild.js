// D1093 (#2958): Google Workspace on Build. Worker: routes/build_google.ts, at /api/cycles/build/google.
// "From Google" on Solution design and Product roadmap (GW3), the sync, and a spec Doc's Accept or Dismiss.
// The roadmap Sheet's column mapping is saved through `googleWorkspace.mapping` (GW4).
import { request } from '../api.js';

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
const base = '/cycles/build/google';

export const googleWorkspaceBuild = {
  // { files, proposals, roadmap }
  fromGoogle: (project) => request(`${base}?project=${encodeURIComponent(project)}`),
  // { files: [{ uid, module, name, state, error?, counts? }], totals }
  sync: (project) => post(`${base}/sync`, { project }),
  accept: (project, id) => post(`${base}/proposals/${encodeURIComponent(id)}/accept`, { project }),
  dismiss: (project, id) => post(`${base}/proposals/${encodeURIComponent(id)}/dismiss`, { project }),
};
