// D755 (#1919) — what /plans-and-pricing shows a visitor: every plan with its
// price and AI allowance, and the token packs on sale. Worker:
// `GET /api/public/plans-and-packs` in routes/public.ts, no session needed.
import { request } from '../api.js';

export const publicPricingApi = {
  plansAndPacks: () => request('/public/plans-and-packs'),
};
