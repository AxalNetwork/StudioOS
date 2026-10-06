// D606 — the Super Admin's review queue (D544): feature requests and
// suggested tasks, each approved or declined with a typed reason of at least
// ten characters. Worker: routes/admin_ticket_reviews.ts, at
// /api/admin/ticket-reviews. Every route is the Super Admin's.
import { request } from '../api.js';

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });

export const ticketReviewsApi = {
  // { items, count, total }: the oldest 200 waiting, and how many wait in all.
  features: () => request('/admin/ticket-reviews/features'),
  // { items, count, total, audiences }
  tasks: () => request('/admin/ticket-reviews/tasks'),
  approveFeature: (ticketId, reason) => post(`/admin/ticket-reviews/features/${encodeURIComponent(ticketId)}/approve`, { reason }),
  declineFeature: (ticketId, reason) => post(`/admin/ticket-reviews/features/${encodeURIComponent(ticketId)}/decline`, { reason }),
  approveTask: (id, { audience, reason }) => post(`/admin/ticket-reviews/tasks/${encodeURIComponent(id)}/approve`, { audience, reason }),
  declineTask: (id, reason) => post(`/admin/ticket-reviews/tasks/${encodeURIComponent(id)}/decline`, { reason }),
};
