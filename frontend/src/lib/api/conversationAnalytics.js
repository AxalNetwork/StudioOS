// D858 (#2503) — what a founder's customer conversations show, as data points:
// one session's figures, or a venture's chats over a date range (aggregates
// only). Each figure is `{ value, sources, reason }`; a null value carries its
// reason. Read only. Worker: routes/validate_conversations.ts.
import { request } from '../api.js';

export const conversationAnalyticsApi = {
  /** One session's figures, with its quotes per theme where consent allows. */
  session: (sessionId) => request(`/validate/sessions/${encodeURIComponent(sessionId)}/analytics`),
  /** A venture's chats; `from` and `to` are optional `YYYY-MM-DD` days. */
  venture: ({ projectId, from, to } = {}) => {
    const q = new URLSearchParams({ project_id: String(projectId) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return request(`/validate/conversations/analytics?${q}`);
  },
};
