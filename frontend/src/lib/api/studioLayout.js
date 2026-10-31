// D1421 (#3699) — the Studio's module catalogue and the member's saved layout.
// Worker: routes/studio_layout.ts, mounted at /api/studio. `profile` is for an
// admin previewing one Studio; a member's own role names theirs, so it is sent
// only when given.
import { request } from '../api.js';

const asked = (profile) => (profile ? `?profile=${encodeURIComponent(profile)}` : '');

export const studioLayoutApi = {
  // Each module this Studio may place: key, title, group, default_size,
  // cohort_only, locked_by_plan and the plan that unlocks it.
  modules: (profile) => request(`/studio/modules${asked(profile)}`),
  // `source` is 'saved' or 'default'; `dropped` names saved keys no longer offered.
  layout: (profile) => request(`/studio/layout${asked(profile)}`),
  // An ordered list of { key, size: '1/3' | '1/2' | 'full' }, at most 12.
  saveLayout: (layout, profile) => request(`/studio/layout${asked(profile)}`, {
    method: 'PUT', body: JSON.stringify({ layout }),
  }),
  // Deletes the saved layout; answers the default.
  resetLayout: (profile) => request(`/studio/layout/reset${asked(profile)}`, { method: 'POST' }),
};
