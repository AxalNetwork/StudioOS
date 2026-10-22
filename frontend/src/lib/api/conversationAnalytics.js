// D858 (#2503) — what a founder's customer conversations show, as data points:
// one session's figures, or a venture's chats, calls (D873) or both over a
// date range (aggregates only). Each figure is `{ value, sources, reason }`; a null value carries its
// reason. Read only. Worker: routes/validate_conversations.ts.
import { request } from '../api.js';

export const conversationAnalyticsApi = {
  /** One session's figures, with its quotes per theme where consent allows. */
  session: (sessionId) => request(`/validate/sessions/${encodeURIComponent(sessionId)}/analytics`),
  /** A venture's conversations; `from` and `to` are optional `YYYY-MM-DD` days, `kind` is chats (default), calls or all. */
  venture: ({ projectId, from, to, kind } = {}) => {
    const q = new URLSearchParams({ project_id: String(projectId) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (kind) q.set('kind', kind);
    return request(`/validate/conversations/analytics?${q}`);
  },
};
