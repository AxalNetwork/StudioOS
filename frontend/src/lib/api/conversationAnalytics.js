// D858 (#2503) — what a founder's customer conversations show, as data points:
// one session's figures, or a venture's chats over a date range (aggregates
// only). Each figure is `{ value, sources, reason }`; a null value carries its
// reason. Read only. Worker: routes/validate_conversations.ts.
// D866 (#2512): both take an optional `channel` (`telegram`, `whatsapp`,
// `recorder`, …); a venture's read also answers its figures per channel.
import { request } from '../api.js';

export const conversationAnalyticsApi = {
  /** One session's figures, with its quotes per theme where consent allows. */
  session: (sessionId, { channel } = {}) => {
    const q = channel ? `?${new URLSearchParams({ channel })}` : '';
    return request(`/validate/sessions/${encodeURIComponent(sessionId)}/analytics${q}`);
  },
  /** A venture's chats; `from` and `to` are optional `YYYY-MM-DD` days. */
  venture: ({ projectId, from, to, channel } = {}) => {
    const q = new URLSearchParams({ project_id: String(projectId) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (channel) q.set('channel', channel);
    return request(`/validate/conversations/analytics?${q}`);
  },
};
