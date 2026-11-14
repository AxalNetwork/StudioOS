import { request } from '../api.js';

/**
 * D1585 (#3832, deck v2 F6) — routes/cycle_raise.ts, mounted at /api/cycles/raise.
 *   get(projectId, prospectId, eventId?)  GET /cycles/raise/prospects/:id/brief?project=&event=
 *     → { prospect, meeting, last_met, timeline, deck, objections, basis }. No model runs.
 *     A part that could not be read answers `{ state: 'unreadable' }`, never an empty list.
 */
export const prospectBriefApi = {
  get: (projectId, prospectId, eventId = null) => request(
    `/cycles/raise/prospects/${encodeURIComponent(String(prospectId))}/brief?project=${encodeURIComponent(String(projectId))}${eventId != null ? `&event=${encodeURIComponent(String(eventId))}` : ''}`,
  ),
};
