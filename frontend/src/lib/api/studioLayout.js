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
  // `source` is 'saved' or 'default'; `revision` is the row's (null with none);
  // `dropped` is [{ key, title, reason: 'not_offered' | 'plan', plan }] (D1594).
  layout: (profile) => request(`/studio/layout${asked(profile)}`),
  // An ordered list of { key, size: '1/3' | '1/2' | 'full' }, at most 12, and
  // the `revision` the read gave (null when there was no row). A save from a
  // stale copy is 409 `stale_layout` with the current revision (D1594).
  saveLayout: (layout, expectedRevision, profile) => request(`/studio/layout${asked(profile)}`, {
    method: 'PUT', body: JSON.stringify({ layout, expected_revision: expectedRevision ?? null }),
  }),
  // Deletes the saved layout; answers the default.
  resetLayout: (profile) => request(`/studio/layout/reset${asked(profile)}`, { method: 'POST' }),
};
