// D6693 (#6693) — the formation catalogue as a signed-in founder reads it, and
// HQ's switch to pause or resume one form. Worker: routes/formation_catalogue.ts
// (/api/formation/catalogue) and routes/admin_formation_catalogue.ts
// (/api/admin/formation/catalogue, Super Admin).
import { request } from '../api.js';

export const formationCatalogueApi = {
  // { version: { version, published_at } | null, forms: [{ key, label, jurisdiction, availability, facts, fees, quote }] }
  // availability: orderable | guided | information_only. Never a partner, a cost or HQ's notes.
  get: () => request('/formation/catalogue'),
  // Super Admin: { reason } is required; the change shows on the next read.
  pause: (formKey, reason) => request(`/admin/formation/catalogue/forms/${encodeURIComponent(formKey)}/pause`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
  resume: (formKey, reason) => request(`/admin/formation/catalogue/forms/${encodeURIComponent(formKey)}/resume`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
};
