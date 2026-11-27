import { request } from '../api.js';

/**
 * D961 (#2794): the client for part 1's catalogue read (D954 §3), which part 1
 * added on the Worker with no client. `routes/admin_programs.ts`, computed in
 * `services/programCatalogue.ts`.
 *
 * `catalogue({ weeks, scope })` → `GET /api/admin/programs?weeks=4|12|52&scope=`:
 * counts only, each block `{ available: true, … }`, `{ available: false,
 * unreadable: true, reason }`, `{ recorded: false, reason }` or
 * `{ available: false, pending: true, reason }`. `weeks` defaults to 12 on the
 * Worker; `scope` is a subsidiary's code, read through the fan-out, for a
 * Super Admin on HQ only (403 `hq_only` otherwise).
 */
export const adminProgramsApi = {
  catalogue: ({ weeks, scope } = {}) => {
    const q = new URLSearchParams();
    if (weeks) q.set('weeks', String(weeks));
    if (scope) q.set('scope', String(scope));
    return request(`/admin/programs${q.size ? `?${q}` : ''}`);
  },
};
