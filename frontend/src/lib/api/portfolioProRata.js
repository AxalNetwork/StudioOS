// D6908 (#6908) — an investor's own pro rata offer in a held company's live
// round, and the round's address. Worker: routes/portfolio_pro_rata.ts
// (/api/portfolio-pro-rata). Feeds the Pro rata row on Ownership & rights (D6868).
import { request } from '../api.js';

export const portfolioProRataApi = {
  // { project_uid, live_round: { uid, name, close_date, href, href_not_recorded } | null,
  //   offer: { amount_cents, currency, respond_by, state, taking_cents, responded_at } | null, offer_not_recorded }
  get: (projectUid) => request(`/portfolio-pro-rata/${encodeURIComponent(projectUid)}`),
};
