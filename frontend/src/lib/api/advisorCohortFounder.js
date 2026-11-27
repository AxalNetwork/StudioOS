/**
 * D4813 (#4813, package 4): one founder's detail and the selected cohort's outcomes, both behind the advisor's cohort assignment and the founder's opt-out.
 *
 * `detail` answers 404 `cohort_founder_not_visible` (`error.status === 404`)
 * for a founder who is not in the cohort or stopped sharing with this advisor;
 * the two are the same answer on purpose. `outcomes` is cohort-scoped only:
 * the programme's public figures stay on `spinoutLab`.
 */
import { request } from '../api.js';

export const cohortFounderApi = {
  detail: (cycleId, userId) => request(`/advisors/me/cohort/${encodeURIComponent(cycleId)}/founders/${encodeURIComponent(userId)}`),
  outcomes: (cycleId) => request(`/advisors/me/cohort/${encodeURIComponent(cycleId)}/outcomes`),
};
