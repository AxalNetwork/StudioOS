// D601 — HQ records a paid formation order's packet and its state filing, by
// hand (the owner's answer 1A on #998). Worker: routes/admin_incorporations.ts.
import { request } from '../api.js';

export const adminIncorporationsApi = {
  list: () => request('/admin/incorporations'),
  packetReady: (id, documentId) => request(`/admin/incorporations/${encodeURIComponent(id)}/packet-ready`, {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId }),
  }),
  filed: (id, filedOn) => request(`/admin/incorporations/${encodeURIComponent(id)}/filed`, {
    method: 'POST',
    body: JSON.stringify({ filed_on: filedOn }),
  }),
};
