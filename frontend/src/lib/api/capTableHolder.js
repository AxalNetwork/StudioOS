// D1022 (#2859) — the reads Overview's tool bar and the holder drawer need
// that no client carried yet:
//   GET /api/captable/access/:projectId/grants  (D1019) → who sees what, and
//       `can_change`, true for the venture's owner only (routes/captable_access.ts);
//   GET /api/captable/equity-plan?project_id=   (D1020) → one venture's pools
//       and grants with their vesting (routes/captable.ts).
import { request } from '../api.js';

export const capTableHolderApi = {
  grants: (projectId) => request(`/captable/access/${encodeURIComponent(projectId)}/grants`),
  equityPlan: (projectId) => request(`/captable/equity-plan?project_id=${encodeURIComponent(projectId)}`),
};
