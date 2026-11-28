/**
 * D6131 (#6131): the investor onboarding thesis draft, on cloudflare-worker/src/routes/onboarding.ts at /api/onboarding.
 *   draftThesis()  POST /onboarding/investor/thesis-draft → the drafted thesis the page offers to the investor
 * A new API domain gets its own module (D527); api.js is frozen (hub_freeze_5615).
 */
import { request } from '../api.js';

export const investorOnboardingApi = {
  draftThesis: () => request('/onboarding/investor/thesis-draft', { method: 'POST' }),
};
