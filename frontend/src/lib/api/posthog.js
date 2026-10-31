// D1385 (#3731, #2409 part 1) — "Your PostHog projects": the one PostHog
// project each venture reads. Worker: routes/posthog.ts.
//   /connectors/:uid/posthog-projects   the ventures, their links and the member's projects; link or unlink one
// Read only: nothing here writes to PostHog.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const posthogApi = {
  projects: (uid) => request(`/connectors/${enc(uid)}/posthog-projects`),
  /** { project_id, posthog_project_id } links one venture; `posthog_project_id: null` unlinks it. */
  setProject: (uid, projectId, posthogProjectId) => request(`/connectors/${enc(uid)}/posthog-projects`, {
    method: 'PUT', body: JSON.stringify({ project_id: projectId, posthog_project_id: posthogProjectId }),
  }),
};
