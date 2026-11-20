// D6868 (#6868) — an investor's rights in a company they hold (pro rata, information rights, board and observer
// seats, liquidation preference, anti-dilution), each with its document and clause, and the investor's requests
// that HQ record one. Worker: routes/portfolio_rights.ts (/api/portfolio-rights).
import { request } from '../api.js';

export const portfolioRightsApi = {
  // An investor: the six rights in order, each recorded or not, and their own requests. An admin: every holder's.
  company: (projectUid) => request(`/portfolio-rights/${encodeURIComponent(projectUid)}`),
  // { project_uid, type, description }. 409 `request_open` carries the open one.
  ask: ({ projectUid, type, description }) => request('/portfolio-rights/requests', {
    method: 'POST',
    body: JSON.stringify({ project_uid: projectUid, type, description }),
  }),
  // Admin: record or correct one holder's right; `requestUid` answers that open request as recorded.
  record: (projectUid, holderId, type, { documentTitle, clause, terms, signedOn, requestUid } = {}) => request(
    `/portfolio-rights/${encodeURIComponent(projectUid)}/holders/${encodeURIComponent(holderId)}/${encodeURIComponent(type)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ document_title: documentTitle, clause: clause ?? null, terms, signed_on: signedOn ?? null, request_uid: requestUid ?? null }),
    },
  ),
  // Admin: decline an open request with a reason the investor reads.
  decline: (uid, note) => request(`/portfolio-rights/requests/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'declined', note }),
  }),
};
