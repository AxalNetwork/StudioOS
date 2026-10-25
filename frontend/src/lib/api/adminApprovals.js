// D1040 — HQ's approvals inbox: every waiting item oldest first with its
// assignee, the tiles, and assignment and history. It reads and never decides.
// Worker: routes/admin_approvals.ts.
import { request } from '../api.js';

export const adminApprovalsApi = {
  inbox: (page = 1) => request(`/admin/approvals?page=${encodeURIComponent(page)}`),
  history: (lane, itemId) => request(
    `/admin/approvals/history?lane=${encodeURIComponent(lane)}&item_id=${encodeURIComponent(itemId)}`,
  ),
  assign: (assigneeUserId, items) => request('/admin/approvals/assignments', {
    method: 'POST',
    body: JSON.stringify({ assignee_user_id: assigneeUserId, items }),
  }),
};
