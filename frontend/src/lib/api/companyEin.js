// D579 — a startup's EIN, encrypted at rest. The founder, company editors and
// admins read it; an admin reads only the last four. `full` asks for the
// number itself, for a founder's own edit field. Worker: routes/company_ein.ts.
import { request } from '../api.js';

export const companyEinApi = {
  read: (projectId, { full = false } = {}) => request(`/company-ein/${encodeURIComponent(projectId)}${full ? '?full=1' : ''}`),
  save: (projectId, ein) => request(`/company-ein/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify({ ein }),
  }),
};
