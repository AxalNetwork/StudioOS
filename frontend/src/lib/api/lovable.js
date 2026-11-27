import { request } from '../api.js';

/**
 * D1082 (#2947): Build in Lovable, on an experiment (Validate) and on
 * Prototype / MVP (Build). Each cycle mounts the same four routes
 * (`services/lovable/launch.ts`):
 *   draft(body)    { project_id, record } -> { prompt, prompt_chars, max, left_out, cut?, check, last_opened_at }
 *   check(body)    { project_id, prompt } -> { prompt_chars, check: { ok, line, findings } }
 *   launch(body)   { project_id, record, prompt } -> { url, handoff: { uid, opened_at } }
 *   launches(pid)  -> { launches: [{ record, opened_at, times }] }
 * The page opens `url` in a new tab; the Worker never calls Lovable.
 */
export const lovableApi = {
  validate: {
    draft: (body) => request('/cycles/validate/lovable/draft', { method: 'POST', body: JSON.stringify(body) }),
    check: (body) => request('/cycles/validate/lovable/check', { method: 'POST', body: JSON.stringify(body) }),
    launch: (body) => request('/cycles/validate/lovable/launch', { method: 'POST', body: JSON.stringify(body) }),
    launches: (projectId) => request(`/cycles/validate/lovable/launches?project=${encodeURIComponent(projectId)}`),
  },
  build: {
    draft: (body) => request('/cycles/build/lovable/draft', { method: 'POST', body: JSON.stringify(body) }),
    check: (body) => request('/cycles/build/lovable/check', { method: 'POST', body: JSON.stringify(body) }),
    launch: (body) => request('/cycles/build/lovable/launch', { method: 'POST', body: JSON.stringify(body) }),
    launches: (projectId) => request(`/cycles/build/lovable/launches?project=${encodeURIComponent(projectId)}`),
  },
};
