// D4491 (#4491) — read-only Distribution Results; mounted Worker routes/grow_results.ts.
import { request } from '../api.js';

export const growResultsApi = {
  results: (project, { from, to } = {}) => {
    const q = new URLSearchParams({ project: String(project) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return request(`/grow/results?${q.toString()}`);
  },
};
