// D578 — a startup's SAFEs: the terms recorded per investor, and each one's
// status read from its e-sign envelope. Sending is refused until the
// counsel-approved SAFE text is registered. Worker: routes/safe_issuances.ts.
import { request } from '../api.js';

export const safeIssuancesApi = {
  list: (projectId) => request(`/safe-issuances/project/${encodeURIComponent(projectId)}`),
  record: (projectId, body) => request(`/safe-issuances/project/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  send: (uid) => request(`/safe-issuances/${encodeURIComponent(uid)}/send`, { method: 'POST' }),
};
