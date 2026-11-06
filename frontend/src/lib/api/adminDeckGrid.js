// D1537 (#3786, deck v2 B10) — HQ › Decks › Grid health and Funnel. Worker:
// routes/admin_deck_grid.ts (/api/admin/ai/deck-grid) and D1510's
// routes/admin_deck_generation.ts (/api/admin/deck-generation), HQ admins only.
//   GET /admin/ai/deck-grid?days=        { days, rows: [...] | null, budget: {...} | null }
//   GET /admin/ai/deck-grid/funnel?days= { days, generations, quote_conversion, accept_rates, first_share, retention_4w }
//   GET /admin/deck-generation?days=     { ceiling, alert_thresholds, days, accept_rates }
// A figure the Worker could not read is null, never 0.
import { request } from '../api.js';

const q = (days) => (days ? `?days=${encodeURIComponent(days)}` : '');

export const adminDeckGridApi = {
  grid: (days) => request(`/admin/ai/deck-grid${q(days)}`),
  funnel: (days) => request(`/admin/ai/deck-grid/funnel${q(days)}`),
  generation: (days) => request(`/admin/deck-generation${q(days)}`),
};
