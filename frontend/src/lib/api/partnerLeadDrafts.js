// A lead's proposal draft on Pipeline · Leads: read, save (and edit), discard (D4838 part 10, #5936).
import { request } from '../api.js';

export const partnerLeadDraftsApi = {
  get: (needId) => request(`/partner/pipeline/leads/${encodeURIComponent(needId)}/draft`),
  save: (needId, draft) => request(`/partner/pipeline/leads/${encodeURIComponent(needId)}/draft`, { method: 'PUT', body: JSON.stringify(draft) }),
  discard: (needId) => request(`/partner/pipeline/leads/${encodeURIComponent(needId)}/draft`, { method: 'DELETE' }),
};
