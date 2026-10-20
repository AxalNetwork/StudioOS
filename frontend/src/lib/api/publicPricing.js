// D755 (#1919) — what /pricing/products (D786; /plans-and-pricing until then) shows a visitor: every plan with its
// price and AI allowance, and the token packs on sale. Worker:
// `GET /api/public/plans-and-packs` in routes/public.ts, no session needed.
// D816 (#2262): each paid plan also carries `monthly` and `yearly`
// (`{ unit_amount, currency, allowance_microusd }` or null) and
// `yearly_saving_percent`, computed from the two prices, for /pricing's interval switch.
import { request } from '../api.js';

export const publicPricingApi = {
  plansAndPacks: () => request('/public/plans-and-packs'),
  // D786 (#2211): the Models tab, every model the router offers at its billed price. No session needed.
  aiModels: () => request('/public/ai/models'),
};
