import { request } from '../api.js';

/** D547 — routes/research_sectors.ts, mounted at /api/research. */
export const researchSectorsApi = {
  list: () => request('/research/sectors'),
  get: (slug) => request(`/research/sectors/${encodeURIComponent(slug)}`),
};
