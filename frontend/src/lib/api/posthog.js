// D1385 (#3731, #2409 part 1) — "Your PostHog projects": the one PostHog
// project each venture reads. Worker: routes/posthog.ts.
//   /connectors/:uid/posthog-projects   the ventures, their links and the member's projects; link or unlink one
//   /connectors/:uid/posthog-insights   D1604: the linked project's saved insights, for "Track a metric"
//   /cycles/:section/posthog…           D1604: a module's From PostHog, its tracked metrics, facts and proposals
// Read only: nothing here writes to PostHog.
import { request } from '../api.js';

const enc = encodeURIComponent;
const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const posthogApi = {
  projects: (uid) => request(`/connectors/${enc(uid)}/posthog-projects`),
  /** { project_id, posthog_project_id } links one venture; `posthog_project_id: null` unlinks it. */
  setProject: (uid, projectId, posthogProjectId) => request(`/connectors/${enc(uid)}/posthog-projects`, json('PUT', { project_id: projectId, posthog_project_id: posthogProjectId })),
  insights: (uid, projectId, q = '') => request(`/connectors/${enc(uid)}/posthog-insights?project=${enc(projectId)}${q ? `&q=${enc(q)}` : ''}`),
  fromPosthog: (section, projectId, module) => request(`/cycles/${enc(section)}/posthog?project=${enc(projectId)}&module=${enc(module)}`),
  track: (section, projectId, module, insightShortId, role) => request(`/cycles/${enc(section)}/posthog/tracked`, json('POST', { project: projectId, module, insight_short_id: insightShortId, role })),
  untrack: (section, projectId, uid) => request(`/cycles/${enc(section)}/posthog/tracked/${enc(uid)}?project=${enc(projectId)}`, { method: 'DELETE' }),
  deleteFact: (section, projectId, id) => request(`/cycles/${enc(section)}/posthog/facts/${enc(id)}?project=${enc(projectId)}`, { method: 'DELETE' }),
  accept: (section, projectId, id, extra = {}) => request(`/cycles/${enc(section)}/posthog/proposals/${enc(id)}/accept`, json('POST', { ...extra, project: projectId })),
  dismiss: (section, projectId, id) => request(`/cycles/${enc(section)}/posthog/proposals/${enc(id)}/dismiss`, json('POST', { project: projectId })),
};
