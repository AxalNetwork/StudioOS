/**
 * D4289 P7 (#4296) — the Influencer section's one seam to the Worker. The page
 * takes this object as its `reads` prop, so a test passes stubs in its place.
 * Every method is a mounted route: `lib/api/influencer.js` for the program's
 * own, and `api.payoutRequest` / `api.payoutsMe` (`routes/network.ts`) for the
 * payout itself, which every referral partner shares.
 */
import { api } from '../../../lib/api';
import { influencerApi } from '../../../lib/api/influencer';

export const influencerSectionReads = {
  me: () => influencerApi.me(),
  handle: () => influencerApi.handle(),
  setHandle: (body) => influencerApi.setHandle(body),
  links: () => influencerApi.links(),
  addLink: (body) => influencerApi.addLink(body),
  archiveLink: (uid) => influencerApi.archiveLink(uid),
  offers: () => influencerApi.offers(),
  requestOffer: (message) => influencerApi.requestOffer(message),
  readiness: () => influencerApi.payoutReadiness(),
  submitTaxForm: (body) => influencerApi.submitTaxForm(body),
  acceptTerms: (version) => influencerApi.acceptTerms(version),
  analytics: (opts) => influencerApi.analytics(opts),
  tiers: () => influencerApi.tiers(),
  payouts: () => api.payoutsMe(),
  requestPayout: (body) => api.payoutRequest(body),
};
