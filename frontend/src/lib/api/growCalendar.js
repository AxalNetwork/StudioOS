/** D4489 — reads plans and changes their time; never sends. */
import { request } from '../api.js';
export const growCalendar = {
  pieces: (project, filters) => request(`/grow/calendar?${new URLSearchParams({ project: String(project), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null && v !== '')) })}`),
  time: (project, uid, planned_at_time) => request(`/grow/calendar/pieces/${encodeURIComponent(uid)}/time?${new URLSearchParams({ project: String(project) })}`, { method: 'PUT', body: JSON.stringify({ planned_at_time }) }),
};
