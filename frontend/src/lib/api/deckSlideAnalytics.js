// D1573 (#3820, deck builder v2 D12) — per-slide investor analytics for one investor link (pd37), and its "Time per slide" consent.
// The studio reads the analytics through `pages/raise/pitch/deckV2Adapter.js` (`slideAnalytics`); the Share ▾
// table's switch writes the consent here. Worker: routes/deck_slide_analytics.ts, no migration.
//   GET /api/decks/:id/investor-links/:shareId/analytics       → { link_id, investor, nda, time_per_slide, views, read_seconds, cards, most_read, timeline, … }
//   PUT /api/decks/:id/investor-links/:shareId/time-per-slide  { on } → { ok, link }: off keeps visit counts only
//   GET /api/decks/:id/analytics/daily?from&to&version&nda       D4254 P4 (#4272): { days, funnels: { nda, open }, dropoff: { current, previous }, versions }
//     at most 90 days (422 past it); a value nobody counted is null, never 0; the venture's writers only
import { request } from '../api.js';

const enc = encodeURIComponent;

export const deckSlideAnalyticsApi = {
  read: (deckId, shareId) => request(`/decks/${enc(deckId)}/investor-links/${enc(shareId)}/analytics`),
  /** Share & analytics (ps7): `q` is `{ from?, to?, version?, nda? }`; an empty value is left out. */
  daily: (deckId, q = {}) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
    return request(`/decks/${enc(deckId)}/analytics/daily${qs ? `?${qs}` : ''}`);
  },
  setTimePerSlide: (deckId, shareId, on) => request(`/decks/${enc(deckId)}/investor-links/${enc(shareId)}/time-per-slide`, { method: 'PUT', body: JSON.stringify({ on: on === true }) }),
};
