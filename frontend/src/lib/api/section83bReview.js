// D580 (#1207) — 83(b) operator review. An Axal admin is assigned to a
// startup and checks its 83(b) filing record; it is not tax or legal advice
// and gates nothing. Worker: routes/admin_83b_review.ts (HQ writes) and
// routes/legal_83b.ts `GET /83b/operator-review` (the founder's read).
import { request } from '../api.js';

export const section83bReviewApi = {
  // The founder's own startup (owner or co-founder); 404 for anyone else.
  read: (projectId) => request(`/legal/83b/operator-review?project_id=${encodeURIComponent(projectId)}`),
  // HQ: every startup with a tracker, and the admins an operator is chosen from.
  // D946: scope 'lab' keeps only Lab ventures (SL10's switch); omitted, every startup.
  adminList: (scope) => request(`/admin/83b-review${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  adminAssign: (projectId, operatorUserId) => request(`/admin/83b-review/projects/${encodeURIComponent(projectId)}/operator`, {
    method: 'PUT',
    body: JSON.stringify({ operator_user_id: operatorUserId }),
  }),
  adminReview: (projectId, body) => request(`/admin/83b-review/projects/${encodeURIComponent(projectId)}/reviews`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
};
