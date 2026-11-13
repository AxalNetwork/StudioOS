// D603 — the Help Center's weekly guide views and yes/no answers. A guide is
// addressed by its anchor, `<area>/<guide>`. Worker: routes/help_center.ts.
import { request } from '../api.js';

const part = (anchor, i) => encodeURIComponent(String(anchor || '').split('/')[i] || '');

export const helpCenterApi = {
  // Counts once per member per guide per day; the reply says whether it did.
  recordView: (anchor) => request(`/help/guides/${part(anchor, 0)}/${part(anchor, 1)}/view`, { method: 'POST' }),
  popular: ({ days = 7, limit = 4 } = {}) =>
    request(`/help/popular?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`),
  myFeedback: (anchor) => request(`/help/guides/${part(anchor, 0)}/${part(anchor, 1)}/feedback`),
  // `missing` is sent only with a "no".
  saveFeedback: (anchor, answer, missing) => request(`/help/guides/${part(anchor, 0)}/${part(anchor, 1)}/feedback`, {
    method: 'PUT',
    body: JSON.stringify(answer === 'no' && missing ? { answer, missing } : { answer }),
  }),
  // Admin: per-guide yes/no counts and each "what was missing", no member identity.
  adminFeedback: () => request('/admin/help/feedback'),
};
