// D1040 — HQ's approvals inbox: every waiting item oldest first with its
// assignee, the tiles, and assignment and history. It reads and never decides.
// D1132 — the inbox's search, filters and sort (`q`, `lane`, `group`, `age`,
// `assigned`, `sort`; empty ones left out), and one item for its address.
// Worker: routes/admin_approvals.ts.
import { request } from '../api.js';

const INBOX_KEYS = ['q', 'lane', 'group', 'age', 'assigned', 'sort'];

export const adminApprovalsApi = {
  inbox: (page = 1, filters = {}) => {
    const qs = new URLSearchParams();
    for (const k of INBOX_KEYS) {
      const v = filters?.[k];
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const rest = qs.toString();
    return request(`/admin/approvals?page=${encodeURIComponent(page)}${rest ? `&${rest}` : ''}`);
  },
  item: (lane, itemId) => request(`/admin/approvals/items/${encodeURIComponent(lane)}/${encodeURIComponent(itemId)}`),
  history: (lane, itemId) => request(
    `/admin/approvals/history?lane=${encodeURIComponent(lane)}&item_id=${encodeURIComponent(itemId)}`,
  ),
  assign: (assigneeUserId, items) => request('/admin/approvals/assignments', {
    method: 'POST',
    body: JSON.stringify({ assignee_user_id: assigneeUserId, items }),
  }),
};
