// D4297 (#4297, D4289 P8) — the public side of the Influencer program: the
// /influencers page's tiers, the application sheet and its states, and the
// Refer & Earn card. Worker: routes/influencer.ts (P1 #4290). The member's own
// Influencer section reads `influencer.js` (P7 #4296).
//   GET  /api/influencer/tiers   → { tiers: [{ tier, label, percentage_bps, duration_invoices, currency }] }
//                                  public; the rates HQ keeps, never typed (D4289 §1.7)
//   GET  /api/influencer/me      → { membership | null, application | null, reapply_after, consent_version }
//   POST /api/influencer/apply   { channels: [{ kind, url, audience? }], regions, topics, why, consent_version,
//                                  consent: { disclosure, no_deal_promotion, no_self_referral } }
//                                → 201 { application } (200 when it answers HQ's question)
//                                  409 already_influencer · application_open · reapply_later · hq_program
import { request } from '../api.js';

export const influencerProgramApi = {
  tiers: () => request('/influencer/tiers'),
  me: () => request('/influencer/me'),
  apply: (body) => request('/influencer/apply', { method: 'POST', body: JSON.stringify(body) }),
};
