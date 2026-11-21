import { request } from '../api.js';

/** D7119 (#7119): a member's Wellness choices and the suggestions made from them (wellbeing_recommendations.ts).
 * preferences()            -> { support_types, languages, timezone, price_max_cents, formats, suggestions,
 *                              topic_consent, topic_sources, topic_consent_at, revision, support_type_options, topic_consent_scope }
 * savePreferences(body)    -> the same; body names only what changes, with base_revision. 409 preferences_changed.
 * resetPreferences()       -> the defaults: nothing chosen, consent off, no dismissals
 * recommendations()        -> { state: 'off' | 'choose_interests' | 'no_match' | 'ok', items, excluded, group_sessions,
 *                              not_used, topic_consent }; each item carries why: { used, not_used }
 * dismiss(kind, uid), undoDismiss(kind, uid)
 * A failed read is a 503 refusal, never an empty list.
 */
const q = encodeURIComponent;
export const wellbeingRecommendationsApi = {
  preferences: () => request('/wellbeing/preferences'),
  savePreferences: (body) => request('/wellbeing/preferences', { method: 'PUT', body: JSON.stringify(body) }),
  resetPreferences: () => request('/wellbeing/preferences/reset', { method: 'POST' }),
  recommendations: () => request('/wellbeing/recommendations'),
  dismiss: (kind, uid) => request('/wellbeing/recommendations/dismiss', { method: 'POST', body: JSON.stringify({ kind, uid }) }),
  undoDismiss: (kind, uid) => request(`/wellbeing/recommendations/dismiss/${q(kind)}/${q(uid)}`, { method: 'DELETE' }),
};
