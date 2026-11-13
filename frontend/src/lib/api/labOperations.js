import { request } from '../api.js';

const PROGRAM_KEY = 'spinout-lab';

/** D971: Lab operations. Each method has a mounted Worker route. */
export const labOperationsApi = {
  playbook: () => request(`/admin/programs/${PROGRAM_KEY}`),
  editSection: (key, body) => request(`/admin/programs/${PROGRAM_KEY}/playbook/sections/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
  // D4806: the revision of the draft that was reviewed (`draft.hash`).
  publish: (expectedHash) => request(`/admin/programs/${PROGRAM_KEY}/playbook/publish`, { method: 'POST', body: JSON.stringify({ expected_hash: expectedHash }) }),
  capacity: (cohort) => request(`/admin/cohort/cohorts/${encodeURIComponent(cohort)}/capacity`),
  settings: () => request('/admin/cohort/settings'),
  setSize: (body) => request('/admin/cohort/applications/settings', { method: 'POST', body: JSON.stringify(body) }),
  activity: (params = {}) => {
    const q = new URLSearchParams();
    const { type, cohort, by, q: search, sort, limit, offset } = params;
    for (const [k, v] of Object.entries({ type, cohort, by, q: search, sort, limit, offset })) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    return request(`/admin/cohort/activity${q.size ? `?${q}` : ''}`);
  },
};
