/**
 * D4813 (#4813, package 2): Cohorts guidance writes beyond post/answer/retire — save a draft, publish it, edit against a version, the edit history.
 *
 * The list, the first post and the PATCH keep their `api.js` names
 * (`listMyAdvisorCohortGuidance`, `postMyAdvisorCohortGuidance`,
 * `updateMyAdvisorGuidance`); this module adds the two new Worker routes and
 * names the calls the composer makes. A 409 carries `error.code ===
 * 'guidance_version_conflict'` and the row as it stands on `error.data.current`.
 */
import { request } from '../api.js';

export const cohortGuidanceApi = {
  list: (cycleId) => request(`/advisors/me/cohort/${encodeURIComponent(cycleId)}/guidance`),
  /** `{ title, body, week_number?, draft }` — a refused week is a 400 `guidance_week_invalid`. */
  create: (cycleId, data) => request(`/advisors/me/cohort/${encodeURIComponent(cycleId)}/guidance`, { method: 'POST', body: JSON.stringify(data) }),
  /** `{ title?, body?, week_number?, answer?, retired?, version }` — answers `{ ok, item }`. */
  update: (uid, data) => request(`/advisors/me/guidance/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  publish: (uid, version) => request(`/advisors/me/guidance/${encodeURIComponent(uid)}/publish`, { method: 'POST', body: JSON.stringify({ version }) }),
  history: (uid) => request(`/advisors/me/guidance/${encodeURIComponent(uid)}/history`),
};
