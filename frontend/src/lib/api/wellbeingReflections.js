import { request } from '../api.js';

/** D7118 (#7118): Wellness reflections, the member's own (wellbeing_reflections.ts).
 * today(tz)                    -> { today, timezone, day|week|month: { period_start, period_end, reflection|null } }
 * history(cadence, limit)      -> { cadence, reflections: [reflection], retention }, newest first
 * earlier(limit)               -> { earlier: [{ kind: 'earlier_checkin', uid, day, week_start, label, note, scores, text, topics, saved_at }] }
 * monthSummary(month)          -> { month, days_in_month, days_recorded, days, weeks, month_reflection, topics: [{ topic, days }] }
 * get(cadence, period)         -> reflection, or 404 reflection_not_found
 * save(cadence, period, body)  -> reflection + { stored_encrypted, created } | { replayed }; body is
 *                                 { timezone, scores?, text?, topics?, base_revision, request_id? }.
 *                                 409 reflection_changed { current_revision }; 503 reflection_protection_unavailable
 *                                 and reflection_not_saved keep nothing, so the caller keeps the draft.
 * remove(uid), removeEarlier(uid) -> { deleted: true }
 * exportUrl                    -> the JSON file of every own reflection and earlier check-in
 * A reflection is { uid, cadence, period_start, period_end, timezone, scores, text, topics, readable, revision, created_at, updated_at }.
 * A failed read is a 503 refusal (reflections_unreadable), never an empty list.
 */
const q = encodeURIComponent;
export const wellbeingReflectionsApi = {
  today: (tz) => request(`/wellbeing/reflections/today?tz=${q(tz || 'UTC')}`),
  history: (cadence, limit = 30) => request(`/wellbeing/reflections?cadence=${q(cadence)}&limit=${q(limit)}`),
  earlier: (limit = 30) => request(`/wellbeing/reflections/earlier?limit=${q(limit)}`),
  monthSummary: (month) => request(`/wellbeing/reflections/months/${q(month)}/summary`),
  get: (cadence, period) => request(`/wellbeing/reflections/${q(cadence)}/${q(period)}`),
  save: (cadence, period, body) =>
    request(`/wellbeing/reflections/${q(cadence)}/${q(period)}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (uid) => request(`/wellbeing/reflections/${q(uid)}`, { method: 'DELETE' }),
  removeEarlier: (uid) => request(`/wellbeing/reflections/earlier/${q(uid)}`, { method: 'DELETE' }),
  exportUrl: '/api/wellbeing/reflections/export',
};
