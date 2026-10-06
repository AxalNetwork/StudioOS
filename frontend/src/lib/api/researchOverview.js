// D536 (#1082) — the Research overview: directory totals, the live heat grid,
// demand against supply, the competition, where the money is, and signals.
// Each section of the answer carries `status` ('ok' | 'not_recorded' |
// 'unreadable') and, when not ok, the `reason` a screen shows.
import { request } from '../api.js';

export const researchOverviewApi = {
  get: (top) => request(`/research/overview${top ? `?top=${encodeURIComponent(top)}` : ''}`),
};
