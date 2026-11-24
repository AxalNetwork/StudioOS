// D8260 (#8260, BD25) — Company creation's hand-offs: the filings and their proofs as CSV, and the
// company's stored papers preselected for the venture's data room. Company members only.
// Worker: routes/company_creation_handoffs.ts (`/cycles/build/company-creation/...`).
import { api, request } from '../api.js';

const q = (projectId) => `?project=${encodeURIComponent(String(projectId))}`;

export const companyCreationHandoffsApi = {
  /** The filings table with each proof's link, as a CSV download. */
  exportFilings: (projectId) => api._downloadCsv(`/cycles/build/company-creation/filings/export${q(projectId)}`, 'company-filings.csv'),
  /** The four papers: which are stored, which are already in the room, which are preselected. */
  dataRoomPapers: (projectId) => request(`/cycles/build/company-creation/data-room${q(projectId)}`),
  /** Copy the chosen papers into the venture's data room (under NDA, shared with nobody). */
  addToDataRoom: (projectId, kinds) => request(`/cycles/build/company-creation/data-room${q(projectId)}`, { method: 'POST', body: JSON.stringify({ kinds }) }),
};
